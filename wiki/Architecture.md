# Architecture

How OpenISMS is built, for operators who need to know what runs where and for
developers who want to change it.

## Overview

```
                 Browser (React SPA)        AI assistants (MCP clients)
                        │  HTTPS                     │  HTTPS
                        ▼                            ▼
               ┌──────────────────── reverse proxy (TLS) ────────────────────┐
               │                                                            │
               ▼                                                            ▼
        ┌─────────────────────────── OpenISMS container (Node.js) ─────────────────────────┐
        │  Express 5                                                                         │
        │   ├─ /            static web UI (React build)                                      │
        │   ├─ /api/*       REST API (OpenAPI 3.0, Swagger UI at /api/docs)                  │
        │   ├─ /mcp, /sse   MCP server (Streamable HTTP + legacy SSE)                        │
        │   └─ /.well-known OAuth protected-resource metadata                                │
        │  Scheduled jobs (node-cron) · integrations · file storage under UPLOAD_DIR         │
        └───────────────┬──────────────────────────────────────────┬────────────────────────┘
                        │ SQL (Sequelize)                           │ outbound HTTPS
                        ▼                                           ▼
          PostgreSQL 15+ (+ Apache AGE, optional)     IdP (OIDC) · SMTP · LLM provider ·
          tables are authoritative; the graph is      CVE sources · threat feeds · CheckMK ·
          a trigger-maintained projection              Web Push services
```

One process serves the web UI, the REST API and the MCP endpoint on the same
origin and port (3001 in the container). There is no separate frontend server,
no message queue and no cache to operate.

## Components

| Layer | Technology | Where |
|---|---|---|
| Web UI | React 19, TypeScript, Vite, Tailwind CSS 4, recharts, Mermaid | `frontend/` |
| API | Node.js ≥ 26.12.1, Express 5 | `backend/src/routes/` |
| Data access | Sequelize 6; schema kept in sync on start, migrations for structural changes | `backend/src/models/` |
| Business logic | services per domain (catalogues, scoring, integrations, notifications) | `backend/src/services/` |
| Access control | authentication, permission matrix, module switches, rate limits | `backend/src/middleware/` |
| MCP | `@modelcontextprotocol/sdk`, own auth, OAuth resource server, CORS | `backend/src/mcp/` |
| Database | PostgreSQL 15+, Apache AGE optional | external or `docker-compose.yml` |

## Request path and authorisation

Every request — from the browser, a script or an MCP client — passes the same
gates:

1. **Authentication:** session token (JWT), personal API token, OIDC access
   token (MCP only) or the deprecated `MCP_SECRET`.
2. **Module switch:** a disabled module answers `403`.
3. **Permission matrix:** the matrix decides where it defines `module.action`;
   otherwise the endpoint's role list decides; a failed lookup denies.
4. **Write protection:** `viewer`, `management` and `employee` stay read-only.
5. **Object-level rules:** for example, asset owners see their own assets, and
   classification fields need `assets.edit_compliance`.

The UI only hides what a user cannot do; the server is always the gate. Details:
[Security Configuration – roles and permissions](Security-Configuration#4-roles-and-permissions).

## Data

- **Database:** all business data. Tables are the source of truth.
- **Graph:** with Apache AGE, database triggers project assets, risks, controls,
  requirements and their links into a graph in the same transaction. It powers
  the relationship analysis and can be rebuilt from the tables at any time.
- **Files:** every uploaded document lives under `UPLOAD_DIR` (`/app/uploads`
  in Docker), stored under random names with a SHA-256 hash in the database.
- **Secrets:** stored secrets (OIDC client secret, SMTP password, LLM keys,
  integration secrets, TOTP seeds) are AES-256-GCM encrypted with a key derived
  from `ENCRYPTION_KEY`.
- **Audit log:** a table with one HMAC-signed row per change.

## Integrations

Discovery sources are adapters in `backend/src/services/integrations/`. Each
declares its configuration fields, its connection test and how it maps records
to proposals; the reconciliation is shared (`services/discoverySync.js`).
Adding a source is one file plus one line in the registry. A source never
creates assets directly — its records land in the approval queue.

Outbound fetches to user-influenced destinations (threat feeds, profile
pictures, catalogue imports) go through an SSRF guard that only allows public
addresses and refuses redirects.

## Scheduled jobs

Daily jobs handle task automation, overdue reminders, audit log retention, CVE
refresh, expired API tokens, threat feeds and review reminders; see
[Features – scheduled jobs](Features#22-scheduled-jobs). A job lock keeps a job
from running twice at the same time.

## Deployment model

- **Single instance per database.** The short-lived session store (SSO,
  passkey and TOTP setup) and MCP sessions live in process memory.
- **Stateless otherwise:** restart or replace the container freely; data lives
  in PostgreSQL and the uploads volume.
- **Container image** `ghcr.io/grcforge/openisms-app`: Alpine-based, OS packages
  upgraded at build time, runs as UID 1000, production dependencies only.

## Release and CI pipeline

- **Release:** the `VERSION` file drives everything. A merge to `main` with a
  new version builds and pushes the image (`vX.Y.Z`, `X.Y.Z`, `latest`),
  creates the GitHub release with packages and CycloneDX SBOMs, and tags the
  commit. Without a version change, only `latest` is rebuilt.
- **Security & Quality:** CodeQL, Trivy, Gitleaks, npm audit, Snyk, SonarQube,
  frontend type check and build, backend syntax check, consistency tests
  (permission contract, MCP gate, OpenAPI sync, upload storage, catalogue
  parsers and more) and a module-load smoke test.
- **Dependabot:** daily updates; minor and patch updates merge automatically
  once all required checks pass.
- **Wiki:** this wiki is built from the repository by
  `scripts/build-wiki.js` and published by a workflow on every merge to `main`.

## Repository layout

```
├── backend/src/
│   ├── index.js          entry point: HTTP server, middleware, routes, jobs
│   ├── models/           Sequelize models
│   ├── routes/           REST API
│   ├── mcp/              MCP server, authentication, OAuth resource server, CORS
│   ├── services/         business logic, catalogues, integrations
│   ├── middleware/       authentication, permissions, modules, rate limits
│   └── openapi.json      OpenAPI 3.0 specification
├── frontend/
│   ├── src/pages/        one page per module
│   └── public/locales/   translations (en, de, es)
├── scripts/              consistency and security checks, wiki build
├── docs/                 documentation and release notes (published to this wiki)
├── wiki/                 wiki-only pages (published to this wiki)
├── Dockerfile · docker-compose.yml · docker-compose.ghcr.single.yml · install.sh
└── VERSION               release version
```
