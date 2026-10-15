# OpenISMS v3.3.4 — security and dependency maintenance

A maintenance release. It closes the last open Dependabot and code-scanning
alerts and ships the Dependabot updates merged into `main` since v3.3.3.
There are no functional changes and no migrations; update the container as
usual.

---

## Security

| Finding | Change |
|---|---|
| Dependabot GHSA-hp3w-g68c-fv3c / CVE-2026-97058 (`sprintf-js` <= 1.1.3, medium, no patched version) | Reached only via `mammoth` → `argparse@1` → `sprintf-js`. `argparse` is used solely by mammoth's command-line wrapper (`bin/mammoth`), which OpenISMS does not call; the library entry point (`lib/index.js`) does not load it. An npm override pins `mammoth` → `argparse@^2.0.1`, which has no `sprintf-js` dependency. |
| npm audit (dev only) GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 (`braces` <= 3.0.3, high, no patched version) | Reached only via the `nodemon` devDependency → `chokidar@3`. `nodemon` is removed; `npm run dev` now uses Node's built-in `node --watch src/index.js`. The production image was never affected. |
| Code scanning #256 `js/cors-permissive-configuration` (medium), `backend/src/mcp/server.js` | The MCP router now answers with `Access-Control-Allow-Origin: *` instead of reflecting the request `Origin`. Without `credentials` both are equivalent for clients; the reflection itself is gone. Which MCP clients can connect does not change. |

## Backend

| Package | v3.3.3 | v3.3.4 |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.129.0 | **^0.133.0** |
| `@modelcontextprotocol/sdk` | ^1.31.0 | **^1.32.1** |
| `dotenv` | ^18.0.4 | **^18.0.7** |
| `express` | ^5.2.1 | **^5.3.0** |
| `express-rate-limit` | ^8.7.0 | **^8.7.1** |
| `nodemailer` | ^10.0.12 | **^10.1.0** |
| `openai` | ^7.25.0 | **^7.32.0** |
| `pg` | ^8.16.3 | **^8.23.1** |
| `read-excel-file` | ^9.3.10 | **^9.3.12** |
| `swagger-ui-dist` | ^5.33.0 | **^5.33.2** |
| `zod` | ^4.6.5 | **^4.6.7** |

`proxy-addr` (critical, transitive) was resolved in #226.

## Frontend

| Package | v3.3.3 | v3.3.4 |
|---|---|---|
| `i18next` | ^26.4.2 | **^26.4.4** |
| `lucide-react` | ^1.48.0 | **^1.55.0** |
| `mermaid` | ^12.0.0 | **^12.2.0** |
| `katex` (transitive) | | updated |
| `react-i18next` | ^17.0.15 | **^17.0.16** |
| `vite`, `@vitejs/plugin-react`, `postcss` (dev) | | patch updates |

Backend and frontend updates come from the Dependabot pull requests #228–#232 and #234–#237.

## CI

| Change | Pull request |
|---|---|
| `github/codeql-action` 4.38.2 → **4.38.3** | #233 |
| `snyk/actions/setup` re-pinned to `11b673c` | #224 |
| npm audit gate aligned with its intent | #226 |
| OSS Scanner enrollment build (`.oss-scanner/`) | #227 |

## Upgrading

Pull the new image (`ghcr.io/grcforge/openisms-app:v3.3.4`) and restart. No
configuration changes are required.
