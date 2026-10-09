# Threat model — OpenISMS

## What this project does and where untrusted input enters
OpenISMS is an Information Security Management System: a Node.js/Express backend,
a React frontend served by the backend from `public/`, and PostgreSQL for
storage. It supports multi-user operation with role-based access control (RBAC),
OIDC single sign-on, a REST API and an MCP server for AI integration.

Untrusted input enters through:
- the REST API and the MCP server (authenticated and, for some routes, pre-auth);
- the OIDC/SSO login flow and session/token handling;
- file uploads and the parsing of uploaded documents (DOCX via `mammoth`, PDF,
  spreadsheets, ZIP/backup archives);
- any request-derived value used for access-control decisions, including the
  client IP behind a reverse proxy (`trust proxy` / `proxy-addr`), because the
  instances that matter run reachable from the Internet without a WAF in front.

## Components that matter most / least
- **Most important:** authentication and session handling, the RBAC/permission
  layer and every authorization check, tenant/data isolation between users and
  organizations, SQL built from request input (Sequelize/`pg`), the file-upload
  and document-parsing paths, and the MCP/API surface.
- **In scope but lower priority:** the React frontend (reflected/stored XSS still
  matters because it can ride an authenticated session), i18n/Crowdin content.
- **Out of scope:** third-party dependencies' own internal issues unless they are
  reachable through OpenISMS; build-only/devDependencies that are not shipped in
  the production image (the runtime image is built with `npm ci --omit=dev`).

## How to exercise it
- `backend/` holds the Express app (`src/index.js`) and the API/MCP routes.
- `frontend/` is the React app; `npm run build` produces the served assets.
- `docker-compose.yml` brings up the app with PostgreSQL for an end-to-end run.
- Tests, where present, run via `npm test` in `backend/`.

## How we rate severity
- **Critical:** unauthenticated RCE, authentication bypass, or cross-tenant data
  access without authentication; a controlled SQL injection that reads or writes
  arbitrary data.
- **High:** post-authentication privilege escalation or RBAC bypass, stored XSS
  that executes in another user's session, SSRF reaching internal services,
  arbitrary file read/write via upload or document parsing, IP-spoofing that
  defeats an IP-based trust or access control.
- **Medium:** reflected XSS requiring user interaction, authenticated
  information disclosure limited to the caller's own tenant, CSRF on
  state-changing endpoints, DoS that needs authentication.
- **Low:** issues confined to devDependencies not present in the production
  image, best-practice hardening without a demonstrated impact.

## Anything to leave alone
- Do not report issues that exist only in build-time/devDependencies absent from
  the production image, unless you can show they reach a deployed instance.
- The initial admin password behaviour is intentional (set via `ADMIN_PASSWORD`
  or a one-time generated password printed to the logs) — not a finding on its own.
