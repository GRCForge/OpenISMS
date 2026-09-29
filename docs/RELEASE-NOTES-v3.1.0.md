# OpenISMS v3.1.0 — Threat landscape and a NIS-2 catalogue that fits the entity

This release closes a gap that every NIS-2 self-check asks about and that
OpenISMS could not answer before: **Art. 21(2)(a) — threat analysis**.

It adds a threat-landscape module (source register, advisory intake,
assessment, handover into risk management) and makes the NIS-2 criteria
catalogue adjustable to how the organisation is actually affected: directly as
an essential or important entity, or only indirectly as a supplier.

Everything in this release is additive. No existing data is migrated,
rewritten or deleted.

---

## 1. Why this exists

A typical NIS-2 self-check asks two separate questions about threat analysis:

> **Implementation** — Are current cyber threats (e.g. warnings from the
> national cybersecurity authority / national CSIRT, security news) tracked
> and assessed regularly?
>
> **Evidence** — Are external warnings (national authorities, CSIRT/CERT,
> vendor information) fed systematically into internal risk management?

Both are about a *process*, not a document. Answering them needs three things
on record: which sources are monitored and how often, what each advisory was
judged to mean for this organisation, and what came of the ones that mattered.
That is what the new module records.

The same requirement exists in **ISO 27001:2022 A.5.7 (Threat intelligence)**,
so the module is not gated behind the NIS-2 module — it is enabled by default.

---

## 2. New module: Threat landscape (`threat_intel`)

Navigation: **Operations → Threat landscape** (`/threat-intel`).
Enabled by default; switch it off under *Administration → Modules*.

### 2.1 Source register

Every monitored source is a record with a **review cadence** (daily … quarterly),
a responsible person, and the date it was last actually looked at.

- **A source that has never been reviewed counts as overdue**, not as
  "not due yet". That is exactly the gap a self-check finds: sources are listed,
  nobody ever read them.
- Recording a review sets `last_reviewed_at`, computes the next date from the
  cadence, and writes an entry to the **signed audit log**. A review invented
  after the fact shows up there.
- The next date is computed from the day of the review, not from the missed
  date — a weekly source left for three weeks restarts at seven days instead of
  immediately owing two more reviews.
- A reminder goes to the responsible person **on the day after** a review
  becomes due — once per cycle, not daily, so it does not become noise.

A starter catalogue of **15 sources** can be loaded with one click, including
**BSI CERT-Bund (WID)** as the national CSIRT for Germany, CISA KEV, CISA
advisories, CERT-EU, ENISA, heise Security, and inactive placeholders for
CERT.at, NCSC Switzerland and CERT-FR. Sources outside the relevant
jurisdiction ship deactivated.

The statistics check explicitly whether a source of type **`national_csirt`**
is active. Without one, the module says so plainly: the self-check question
cannot be answered with "yes", however many other sources are listed.

### 2.2 Feed intake (RSS, Atom, CISA KEV)

Sources with a feed can be pulled, manually or nightly at **05:15**.

- **Automatic fetching is off by default per source** (`auto_fetch`). A fresh
  installation does not start calling out unasked — in a segregated environment
  that is exactly the traffic nobody can explain. The source still sits in the
  register and is reviewed by hand.
- **Deduplication** on `(source_id, external_id)`: a repeat fetch never creates
  a second copy and never overwrites an assessment that has already been made.
- **Advisories older than 90 days are skipped on intake.** A feed often carries
  a year of history on first fetch; that history is not "new warnings" and would
  leave hundreds of open assessments nobody can catch up on.
- A failed fetch is recorded per source in `last_fetch_status` and does not
  abort the run — one dead feed must not take the others with it.
- Fetching is separate from reviewing: "the feed runs" is not evidence that
  anyone read the advisories.

### 2.3 Assessment — the evidence

Each advisory carries an explicit judgement:

