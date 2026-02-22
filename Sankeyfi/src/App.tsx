import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { DimensionManager } from "./components/DimensionManager";
import { FlowDrillPanel } from "./components/FlowDrillPanel";
import { SankeyChart } from "./components/SankeyChart";
import { StatusFeed } from "./components/StatusFeed";
import { SheetPicker } from "./components/SheetPicker";
import { isDelimitedTextFile, runCsvPrecheck } from "./features/import/csvPrecheck";
import { isExcelFile, parseXlsxFile, sheetToCsvBytes, type XlsxParseResult } from "./features/import/xlsxPreprocess";
import { DuckDBWorkerClient } from "./services/duckdbClient";
import type {
  AmountDataType,
  ColumnInfo,
  ColumnProfile,
  ColumnSortOrder,
  PivotConfig,
  PreviewResult,
  SankeyGraph,
  SankeyRenderOptions,
  TraceDrillResult,
  TraceKeyConfig,
  TraceOverlaySegment,
  TracePathSegment,
  TraceSelection,
  ValueMode,
} from "./types";
import { DEFAULT_SANKEY_RENDER_OPTIONS } from "./types";

const LARGE_FILE_NOTICE_BYTES = 75 * 1024 * 1024;
const INIT_TIMEOUT_MS = 90_000;
const MAX_STATUS_ENTRIES = 8;
const DEFAULT_TOP_N = 20;
const OTHER_LABEL = "Other";
const MAX_VALUE_PREVIEW = 6;
const OVERLAY_RECORD_LIMIT = 80;
const NUMERIC_TYPE_REGEX = /int|double|float|decimal|real|numeric|bigint|smallint|tinyint|hugeint/i;
const NUMERIC_VALUE_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const formatOptionValue = (value: number, decimals = 0): string => (decimals > 0 ? value.toFixed(decimals) : String(Math.round(value)));

const formatMegabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const normalizeTopN = (value: number): number => (Number.isInteger(value) && value >= 1 ? value : DEFAULT_TOP_N);
const buildTopNMap = (dimensions: string[], current?: Record<string, number>): Record<string, number> =>
  Object.fromEntries(dimensions.map((dimension) => [dimension, normalizeTopN(current?.[dimension] ?? DEFAULT_TOP_N)]));
const toPreviewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "(blank)";
  return String(value);
};
const isLikelyNumeric = (column: ColumnInfo, preview: PreviewResult | null): boolean => {
  if (NUMERIC_TYPE_REGEX.test(column.type)) return true;
  if (!preview?.rows.length) return false;

  const sampleValues: string[] = [];
  for (const row of preview.rows) {
    const candidate = toPreviewValue(row[column.name]);
    if (sampleValues.includes(candidate)) continue;
    sampleValues.push(candidate);
    if (sampleValues.length >= MAX_VALUE_PREVIEW) break;
  }

  const candidates = sampleValues.filter((value) => value !== "(blank)");
  if (!candidates.length) return false;
  const numericLikeCount = candidates.filter((value) => NUMERIC_VALUE_REGEX.test(value.trim())).length;
  return numericLikeCount / candidates.length >= 0.75;
};
const pickDefaultDimensions = (columns: ColumnInfo[], preview: PreviewResult, profiles: ColumnProfile[]): string[] => {
  const profileByName = new Map(profiles.map((profile) => [profile.columnName, profile]));
  const qualified = columns
    .map((column, index) => ({
      column,
      profile: profileByName.get(column.name),
      index,
    }))
    .filter(({ column, profile }) => {
      if (!profile) return false;
      if (isLikelyNumeric(column, preview)) return false;
      return profile.distinctCount > 2 && profile.distinctCount < 100;
    })
    .sort((left, right) => {
      const nonBlankDiff = right.profile!.nonBlankCount - left.profile!.nonBlankCount;
      if (nonBlankDiff !== 0) return nonBlankDiff;
      const distinctDiff = right.profile!.distinctCount - left.profile!.distinctCount;
      if (distinctDiff !== 0) return distinctDiff;
      return left.index - right.index;
    });

  const selected = qualified.slice(0, 3).map(({ column }) => column.name);
  if (selected.length >= 3) return selected;

  const selectedSet = new Set(selected);
  const fallback = columns
    .map((column) => column.name)
    .filter((name) => !selectedSet.has(name))
    .slice(0, 3 - selected.length);
  return [...selected, ...fallback];
};

