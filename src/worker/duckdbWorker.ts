/// <reference lib="webworker" />

import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbWorkerMvp from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbWorkerEh from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

const DUCKDB_VERSION = "1.33.1-dev18.0";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;
const duckdbWasmMvp = `${CDN_BASE}/duckdb-mvp.wasm`;
const duckdbWasmEh = `${CDN_BASE}/duckdb-eh.wasm`;
import type * as arrow from "apache-arrow";
import type {
  ColumnInfo,
  ColumnProfile,
  ColumnSortOrder,
  PivotConfig,
  PreviewResult,
  SankeyGraph,
  SankeyLink,
  SankeyNode,
  TraceDrillResult,
  TraceKeyConfig,
  TraceOverlayResult,
  TracePathSegment,
  TraceSelection,
  ValueMode,
} from "../types";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { buildSankeyLinksQuery, buildSankeyTraceRowsQuery } from "./sankeyQueryBuilder";

const DB_PATH = "opfs://sankeyfi.duckdb";
const OPFS_PROBE_FILE = "__sankeyfi-opfs-probe.bin";
const RAW_TABLE = "raw_data";
const NORMALIZED_VIEW = "v_data";
const PIVOT_VIEW = "v_pivoted_data";
const DEFAULT_TOP_N = 20;
const OTHER_LABEL = "Other";
type SyncAccessHandle = {
  write: (data: ArrayBufferView, options?: { at?: number }) => number;
  flush: () => void;
  close: () => void;
};
type FileHandleWithSyncAccess = FileSystemFileHandle & {
  createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
};

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbWasmMvp,
    mainWorker: duckdbWorkerMvp,
  },
  eh: {
    mainModule: duckdbWasmEh,
    mainWorker: duckdbWorkerEh,
  },
};

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let persistenceMode: "opfs" | "memory" = "memory";

const quoteIdent = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const sanitizeFileName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, "_");
const toErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const normalizeTopN = (value: number | undefined): number => (Number.isInteger(value) && Number(value) >= 1 ? Number(value) : DEFAULT_TOP_N);
const isWriteModeCommitError = (message: string): boolean => {
  const lower = message.toLowerCase();
  return lower.includes("failed to commit") && lower.includes("not opened in write mode");
};

const normalizeImportError = (fileName: string, extension: string, bytes: ArrayBuffer, rawMessage: string): string => {
  const lower = rawMessage.toLowerCase();
  const sizeMb = (bytes.byteLength / (1024 * 1024)).toFixed(1);
  const isDelimitedText = extension === "csv" || extension === "tsv" || extension === "txt";

  if (lower.includes("out of memory") || lower.includes("memory") || lower.includes("allocation")) {
    return `Import failed for "${fileName}" (${sizeMb} MB): browser memory limit reached. Close other tabs/apps and try again, or test with a smaller sample file.`;
  }

  const csvParsingError =
    isDelimitedText &&
    (lower.includes("read_csv_auto") ||
      lower.includes("csv") ||
      lower.includes("delimiter") ||
      lower.includes("header") ||
      lower.includes("could not"));
  if (csvParsingError) {
    return `Import failed for "${fileName}" (${sizeMb} MB): CSV parsing could not complete. Confirm delimiter/header format and try a smaller sample to validate schema first.`;
  }

  return `Import failed for "${fileName}" (${sizeMb} MB): ${rawMessage}`;
};

const tableToRows = <T extends Record<string, unknown>>(table: arrow.Table): T[] =>
  table.toArray().map((row) => ({ ...row })) as T[];

const ensureConnection = (): duckdb.AsyncDuckDBConnection => {
  if (!conn) {
    throw new Error("DuckDB connection is not initialized.");
  }
  return conn;
};

const canUseWritableOpfs = async (): Promise<boolean> => {
  if (!("storage" in navigator) || typeof navigator.storage?.getDirectory !== "function") {
    return false;
  }

  let accessHandle: SyncAccessHandle | null = null;
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(OPFS_PROBE_FILE, { create: true });
    accessHandle = await (fileHandle as FileHandleWithSyncAccess).createSyncAccessHandle?.();
    if (!accessHandle) {
      return false;
    }
    const payload = new Uint8Array([1]);
    accessHandle.write(payload, { at: 0 });
    accessHandle.flush();
    accessHandle.close();
    accessHandle = null;
    await root.removeEntry(OPFS_PROBE_FILE);
    return true;
  } catch {
    if (accessHandle) {
      try {
        accessHandle.close();
      } catch {
        // Ignore probe cleanup errors.
      }
    }
    return false;
  }
};

