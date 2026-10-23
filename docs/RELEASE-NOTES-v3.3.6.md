# OpenISMS v3.3.6 — security and dependency maintenance

A maintenance release. It ships a critical frontend dependency fix
(DOMPurify) and the Dependabot updates merged into `main` since v3.3.5.
There are no functional changes and no migrations; update the container as
usual.

---

## Security

| Finding | Change |
|---|---|
| npm audit GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr, GHSA-c6gr-qvv4-5v3f (`dompurify` <= 3.4.16, **critical**) | `dompurify` 3.4.16 → **3.4.17** (frontend, lockfile only). |
| npm audit (`follow-redirects` 1.16.0, high, via `axios`) | `follow-redirects` 1.16.0 → **1.16.1** (frontend, lockfile only). |
| npm audit GHSA-5r4p-p66f-jhc7 (`hono` 4.12.4–4.13.10, moderate, `serveStatic` path decoding) | `hono` 4.13.7 → **4.13.13** (backend, lockfile only). |
| npm audit (`ip-address` <= 10.7.3, moderate, quadratic-time zone identifier parsing) | `ip-address` 10.7.2 → **10.7.4** (backend, lockfile only). |

After the update `npm audit` reports no findings in `backend/` and `frontend/`.

## Backend

| Package | v3.3.5 | v3.3.6 |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.133.0 | **^0.135.0** |
| `dotenv` | ^18.0.7 | **^18.0.8** |
| `nodemailer` | ^10.1.0 | **^10.1.7** |
| `openai` | ^7.32.0 | **^7.39.0** |
| `swagger-ui-dist` | ^5.33.2 | **^5.34.0** |

## Frontend

| Package | v3.3.5 | v3.3.6 |
|---|---|---|
| `i18next` | ^26.4.4 | **^26.5.3** |
| `i18next-http-backend` | ^4.0.2 | **^4.0.4** |
| `lucide-react` | ^1.55.0 | **^1.59.0** |
| `react` / `react-dom` | ^19.3.0 | **^19.3.1** |
| `react-i18next` | ^17.0.16 | **^17.1.0** |
| `react-router` | ^8.4.0 | **^8.5.0** |
| `postcss` (dev) | ^8.5.30 | **^8.5.31** |

## CI

- GitHub Actions updates (Dependabot group).
- Every job on the self-hosted runner now has a `timeout-minutes` limit (#253), so a hanging image build can no longer block the runner for hours.