| Field | Meaning |
|---|---|
| `relevance` | not assessed / not relevant / monitor / relevant / critically relevant |
| `status` | new / under assessment / action required / handled / closed |
| `assessed_by`, `assessed_at` | who decided, and when — taken from the session, never from the request body |
| `assessment_notes` | why it is relevant, or not |

An advisory nobody has judged stays at `not_assessed` and shows up in the
statistics as an open assessment.

### 2.4 Handover into risk management

One click turns an advisory into a **risk** or a **task**, prefilled and linked
in both directions; an existing incident can be linked as well. The initial
impact of a generated risk is derived from the advisory's severity, so a
critical warning does not land in the register as a medium risk.

This is the concrete answer to the second self-check question, and it is
measurable: the statistics report how many advisories judged relevant have
actually been handed over.

### 2.5 Asset matching

Advisories are matched against the asset register **via CVE identifiers**,
reusing the ones the nightly CVE run already keeps on each asset. A name match
on "Apache" would hit every web server in the building and be noise rather than
a signal.

Automatic matches are stored as **suggestions** (`confirmed: false`,
`match_source: cve_match`) and wait for a person. An auditor can see the
difference between what the machine proposed and what a human established.

---

## 3. NIS-2 criteria catalogue by affectedness profile

### 3.1 The problem

NIS-2 does not hit everyone equally. An essential entity under Annex I owes the
full catalogue including the Art. 23 reporting duties. A supplier that is not in
scope itself owes the authority nothing — requirements reach it contractually
through Art. 21(2)(d), and only some of them.

Without that distinction the fulfilment rate measures the wrong thing, and
always downwards: an indirectly affected organisation sits permanently at "not
fulfilled" because it does not file the 24-hour early warning with the CSIRT —
which it is not required to file.

### 3.2 What was added

**An affectedness profile** (*NIS-2 → Affectedness profile*), stored with the
sector and a rationale, and written to the audit log because the classification
is a management decision that carries liability:

| Profile | Meaning |
|---|---|
| `essential` | Essential entity (Annex I) — full catalogue, proactive supervision |
| `important` | Important entity (Annex II) — same duties under Art. 21 and 23, ex-post supervision |
| `indirect` | Not in scope; supplier or service provider to an entity that is |
| `unknown` | Not classified yet |

`unknown` computes like `essential`. That is the safe direction: better to check
too much than to miss a duty you have.

**Per-criterion applicability**, editable in the UI, with three values per
profile — `required`, `recommended`, `not_applicable`. The Art. 23 reporting
duties, for instance, ship as `not_applicable` for indirectly affected entities,
with the note that a contractual notification duty towards the affected customer
usually takes their place.

**A fulfilment rate that only counts what applies.** Criteria excluded by the
profile, and criteria a person has set to "not applicable" for their own
operation, drop out of the calculation. Work in progress counts half — counting
it as unfulfilled would make every interim measurement worthless, counting it
fully would flatter the number. The result is reported with a **maturity level
from 1 to 5** so it can be held against an external self-check.

**Own criteria** can be added — for instance a requirement out of a customer
contract. The wording of a statutory article stays read-only: rewriting it would
make the catalogue worthless as a reference.

### 3.3 Catalogue extended from 13 to 18 criteria

Newly covered, so the catalogue matches the articles a NIS-2 self-check
actually asks about:

| Article | Criterion |
|---|---|
| Art. 20(1) | Approval and oversight of risk-management measures by the management body |
| Art. 20(2) | Training of the management body |
| Art. 21(3) | Assessment of the security practices of direct suppliers |
| Art. 21(4) | Prompt corrective measures on non-compliance |
| Art. 21(2)(d) ff. | Ability to produce evidence towards affected customers — `required` for indirectly affected entities, `recommended` for the rest |

