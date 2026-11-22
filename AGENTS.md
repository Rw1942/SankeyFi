# Notes for coding agents

SankeyFi is an in-browser Sankey diagram builder: a React and Vite app in `Sankeyfi/` that loads CSV, Parquet and Excel files into DuckDB-Wasm and runs every query in the browser, with no backend. It is deployed as the Cloudflare Worker `sankeyfi`, which serves the built `Sankeyfi/dist/` as static assets (no bindings), and the deployment details are in `Sankeyfi/docs/cloudflare-deployment.md`.

## Cloudflare operations

Agents deploy and change infrastructure directly. Two tools cover it, and both authenticate with the `CLOUDFLARE_API_TOKEN` environment variable for account `3c526a82504f460f254335ac81d313dd`:

- **Wrangler** (`npx wrangler`, run from `Sankeyfi/` after `npm install` there) for anything tied to `Sankeyfi/wrangler.toml`: deploys, versions and rollback, D1 migrations and queries, secrets, and `wrangler tail`. Use the project's own scripts when one fits (`npm run build` before every deploy, since Wrangler uploads `dist/`; then `npx wrangler deploy`).
- **Cloudflare Code Mode MCP** (`cloudflare-api` in `.mcp.json`) for the rest of the account: DNS, routes and custom domains, zone and Worker settings, analytics, other Workers and their resources, and the Cloudflare docs. Call `search` to find the endpoint, then `execute` with `account_id` set to the account ID above. `docs` searches the developer docs. Results are cut off at about 6,000 tokens, so filter inside the code instead of returning whole lists.

Both act on production, since `wrangler.toml` defines no other environment (the deployment doc's preview deploy uses a separate Worker, `npx wrangler deploy --name sankeyfi-preview`). `.claude/settings.json` allows these tools without prompts and still asks before a force push or deleting a Worker, database, bucket or namespace. Account-wide setup, token permissions and the inventory of every project are in the `Rw1942/cloudflare-account` repo, `docs/agent-setup.md`.
