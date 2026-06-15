# OpenISMS – Information Security Management System

![Build & Publish](https://github.com/grcforge/openisms/actions/workflows/docker-publish.yml/badge.svg)
![Security & Quality](https://github.com/grcforge/openisms/actions/workflows/security.yml/badge.svg)
![Version](https://img.shields.io/badge/version-2.2.4-blue)
![License](https://img.shields.io/badge/license-Source--Available-red)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Docker](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)
![ISO 27001](https://img.shields.io/badge/ISO%2027001-compliant-4CAF50)
![NIS-2](https://img.shields.io/badge/NIS--2-supported-orange)
![GDPR](https://img.shields.io/badge/GDPR-supported-purple)

OpenISMS is a complete, practice-oriented Information Security Management System (ISMS) built on Node.js, React and MySQL — a GRCForge project designed to support **ISO 27001**, **NIS-2**, **GDPR**, **EU AI Act**, **TISAX**, **DORA** and **BSI C5**.

> **Default login after initial setup:** `admin@isms.local` / `Admin1234!` — change immediately.
> These credentials appear **only** in this README. For security reasons they are **not** pre-filled on the application login screen.

---

## Table of Contents

1. [Screenshots](#screenshots)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Installation](#installation)
5. [Environment Variables](#environment-variables)
6. [Single Sign-On (OIDC)](#single-sign-on-oidc)
7. [Roles & Permissions](#roles--permissions)
8. [API Documentation](#api-documentation)
9. [MCP Server (AI Integration)](#mcp-server-ai-integration)
10. [Database Schema](#database-schema)
11. [Directory Structure](#directory-structure)
12. [Compliance Modules](#compliance-modules)
13. [Compliance Coverage](#compliance-coverage)
14. [Security Notes](#security-notes)

---

## Screenshots

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Asset Management
![Asset Management](docs/screenshots/assets.png)

### Risk Register & Risk Matrix
![Risk Register](docs/screenshots/risks.png)

### Compliance Overview
![Compliance Overview](docs/screenshots/compliance.png)

### Incident Management
![Incident Management](docs/screenshots/incidents.png)

### Administration
![Administration](docs/screenshots/administration.png)

---

## Features

### Dashboard & Onboarding
- KPI cards: total/active assets, high/critical risks, overdue reviews, compliance coverage
- Risk distribution and classification charts as bar graphs
- Compliance framework coverage (ISO 27001, NIS-2, GDPR) with progress bars
- Live activity feed from the audit log
- **"Getting Started" card** for new users with a guided 4-step workflow
- All empty states include explanatory help texts and direct entry buttons

### Asset Management
- Complete asset register per ISO 27001 Annex A.8
- **Asset types:** Hardware · Software · Application · Service · Information/Data · Process · Personnel · **AI Application (AI Act)** · **AI Agent** · Other
- **Classification:** Public · Internal · Confidential · Secret
- **Hosting type:** On-Premise · Public Cloud · Private Cloud · Hybrid
- **Lifecycle status:** Evaluation · Production · Maintenance · Archived
- Patch status, CVE counters (critical/high/medium/low), EOL date, hardening status
- Backup plan, last restore test
- RTO (Recovery Time Objective) and RPO (Recovery Point Objective) per asset
- NIS-2 relevance tagging
- Parent/child dependency structure (hierarchical relationships)
- Business owner and assessor assignable; external vendor linkable
- Compliance frameworks and tags per asset
- **Tab-contextual edit mode**: Edit button opens the matching sub-section depending on the active tab (Master data / Compliance / Security) with granular role permissions
- Filter by type, classification, hosting, status, lifecycle, free text

### Asset Topology
- Interactive dependency graph of all assets (Mermaid-based)
- **Type-specific node shapes**: Hardware=Rectangle, Software/App=Rounded, Data=Cylinder, Service=Diamond, AI=Circle, Process=Slanted
- **Subgraph clustering**: parent and child assets are visually grouped
- Risk colour coding; AI assets highlighted in purple
- **Clickable nodes** (direct jump to asset via SVG post-processing), type filter, horizontal/vertical layout
- Per asset: own dependency graph (grandparents → parents → current → children → grandchildren) with colour-coded levels and legend
- **Reverse links**: list of all dependent assets (child assets) visible and clickable in the Topology tab

### Risk Assessment (CIA Triad)
- Assessment based on **Confidentiality (C)**, **Integrity (I)**, **Availability (A)** on a scale of 1–5
- Automatic risk calculation: score + level (Low / Medium / High / Critical)
- Full assessment history per asset with trend indicators (↑ ↓ =)
- Notes, measures, risk treatment workflow (Reduce / Accept / Transfer / Avoid)
- Next review automatically pre-calculated; reminder created automatically

### Risk Register (ISO 27005)
- Complete risk register with a 5×5 risk matrix (likelihood × impact)
- Inherent risk and residual risk assessed separately
- **Risk acceptance tracking**: management sign-off with expiry date, early warning at ≤ 30 days, red indicator for expired acceptances
- Risk treatment plan, assigned risk owner
- Linked to assets, threats and controls
- Interactive risk matrix as a click filter
- CSV and Excel export

### Incident Management
- Complete incident documentation per NIS-2 Art. 23
- **Categories**: Malware · Phishing · Data Breach · DoS/DDoS · Unauthorised Access · Misconfiguration · Loss/Theft · Social Engineering
- Severity (Low to Critical) and status history (Reported → Under Investigation → Contained → Resolved → Closed)
- **NIS-2 reporting deadlines**: automatic calculation of 24h early warning and 72h full notification from detection time, with overdue warning
- Additional fields: impact, root cause analysis, corrective measures, **lessons learned**, number of affected systems
- **Data breach details** (visible when category is "Data Breach" or NIS-2 reporting obligation applies)
- **External reference number** for authority notifications (BSI, supervisory authority etc.)
- Linked to affected assets and risks
- Severity statistics cards, CSV/Excel export

### Controls & Statement of Applicability (SoA)
- Complete controls database: ISO 27001 (Annex A), NIS-2, BSI Grundschutz, custom controls
- **Control types**: Organisational · Personnel · Physical · Technical
- Status: Implemented · Planned · Not applicable (with justification)
- Linked to risks with effectiveness rating (1–5)
- SoA overview filtered by framework

### Policy Library
- Central management of policies, guidelines, procedures, contracts
- Versioning with history (every saved version downloadable)
- Validity period (`valid_from` / `valid_until`), status (Draft / Active / Withdrawn)
- Linked to assets
- File upload (PDF, Word, etc.)

### Compliance Overview
- Detail page per framework (ISO 27001 · NIS-2 · GDPR) with coverage ring
- List of assigned and unassigned assets
- Warning for assets without framework assignment
- Quick assignment directly from the overview
- **GDPR gap detection**: automatic identification and listing of all assets processing personal data (Art. 6/9) without a complete VVT entry

### Management Report & KPI Dashboards
- Consolidated report for management (print-optimised / PDF export)
- **ISMS Health Score** (0–100): gauge chart from control coverage, assessment grade, overdue reviews and critical risks
- **9 auto KPI cards** with sparklines and trend arrows (↑/↓/→): health score, control coverage, assessment coverage, open high risks, overdue reminders, task completion rate, MTTR (90 days), total assets, open incidents
- **Three tabs:**
  - *Overview*: KPI cards, donut charts (risk distribution, control status, task status), alert rows, manual KPIs
  - *Trends*: 12-month history charts (incidents, risks, assets, tasks) with recharts; KPI target lines
  - *Details*: NIS-2 assets, GDPR overview, risk acceptances, overdue reviews
- **Manual KPIs** (name, target value, unit, measurement frequency) with measurement history and target reference line
- Expiring acceptances (≤ 60 days), critical/high risks, open incidents
- Excel export including VVT register (Art. 30)

### Annual Review Reminders
- Automatic reminder 1 year after each assessment
- Daily cron job marks overdue reviews as `overdue`
- Red badge in navigation, bell menu with detail overview
- Acknowledgement with timestamp

### Asset Documents
- File upload (drag & drop): PDF, Word, Excel, PowerPoint, images – max. 25 MB
- **Categories**: Contract · DPA · Policy · Certificate · Risk Report · Risk Acceptance · Other
- Download, delete, display of uploader and date

### Comments
- Comments/meeting notes per asset with optional date reference
- Markdown formatting (bold, italic, links, file links)
- Only the author or an administrator can delete their own comments

### External Vendors & Supply Chain
- Management of external companies (IT service providers, cloud vendors, software vendors, support, consultants)
- Multiple contacts per company (name, email, phone, function)
- Asset → vendor link for NIS-2 supply chain documentation
- Collapsible list view with direct mailto: link

### Export & Import
- **Export**: CSV (UTF-8/BOM, Excel-compatible) and Excel (`.xlsx`) on all list pages
- **Import**: CSV and **Excel import** (`.xlsx`) for assets, users, vendors, risks, and a combined "Companies + Contacts" view
- Microsoft 365 Quickstart: typical M365 services as a pre-built import template

### Network Discovery & Staging
- **Network scan import**: discovered hosts land in an **approval queue** (staging) rather than being created as assets directly
- **Agent discovery**: locally installed agent reports installed software → also goes to staging
- Overview table with source badge (Network Scan / Agent), type (Hardware/Software), open ports
- Per entry: **Approve** (asset is created), **Ignore** or reject
- Deduplication: already known IPs are not staged again

### VVT – Processing Register (Art. 30 GDPR)
- Complete processing register with all Art. 30 mandatory fields
- **DPIA obligation indicator** (Art. 35) with warning banner in the form and purple badge in the list
- **Last review** date per entry with chip in the list
- 8 pre-built templates (incl. CCTV, access control, employee monitoring)
- Statistics cards: Total, Active, Draft, Art. 9 processing activities, DPIA-required

### Notifications
- Bell menu: overdue, soon-due and never-assessed assets
- Optional native browser notifications (Web Notifications API)

### Audit Log
- Comprehensive logging: assets, assessments, risks, controls, incidents, users, vendors, documents, settings, logins
- Filter by entity type, action, date, name; pagination; expandable before/after details
- Configurable retention period (automatic cleanup via cron)
- CSV/Excel export

### User Management & Authentication
- **Roles (8)**: Administrator · Assessor · IT Staff · DPO · Asset Owner · Management · Employee · Guest (Viewer)
- **Custom Roles**: create custom roles (name, description, base role) and assign them directly to users — in addition to OIDC group mapping
- Create, edit, deactivate users (no hard delete)
- Local login (email + password, JWT 24 h) with password policy enforcement
- **Two-factor authentication (TOTP)**: TOTP authenticator app (RFC 6238) with replay protection
- **Passkeys (WebAuthn)**: hardware keys, Touch ID, Face ID; FIDO2 / WebAuthn Level 2
- **SSO (OIDC)**: generic for any OIDC provider (Authentik, Keycloak, Entra, Google, Zitadel …)
  - Configuration in the app under *Administration → Single Sign-On* (no restart required)
  - Authorization Code Flow with PKCE; client secret AES-256-GCM encrypted in DB
  - **Profile picture** from the `picture` claim is automatically synced on every login
  - Auto-provisioning with configurable default role; OIDC groups → role mapping
- Brute-force protection: IP rate limiting + account-based lockout after configurable failed attempts
- SSO exclusivity: SSO accounts automatically disable local authentication paths (passkey, TOTP)

### RBAC – Role & Permission Editor
- Configurable permission matrix per module and action (e.g. `assets.edit_security` only for Assessor and IT Staff)
- **Modules**: Assets (master data/compliance/security separate), Risks, Incidents, Assessments, Controls, Policies, Reminders, Vendors, Import, Reports, Administration
- Changes directly in the app under *Administration → Roles & Permissions*
- Reset to factory defaults at any time

### Groups & Teams
- **Create groups** (name, description, colour) and assign users
- **Group tasks**: task assigned to a group instead of an individual; as soon as one member completes the task it is marked as done for everyone (**"first-to-complete"** semantics)
- Who completed a group task is displayed on the task
- **@group mentions** in comments: all members of the group receive a notification
- Group management under *Groups* (administrators only)

### API Documentation
- **OpenAPI 3.0 specification** at `/api/openapi.json`
- **Swagger UI** at `/api/docs` — interactive with JWT authentication in the browser
- All endpoints documented: assets, risks, incidents, assessments, controls, policies, users, admin, dashboard, audit log, vendors, import, system

### Administration
- Consolidated admin area (`/admin`, administrators only):
  - **Users** – create, assign roles, deactivate, last activity
  - **Audit Log** – filtered with configurable retention period
  - **Single Sign-On** – OIDC configuration with connection test
  - **Settings** – app name, review interval, password policies, SSO options
  - **Security** – password policy, session configuration
  - **Roles & Permissions** – RBAC matrix editor
  - **API Documentation** – links + authentication guide

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js 22 · Express 5 · Sequelize ORM |
| Database | MySQL 8.0 |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS 4 |
| Authentication | JWT (24 h) · OIDC SSO (openid-client, PKCE) |
| Security | helmet · rate-limit · CORS · AES-256-GCM |
| File Upload | multer (Disk Storage, max. 25 MB) |
| Visualisation | Mermaid.js (Topology) · recharts (KPI charts, trend history) |
| Scheduling | node-cron (overdue job, audit retention) |
| Export | SheetJS (xlsx) · CSV |
| API Docs | OpenAPI 3.0 · Swagger UI (CDN) |
| Deployment | Docker (single container, GHCR) · systemd · install.sh |

---

## Installation

### Option A: Install Script (recommended)

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
sudo bash install.sh
```

Interactive dialog lets you choose between:
- **Docker Compose** – everything as containers (recommended)
- **Systemd** – backend as `openisms.service`, frontend via nginx

### Option B: Pre-built GHCR image (no local build)

```bash
cp .env.example .env
# Set DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, APP_URL

export ISMS_VERSION=latest   # or e.g. v1.6.0
docker compose -f docker-compose.ghcr.single.yml up -d
```

Available image tags: `latest` (main) · semantic versions (`v1.6.0`, `1.6`, `1`)

### Option C: Build from source

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
cp .env.example .env
docker compose -f docker-compose.single.yml up -d --build
```

### Option D: `docker run` directly (e.g. Unraid)

```bash
docker run -d --name isms --restart unless-stopped \
  -p 8080:3001 \
  -e DATABASE_URL="mysql://isms_user:PASS@192.168.1.100:3306/isms" \
  -e JWT_SECRET="<min-32-char-random-value>" \
  -e ENCRYPTION_KEY="<min-32-char-random-value>" \
  -e APP_URL="http://192.168.1.50:8080" \
  -v /mnt/user/appdata/isms/uploads:/app/uploads \
  ghcr.io/grcforge/openisms-app:latest
```

| URL | Description |
|---|---|
| `http://localhost:8080` | Web UI and REST API (same origin) |
| `http://localhost:8080/api/health` | Health check |
| `http://localhost:8080/api/docs` | Swagger UI (API documentation) |

**On first start** the app creates all tables, seeds the ISO 27001/NIS-2/BSI controls catalogue and creates a default administrator.

#### Unraid (step by step)

1. Docker → **Add Container** → Repository: `ghcr.io/grcforge/openisms-app:latest`
2. Network Type: `bridge` · Port: Host `8080` → Container `3001`
3. Path: Container `/app/uploads` → Host `/mnt/user/appdata/isms/uploads`
4. Add variables:

| Key | Example |
|---|---|
| `DATABASE_URL` | `mysql://isms_user:PASS@192.168.1.100:3306/isms` |
| `JWT_SECRET` | long random value |
| `ENCRYPTION_KEY` | long random value |
| `APP_URL` | `http://<UNRAID-IP>:8080` |
| `SECURE_COOKIES` | `true` only behind HTTPS proxy |

5. **Apply** → open `http://<UNRAID-IP>:8080`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✓¹ | `mysql://user:pass@host:3306/isms` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | ✓¹ | Alternative to `DATABASE_URL` |
| `JWT_SECRET` | ✓ | Token signing key (≥ 32 characters) |
| `ENCRYPTION_KEY` | recommended | AES-256 key for OIDC secret encryption |
| `SESSION_SECRET` | recommended | Express session (OIDC flow) |
| `APP_URL` | ✓² | Public URL (for OIDC callback and CORS) |
| `SECURE_COOKIES` | – | `true` behind an HTTPS reverse proxy |
| `PORT` | – | Default: `3001` |
| `UPLOAD_DIR` | – | Default: `/app/uploads` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | – | Override the seed administrator credentials |

¹ One of the two. ² Optional for local login, required for OIDC.

---

## Single Sign-On (OIDC)

SSO is configured **inside the app** — no restart, no `.env` change required.

Supported providers (generic OIDC): Authentik · Keycloak · Microsoft Entra · Google · Zitadel · Okta · Auth0 · any OIDC-compatible IdP.

**Setup:**
1. As administrator: *Administration → Single Sign-On*
2. Enter the **redirect URI** (`<APP_URL>/api/auth/oidc/callback`) in the IdP
3. Enter the issuer URL, client ID, client secret and scopes (`openid profile email`)
4. *Test connection* → **Enable SSO**

**How it works:**
- Authorization Code Flow with PKCE
- Client secret is stored AES-256-GCM encrypted in the database
- On the first SSO login a local user is created automatically (default role configurable, auto-provisioning can be disabled)
- **Profile picture** from the `picture` claim is automatically saved and updated on every login
- Local login always remains available

---

## Roles & Permissions

| Role | Description |
|---|---|
| `admin` | Full access; user management, RBAC editor, system settings |
| `assessor` | Create and edit assessments, risks, incidents, controls, policies |
| `it-staff` | Edit assets and security fields; no compliance/classification changes |
| `dpo` | Edit compliance and data protection fields (VVT, DPIA, classification) |
| `owner` | View own assets; read reports |
| `management` | Read-only on all released areas (management level) |
| `employee` | Training tab and own training overview; no write access |
| `viewer` | Read-only on all released areas |

**Custom Roles**: Under *Administration → Custom Roles* you can create custom roles with a name, description and a base role, and assign them directly to users. Effective permissions match the base role. Custom roles can also be assigned automatically via OIDC group mapping.

The **permission matrix** is freely configurable per module and action under *Administration → Roles & Permissions* — without restarting the application.

---

## API Documentation

The REST API is fully documented using **OpenAPI 3.0**.

| Endpoint | Description |
|---|---|
| `GET /api/docs` | Swagger UI (interactive, JWT authentication in the browser) |
| `GET /api/openapi.json` | OpenAPI 3.0 specification (JSON) |

**Authentication:**
```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@isms.local","password":"Admin1234!"}' | jq -r .token)

# Use token
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/assets
```

In the Swagger UI the token is automatically injected from the browser's local storage after login.

---

## MCP Server (AI Integration)

OpenISMS provides a **Model Context Protocol (MCP) server** through which AI assistants like Claude can interact directly with the system — query assets, create risks, report incidents and retrieve reports without opening a browser.

### Endpoint

```
POST   <APP_URL>/mcp    ← send requests (JSON-RPC, also SSE upgrade)
GET    <APP_URL>/mcp    ← SSE event stream (server → client)
DELETE <APP_URL>/mcp    ← end session
```

Transport: **Streamable HTTP/SSE** (MCP Spec 2025-03-26), compatible with Claude Desktop, Claude Code CLI and all MCP-capable clients.

### Authentication

Three options (all via `Authorization: Bearer <token>`):

| Option | Configuration | Use case |
|---|---|---|
| **API Token** ⭐ | Generate in the app profile → "API Tokens" | Recommended: long-lived, user-specific, revocable |
| **MCP_SECRET** | `MCP_SECRET=<secret>` in `.env` | Static admin key for automations/CI |
| **JWT Token** | Token from `POST /api/auth/login` | Short-lived (24 h) — for testing only |

#### Create an API token (recommended)

1. Log into the ISMS → profile picture (top right) → **"API Tokens"**
2. **"Create new token"** → enter a name (e.g. `Claude Desktop`) → optionally set an expiry date
3. Copy the token once — it is only displayed in full once
4. Token format: `isms_api_<64-hex-chars>`

The token is tied to the logged-in user — permissions follow that user's role. Tokens can be revoked at any time in the UI.

### Available Tools (18)

| Category | Tool | Description |
|---|---|---|
| **Assets** | `isms_list_assets` | Retrieve assets with filters (type, status, classification, free text) |
| | `isms_get_asset` | Asset details including latest CIA assessment and linked risks |
| | `isms_create_asset` | Create a new asset |
| **Risks** | `isms_list_risks` | Query risk register (status, level, free text) |
| | `isms_create_risk` | Create a risk with likelihood × impact (level calculated automatically) |
| **Incidents** | `isms_list_incidents` | Query incidents (status, severity) |
| | `isms_create_incident` | Report a security incident |
| | `isms_update_incident_status` | Set status, resolution and lessons learned |
| **Tasks** | `isms_list_tasks` | Query tasks including group tasks |
| | `isms_create_task` | Create a task — assign to user or group |
| | `isms_complete_task` | Mark a task as completed |
| **Controls** | `isms_list_controls` | Filter SoA controls by framework and status |
| | `isms_update_control_status` | Set implementation status of a control |
| **Reports** | `isms_get_dashboard` | Dashboard KPIs: assets, risks, incidents, reviews, coverage |
| | `isms_get_management_report` | Management report: health score, MTTR, KPIs |
| | `isms_get_compliance_overview` | Coverage rate per compliance framework |
| **Admin** | `isms_list_users` | User list with roles |
| | `isms_list_groups` | Groups with members |
| **Search** | `isms_search` | Cross-entity search across assets, risks, incidents and tasks |

### Integration with Claude Desktop

`~/.config/claude/claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "isms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": {
        "Authorization": "Bearer isms_api_<your-token>"
      }
    }
  }
}
```

### Integration with Claude Code CLI

`.claude/settings.json` in the project directory or `~/.claude/settings.json` globally:

```json
{
  "mcpServers": {
    "isms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": {
        "Authorization": "Bearer isms_api_<your-token>"
      }
    }
  }
}
```

### Test the connection

```bash
# Test API token
curl -X POST https://isms.example.com/mcp \
  -H "Authorization: Bearer isms_api_<your-token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The response lists all 18 available tools.

### MCP_SECRET (for automations / CI)

Static admin key without expiry — useful for server-to-server automations:

```env
# In .env (or Docker Compose environment variables):
MCP_SECRET=<min-32-random-chars>   # openssl rand -hex 32
```

```json
{
  "mcpServers": {
    "isms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_SECRET-value>"
      }
    }
  }
}
```

If neither `MCP_SECRET` nor a valid API token or JWT is provided, the server rejects all requests with `401`.

---

## Database Schema

| Table | Description |
|---|---|
| `users` | Users with 8 roles, avatar_url, last_seen_at |
| `assets` | Asset register (type, classification, hosting, lifecycle, CVE, RTO/RPO, NIS-2, VVT, DPIA, parent/child) |
| `assessments` | CIA assessments per asset (history, is_current, risk treatment, acceptance document) |
| `risks` | Risk register (likelihood × impact, inherent/residual, treatment, acceptance with expiry date) |
| `risk_assets` | N:M link risks ↔ assets |
| `risk_threats` | N:M link risks ↔ threats |
| `risk_controls` | N:M link risks ↔ controls (with effectiveness) |
| `controls` | Controls catalogue (ISO 27001, NIS-2, BSI, custom) with status and SoA |
| `threats` | Threat catalogue (BSI elementary hazards, common, custom) |
| `incidents` | Incidents (category, severity, NIS-2 deadlines, lessons learned, reference number) |
| `incident_assets` | N:M link incidents ↔ assets |
| `incident_risks` | N:M link incidents ↔ risks |
| `reminders` | Annual review reminders (auto-overdue via cron) |
| `documents` | File attachments per asset (disk via Docker volume) |
| `comments` | Comments/notes per asset |
| `policies` | Policies (title, category, version, validity, file upload) |
| `policy_versions` | Version history per policy |
| `policy_assets` | N:M link policies ↔ assets |
| `vendors` | External vendors (type, website, NIS-2 supply chain) |
| `vendor_contacts` | Contacts per vendor |
| `audit_logs` | Comprehensive change log of all actions |
| `settings` | System settings, OIDC configuration (secret encrypted), RBAC matrix |
| `tasks` | Tasks (status, priority, due date, related_type/related_id, assigned_to_group_id, completed_by_id) |
| `groups` | Groups/teams (name, description, colour) |
| `group_members` | N:M link groups ↔ users |
| `notifications` | In-app notifications (type, read, entity ref, link) |
| `vvt_entries` | Processing register entries (Art. 30 GDPR) with DPIA obligation and review date |
| `subject_requests` | Data subject requests (Art. 15–22 GDPR) with deadline and status history |
| `discovered_softwares` | Discovery staging: detected network hosts and agent software before approval |
| `custom_roles` | Custom roles with base role and description |
| `training_sessions` | Training sessions with title, date, type and participant list |
| `training_participants` | N:M link training sessions ↔ users/employees |
| `passkey_credentials` | WebAuthn/passkey credentials per user |

---

## Directory Structure

```
ISMS/
├── install.sh                          # Interactive install script (Docker/systemd)
├── VERSION                             # Current version number (triggers CI release)
├── Dockerfile                          # Single container (backend also serves frontend)
├── docker-compose.single.yml           # Single container (local build), external DB
├── docker-compose.ghcr.single.yml      # Single container (GHCR image), external DB
├── .env.example
├── .github/workflows/
│   ├── release.yml                     # Creates GitHub release + tag on VERSION change
│   └── docker-publish.yml              # Builds and pushes GHCR image on new tag
├── backend/
│   └── src/
│       ├── index.js                    # App entry point, DB sync, static serving, Swagger
│       ├── openapi.json                # OpenAPI 3.0 specification
│       ├── config/database.js          # Sequelize (DATABASE_URL or DB_* vars)
│       ├── models/                     # User, Asset, Assessment, Risk, Control, Threat,
│       │                               #   Incident, Reminder, Document, Comment,
│       │                               #   AuditLog, Vendor, VendorContact, Policy,
│       │                               #   PolicyVersion, Setting, Group, GroupMember,
│       │                               #   Notification, CustomRole, PasskeyCredential,
│       │                               #   Task, VvtEntry, SubjectRequest
│       ├── routes/                     # auth, authOidc, admin, users, assets,
│       │                               #   assessments, risks, controls, threats,
│       │                               #   incidents, reminders, notifications,
│       │                               #   documents, comments, dashboard, compliance,
│       │                               #   report, groups, import, auditlog, vendors,
│       │                               #   policies, vvt, subject-requests, tasks,
│       │                               #   tisax, dora, ai-act, bcm, pentests
│       ├── middleware/
│       │   ├── auth.js                 # JWT authenticate + requireRole
│       │   └── rateLimiter.js          # Shared rate limiter instances (CWE-770)
│       └── services/
│           ├── reminderService.js      # node-cron: overdue job + audit retention
│           ├── auditService.js         # Audit log helper
│           ├── settingsService.js      # Settings, OIDC config, RBAC permissions (DB)
│           ├── cryptoService.js        # AES-256-GCM for sensitive settings
│           ├── oidcService.js          # openid-client discovery + client cache
│           └── catalogSeed.js          # ISO/NIS-2/BSI controls + threat catalogue
└── frontend/
    └── src/
        ├── App.tsx                     # Router, auth guard
        ├── components/
        │   ├── Layout.tsx              # Sidebar navigation with descriptions
        │   ├── BottomNav.tsx           # Mobile bottom tab bar
        │   ├── CommandPalette.tsx      # ⌘K quick search
        │   ├── NotificationBell.tsx
        │   └── ui/                     # Card, Button, Input, Select, Modal, Badge,
        │                               #   Table, FilterBar, Mermaid, InfoTooltip
        ├── pages/                      # Dashboard, Assets, AssetDetail, Topology,
        │                               #   Assessments, Risks, Incidents, Controls,
        │                               #   Reminders, Compliance, PolicyLibrary,
        │                               #   ManagementReport, Import, AuditLog, Admin,
        │                               #   Vendors, Contacts, Groups, Tasks, MyArea,
        │                               #   VVT, SubjectRequests, Training,
        │                               #   Tisax, Dora, AiAct, Bcm, Pentests,
        │                               #   Login, AuthCallback
        ├── contexts/AuthContext.tsx
        ├── lib/api.ts
        ├── lib/export.ts               # CSV + Excel export
        └── types/index.ts
```

---

## Compliance Modules

Modules are enabled/disabled in the admin area under *Administration → Modules* — without restarting. GDPR is active by default; all other modules are optional.

| Module key | Name | Content |
|---|---|---|
| `dsgvo` | GDPR | Processing register (Art. 30), DPIA, data subject rights (Art. 15–22), data breaches |
| `iso27001` | ISO 27001:2022 | Controls Annex A, SoA, assessments, conformance status |
| `nis2` | NIS-2 | Risk management Art. 21, reporting obligations Art. 23, management liability |
| `bsi_grundschutz` | BSI IT-Grundschutz | Grundschutz controls catalogue, implementation status |
| `c5` | BSI C5:2026 | Cloud criteria catalogue for cloud service providers |
| `tisax` | TISAX (VDA ISA 6) | Requirements catalogue, assessments, maturity level measurement |
| `dora` | DORA | ICT incidents, resilience tests, third-party risk |
| `ai_act` | EU AI Act | AI inventory, risk classification, prohibited practices, conformity assessment |
| `bcm` | BCM | Business continuity plans, BIA, exercise log |
| `pentest` | Penetration Testing | Pentest reports, findings, remediation tracking |
| `discovery` | Network Discovery | Network scan import, agent discovery, staging queue |

---

## Compliance Coverage

| Framework | Covered requirements |
|---|---|
| **ISO 27001:2022** | Asset register (A.8), CIA assessment & risk register (ISO 27005), Statement of Applicability (SoA), controls catalogue (Annex A), annual reviews, classification, document management, policy library, audit log, cross-framework control mapping |
| **NIS-2** | Risk management (Art. 21), reporting obligations (Art. 23, 24h/72h deadlines), supply chain security via vendor module, incident documentation with reference numbers, management liability evidence (report), NIS-2 asset tagging |
| **GDPR** | Processing register (Art. 30), DPIA workflow (Art. 35), data subject rights tracker (Art. 15–22) with deadline calculation, data category (Art. 9), DPA documents (Art. 28), data breach documentation with authority reference numbers |
| **EU AI Act** | Asset types "AI Application" and "AI Agent"; risk classification (prohibited/high/low/minimal), governance fields, technical documentation, conformity assessment workflow |
| **TISAX** | VDA ISA 6 requirements catalogue, assessments with maturity level (0–3), remediation tracking |
| **DORA** | ICT incident classification and reporting, resilience tests (TLPT), ICT third-party register |
| **BSI IT-Grundschutz** | Grundschutz controls catalogue, implementation status, linked to assets |
| **BSI C5:2026** | Cloud criteria catalogue, conformance status per criterion |
| **BCM** | Business continuity plans, business impact analysis (BIA), exercise log, recovery times (RTO/RPO) directly from asset register |
| **Pentest** | Upload pentest reports, document findings (CVSS, status), remediation tracking through to closure |

---

### Training & Security Awareness
- Create training sessions (title, type, date, description, mandatory training flag)
- **Participant list upload** via CSV or Excel (`.xlsx`): columns `name`, `email`, `department`, `completed` (true/false)
- Employee role has its own training tab with an overview of own training sessions
- Linked to compliance requirements (ISO 27001 A.6.3, NIS-2 Art. 20)

### Data Subject Rights (Art. 15–22 GDPR)
- Create and manage requests (access, erasure, rectification, restriction, portability, objection)
- Automatic deadline calculation (30 days, extendable to 60 days) with overdue warning
- Status history (Open → In Progress → Completed / Rejected) with audit trail

### Mobile & UX
- **Progressive Web App (PWA)**: installable as a home screen app (Android/iOS/Desktop), `manifest.webmanifest` + Apple meta tags
- **Bottom navigation**: fixed tab bar on mobile with the 5 most-used areas (Dashboard, Assets, Risks, Tasks, Reports)
- **Command Palette** (`Ctrl+K` / `⌘K`): quick search across assets, risks, tasks and documents with keyboard navigation
- **Keyboard shortcuts**: `N` = new entry, `/` = focus search, `ESC` = close modal
- **Mobile card layout**: tables (assets, risks) automatically switch to stacked cards on small screens
- Empty states with contextual entry CTAs on all key pages

## Local Development

Requirements: Node.js 22+, MySQL 8.0

```bash
# Backend
cd backend && cp .env.example .env
npm install && npm run dev    # Port 3001

# Frontend (new terminal)
cd frontend
npm install && npm run dev    # Vite dev server: http://localhost:5173
```

---

## Security Notes for Production

- Set `JWT_SECRET` to at least 32 random characters
- Set `ENCRYPTION_KEY` (AES-256-GCM for OIDC secret) — if changed, the secret must be re-entered
- Change all database passwords in `.env`
- Put HTTPS via a reverse proxy in front (nginx, Traefik, Caddy) and set `SECURE_COOKIES=true`
- Include the Docker volume `uploads` in your backup strategy
- **Change the default admin password immediately after first login**
- Set up regular MySQL backups of the `isms` schema
- Rate limiting active on login endpoint (20 attempts / 15 min per IP)
- **Brute-force protection:** Local user accounts are temporarily locked after a configurable number of failed attempts (configurable in the admin area)
- **SSO login exclusivity:** Accounts logged in via Single Sign-On (SSO) automatically disable local authentication (password, passkey) and local two-factor authentication (TOTP)
- Security headers via `helmet` active (XSS, clickjacking, MIME sniff)
- CORS restricted to `APP_URL`

## Browser Push Notifications & PWA

OpenISMS supports browser push notifications and can be installed as a Progressive Web App (PWA) directly on mobile devices or the desktop:

- **Push notifications**: Enable via the bell icon in the header. The required VAPID key pairs are generated automatically on first server start. Optionally configure a contact email via the `VAPID_EMAIL` environment variable.
- **PWA installation**: Install directly through the browser's PWA installation feature. After installation, app shortcuts are available (e.g. direct entry into the risk register or assets).

---

## License

OpenISMS is **source-available software**. The source code is publicly viewable; use is free for private and non-commercial purposes. Any commercial or enterprise use as well as any redistribution requires a commercial licence. See [LICENSE](./LICENSE) for details. Licence enquiries: maximilian@herz.dev

© 2026 Maximilian Herz. All rights reserved.
