export type ValueMode = "sum" | "count";
export type AmountDataType = "number" | "usd_millions";
export type ColumnSortOrder = "largest_flow" | "alphabetical";

export interface PivotConfig {
  enabled: boolean;
  keyColumn: string;
  stageLabelColumn: string;
  stageValueColumn: string;
  usePivotKeyAsNodeLabel?: boolean;
}

export interface SankeyNode {
  id: string;
  label: string;
  depth: number;
}

export interface SankeyLink {
  step: number;
  source: string;
  target: string;
  value: number;
  traceCount?: number;
  sampleRecordIds?: string[];
}

export interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
  columnHeaders?: string[];
}

export type TraceKeyConfig =
  | {
      mode: "single";
      column: string;
    }
  | {
      mode: "composite";
      columns: string[];
    };

export type TraceSelection =
  | {
      kind: "link";
      step: number;
      sourceId: string;
      targetId: string;
      sourceLabel: string;
      targetLabel: string;
      value: number;
    }
  | {
      kind: "node";
      nodeId: string;
      depth: number;
      label: string;
    };

export interface TraceDrillRow {
  recordId: string;
  step: number;
  source: string;
  target: string;
  value: number;
}

export interface TracePathSegment {
  step: number;
  sourceId: string;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
  value: number;
}

export interface TraceOverlaySegment extends TracePathSegment {
  recordId: string;
  colorIndex: number;
}

export interface TraceOverlayResult {
  selectedRecordIds: string[];
  segments: TraceOverlaySegment[];
  truncated: boolean;
}

export interface TraceDrillResult {
  selection: TraceSelection;
  totalRecords: number;
  totalValue: number;
  rows: TraceDrillRow[];
  truncated: boolean;
  singleRecordMode?: boolean;
  selectedRecordId?: string;
  pathSegments?: TracePathSegment[];
}

export interface SankeyRenderOptions {
  nodeWidth: number;
  nodePadding: number;
  chartHeightRatio: number;
  labelGutterRatio: number;
  linkOpacity: number;
  labelFontSize: number;
}

export const DEFAULT_SANKEY_RENDER_OPTIONS: SankeyRenderOptions = {
  nodeWidth: 14,
  nodePadding: 14,
  chartHeightRatio: 0.74,
  labelGutterRatio: 0.125,
  linkOpacity: 0.35,
  labelFontSize: 11.5,
};

export interface ColumnInfo {
  name: string;
  type: string;
}

export interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ColumnProfile {
  columnName: string;
  distinctCount: number;
  nonBlankCount: number;
}
