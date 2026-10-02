# OpenISMS v3.3.3 — dependency maintenance

A maintenance release. It ships the Dependabot updates merged into `main`
since v3.3.2. There are no functional changes and no migrations; update the
container as usual.

---

## Backend

| Package | v3.3.2 | v3.3.3 | Pull request |
|---|---|---|---|
| `@anthropic-ai/sdk` | ^0.128.0 | **^0.129.0** | #218 |
| `@modelcontextprotocol/sdk` | ^1.30.1 | **^1.31.0** | #218 |
| `nodemailer` | ^10.0.10 | **^10.0.12** | #214, #218 |
| `mammoth` | ^1.12.3 | **^1.13.0** | #214 |
| `openai` | ^7.23.0 | **^7.25.0** | #219 |

## Frontend

| Package | v3.3.2 | v3.3.3 | Pull request |
|---|---|---|---|
| `dompurify` (transitive) | 3.4.14 | **3.4.16** | #217 |

## CI

| Action | Change | Pull request |
|---|---|---|
| `actions/github-script` | v8 → **v9** | #215 |
| `snyk/actions/setup` | re-pinned to `b075801` | #216 |
| `SonarSource/sonarqube-scan-action` | 8.2.2 → **8.3.0** | #220 |

## State at release

- Dependabot: **0** open alerts.
- Code scanning: one open alert, #256 (`js/cors-permissive-configuration`,
  medium) on the MCP router in `backend/src/mcp/server.js`. The router
  reflects any `Origin` but no longer sends `credentials: true` (see the
  comment there), so a foreign page cannot make cookie-bearing requests. The
  remaining point — validating `Origin` against an allowlist, as the MCP
  Streamable HTTP transport recommends against DNS rebinding — changes which
  MCP clients can connect and is left for a separate release.

## Upgrading

Pull the new image (`ghcr.io/grcforge/openisms-app:v3.3.3`) and restart. No
configuration changes are required.