const switchToInMemory = async (): Promise<void> => {
  const activeDb = db;
  if (!activeDb) {
    throw new Error("DuckDB is not initialized.");
  }
  if (conn) {
    try {
      await conn.close();
    } catch (error) {
      console.warn("Failed to close existing DuckDB connection before memory fallback.", error);
    } finally {
      conn = null;
    }
  }
  await activeDb.open({});
  persistenceMode = "memory";
  conn = await activeDb.connect();
};

const listColumnsInternal = async (): Promise<ColumnInfo[]> => {
  const table = await ensureConnection().query(`PRAGMA table_info('${RAW_TABLE}')`);
  return tableToRows<{ name: string; type: string }>(table).map((row) => ({
    name: row.name,
    type: row.type,
  }));
};

const previewInternal = async (limit = 25): Promise<PreviewResult> => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(250, limit)) : 25;
  const previewTable = await ensureConnection().query(`SELECT * FROM ${RAW_TABLE} LIMIT ${safeLimit}`);
  const rows = tableToRows<Record<string, unknown>>(previewTable);
  const columns = previewTable.schema.fields.map((field) => field.name);
  return { columns, rows };
};

const profileColumnsInternal = async (): Promise<ColumnProfile[]> => {
  const columns = await listColumnsInternal();
  if (!columns.length) return [];

  const profiles: ColumnProfile[] = [];
  for (const column of columns) {
    const identifier = quoteIdent(column.name);
    const profileTable = await ensureConnection().query(`
      SELECT
        COUNT(DISTINCT COALESCE(NULLIF(TRIM(CAST(${identifier} AS VARCHAR)), ''), '(blank)')) AS distinct_count,
        COUNT(NULLIF(TRIM(CAST(${identifier} AS VARCHAR)), '')) AS non_blank_count
      FROM ${RAW_TABLE}
    `);
    const [row] = tableToRows<{ distinct_count: number; non_blank_count: number }>(profileTable);
    profiles.push({
      columnName: column.name,
      distinctCount: Number(row?.distinct_count ?? 0),
      nonBlankCount: Number(row?.non_blank_count ?? 0),
    });
  }

  return profiles;
};

const createNormalizedView = async (): Promise<void> => {
  const columns = await listColumnsInternal();
  if (!columns.length) {
    return;
  }

  const projections = columns.map((column) => {
    const identifier = quoteIdent(column.name);
    return `NULLIF(TRIM(CAST(${identifier} AS VARCHAR)), '') AS ${identifier}`;
  });

  await ensureConnection().query(`
    CREATE OR REPLACE VIEW ${NORMALIZED_VIEW} AS
    SELECT
      ${projections.join(",\n      ")}
    FROM ${RAW_TABLE}
  `);
};

