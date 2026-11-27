# OpenISMS — Security Configuration

How to run OpenISMS securely in production: which secrets to set, how to put it
behind HTTPS, which settings to review, and what the application already does
on its own. An ISMS holds the most sensitive map of your organisation — its
weaknesses, risks and incidents — so treat the instance accordingly.

To **report a vulnerability**, see [SECURITY.md](../SECURITY.md). For the full
list of environment variables see [CONFIGURATION.md](CONFIGURATION.md).

---

## Contents

1. [Production checklist](#1-production-checklist)
2. [Secrets and keys](#2-secrets-and-keys)
3. [HTTPS, reverse proxy and network](#3-https-reverse-proxy-and-network)
4. [Roles and permissions](#4-roles-and-permissions)
5. [Authentication](#5-authentication)
6. [Security headers and CORS](#6-security-headers-and-cors)
7. [Data protection](#7-data-protection)
8. [Backups](#8-backups)
9. [Logging and monitoring](#9-logging-and-monitoring)
10. [MCP and API access](#10-mcp-and-api-access)
11. [Known limitations](#11-known-limitations)
12. [Supply chain and CI](#12-supply-chain-and-ci)

---

## 1. Production checklist

**Before first start**
- [ ] `JWT_SECRET`, `SESSION_SECRET` and `ENCRYPTION_KEY` set to three
      **different** random values of at least 32 characters
      ([section 2](#2-secrets-and-keys))
- [ ] `APP_URL` set to the exact public HTTPS URL
- [ ] `NODE_ENV=production` (preset in the Docker image and the systemd unit)
- [ ] Strong, unique database password; PostgreSQL not reachable from the
      network; `DB_SSL=verify` if the database runs on another host
- [ ] `ADMIN_PASSWORD` set, or plan to read and delete
      `INITIAL_ADMIN_PASSWORD.txt` right after the first start

**Network**
- [ ] TLS terminated at a reverse proxy; port 3001 not reachable directly
- [ ] Proxy forwards `X-Forwarded-Proto` and `X-Forwarded-For`; then
      `SECURE_COOKIES=true`
- [ ] `TRUST_PROXY_HOPS` matches the number of proxies in front of the app
- [ ] Strict-Transport-Security arrives at the browser (check with a scanner)

**After first login**
- [ ] Change the admin password; delete `INITIAL_ADMIN_PASSWORD.txt`
- [ ] Set up TOTP or a passkey for every administrator
- [ ] Review the password policy and account lockout
      (**Administration → Security**)
- [ ] Configure SSO, if available, with a domain allow-list and a default
      group with the `viewer` role (or none)
- [ ] Review the role-carrying groups (**Administration → Groups**); after an
      upgrade to v3.10.0, check the groups the migration created
- [ ] Review the permission matrix (**Administration → Roles & permissions**)
- [ ] Disable modules you do not use (**Administration → Modules**)
- [ ] Set the audit log retention to what your retention policy requires
- [ ] Configure SMTP so that lockout and security notifications reach the
      administrators

**Operations**
- [ ] Regular `pg_dump` of the database **and** backups of `UPLOAD_DIR`,
      stored encrypted ([section 8](#8-backups))
- [ ] Restores tested
- [ ] Run `GET /api/audit-log/verify` regularly (or the MCP tool
      `isms_verify_audit_logs`)
- [ ] Stay on the latest release — only the latest release receives security
      fixes

---

## 2. Secrets and keys

| Variable | Used for | If it is missing |
|---|---|---|
| `JWT_SECRET` | Signs session tokens (HS256) | Login fails; the Docker Compose files refuse to start |
| `SESSION_SECRET` | Signs the short-lived session cookie used during SSO, passkey and TOTP setup | Falls back to `JWT_SECRET` |
| `ENCRYPTION_KEY` | AES-256-GCM encryption of stored secrets and TOTP seeds; key for the audit log signatures | Falls back to `JWT_SECRET` |

Generate each value separately:

```bash
openssl rand -hex 32
```

The installer (`install.sh`) generates all three if they are empty, and both
Docker Compose files refuse to start without them. Use three different values:
with the fallbacks, one leaked secret would otherwise compromise sessions,
stored credentials and the audit log signatures at once.

**Store them like database credentials**: in a secret store or a file
readable only by the service user, never in the repository.

### Rotating keys

| Key | What happens when you change it |
|---|---|
| `JWT_SECRET` | Every user is logged out (all session tokens become invalid). API tokens keep working — they are not JWTs |
| `SESSION_SECRET` | SSO, passkey or TOTP setup flows in progress at that moment fail and have to be restarted |
| `ENCRYPTION_KEY` | Stored secrets can no longer be decrypted: re-enter the OIDC client secret, SMTP password, LLM API keys and integration secrets; users have to set up TOTP again. Existing audit log entries can no longer be verified — record the result of `/api/audit-log/verify` before rotating |

When decrypting, OpenISMS tries `ENCRYPTION_KEY` first and `JWT_SECRET`
second, so an installation that ran without `ENCRYPTION_KEY` can add one later
without losing secrets stored under the fallback. New values are then written
with the new key.

---

## 3. HTTPS, reverse proxy and network

OpenISMS speaks plain HTTP on port 3001 and expects TLS at a reverse proxy
(nginx, Traefik, Caddy, a load balancer).

### Reverse proxy
- Forward `Host`, `X-Forwarded-Proto` and `X-Forwarded-For`.
- Pass `/api`, `/mcp`, `/sse` and `/.well-known/` to the application, and do not
  buffer `/mcp` and `/sse` (event streams). See [MCP.md](MCP.md#reverse-proxy)
  for an nginx example.
- Allow request bodies large enough for uploads (documents up to 25 MB, backup
  restores up to 1 GB on `/api/admin/backup`).
- Do not put forward-auth or a second SSO layer in front of `/api`, `/mcp` and
  `/.well-known/` — API and MCP clients cannot pass an interactive login.

> The bare-metal installer configures nginx on **port 80 without TLS**. Add a
> certificate (e.g. with certbot) before you expose the instance.

### `SECURE_COOKIES`
Set `SECURE_COOKIES=true` once the site is served over HTTPS **and** the proxy
forwards `X-Forwarded-Proto: https`. It marks the session cookie `Secure` and
adds `upgrade-insecure-requests` to the CSP. If the proxy does not forward the
header, the cookie is not set at all and SSO and passkey logins fail — which is
why the setting is not derived from `APP_URL`.

### `TRUST_PROXY_HOPS`
The number of proxies between the client and OpenISMS (default `1`). It
determines which `X-Forwarded-For` entry counts as the client IP, and with it
the IP-based rate limits and the IP addresses in the audit log. Too high a value
lets clients spoof their IP and bypass the limits; too low a value makes all
requests appear to come from the proxy.

### HSTS
`Strict-Transport-Security` is sent with a max-age of one year and
`includeSubDomains` by default. Browsers ignore it over plain HTTP, so the
default is safe for HTTP-only test setups.

| Variable | Default | Effect |
|---|---|---|
| `HSTS_MAX_AGE` | `31536000` | `0` disables the header |
| `HSTS_INCLUDE_SUBDOMAINS` | on | `false` drops `includeSubDomains` |
| `HSTS_PRELOAD` | off | `true` adds `preload` — only if the domain and **all** subdomains are permanently HTTPS |

If a scanner reports a missing HSTS header, the proxy is filtering or
replacing upstream headers (for nginx, a competing `add_header` in the same
block resets inherited headers).

### Database
- `docker-compose.yml` binds PostgreSQL to `127.0.0.1` only. Keep it that way.
- For a database on another host use `DB_SSL=verify` with `DB_SSL_CA`.
  `DB_SSL=require` encrypts but does **not** verify the server certificate.
- Without `DATABASE_URL` or `DB_PASSWORD` the code falls back to the
  development password `isms_password` — always set credentials explicitly.
- The application user needs the privilege to set `session_replication_role`
  for backup restores; it does not need superuser rights otherwise.

### Single instance
The short-lived session store (used during SSO, passkey and TOTP setup) and MCP
sessions live in process memory. Run **one** application instance per
database, or pin clients to an instance with sticky sessions.

---

## 4. Roles and permissions

Since v3.10.0 access is built from three parts:

- **Permission objects** — one per module and action, e.g. `incidents.edit`.
- **Roles** — named sets of permission objects: the eight built-in roles and
  any number of custom roles.
- **Groups** — carry roles. A user receives roles **only through groups**,
  never directly, and receives every role of every group they belong to.

Roles combine **allow-only**: if any of a user's roles allows an action, the
user may perform it. There is no deny. A user in no role-carrying group has
**no role** and can only manage their own account.

### Built-in roles

| Role | Intended for | Write access |
|---|---|---|
| `admin` | Administrators: users, permissions, settings, modules, backups | yes |
| `assessor` | ISMS officers: assessments, risks, incidents, controls, policies | yes |
| `it-staff` | IT operations: assets and security fields, discovery, vulnerabilities | yes |
| `dpo` | Data protection officer: processing register, DPIA, classification, data subject requests | yes |
| `owner` | Asset owners: their own assets | limited |
| `management` | Management: reports and released areas | **no** |
| `employee` | Employees: own trainings, policy acknowledgements | **no** |
| `viewer` | Read-only access | **no** |

`management`, `employee` and `viewer` stay read-only even if the permission
matrix grants them a write action. A user is read-only only if **all** of their
roles are read-only — a viewer who also belongs to an assessor group can write.

### Permission matrix
**Administration → Roles & permissions** defines, per module and action (view,
create, edit, delete, export, …), which roles may do what. Changes take effect
without a restart and can be reset to the defaults.

The matrix is enforced on the server, the same way on every path:

| Path | Enforcement |
|---|---|
| REST API | `requirePermission(module, action, …)` on each route |
| MCP | The same check in the tool gate, per tool |
| Field-level rules | Checked in the handler — e.g. `assets.edit_compliance` for classification, `assets.edit_security` for patch and hardening fields |
| UI | Only hides what the user cannot do; never the gate |

Each check follows one contract: **the matrix decides** wherever it defines the
action; **where it says nothing**, the role list of the endpoint decides; **a
failed lookup denies**. Two CI checks keep this honest:
`scripts/check-permissions.js` (matrix defaults equal the route fallbacks) and
`scripts/test-mcp-gate.js` (MCP follows the same contract as REST).

Deliberately **not** matrix-gated: logging in and managing your own account
(password, TOTP, passkeys, own API tokens, own notifications, acknowledging a
policy). Gating those on an editable matrix would let an installation lock
every user out of their own account.

### Custom roles
**Administration → Security → Custom roles**: a name, a base role and optionally
a permission set of its own, which then replaces the global matrix for that
role. The base role decides the write protection and the role-based rules that
are not yet permission objects. Like built-in roles, custom roles reach users
only through groups. A custom role that sets an action to `false` does not take
it away from a user whose other roles allow it.

### Groups
**Administration → Groups**: every group can carry any combination of built-in
and custom roles. Groups without roles are plain teams for task assignment and
@-mentions and grant nothing.

- Assigning roles to a group, deleting a group that carries roles, and changing
  the members of such a group require the permission **`admin.roles`** in
  addition to `groups.manage`. A user who may only manage teams cannot hand out
  permissions.
- No change — removing a member, changing a group's roles, deleting a group or
  a custom role, deactivating a user, an SSO sync — may leave the installation
  without an **active administrator**; such a change is rejected with `409`.
- Administrators cannot remove the administrator role from themselves.
- Every change to group roles and memberships is written to the audit log.

`users.role` is kept as a cache of the most privileged role for display and
filtering (`none` if the user has no role). Access decisions never read it.

### Upgrading to v3.10.0
The first start migrates automatically and keeps every user's access as it was:
one group per role in use (*Administrators*, *Assessors*, …, *Role: <custom
role>*), every user in the group of their former role, OIDC mappings and the SSO
default role moved to groups. Existing groups are left untouched and carry no
roles. Review the new groups afterwards — see
[RELEASE-NOTES-v3.10.0.md](RELEASE-NOTES-v3.10.0.md).

### Recommendations
- Keep the number of administrators small; give everyday ISMS work the
  `assessor` role.
- Use a group with the `viewer` role (or no default group at all) as the SSO
  default group and grant more through claim mappings.
- Keep role-carrying groups separate from plain teams, so adding someone to a
  team never grants permissions by accident.
- Restrict delete actions to the roles that really need them.
- Review the matrix after every upgrade that adds a module.
- An administrator cannot deactivate or demote themselves, and users are
  deactivated rather than deleted, so their audit history stays attributable.

### Modules
Modules that are switched off answer `403` on their API and are hidden in the
UI. Switch off what you do not use — it reduces the attack surface. (The `mcp`
switch is an exception, see [MCP.md](MCP.md#enabling-and-disabling).)

---

## 5. Authentication

### Initial administrator
On first start (empty user table) OpenISMS creates `admin@isms.local` with
the role `admin`.

- With `ADMIN_PASSWORD` set, that password is used.
- Without it, a random password is written to
  `<UPLOAD_DIR>/INITIAL_ADMIN_PASSWORD.txt` (mode `0600`). The log shows only
  the path, never the password. The file is excluded from backups.

Log in, change the password, **then delete the file**. If you used
`ADMIN_PASSWORD`, remove it from the environment afterwards — it is only read
when the user table is empty. Nothing forces the password change, so make it a
step of your rollout.

### Passwords
- Hashed with bcrypt, cost factor 12.
- **Password policy** (**Administration → Security**): minimum length (default
  10) and required upper-case letter, digit and special character (all on by
  default). It applies when users set or reset a password and when
  administrators create or change users.
- Changing or resetting a password **invalidates every session token** issued
  before; the session that made the change receives a fresh token.
- **Password reset** by e-mail: the token is valid for one hour and stored only
  as a SHA-256 hash. The response is the same whether or not the address exists.
  SSO users get a reminder to log in via SSO instead of a reset link.
- Login responses are generic, and the login runs a dummy hash comparison for
  unknown users so that response times do not reveal which addresses exist.

### Account lockout and rate limits
- **Account lockout** (**Administration → Security**): after 5 failed attempts
  (default) the account is locked for 15 minutes (default). Failed TOTP codes
  count too.
- **IP alarm:** after 10 failed logins from one IP within 15 minutes, further
  attempts from that IP are refused and administrators are notified in the app
  and by e-mail.
- **Rate limits** per 15 minutes:

| Endpoint | Default | Variable |
|---|---|---|
| Login | 50 per account (or IP) | `RATE_LIMIT_LOGIN_MAX` |
| TOTP, passkey login, 2FA setup | 20 per IP | `RATE_LIMIT_2FA_MAX` |
| Forgot / reset password | 5 | – |
| Whole API (incl. MCP) | 5000 per token or IP | `RATE_LIMIT_API_MAX` |
| Backup, import, reports, discovery | 300 per token or IP | `RATE_LIMIT_HEAVY_MAX` |
| Document and policy downloads | 60 per 5 minutes | – |

### Sessions
- After login the browser receives a session token (JWT, HS256) valid for
  **24 hours**. There is no idle timeout and no refresh token; logging out
  discards the token in the browser.
- The token is sent in the `Authorization` header, not in a cookie, so
  cross-site request forgery does not apply to the API. It is kept in the
  browser's local storage — which is why the strict Content-Security-Policy
  ([section 6](#6-security-headers-and-cors)) matters.
- Deactivating a user blocks their tokens immediately.

### Multi-factor authentication
- **TOTP** (RFC 6238) with an authenticator app. Each code can be used only once
  (replay protection), and the secret is stored encrypted. Disabling TOTP
  requires a valid code.
- **Passkeys** (WebAuthn / FIDO2): hardware keys, Touch ID, Face ID, Windows
  Hello, with user verification required. Set `WEBAUTHN_RP_ID` (your domain) and
  `WEBAUTHN_ORIGIN` (your `APP_URL`) when you use passkeys behind a proxy.
- MFA is **not enforceable** by a setting. The task automation creates a task
  for every user who has not set up MFA seven days after their account was
  created. Require MFA for administrators by policy, or enforce it at your IdP
  and use SSO.

### Single sign-on (OIDC)
Authorization Code flow with PKCE and `state`; the client secret is stored
encrypted. Settings that matter for security (**Administration → Security**):

| Setting | Recommendation |
|---|---|
| Allowed domains | Set them. Only addresses of these domains may log in via SSO |
| Auto-provisioning | Leave on only if every account at the IdP should have access |
| Default group | A group with the `viewer` role, or none (new SSO users then have no access until an administrator adds them to a group) |
| Strict group sync | On, if the IdP is the source of truth: memberships the IdP granted (source `sso`) are removed when no mapping grants them any more. Memberships added by hand are kept; the last administrator is never removed |
| Claim → group mappings | Map IdP groups to OpenISMS groups. **Every** matching mapping applies; the user receives the roles of all those groups |

- Addresses the IdP explicitly marks as unverified (`email_verified=false`) are
  rejected.
- An SSO login only takes over an existing **local** account if the IdP says
  `email_verified=true`. `OIDC_LINK_UNVERIFIED_EMAIL=true` relaxes this — leave
  it off unless your IdP verifies addresses but does not send the claim.
- Accounts linked to SSO can no longer log in with a password, a passkey or
  TOTP; MFA is then the IdP's job.
- Pinning SSO through `OIDC_*` environment variables makes those fields
  read-only in the app. `OIDC_CLIENT_SECRET` from the environment is used as
  given and not stored in the database.
- The issuer should use HTTPS; OpenISMS accepts an HTTP issuer for lab setups.

### API tokens
- Format `isms_api_` + 64 hex characters; stored only as a SHA-256 hash and
  shown once.
- A token acts with its owner's full role — there are no token scopes. Create
  tokens for dedicated users with the smallest role that works.
- Always set an expiry date. Expired tokens are rejected and removed nightly.
- Tokens are accepted in the `Authorization: Bearer` header and in `X-API-Key`.
  Since v3.5.1 the REST API accepts a token in the query string only for
  server-sent event streams (`GET` with `Accept: text/event-stream`), because
  `EventSource` cannot set headers. On every other request a query token is
  ignored. The server log redacts query tokens, but proxies may not.

---

## 6. Security headers and CORS

Set by the application (helmet), no configuration needed:

- **Content-Security-Policy** with a per-request nonce:
  `default-src 'self'`, `script-src 'self' 'nonce-…'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'`,
  `connect-src 'self'`. No inline scripts and no third-party script sources.
- **Strict-Transport-Security** (see [section 3](#hsts))
- **X-Content-Type-Options: nosniff**, **Referrer-Policy: no-referrer**,
  **X-Frame-Options** and the other helmet defaults
- **Permissions-Policy** disabling camera, microphone, geolocation, USB,
  payment and similar features; only fullscreen, clipboard-write and WebAuthn
  are allowed for the site itself

**CORS:** the API only answers browsers from the origins in `APP_URL`
(comma-separated for several). In production, `localhost` origins are not
allowed implicitly. The MCP endpoint has its own origin policy
(`MCP_CORS_ORIGINS`, see [MCP.md](MCP.md#browser-origins-cors)).

The OpenAPI specification and Swagger UI require authentication, so the API
surface is not exposed anonymously.

---

## 7. Data protection

### Encryption at rest
AES-256-GCM with a key derived from `ENCRYPTION_KEY`:

| Encrypted | Not encrypted by the application |
|---|---|
| OIDC client secret (stored in the app) | Business data in the database (assets, risks, incidents, …) |
| SMTP password | Uploaded documents |
| LLM provider API keys | The Web Push (VAPID) private key |
| Integration secrets (CheckMK) | `OIDC_CLIENT_SECRET` set through the environment |
| TOTP secrets | |

Protect database and upload storage with disk or volume encryption, and keep
`ENCRYPTION_KEY` out of database backups.

### Audit log
- Every change — including logins, failed logins, lockouts, permission and
  module changes — is logged with actor, time, IP and before/after values.
- Each entry is signed with HMAC-SHA256 over its content. `GET
  /api/audit-log/verify` (admin) reports intact, modified and unverifiable
  entries. Rows are verified independently: the check detects a modified entry,
  not a deleted one.
- Retention: default 15 months, minimum 3, purged nightly. Set it to your
  retention policy (**Administration → Security**).

### Uploads
- All documents live in one directory, `UPLOAD_DIR` (Docker: `/app/uploads`).
- Allow-lists for extensions (PDF, Office, text, images, ZIP for documents) and
  for MIME types, plus a check of the file signature (magic bytes).
- Size limits: 25 MB for documents and templates, 20 MB for policies, 10 MB for
  imports.
- Stored under random file names; paths are confined to `UPLOAD_DIR`
  (path-traversal protection).
- A SHA-256 hash is stored on upload and checked on every download.
- Only PDF and images are shown inline, with the content type set by the server;
  everything else is downloaded.
- Contracts are hidden from the `it-staff` and `viewer` roles.

### Outbound connections
| Target | Protection |
|---|---|
| Threat feeds, profile pictures from the IdP | Only public IP addresses (private, loopback, link-local and similar ranges blocked, also via IPv6 mappings), no redirects, size and time limits |
| Web Push | HTTPS to known push services only (extend with `PUSH_ENDPOINT_HOSTS`) |
| CheckMK | Administrator-configured URL; TLS verification on unless "accept self-signed" is chosen |
| CVE sources | Fixed hosts (NVD, OSV.dev, Shodan CVEDB) |
| LLM providers, OIDC issuer | Administrator-configured URLs |
| Network scan | Private ranges only (RFC 1918), at most a /24 and 50 ports, admin and it-staff only |

If your security policy requires it, restrict outbound traffic of the container
to the hosts you actually use (IdP, SMTP, LLM provider, CVE sources, threat
feeds).

### AI features
Vendor triage and document analysis send document text to the configured LLM
provider. Use Ollama to keep documents inside your network, or check that the
provider's data processing terms fit the documents you analyse.

---

## 8. Backups

**The in-app backup** (**Administration → Backup**, admin only) creates a ZIP
with every table and every uploaded document.

What you need to know:

- **The ZIP is neither encrypted nor signed.** It contains everything in the
  ISMS, including password hashes and the encrypted secrets (which are only as
  safe as `ENCRYPTION_KEY`). Store it encrypted and with restricted access.
- With the default production log location (`/app/uploads/app.log`, inside
  `UPLOAD_DIR` in the Docker image) the application log ends up in the ZIP as
  well. Set `LOG_FILE` to a path outside `UPLOAD_DIR` if you do not want that.
- `INITIAL_ADMIN_PASSWORD.txt` is excluded (since v3.3.2). Backups made earlier
  contain it if the file still existed.
- `backup-meta.json` records how many files the backup contains and how many
  database entries point to a missing document. `missing` should be `0`.
- Restore validates tables and columns against the live schema, runs in one
  transaction, and writes files without following symbolic links or leaving
  `UPLOAD_DIR`. Existing files are kept (overlay), never deleted.

**In addition**, back up at the infrastructure level:
- `pg_dump` of the database (also covers the Apache AGE graph)
- the `UPLOAD_DIR` volume
- your `.env` / secrets — **separately** from the data backups; without
  `ENCRYPTION_KEY` the encrypted secrets in a backup cannot be used

Test restores regularly.

---

## 9. Logging and monitoring

- **Application log:** stdout and a rotating file (`LOG_FILE`, 10 MB × 5 files
  by default; `LOG_MAX_SIZE`, `LOG_MAX_FILES`). Every request is logged; tokens,
  codes and passwords in query strings are redacted, and line breaks are
  stripped to prevent log injection.
- **Security events in the audit log:** logins, failed logins, lockouts, SSO
  role changes, permission and module changes, backups and restores.
- **Notifications to administrators:** repeated failed logins from one IP.
- **Health check:** `GET /api/health` for your monitoring; `GET /api/version`
  returns the running version.

Forward the application log to your SIEM and alert on lockouts and on audit log
verification failures.

---

## 10. MCP and API access

The MCP server and the REST API use the same authentication, permission matrix
and module switches as the UI. For MCP specifically:

- Prefer personal API tokens with an expiry, or OAuth via your IdP.
- Do not use `MCP_SECRET` (deprecated: no expiry, no person behind it). If you
  must, keep `MCP_SECRET_ROLE=viewer`.
- IdP tokens must name `<APP_URL>/mcp` as audience; tokens issued for other
  applications are rejected.
- Leave `MCP_CORS_ORIGINS` empty unless a browser-based client needs access.
- To switch MCP off, block `/mcp` and `/sse` at the proxy.

Details: [MCP.md](MCP.md).

---

## 11. Known limitations

Stated plainly, so that you can compensate where your requirements need it:

| Limitation | Compensating measure |
|---|---|
| No enforced MFA setting; no session idle timeout (sessions last 24 h) | Enforce MFA at the IdP and use SSO; require MFA for administrators by policy |
| No password history, expiry or breached-password check | Use SSO with your IdP's password policy |
| API tokens have no scopes | Dedicated users with minimal roles for each integration |
| In-app backups are not encrypted | Encrypt the backup storage; restrict access |
| Audit log rows are signed individually, not chained | Forward the audit log or the database to a write-once store if you need deletion evidence |
| The `mcp` module switch does not block the endpoint | Block `/mcp` and `/sse` at the reverse proxy |
| Session store in memory | Run a single instance |
| Administrator-configured outbound URLs (LLM, OIDC issuer, CheckMK) are not restricted to public addresses | Restrict outbound traffic at the network level; only administrators can set them |

---

## 12. Supply chain and CI

- **Container image:** `ghcr.io/grcforge/openisms-app`, built from
  `node:*-alpine` with all OS packages upgraded at build time, runs as an
  unprivileged user (UID 1000), contains only production dependencies.
  Telemetry of build tools is disabled.
- **CI on every change** (`.github/workflows/security.yml`): CodeQL
  (security-extended), Trivy (vulnerabilities, secrets, misconfiguration),
  Gitleaks (full history), npm audit, Snyk, SonarQube, plus build, smoke and
  consistency tests (permission contract, MCP gate, upload storage).
- **Dependabot** checks npm and GitHub Actions daily; minor and patch updates
  are merged automatically once all required checks pass.
- Only the latest release receives security fixes — see
  [SECURITY.md](../SECURITY.md).
