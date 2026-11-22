# SankeyFi

SankeyFi is an in-browser Sankey diagram builder. It is a React and Vite single-page app that loads CSV, TSV, Parquet and Excel files into DuckDB-Wasm in a web worker and runs every query in the browser, with no backend. It is served by the Cloudflare Worker `sankeyfi` at https://sankeyfi.rick-wills.workers.dev as static assets only (no Worker script, no bindings).

## Commands

Run from the repository root with npm. A fresh checkout or cloud session needs `npm install` first.

| Task | Command |
|---|---|
| Dev server (http://localhost:5173) | `npm run dev` |
| Checks (ESLint, type-check, production build) | `npm run check` |
| Serve the built `dist/` locally | `npm run preview` (Vite) or `npx wrangler dev` (Cloudflare's asset serving) |
| Deploy to production | `npm run deploy` |
| Test a change before production | `npm run deploy:preview` |

`npm run check` is the gate for every change, and `npm run deploy` runs it before `wrangler deploy`. There are no unit tests. ESLint currently reports one known warning (`react-hooks/exhaustive-deps` in `src/App.tsx`), which does not fail the check.

`npm run deploy:preview` builds and runs `wrangler preview`, which creates a Worker Preview named after the current git branch (pass `-- --name <name>` to choose one) at `<name>-sankeyfi.rick-wills.workers.dev`, without touching production. Remove one with `npx wrangler preview delete --name <name>`. Do not deploy a second Worker for previews.

## Layout

- `src/App.tsx`: app state and orchestration, including the startup demo dataset (`src/data/mushrooms_user_friendly.csv`, imported with `?raw`).
- `src/components/`: `SankeyChart` (d3-sankey, flow-through highlighting, record overlays), `DimensionManager` (dimension picking with sample values, move up and down to reorder), `FlowDrillPanel`, `SheetPicker`, `StatusFeed`.
- `src/features/import/`: `csvPrecheck.ts` checks a CSV before import and reports in the status feed; clean files continue automatically and risky ones (malformed quoting, severe column mismatches) are blocked. `xlsxPreprocess.ts` turns Excel sheets into CSV.
- `src/services/duckdbClient.ts`: the main-thread client for the worker. `src/worker/`: the DuckDB worker, its message protocol and the Sankey SQL builders.
- `docs/`: developer notes, indexed in `docs/README.md`.

## Cloudflare

- Worker `sankeyfi` on account `3c526a82504f460f254335ac81d313dd`, served on workers.dev with no custom domain or route. `wrangler.jsonc` serves `./dist` with `not_found_handling: "single-page-application"`, so every unknown path returns `index.html`. Version preview URLs are on. No bindings and no secrets.
- Because there is no Worker script, `wrangler types` has nothing to generate and there is no `worker-configuration.d.ts`. Add one with `npx wrangler types` if a Worker script is ever added.
- Agents deploy and change infrastructure directly. Wrangler (the repository's pinned copy, `npx wrangler`) handles deploys, versions and rollbacks, previews and `wrangler tail`; use the commands above when one fits. This project uses Wrangler, so do not run `cf dev`, `cf build`, `cf deploy` or `cf migrate`.
- Cloudflare Code Mode (`cloudflare-api` MCP server) covers the rest of the account: DNS, routes and domains, Worker settings, logs and analytics, other projects, and the Cloudflare docs. Call `search` to find an endpoint, then `execute` with `account_id` set to the account ID above. Results are cut off at about 6,000 tokens, so filter inside the code.
- Both act on production. Wrangler and Code Mode read `CLOUDFLARE_API_TOKEN`. The account-wide standard, token permissions and the inventory of every project are in the `Rw1942/cloudflare-account` repo.

## Working here

- Commit to `main` and deploy with `npm run deploy` once checks pass.
- All data processing stays in the browser. Do not add server-side handling of user files.
- The working database lives in OPFS (`opfs://sankeyfi.duckdb`) when the browser allows writable OPFS, and falls back to memory otherwise; the status feed says which.

## Things that are easy to get wrong

- DuckDB's WASM binaries are about 34 MB each, over the 25 MiB per-file limit for Workers static assets, so `src/worker/duckdbWorker.ts` loads them from jsDelivr at runtime while the smaller DuckDB worker scripts are bundled. When you change the `@duckdb/duckdb-wasm` version in `package.json`, set `DUCKDB_VERSION` in that file to the same version so the CDN binaries match the bundled JS. The dependency is a prerelease (`1.33.1-dev18.0`); keep the lockfile pinned to it.
- `xlsx` 0.18.5 is the last SheetJS release published to npm and has open advisories (prototype pollution, ReDoS) with no npm fix. Newer SheetJS versions are distributed from SheetJS's own CDN; switching is an owner decision, so leave it unless asked.
- `npm run build` must run before any `wrangler deploy` or `wrangler preview`, because Wrangler uploads whatever is in `dist/`. The package scripts do this.

## Rules and reference

Rules in `.agents/rules/` hold decisions that are not visible in the code. Claude Code and Antigravity load them automatically; other agents should read the one that matches the files they are changing.

- `.agents/rules/writing-style.md`: the owner's writing rules for copy, docs, commit messages and replies.

`docs/flow-through.md` explains the flow-through highlighting and record overlays in `SankeyChart`.
