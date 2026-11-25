# OpenISMS — MCP Integration

OpenISMS includes a **Model Context Protocol (MCP) server**. AI assistants such
as Claude can use it to work with your ISMS directly: query the asset register,
record a risk, report an incident, answer the NIS-2 self-check or pull the
management report — without opening a browser.

Every MCP call runs **as a real OpenISMS user** and goes through the same
permission matrix, module switches and write restrictions as the web UI and the
REST API. MCP is not a side door.

---

## Contents

1. [Endpoint and transports](#1-endpoint-and-transports)
2. [Authentication](#2-authentication)
3. [Create an API token](#3-create-an-api-token)
4. [Connect a client](#4-connect-a-client)
5. [SSO / OAuth 2.1 setup](#5-sso--oauth-21-setup)
6. [Permissions, limits and audit](#6-permissions-limits-and-audit)
7. [Enabling and disabling](#enabling-and-disabling)
8. [Working with the tools](#8-working-with-the-tools)
9. [Troubleshooting](#9-troubleshooting)
10. [Configuration reference](#10-configuration-reference)
11. [Tool reference (216 tools)](#11-tool-reference-216-tools)

---

## 1. Endpoint and transports

The server is part of the main application and listens on the same port and
origin as the web UI.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `<APP_URL>/mcp` | JSON-RPC requests (Streamable HTTP). The first request without an `Mcp-Session-Id` opens a session |
| `GET` | `<APP_URL>/mcp` | Server → client event stream for an open session; without a session id it starts a legacy SSE session |
| `DELETE` | `<APP_URL>/mcp` | Ends a session |
| `GET` | `<APP_URL>/mcp/sse` | Legacy SSE stream (older clients) |
| `POST` | `<APP_URL>/mcp/messages?sessionId=…` | Legacy SSE message endpoint |

- **Transports:** Streamable HTTP (current MCP specification) and the legacy
  HTTP+SSE transport for older clients. There is no stdio transport — local
  clients that only speak stdio connect through `mcp-remote` (see below).
- The same router is also mounted under `/sse` for compatibility.
- **Sessions** are held in memory. After a server restart an old session id is
  answered with `404` and JSON-RPC error `-32001 Session not found`, and
  compliant clients reconnect on their own (since v3.3.11).
- **Capabilities:** tools only. The server exposes no MCP resources or prompts.
- **Server name:** `OpenISMS`, version from the `VERSION` file.

### Reverse proxy

If a reverse proxy sits in front of OpenISMS, it must pass `/mcp`, `/sse` and
`/.well-known/` through to the application and must not buffer the event
stream. For nginx:

```nginx
location ~ ^/(mcp|sse) {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
location /.well-known/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
}
```

The bare-metal installer (`install.sh`) writes this configuration for you.

---

## 2. Authentication

The endpoint is an **OAuth 2.1 resource server** in the sense of the MCP
authorization specification. It accepts four kinds of bearer credentials,
checked in this order:

| Credential | How to get it | Acts as | Recommended for |
|---|---|---|---|
| **Personal API token** ⭐ | Profile → **API tokens** | Its owner, with the owner's role | Claude Desktop via `mcp-remote`, Claude Code, scripts. Works for local and SSO accounts |
| **IdP access token (OAuth 2.1)** ⭐ | The client logs in at your OIDC provider | The user matched by e-mail | claude.ai / Claude Desktop custom connectors, teams with SSO |
| **`MCP_SECRET`** (deprecated) | Environment variable | A technical user with role `MCP_SECRET_ROLE` (default `viewer`) | Legacy automation only |
| **Session JWT** | `POST /api/auth/login` | The logged-in user, for 24 hours | Development and testing |

**How to send it:** `Authorization: Bearer <token>`. The headers `X-API-Key`,
`X-MCP-Key` and `Api-Key` are accepted as alternatives. For SSE clients that
cannot set headers, a token in the query string (`?token=…`) is accepted on
`GET` requests only — avoid this where you can, because URLs end up in proxy
logs.

**Responses** follow RFC 6750 and RFC 9728. Without a token the server answers
`401` with

```
WWW-Authenticate: Bearer resource_metadata="<APP_URL>/.well-known/oauth-protected-resource", scope="…"
```

(when SSO is enabled; otherwise `Bearer realm="OpenISMS MCP"`). A rejected token
gets `error="invalid_token"`; a token without `MCP_OAUTH_REQUIRED_SCOPE` gets
`403` with `error="insufficient_scope"`.

### Which one should I use?

- **One person, one assistant:** a personal API token with an expiry date.
- **Organisation with SSO:** OAuth via your IdP — no long-lived secret on any
  laptop, and leaving the company ends access with the IdP account.
- **Automation:** a dedicated OpenISMS user with the smallest role that does the
  job, and an API token for that user. Do not use `MCP_SECRET`: it never expires,
  has no person behind it, and every action is attributed to
  "MCP Client (MCP_SECRET)".

---

## 3. Create an API token

1. In OpenISMS click your profile picture (top right) → **API tokens**.
2. Enter a name (e.g. `Claude Desktop – laptop`) and an expiry date.
3. Copy the token. It looks like `isms_api_` followed by 64 hex characters and
   is **shown only once** — OpenISMS stores only its SHA-256 hash.

Tokens can also be created over the REST API (`POST /api/auth/tokens`) or the
MCP tool `isms_create_api_token`. Revoke a token in the same dialog
(`DELETE /api/auth/tokens/:id`); administrators can revoke any token with
`isms_revoke_api_token`. Expired tokens stop working immediately, are deleted on
their next use or by the nightly clean-up, and the owner is notified.

> A token has **no scopes of its own**: it can do everything its owner can. Give
> an assistant a token of a user whose role matches what the assistant should
> be allowed to do.

---

## 4. Connect a client

Replace `https://isms.example.com` with your `APP_URL` in all examples.

### Claude (claude.ai, Claude Desktop) — custom connector with SSO

**Settings → Connectors → Add custom connector**, URL
`https://isms.example.com/mcp`. Claude reads the protected-resource metadata,
registers itself at your identity provider and opens its login page.

Requirements:
- SSO is configured in OpenISMS and the IdP setup in
  [section 5](#5-sso--oauth-21-setup) is done.
- OpenISMS **and** the IdP's endpoints are reachable from the internet — the
  connector is driven from Anthropic's servers.
- The redirect host `claude.ai` is trusted at the IdP (callback
  `https://claude.ai/api/mcp/auth_callback`).

Custom connectors cannot send a static header, so local (non-SSO) accounts use
`mcp-remote` with an API token instead.

### Claude Desktop — API token via `mcp-remote`

Edit the configuration file:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "openisms": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://isms.example.com/mcp",
        "--header",
        "Authorization:${ISMS_AUTH_HEADER}"
      ],
      "env": {
        "ISMS_AUTH_HEADER": "Bearer isms_api_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

The header is built from `env` because spaces inside `args` are mangled on
Windows. The token sits in plain text in this file: protect the file like a
password and revoke the token when the device is lost. Requires Node.js on the
machine running Claude Desktop.

### Claude Desktop — OAuth login via `mcp-remote` (SSO accounts)

Without a header, `mcp-remote` runs the OAuth flow itself: it opens the browser
for the IdP login and receives the callback on
`http://localhost:<port>/oauth/callback`.

```json
{
  "mcpServers": {
    "openisms": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://isms.example.com/mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http openisms https://isms.example.com/mcp \
  --header "Authorization: Bearer isms_api_YOUR_TOKEN_HERE"
```

Add `--scope project` to store the server in the repository's `.mcp.json`
instead of your user configuration. A project file is shared with everyone who
clones the repository, so reference the token through an environment variable
there rather than writing it into the file:

```json
{
  "mcpServers": {
    "openisms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": { "Authorization": "Bearer ${ISMS_API_TOKEN}" }
    }
  }
}
```

Check the connection with `claude mcp list` or `/mcp` inside a session.

### Other MCP clients

Any client that speaks Streamable HTTP works with the URL
`https://isms.example.com/mcp` and the header
`Authorization: Bearer isms_api_…`. Clients that only speak stdio use
`mcp-remote` as shown above. Browser-based clients (for example an MCP
inspector) additionally need their origin in `MCP_CORS_ORIGINS`.

### Test with curl

```bash
# 1. Initialise a session and note the Mcp-Session-Id response header
curl -si https://isms.example.com/mcp \
  -H "Authorization: Bearer isms_api_YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# 2. List the tools in that session
curl -s https://isms.example.com/mcp \
  -H "Authorization: Bearer isms_api_YOUR_TOKEN_HERE" \
  -H "Mcp-Session-Id: <id from step 1>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

A `401` means the token was not accepted; a `403` with `origin_not_allowed`
means the request carried an `Origin` header that is not allowed (see
[section 6](#6-permissions-limits-and-audit)).

---

## 5. SSO / OAuth 2.1 setup

OAuth only works when SSO (OIDC) is configured in OpenISMS — see
[CONFIGURATION.md](CONFIGURATION.md#single-sign-on-oidc). OpenISMS does not run
an authorization server of its own: the protected-resource metadata at
`<APP_URL>/.well-known/oauth-protected-resource` points clients to your IdP,
and clients register there (dynamic client registration, RFC 7591).

OpenISMS verifies every IdP access token **locally**:

- signature against the issuer's JWKS (asymmetric algorithms only)
- exact `iss`, `exp` required, 30 seconds clock tolerance
- **audience:** `aud` must contain `<APP_URL>/mcp` (or a value from
  `MCP_OAUTH_AUDIENCES`). A token the IdP issued for some other application is
  rejected — this prevents token passthrough / confused-deputy attacks
- the scope in `MCP_OAUTH_REQUIRED_SCOPE`, if set

### Keycloak

Keycloak does not evaluate the RFC 8707 `resource` parameter, so the audience
comes from a client scope:

1. **Client scopes → Create client scope:** name `isms-mcp`, type *Optional*,
   protocol OpenID Connect, *Include in token scope* on.
2. In `isms-mcp` → **Mappers → Configure a new mapper → Audience:**
   *Included Custom Audience* = `https://isms.example.com/mcp` (exactly
   `<APP_URL>/mcp`), *Add to access token* on, *Add to ID token* off.
3. Announce the scope to MCP clients:
   `MCP_OAUTH_SCOPES=openid profile email isms-mcp`.
4. **Clients → Client registration** (dynamic registration used by Claude and
   `mcp-remote`): in the anonymous *Trusted Hosts* policy switch *Host sending
   client registration request must match* off, keep *Client URIs must match* on
   and list `localhost`, `127.0.0.1` and `claude.ai`. In *Allowed Client
   Scopes*, keep *Allow default scopes* on.

Other IdPs need the equivalent: an access token whose `aud` contains
`<APP_URL>/mcp`, and dynamic client registration for the clients you use.

### Which account an IdP token maps to

- Users are matched by the `email` claim with the same rules as the web SSO
  login: `email_verified=false` is rejected and the SSO domain allow-list
  applies.
- An account already linked by SSO is used directly. A **local** (password)
  account is only used when the IdP marks the address as verified
  (`email_verified=true`) or `OIDC_LINK_UNVERIFIED_EMAIL=true` is set.
- An MCP login never changes the account.
- Unknown users are **not** created unless `MCP_OAUTH_AUTO_PROVISION=true`
  **and** SSO auto-provisioning is on **and** the token says
  `email_verified=true`. They then get the SSO default role.

In Keycloak the `email` client scope puts `email_verified` into the access
token; the user's e-mail must be marked as verified there.

---

## 6. Permissions, limits and audit

### Permissions
Each tool is mapped to a module and action of the permission matrix (for
example `risks.create`). On every call OpenISMS checks, in this order:

1. **Module switch** — a tool of a disabled module answers with an error.
2. **Permission matrix** — where the matrix defines the action, it decides.
   Where it says nothing, the role list the REST endpoint uses decides. A
   failed lookup denies.
3. **Write protection** — the roles `viewer`, `management` and `employee` stay
   read-only, whatever the matrix says.

Administrative tools (users, permissions, settings, custom roles, automation)
require the matching admin permissions. Some field-level rules apply inside a
tool, exactly as in the REST API — for example, classification fields of an
asset need `assets.edit_compliance`.

The contract is tested in CI (`scripts/test-mcp-gate.js`,
`scripts/test-mcp-auth.js`, `scripts/test-mcp-cors.js`).

### Limits
- **Rate limit:** 5000 requests per 15 minutes per token (or per IP without a
  bearer token), shared with the REST API. Set with `RATE_LIMIT_API_MAX`.
- **Request size:** 10 MB JSON body.

### Browser origins (CORS)
Native clients (Claude Desktop, Claude Code, claude.ai connectors, curl) send no
`Origin` header and are not affected. Requests that do carry an `Origin` are
only accepted from `APP_URL` and the origins in `MCP_CORS_ORIGINS`; anything
else gets `403 origin_not_allowed` before it reaches the MCP transport. This is
the DNS-rebinding protection the MCP specification asks for. Responses never
carry credentials.

### Audit trail
Changes made through MCP are written to the audit log under the acting user,
like changes made in the UI; many entries carry `via: "mcp"` in their details.
Read-only calls are not audit-logged. Every HTTP request, including MCP, appears
in the server log with secrets in query strings redacted.

---

## Enabling and disabling

The endpoint is part of every installation and needs no switch to be turned on.
It is only usable with a valid credential: without API tokens, SSO or
`MCP_SECRET`, nobody can call it.

**Administration → Modules** has an **MCP** entry (on by default). It is not
enforced on the endpoint at the moment. To switch MCP off reliably, block
`/mcp` and `/sse` at your reverse proxy.

---

## 8. Working with the tools

The assistant sees each tool's name, description and input schema and picks the
right one itself; you talk to it in plain language. Some examples:

| You ask | Tools the assistant will typically use |
|---|---|
| "Which critical risks have no accepted treatment yet?" | `isms_list_risks`, `isms_get_risk` |
| "Record a phishing incident from this morning affecting the mail server." | `isms_list_assets`, `isms_create_incident` |
| "Which of our assets are affected by CVEs rated critical?" | `isms_get_central_cve_report` |
| "Where are our biggest NIS-2 gaps, and what should we do first?" | `isms_get_nis2_gaps`, `isms_list_nis2_measures` |
| "Assess today's CISA KEV entries for relevance to our servers." | `isms_list_threat_advisories`, `isms_assess_threat_advisory` |
| "Which ISO 27001 controls also cover NIS-2 Art. 21(2)(d)?" | `isms_lookup_framework_mappings` |
| "Prepare the numbers for the management review." | `isms_get_management_report`, `isms_get_compliance_overview` |
| "Create a task for the IT team to renew the firewall certificate by Friday." | `isms_list_groups`, `isms_create_task` |

Good practice:

- **Let the assistant read before it writes.** Ask for a summary of what it is
  about to change; most clients show every tool call for approval.
- **CheckMK sync defaults to a dry run** (`dry_run: true`) and reports what
  would change.
- **Discovery never creates assets directly.** Approving a staged item is a
  deliberate call (`isms_approve_discovered_software`).
- **Delete tools are permanent.** Restrict them with the permission matrix for
  the user an assistant runs as, or allow them per call in your client.
- **`isms_run_vendor_triage` uses your LLM provider** and its budget.

---

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401` with `invalid_token` | Token mistyped, revoked or expired; or an IdP token without the audience `<APP_URL>/mcp` |
| `403 insufficient_scope` | The IdP token lacks `MCP_OAUTH_REQUIRED_SCOPE` |
| `403 origin_not_allowed` | A browser-based client whose origin is not in `MCP_CORS_ORIGINS` |
| `404 Session not found` (`-32001`) | The server restarted; the client should reconnect on its own. If it does not, restart the client |
| A tool answers "module not enabled" | Enable the module under **Administration → Modules** |
| A tool answers "permission denied" | The token's owner lacks the permission; check the role and the permission matrix |
| Client hangs on connect behind a proxy | The proxy buffers the event stream or does not forward `/mcp` — see [Reverse proxy](#reverse-proxy) |
| OAuth login with `mcp-remote` hangs | Remove stale state in `~/.mcp-auth/` and make sure only one Claude Desktop instance runs `mcp-remote` for this server — instances compete for the callback port |
| `GET /.well-known/oauth-protected-resource` returns 404 | SSO is not enabled; use an API token |
| Custom connector cannot log in | OpenISMS or the IdP is not reachable from the internet, or `claude.ai` is not a trusted redirect host |

The server log lists the active authentication modes at startup
(`[MCP] Auth modes: …`).

---

## 10. Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `APP_URL` | – | Public URL. Defines the resource URL `<APP_URL>/mcp`, the expected token audience and the default allowed origin |
| `MCP_CORS_ORIGINS` | only `APP_URL` | Additional browser origins, comma-separated; `*` allows any origin |
| `MCP_OAUTH_SCOPES` | the OIDC scopes | Scopes announced to clients, space-separated |
| `MCP_OAUTH_AUDIENCES` | – | Additional accepted `aud` values |
| `MCP_OAUTH_ALLOWED_CLIENTS` | – | Client ids accepted via `azp` without a matching `aud` (transition only) |
| `MCP_OAUTH_REQUIRED_SCOPE` | – | Scope every IdP token must carry |
| `MCP_OAUTH_AUTO_PROVISION` | `false` | Create unknown users on MCP login (also needs SSO auto-provisioning) |
| `OIDC_LINK_UNVERIFIED_EMAIL` | `false` | Allow IdP tokens without `email_verified=true` to use a local account |
| `MCP_SECRET` | unset (disabled) | Deprecated static key |
| `MCP_SECRET_ROLE` | `viewer` | Role of the `MCP_SECRET` user (before 3.3.9 the default was `admin`) |
| `RATE_LIMIT_API_MAX` | `5000` | Requests per 15 minutes per token, shared with the REST API |

---

## 11. Tool reference (216 tools)

Type: **R** read · **W** create or change · **D** delete or revoke.
79 tools read, 95 write, 35 delete. Tools of an optional module only work while
that module is enabled.

### Assets, assessments, comments and documents (12)

| Tool | Type | Description |
|---|---|---|
| `isms_list_assets` | R | List assets from the ISMS asset register. |
| `isms_get_asset` | R | Get full details of a single asset including its latest CIA assessment, linked risks, incidents, and compliance frameworks. |
| `isms_create_asset` | W | Create a new asset in the ISMS asset register. |
| `isms_update_asset` | W | Update details of an existing asset in the ISMS asset register. |
| `isms_create_assessment` | W | Create a CIA (Confidentiality, Integrity, Availability) protection needs and risk assessment for an asset. |
| `isms_list_assessments` | R | List Schutzbedarfsfeststellungen / CIA assessments for assets. |
| `isms_delete_asset` | D | Decommission / delete an asset from the active register. |
| `isms_list_asset_comments` | R | List comments and meeting notes for a specific asset. |
| `isms_add_asset_comment` | W | Add a meeting note or comment to an asset, supporting @mentions and auto-task checkboxes ("- [ ] @mention Task"). |
| `isms_delete_asset_comment` | D | Delete a comment or meeting note from an asset. |
| `isms_list_documents` | R | List attached documents and metadata for an asset, vendor, or incident. |
| `isms_delete_document` | D | Delete an uploaded document attachment and its file from storage. |

### Vulnerabilities (CVE / CPE) (6)

| Tool | Type | Description |
|---|---|---|
| `isms_get_asset_cve_report` | R | Get the CVE vulnerability report for a single asset, optionally refreshing it from external sources. |
| `isms_get_central_cve_report` | R | Get a central CVE report aggregated across all non-decommissioned assets, showing unique CVEs and their affected assets. |
| `isms_refresh_asset_cves` | W | Trigger a real-time CVE vulnerability refresh from external APIs for a specific asset. |
| `isms_refresh_all_asset_cves` | W | Trigger a background/real-time CVE vulnerability refresh from external APIs for all non-decommissioned assets. |
| `isms_suggest_cpe` | R | Get CPE 2.3 format suggestions from NVD for an asset or search query to enable accurate vulnerability matching. |
| `isms_resolve_cpe` | W | Resolve or assign a standardized CPE (Common Platform Enumeration) string to an asset for automated CVE scanning. |

### CheckMK and auto-discovery (7)

| Tool | Type | Description |
|---|---|---|
| `isms_checkmk_status` | R | Show the CheckMK integration configuration (without the secret) and the result of the last sync run. |
| `isms_checkmk_hosts` | R | Fetch the live host list from CheckMK (name, IP, state, plugin output). |
| `isms_checkmk_sync` | W | Reconcile the ISMS asset register against CheckMK. |
| `isms_list_discovered_software` | R | List staged auto-discovered software and hosts from network scans or agents. |
| `isms_approve_discovered_software` | W | Approve a staged discovered item, which converts it into an active Asset. |
| `isms_ignore_discovered_software` | W | Ignore a staged discovered item so it is hidden from approval queues. |
| `isms_delete_discovered_software` | D | Delete a staged discovered host or software item from the discovery inbox. |

### Risks and threats (10)

| Tool | Type | Description |
|---|---|---|
| `isms_get_risk_methodology` | R | Get the active risk methodology (ISO 27005): scales with criteria, risk levels and thresholds, matrix, risk appetite and acceptance authority; earlier versions and the version history on request. |
| `isms_list_risks` | R | List risks from the risk register with optional filters, including risk appetite and reassessment flags. |
| `isms_get_risk` | R | Get full details of a single risk including linked controls, threats, assets, sign-off status, methodology version and risk appetite check. |
| `isms_create_risk` | W | Add a new risk to the risk register. |
| `isms_update_risk` | W | Update an existing risk in the risk register including likelihood, impact, treatment, and linked controls/assets. |
| `isms_signoff_risk` | W | Digitally sign off and accept a risk (NIS-2 management sign-off), subject to the acceptance authority of the risk methodology. |
| `isms_revoke_risk_signoff` | W | Revoke a previous risk sign-off / acceptance, setting it back to in_treatment. |
| `isms_delete_risk` | D | Delete a risk from the risk register and cancel related open tasks. |
| `isms_list_threats` | R | List cybersecurity threats from the standardized threat catalog. |
| `isms_create_threat` | W | Add a custom cybersecurity threat to the ISMS threat catalog. |

### Incidents (5)

| Tool | Type | Description |
|---|---|---|
| `isms_list_incidents` | R | List security incidents. |
| `isms_create_incident` | W | Report a new security incident. |
| `isms_update_incident_status` | W | Update the status of an incident. |
| `isms_update_incident` | W | Update an existing security incident details. |
| `isms_delete_incident` | D | Delete / remove a security incident from the incident register. |

### Threat landscape (6)

| Tool | Type | Description |
|---|---|---|
| `isms_list_threat_sources` | R | List the monitored threat-intelligence sources (national CSIRT, CERTs, vendors, security news) with their review cadence and whether a review is overdue. |
| `isms_list_threat_advisories` | R | List external threat advisories with their assessment and what they turned into (risk, task, incident). |
| `isms_get_threat_intel_stats` | R | Evidence figures for NIS2 Art. 21(2)(a): how the threat landscape is monitored (sources, cadence, overdue reviews, national CSIRT coverage) and how advisories are fed into risk management (assessment and handover rates). |
| `isms_create_threat_advisory` | W | Record an external threat advisory (authority warning, vendor advisory, security news) in the threat register. |
| `isms_assess_threat_advisory` | W | Assess an advisory: is it relevant to this organisation, and what follows from it. |
| `isms_record_threat_source_review` | W | Record that a threat source was reviewed today and schedule the next review from its cadence. |

### Controls and cross-framework mappings (8)

| Tool | Type | Description |
|---|---|---|
| `isms_list_controls` | R | List security controls and their implementation status (Statement of Applicability). |
| `isms_update_control_status` | W | Update the implementation status of a control. |
| `isms_update_control` | W | Update details, implementation status, or applicability justification of a compliance control / measure. |
| `isms_create_control` | W | Create a new custom security control in the Statement of Applicability (SoA) register. |
| `isms_delete_control` | D | Delete a security control from the Statement of Applicability register. |
| `isms_lookup_framework_mappings` | R | Look up cross-framework mappings for a specific control reference across ISO 27001, NIS-2, BSI IT-Grundschutz, and C5. |
| `isms_get_framework_mapping_stats` | R | Get statistics on cross-framework control mappings between ISO 27001, NIS-2, BSI IT-Grundschutz, and C5. |
| `isms_get_framework_mapping_overview` | R | Get a complete overview table matrix of cross-framework control mappings. |

### Framework catalogues (ISO 27001, BSI, NIS-2, C5, TISAX) (24)

| Tool | Type | Description |
|---|---|---|
| `isms_list_iso27001_controls` | R | List all ISO 27001 Annex A controls including applicability, implementation status, owner, evidence, and notes. |
| `isms_update_iso27001_control` | W | Update details, applicability, justification, or implementation status of an ISO 27001 Annex A control. |
| `isms_list_bsi_requirements` | R | List BSI IT-Grundschutz requirements and Bausteine with implementation status. |
| `isms_update_bsi_requirement` | W | Update status, justification, responsible person, notes or review date of a BSI requirement in the default information domain. A justification is required for not_implemented (nein) and not_applicable (entbehrlich). |
| `isms_list_bsi_domains` | R | List BSI IT-Grundschutz information domains (Informationsverbuende) with protection approach (basis/standard/kern), assigned catalogue and counts of target objects and modelled modules. |
| `isms_get_bsi_domain` | R | Get one BSI information domain with its target objects and its modelling. Only target objects whose asset the caller may see are returned. |
| `isms_suggest_bsi_modeling` | R | Suggest modules (Kompendium) or practices (Grundschutz++) for a target object or for the whole domain. Suggestions are not applied automatically. |
| `isms_assign_bsi_target_object` | W | Assign an asset from the asset register to a BSI information domain as target object; the target type is suggested from the asset type when omitted. |
| `isms_model_bsi_module` | W | Model a module or practice of the domain's active catalogue on a target object or on the whole domain. |
| `isms_get_bsi_check` | R | Read the IT-Grundschutz-Check of an information domain: requirements of the modelled modules relevant for the protection approach, per target object or domain-wide, with status, justification, responsible, due date, costs, evidence and controls; optional fulfilment/cost summary. |
| `isms_set_bsi_check_status` | W | Set the check result (ja/teilweise/nein/entbehrlich/offen) of one requirement for a target object or the whole domain, with the same mandatory fields and permissions as the UI. |
| `isms_list_nis2_measures` | R | List NIS-2 criteria: the measures of Art. 20, 21 and 23 NIS-2 (§ 30 Abs. 2 Nr. 1-10 BSIG) with their sub-requirements, plus the BSIG duties without a counterpart in the directive (§§ 31, 33, 34, 35, 39). |
| `isms_update_nis2_measure` | W | Update implementation status, responsible person, deadline, or evidence of a NIS-2 criterion. |
| `isms_list_nis2_self_check` | R | List the NIS2 self-check questions with their two answers (implementation and evidence), the article each maps to, and the recommendation attached to it. |
| `isms_get_nis2_gaps` | R | The NIS2 gap picture: fulfilment rate and maturity per topic, coverage per article of the directive, and the ranked list of gaps with the recommendation for each. |
| `isms_answer_nis2_self_check` | W | Answer a NIS2 self-check question on both axes: is the measure implemented, and can it be evidenced. |
| `isms_list_c5_criteria` | R | List BSI C5 (Cloud Computing Compliance Criteria Catalogue) criteria. |
| `isms_update_c5_criterion` | W | Update implementation status, responsible person, or evidence of a C5 criterion. |
| `isms_list_tisax_requirements` | R | List VDA-ISA requirements for TISAX assessment. |
| `isms_update_tisax_requirement` | W | Update maturity level, target level, status, or notes of a TISAX VDA-ISA requirement. |
| `isms_list_tisax_assessments` | R | List TISAX assessment projects and label tracking records. |
| `isms_create_tisax_assessment` | W | Register a new TISAX assessment / label tracking project. |
| `isms_update_tisax_assessment` | W | Update an existing TISAX assessment record. |
| `isms_delete_tisax_assessment` | D | Delete a TISAX assessment record. |

### Policies and templates (9)

| Tool | Type | Description |
|---|---|---|
| `isms_list_policies` | R | List security policies, guidelines, and procedures with linked assets and controls. |
| `isms_get_policy` | R | Get full details of a single policy including version history, mapped controls, and assets. |
| `isms_create_policy` | W | Register a new policy, guideline, or procedure in the policy management system. |
| `isms_update_policy` | W | Update details, status, or mapped controls of an existing policy. |
| `isms_acknowledge_policy` | W | Submit user acknowledgment/acceptance of a security policy. |
| `isms_delete_policy` | D | Delete a security policy from the repository. |
| `isms_get_policy_acknowledgments` | R | List employee acknowledgments / signatures for a specific security policy. |
| `isms_list_templates` | R | List policy and ISMS document templates available in the template library. |
| `isms_delete_template` | D | Delete a document template from the library. |

### Vendors and AI triage (14)

| Tool | Type | Description |
|---|---|---|
| `isms_list_vendors` | R | List all vendors/processors with their details and risk levels. |
| `isms_create_vendor` | W | Register a new vendor/processor in the vendor register. |
| `isms_assess_vendor` | W | Perform or update the security and risk assessment of a vendor/processor. |
| `isms_get_vendor` | R | Get full details of a single vendor / third-party processor including contacts, linked incidents, and VVT entries. |
| `isms_update_vendor` | W | Update vendor information (name, type, website, phone, address, notes). |
| `isms_delete_vendor` | D | Delete a vendor from the register. |
| `isms_add_vendor_contact` | W | Add a contact person to a vendor. |
| `isms_update_vendor_contact` | W | Update a vendor contact person. |
| `isms_delete_vendor_contact` | D | Delete a vendor contact person. |
| `isms_list_vendor_triage_runs` | R | List AI contract analysis triage runs for a vendor. |
| `isms_get_vendor_triage_run` | R | Get full analysis findings and summary of a specific vendor contract triage run. |
| `isms_run_vendor_triage` | W | Start an AI contract analysis for a document already attached to a vendor. |
| `isms_get_triage_profiles` | R | Get vendor contract analysis triage criteria profiles and reference baselines. |
| `isms_update_triage_profiles` | W | Update vendor contract analysis triage criteria profiles (admin only). |

### Privacy (GDPR) (18)

| Tool | Type | Description |
|---|---|---|
| `isms_list_vvt_entries` | R | List all records of processing activities (VVT - Verzeichnis von Verarbeitungstätigkeiten) for GDPR/DSGVO compliance. |
| `isms_create_vvt_entry` | W | Create a new VVT entry in the GDPR/DSGVO record of processing activities. |
| `isms_list_subject_requests` | R | List GDPR Subject Access Requests (Betroffenenanfragen) with optional status filter. |
| `isms_create_subject_request` | W | Register a new GDPR Subject Access Request (Betroffenenanfrage). |
| `isms_update_subject_request_status` | W | Update status, decision, or handler of a GDPR Subject Access Request. |
| `isms_list_dataflows` | R | List data flow mappings between systems and assets in compliance with GDPR Art. 30. |
| `isms_get_dataflow` | R | Get full details of a specific data flow. |
| `isms_create_dataflow` | W | Register a new data flow between source and target assets/systems. |
| `isms_update_dataflow` | W | Update details of an existing data flow. |
| `isms_delete_dataflow` | D | Delete a data flow record. |
| `isms_get_vvt_entry` | R | Get full details of a single VVT processing activity (Verarbeitungstätigkeit) including linked assets and processors. |
| `isms_update_vvt_entry` | W | Update a GDPR Record of Processing Activities (VVT) entry. |
| `isms_delete_vvt_entry` | D | Delete a VVT entry from the GDPR register. |
| `isms_get_vvt_dsfa` | R | Get the DSFA (Data Protection Impact Assessment / Datenschutz-Folgenabschätzung) for a VVT entry. |
| `isms_create_vvt_dsfa` | W | Create a DSFA (Data Protection Impact Assessment) according to GDPR Art. 35 for a VVT entry. |
| `isms_update_vvt_dsfa` | W | Update an existing DSFA assessment. |
| `isms_delete_vvt_dsfa` | D | Delete a DSFA record. |
| `isms_delete_subject_request` | D | Delete a GDPR Subject Access Request (Betroffenenanfrage). |

### Audits, KPIs and training (20)

| Tool | Type | Description |
|---|---|---|
| `isms_list_audits` | R | List internal, external, and certification audits along with findings and CAPA tasks. |
| `isms_create_audit` | W | Plan or log a new compliance audit (internal, external, or certification). |
| `isms_update_audit` | W | Update details or status of an existing compliance audit. |
| `isms_create_audit_finding` | W | Create a new finding / deviation from an audit and optionally assign it for remediation. |
| `isms_update_audit_finding` | W | Update status, severity, or remediation details of an audit finding. |
| `isms_list_kpis` | R | List security & compliance KPIs along with measurement history and target values. |
| `isms_record_kpi_measurement` | W | Record a new measured value for a security KPI. |
| `isms_delete_audit` | D | Delete a compliance audit. |
| `isms_delete_audit_finding` | D | Delete an audit finding / deviation. |
| `isms_create_kpi` | W | Create a new security or compliance KPI metric to track. |
| `isms_update_kpi` | W | Update an existing security KPI (target, current value, status, owner). |
| `isms_delete_kpi` | D | Delete a security KPI metric. |
| `isms_list_training_courses` | R | List compliance and security training courses / curriculum with assignment and completion stats. |
| `isms_create_training_course` | W | Create a new security awareness or compliance training course in the catalog. |
| `isms_update_training_course` | W | Update an existing training course details. |
| `isms_delete_training_course` | D | Delete a training course and cancel associated tasks. |
| `isms_list_user_trainings` | R | List user training participation and completion records. |
| `isms_record_user_training` | W | Record a training completion or assign a training to a registered user or external employee. |
| `isms_update_user_training` | W | Update an individual user training record (completion date, expiration, certificate). |
| `isms_delete_user_training` | D | Delete a user training record. |

### BCM (8)

| Tool | Type | Description |
|---|---|---|
| `isms_list_bcm_processes` | R | List all critical business processes from the Business Impact Analysis (BIA). |
| `isms_list_bcm_exercises` | R | List BCM tests, exercises, and drills performed for business continuity. |
| `isms_create_bcm_exercise` | W | Create/log a new BCM tabletop exercise, simulation, or full drill. |
| `isms_create_bcm_process` | W | Register a critical business process in the BIA (Business Impact Analysis) register. |
| `isms_update_bcm_process` | W | Update details, RTO, RPO, or recovery strategy of a BCM process. |
| `isms_delete_bcm_process` | D | Delete a BCM business process from the BIA register. |
| `isms_update_bcm_exercise` | W | Update a BCM test, exercise, or drill record. |
| `isms_delete_bcm_exercise` | D | Delete a BCM exercise record. |

### DORA (8)

| Tool | Type | Description |
|---|---|---|
| `isms_list_dora_third_parties` | R | List ICT third-party service providers registered under DORA regulations. |
| `isms_list_dora_tests` | R | List digital operational resilience tests required by DORA. |
| `isms_create_dora_third_party` | W | Register an ICT third-party service provider under DORA (EU 2022/2554) regulations. |
| `isms_update_dora_third_party` | W | Update a DORA ICT third-party provider record. |
| `isms_delete_dora_third_party` | D | Delete a DORA ICT third-party provider record. |
| `isms_create_dora_test` | W | Register a DORA digital operational resilience test (Art. 24-26, e.g. vulnerability scan, TLPT, penetration test). |
| `isms_update_dora_test` | W | Update details, results, or remediation of a DORA resilience test. |
| `isms_delete_dora_test` | D | Delete a DORA resilience test record. |

### EU AI Act (4)

| Tool | Type | Description |
|---|---|---|
| `isms_list_ai_systems` | R | List all registered AI systems from the EU AI Act compliance register. |
| `isms_create_ai_system` | W | Register a new AI system in the EU AI Act register. |
| `isms_update_ai_system` | W | Update details, conformity status, or risk category of an AI system in the EU AI Act register. |
| `isms_delete_ai_system` | D | Delete an AI system from the EU AI Act register and cancel associated open tasks. |

### Pentests (8)

| Tool | Type | Description |
|---|---|---|
| `isms_list_pentests` | R | List all pentest projects from the pentest register, including owner and findings summary. |
| `isms_create_pentest` | W | Register a new pentest project. |
| `isms_list_pentest_findings` | R | List findings for a specific pentest project with optional severity and status filters. |
| `isms_create_pentest_finding` | W | Add a new finding to a pentest project. |
| `isms_update_pentest_finding` | W | Update details or status of an existing pentest finding. |
| `isms_update_pentest` | W | Update an existing pentest project. |
| `isms_delete_pentest` | D | Delete a pentest project and all of its associated findings. |
| `isms_delete_pentest_finding` | D | Delete a finding from a pentest project. |

### Legal register (4)

| Tool | Type | Description |
|---|---|---|
| `isms_list_legal_requirements` | R | List legal and regulatory compliance requirements in the legal register (Rechtskataster). |
| `isms_create_legal_requirement` | W | Add a new legal requirement or regulation to the legal register. |
| `isms_update_legal_requirement` | W | Update a legal requirement in the legal register. |
| `isms_delete_legal_requirement` | D | Delete a legal requirement from the legal register. |

### Tasks, reminders and notifications (12)

| Tool | Type | Description |
|---|---|---|
| `isms_list_tasks` | R | List tasks. |
| `isms_create_task` | W | Create a new task. |
| `isms_complete_task` | W | Mark a task as done. |
| `isms_get_task` | R | Get full details of a specific task including assignee, group members, and creator. |
| `isms_update_task` | W | Update details, status, priority, due date, or assignees of a task. |
| `isms_delete_task` | D | Delete a task from the system. |
| `isms_get_task_stats` | R | Get aggregated task counts (open, in_progress, done, overdue). |
| `isms_list_reminders` | R | List active and pending asset review reminders. |
| `isms_acknowledge_reminder` | W | Acknowledge / complete an asset review reminder, auto-closing any associated task. |
| `isms_dismiss_reminder` | W | Dismiss an asset review reminder. |
| `isms_list_notifications` | R | List pending notifications, overdue reminders, and assets requiring review. |
| `isms_get_my_overview` | R | Get personalized user dashboard summary (assigned assets, open tasks, unread notifications, pending policy acknowledgments, training statuses). |

### Reporting and management review (6)

| Tool | Type | Description |
|---|---|---|
| `isms_get_dashboard` | R | Get current ISMS dashboard summary: asset counts, risk distribution, open incidents, overdue reviews, compliance coverage. |
| `isms_get_management_report` | R | Fetch the full management report: 12-month trends, risk/control/task distribution, auto-calculated KPIs (Health Score, MTTR, coverage rates) and manual KPIs. |
| `isms_get_compliance_overview` | R | Get compliance framework coverage overview: percentage of implemented controls per framework. |
| `isms_get_review_signoffs` | R | List historical Management Review sign-offs (ISO 27001 Kap. 9.3). |
| `isms_create_review_signoff` | W | Submit a new Management Review digital sign-off and approval (ISO 27001 Kap. 9.3). |
| `isms_search` | R | Cross-entity search across assets, risks, incidents, and tasks. |

### Users, groups and API tokens (14)

| Tool | Type | Description |
|---|---|---|
| `isms_list_users` | R | List all users. |
| `isms_list_groups` | R | List all groups/teams with their members. |
| `isms_create_user` | W | Create a new user account (admin only). |
| `isms_update_user` | W | Update user details, role, department, or active status (admin only). |
| `isms_delete_user` | D | Deactivate / delete a user account (admin only). |
| `isms_get_group` | R | Get details of a group / team including its members. |
| `isms_create_group` | W | Create a new team / group for task assignments and notifications (admin only). |
| `isms_update_group` | W | Update group name, description, or color (admin only). |
| `isms_delete_group` | D | Delete a group (admin only). |
| `isms_add_group_member` | W | Add a user as member to a group (admin only). |
| `isms_remove_group_member` | D | Remove a user from a group (admin only). |
| `isms_list_api_tokens` | R | List active API tokens for the authenticated user. |
| `isms_create_api_token` | W | Generate a new API token for the authenticated user (returns plaintext token string once). |
| `isms_revoke_api_token` | D | Revoke / delete an API token. |

### Audit log (2)

| Tool | Type | Description |
|---|---|---|
| `isms_list_audit_logs` | R | Query immutable ISMS audit log entries with filters. |
| `isms_verify_audit_logs` | R | Verify the cryptographic HMAC tamper-evidence integrity chain of the entire ISMS audit log. |

### Administration (11)

| Tool | Type | Description |
|---|---|---|
| `isms_list_features` | R | List all system compliance modules/features and their activation status (enabled/disabled). |
| `isms_set_feature_status` | W | Enable or disable a specific system feature/module. |
| `isms_get_settings` | R | Get general system settings (appName, review intervals, audit retention, SSO configuration, etc.). |
| `isms_update_settings` | W | Update general system settings (admin only). |
| `isms_get_permissions` | R | Get the role permissions matrix mapping system actions to roles. |
| `isms_update_permissions` | W | Update the role permissions matrix (admin only). |
| `isms_list_custom_roles` | R | List custom user roles and their assigned permission matrices. |
| `isms_create_custom_role` | W | Create a custom user role with specific permissions (admin only). |
| `isms_update_custom_role` | W | Update a custom user role (admin only). |
| `isms_delete_custom_role` | D | Delete a custom role (admin only). |
| `isms_run_automation` | W | Trigger background automation rules manually (generating recurring tasks, review reminders, and CVE status updates). |