const preparePivotedView = async (
  pivot: PivotConfig,
  mode: ValueMode,
  amountCol?: string,
): Promise<{ dims: string[]; headers: string[]; sourceRelation: string; stepAmountCols: string[] }> => {
  if (!pivot.keyColumn || !pivot.stageLabelColumn) {
    throw new Error("Pivot mode requires key and stage label columns.");
  }
  if (!pivot.usePivotKeyAsNodeLabel && !pivot.stageValueColumn) {
    throw new Error("Pivot mode requires a stage value column unless using pivot key as node label.");
  }
  if (mode === "sum" && !amountCol) {
    throw new Error("Amount column is required for SUM mode.");
  }

  const keyCol = quoteIdent(pivot.keyColumn);
  const stageLabelCol = quoteIdent(pivot.stageLabelColumn);
  const stageValueCol = quoteIdent(pivot.stageValueColumn || pivot.keyColumn);
  const amountProjection = amountCol ? `TRY_CAST(${quoteIdent(amountCol)} AS DOUBLE)` : "NULL";
  const nodeLabelProjection = pivot.usePivotKeyAsNodeLabel ? `CAST(${keyCol} AS VARCHAR)` : `CAST(${stageValueCol} AS VARCHAR)`;

  const headersTable = await ensureConnection().query(`
    SELECT DISTINCT CAST(${stageLabelCol} AS VARCHAR) AS stage_label
    FROM ${quoteIdent(NORMALIZED_VIEW)}
    WHERE ${keyCol} IS NOT NULL
      AND ${stageLabelCol} IS NOT NULL
      AND ${pivot.usePivotKeyAsNodeLabel ? `${keyCol} IS NOT NULL` : `${stageValueCol} IS NOT NULL`}
    ORDER BY stage_label ASC
  `);
  const headers = tableToRows<{ stage_label: string }>(headersTable)
    .map((row) => String(row.stage_label ?? "").trim())
    .filter(Boolean);

  if (headers.length < 2) {
    throw new Error("Pivot mode requires at least two distinct stage labels.");
  }

  const dims = headers.map((_, index) => `pivot_stage_${index + 1}`);
  const stepAmountCols = headers.slice(0, -1).map((_, index) => `pivot_amount_${index + 1}`);
  const stageIndexExpr = `CASE CAST(stage_label AS VARCHAR)
      ${headers.map((label, index) => `WHEN ${quoteLiteral(label)} THEN ${index + 1}`).join("\n      ")}
      ELSE NULL
    END`;

  const stageValueProjections = dims.map(
    (column, index) => `MAX(CASE WHEN stage_index = ${index + 1} THEN stage_value END) AS ${quoteIdent(column)}`,
  );
  const amountProjections = dims.map(
    (_, index) => `MAX(CASE WHEN stage_index = ${index + 1} THEN stage_amount END) AS ${quoteIdent(`pivot_amount_${index + 1}`)}`,
  );

  await ensureConnection().query(`
    CREATE OR REPLACE VIEW ${quoteIdent(PIVOT_VIEW)} AS
    WITH pivot_source AS (
      SELECT
        CAST(${keyCol} AS VARCHAR) AS pivot_key,
        CAST(${stageLabelCol} AS VARCHAR) AS stage_label,
        ${nodeLabelProjection} AS stage_value,
        ${amountProjection} AS stage_amount
      FROM ${quoteIdent(NORMALIZED_VIEW)}
      WHERE ${keyCol} IS NOT NULL
        AND ${stageLabelCol} IS NOT NULL
        AND ${pivot.usePivotKeyAsNodeLabel ? `${keyCol} IS NOT NULL` : `${stageValueCol} IS NOT NULL`}
    ),
    deduped_stage_values AS (
      SELECT
        pivot_key,
        stage_label,
        MIN(stage_value) AS stage_value,
        MIN(stage_amount) AS stage_amount
      FROM pivot_source
      GROUP BY 1, 2
    ),
    indexed AS (
      SELECT
        pivot_key,
        ${stageIndexExpr} AS stage_index,
        stage_value,
        stage_amount
      FROM deduped_stage_values
    )
    SELECT
      pivot_key,
      ${[...stageValueProjections, ...amountProjections].join(",\n      ")}
    FROM indexed
    WHERE stage_index IS NOT NULL
    GROUP BY 1
  `);

  return {
    dims,
    headers,
    sourceRelation: PIVOT_VIEW,
    stepAmountCols,
  };
};

const toSankeyGraph = (
  rows: Array<{ step: number; src: string; dst: string; value: number }>,
  sortOrder: ColumnSortOrder,
): SankeyGraph => {
  const nodeMap = new Map<string, SankeyNode>();
  const links: SankeyLink[] = [];
  const stageTotals = new Map<number, Map<string, number>>();
  const addStageValue = (stage: number, label: string, value: number) => {
    const totalsByLabel = stageTotals.get(stage) ?? new Map<string, number>();
    totalsByLabel.set(label, (totalsByLabel.get(label) ?? 0) + value);
    stageTotals.set(stage, totalsByLabel);
  };

  for (const row of rows) {
    const step = Number(row.step);
    const srcLabel = String(row.src ?? "").trim();
    const dstLabel = String(row.dst ?? "").trim();
    const value = Number(row.value ?? 0);
    if (!srcLabel || !dstLabel || !Number.isFinite(value) || value <= 0) {
      continue;
    }

    const sourceId = `${step}::${srcLabel}`;
    const targetId = `${step + 1}::${dstLabel}`;

    if (!nodeMap.has(sourceId)) {
      nodeMap.set(sourceId, { id: sourceId, label: srcLabel, depth: step });
    }
    if (!nodeMap.has(targetId)) {
      nodeMap.set(targetId, { id: targetId, label: dstLabel, depth: step + 1 });
    }

    links.push({
      step,
      source: sourceId,
      target: targetId,
      value,
    });
    addStageValue(step, srcLabel, value);
    addStageValue(step + 1, dstLabel, value);
  }

  const nodes = [...nodeMap.values()].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (sortOrder === "largest_flow") {
      const aTotal = stageTotals.get(a.depth)?.get(a.label) ?? 0;
      const bTotal = stageTotals.get(b.depth)?.get(b.label) ?? 0;
      const totalDiff = bTotal - aTotal;
      if (totalDiff !== 0) return totalDiff;
    }
    return a.label.localeCompare(b.label);
  });

  return { nodes, links };
};

