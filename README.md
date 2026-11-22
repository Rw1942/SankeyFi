# SankeyFi

An in-browser Sankey diagram builder powered by DuckDB-Wasm, live at https://sankeyfi.rick-wills.workers.dev. Everything runs in the browser: files are never uploaded and there is no backend. Import your data, pick your stages, and explore record-level flows.

## Features

- Import CSV, TSV, TXT, Parquet or Excel files (multi-sheet supported). A sample mushrooms dataset is loaded and charted at startup.
- Build Sankey links from selected dimensions or from pivoted stage rows.
- Size flows by row count or by summing a numeric column, shown as plain numbers or USD rounded to millions (for example `$12M`).
- Reorder dimensions, apply Top N per stage, and toggle an `Other` bucket.
- Click any link or node to inspect the contributing records.
- Click a first- or last-column node to highlight its proportional flow through every stage.

## Typical workflow

1. Import a file.
2. Pick dimensions in the **Dimensions** panel.
3. Under **Values**, choose `Count rows` or `Sum column` (plus the amount column and data type for a sum).
4. Optionally enable **Pivot mode** and set pivot columns.
5. Click **Run Sankey**.
6. Click links or nodes to drill into record-level trace data.

Very large files can run into browser memory limits. The working database is kept in the browser's private file system (OPFS) where the browser allows it, and in memory otherwise.

## Development

Needs Node.js 22.12 or later and npm.

```bash
npm install
npm run dev          # http://localhost:5173
npm run check        # lint, type-check and production build
npm run deploy       # check, then deploy to Cloudflare
```

Deploying needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment. Notes for coding agents are in `AGENTS.md`, and `docs/` has developer notes.
