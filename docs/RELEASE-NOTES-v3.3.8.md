# OpenISMS v3.3.8 — MCP endpoint as OAuth 2.1 resource server

A security release for the MCP endpoint (`/mcp`, `/sse`). Identity-provider
tokens are now verified the way the MCP authorization specification
(2025-06-18) requires: as JWTs that were issued for this server. No
migrations.

**Action required if you use SSO logins for MCP clients:** the IdP must put
`<APP_URL>/mcp` into the access token's `aud` (in Keycloak: a client scope with
an *Audience* mapper, see README → MCP Server). Until then IdP tokens are
rejected with `401 invalid_token`. API tokens (`isms_api_...`) and the web
login are not affected.

---

## Security

| Finding | Change |
|---|---|
| MCP accepted any access token of the configured OIDC issuer. A bearer that failed the own-JWT check was sent to the IdP's userinfo endpoint; if that answered, the user was looked up by `email` or `preferred_username`. Userinfo does not say which client a token was issued to, so a token a user had granted to any other application in the same realm logged in to MCP (token passthrough / confused deputy, CWE-863). With SSO auto-provisioning enabled, the same path created a new OpenISMS user. | Userinfo is no longer used on `/mcp`. IdP tokens are verified locally against the issuer's JWKS (asymmetric algorithms only), `iss` exact, `exp`/`nbf` with 30 s tolerance, Keycloak `typ` must be an access token, and `aud` must contain `<APP_URL>/mcp` (or a value from `MCP_OAUTH_AUDIENCES`; `azp` from `MCP_OAUTH_ALLOWED_CLIENTS` for transitions). Users are matched by the verified `email` only; `email_verified=false` and the SSO domain allow-list are enforced like in the web login. Creating users from an MCP login now additionally requires `MCP_OAUTH_AUTO_PROVISION=true`. |
| `MCP_SECRET` always acted as `admin`. | Unchanged by default; `MCP_SECRET_ROLE` lowers it (unknown values fall back to `viewer`). The active login modes are logged at startup (`[MCP] Auth modes: …`, no values). |

## MCP authorization (RFC 6750 / RFC 9728)

- Protected resource metadata now also lists `bearer_methods_supported:
  ["header"]`; `scopes_supported` can be set independently of the web login
  with `MCP_OAUTH_SCOPES`, a required scope with `MCP_OAUTH_REQUIRED_SCOPE`.
- `401` without a token: `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`
  (no `error` attribute, RFC 6750 §3.1). Rejected tokens: `error="invalid_token"`
  with a reason. Missing required scope: `403` with `error="insufficient_scope"`.
- One implementation of the metadata for `/.well-known/…` and
  `/mcp/.well-known/…` (`backend/src/mcp/oauthResource.js`); authentication
  moved from `mcp/server.js` to `backend/src/mcp/auth.js`.
- `jose` is now a direct backend dependency (it was already installed
  through `openid-client` and `@modelcontextprotocol/sdk`).

## Documentation

README → MCP Server: login modes, Keycloak setup (audience mapper, dynamic
client registration policies), Claude Desktop with a custom connector, with an
API token via `mcp-remote` (Windows-safe `env` form) and with the `mcp-remote`
OAuth flow. New settings in `.env.example` and both compose files.

## Tests

`scripts/test-mcp-auth.js` (part of the backend check in CI, 22 cases): locally signed
RS256 tokens against a mocked issuer — right audience accepted; foreign
audience, missing audience, expired, wrong issuer, foreign key, HS256 alg
confusion and ID tokens rejected; API token accepted; scope, e-mail and
provisioning rules; metadata and `WWW-Authenticate` format.
