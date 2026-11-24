# OpenISMS v3.5.1 — security fixes from the 2026-11 review

Patch release. No database migrations, no configuration changes. One behaviour change for API clients that pass a token in the URL (see below).

## Security fixes

| Finding | Change |
|---|---|
| **OP-2:** The query-string token fallback (`?token=`, `?api_key=`, `?access_token=`, `?key=`) was accepted on every GET route of the REST API. A link such as `/api/assets?token=…` authenticated the request, and the token ended up in proxy and access logs, browser history and bookmarks. | A token in the query string is accepted only for GET requests with `Accept: text/event-stream` (server-sent events; every `EventSource` sends this header). All other requests need the `Authorization` header; a query token is ignored there (401). The web UI does not use the fallback. MCP (`/mcp`, `/sse`) has its own authentication and is unchanged (#330). |
| **OP-4:** `POST`/`PUT` in three routes copied the whole request body into the model: AI Act systems (`POST /`, `PUT /:id`), data subject requests (`POST /`) and training records (`POST /trainings`, `PUT /trainings/:id`). | Fixed allowlists per route. For data subject requests the server assigns `ref` and `completed_at`; for training records `status` is derived from `completed_at`, and `contested`/`contestation_comment` can only be set through the objection workflow. The audit entry for a new data subject request now records the server-assigned `ref` (#331). |
| **OP-6:** 53 route handlers returned `e.message` with HTTP 400. Besides intended validation messages this exposed Sequelize, runtime and system errors naming tables, columns, constraints, enum types, SQL fragments and file paths. | New `requestError()`: unique violation → 409, validation → 400 (field names only), foreign key / database errors → 400 with a generic message, connection and runtime errors → 500. Every response carries a reference id; the details go to the log under the same id. Deliberately unchanged: backup restore (admin) and the SMTP/connection tests in the administration (diagnostics) (#332). |

### Behaviour change

API clients or scripts that authenticate with `?token=…` (or `api_key`, `access_token`, `key`) on normal REST calls receive 401 from this version on. Send the token in the `Authorization: Bearer …` header instead.

## Supply chain and CI

- **SBOM:** CycloneDX bills of materials for backend and frontend are built in CI and attached to every release as `openisms-vX.Y.Z-sbom-backend.cdx.json` and `openisms-vX.Y.Z-sbom-frontend.cdx.json` (#333, #335).
- **Runners:** all jobs that execute branch code run on GitHub-hosted runners; the self-hosted runner only runs the SonarQube scan on pushes to `main` (#329).
- **Gitleaks:** pinned version with SHA-256 verification instead of `latest` (#334).
- **Dependabot:** after an auto-merge, Release and Security are started on `main` (#336).
- New checks `scripts/test-query-token-scope.js`, `scripts/test-mass-assignment-op4.js` and `scripts/test-request-error.js` in the Security & Quality workflow.

## Dependencies

| Package | From | To |
|---|---|---|
| `@anthropic-ai/sdk` | 1.9.0 | 1.12.0 |
| `openai` | 7.57.0 | 7.62.0 |
| `express-rate-limit` | 8.7.4 | 8.7.5 |
| `jose` | 6.2.17 | 6.2.18 |
| `nodemailer` | 10.6.0 | 10.6.1 |
| `openid-client` | 6.9.0 | 6.9.1 |
| `read-excel-file` | 9.3.17 | 9.3.20 |
| `swagger-ui-dist` | 5.35.0 | 5.35.1 |
| `i18next` | 27.1.3 | 27.2.3 |
| `i18next-browser-languagedetector` | 8.3.0 | 8.3.1 |
| `i18next-http-backend` | 4.0.10 | 4.1.0 |
| `react-i18next` | 18.0.2 | 18.0.3 |
| `react-router` | 8.5.1 | 8.5.2 |
| `lucide-react` | 1.73.0 | 1.77.0 |
| `recharts` | 3.10.1 | 3.11.0 |
| `autoprefixer` | 10.6.2 | 10.7.0 |
| `github/codeql-action` | 4.39.3 | 4.39.4 |

(#327, #328, #337, #338, #339, #340)
