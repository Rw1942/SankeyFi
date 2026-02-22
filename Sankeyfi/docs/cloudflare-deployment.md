# Cloudflare Deployment Guide

Sankeyfi is deployed as a **Cloudflare Worker with Static Assets** at:

**https://sankeyfi.rick-wills.workers.dev**

## Prerequisites

- Node.js and npm
- Cloudflare account
- Wrangler CLI (installed as a dev dependency: `npm install -D wrangler`)

## Architecture

The project is a React + Vite SPA that builds to static files in `dist/`. It's deployed using Cloudflare's **Workers Static Assets** approach (the modern replacement for Cloudflare Pages).

DuckDB WASM binaries (~34MB and ~39MB each) exceed Cloudflare's 25 MiB per-file asset limit. To work around this, the WASM files are loaded from the **jsDelivr CDN** at runtime instead of being bundled into `dist/`. The smaller DuckDB JavaScript worker files (~773KB, ~845KB) are still bundled locally.

### Key configuration

**`wrangler.toml`** — Cloudflare deployment config:

```toml
name = "sankeyfi"
compatibility_date = "2026-02-20"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

- `name`: The Worker name (determines the `*.workers.dev` subdomain)
- `compatibility_date`: Cloudflare Workers API compatibility date
- `assets.directory`: Points to the Vite build output
- `not_found_handling`: Set to `single-page-application` so all routes serve `index.html` (required for client-side routing in an SPA)

**`src/worker/duckdbWorker.ts`** — WASM loaded from CDN:

```typescript
const DUCKDB_VERSION = "1.33.1-dev18.0";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;
const duckdbWasmMvp = `${CDN_BASE}/duckdb-mvp.wasm`;
const duckdbWasmEh = `${CDN_BASE}/duckdb-eh.wasm`;
```

## Deploy commands

### First-time setup

```bash
# Install dependencies (includes wrangler as dev dependency)
npm install

# Log in to Cloudflare (opens browser for OAuth)
npx wrangler login

# Verify login
npx wrangler whoami
```

### Build and deploy

```bash
# Build the project (TypeScript check + Vite production build)
npm run build

# Deploy to Cloudflare
npx wrangler deploy
```

The `wrangler deploy` command reads `wrangler.toml`, uploads the `dist/` directory as static assets, and deploys the Worker. The site is served from Cloudflare's global edge network.

### Preview deployments

To deploy a preview (non-production) version:

```bash
npx wrangler deploy --name sankeyfi-preview
```

### Local development

```bash
# Standard Vite dev server
npm run dev

# Or use Wrangler's local dev (simulates Cloudflare environment)
npx wrangler dev
```

## Updating DuckDB version

If you update the `@duckdb/duckdb-wasm` npm package version, also update the `DUCKDB_VERSION` constant in `src/worker/duckdbWorker.ts` to match, so the CDN-served WASM files stay in sync with the bundled JavaScript.

## Cloudflare limits

| Resource | Limit |
| --- | --- |
| Asset file size | 25 MiB per file |
| Total asset files | 20,000 files |
| Static asset requests | Free (no charge) |

## Useful commands

```bash
# Check deployment status
npx wrangler deployments list

# Tail live logs
npx wrangler tail

# Delete the Worker
npx wrangler delete
```
