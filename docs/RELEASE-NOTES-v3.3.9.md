# OpenISMS v3.3.9 — MCP: account binding like web SSO, MCP_SECRET without admin by default

A small security follow-up to v3.3.8 (MCP as OAuth 2.1 resource server) and
the security review in v3.3.8 (#295). No migrations.

## Security

| Finding | Change |
|---|---|
| The MCP login with an IdP access token matched OpenISMS accounts by `email` and only rejected an explicit `email_verified=false`. The web SSO login was tightened in #295: a **local** account (password, possibly TOTP/passkey) is only taken over with an explicitly verified address. The MCP path did not apply that rule, so a token without `email_verified` (IdPs that omit the claim, or a client scope without it) could act as a local account with the same address. | MCP uses the same rules as the web login (`services/oidcIdentity.js`): accounts already linked by SSO (`sso_user`) are accepted; local accounts only with `email_verified=true` or `OIDC_LINK_UNVERIFIED_EMAIL=true`. Opt-in auto-provisioning (`MCP_OAUTH_AUTO_PROVISION=true`) additionally requires `email_verified=true`. An MCP login never modifies the account. |
| `MCP_SECRET` — a static key that never expires and has no person behind it — acted as `admin` unless `MCP_SECRET_ROLE` was set. | Default role is now `viewer`. Unknown values still fall back to `viewer`. The start-up log names the effective role and marks the mode as deprecated. |

## Breaking change

**`MCP_SECRET` without `MCP_SECRET_ROLE` now has role `viewer`.** If you use the
static key for write access, set `MCP_SECRET_ROLE=admin` (or a narrower role)
explicitly — or, better, switch to a personal API token (profile → API tokens).

## Tests

`scripts/test-mcp-auth.js`: local account without/with `email_verified`,
`OIDC_LINK_UNVERIFIED_EMAIL`, SSO-linked account, auto-provisioning only with
verified address, `MCP_SECRET` default role.
