# Cloudflare Deployment

Sankeyfi is deployed as a **Cloudflare Worker with Static Assets** at:

**https://sankeyfi.rick-wills.workers.dev**

## Prerequisites

- Node.js + npm
- A Cloudflare account
- Wrangler CLI (already a dev dependency -- `npm install` covers it)

## How It Works

The app is a React + Vite SPA that builds to `dist/`. Cloudflare serves those static files from its edge network.

DuckDB's WASM binaries (~34 MB each) exceed Cloudflare's 25 MiB per-file limit, so they're loaded from the **jsDelivr CDN** at runtime. The smaller DuckDB JS workers (~800 KB each) are still bundled locally.

### Key Config

**`wrangler.toml`**

```toml
name = "sankeyfi"
compatibility_date = "2026-02-20"

[assets]
directory = "./dist"
not_found_handling = "single-page-application"
```

- `not_found_handling = "single-page-application"` makes all routes serve `index.html` (required for client-side routing).

**`src/worker/duckdbWorker.ts`** -- CDN WASM URLs:

```typescript
const DUCKDB_VERSION = "1.33.1-dev18.0";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;
```

## First-Time Setup

```bash
npm install
npx wrangler login      # opens browser for OAuth
npx wrangler whoami      # verify login
```

## Build and Deploy

```bash
npm run build            # TypeScript check + Vite production build
npx wrangler deploy      # upload dist/ and deploy
```

### Preview Deploy

```bash
npx wrangler deploy --name sankeyfi-preview
```

### Local Dev

```bash
npm run dev              # standard Vite dev server
npx wrangler dev         # simulates Cloudflare locally
```

## Updating DuckDB

When you bump `@duckdb/duckdb-wasm` in `package.json`, also update `DUCKDB_VERSION` in `src/worker/duckdbWorker.ts` so the CDN WASM files stay in sync with the bundled JS.

## Cloudflare Limits

| Resource | Limit |
| --- | --- |
| Asset file size | 25 MiB per file |
| Total asset files | 20,000 |
| Static asset requests | Free |

## Useful Commands

```bash
npx wrangler deployments list   # check deployment status
npx wrangler tail               # tail live logs
npx wrangler delete             # delete the Worker
```