function App() {
  const client = useMemo(() => new DuckDBWorkerClient(), []);
  const [statusEntries, setStatusEntries] = useState<string[]>(["Booting data engine..."]);
  const [isBusy, setIsBusy] = useState(false);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [dims, setDims] = useState<string[]>([]);
  const [topNByDimension, setTopNByDimension] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<ValueMode>("count");
  const [amountCol, setAmountCol] = useState("");
  const [amountDataType, setAmountDataType] = useState<AmountDataType>("number");
  const [sortOrder, setSortOrder] = useState<ColumnSortOrder>("largest_flow");
  const [pivotEnabled, setPivotEnabled] = useState(false);
  const [pivotKeyColumn, setPivotKeyColumn] = useState("");
  const [pivotStageLabelColumn, setPivotStageLabelColumn] = useState("");
  const [pivotStageValueColumn, setPivotStageValueColumn] = useState("");
  const [pivotUseKeyAsNodeLabel, setPivotUseKeyAsNodeLabel] = useState(false);
  const [graph, setGraph] = useState<SankeyGraph | null>(null);
  const [graphRevision, setGraphRevision] = useState(0);
  const [showOtherValues, setShowOtherValues] = useState(true);
  const [renderOptions, setRenderOptions] = useState<SankeyRenderOptions>(DEFAULT_SANKEY_RENDER_OPTIONS);
  const [persistence, setPersistence] = useState<"opfs" | "memory">("memory");
  const [traceMode, setTraceMode] = useState<"single" | "composite">("single");
  const [traceIdColumn, setTraceIdColumn] = useState("");
  const [traceCompositeColumns, setTraceCompositeColumns] = useState<string[]>([]);
  const [activeTraceSelection, setActiveTraceSelection] = useState<TraceSelection | null>(null);
  const [traceResult, setTraceResult] = useState<TraceDrillResult | null>(null);
  const [singleRecordTrace, setSingleRecordTrace] = useState<{ recordId: string; pathSegments: TracePathSegment[]; totalValue: number } | null>(
    null,
  );
  const [overlayRecordIds, setOverlayRecordIds] = useState<string[]>([]);
  const [overlaySegments, setOverlaySegments] = useState<TraceOverlaySegment[]>([]);
  const [overlaySelectionTruncated, setOverlaySelectionTruncated] = useState(false);
  const [isTraceLoading, setIsTraceLoading] = useState(false);
  const [pendingXlsx, setPendingXlsx] = useState<{ fileName: string; parsed: XlsxParseResult } | null>(null);
  const pushStatus = useCallback((message: string) => {
    setStatusEntries((current) => [...current.slice(-(MAX_STATUS_ENTRIES - 1)), message]);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const setup = async () => {
      let slowStartTimer: number | null = null;
      try {
        slowStartTimer = window.setTimeout(() => {
          if (isMounted) {
            pushStatus("Data engine is still starting (large WASM load). Please wait...");
          }
        }, 10_000);
        const initResult = await Promise.race([
          client.call("init", undefined),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Initialization timed out. Reload and try again.")), INIT_TIMEOUT_MS);
          }),
        ]);
        if (!isMounted) return;
        setPersistence(initResult.persistence);
        if (initResult.persistence === "memory") {
          pushStatus("Persistent storage unavailable in this session; using in-memory mode.");
        }
        pushStatus("Ready. Import a CSV, Parquet, or Excel file to begin.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Initialization failed.";
        if (isMounted) pushStatus(message);
      } finally {
        if (slowStartTimer !== null) {
          window.clearTimeout(slowStartTimer);
        }
      }
    };

    void setup();
    return () => {
      isMounted = false;
      client.terminate();
    };
  }, [client, pushStatus]);

  useEffect(() => {
    if (!columns.length) return;
    setTraceIdColumn((current) => (current && columns.some((column) => column.name === current) ? current : columns[0]!.name));
    setTraceCompositeColumns((current) => {
      const filtered = current.filter((name) => columns.some((column) => column.name === name));
      if (filtered.length) return filtered;
      return columns.slice(0, Math.min(2, columns.length)).map((column) => column.name);
    });
  }, [columns]);

  const applyImportResult = async (resultColumns: ColumnInfo[], resultPreview: PreviewResult) => {
    setColumns(resultColumns);
    setPreview(resultPreview);
    let initialDims = resultColumns.slice(0, 3).map((column) => column.name);
    try {
      const profiles = await client.call("profileColumns", undefined);
      initialDims = pickDefaultDimensions(resultColumns, resultPreview, profiles);
    } catch (error) {
      console.warn("Column profiling failed. Falling back to first columns.", error);
      pushStatus("Could not profile columns for smart defaults; using the first dimensions.");
    }
    setDims(initialDims);
    setTopNByDimension(buildTopNMap(initialDims));
    const firstNumeric = resultColumns.find((column) => /int|double|float|decimal|real|numeric/i.test(column.type));
    setAmountCol(firstNumeric?.name ?? resultColumns[0]?.name ?? "");
    setPivotKeyColumn(resultColumns[0]?.name ?? "");
    setPivotStageLabelColumn(resultColumns[1]?.name ?? resultColumns[0]?.name ?? "");
    setPivotStageValueColumn(resultColumns[2]?.name ?? resultColumns[0]?.name ?? "");
    setTraceIdColumn(resultColumns[0]?.name ?? "");
    setTraceCompositeColumns(resultColumns.slice(0, Math.min(2, resultColumns.length)).map((column) => column.name));
    pushStatus("Data imported. Configure dimensions and run Sankey.");
  };

  const importCsvBytes = async (
    fileName: string,
    bytes: ArrayBuffer,
    activePersistence: "opfs" | "memory",
  ): Promise<{ columns: ColumnInfo[]; preview: PreviewResult; persistence: "opfs" | "memory" }> => {
    const startImportAt = performance.now();
    pushStatus(`Importing ${fileName} into DuckDB...`);
    const result = await client.call("importFile", { fileName, bytes });
    if (result.persistence !== activePersistence) {
      setPersistence(result.persistence);
      if (result.persistence === "memory") {
        pushStatus("Persistent storage became unavailable; using in-memory mode for this session.");
      } else {
        pushStatus("Persistent storage recovered. Continuing in OPFS mode.");
      }
    }
    const importDurationMs = Math.round(performance.now() - startImportAt);
    console.info(`[import] Imported ${fileName} in ${importDurationMs}ms.`);
    return { columns: result.columns, preview: result.preview, persistence: result.persistence };
  };

  const importXlsxSheet = async (fileName: string, parsed: XlsxParseResult, sheetName: string) => {
    setIsBusy(true);
    setPendingXlsx(null);
    try {
      pushStatus(`Converting sheet "${sheetName}" from ${fileName} to CSV...`);
      const csvBytes = sheetToCsvBytes(parsed.workbook, sheetName);
      const csvFileName = fileName.replace(/\.xlsx?$/i, "") + `_${sheetName}.csv`;
      const { columns: resultColumns, preview: resultPreview } = await importCsvBytes(
        csvFileName,
        csvBytes.buffer as ArrayBuffer,
        persistence,
      );
      await applyImportResult(resultColumns, resultPreview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Excel import failed.";
      pushStatus(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSheetSelect = (sheetName: string) => {
    if (!pendingXlsx) return;
    void importXlsxSheet(pendingXlsx.fileName, pendingXlsx.parsed, sheetName);
  };

  const handleSheetCancel = () => {
    setPendingXlsx(null);
    pushStatus("Excel import cancelled.");
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;

    setIsBusy(true);
    setGraph(null);
    setGraphRevision((current) => current + 1);
    setActiveTraceSelection(null);
    setTraceResult(null);
    setSingleRecordTrace(null);
    setOverlayRecordIds([]);
    setOverlaySegments([]);
    setOverlaySelectionTruncated(false);
    setPendingXlsx(null);

    try {
      let latestColumns: ColumnInfo[] = [];
      let latestPreview: PreviewResult | null = null;
      let importedFileCount = 0;
      let activePersistence = persistence;
      const fileList = Array.from(files);
      const hasLargeFile = fileList.some((file) => file.size >= LARGE_FILE_NOTICE_BYTES);

      if (hasLargeFile) {
        pushStatus("Large file detected. Import may take a while on first run.");
      }

      // Import files sequentially so users can drop multiple files during setup;
      // latest import becomes the active analysis table for this first milestone.
      for (const [index, file] of fileList.entries()) {
        const position = `${index + 1}/${fileList.length}`;

        if (isExcelFile(file.name)) {
          pushStatus(`Parsing Excel file ${position}: ${file.name}...`);
          const parsed = await parseXlsxFile(file);
          if (parsed.sheetNames.length === 0) {
            pushStatus(`${file.name} contains no sheets. Skipped.`);
            continue;
          }
          if (parsed.sheetNames.length === 1) {
            pushStatus(`Single sheet "${parsed.sheetNames[0]}" found. Importing...`);
            const csvBytes = sheetToCsvBytes(parsed.workbook, parsed.sheetNames[0]);
            const csvFileName = file.name.replace(/\.xlsx?$/i, "") + `.csv`;
            const imported = await importCsvBytes(csvFileName, csvBytes.buffer as ArrayBuffer, activePersistence);
            activePersistence = imported.persistence;
            latestColumns = imported.columns;
            latestPreview = imported.preview;
            importedFileCount += 1;
            continue;
          }
          // Multiple sheets: pause and let the user pick.
          setPendingXlsx({ fileName: file.name, parsed });
          pushStatus(`${file.name} has ${parsed.sheetNames.length} sheets. Select one to import.`);
          setIsBusy(false);
          return;
        }

        if (isDelimitedTextFile(file.name)) {
          pushStatus(`Running pre-check for ${position}: ${file.name}...`);
          const precheck = await runCsvPrecheck(file);
          if (precheck) {
            pushStatus(`${file.name}: ${precheck.summary}`);
            precheck.issues
              .filter((issue) => issue.severity !== "info")
              .slice(0, 2)
              .forEach((issue) => {
                pushStatus(`${file.name}: ${issue.message}`);
              });
            if (!precheck.canImport) {
              pushStatus(`Skipped ${file.name}. Fix pre-check errors and retry.`);
              continue;
            }
          }
        }

        const startReadAt = performance.now();
        pushStatus(`Reading file ${position}: ${file.name} (${formatMegabytes(file.size)})...`);
        const bytes = await file.arrayBuffer();
        const readDurationMs = Math.round(performance.now() - startReadAt);
        console.info(`[import] Read ${file.name} (${formatMegabytes(file.size)}) in ${readDurationMs}ms.`);

        const imported = await importCsvBytes(file.name, bytes, activePersistence);
        activePersistence = imported.persistence;
        latestColumns = imported.columns;
        latestPreview = imported.preview;
        importedFileCount += 1;
      }

      if (!importedFileCount || !latestColumns.length || !latestPreview) {
        pushStatus("No files were imported. Resolve pre-check issues and try again.");
        return;
      }

      await applyImportResult(latestColumns, latestPreview);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import failed.";
      pushStatus(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectedDimensionsChange = useCallback((nextDimensions: string[]) => {
    setDims(nextDimensions);
    setTopNByDimension((current) => buildTopNMap(nextDimensions, current));
  }, []);

  const handleTopNChange = useCallback((dimension: string, nextTopN: number) => {
    setTopNByDimension((current) => ({
      ...current,
      [dimension]: normalizeTopN(nextTopN),
    }));
  }, []);

  const updateRenderOption = useCallback(
    <K extends keyof SankeyRenderOptions>(key: K, rawValue: number, min: number, max: number, decimals = 0) => {
      const normalized = decimals > 0 ? Number(clamp(rawValue, min, max).toFixed(decimals)) : Math.round(clamp(rawValue, min, max));
      setRenderOptions((current) => ({
        ...current,
        [key]: Number.isFinite(normalized) ? normalized : current[key],
      }));
    },
    [],
  );

  const traceKeyConfig = useMemo<TraceKeyConfig | null>(() => {
    if (traceMode === "single") {
      const column = traceIdColumn || columns[0]?.name || "";
      return column ? { mode: "single", column } : null;
    }
    const selected = traceCompositeColumns.filter((column, index, array) => column && array.indexOf(column) === index);
    return selected.length ? { mode: "composite", columns: selected } : null;
  }, [columns, traceCompositeColumns, traceIdColumn, traceMode]);

  const runSankey = async () => {
    if (!pivotEnabled && dims.length < 2) {
      pushStatus("Choose at least two dimensions to build a Sankey diagram.");
      return;
    }

    if (mode === "sum" && !amountCol) {
      pushStatus("Choose a numeric amount column for SUM mode.");
      return;
    }
    if (!traceKeyConfig) {
      pushStatus("Choose a trace key so Sankey flows can be drilled into source records.");
      return;
    }

    if (pivotEnabled) {
      if (!pivotKeyColumn || !pivotStageLabelColumn) {
        pushStatus("Choose key and stage label columns for Pivot mode.");
        return;
      }
      if (!pivotUseKeyAsNodeLabel && !pivotStageValueColumn) {
        pushStatus("Choose a stage value column for Pivot mode.");
        return;
      }
      const chosen = pivotUseKeyAsNodeLabel
        ? [pivotKeyColumn, pivotStageLabelColumn]
        : [pivotKeyColumn, pivotStageLabelColumn, pivotStageValueColumn];
      if (new Set(chosen).size !== chosen.length) {
        pushStatus(
          pivotUseKeyAsNodeLabel
            ? "Pivot mode needs different columns for key and stage label."
            : "Pivot mode needs three different columns: key, stage label, and stage value.",
        );
        return;
      }
    }

    setIsBusy(true);
    pushStatus("Computing Sankey links...");

    try {
      const requestedTopNByDimension = buildTopNMap(dims, topNByDimension);
      const pivotConfig: PivotConfig | undefined = pivotEnabled
        ? {
            enabled: true,
            keyColumn: pivotKeyColumn,
            stageLabelColumn: pivotStageLabelColumn,
            stageValueColumn: pivotStageValueColumn,
            usePivotKeyAsNodeLabel: pivotUseKeyAsNodeLabel,
          }
        : undefined;
      const result = await client.call("computeSankey", {
        dims: pivotEnabled ? [] : dims,
        mode,
        amountCol,
        pivot: pivotConfig,
        topNByDimension: requestedTopNByDimension,
        sortOrder,
        traceKeyConfig,
        includeTrace: true,
      });
      setGraph(result);
      setGraphRevision((current) => current + 1);
      setActiveTraceSelection(null);
      setTraceResult(null);
      setSingleRecordTrace(null);
      setOverlayRecordIds([]);
      setOverlaySegments([]);
      setOverlaySelectionTruncated(false);
      pushStatus(`Sankey ready: ${result.nodes.length} nodes, ${result.links.length} links.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to compute Sankey.";
      pushStatus(message);
    } finally {
      setIsBusy(false);
    }
  };

  const visibleGraph = useMemo<SankeyGraph | null>(() => {
    if (!graph || showOtherValues) {
      return graph;
    }

    const visibleNodes = graph.nodes.filter((node) => node.label !== OTHER_LABEL);
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const filteredLinks = graph.links.filter((link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target));
    const connectedNodeIds = new Set(filteredLinks.flatMap((link) => [link.source, link.target]));
    const filteredNodes = visibleNodes.filter((node) => connectedNodeIds.has(node.id));

    return {
      nodes: filteredNodes,
      links: filteredLinks,
      columnHeaders: graph.columnHeaders,
    };
  }, [graph, showOtherValues]);

  useEffect(() => {
    if (!activeTraceSelection) {
      setSingleRecordTrace(null);
    }
  }, [activeTraceSelection]);

  const displayTraceResult = useMemo<TraceDrillResult | null>(() => {
    if (!traceResult) return null;
    if (!singleRecordTrace) return traceResult;
    const filteredRows = traceResult.rows.filter((row) => row.recordId === singleRecordTrace.recordId);
    return {
      ...traceResult,
      singleRecordMode: true,
      selectedRecordId: singleRecordTrace.recordId,
      pathSegments: singleRecordTrace.pathSegments,
      totalRecords: 1,
      totalValue: singleRecordTrace.totalValue,
      rows: filteredRows.length ? filteredRows : traceResult.rows,
      truncated: false,
    };
  }, [singleRecordTrace, traceResult]);

  useEffect(() => {
    if (!graph || !traceKeyConfig || !overlayRecordIds.length) {
      setOverlaySegments([]);
      setOverlaySelectionTruncated(false);
      return;
    }
    let isCancelled = false;
    const loadOverlaySegments = async () => {
      try {
        const pivotConfig: PivotConfig | undefined = pivotEnabled
          ? {
              enabled: true,
              keyColumn: pivotKeyColumn,
              stageLabelColumn: pivotStageLabelColumn,
              stageValueColumn: pivotStageValueColumn,
              usePivotKeyAsNodeLabel: pivotUseKeyAsNodeLabel,
            }
          : undefined;
        const overlay = await client.call("getTraceOverlaySegments", {
          recordIds: overlayRecordIds,
          dims: pivotEnabled ? [] : dims,
          mode,
          amountCol,
          pivot: pivotConfig,
          topNByDimension: buildTopNMap(dims, topNByDimension),
          traceKeyConfig,
          recordLimit: OVERLAY_RECORD_LIMIT,
        });
        if (!isCancelled) {
          setOverlaySegments(overlay.segments);
          setOverlaySelectionTruncated(overlay.truncated);
        }
      } catch (error) {
        if (!isCancelled) {
          setOverlaySegments([]);
          setOverlaySelectionTruncated(false);
          pushStatus(error instanceof Error ? error.message : "Failed to load overlay segments.");
        }
      }
    };
    void loadOverlaySegments();
    return () => {
      isCancelled = true;
    };
  }, [
    amountCol,
    client,
    dims,
    graph,
    mode,
    overlayRecordIds,
    pivotEnabled,
    pivotKeyColumn,
    pivotStageLabelColumn,
    pivotStageValueColumn,
    pivotUseKeyAsNodeLabel,
    pushStatus,
    topNByDimension,
    traceKeyConfig,
  ]);

  useEffect(() => {
    if (!graph || !activeTraceSelection || !traceKeyConfig) {
      setTraceResult(null);
      setIsTraceLoading(false);
      return;
    }

    let isCancelled = false;
    const loadTrace = async () => {
      setIsTraceLoading(true);
      try {
        const pivotConfig: PivotConfig | undefined = pivotEnabled
          ? {
              enabled: true,
              keyColumn: pivotKeyColumn,
              stageLabelColumn: pivotStageLabelColumn,
              stageValueColumn: pivotStageValueColumn,
              usePivotKeyAsNodeLabel: pivotUseKeyAsNodeLabel,
            }
          : undefined;
        const result = await client.call("getTraceRecords", {
          selection: activeTraceSelection,
          dims: pivotEnabled ? [] : dims,
          mode,
          amountCol,
          pivot: pivotConfig,
          topNByDimension: buildTopNMap(dims, topNByDimension),
          traceKeyConfig,
          limit: 250,
        });
        if (!isCancelled) {
          setTraceResult(result);
        }
      } catch (error) {
        if (!isCancelled) {
          setTraceResult(null);
          pushStatus(error instanceof Error ? error.message : "Failed to load trace records.");
        }
      } finally {
        if (!isCancelled) {
          setIsTraceLoading(false);
        }
      }
    };

    void loadTrace();
    return () => {
      isCancelled = true;
    };
  }, [
    activeTraceSelection,
    amountCol,
    client,
    dims,
    graph,
    mode,
    pivotEnabled,
    pivotKeyColumn,
    pivotStageLabelColumn,
    pivotStageValueColumn,
    pivotUseKeyAsNodeLabel,
    pushStatus,
    topNByDimension,
    traceKeyConfig,
  ]);

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>Sankeyfi</h1>
          <p>Fast, in-browser Sankey builder powered by DuckDB-Wasm.</p>
        </div>
        <span className={`pill ${persistence === "opfs" ? "pill-ok" : "pill-warn"}`}>
          Persistence: {persistence.toUpperCase()}
        </span>
      </header>

      <section className="panel">
        <h2>Import</h2>
        <input
          className="file-input"
          type="file"
          accept=".csv,.tsv,.txt,.parquet,.pq,.xlsx,.xls"
          multiple
          onChange={(e) => void importFiles(e.target.files)}
        />
        <p className="hint">Drop one or more files (CSV, Parquet, or Excel). The latest import becomes the active dataset.</p>
        {pendingXlsx && (
          <SheetPicker
            fileName={pendingXlsx.fileName}
            sheetNames={pendingXlsx.parsed.sheetNames}
            onSelect={handleSheetSelect}
            onCancel={handleSheetCancel}
          />
        )}
      </section>

      <section className="panel">
        <div className="diagram-header">
          <h2>Diagram</h2>
        </div>
        <div className="diagram-toolbar">
          <div className="diagram-toolbar-top">
            <label className="control-chip">
              <input type="checkbox" checked={showOtherValues} onChange={(event) => setShowOtherValues(event.target.checked)} />
              Show "Other" values
            </label>
            <div className="diagram-toolbar-actions">
              <label className="values-field diagram-sorter">
                <span>Column sort order</span>
                <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as ColumnSortOrder)}>
                  <option value="largest_flow">Largest total flow first</option>
                  <option value="alphabetical">Alphabetical</option>
                </select>
              </label>
              <button className="secondary-button" type="button" onClick={() => setRenderOptions(DEFAULT_SANKEY_RENDER_OPTIONS)}>
                Revert to defaults
              </button>
              <button className="primary-button" disabled={isBusy} onClick={() => void runSankey()}>
                {isBusy ? "Working..." : "Run Sankey"}
              </button>
            </div>
          </div>
          <div className="diagram-options-grid">
            <label className="values-field diagram-option-field">
              <div className="diagram-option-head">
                <span>Node width</span>
                <strong>{formatOptionValue(renderOptions.nodeWidth)}</strong>
              </div>
              <input
                className="diagram-slider"
                type="range"
                min={6}
                max={40}
                step={1}
                value={renderOptions.nodeWidth}
                onChange={(event) => updateRenderOption("nodeWidth", Number(event.target.value), 6, 40)}
              />
            </label>
            <label className="values-field diagram-option-field">
              <div className="diagram-option-head">
                <span>Node padding</span>
                <strong>{formatOptionValue(renderOptions.nodePadding)}</strong>
              </div>
              <input
                className="diagram-slider"
                type="range"
                min={4}
                max={44}
                step={1}
                value={renderOptions.nodePadding}
                onChange={(event) => updateRenderOption("nodePadding", Number(event.target.value), 4, 44)}
              />
            </label>
            <label className="values-field diagram-option-field">
              <div className="diagram-option-head">
                <span>Height ratio</span>
                <strong>{formatOptionValue(renderOptions.chartHeightRatio, 2)}</strong>
              </div>
              <input
                className="diagram-slider"
                type="range"
                min={0.35}
                max={0.9}
                step={0.01}
                value={renderOptions.chartHeightRatio}
                onChange={(event) => updateRenderOption("chartHeightRatio", Number(event.target.value), 0.35, 0.9, 2)}
              />
            </label>
            <label className="values-field diagram-option-field">
              <div className="diagram-option-head">
                <span>Label gutter ratio</span>
                <strong>{formatOptionValue(renderOptions.labelGutterRatio, 2)}</strong>
              </div>
              <input
                className="diagram-slider"
                type="range"
                min={0.08}
                max={0.22}
                step={0.01}
                value={renderOptions.labelGutterRatio}
                onChange={(event) => updateRenderOption("labelGutterRatio", Number(event.target.value), 0.08, 0.22, 2)}
              />
            </label>
            <label className="values-field diagram-option-field">
              <div className="diagram-option-head">
                <span>Link opacity</span>
                <strong>{formatOptionValue(renderOptions.linkOpacity, 2)}</strong>
              </div>
              <input
                className="diagram-slider"
                type="range"
                min={0.08}
                max={1}
                step={0.01}
                value={renderOptions.linkOpacity}
                onChange={(event) => updateRenderOption("linkOpacity", Number(event.target.value), 0.08, 1, 2)}
              />
            </label>
            <label className="values-field diagram-option-field">
              <div className="diagram-option-head">
                <span>Label font size</span>
                <strong>{formatOptionValue(renderOptions.labelFontSize, 1)}</strong>
              </div>
              <input
                className="diagram-slider"
                type="range"
                min={9}
                max={18}
                step={0.5}
                value={renderOptions.labelFontSize}
                onChange={(event) => updateRenderOption("labelFontSize", Number(event.target.value), 9, 18, 1)}
              />
            </label>
          </div>
        </div>
        <SankeyChart
          key={`sankey-${graphRevision}`}
          graph={visibleGraph}
          columnHeaders={visibleGraph?.columnHeaders ?? []}
          renderOptions={renderOptions}
          valueMode={mode}
          amountDataType={amountDataType}
          highlightedPathSegments={singleRecordTrace?.pathSegments ?? null}
          overlaySegments={overlaySegments}
          onTraceSelectionChange={(selection) => {
            setActiveTraceSelection(selection);
            setSingleRecordTrace(null);
            if (!selection) {
              setOverlayRecordIds([]);
            }
          }}
        />
      </section>

      <FlowDrillPanel
        result={displayTraceResult}
        isLoading={isTraceLoading}
        valueMode={mode}
        amountDataType={amountDataType}
        overlayRecordIds={overlayRecordIds}
        overlaySelectionTruncated={overlaySelectionTruncated}
        overlayRecordLimit={OVERLAY_RECORD_LIMIT}
        onApplyOverlay={(recordIds: string[]) => setOverlayRecordIds(recordIds)}
        onClear={() => {
          setActiveTraceSelection(null);
          setSingleRecordTrace(null);
          setOverlayRecordIds([]);
        }}
      />

      <section className="panel">
        <h2>Dimensions</h2>
        <DimensionManager
          columns={columns}
          preview={preview}
          selectedDimensions={dims}
          topNByDimension={topNByDimension}
          onSelectedDimensionsChange={handleSelectedDimensionsChange}
          onTopNChange={handleTopNChange}
        />
      </section>

      <section className="panel">
        <h2>Values</h2>
        <p className="hint">Choose how link values are calculated and how stages should be interpreted.</p>
        <div className="values-layout">
          <div className="values-section">
            <h3>1) Value Calculation</h3>
            <p className="hint values-subhint">Use row counts or sum a numeric amount column.</p>
            <div className="controls-row">
              <label className="control-chip">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "count"}
                  onChange={() => setMode("count")}
                />
                Count rows
              </label>
              <label className="control-chip">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "sum"}
                  onChange={() => setMode("sum")}
                />
                Sum column
              </label>
            </div>
            <label className="values-field">
              <span>Amount column (for SUM mode)</span>
              <select value={amountCol} onChange={(e) => setAmountCol(e.target.value)} disabled={mode !== "sum"}>
                <option value="">Choose amount column...</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="values-field">
              <span>Amount data type (for SUM mode)</span>
              <select value={amountDataType} onChange={(e) => setAmountDataType(e.target.value as AmountDataType)} disabled={mode !== "sum"}>
                <option value="number">Number (default)</option>
                <option value="usd_millions">USD (rounded to millions)</option>
              </select>
            </label>
          </div>

          <div className="values-section">
            <div className="values-section-header">
              <h3>2) Data Interpretation</h3>
              <label className="control-chip">
                <input type="checkbox" checked={pivotEnabled} onChange={(event) => setPivotEnabled(event.target.checked)} />
                Pivot mode
              </label>
            </div>
            {!pivotEnabled ? (
              <p className="hint values-subhint">
                Standard mode reads selected dimensions as already-columnar stages.
              </p>
            ) : (
              <p className="hint values-subhint">
                Pivot mode converts multiple rows per entity into stage-to-stage flow (ordered by stage label).
              </p>
            )}
            {pivotEnabled && (
              <>
                <div className="values-grid">
                  <label className="values-field">
                    <span>Pivot key column (entity ID)</span>
                    <select value={pivotKeyColumn} onChange={(event) => setPivotKeyColumn(event.target.value)}>
                      <option value="">Choose pivot key column...</option>
                      {columns.map((column) => (
                        <option key={`pivot-key-${column.name}`} value={column.name}>
                          {column.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="values-field">
                    <span>Stage label column</span>
                    <select value={pivotStageLabelColumn} onChange={(event) => setPivotStageLabelColumn(event.target.value)}>
                      <option value="">Choose stage label column...</option>
                      {columns.map((column) => (
                        <option key={`pivot-stage-label-${column.name}`} value={column.name}>
                          {column.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!pivotUseKeyAsNodeLabel && (
                    <label className="values-field">
                      <span>Stage value column</span>
                      <select value={pivotStageValueColumn} onChange={(event) => setPivotStageValueColumn(event.target.value)}>
                        <option value="">Choose stage value column...</option>
                        {columns.map((column) => (
                          <option key={`pivot-stage-value-${column.name}`} value={column.name}>
                            {column.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <label className="control-chip">
                  <input
                    type="checkbox"
                    checked={pivotUseKeyAsNodeLabel}
                    onChange={(event) => setPivotUseKeyAsNodeLabel(event.target.checked)}
                  />
                  Use pivot key as node label
                </label>
                <p className="hint values-subhint">
                  Pivot key links rows for each entity. When enabled, node labels use the pivot key; otherwise they use stage
                  value. Line thickness always comes from Count/Sum.
                </p>
              </>
            )}
          </div>

          <div className="values-section values-section-compact">
            <h3>3) Traceability Key</h3>
            <p className="hint values-subhint">Choose how each record is uniquely identified for flow drill-down.</p>
            <div className="controls-row">
              <label className="control-chip">
                <input type="radio" name="trace-mode" checked={traceMode === "single"} onChange={() => setTraceMode("single")} />
                Single ID column
              </label>
              <label className="control-chip">
                <input
                  type="radio"
                  name="trace-mode"
                  checked={traceMode === "composite"}
                  onChange={() => setTraceMode("composite")}
                />
                Composite key
              </label>
            </div>
            {traceMode === "single" ? (
              <label className="values-field">
                <span>Record ID column</span>
                <select value={traceIdColumn} onChange={(event) => setTraceIdColumn(event.target.value)}>
                  {columns.map((column) => (
                    <option key={`trace-single-${column.name}`} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="values-field">
                <span>Composite key columns</span>
                <select
                  multiple
                  className="trace-multiselect"
                  value={traceCompositeColumns}
                  onChange={(event) =>
                    setTraceCompositeColumns(Array.from(event.target.selectedOptions).map((option) => option.value))
                  }
                >
                  {columns.map((column) => (
                    <option key={`trace-multi-${column.name}`} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

        </div>
        <div className="values-actions">
          <button className="primary-button" disabled={isBusy} onClick={() => void runSankey()}>
            {isBusy ? "Working..." : "Run Sankey"}
          </button>
        </div>
      </section>

      {preview && (
        <section className="panel">
          <h2>Preview</h2>
          <div className="table-scroll preview-table">
            <table className="data-table">
              <thead>
                <tr>
                  {preview.columns.map((column) => (
                    <th key={column}>
                      <span className="cell-truncate" title={column}>
                        {column}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, index) => (
                  <tr key={`preview-row-${index}`}>
                    {preview.columns.map((column) => (
                      <td key={`${index}-${column}`}>
                        <span className="cell-truncate" title={String(row[column] ?? "")}>
                          {String(row[column] ?? "")}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <StatusFeed entries={statusEntries} />
    </main>
  );
}

export default App;