const applyTopNBucketing = (
  rows: Array<{ step: number; src: string; dst: string; value: number }>,
  dims: string[],
  topNByDimension: Record<string, number> | undefined,
): Array<{ step: number; src: string; dst: string; value: number }> => {
  const stageTotals = new Map<number, Map<string, number>>();
  const addStageValue = (stage: number, label: string, value: number) => {
    const byLabel = stageTotals.get(stage) ?? new Map<string, number>();
    byLabel.set(label, (byLabel.get(label) ?? 0) + value);
    stageTotals.set(stage, byLabel);
  };

  for (const row of rows) {
    const step = Number(row.step);
    const value = Number(row.value ?? 0);
    const src = String(row.src ?? "").trim();
    const dst = String(row.dst ?? "").trim();
    if (!Number.isFinite(step) || !src || !dst || !Number.isFinite(value) || value <= 0) continue;
    addStageValue(step, src, value);
    addStageValue(step + 1, dst, value);
  }

  const maxStage = Math.max(0, ...stageTotals.keys());
  const keepersByStage = new Map<number, Set<string>>();
  for (let stage = 1; stage <= maxStage; stage += 1) {
    const stageName = dims[stage - 1];
    const topN = normalizeTopN(stageName ? topNByDimension?.[stageName] : undefined);
    const entries = [...(stageTotals.get(stage)?.entries() ?? [])];
    entries.sort((left, right) => {
      const valueDiff = right[1] - left[1];
      if (valueDiff !== 0) return valueDiff;
      return left[0].localeCompare(right[0]);
    });
    keepersByStage.set(
      stage,
      new Set(entries.slice(0, topN).map(([label]) => label)),
    );
  }

  const bucketed = new Map<string, { step: number; src: string; dst: string; value: number }>();
  for (const row of rows) {
    const step = Number(row.step);
    const value = Number(row.value ?? 0);
    const src = String(row.src ?? "").trim();
    const dst = String(row.dst ?? "").trim();
    if (!Number.isFinite(step) || !src || !dst || !Number.isFinite(value) || value <= 0) continue;

    const source = keepersByStage.get(step)?.has(src) ? src : OTHER_LABEL;
    const target = keepersByStage.get(step + 1)?.has(dst) ? dst : OTHER_LABEL;
    const key = `${step}\u0000${source}\u0000${target}`;
    const current = bucketed.get(key);
    if (current) {
      current.value += value;
      continue;
    }
    bucketed.set(key, { step, src: source, dst: target, value });
  }

  return [...bucketed.values()].sort((left, right) => {
    if (left.step !== right.step) return left.step - right.step;
    return right.value - left.value;
  });
};

type TraceTransitionRow = {
  step: number;
  src: string;
  dst: string;
  value: number;
  recordId: string;
};

const buildRecordIdExpression = (traceKeyConfig: TraceKeyConfig): string => {
  if (traceKeyConfig.mode === "single") {
    return `COALESCE(NULLIF(TRIM(CAST(${quoteIdent(traceKeyConfig.column)} AS VARCHAR)), ''), '(blank)')`;
  }
  if (!traceKeyConfig.columns.length) {
    throw new Error("Composite trace key requires at least one column.");
  }
  const pieces = traceKeyConfig.columns.map(
    (column) => `COALESCE(NULLIF(TRIM(CAST(${quoteIdent(column)} AS VARCHAR)), ''), '(blank)')`,
  );
  return `(${pieces.join(` || '¦' || `)})`;
};

const applyTopNBucketingWithTrace = (
  rows: TraceTransitionRow[],
  dims: string[],
  topNByDimension: Record<string, number> | undefined,
): TraceTransitionRow[] => {
  const stageTotals = new Map<number, Map<string, number>>();
  const addStageValue = (stage: number, label: string, value: number) => {
    const byLabel = stageTotals.get(stage) ?? new Map<string, number>();
    byLabel.set(label, (byLabel.get(label) ?? 0) + value);
    stageTotals.set(stage, byLabel);
  };

  for (const row of rows) {
    if (!row.recordId) continue;
    addStageValue(row.step, row.src, row.value);
    addStageValue(row.step + 1, row.dst, row.value);
  }

  const maxStage = Math.max(0, ...stageTotals.keys());
  const keepersByStage = new Map<number, Set<string>>();
  for (let stage = 1; stage <= maxStage; stage += 1) {
    const stageName = dims[stage - 1];
    const topN = normalizeTopN(stageName ? topNByDimension?.[stageName] : undefined);
    const entries = [...(stageTotals.get(stage)?.entries() ?? [])];
    entries.sort((left, right) => {
      const valueDiff = right[1] - left[1];
      if (valueDiff !== 0) return valueDiff;
      return left[0].localeCompare(right[0]);
    });
    keepersByStage.set(
      stage,
      new Set(entries.slice(0, topN).map(([label]) => label)),
    );
  }

  const bucketed = new Map<string, TraceTransitionRow>();
  for (const row of rows) {
    const source = keepersByStage.get(row.step)?.has(row.src) ? row.src : OTHER_LABEL;
    const target = keepersByStage.get(row.step + 1)?.has(row.dst) ? row.dst : OTHER_LABEL;
    const key = `${row.step}\u0000${source}\u0000${target}\u0000${row.recordId}`;
    const current = bucketed.get(key);
    if (current) {
      current.value += row.value;
      continue;
    }
    bucketed.set(key, {
      step: row.step,
      src: source,
      dst: target,
      value: row.value,
      recordId: row.recordId,
    });
  }

  return [...bucketed.values()].sort((left, right) => {
    if (left.step !== right.step) return left.step - right.step;
    return right.value - left.value;
  });
};

