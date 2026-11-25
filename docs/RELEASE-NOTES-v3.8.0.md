# OpenISMS v3.8.0 — risk treatment and acceptance workflow

Feature release. Contains database migrations (run automatically on start); no configuration changes. One behaviour change for scripts that sign off risks directly (see below).

Risk treatment becomes a plan that can be followed up and audited, and risk acceptance is put under the four-eyes principle (ISO/IEC 27001:2022 6.1.3 c–f and 8.3, ISO/IEC 27005:2022 clause 9).

## New: risk treatment plan

- **Measures per risk:** title, description, treatment option, responsible person or group, due date, status (planned, in progress, implemented, discarded — discarding needs a reason), one-off and recurring costs in EUR, link to an existing control and/or task. Measures are not deleted; they are discarded.
- **Tasks:** one click creates a task from a measure (assignment, due date, priority from the risk level, notification). When the task is done, the measure is implemented — and the other way round; reopening and discarding are kept in step as well. Every change is audit-logged.
- **Reminders:** overdue measures remind the responsible person or group once a day (in-app).
- **Progress:** percentage implemented and overdue measures per risk, cost totals in the detail view; a hint when all measures are implemented but the net risk is still above the risk appetite.
- **Several treatment options per risk** (for example mitigate + transfer); the existing option stays the main one. Existing risks are unchanged until the list is set.
- **Overview:** new page *Risks → Treatment plan* with all measures across risks, responsible, due dates, overdue flags and costs, plus open risks without a measure — with Excel export (formula injection neutralised) as evidence for ISO 27001 6.1.3 e. Administrators, assessors and management see everything; others see their own risks and the measures they or their group are responsible for.
- The free-text treatment plan is kept and shown; nothing is converted.

## New: risk acceptance with the four-eyes principle

- Acceptance is **requested** with a justification, the requested validity and the residual risk (the level at the time of the request is recorded).
- A person with acceptance authority under the risk methodology **who is not the requester** approves or rejects it; rejecting needs a reason. The requester can only withdraw.
- The **risk owner confirms** the acceptance of the residual risk (ISO 27001 6.1.3 f); the confirmation is shown on the request.
- If the risk level changes before the decision, the request can no longer be approved. A new request for an accepted risk renews the acceptance and supersedes the previous one; revocations and lapses are recorded on the request. One pending request per risk.
- **Permissions:** new permission `risks.request_acceptance` (default: admin, assessor, IT staff, DPO, owner). Customised permission matrices should be reviewed.

## MCP

- 11 new tools: `isms_list_risk_treatment_items`, `isms_create_risk_treatment_item`, `isms_update_risk_treatment_item`, `isms_create_task_from_treatment_item`, `isms_get_risk_treatment_plan`, `isms_list_risk_acceptance_requests`, `isms_request_risk_acceptance`, `isms_approve_risk_acceptance`, `isms_reject_risk_acceptance`, `isms_withdraw_risk_acceptance`, `isms_confirm_risk_acceptance_as_owner` (236 tools).
- `isms_create_risk` / `isms_update_risk` accept `treatment_options`; `isms_get_risk` returns measures and acceptance requests.

## Changed behaviour

- A direct sign-off (`PATCH /api/risks/{id}/signoff`, MCP `isms_signoff_risk`) now approves the pending acceptance request and returns **409** if there is none. Scripts that signed off directly must first request the acceptance (`POST /api/risks/{id}/acceptance-requests` or `isms_request_risk_acceptance`) as a different user.
- Acceptances given before 3.8.0 stay valid.

## API

- `GET /api/risks/treatment-plan`, `GET /api/risks/acceptance-requests`
- `/api/risks/{id}/treatment-items` (list, create, update, `{itemId}/task`)
- `/api/risks/{id}/acceptance-requests` (list, create, `{requestId}/withdraw`, `/approve`, `/reject`, `/confirm-owner`)

## Migrations

- New tables `risk_treatment_items` and `risk_acceptance_requests`; partial unique index for one pending request per risk.
- `risks` gains `treatment_options` (NULL = main option only) and `acceptance_request_id`. Existing risks, free-text treatment plans and acceptances are not changed.

## CI

- New check `scripts/test-risk-treatment.js` in the Security & Quality workflow. The database test `scripts/test-risk-treatment-db.js` needs PostgreSQL and runs locally.
