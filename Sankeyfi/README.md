# Sankeyfi

Sankeyfi is a fast in-browser Sankey builder powered by DuckDB-Wasm. Everything runs locally in your browser, so you can import data, shape your stages, and inspect record-level flow details without a backend.

## What You Can Do

- Import one or more files (CSV, TSV, TXT, Parquet, or Excel).
- Build Sankey links from selected dimensions or from pivoted stage rows.
- Size flows by row count or by summing a numeric amount column.
- Choose amount formatting for SUM mode:
  - `Number (default)`
  - `USD (rounded to millions)` (for example `$12M`)
- Reorder dimensions, apply Top N per stage, and optionally show/hide `Other`.
- Click links or nodes to inspect contributing records.
- Click a first or last column node to highlight proportional flow-through paths.

## Quick Start

### Requirements

- Node.js 20+ recommended
- npm

### Run Locally

```bash
npm install
npm run dev
```

Open the local URL shown in the terminal (usually `http://localhost:5173`).

### Other Scripts

```bash
npm run build    # type-check + production build
npm run preview  # preview built app
npm run lint     # run ESLint
```

## Typical Workflow

1. Import a file.
2. Pick dimensions in the **Dimensions** panel.
3. In **Values**, choose:
   - `Count rows` or `Sum column`
   - amount column (for SUM)
   - amount data type (for SUM)
4. (Optional) Enable **Pivot mode** and set pivot columns.
5. Click **Run Sankey**.
6. Click links or nodes in the chart to inspect record-level trace data.
7. Click a node in the first or last column to see its proportional flow highlighted through intermediate stages.

## Notes and Limits

- All processing is local in the browser (no backend service required).
- Very large files may be limited by browser memory.
- Persistent storage may fall back to in-memory mode depending on browser support.

## Deployment

- See `docs/cloudflare-deployment.md` for Cloudflare deployment setup.

## Project Layout

- `src/App.tsx` - main app state and orchestration
- `src/components/` - UI components (`SankeyChart`, `DimensionManager`, `FlowDrillPanel`, `StatusFeed`)
- `src/worker/` - DuckDB worker, protocol, and query builders
- `docs/` - focused product/user-story notes