const init = async (): Promise<{ ready: boolean; persistence: "opfs" | "memory" }> => {
  if (db && conn) {
    return { ready: true, persistence: persistenceMode };
  }

  let initStage = "selecting DuckDB bundle";
  try {
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    initStage = "starting DuckDB worker";
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    db = new duckdb.AsyncDuckDB(logger, worker);
    initStage = "instantiating DuckDB wasm";
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  } catch (error) {
    const detail = toErrorMessage(error);
    throw new Error(`Data engine startup failed while ${initStage}. ${detail}`);
  }

  const opfsWritable = await canUseWritableOpfs();
  if (opfsWritable) {
    try {
      await db.open({
        path: DB_PATH,
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        opfs: { fileHandling: "auto" },
      });
      persistenceMode = "opfs";
    } catch (error) {
      console.warn("OPFS unavailable, falling back to in-memory DB.", error);
      try {
        await db.open({});
        persistenceMode = "memory";
      } catch (fallbackError) {
        const detail = toErrorMessage(fallbackError);
        throw new Error(`Data engine startup failed while opening in-memory database. ${detail}`);
      }
    }
  } else {
    try {
      await db.open({});
      persistenceMode = "memory";
    } catch (fallbackError) {
      const detail = toErrorMessage(fallbackError);
      throw new Error(`Data engine startup failed while opening in-memory database. ${detail}`);
    }
  }

  try {
    conn = await db.connect();
  } catch (error) {
    const detail = toErrorMessage(error);
    throw new Error(`Data engine startup failed while opening a database connection. ${detail}`);
  }

  if (persistenceMode === "opfs") {
    try {
      await ensureConnection().query("CREATE TABLE IF NOT EXISTS __sankeyfi_write_probe (id INTEGER)");
      await ensureConnection().query("DROP TABLE IF EXISTS __sankeyfi_write_probe");
    } catch (error) {
      const detail = toErrorMessage(error);
      if (isWriteModeCommitError(detail)) {
        console.warn("OPFS database is not writable in this browser session. Switching to in-memory mode.");
        await switchToInMemory();
      } else {
        throw new Error(`Data engine startup failed while validating writable storage. ${detail}`);
      }
    }
  }
  return { ready: true, persistence: persistenceMode };
};

const importFile = async (fileName: string, bytes: ArrayBuffer) => {
  const activeDb = db;
  if (!activeDb) {
    throw new Error("DuckDB is not initialized.");
  }

  const lower = fileName.toLowerCase();
  const extension = lower.split(".").pop() ?? "";
  const runImport = async (): Promise<{ table: string; columns: ColumnInfo[]; preview: PreviewResult; persistence: "opfs" | "memory" }> => {
    const registeredPath = `uploads/${Date.now()}-${sanitizeFileName(fileName)}`;
    await activeDb.registerFileBuffer(registeredPath, new Uint8Array(bytes));

    if (extension === "csv" || extension === "tsv" || extension === "txt") {
      const delimSql = extension === "tsv" ? "DELIM = '\t'," : "";
      await ensureConnection().query(`
        CREATE OR REPLACE TABLE ${RAW_TABLE} AS
        SELECT *
        FROM read_csv_auto('${registeredPath}', AUTO_DETECT = TRUE, SAMPLE_SIZE = -1, ${delimSql} HEADER = TRUE)
      `);
    } else if (extension === "parquet" || extension === "pq") {
      await ensureConnection().query(`
        CREATE OR REPLACE TABLE ${RAW_TABLE} AS
        SELECT *
        FROM parquet_scan('${registeredPath}')
      `);
    } else {
      throw new Error(`Unsupported file extension ".${extension}". Use CSV, TSV, or Parquet.`);
    }

    await createNormalizedView();
    const columns = await listColumnsInternal();
    const preview = await previewInternal(20);
    return { table: RAW_TABLE, columns, preview, persistence: persistenceMode };
  };

  try {
    return await runImport();
  } catch (error) {
    const detail = toErrorMessage(error);
    if (persistenceMode === "opfs" && isWriteModeCommitError(detail)) {
      console.warn("Detected non-writable OPFS database during import. Switching to in-memory mode.");
      try {
        await switchToInMemory();
        return await runImport();
      } catch (retryError) {
        throw new Error(normalizeImportError(fileName, extension, bytes, toErrorMessage(retryError)));
      }
    }
    throw new Error(normalizeImportError(fileName, extension, bytes, detail));
  }
};

