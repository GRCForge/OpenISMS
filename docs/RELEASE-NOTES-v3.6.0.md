# OpenISMS v3.6.0 — configurable risk methodology

Feature release. Contains database migrations (run automatically on start); no configuration changes. Behaviour is unchanged until the methodology is edited — except for the points under "Changed behaviour".

## New: risk methodology (ISO 27005 clauses 6/7, ISO 31000 6.3.4, ISO 27001 6.1.2 a)

- **Scales:** 3 to 6 levels each for likelihood and impact, set separately. Each level has a German and English label, a criterion (frequency, damage in EUR, outage duration …) and an optional numeric range with a unit.
- **Risk levels:** low / medium / high / critical with label, colour and score thresholds (score = likelihood × impact). Thresholds must start at 1, end at the highest score and leave no gaps or overlaps; levels without a reachable score are reported as a warning.
- **Risk appetite:** highest tolerated level per risk category plus an optional default. Risks above it (residual, else inherent) are flagged in the register, the API and MCP.
- **Acceptance authority:** per level, the roles allowed to sign off a risk and the maximum validity in months — enforced on the server for UI, API and `isms_signoff_risk`. Without a date the longest permitted validity is set.
- **Versioning:** every saved change creates a new immutable version; earlier versions stay readable with author, date and change note. Changes are audit-logged.
- **No silent conversion:** risks stay on the version they were assessed under. After a change they appear on the list "Needs reassessment"; an explicit reassessment moves them to the active version. With an unchanged matrix size an administrator can carry risks over after confirmation (levels recalculated from the new thresholds, logged per risk). Risks under an older version cannot be signed off until reassessed.
- **Permissions:** new permission `risks.manage_methodology` (admin by default). `risks.sign_off` now also includes management by default; which levels a role may accept is decided by the methodology.
- **API:** `/api/risks/scale` returns the active methodology (`?version=<id>` for earlier ones; now requires `risks.view`); `/api/risks/methodology` (versions, validate, save, carry-over); `/api/risks/reassessment`; `PUT /api/risks/{id}` with `reassess: true`.
- **MCP:** new tool `isms_get_risk_methodology`; `isms_list_risks` and `isms_get_risk` report `appetite_exceeded`, `needs_reassessment` and the methodology version, and can filter by them (216 tools).
- **UI:** Administration → Risk methodology with live validation and matrix preview; risk matrix (heatmap) as click filter, form scales from the methodology, flags and filters in the register (de, en, es).

## Migrations

- New table `risk_methodologies` (one row per version, partial unique index for the single active version).
- `risks` gains `methodology_id`.
- On first start the default methodology is created as version 1: exactly the 5 × 5 scale used up to 3.5.1 (thresholds 1–4 / 5–9 / 10–14 / 15–25, acceptance by admin, assessor and risk owner without a maximum validity, no appetite). All existing risks are assigned to it; values, levels, acceptances and `updated_at` are unchanged.

## Changed behaviour

- The status "accepted" is only set through the sign-off — no longer through the edit form, `isms_update_risk` or an import.
- If the decisive level of an accepted risk rises, the acceptance lapses (audit-logged).
- `isms_get_risk` now applies the same record check as `GET /api/risks/{id}` (admin, assessor or risk owner).
- The form shows the methodology's level labels (default: "Rare … Almost certain", "Negligible … Existential").

## Fixes

| Problem | Change |
|---|---|
| `isms_create_risk` used its own thresholds (score 15/16 = high instead of critical) and computed no residual risk. Risks created that way keep their stored level until they are saved again. | Uses the shared risk service and the methodology |
| `isms_update_risk`, `isms_signoff_risk`, `isms_revoke_risk_signoff` had no record-level check | Same rules as the REST API |
| MCP risk search did not escape `%` / `_` | `escapeLike` |
| Revoking a sign-off via REST was not audit-logged | Logged with the previous acceptance |
| Risk list showed "-NaN%" as reduction | Uses likelihood × impact |

## CI

- New check `scripts/test-risk-methodology.js` in the Security & Quality workflow. The database test `scripts/test-risk-methodology-db.js` needs PostgreSQL and runs locally.