**Existing installations**: `POST /api/nis2/sync-catalog` (button *Sync
catalogue*) adds only the criteria whose article reference is missing. Status,
evidence, responsible persons and any adjusted applicability are left untouched.
The old `/seed` still refuses to run once a catalogue exists — rightly so, as
one click would otherwise overwrite every recorded piece of evidence.

Art. 21(2)(a) now links straight to the threat-landscape module, so the evidence
is kept once rather than twice.

---

## 4. Security

### 4.1 Feed fetching is an SSRF surface

The server fetches URLs an administrator enters. The shared guard in
`backend/src/utils/safeFetch.js` therefore:

- accepts **http and https only**,
- resolves the host and refuses **every** address that is not public unicast —
  loopback, RFC 1918, link-local including the cloud metadata service at
  `169.254.169.254`, CGNAT, multicast, IPv6 unique-local and IPv4-mapped forms,
  checking **all** addresses a name resolves to, not just the first,
- refuses redirects outright, so a public URL cannot bounce the request onto an
  internal one,
- caps time (20 s) and size (8 MB), and does not trust `Content-Length`.

The residual risk this does not cover is DNS rebinding between resolution and
connection; that is stated in the source. For targets an administrator enters it
is acceptable, for arbitrary user input it would not be.

The OIDC avatar fetch in `routes/authOidc.js` now uses the same guard instead of
its own copy — one implementation, one place to fix, and it gains the
all-addresses check it did not have before.

### 4.2 Parsing foreign content without a parser dependency

`threatFeedParser.js` reads RSS, Atom and the CISA KEV JSON **without an XML
library**. Every additional dependency at this point is attack surface that has
to be maintained (XXE, entity expansion, prototype pollution in attribute
handling), and only a handful of known elements per entry are actually needed.

Scanning runs over `indexOf`, not regular expressions with nested quantifiers. A
pattern like `/<item>(.*?)+<\/item>/s` would fall into catastrophic backtracking
on suitable input and block the Node process — a denial of service delivered
through a data source somebody else operates. The test suite includes a
pathological input and asserts it finishes in milliseconds.

Input size, item count and field lengths are all bounded. Entities are decoded
*before* markup is stripped, not after: feeds routinely deliver descriptions as
escaped HTML, and stripping first would leave an escaped `<script>` sitting in
the record as visible text.

### 4.3 Request handling

- Route bodies are filtered through an explicit field allow-list. Passing
  `req.body` straight into `update()` would let a client set columns it must not
  — `assessed_by_id`, or someone else's `risk_id`.
- The assessor is taken from the session, never from the request, in both the
  REST route and the MCP tool.
- Deleting a source with advisories attached is refused with a 409 and a
  suggestion to deactivate it instead. The advisories *are* the evidence;
  removing them with the source would destroy exactly the history an audit wants
  to see.
- Applicability is only written when it is actually sent, so a form that merely
  displays it cannot reset an adjusted setting on every save.

---

## 5. New API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/threat-intel/sources` | Source register with overdue flag |
| `POST` | `/api/threat-intel/sources` | Add a source |
| `POST` | `/api/threat-intel/sources/seed` | Load the starter catalogue |
| `PUT` | `/api/threat-intel/sources/:id` | Update a source |
| `DELETE` | `/api/threat-intel/sources/:id` | Delete a source (refused while advisories exist) |
| `POST` | `/api/threat-intel/sources/:id/review` | Record a review, schedule the next |
| `POST` | `/api/threat-intel/sources/:id/fetch` | Fetch this feed now |
| `POST` | `/api/threat-intel/fetch-all` | Fetch every feed with `auto_fetch` |
| `GET` | `/api/threat-intel/advisories` | Advisory list (filters, paging) |
| `GET` | `/api/threat-intel/advisories/:id` | Advisory including affected assets |
| `POST` | `/api/threat-intel/advisories` | Record an advisory manually |
| `PUT` | `/api/threat-intel/advisories/:id` | Update an advisory |
| `POST` | `/api/threat-intel/advisories/:id/assess` | Assess (relevance, status, rationale) |
| `DELETE` | `/api/threat-intel/advisories/:id` | Delete an advisory |
| `POST` | `/api/threat-intel/advisories/:id/assets` | Link an asset |
| `DELETE` | `/api/threat-intel/advisories/:id/assets/:assetId` | Unlink an asset |
| `POST` | `/api/threat-intel/advisories/:id/match-assets` | Suggest assets via CVE identifiers |
| `POST` | `/api/threat-intel/advisories/:id/to-risk` | Create a linked risk |
| `POST` | `/api/threat-intel/advisories/:id/to-task` | Create a linked task |
| `GET` | `/api/threat-intel/stats` | Evidence figures for Art. 21(2)(a) |
| `GET` | `/api/nis2/profile` | Read the affectedness profile |
| `PUT` | `/api/nis2/profile` | Set the affectedness profile |
| `GET` | `/api/nis2/stats` | Fulfilment rate and maturity over applicable criteria |
| `POST` | `/api/nis2` | Add an own criterion |
| `POST` | `/api/nis2/sync-catalog` | Add missing catalogue criteria |

