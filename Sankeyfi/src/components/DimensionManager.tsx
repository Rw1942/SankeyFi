import { useCallback, useMemo, useState } from "react";
import type { ColumnInfo, PreviewResult } from "../types";

const MAX_VALUE_PREVIEW = 6;
const NUMERIC_TYPE_REGEX = /int|double|float|decimal|real|numeric|bigint|smallint|tinyint|hugeint/i;
const NUMERIC_VALUE_REGEX = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

interface DimensionSummary {
  values: string[];
  hasMore: boolean;
}

interface DimensionManagerProps {
  columns: ColumnInfo[];
  preview: PreviewResult | null;
  selectedDimensions: string[];
  topNByDimension: Record<string, number>;
  onSelectedDimensionsChange: (next: string[]) => void;
  onTopNChange: (dimension: string, nextTopN: number) => void;
}

const toPreviewValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "(blank)";
  return String(value);
};

const moveItem = (items: string[], fromIndex: number, toIndex: number): string[] => {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

const summarizeDimensionValues = (columns: ColumnInfo[], preview: PreviewResult | null): Record<string, DimensionSummary> => {
  const summaries = Object.fromEntries(
    columns.map((column) => [
      column.name,
      {
        values: [],
        hasMore: false,
      } satisfies DimensionSummary,
    ]),
  ) as Record<string, DimensionSummary>;

  if (!preview) return summaries;

  for (const row of preview.rows) {
    for (const column of columns) {
      const summary = summaries[column.name];
      const candidate = toPreviewValue(row[column.name]);
      if (summary.values.includes(candidate)) continue;
      if (summary.values.length >= MAX_VALUE_PREVIEW) {
        summary.hasMore = true;
        continue;
      }
      summary.values.push(candidate);
    }
  }

  return summaries;
};

type FieldKind = "Numeric" | "Categorical";
type SortDirection = "asc" | "desc";
type AvailableSortKey = "name" | "likelyType" | "sampleValues";

export const DimensionManager = ({
  columns,
  preview,
  selectedDimensions,
  topNByDimension,
  onSelectedDimensionsChange,
  onTopNChange,
}: DimensionManagerProps) => {
  const [availableSort, setAvailableSort] = useState<{ key: AvailableSortKey; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });
  const dimensionSummaries = useMemo(() => summarizeDimensionValues(columns, preview), [columns, preview]);
  const selectedSet = useMemo(() => new Set(selectedDimensions), [selectedDimensions]);
  const selectedColumns = useMemo(
    () => selectedDimensions.map((name) => columns.find((column) => column.name === name)).filter((column): column is ColumnInfo => !!column),
    [columns, selectedDimensions],
  );
  const getSampleText = useCallback(
    (columnName: string) => {
      const summary = dimensionSummaries[columnName];
      if (!summary || !summary.values.length) return "(no sample values)";
      return summary.hasMore ? `${summary.values.join(", ")}, ...` : summary.values.join(", ");
    },
    [dimensionSummaries],
  );

  const getLikelyFieldKind = useCallback(
    (column: ColumnInfo): FieldKind => {
      if (NUMERIC_TYPE_REGEX.test(column.type)) return "Numeric";
      const summary = dimensionSummaries[column.name];
      if (!summary?.values.length) return "Categorical";
      const candidates = summary.values.filter((value) => value !== "(blank)");
      if (!candidates.length) return "Categorical";

      const numericLikeCount = candidates.filter((value) => NUMERIC_VALUE_REGEX.test(value.trim())).length;
      return numericLikeCount / candidates.length >= 0.75 ? "Numeric" : "Categorical";
    },
    [dimensionSummaries],
  );

  const availableColumns = useMemo(() => {
    const withIndex = columns
      .filter((column) => !selectedSet.has(column.name))
      .map((column, index) => ({ column, index }));

    withIndex.sort((left, right) => {
      let comparison = 0;
      if (availableSort.key === "name") {
        comparison = left.column.name.localeCompare(right.column.name);
      } else if (availableSort.key === "likelyType") {
        comparison = getLikelyFieldKind(left.column).localeCompare(getLikelyFieldKind(right.column));
      } else {
        comparison = getSampleText(left.column.name).localeCompare(getSampleText(right.column.name));
      }

      if (comparison === 0) {
        comparison = left.index - right.index;
      }
      return availableSort.direction === "asc" ? comparison : comparison * -1;
    });

    return withIndex.map(({ column }) => column);
  }, [availableSort.direction, availableSort.key, columns, getLikelyFieldKind, getSampleText, selectedSet]);

  const toggleDimension = (columnName: string) => {
    onSelectedDimensionsChange(
      selectedDimensions.includes(columnName)
        ? selectedDimensions.filter((value) => value !== columnName)
        : [...selectedDimensions, columnName],
    );
  };

  const shiftDimension = (dimension: string, direction: -1 | 1) => {
    const index = selectedDimensions.indexOf(dimension);
    onSelectedDimensionsChange(moveItem(selectedDimensions, index, index + direction));
  };

  const toggleAvailableSort = (key: AvailableSortKey) => {
    setAvailableSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const renderSortIndicator = (key: AvailableSortKey) => {
    if (availableSort.key !== key) return "";
    return availableSort.direction === "asc" ? " \u25b2" : " \u25bc";
  };

  return (
    <div className="dimension-manager">
      <section className="table-section">
        <h3>Selected Dimensions</h3>
        <p className="hint">Checked dimensions define Sankey stages in this order.</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-select">Select</th>
                <th>Dimension</th>
                <th>Sample values</th>
                <th className="col-topn">Top N</th>
                <th className="col-order">Order</th>
              </tr>
            </thead>
            <tbody>
              {selectedColumns.length ? (
                selectedColumns.map((column, index) => (
                  <tr key={column.name}>
                    <td>
                      <input type="checkbox" checked={true} onChange={() => toggleDimension(column.name)} />
                    </td>
                    <td>
                      <span className="cell-truncate" title={column.name}>
                        {column.name}
                      </span>
                    </td>
                    <td>
                      <span className="cell-truncate dimension-sample-text" title={getSampleText(column.name)}>
                        {getSampleText(column.name)}
                      </span>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="topn-input"
                        min={1}
                        step={1}
                        value={topNByDimension[column.name] ?? 20}
                        onChange={(event) => onTopNChange(column.name, Number(event.target.value))}
                      />
                    </td>
                    <td className="dimension-actions">
                      <button type="button" onClick={() => shiftDimension(column.name, -1)} disabled={index === 0}>
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => shiftDimension(column.name, 1)}
                        disabled={index === selectedColumns.length - 1}
                      >
                        Down
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="hint">
                    No selected dimensions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="table-section">
        <h3>Available Dimensions</h3>
        <p className="hint">Check a row to add that dimension to the selected table above.</p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="col-select">Select</th>
                <th>
                  <button type="button" className="sortable-header" onClick={() => toggleAvailableSort("name")}>
                    Dimension{renderSortIndicator("name")}
                  </button>
                </th>
                <th className="col-likely-type">
                  <button type="button" className="sortable-header" onClick={() => toggleAvailableSort("likelyType")}>
                    Likely type{renderSortIndicator("likelyType")}
                  </button>
                </th>
                <th>
                  <button type="button" className="sortable-header" onClick={() => toggleAvailableSort("sampleValues")}>
                    Sample values{renderSortIndicator("sampleValues")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {availableColumns.length ? (
                availableColumns.map((column) => (
                  <tr key={column.name}>
                    <td>
                      <input type="checkbox" checked={false} onChange={() => toggleDimension(column.name)} />
                    </td>
                    <td>
                      <span className="cell-truncate" title={column.name}>
                        {column.name}
                      </span>
                    </td>
                    <td>
                      <span className="cell-truncate" title={getLikelyFieldKind(column)}>
                        {getLikelyFieldKind(column)}
                      </span>
                    </td>
                    <td>
                      <span className="cell-truncate dimension-sample-text" title={getSampleText(column.name)}>
                        {getSampleText(column.name)}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="hint">
                    All dimensions are currently selected.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
