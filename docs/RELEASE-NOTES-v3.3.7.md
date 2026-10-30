# OpenISMS v3.3.7 — Node.js runtime fix and dependency maintenance

A maintenance release. The container image moves to Node.js 26.13.0, which
contains the fix for the Brotli decoder vulnerability CVE-2026-111497 in
`node:zlib`. It also ships a transitive dependency fix (`@hono/node-server`)
and the Dependabot updates merged into `main` since v3.3.6. There are no
functional changes and no migrations; update the container as usual.

If you run OpenISMS without Docker, update the Node.js runtime on the host to
26.12.1 or later. `engines` now requires `>=26.12.1`.

---

## Security

| Finding | Change |
|---|---|
| CVE-2026-111497 (Brotli decoder out-of-bounds write in `node:zlib`, Node.js security release of 21 Oct 2026, listed in CISA KEV since 27 Oct 2026) | Docker base images `node:26.8.1` → **`node:26.13.0`** (app and `.oss-scanner`), CI and GitHub workflows `26.3.0` → **`26.13.0`**, `engines` `>=26.3.0` → **`>=26.12.1`** (#272). |
| Dependabot alert #50 (`@hono/node-server` < 2.1.3, moderate: `serveStatic` decodes the request path a second time, middleware on static paths can be bypassed) | `@hono/node-server` 2.1.1 → **2.1.5** (backend, transitive via `@modelcontextprotocol/sdk`, lockfile only). |
| Dependabot security update for `qs` | override `qs` ^6.16.0 → **^6.17.1** (backend, #271). |

After the update `npm audit` reports no findings in `backend/` and `frontend/`.

## Backend

| Package | v3.3.6 | v3.3.7 |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.135.0 | **^1.3.0** (major update, #260 and #266) |
| `@modelcontextprotocol/sdk` | ^1.32.1 | **^1.32.2** |
| `dotenv` | ^18.0.8 | **^18.0.9** |
| `nodemailer` | ^10.1.7 | **^10.2.1** |
| `openai` | ^7.39.0 | **^7.45.0** |

## Frontend

| Package | v3.3.6 | v3.3.7 |
|---|---|---|
| `i18next` | ^26.5.3 | **^26.5.11** |
| `i18next-browser-languagedetector` | ^8.2.1 | **^8.2.3** |
| `i18next-http-backend` | ^4.0.4 | **^4.0.6** |
| `lucide-react` | ^1.59.0 | **^1.61.0** |
| `react-i18next` | ^17.1.0 | **^17.1.9** |
| `postcss` (dev) | ^8.5.31 | **^8.5.32** |
| `vite` (dev) | ^8.3.4 | **^8.3.5** |

## CI

- GitHub Actions updates (Dependabot group #261: `crowdin/github-action` 3.5.0, `docker/login-action` 4.7.0, `github/codeql-action`).
- Node.js 26.13.0 in GitLab CI and GitHub workflows (#272).