const computeSankey = async (params: {
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  pivot?: PivotConfig;
  topNByDimension?: Record<string, number>;
  sortOrder?: ColumnSortOrder;
  traceKeyConfig?: TraceKeyConfig;
  includeTrace?: boolean;
}) => {
  let effectiveDims = params.dims;
  let effectiveHeaders = params.dims;
  let sourceRelation = NORMALIZED_VIEW;
  let stepAmountCols: string[] | undefined;
  let amountCol = params.amountCol;

  if (params.pivot?.enabled) {
    const prepared = await preparePivotedView(params.pivot, params.mode, params.amountCol);
    effectiveDims = prepared.dims;
    effectiveHeaders = prepared.headers;
    sourceRelation = prepared.sourceRelation;
    stepAmountCols = params.mode === "sum" ? prepared.stepAmountCols : undefined;
    amountCol = params.mode === "sum" ? undefined : params.amountCol;
  }

  const linksQuery = buildSankeyLinksQuery({
    dims: effectiveDims,
    mode: params.mode,
    amountCol,
    sourceRelation,
    stepAmountCols,
  });
  const table = await ensureConnection().query(linksQuery);
  const rows = tableToRows<{ step: number; src: string; dst: string; value: number }>(table);
  const bucketedRows = applyTopNBucketing(rows, effectiveDims, params.topNByDimension);
  const graph = toSankeyGraph(bucketedRows, params.sortOrder ?? "largest_flow");
  if (params.includeTrace && params.traceKeyConfig) {
    const traceRowsQuery = buildSankeyTraceRowsQuery({
      dims: effectiveDims,
      mode: params.mode,
      amountCol,
      sourceRelation,
      stepAmountCols,
      recordIdExpression: buildRecordIdExpression(params.traceKeyConfig),
    });
    const traceTable = await ensureConnection().query(traceRowsQuery);
    const rawTraceRows = tableToRows<{ step: number; src: string; dst: string; value: number; record_id: string }>(traceTable);
    const traceRows = rawTraceRows
      .map((row) => ({
        step: Number(row.step),
        src: String(row.src ?? "").trim(),
        dst: String(row.dst ?? "").trim(),
        value: Number(row.value ?? 0),
        recordId: String(row.record_id ?? "").trim(),
      }))
      .filter((row) => row.step >= 1 && row.src && row.dst && row.recordId && Number.isFinite(row.value) && row.value > 0);
    const bucketedTraceRows = applyTopNBucketingWithTrace(traceRows, effectiveDims, params.topNByDimension);
    const traceByLink = new Map<string, Set<string>>();
    for (const row of bucketedTraceRows) {
      const key = `${row.step}\u0000${row.src}\u0000${row.dst}`;
      const set = traceByLink.get(key) ?? new Set<string>();
      set.add(row.recordId);
      traceByLink.set(key, set);
    }
    graph.links = graph.links.map((link) => {
      const sourceLabel = nodeLabelFromId(link.source);
      const targetLabel = nodeLabelFromId(link.target);
      const key = `${link.step}\u0000${sourceLabel}\u0000${targetLabel}`;
      const ids = [...(traceByLink.get(key) ?? [])];
      return {
        ...link,
        traceCount: ids.length,
        sampleRecordIds: ids.slice(0, 5),
      };
    });
  }
  return {
    ...graph,
    columnHeaders: effectiveHeaders,
  };
};

const nodeLabelFromId = (nodeId: string): string => {
  const split = nodeId.indexOf("::");
  return split >= 0 ? nodeId.slice(split + 2) : nodeId;
};

const resolveSankeySource = async (params: {
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  pivot?: PivotConfig;
}): Promise<{ dims: string[]; sourceRelation: string; stepAmountCols?: string[]; amountCol?: string }> => {
  let effectiveDims = params.dims;
  let sourceRelation = NORMALIZED_VIEW;
  let stepAmountCols: string[] | undefined;
  let amountCol = params.amountCol;

  if (params.pivot?.enabled) {
    const prepared = await preparePivotedView(params.pivot, params.mode, params.amountCol);
    effectiveDims = prepared.dims;
    sourceRelation = prepared.sourceRelation;
    stepAmountCols = params.mode === "sum" ? prepared.stepAmountCols : undefined;
    amountCol = params.mode === "sum" ? undefined : params.amountCol;
  }
  return { dims: effectiveDims, sourceRelation, stepAmountCols, amountCol };
};

