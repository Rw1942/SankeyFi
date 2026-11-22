import type { ValueMode } from "../types";

const quoteIdent = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const buildAggExpression = (mode: ValueMode, amountCol?: string, amountExpr?: string): string => {
  if (mode === "count") {
    return "COUNT(*)";
  }

  if (amountExpr) {
    return `SUM(COALESCE(TRY_CAST(${amountExpr} AS DOUBLE), 0))`;
  }

  if (!amountCol) {
    throw new Error("Amount column is required for SUM mode.");
  }

  // TRY_CAST keeps the query resilient when CSV type inference is imperfect.
  return `SUM(COALESCE(TRY_CAST(${quoteIdent(amountCol)} AS DOUBLE), 0))`;
};

export const buildSankeyLinksQuery = (params: {
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  sourceRelation?: string;
  stepAmountCols?: string[];
}): string => {
  const { dims, mode, amountCol, sourceRelation = "v_data", stepAmountCols } = params;
  if (dims.length < 2) {
    throw new Error("At least two dimensions are required.");
  }

  if (stepAmountCols && stepAmountCols.length && stepAmountCols.length !== dims.length - 1) {
    throw new Error("Step amount columns must match the number of dimension transitions.");
  }

  const stepQueries = dims.slice(0, -1).map((dim, index) => {
    const nextDim = dims[index + 1];
    const src = quoteIdent(dim);
    const dst = quoteIdent(nextDim);
    const amountExpr = stepAmountCols?.[index] ? quoteIdent(stepAmountCols[index]) : undefined;
    const aggExpr = buildAggExpression(mode, amountCol, amountExpr);

    return `
      SELECT
        ${index + 1} AS step,
        CAST(${src} AS VARCHAR) AS src,
        CAST(${dst} AS VARCHAR) AS dst,
        ${aggExpr} AS value
      FROM ${quoteIdent(sourceRelation)}
      WHERE ${src} IS NOT NULL AND ${dst} IS NOT NULL
      GROUP BY 1, 2, 3
    `;
  });

  return `
    SELECT
      step,
      src,
      dst,
      SUM(value) AS value
    FROM (
      ${stepQueries.join("\nUNION ALL\n")}
    ) links
    GROUP BY 1, 2, 3
    HAVING SUM(value) > 0
    ORDER BY step, value DESC
  `;
};

export const buildSankeyTraceRowsQuery = (params: {
  dims: string[];
  mode: ValueMode;
  amountCol?: string;
  sourceRelation?: string;
  stepAmountCols?: string[];
  recordIdExpression: string;
}): string => {
  const { dims, mode, amountCol, sourceRelation = "v_data", stepAmountCols, recordIdExpression } = params;
  if (dims.length < 2) {
    throw new Error("At least two dimensions are required.");
  }

  if (stepAmountCols && stepAmountCols.length && stepAmountCols.length !== dims.length - 1) {
    throw new Error("Step amount columns must match the number of dimension transitions.");
  }

  const stepQueries = dims.slice(0, -1).map((dim, index) => {
    const nextDim = dims[index + 1];
    const src = quoteIdent(dim);
    const dst = quoteIdent(nextDim);
    const amountExpr = stepAmountCols?.[index] ? quoteIdent(stepAmountCols[index]) : undefined;
    const valueExpr = mode === "count" ? "1" : `COALESCE(TRY_CAST(${amountExpr ?? quoteIdent(amountCol ?? "")} AS DOUBLE), 0)`;

    return `
      SELECT
        ${index + 1} AS step,
        CAST(${src} AS VARCHAR) AS src,
        CAST(${dst} AS VARCHAR) AS dst,
        CAST(${recordIdExpression} AS VARCHAR) AS record_id,
        ${valueExpr} AS value
      FROM ${quoteIdent(sourceRelation)}
      WHERE ${src} IS NOT NULL
        AND ${dst} IS NOT NULL
        AND ${recordIdExpression} IS NOT NULL
    `;
  });

  return `
    SELECT
      step,
      src,
      dst,
      record_id,
      value
    FROM (
      ${stepQueries.join("\nUNION ALL\n")}
    ) trace_rows
    WHERE value > 0
  `;
};
