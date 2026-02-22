# Sankeyfi

Sankeyfi is a fast, in-browser Sankey builder powered by DuckDB-Wasm. It runs fully client-side and lets you import CSV/TSV/TXT/Parquet files, configure dimensions and value logic, and inspect source records behind each flow.

## What You Can Do

- Import one or more files (latest imported file becomes the active dataset).
- Build Sankey links from selected dimensions or from pivoted stage rows.
- Calculate flow thickness by row count or by summing an amount column.
- Choose amount display type for SUM mode:
  - `Number (default)`
  - `USD (rounded to millions)` (for example `$12M`)
- Reorder dimensions, apply per-dimension Top N, and optionally show/hide `Other`.
- Click links or nodes to drill into contributing records.
- Click a first or last column node to see a proportional flow-through ribbon tracing its contribution through the diagram.

## Quick Start

### Requirements

- Node.js 20+ recommended
- npm

### Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (typically `http://localhost:5173`).

### Other scripts

```bash
npm run build    # type-check + production build
npm run preview  # preview built app
npm run lint     # run ESLint
```

## Typical Workflow

1. Import a data file.
2. Pick dimensions in the **Dimensions** panel.
3. In **Values**, choose:
   - `Count rows` or `Sum column`
   - amount column (for SUM)
   - amount data type (for SUM)
4. (Optional) Enable **Pivot mode** and set pivot columns.
5. Click **Run Sankey**.
6. Click links/nodes in the chart to inspect record-level trace data.
7. Click a node in the first or last column to see its proportional flow highlighted through intermediate stages.

## Notes and Limits

- All processing is local in the browser (no backend service required).
- Very large files may be limited by browser memory.
- Persistent storage may fall back to in-memory mode depending on browser support.

## Project Layout

- `src/App.tsx` - main app state and orchestration
- `src/components/` - UI components (`SankeyChart`, `DimensionManager`, `FlowDrillPanel`, `StatusFeed`)
- `src/worker/` - DuckDB worker, protocol, and query builders
- `docs/` - focused product/user-story notes
