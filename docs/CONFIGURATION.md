# OpenISMS — Installation and Configuration

How to install, configure, update and back up OpenISMS. For hardening a
production instance see [SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md);
for the AI integration see [MCP.md](MCP.md).

---

## Contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [First start](#3-first-start)
4. [Environment variables](#4-environment-variables)
5. [Single sign-on (OIDC)](#single-sign-on-oidc)
6. [Relationship analysis (Apache AGE)](#6-relationship-analysis-apache-age)
7. [E-mail, AI and integrations](#7-e-mail-ai-and-integrations)
8. [Updating](#8-updating)
9. [Backup and restore](#9-backup-and-restore)
10. [Local development](#10-local-development)

---

## 1. Requirements

| Component | Version |
|---|---|
| PostgreSQL | 15 or newer (18 recommended) |
| Apache AGE | optional, for the relationship analysis (bundled in `docker-compose.yml`) |
| Docker / Docker Compose | for the container setups |
| Node.js | ≥ 26.12.1, only for bare-metal installs and development |

OpenISMS runs on PostgreSQL since v3.0.0. MySQL is no longer supported, and
there is no upgrade path from 2.2.x.

---

## 2. Installation

The application is a single container: the backend serves the API, the MCP
endpoint and the web UI on port 3001 (mapped to 8080 in the Compose files).

### Option A — Docker Compose with bundled database (recommended)

PostgreSQL 18 with Apache AGE and the application, built from source:

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
cp .env.example .env
# Set POSTGRES_PASSWORD, JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY, APP_URL
docker compose up -d --build
```

The database port is bound to `127.0.0.1` only. Uploaded documents live in the
volume `uploads_data`, the database in `postgres_data`.

### Option B — Pre-built image with an external database

```bash
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY, APP_URL
export ISMS_VERSION=latest        # or a release, e.g. v3.3.11
docker compose -f docker-compose.ghcr.single.yml up -d
```

Image: `ghcr.io/grcforge/openisms-app`. Tags: `latest` (rebuilt on every merge
to `main`) and the version of each release (`v3.3.11`, `3.3.11`). Pin a version
in production.

### Option C — Install script

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
sudo bash install.sh
```

The interactive script offers:

1. **Docker Compose** — full setup (option A) or the GHCR image (option B)
2. **systemd / bare metal** — installs Node.js and nginx, creates the user
   `isms`, installs to `/opt/isms`, writes the `openisms` service and an nginx
   site. PostgreSQL is not installed; configure it in `.env`. nginx listens on
   port 80 without TLS — add a certificate before you expose the instance
3. **Update** an existing installation
4. **Uninstall**

The script generates `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY` and an
`ADMIN_PASSWORD` when they are empty and shows the admin password at the end.
It also runs non-interactively, e.g. `sudo bash install.sh install 1` or
`sudo bash install.sh update`.

### Option D — `docker run` (e.g. Unraid)

```bash
docker run -d --name openisms --restart unless-stopped \
  -p 8080:3001 \
  -e DATABASE_URL="postgres://isms_user:PASS@192.168.1.100:5432/isms" \
  -e JWT_SECRET="<random, 32+ characters>" \
  -e SESSION_SECRET="<random, 32+ characters>" \
  -e ENCRYPTION_KEY="<random, 32+ characters>" \
  -e APP_URL="https://isms.example.com" \
  -v /mnt/user/appdata/openisms/uploads:/app/uploads \
  ghcr.io/grcforge/openisms-app:latest
```

On Unraid: **Docker → Add Container**, repository
`ghcr.io/grcforge/openisms-app:latest`, network `bridge`, port host `8080` →
container `3001`, path container `/app/uploads` → host
`/mnt/user/appdata/openisms/uploads`, and the variables above.

### URLs

| URL | Purpose |
|---|---|
| `http://localhost:8080` | Web UI and REST API (same origin) |
| `http://localhost:8080/api/health` | Health check |
| `http://localhost:8080/api/docs` | Swagger UI (after login) |
| `http://localhost:8080/mcp` | MCP endpoint |

Put a reverse proxy with TLS in front before you expose the instance — see
[SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md#3-https-reverse-proxy-and-network).

---

## 3. First start

On first start OpenISMS creates all tables, seeds the control and threat
catalogues and creates the administrator `admin@isms.local`.

- If `ADMIN_PASSWORD` is set, that is the password.
- Otherwise a random password is written to
  `<UPLOAD_DIR>/INITIAL_ADMIN_PASSWORD.txt` (in Docker:
  `docker exec openisms-app cat /app/uploads/INITIAL_ADMIN_PASSWORD.txt`, using
  your container's name). The log shows only the path.

Log in, change the password, delete the file, then enable the modules you need
under **Administration → Modules**. The dashboard's *Getting started* panel
walks you through the first steps.

---

## 4. Environment variables

Copy `.env.example` to `.env`; it documents every variable in detail.

### Required

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/isms`. Alternatively `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| `POSTGRES_PASSWORD` | Only for `docker-compose.yml`: password of the bundled database |
| `JWT_SECRET` | Signs session tokens. Random, ≥ 32 characters |
| `SESSION_SECRET` | Signs the short-lived session cookie. Random, ≥ 32 characters |
| `ENCRYPTION_KEY` | Encrypts stored secrets and TOTP seeds; key for audit log signatures. Random, ≥ 32 characters |
| `APP_URL` | Public URL, e.g. `https://isms.example.com`. Used for CORS, SSO callbacks, passkeys, e-mail links and MCP. Comma-separated for several URLs |

### Web and security

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` in the image | Production mode (no implicit `localhost` CORS) |
| `PORT` | `3001` | Listening port |
| `SECURE_COOKIES` | `false` | `true` behind HTTPS once the proxy forwards `X-Forwarded-Proto` |
| `TRUST_PROXY_HOPS` | `1` | Number of reverse proxies in front of the app |
| `HSTS_MAX_AGE` | `31536000` | HSTS max-age in seconds; `0` disables the header |
| `HSTS_INCLUDE_SUBDOMAINS` | on | `false` drops `includeSubDomains` |
| `HSTS_PRELOAD` | off | `true` adds `preload` |
| `WEBAUTHN_RP_ID` | host of `APP_URL` | Passkey relying-party id (your domain) |
| `WEBAUTHN_ORIGIN` | `APP_URL` | Expected passkey origin |
| `RATE_LIMIT_LOGIN_MAX` | `50` | Login attempts per 15 minutes per account |
| `RATE_LIMIT_2FA_MAX` | `20` | TOTP / passkey attempts per 15 minutes per IP |
| `RATE_LIMIT_API_MAX` | `5000` | API requests per 15 minutes per token or IP |
| `RATE_LIMIT_HEAVY_MAX` | `300` | Backup, import, report and discovery requests per 15 minutes |
| `ADMIN_PASSWORD` | random | Password of the initial administrator `admin@isms.local`, only used while the user table is empty |

### Database

| Variable | Default | Description |
|---|---|---|
| `DB_SSL` | off | `require` encrypts without verifying the certificate, `verify` verifies it |
| `DB_SSL_CA` | – | CA certificate for `DB_SSL=verify` |
| `DB_POOL_MIN` / `DB_POOL_MAX` | `2` / `10` | Connection pool |
| `DB_CONNECT_TIMEOUT_MS` | `10000` | Connect timeout |
| `GRAPH_NAME` | `isms` | Name of the AGE graph; only change before first start |
| `GRAPH_REBUILD_ON_START` | `false` | Rebuild the graph from the tables on every start |

### Storage and logging

| Variable | Default | Description |
|---|---|---|
| `UPLOAD_DIR` | `/app/uploads` (Docker), `backend/uploads` otherwise | Every uploaded document — policies, contracts, DPAs, certificates, risk reports, templates. The in-app backup covers exactly this directory |
| `LOG_FILE` | `/app/uploads/app.log` (production), `backend/logs/app.log` (development) | Application log file |
| `LOG_MAX_SIZE` / `LOG_MAX_FILES` | `10M` / `5` | Log rotation |

### Single sign-on

`OIDC_ENABLED`, `OIDC_DISPLAY_NAME`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_CLAIM_MAPPINGS`,
`OIDC_LINK_UNVERIFIED_EMAIL` — see [below](#single-sign-on-oidc).

### MCP

`MCP_CORS_ORIGINS`, `MCP_OAUTH_SCOPES`, `MCP_OAUTH_AUDIENCES`,
`MCP_OAUTH_ALLOWED_CLIENTS`, `MCP_OAUTH_REQUIRED_SCOPE`,
`MCP_OAUTH_AUTO_PROVISION`, `MCP_SECRET`, `MCP_SECRET_ROLE` — see
[MCP.md](MCP.md#10-configuration-reference).

### Integrations and tuning

| Variable | Default | Description |
|---|---|---|
| `NVD_API_KEY` | – | Raises the NVD rate limit for CVE matching |
| `VAPID_EMAIL` | derived from `APP_URL` | Contact address for browser push |
| `PUSH_ENDPOINT_HOSTS` | – | Additional allowed Web Push hosts |
| `TRIAGE_MAX_CHARS` / `TRIAGE_MAX_REF_CHARS` | `40000` / `15000` | Text limits for AI document review |
| `TRIAGE_TIMEOUT_MS` / `DOC_ANALYSIS_TIMEOUT_MS` | `180000` | Timeouts for AI document review |
| `OLLAMA_NUM_CTX` | `32768` | Context size requested from Ollama |
| `KEEPALIVE_TIMEOUT_MS` / `HEADERS_TIMEOUT_MS` | `65000` / `66000` | HTTP keep-alive; keep above the proxy's idle timeout |
| `UV_THREADPOOL_SIZE` | `8` in the image | Worker threads for hashing, compression and parsing |
| `ISMS_VERSION` | `latest` | Image tag for `docker-compose.ghcr.single.yml` |

---

## Single sign-on (OIDC)

SSO works with any OIDC provider: Authentik, Keycloak, Microsoft Entra ID,
Google, Zitadel, Okta, Auth0 and others.

### In the app (no restart needed)
1. **Administration → Security → Single sign-on**
2. Register the redirect URI `<APP_URL>/api/auth/oidc/callback` at the IdP
3. Enter issuer URL, client ID, client secret and scopes
   (`openid profile email`)
4. **Test connection**, then enable SSO
5. Set the allowed domains, default role and claim → role mappings

Authorization Code flow with PKCE; the client secret is stored encrypted. On
the first SSO login a user is created (unless auto-provisioning is off), and
the profile picture from the `picture` claim is synced on every login. Local
login stays available for accounts that are not linked to SSO.

### Through environment variables
For installations rolled out by configuration management:

| Variable | Description |
|---|---|
| `OIDC_ENABLED` | `true` / `false` |
| `OIDC_DISPLAY_NAME` | Label of the login button |
| `OIDC_ISSUER` | Issuer URL |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Client credentials |
| `OIDC_SCOPES` | Requested scopes |
| `OIDC_CLAIM_MAPPINGS` | JSON array of claim → role mappings, e.g. `[{"claim_path":"groups","claim_value":"isms-admins","role":"admin","priority":100}]`. Custom roles are named by name (`"custom_role":"Audit"`) |
| `OIDC_LINK_UNVERIFIED_EMAIL` | Allow taking over a local account without `email_verified=true` (default `false`) |

**The environment wins.** A field set there is read-only in the app, and the
API rejects changes to it with a reason. Values from the environment are never
written to the database, so removing a variable brings back what the database
held. If `OIDC_CLAIM_MAPPINGS` is set but invalid, **no** mappings apply — a
typo must not silently hand out a different role; the reason is logged and
shown in the app.

Security recommendations for SSO are in
[SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md#single-sign-on-oidc).

---

## 6. Relationship analysis (Apache AGE)

Optional. Without the extension everything works except the relationship
analysis page. `docker-compose.yml` brings it along. For an external database,
set it up once as a superuser:

```sql
-- postgresql.conf: shared_preload_libraries = 'age'  (then restart PostgreSQL)
CREATE EXTENSION age;                                -- in the ISMS database
GRANT USAGE ON SCHEMA ag_catalog TO isms_user;       -- the application user
```

Preloading is required: a regular user may not run `LOAD 'age'`. The graph is
maintained by database triggers and can be rebuilt from the tables at any time
(`POST /api/graph/rebuild`, or `GRAPH_REBUILD_ON_START=true`).

---

## 7. E-mail, AI and integrations

All configured in the app; secrets are stored encrypted.

| What | Where | Notes |
|---|---|---|
| SMTP | Administration → SMTP | Needed for password reset, reminders, lockout alerts. Connection test and test mail |
| AI provider | Administration → LLM | Anthropic, OpenAI (or compatible), Google Gemini, Ollama; plus triage profiles |
| CheckMK | Network Discovery → CheckMK | URL of the CheckMK host (not through an SSO proxy), site, a dedicated read-only **automation** user and its automation secret. Self-signed TLS only by explicit choice |
| Threat feeds | Threat Landscape → Sources | Seed the source catalogue, enable auto-fetch per source |
| Browser push | Bell icon | VAPID keys are generated on first start |

---

## 8. Updating

**Docker Compose (bundled database):**

```bash
git pull
docker compose up -d --build
```

**GHCR image:**

```bash
export ISMS_VERSION=v3.3.11   # or latest
docker compose -f docker-compose.ghcr.single.yml pull
docker compose -f docker-compose.ghcr.single.yml up -d
```

**Install script:** `sudo bash install.sh update`.

The schema is updated automatically on start. Before every update, back up the
database and `UPLOAD_DIR`, and read the release notes in [`docs/`](.) — they
name any required action.

---

## 9. Backup and restore

**In the app:** **Administration → Backup** exports a ZIP with all tables and
all uploaded documents; preview shows what a backup contains before you
restore it. Restore runs in one transaction and keeps existing files.

**At the infrastructure level** (recommended in addition):

```bash
# Database (also covers the AGE graph)
docker exec isms-db pg_dump -U isms_user -Fc isms > isms-$(date +%F).dump

# Uploaded documents
docker run --rm -v openisms_uploads_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Adjust container and volume names to your setup (`docker volume ls`). Keep
your `.env` — especially `ENCRYPTION_KEY` — in a separate, safe place: without
it, the encrypted secrets in a backup cannot be used.

Backups contain everything in your ISMS and are **not encrypted** by
OpenISMS. See
[SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md#8-backups).

---

## 10. Local development

Requirements: Node.js ≥ 26.12.1 and PostgreSQL 15+ (Apache AGE optional).

```bash
# Backend
cd backend
cp ../.env.example .env        # set DATABASE_URL and the three secrets
npm install
npm run dev                    # http://localhost:3001

# Frontend (second terminal)
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

Checks that also run in CI:

```bash
node scripts/check-permissions.js     # permission matrix = route fallbacks
node scripts/test-mcp-gate.js         # MCP follows the same contract as REST
node scripts/test-upload-storage.js   # every document under UPLOAD_DIR
cd frontend && npx tsc --noEmit && npm run build
```

Translations are managed with Crowdin; see
[TRANSLATION_STYLEGUIDE.md](TRANSLATION_STYLEGUIDE.md).
