import type { AmountDataType, TraceDrillResult, ValueMode } from "../types";
import { formatFlowValue } from "../valueFormatting";

interface FlowDrillPanelProps {
  result: TraceDrillResult | null;
  isLoading: boolean;
  valueMode: ValueMode;
  amountDataType: AmountDataType;
  overlayRecordIds: string[];
  overlaySelectionTruncated: boolean;
  overlayRecordLimit: number;
  onApplyOverlay: (recordIds: string[]) => void;
  onClear: () => void;
}

const formatSelection = (result: TraceDrillResult): string => {
  if (result.selection.kind === "link") {
    return `${result.selection.sourceLabel} → ${result.selection.targetLabel}`;
  }
  return `${result.selection.label}`;
};

export const FlowDrillPanel = ({
  result,
  isLoading,
  valueMode,
  amountDataType,
  overlayRecordIds,
  overlaySelectionTruncated,
  overlayRecordLimit,
  onApplyOverlay,
  onClear,
}: FlowDrillPanelProps) => {
  if (!result && !isLoading) {
    return (
      <section className="panel">
        <h2>Trace Drill-Down</h2>
        <p className="hint">Click a flow or node label in the chart to inspect contributing records.</p>
      </section>
    );
  }

  const valueLabel = valueMode === "sum" ? "Total value" : "Total rows";
  const selectableIds = result ? [...new Set(result.rows.map((row) => row.recordId))] : [];
  const suggestedRecordIds = selectableIds.slice(0, Math.min(overlayRecordLimit, 20));
  return (
    <section className="panel">
      <div className="drill-header">
        <h2>Trace Drill-Down</h2>
        <button className="secondary-button" type="button" onClick={onClear}>
          Clear selection
        </button>
      </div>
      {isLoading ? (
        <p className="hint">Loading records...</p>
      ) : result ? (
        <>
          <p className="hint">Selection: {formatSelection(result)}</p>
          {result.singleRecordMode && result.selectedRecordId ? (
            <p className="hint">
              Single-record trace: <strong>{result.selectedRecordId}</strong>
              {result.pathSegments?.length
                ? ` (${result.pathSegments.map((segment) => `${segment.sourceLabel} -> ${segment.targetLabel}`).join(" | ")})`
                : ""}
            </p>
          ) : null}
          <div className="drill-stats">
            <span>Contributing records: {result.totalRecords.toLocaleString()}</span>
            <span>
              {valueLabel}: {formatFlowValue(result.totalValue, valueMode, amountDataType)}
            </span>
          </div>
          <div className="controls-row">
            <button className="secondary-button" type="button" onClick={() => onApplyOverlay(suggestedRecordIds)}>
              Overlay top {suggestedRecordIds.length} record lines
            </button>
            <button className="secondary-button" type="button" onClick={() => onApplyOverlay([])}>
              Clear line overlay
            </button>
          </div>
          {overlayRecordIds.length ? (
            <p className="hint">
              Showing overlay lines for {overlayRecordIds.length} record{overlayRecordIds.length === 1 ? "" : "s"}.
            </p>
          ) : null}
          {overlaySelectionTruncated ? (
            <p className="hint">Overlay was capped at {overlayRecordLimit} records for performance.</p>
          ) : null}
          <div className="table-scroll preview-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Record ID</th>
                  <th>Step</th>
                  <th>Source</th>
                  <th>Target</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={`${row.recordId}-${row.step}-${index}`}>
                    <td>{row.recordId}</td>
                    <td>{row.step}</td>
                    <td>{row.source}</td>
                    <td>{row.target}</td>
                    <td>{formatFlowValue(row.value, valueMode, amountDataType)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.truncated ? <p className="hint">Showing first {result.rows.length} rows.</p> : null}
        </>
      ) : null}
    </section>
  );
};