`openapi.json` covers all of them; `scripts/openapi-sync.js --check` runs in CI.

### New permissions

`threat_intel` with `view`, `create`, `edit`, `delete`, `assess`, `review`,
`fetch`, `seed`, and a new `nis2.create`. Defaults follow the existing modules
and are verified against the route fallbacks by `scripts/check-permissions.js`.

### New MCP tools

`isms_list_threat_sources`, `isms_list_threat_advisories`,
`isms_get_threat_intel_stats`, `isms_create_threat_advisory`,
`isms_assess_threat_advisory`, `isms_record_threat_source_review` — all gated
through the same permission matrix as the REST routes.

---

## 6. New tables

| Table | Content |
|---|---|
| `threat_sources` | Monitored sources: type, country, feed, cadence, responsible, last/next review, fetch status |
| `threat_advisories` | Advisories: severity, CVE identifiers, relevance, status, assessor, links into risk / task / incident |
| `threat_advisory_assets` | N:M advisories ↔ assets, with match source and confirmation flag |

`nis2_measures` gains `applicability` (JSONB) and `custom` (boolean). Existing
rows fall back to the catalogue default, so nothing has to be migrated by hand.

Schema changes are applied by `sequelize.sync({ alter })` on start, as elsewhere
in the project.

---

## 7. No new configuration

No new environment variables. Feed fetching is controlled per source in the UI
and is off by default.

---

## 8. Tests

Two new suites, both wired into `.github/workflows/security.yml`:

- **`scripts/test-threat-intel.js`** — feed parsing (RSS, Atom, KEV, CDATA,
  escaped markup, truncated XML, pathological input against backtracking), the
  SSRF address check across 19 addresses including the cloud metadata service,
  scheme rejection, review-date arithmetic, overdue logic, and intake
  deduplication with mocked models.
- **`scripts/test-nis2-applicability.js`** — catalogue integrity, coverage of
  the articles a self-check asks about, normalisation of foreign input
  (including `__proto__`), obligation per profile, and the rate calculation —
  in particular that an indirectly affected entity which has implemented
  everything applicable reaches 100 %, not 83 % because of three reporting
  duties it does not owe.

`check-permissions`, `openapi-sync --check`, `test-mcp-gate`, the frontend build
and the module-load smoke test all pass.

---

## 9. Upgrading

1. Deploy as usual — the schema is extended on start.
2. **NIS-2 module**: press *Sync catalogue* to pick up the five new criteria,
   then set the affectedness profile.
3. **Threat landscape**: load the starter catalogue, assign responsible people
   and cadences, deactivate what does not apply, and add the national CSIRT for
   your jurisdiction if it is not Germany.
4. Turn on `auto_fetch` only for the feeds you want pulled — and only if
   outbound HTTPS from the server is acceptable in your environment.
