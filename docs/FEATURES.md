# OpenISMS — Features

This document describes what OpenISMS does, module by module. For installation
and configuration see [CONFIGURATION.md](CONFIGURATION.md), for hardening a
production instance see [SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md),
and for the AI integration see [MCP.md](MCP.md).

---

## Contents

1. [Navigation at a glance](#1-navigation-at-a-glance)
2. [Modules (feature toggles)](#2-modules-feature-toggles)
3. [Cockpit: dashboard, my area, management report](#3-cockpit)
4. [Assets, vulnerabilities and discovery](#4-assets-vulnerabilities-and-discovery)
5. [Risk management](#5-risk-management)
6. [Controls and the Statement of Applicability](#6-controls-and-the-statement-of-applicability)
7. [Framework modules](#7-framework-modules)
8. [Incidents](#8-incidents)
9. [Threat landscape](#9-threat-landscape)
10. [Policies, documents and templates](#10-policies-documents-and-templates)
11. [Vendors and supply chain](#11-vendors-and-supply-chain)
12. [Privacy (GDPR)](#12-privacy-gdpr)
13. [Audits, KPIs and training](#13-audits-kpis-and-training)
14. [Business continuity](#14-business-continuity)
15. [Penetration tests](#15-penetration-tests)
16. [Relationship analysis (graph)](#16-relationship-analysis-graph)
17. [Tasks, reminders and notifications](#17-tasks-reminders-and-notifications)
18. [AI-assisted document review](#18-ai-assisted-document-review)
19. [Import, export and backup](#19-import-export-and-backup)
20. [Administration](#20-administration)
21. [User experience](#21-user-experience)
22. [Scheduled jobs](#22-scheduled-jobs)
23. [Built-in catalogues](#23-built-in-catalogues)

---

## 1. Navigation at a glance

The sidebar is organised in five groups. Entries are hidden when the user's
role or permission matrix does not allow them, or when their module is off.

| Group | Pages |
|---|---|
| **Cockpit** | Dashboard · My Area · Management Report |
| **Governance** | Compliance · Controls · Policies · Processing Register (VVT) · Data Subject Requests · Legal Requirements · ISO 27001 · BSI IT-Grundschutz · NIS-2 · BSI C5 · TISAX · EU AI Act |
| **Operations** | Assets · Vulnerabilities (CVEs) · Network Discovery · Threat Landscape · Risks · Incidents · Tasks · DORA · Pentests |
| **Resources** | Vendors · Contacts · Topology · Relationship Analysis · Assessments · Reminders · BCM |
| **System** | Import · Administration |

---

## 2. Modules (feature toggles)

Everything that is not core ISMS functionality is a module. Administrators
switch modules under **Administration → Modules**; no restart is needed. A
disabled module disappears from the navigation, and its API answers `403` — the
switch is enforced on the server, not only in the UI.

| Key | Module | Default |
|---|---|---|
| `dsgvo` | GDPR: processing register, DPIA, data subject requests, data flows | **on** |
| `discovery` | Network discovery, agent discovery, CheckMK, CVE matching | **on** |
| `threat_intel` | Threat landscape | **on** |
| `mcp` | MCP server (see note in [MCP.md](MCP.md#enabling-and-disabling)) | **on** |
| `iso27001` | ISO 27001:2022 Statement of Applicability | off |
| `bsi_grundschutz` | BSI IT-Grundschutz | off |
| `nis2` | NIS-2 / BSIG | off |
| `c5` | BSI C5:2026 | off |
| `tisax` | TISAX (VDA ISA) | off |
| `dora` | DORA | off |
| `ai_act` | EU AI Act | off |
| `bcm` | Business continuity management | off |
| `pentest` | Penetration test tracking | off |

Every change to the module state is written to the audit log.

---

## 3. Cockpit

### Dashboard
- KPI cards: assets, high and critical risks, upcoming and overdue reviews,
  framework coverage
- Risk distribution, assets by classification and by type, recent assessments
- Live activity feed from the audit log
- A **Getting started** panel guides new installations through the first steps;
  every empty list explains what belongs there and offers the matching action

### My Area
A personal start page: my tasks, the action items that apply to my role, my
training records (with the option to contest a record), my policy
acknowledgements.

### Management Report
- **ISMS Health Score** (0–100) from control coverage, assessment coverage,
  overdue reviews and critical risks
- Automatic KPI cards with sparklines and trend arrows: health score, control
  coverage, assessment coverage, open high risks, overdue reminders, task
  completion rate, MTTR over 90 days, assets, open incidents
- Three tabs: **Overview** (KPIs, distributions, alerts, manual KPIs),
  **Trends** (12-month history of incidents, risks, assets, tasks with KPI target
  lines), **Details** (NIS-2 assets, GDPR overview, risk acceptances, overdue
  reviews)
- **Management review sign-off** (ISO 27001 clause 9.3), digitally recorded
- Multi-sheet Excel export, including the processing register

---

## 4. Assets, vulnerabilities and discovery

### Asset register (ISO 27001 A.5.9 / A.8)
- **Types:** Hardware · Software · Application · Service · Information/Data ·
  Process · Personnel · AI Application · AI Agent · Other
- **Classification:** Public · Internal · Confidential · Secret
- **Hosting:** On-premise · Public cloud · Private cloud · Hybrid
- **Lifecycle:** Evaluation · Production · Maintenance · Archived
- Patch and hardening status, end-of-life date, CVE counters per severity
- Backup plan and last restore test, **RTO / RPO** per asset
- Business owner, assessor, linked vendor, NIS-2 relevance, frameworks, tags
- Parent/child dependencies
- Asset detail with tabs for master data, classification, dependencies,
  security, compliance, processing activities, incidents, documents and
  comments. The edit button opens the section of the active tab, and the
  permission matrix controls master data, compliance and security fields
  separately
- Documents per asset (drag & drop, up to 25 MB, with categories such as
  contract, DPA, certificate, risk report, risk acceptance) — each file is
  checked by content type and verified by SHA-256 on download
- Comments with Markdown and `@group` mentions

### Topology
An interactive dependency graph of all assets with type-specific node shapes,
clustering of parent and child assets, risk colouring and clickable nodes. Each
asset also shows its own graph (two levels up and down) and every asset that
depends on it.

### Vulnerabilities (CVE / CPE)
- CPE 2.3 suggestions and resolution per asset
- Matching in tiers: OSV.dev by package, NVD by CPE, NVD by keyword, Shodan
  CVEDB as a fallback
- A central vulnerability view across all technical assets, plus a per-asset
  report
- Nightly refresh of all active technical assets; an `NVD_API_KEY` raises the
  NVD rate limit
- **Vulnerability register** (ISO 27005:2022 8.2.4): vulnerabilities are
  recorded manually (title, description, severity, CVSS, related assets) or
  taken over from the CVE data of an asset — by selecting individual CVEs,
  never automatically. One entry per CVE; taking the same CVE over from a
  second asset links that asset. A vulnerability used in a risk scenario
  cannot be deleted. Permissions `vulnerabilities.view` (not viewer/employee),
  `vulnerabilities.manage` (admin, assessor, IT staff), `vulnerabilities.delete`

### Network discovery and staging
**No source creates assets on its own.** Everything a source reports lands in an
approval queue, and turning an entry into an asset is a recorded human decision.

| Source | What it delivers |
|---|---|
| Network scan | TCP sweep of a private /24 network (at most 254 hosts, 50 ports) |
| Discovery agent | Downloadable agent for Windows and Linux that reports installed software |
| CheckMK | Hosts from the monitoring system, reconciled idempotently |
| Spreadsheet import | Asset rows from CSV/XLSX arrive as proposals |

The queue shows source, type and open ports; entries are approved, ignored or
rejected individually or in bulk. Known IPs are not staged twice.

**CheckMK** deserves a note. The asset link is `external_source` +
`external_id`, so a re-sync never matches by name. A dry run reports what would
change and writes nothing. Because CheckMK enumerates its inventory completely,
a linked asset it no longer reports is marked `MISSING` — an asset your
monitoring has forgotten is a finding, not a maintained asset. A spreadsheet is
an excerpt and is never allowed to draw that conclusion. The CheckMK secret is
stored encrypted, and the connection can only be configured in the UI or the
REST API, never over MCP.

---

## 5. Risk management

### Protection needs assessment (CIA)
- Confidentiality, integrity and availability on a 1–5 scale per asset
- Score and level (Low / Medium / High / Critical) are calculated
- Full history per asset with trend indicators
- Treatment: Reduce · Accept · Transfer · Avoid
- The next review is scheduled and a reminder created automatically
- Templates for assessments and protection needs

### Risk register (ISO 27005)
- Likelihood × impact on the scales of the active **risk methodology**
  (see below)
- **Three levels:** gross (inherent), net (current, calculated from the
  implemented controls) and target (after the planned treatment, set
  manually). The register shows all three; the heatmap switches between them
- **Net-risk override:** the calculated net risk can be overridden with a
  mandatory rationale (permission `risks.override_residual`, default admin and
  assessor, plus the record rights). The risk is flagged *overridden*, who,
  when and why are shown together with the value the calculation gives, and
  the override and its removal are written to the audit log. The calculation
  stays the default; a reassessment removes an override
- **Impact dimensions** (ISO 27005:2022 7.2/8.3.3, BSI 200-3): if the
  methodology enables them, impact is rated per dimension — confidentiality,
  integrity, availability, financial, legal/regulatory, reputation,
  operational. The overall impact is the maximum of the rated dimensions
  (maximum principle); dimensions may stay empty. Risks from before 3.7.0 keep
  their single impact value, nothing is converted
- **Rationale:** whoever sets or changes likelihood or impact (including a
  dimension) states why — mandatory for the web interface, the API and the
  MCP tools, also on a reassessment. Existing risks without a rationale stay
  editable as long as their values do not change
- **Risk scenarios:** asset(s) × threat × vulnerability, several per risk.
  Scenarios are shown in the risk detail (record rights), not in the register
  list
- **Risk categories** are a maintained list (Administration → Risk
  methodology → Risk categories): key, labels in German, English and Spanish,
  order, active flag. The key never changes; deactivated categories are no
  longer offered for new risks; an entry is only deleted while no risk and no
  methodology version uses it. On upgrade, the nine former form values,
  "Bedrohungslage" and every other value found in existing risks or risk
  appetites become entries; risks are not changed. Imports accept the key or a
  label; unknown values fail the row
- Linked to assets, threats (BSI elementary threats and custom threats) and
  controls with an effectiveness rating; only implemented controls lower the
  residual likelihood
- Risk owner, treatment plan (free text), risk templates
- **Treatment options** (ISO 27001 6.1.3 b): several per risk (for example
  mitigate + transfer); the main option stays as before and is always part of
  the list. Risks from before 3.8.0 keep their single option
- **Structured risk treatment plan** (ISO 27001 6.1.3 c–e, 8.3; ISO 27005
  clause 9): measures per risk with title, description, option, responsible
  person *or* group, due date, status (planned, in progress, implemented,
  discarded — discarded only with a reason), one-off and recurring costs in
  EUR and a link to an existing control and/or task. The free-text plan stays
  visible and is not converted. Every change is in the audit log; the record
  rights are those for editing the risk
- **Task from a measure:** one click creates a task (assignee or group, due
  date, priority from the risk level, notification). The status stays in step:
  task done → measure implemented, reopened → in progress; measure implemented
  → task done, discarded → open task cancelled — logged each time. Overdue
  measures remind the responsible person (or group) once a day
- **Progress per risk:** share of implemented measures (discarded ones do not
  count), overdue measures and — in the detail view — the cost totals. If all
  measures are implemented but the net risk is still above the risk appetite,
  the risk shows a hint
- **Risk treatment plan overview** (Risks → Treatment plan): all measures with
  risk, level, responsible, due date, status, overdue flag, costs, control and
  task, plus the open risks without any active measure; Excel export with
  formula injection neutralised. Evidence for ISO 27001 6.1.3 e. Admin,
  assessor and management see everything, others their own risks and the
  measures they (or their group) are responsible for
- **Risk acceptance with the four-eyes principle** (ISO 27001 6.1.3 f, ISO
  27005 9.6): whoever may edit the risk requests the acceptance (permission
  `risks.request_acceptance`) with a justification, the requested validity and
  the residual risk; the level at that moment is stored with the request. A
  person with acceptance authority under the methodology who is **not** the
  requester approves or rejects it (with a reason); the requester can
  withdraw it. If the level changes before the decision, the request can no
  longer be approved. The risk owner confirms the acceptance of the residual
  risk — the confirmation is shown on the request. One open request per risk.
  The sign-off (`PATCH /api/risks/:id/signoff`, `isms_signoff_risk`) now
  approves the open request. Acceptances given before 3.8.0 stay valid as they
  are
- **Risk acceptance** has an expiry date; acceptances expiring within 30 days
  are flagged and mailed, expired ones turn red. A sign-off can be revoked;
  the request then records why the acceptance ended (revoked, lapsed,
  superseded by a renewal). The status "accepted" is only set through an
  approved request, never through the edit form, an import or an MCP update
- If the decisive level of an accepted risk rises (for example after a
  reassessment), the acceptance lapses and the change is logged
- Flags and filters for risks above the risk appetite and for risks that need
  reassessment
- The risk matrix (heatmap) works as a click filter; CSV and Excel export

### Risk methodology (ISO 27005 clauses 6/7, ISO 31000 6.3.4, ISO 27001 6.1.2 a)
Administration → Risk methodology defines how risks are assessed:
- **Scales:** 3 to 6 levels each for likelihood and impact, set separately
  (for example 4 × 5). Each level has a German and English label, a criterion
  (frequency, damage in EUR, outage duration …) and an optional numeric range
  with a unit
- **Risk levels:** low, medium, high and critical with label, colour and score
  thresholds (score = likelihood × impact). The thresholds must start at 1,
  end at the highest score and leave neither gaps nor overlaps; a level that
  contains no reachable score is reported as a warning
- **Impact dimensions:** which dimensions are rated separately (see the risk
  register); labels and a criterion per dimension can be set. Changing the
  selection creates a new version
- **Risk appetite / tolerance:** the highest tolerated level per entry of the
  risk category list plus an optional default. The residual risk counts (the inherent risk where
  there is no residual); risks above it are flagged in the register, the API
  and the MCP tools
- **Acceptance authority:** per level, the roles allowed to accept a risk and
  the maximum validity of an acceptance in months. The server enforces it for
  the web interface, the API and the MCP tool `isms_signoff_risk`; without a
  date the longest permitted validity is set
- **Versioning:** every saved change creates a new, immutable version; exactly
  one is active. Earlier versions stay readable with their author, date and
  change note. Changes are recorded in the audit log
- **No silent conversion:** risks stay on the version they were assessed
  under and show it. After a change they appear on the list *Needs
  reassessment*; an explicit reassessment moves them to the active version and
  is logged. With an unchanged matrix size, an administrator can carry risks
  over after confirmation — the level is then recalculated from the new
  thresholds and logged per risk. A risk under an older version cannot be
  signed off until it is reassessed
- Live validation with a matrix preview and the number of risks a change
  would affect; suggested thresholds when the matrix size changes
- **Upgrade:** the default methodology is exactly the 5 × 5 scale used up to
  3.5.1 (thresholds 1–4 / 5–9 / 10–14 / 15–25, acceptance by admin, assessor
  and risk owner without a maximum validity, no appetite). Existing risks are
  assigned to it without changing their values or levels
- Permission `risks.manage_methodology` (default: admin). `risks.sign_off`
  additionally includes management by default; which levels each role may
  accept is decided by the methodology

---

## 6. Controls and the Statement of Applicability

- Controls for ISO 27001 Annex A, NIS-2, BSI IT-Grundschutz and custom controls
- Control types: organisational · people · physical · technological
- Status: implemented · planned · not applicable (with justification)
- Linked to risks (with effectiveness) and to policies
- **Cross-framework requirement mapping:** one control can satisfy requirements
  from ISO 27001, BSI IT-Grundschutz, NIS-2, C5 and TISAX at the same time, with
  full or partial coverage per mapping. A built-in mapping table with 277
  entries connects ISO 27001, NIS-2, BSI IT-Grundschutz and C5:2026. Every
  mapping change is audit-logged

---

## 7. Framework modules

| Module | What you get |
|---|---|
| **Compliance overview** | Coverage per framework (ISO 27001, NIS-2, GDPR) with the assigned and unassigned assets, quick assignment, and **GDPR gap detection**: assets that process personal data (Art. 6/9) without a complete processing record |
| **ISO 27001:2022** | Statement of Applicability for all 93 Annex A controls in four themes |
| **BSI IT-Grundschutz** | Information domains, modelling and the IT-Grundschutz check per BSI Standard 200-2, on versioned catalogues — see below |
| **BSI C5:2026** | 174 criteria in 18 domains with status and evidence |
| **TISAX** | Assessments with label and validity, plus a VDA ISA self-assessment of maturity levels 0–3 (38 requirements) |
| **NIS-2 / BSIG** | See below |
| **DORA** | ICT third-party register and digital operational resilience tests (including TLPT) |
| **EU AI Act** | Inventory of AI systems with risk class (prohibited / high / limited / minimal), governance fields, technical documentation and conformity status |
| **Legal requirements** | A register of legal and contractual obligations |

### NIS-2 and the German BSIG
- **Criteria catalogue** on two levels: 23 legal anchors — Art. 20, 21 and 23
  and the German duties of §§ 31, 33, 34, 35 and 39 BSIG — over 103 checkable
  sub-requirements. A parent with children is a bracket; it derives its
  progress instead of carrying its own status
- Each criterion carries its BSIG citation, its applicability per **entity
  profile** (essential / important / indirectly affected), a scope note where a
  duty is conditional (operators of critical facilities, DORA precedence) and
  links to the matching BSI source. Cryptography criteria carry the concrete
  figures from BSI TR-02102
- **Self-check:** 37 questions, each answered on two axes — *implemented* and
  *evidenced* — with maturity per topic, coverage per article and a ranked gap
  list. A gap becomes a task with one click
- The **scoring model** (weights, the value of "partly", maturity thresholds) is
  editable and audit-logged
- Incident reporting deadlines are covered in the incident module

### BSI IT-Grundschutz (BSI Standard 200-2)
- **Versioned catalogues:** the IT-Grundschutz-Kompendium (DocBook XML as
  published by the BSI) or a Grundschutz++ catalogue (OSCAL JSON) is imported at
  runtime, by upload or from an allowed HTTPS URL. An import is a preview with a
  comparison against the active catalogue (new / changed / withdrawn) and only
  takes effect when activated. Existing status, owners and notes are kept;
  requirements no longer in the catalogue are marked as retired, never deleted.
  A built-in excerpt (64 requirements in 25 modules) is available from the start
- **Information domains** (Informationsverbund) with scope and protection
  approach — basic, standard or core protection — and several domains per
  installation
- **Target objects:** assets from the asset register, assigned to a domain with
  their Grundschutz type (business process, application, IT system, ICS, room,
  building, network). The type is suggested from the asset type
- **Modelling:** Kompendium modules or Grundschutz++ practices are assigned to a
  target object or to the whole domain. Suggestions per target type are applied
  only by an explicit click
- **IT-Grundschutz check** per target object: yes / partially / no /
  dispensable / open. "No" and "dispensable" require a justification, enforced
  on the server. Each entry carries a responsible user or group, a due date,
  one-off and recurring costs, evidence documents and linked controls
- The protection approach filters the requirements (basic: B; standard: B+S;
  core: B+S+H). Fulfilment per module and target object and cost totals are
  calculated
- **Excel export** in the layout of the BSI reference document A.4
  "IT-Grundschutz-Check"
- New permissions `bsi_grundschutz.manage_catalog` and
  `bsi_grundschutz.manage_domain`; every import, activation and change is
  audit-logged

---

## 8. Incidents

- Documentation per NIS-2 Art. 23 / § 32 BSIG and ISO 27001 A.5.24–A.5.28
- Categories: malware · phishing · data breach · DoS/DDoS · unauthorised access ·
  misconfiguration · loss/theft · social engineering
- Severity and status history (reported → under investigation → contained →
  resolved → closed)
- **Reporting deadlines** calculated from the detection time: 24-hour early
  warning and 72-hour notification under NIS-2, 72-hour notification to the
  supervisory authority under GDPR Art. 33, with overdue warnings
- Impact, root cause, corrective actions, lessons learned, number of affected
  systems, the authority's reference number
- Data-breach fields appear when the category or the NIS-2 duty calls for them
- Linked to assets and risks; documents per incident
- Deleting an incident requires a reason and is audit-logged

---

## 9. Threat landscape

Evidence for NIS-2 Art. 21(2)(a) and ISO 27001 A.5.7 that threats are monitored
and acted on.

- **Source register** with review cadence and overdue flag; 15 seed sources
  (BSI CERT-Bund, BSI Bürger-CERT, CISA KEV, CISA advisories, CERT-EU, CERT.at,
  CERT-FR, heise Security, BleepingComputer, ENISA, NCSC Switzerland, MSRC,
  vendor advisories, sector ISAC, internal SIEM/EDR)
- **Feed intake** for RSS, Atom and the CISA KEV JSON, per source or all at
  once, and on a nightly schedule for sources set to auto-fetch. Outbound fetches
  only reach public addresses (SSRF protection)
- **Assessment** of each advisory: relevance, who decided, when and why
- **Asset matching**, manually or by CVE
- **Hand-over** of an advisory into a risk or a task, so the register shows what
  each advisory turned into
- Evidence figures: monitoring and hand-over rates; CSV export

---

## 10. Policies, documents and templates

- Central library for policies, guidelines, procedures and contracts
- **Versioning**: every saved version stays downloadable
- Validity period, status (draft / active / withdrawn), linked assets and
  controls
- **Acknowledgements**: users confirm they have read a policy; the library shows
  who has and who has not
- Templates for documents in their own tab
- Uploads up to 20 MB (policies) or 25 MB (other documents), checked by
  extension, MIME type and file signature
- All documents — policies, contracts, DPAs, certificates, risk reports and
  templates — are stored under one directory (`UPLOAD_DIR`) and included in the
  in-app backup

---

## 11. Vendors and supply chain

- Vendor directory: IT service providers, cloud and software vendors, support,
  consultants
- Data processor, DPA and GDPR flags; vendor risk assessment
- Several contacts per vendor, also listed across vendors under **Contacts**
- Asset → vendor links document the supply chain (NIS-2 Art. 21(2)(d))
- Documents per vendor
- **AI triage** of vendor documents — see [section 18](#18-ai-assisted-document-review)

---

## 12. Privacy (GDPR)

| Feature | Details |
|---|---|
| **Processing register (Art. 30)** | All mandatory fields, eight templates (e.g. CCTV, access control, employee monitoring), last review date, statistics |
| **DPIA (Art. 35)** | Obligation indicator with warning, and a DPIA form per processing activity |
| **Data subject requests (Art. 15–22)** | Access, erasure, rectification, restriction, portability, objection; 30-day deadline (extendable to 60) with overdue warning; status history |
| **Data flows** | Diagram of personal-data flows between assets and systems |
| **Data breaches** | Through the incident module, with the Art. 33 deadline |

---

## 13. Audits, KPIs and training

These live as tabs under **Compliance**.

- **Audits:** internal and external audits, findings with severity and
  remediation, corrective actions (CAPA) as tasks, audit documents
- **KPIs:** manual KPIs with target value, unit and frequency, measurement
  history and target line in the management report
- **Training and awareness:** training catalogue, training records per user,
  bulk import of participants from CSV/XLSX (`name`, `email`, `department`,
  `completed`), mandatory-training flag, expiry reminders. Employees see their
  own records in **My Area** and can contest an entry. Linked to ISO 27001 A.6.3
  and NIS-2 Art. 20

---

## 14. Business continuity

- Business impact analysis: critical processes with RTO/RPO, linked assets and
  recovery strategies
- Exercise log for tabletop exercises and recovery drills
- Recovery objectives come straight from the asset register

---

## 15. Penetration tests

Pentest projects with reports, findings (CVSS, severity, remediation, retest)
and remediation tracking through to closure.

---

## 16. Relationship analysis (graph)

Powered by **Apache AGE** inside the same PostgreSQL database — no second
datastore, no synchronisation, one backup. Optional: without the extension only
this page reports that it is unavailable.

- **Impact:** what depends on an object over one to four steps — processes,
  risks, controls, requirements — with the distance to each. Edges are followed
  in both directions, because a failure travels against the arrow
- **Evidence:** why a requirement counts as met — the controls that satisfy it,
  the risks they mitigate, the assets behind them — and plainly whether it is
  covered at all
- **Path:** the shortest connection between two objects, as a diagram

The tables stay authoritative. The graph is a projection maintained by database
triggers in the same transaction, and `POST /api/graph/rebuild` restores it from
the tables at any time.

---

## 17. Tasks, reminders and notifications

- **Tasks** assigned to a user or a **group**; for a group task the first member
  to complete it completes it for everyone, and the task shows who did
- **Task automation** (on start and nightly) creates and closes tasks for
  recurring duties: incomplete assets, users without MFA after seven days,
  annual owner re-verification, offboarding, AI systems, high risks, data
  subject requests, critical incidents
- **Review reminders** one year after each assessment; overdue reviews are
  flagged daily and mailed
- **Notifications** in the bell menu, as e-mail (SMTP) and as browser push
  notifications (Web Push, VAPID keys generated on first start)

---

## 18. AI-assisted document review

Optional; configured under **Administration → LLM**.

| Provider | Default model |
|---|---|
| Anthropic | `claude-opus-4-8` |
| OpenAI (or any OpenAI-compatible endpoint) | `gpt-4o` |
| Google Gemini | `gemini-2.0-flash` |
| Ollama (local) | `llama3.2` |

- **Vendor triage:** checks DPAs, TOMs, SOC 2 reports, SLAs, OLAs and similar
  documents against requirement catalogues (*triage profiles*, editable by
  administrators). The result is coverage per requirement (met / partial /
  missing / n/a) and findings (critical / warning / gap) referencing GDPR,
  ISO 27001 and DORA
- **Document and policy analysis:** the same approach for your own documents,
  with verbatim evidence quotes

API keys are stored encrypted. With Ollama, documents never leave your network.

---

## 19. Import, export and backup

- **Export:** CSV (UTF-8 with BOM, formula injection neutralised) and Excel on
  the list pages — assets, risks, assessments, reminders, audit log, processing
  register; multi-sheet Excel for the management report; CSV for the threat
  register
- **Import:** CSV and Excel for assets, users, vendors, vendor contacts and
  risks, with preview and downloadable templates. **Asset rows become proposals
  in the discovery queue**, not assets — a spreadsheet from an inbox is no
  shortcut past the approval every other source has to pass. A re-import keyed by
  inventory number updates the proposal and never overwrites maintained fields of
  an approved asset
- **Microsoft 365 quickstart:** typical M365 services as a ready-made import
- **Backup and restore** (administrators): a ZIP with all tables and every
  uploaded document. `backup-meta.json` records how many files the backup holds
  and how many database entries point to a missing file. Restore runs in one
  transaction, validates tables and columns against the live schema and overlays
  files instead of deleting existing ones. See
  [SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md#8-backups) before you
  store backups anywhere

---

## 20. Administration

Under **Administration** (administrators only):

| Tab | Purpose |
|---|---|
| Users | Create, assign roles, deactivate (no hard delete), reset passwords |
| Groups | Teams for task assignment and `@group` mentions |
| Modules | Feature toggles |
| Audit log | Filterable log with retention setting and integrity check |
| Security | Password policy, account lockout, audit log retention, SSO (OIDC), custom roles, OIDC claim → role mappings |
| SMTP | Mail server with connection test and test mail |
| Settings | Application name, review interval |
| Roles & permissions | The permission matrix per module and action; reset to defaults |
| API | Links to the OpenAPI spec and Swagger UI, authentication guide |
| Backup | Export, preview and restore |
| LLM | AI provider and triage profiles |

### Users and authentication
- Eight built-in roles plus **custom roles** — see
  [SECURITY-CONFIGURATION.md](SECURITY-CONFIGURATION.md#4-roles-and-permissions)
- Local login with password policy and account lockout
- **TOTP** (RFC 6238) and **passkeys** (WebAuthn / FIDO2)
- **SSO** via any OIDC provider (Authentik, Keycloak, Entra ID, Google,
  Zitadel, Okta, Auth0 …) with auto-provisioning, domain allow-list, claim →
  role mapping and profile pictures
- Personal **API tokens** for scripts and MCP clients

### Audit log
Every change — assets, assessments, risks, controls, incidents, users, vendors,
documents, settings, logins, module switches, mappings — is logged with before
and after values. Each entry carries an HMAC-SHA256 signature, and
`GET /api/audit-log/verify` reports any modified row. Retention is configurable
(default 15 months, minimum 3). CSV and Excel export.

### REST API
- OpenAPI 3.0 at `/api/openapi.json` (authentication required)
- Swagger UI at `/api/docs`, using the session of the logged-in user

---

## 21. User experience

- **Languages:** English, German, Spanish (translations managed with Crowdin)
- **Progressive Web App:** installable on desktop and mobile, with app shortcuts
- **Command palette** (`Ctrl+K` / `⌘K`) across assets, risks, tasks and policies
- **Keyboard shortcuts:** `N` new entry · `/` focus search · `Esc` close dialog
- **Mobile:** bottom navigation with the five most-used areas; tables switch to
  cards on small screens
- Contextual help texts and entry actions on every empty page

---

## 22. Scheduled jobs

| Time (server time) | Job |
|---|---|
| on start and 03:00 | Task automation |
| 00:00 | Overdue reminders (in-app and e-mail) |
| 02:00 | Audit log retention purge |
| 02:30 | CVE refresh of all active technical assets |
| 04:00 | Removal of expired API tokens |
| 05:15 | Threat feed refresh (sources with auto-fetch) |
| 07:45 | Threat source review reminders |
| 08:00 | Expiring risk acceptances and trainings |
| on start and 08:00 | Overdue risk treatment measures (in-app reminder to the responsible person or group, once a day) |

---

## 23. Built-in catalogues

Seeded on first start or when a module is enabled:

| Catalogue | Size |
|---|---|
| ISO 27001:2022 Annex A | 93 controls |
| BSI C5:2026 | 174 criteria in 18 domains |
| BSI IT-Grundschutz | 64 requirements in 25 modules (built-in excerpt; full Kompendium or Grundschutz++ catalogues are imported) |
| TISAX / VDA ISA | 38 requirements |
| NIS-2 / BSIG criteria | 126 entries (23 anchors, 103 sub-requirements) |
| NIS-2 self-check | 37 questions |
| Threat sources | 15 sources |
| Cross-framework mappings | 277 entries |
| Threats | BSI elementary threats and common threats |
