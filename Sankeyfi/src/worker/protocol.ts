import type {
  ColumnInfo,
  ColumnProfile,
  ColumnSortOrder,
  PivotConfig,
  PreviewResult,
  SankeyGraph,
  TraceDrillResult,
  TraceKeyConfig,
  TraceOverlayResult,
  TracePathSegment,
  TraceSelection,
  ValueMode,
} from "../types";

export interface WorkerMethodMap {
  init: {
    params: undefined;
    result: { ready: boolean; persistence: "opfs" | "memory" };
  };
  importFile: {
    params: {
      fileName: string;
      bytes: ArrayBuffer;
    };
    result: {
      table: string;
      columns: ColumnInfo[];
      preview: PreviewResult;
      persistence: "opfs" | "memory";
    };
  };
  listColumns: {
    params: undefined;
    result: ColumnInfo[];
  };
  preview: {
    params: { limit?: number };
    result: PreviewResult;
  };
  profileColumns: {
    params: undefined;
    result: ColumnProfile[];
  };
  computeSankey: {
    params: {
      dims: string[];
      mode: ValueMode;
      amountCol?: string;
      pivot?: PivotConfig;
      topNByDimension?: Record<string, number>;
      sortOrder?: ColumnSortOrder;
      traceKeyConfig?: TraceKeyConfig;
      includeTrace?: boolean;
    };
    result: SankeyGraph;
  };
  getTraceRecords: {
    params: {
      selection: TraceSelection;
      dims: string[];
      mode: ValueMode;
      amountCol?: string;
      pivot?: PivotConfig;
      topNByDimension?: Record<string, number>;
      traceKeyConfig: TraceKeyConfig;
      limit?: number;
    };
    result: TraceDrillResult;
  };
  resolveSingleRecordPath: {
    params: {
      selection: TraceSelection;
      dims: string[];
      mode: ValueMode;
      amountCol?: string;
      pivot?: PivotConfig;
      topNByDimension?: Record<string, number>;
      traceKeyConfig: TraceKeyConfig;
    };
    result: {
      recordId: string;
      pathSegments: TracePathSegment[];
      totalValue: number;
    } | null;
  };
  getTraceOverlaySegments: {
    params: {
      recordIds: string[];
      dims: string[];
      mode: ValueMode;
      amountCol?: string;
      pivot?: PivotConfig;
      topNByDimension?: Record<string, number>;
      traceKeyConfig: TraceKeyConfig;
      recordLimit?: number;
    };
    result: TraceOverlayResult;
  };
}

export type WorkerMethod = keyof WorkerMethodMap;

export interface WorkerRequest<M extends WorkerMethod = WorkerMethod> {
  id: string;
  method: M;
  params: WorkerMethodMap[M]["params"];
}

export interface WorkerSuccessResponse<M extends WorkerMethod = WorkerMethod> {
  id: string;
  ok: true;
  result: WorkerMethodMap[M]["result"];
}

export interface WorkerErrorResponse {
  id: string;
  ok: false;
  error: string;
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;
