# Sankeyfi

A fast, in-browser Sankey diagram builder powered by DuckDB-Wasm. Everything runs locally -- no backend, no uploads. Import your data, pick your stages, and explore record-level flows right in the browser.

## Features

- Import CSV, TSV, TXT, Parquet, or Excel files (multi-sheet supported).
- Build Sankey links from selected dimensions or from pivoted stage rows.
- Size flows by row count or by summing a numeric column.
- Format amounts as plain numbers or USD rounded to millions (e.g. `$12M`).
- Reorder dimensions, apply Top N per stage, and toggle an `Other` bucket.
- Click any link or node to inspect the contributing records.
- Click a first- or last-column node to highlight proportional flow-through paths.

## Quick Start

**Requirements:** Node.js 20+, npm

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

### Other Scripts

| Command | What it does |
| --- | --- |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview the built app locally |
| `npm run lint` | Run ESLint |

## Typical Workflow

1. Import a file.
2. Pick dimensions in the **Dimensions** panel.
3. Under **Values**, choose `Count rows` or `Sum column` (plus amount column and data type for SUM).
4. Optionally enable **Pivot mode** and set pivot columns.
5. Click **Run Sankey**.
6. Click links or nodes to drill into record-level trace data.
7. Click a first- or last-column node to see its proportional flow highlighted across stages.

## Notes

- All processing stays in the browser -- no server calls.
- Very large files may bump up against browser memory limits.
- Persistent storage can fall back to in-memory mode depending on browser support.

## Deployment

See [`docs/cloudflare-deployment.md`](docs/cloudflare-deployment.md) for Cloudflare setup.

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Main app state and orchestration |
| `src/types.ts` | Shared TypeScript types |
| `src/valueFormatting.ts` | Amount display formatting helpers |
| `src/components/` | UI: `SankeyChart`, `DimensionManager`, `FlowDrillPanel`, `SheetPicker`, `StatusFeed` |
| `src/features/import/` | Import pipeline: CSV pre-check, Excel preprocessing |
| `src/services/` | `DuckDBWorkerClient` wrapper |
| `src/worker/` | DuckDB web-worker, protocol, and query builders |
| `docs/` | Feature stories and deployment notes |
