# OpenISMS v3.3.5 — configurable MCP CORS and Origin validation

The MCP endpoints (`/mcp`, `/sse`) get an explicit, configurable Origin policy.
No migrations. **One behaviour change** for browser-based MCP clients on a
foreign origin — read *Upgrading* before you update.

---

## What changes

| | v3.3.4 | v3.3.5 |
|---|---|---|
| CORS on `/mcp`, `/sse` | `Access-Control-Allow-Origin: *` for every caller | allow-list from `MCP_CORS_ORIGINS`, default `APP_URL` |
| Request with a foreign `Origin` | processed | **403** `{"error":"origin_not_allowed"}` before the MCP transport |
| Request without `Origin` (Claude Desktop, Claude Code, claude.ai connectors, curl) | processed | processed — unchanged |
| Credentials on MCP responses | none | none |

### New variable `MCP_CORS_ORIGINS`

Comma-separated list of browser origins that may call the MCP endpoints.

| Value | Effect |
|---|---|
| unset / empty | only the origin(s) in `APP_URL` — the default |
| `https://inspector.example.com,...` | these origins **in addition** to `APP_URL` |
| `*` | any origin — explicit opt-in, restores the v3.3.4 behaviour |

The effective policy is logged at start-up:
`[MCP] CORS/Origin policy: https://isms.example.com (APP_URL)`.

`MCP_SECRET` and `MCP_CORS_ORIGINS` are now passed through by both
`docker-compose.yml` and `docker-compose.ghcr.single.yml`. Previously
`MCP_SECRET` set in `.env` never reached the container in the compose setups.

### Why

The MCP Streamable HTTP transport specification asks servers to validate the
`Origin` header to prevent DNS-rebinding attacks: a web page on a foreign
origin must not be able to drive a reachable MCP server through a visitor's
browser, even when no cookie is involved. v3.3.4 answered every origin with
`*`; code scanning (`js/cors-permissive-configuration`, alert #261 on
`backend/src/mcp/server.js`) flagged this, and rightly so for a server that
can be reached from inside a network. The fix lives in
`backend/src/mcp/cors.js`, covered by `scripts/test-mcp-cors.js` (8 cases:
default, allow-list, wildcard, no Origin, foreign Origin → 403, allowed Origin
reflected without credentials, preflight).

## Upgrading

Pull the new image (`ghcr.io/grcforge/openisms-app:v3.3.5`) and restart.

- **Claude Desktop, Claude Code, claude.ai connectors and other native MCP
  clients:** nothing to do. They send no `Origin` header.
- **A browser-based MCP client on another origin** (e.g. an MCP inspector
  served from its own host): add its origin to `MCP_CORS_ORIGINS`, or set
  `MCP_CORS_ORIGINS=*` to keep the previous behaviour.

## Dependencies

No dependency changes since v3.3.4.