const loadBucketedTraceRows = async (params: {
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  pivot?: PivotConfig;
  topNByDimension?: Record<string, number>;
  traceKeyConfig: TraceKeyConfig;
}): Promise<TraceTransitionRow[]> => {
  const resolved = await resolveSankeySource(params);
  const traceRowsQuery = buildSankeyTraceRowsQuery({
    dims: resolved.dims,
    mode: params.mode,
    amountCol: resolved.amountCol,
    sourceRelation: resolved.sourceRelation,
    stepAmountCols: resolved.stepAmountCols,
    recordIdExpression: buildRecordIdExpression(params.traceKeyConfig),
  });
  const traceTable = await ensureConnection().query(traceRowsQuery);
  const rawTraceRows = tableToRows<{ step: number; src: string; dst: string; value: number; record_id: string }>(traceTable);
  const traceRows = rawTraceRows
    .map((row) => ({
      step: Number(row.step),
      src: String(row.src ?? "").trim(),
      dst: String(row.dst ?? "").trim(),
      value: Number(row.value ?? 0),
      recordId: String(row.record_id ?? "").trim(),
    }))
    .filter((row) => row.step >= 1 && row.src && row.dst && row.recordId && Number.isFinite(row.value) && row.value > 0);
  return applyTopNBucketingWithTrace(traceRows, resolved.dims, params.topNByDimension);
};

const getTraceRecords = async (params: {
  selection: TraceSelection;
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  pivot?: PivotConfig;
  topNByDimension?: Record<string, number>;
  traceKeyConfig: TraceKeyConfig;
  limit?: number;
}): Promise<TraceDrillResult> => {
  const bucketedTraceRows = await loadBucketedTraceRows(params);
  const matchingRows = bucketedTraceRows.filter((row) => {
    const sourceId = `${row.step}::${row.src}`;
    const targetId = `${row.step + 1}::${row.dst}`;
    if (params.selection.kind === "link") {
      return sourceId === params.selection.sourceId && targetId === params.selection.targetId;
    }
    return sourceId === params.selection.nodeId || targetId === params.selection.nodeId;
  });

  const limit = Number.isFinite(params.limit) ? Math.max(1, Math.min(500, Number(params.limit))) : 250;
  const totalRecords = new Set(matchingRows.map((row) => row.recordId)).size;
  const totalValue = matchingRows.reduce((sum, row) => sum + row.value, 0);
  const rows = matchingRows.slice(0, limit).map((row) => ({
    recordId: row.recordId,
    step: row.step,
    source: row.src,
    target: row.dst,
    value: row.value,
  }));
  return {
    selection: params.selection,
    totalRecords,
    totalValue,
    rows,
    truncated: matchingRows.length > rows.length,
  };
};

const resolveSingleRecordPath = async (params: {
  selection: TraceSelection;
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  pivot?: PivotConfig;
  topNByDimension?: Record<string, number>;
  traceKeyConfig: TraceKeyConfig;
}): Promise<{ recordId: string; pathSegments: TracePathSegment[]; totalValue: number } | null> => {
  if (params.selection.kind !== "node") return null;
  const nodeSelection = params.selection;
  const bucketedTraceRows = await loadBucketedTraceRows(params);
  const maxDepth = Math.max(1, ...bucketedTraceRows.map((row) => row.step + 1));
  const isBoundaryNode = nodeSelection.depth === 1 || nodeSelection.depth === maxDepth;
  if (!isBoundaryNode) return null;
  const isFirstColumn = nodeSelection.depth === 1;
  const candidateRows = bucketedTraceRows.filter((row) => {
    const sourceId = `${row.step}::${row.src}`;
    const targetId = `${row.step + 1}::${row.dst}`;
    return isFirstColumn ? sourceId === nodeSelection.nodeId : targetId === nodeSelection.nodeId;
  });
  if (!candidateRows.length) return null;

  const totalsByRecord = new Map<string, number>();
  for (const row of candidateRows) {
    totalsByRecord.set(row.recordId, (totalsByRecord.get(row.recordId) ?? 0) + row.value);
  }
  const [selectedRecordId] = [...totalsByRecord.entries()]
    .sort((left, right) => {
      const valueDiff = right[1] - left[1];
      if (valueDiff !== 0) return valueDiff;
      return left[0].localeCompare(right[0]);
    })
    .map(([recordId]) => recordId);
  if (!selectedRecordId) return null;

  const selectedRows = bucketedTraceRows
    .filter((row) => row.recordId === selectedRecordId)
    .sort((left, right) => left.step - right.step);
  if (!selectedRows.length) return null;

  const pathSegments: TracePathSegment[] = selectedRows.map((row) => ({
    step: row.step,
    sourceId: `${row.step}::${row.src}`,
    targetId: `${row.step + 1}::${row.dst}`,
    sourceLabel: row.src,
    targetLabel: row.dst,
    value: row.value,
  }));
  const totalValue = selectedRows.reduce((sum, row) => sum + row.value, 0);
  return { recordId: selectedRecordId, pathSegments, totalValue };
};

