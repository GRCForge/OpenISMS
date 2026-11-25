# Troubleshooting

Start with the application log (`docker compose logs openisms-app`, or
`journalctl -u openisms` on bare-metal installs) and the health check
`GET /api/health`. For MCP-specific problems see
[MCP Integration – troubleshooting](MCP-Integration#9-troubleshooting).

## Start-up

| Symptom | Cause and fix |
|---|---|
| Docker Compose refuses to start with "… must be set" | `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET` or `ENCRYPTION_KEY` missing in `.env` |
| The app waits for or cannot reach the database | Check `DATABASE_URL` / `DB_*`; for a remote database with TLS set `DB_SSL`; the connect timeout is `DB_CONNECT_TIMEOUT_MS` |
| I don't know the admin password | Set `ADMIN_PASSWORD` *before the first start*, or read `<UPLOAD_DIR>/INITIAL_ADMIN_PASSWORD.txt`. Both only apply while no user exists |
| The relationship analysis says it is unavailable | Apache AGE is not installed or not preloaded — see [Installation and Configuration](Installation-and-Configuration#6-relationship-analysis-apache-age). Everything else works without it |
| After an upgrade the UI still shows the old version | The deployment restarted the service without deploying new code. Check `GET /api/version` and the `VERSION` file in the application directory |

## Login and SSO

| Symptom | Cause and fix |
|---|---|
| SSO or passkey login fails with a lost session or "no active challenge" | `SECURE_COOKIES=true` while the proxy does not forward `X-Forwarded-Proto: https`, so the session cookie is never set. Fix the proxy headers, or set `SECURE_COOKIES=false` until they are right |
| SSO login redirects to the wrong address | `APP_URL` does not match the public URL; the redirect URI at the IdP must be `<APP_URL>/api/auth/oidc/callback` |
| SSO login rejected for some users | Their e-mail domain is not in the allowed domains, or the IdP sends `email_verified=false` |
| An existing local account is not linked on SSO login | The IdP does not mark the address as verified. Fix it at the IdP, or — knowingly — set `OIDC_LINK_UNVERIFIED_EMAIL=true` |
| SSO fields are read-only in the app | They are pinned through `OIDC_*` environment variables; the environment wins |
| Passkey registration fails behind a proxy | Set `WEBAUTHN_RP_ID` to your domain and `WEBAUTHN_ORIGIN` to your `APP_URL` |
| "Account locked" | Too many failed attempts; the lock lifts after the configured minutes (default 15); a password reset by e-mail also clears it |
| Everyone was logged out | `JWT_SECRET` changed. Expected — log in again |
| TOTP codes are always rejected | Check the device clock; codes are valid for one 30-second step either way. Each code works only once |

## API and integrations

| Symptom | Cause and fix |
|---|---|
| `401` with a token in the URL (`?token=…`) | Since v3.5.1 query tokens are only accepted for event streams. Use the `Authorization: Bearer` header |
| `403` on a whole area | The module is switched off (*Administration → Modules*), or the permission matrix denies it |
| `429 Too Many Requests` | A rate limit was hit; see [Security Configuration](Security-Configuration#account-lockout-and-rate-limits). Behind several proxies also check `TRUST_PROXY_HOPS` |
| All requests seem to come from one IP; rate limits hit everyone | `TRUST_PROXY_HOPS` is lower than the number of proxies in front of the app |
| E-mails are not sent | Configure and test SMTP under *Administration → SMTP* |
| CheckMK connection fails | Point at the CheckMK host directly (not through an SSO proxy) and use an automation user's **automation secret**, not a GUI password |
| Threat feed fetch fails for an internal URL | Feeds may only point to public addresses (SSRF protection) |
| CVE matching is slow | Set `NVD_API_KEY` to raise the NVD rate limit |

## Documents and backups

| Symptom | Cause and fix |
|---|---|
| A document download fails or reports an integrity error | The file is missing or was modified on disk; the startup log lists database entries without a file |
| `backup-meta.json` shows `missing > 0` | Database entries point to documents that are not on disk. Restore them from an infrastructure backup of `UPLOAD_DIR` |
| Documents disappear after every deployment | The deployment syncs the application directory with `--delete` and the uploads live inside it. Exclude the upload directory — see [Upgrading](Upgrading) |
| Restore fails on a permission error | The database user needs the privilege to set `session_replication_role` |

## Reverse proxy

| Symptom | Cause and fix |
|---|---|
| Scanner reports a missing HSTS header | The proxy filters or replaces upstream headers (nginx: a competing `add_header` in the same block) |
| Uploads fail with `413` | Raise the proxy's body size limit (documents up to 25 MB, restores up to 1 GB) |
| MCP clients hang | The proxy buffers `/mcp` or `/sse`; disable buffering — see [MCP Integration](MCP-Integration#reverse-proxy) |

Still stuck? Open an [issue](https://github.com/GRCForge/OpenISMS/issues) with
the version, your install method and the relevant log lines (remove secrets).