const getTraceOverlaySegments = async (params: {
  recordIds: string[];
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  pivot?: PivotConfig;
  topNByDimension?: Record<string, number>;
  traceKeyConfig: TraceKeyConfig;
  recordLimit?: number;
}): Promise<TraceOverlayResult> => {
  const requestedIds = params.recordIds
    .map((recordId) => String(recordId).trim())
    .filter(Boolean)
    .filter((recordId, index, all) => all.indexOf(recordId) === index);
  const recordLimit = Number.isFinite(params.recordLimit) ? Math.max(1, Math.min(200, Number(params.recordLimit))) : 80;
  const selectedRecordIds = requestedIds.slice(0, recordLimit);
  if (!selectedRecordIds.length) {
    return { selectedRecordIds: [], segments: [], truncated: requestedIds.length > 0 };
  }

  const bucketedTraceRows = await loadBucketedTraceRows(params);
  const allowedRecordIds = new Set(selectedRecordIds);
  const segments = bucketedTraceRows
    .filter((row) => allowedRecordIds.has(row.recordId))
    .sort((left, right) => {
      const recordDiff = left.recordId.localeCompare(right.recordId);
      if (recordDiff !== 0) return recordDiff;
      return left.step - right.step;
    })
    .map((row) => ({
      recordId: row.recordId,
      step: row.step,
      sourceId: `${row.step}::${row.src}`,
      targetId: `${row.step + 1}::${row.dst}`,
      sourceLabel: row.src,
      targetLabel: row.dst,
      value: row.value,
      colorIndex: Math.max(0, selectedRecordIds.indexOf(row.recordId)),
    }));

  return {
    selectedRecordIds,
    segments,
    truncated: requestedIds.length > selectedRecordIds.length,
  };
};

const handlers: Record<string, (params: unknown) => Promise<unknown>> = {
  init: async () => init(),
  importFile: async (params) =>
    importFile((params as { fileName: string; bytes: ArrayBuffer }).fileName, (params as { fileName: string; bytes: ArrayBuffer }).bytes),
  listColumns: async () => listColumnsInternal(),
  preview: async (params) => previewInternal((params as { limit?: number } | undefined)?.limit),
  profileColumns: async () => profileColumnsInternal(),
  computeSankey: async (params) =>
    computeSankey(
      params as {
        dims: string[];
        mode: ValueMode;
        amountCol?: string;
        pivot?: PivotConfig;
        topNByDimension?: Record<string, number>;
        sortOrder?: ColumnSortOrder;
        traceKeyConfig?: TraceKeyConfig;
        includeTrace?: boolean;
      },
    ),
  getTraceRecords: async (params) =>
    getTraceRecords(
      params as {
        selection: TraceSelection;
        dims: string[];
        mode: ValueMode;
        amountCol?: string;
        pivot?: PivotConfig;
        topNByDimension?: Record<string, number>;
        traceKeyConfig: TraceKeyConfig;
        limit?: number;
      },
    ),
  resolveSingleRecordPath: async (params) =>
    resolveSingleRecordPath(
      params as {
        selection: TraceSelection;
        dims: string[];
        mode: ValueMode;
        amountCol?: string;
        pivot?: PivotConfig;
        topNByDimension?: Record<string, number>;
        traceKeyConfig: TraceKeyConfig;
      },
    ),
  getTraceOverlaySegments: async (params) =>
    getTraceOverlaySegments(
      params as {
        recordIds: string[];
        dims: string[];
        mode: ValueMode;
        amountCol?: string;
        pivot?: PivotConfig;
        topNByDimension?: Record<string, number>;
        traceKeyConfig: TraceKeyConfig;
        recordLimit?: number;
      },
    ),
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const { id, method } = request;

  try {
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`Unknown worker method: ${method}`);
    }
    const result = await handler(request.params);
    const response: WorkerResponse = { id, ok: true, result: result as never };
    self.postMessage(response);
  } catch (error) {
    const message = toErrorMessage(error);
    const response: WorkerResponse = { id, ok: false, error: message };
    self.postMessage(response);
  }
};

export {};
