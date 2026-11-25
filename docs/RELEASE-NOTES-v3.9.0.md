# OpenISMS v3.9.0 — risk monitoring

Feature release. Contains database migrations (run automatically on start); no configuration changes. Assessments are never changed automatically. New are periodic review reminders, reassessment flags with tasks for risk owners, and acceptance expiry notices — see "Changed behaviour" for what happens right after the upgrade.

## New: risk monitoring and review (ISO 27005 clause 10, ISO 27001 8.2/9.1, NIS-2 Art. 21)

- **Assessment history:** every change of the gross, net or target assessment is kept as an immutable entry with values, levels, methodology version, trigger (created, assessment, reassessment, carry-over, net-risk override, recalculation, confirmed review), user and time. All write paths are covered (form, API, MCP, import, threat advisory, carry-over); the saves of one operation become one entry.
- **History chart** per risk and **trend heat map** (Risks → Monitoring): assessments valid at two dates, how many risks moved from which cell to which, level transitions, improved/worsened/unchanged.
- **Periodic review:** review cycle per risk level in the methodology (default critical 3, high 6, medium 12, low 24 months; a change creates a new version). Next review after the last assessment or confirmed review, or on the earlier review date. Overdue reviews are flagged and become a task for the risk owner; confirming a review needs a note.
- **Triggers for reassessment:** a new or raised incident on an asset of the risk, a new audit finding linked to the risk, a threat advisory assessed as relevant/critical with confirmed assets, a new critical/high CVE on an asset of the risk, a KRI breach. The risk is flagged with the reason and the owner gets a task — at most one open flag and task per risk and trigger type. Completing the task closes the flag.
- **Key risk indicators:** link existing KPIs to a risk with threshold and direction; evaluated on each measurement and daily, a breach flags the risk once per breach. Numeric values such as "12,5" and "80 %" are evaluated.
- **Expiring risk acceptances:** flagged 30 days ahead, expired ones in red; in-app and e-mail to owner and approver.
- **Dashboard and management report:** trend, overdue reviews, KRI breaches, appetite breaches, open reassessments, expiring/expired acceptances.
- **API:** `/api/risks/monitoring/summary`, `/api/risks/monitoring/trend`, `/api/risks/review-flags`, `/api/risks/{id}/history`, `/api/risks/{id}/review-flags`, `POST /api/risks/{id}/review`, `/api/risks/{id}/kris`; `risk_ids` on audit findings. No new permission (`risks.view` / `risks.edit`, record rights as for the risk detail).
- **MCP:** 9 new tools — `isms_get_risk_history`, `isms_get_risk_trend`, `isms_get_risk_monitoring_summary`, `isms_list_risk_review_flags`, `isms_review_risk`, `isms_list_risk_kris`, `isms_link_risk_kri`, `isms_update_risk_kri`, `isms_unlink_risk_kri` (245 tools). `isms_create_incident` accepts `asset_ids` and records the reporter; audit finding tools accept `risk_ids`.
- **UI:** monitoring section in the risk form, page Risks → Monitoring, register badges and filters, review cycles in Administration → Risk methodology, risk reference in audit findings (de, en, es).

## Migrations

- New tables `risk_assessment_history`, `risk_kris`, `risk_review_flags`, `job_runs`, `audit_finding_risks`.
- `risks` gains `last_reviewed_at`; `risk_methodologies` gains `review_cycles` (NULL on existing versions = default cycles).
- On first start every existing risk gets one history entry from its current assessment, marked "baseline at upgrade"; `last_reviewed_at` is taken from `updated_at`. Values, levels, acceptances and `updated_at` are unchanged.

## Changed behaviour

- Right after the upgrade, risks whose last change is older than the review cycle of their level are flagged as overdue, and their owners get a task.
- The daily monitoring run (06:30 and on start) and the risk acceptance expiry check (08:00) run once per day across all instances (`job_runs`).

## Fixes

| Problem | Change |
|---|---|
| FEATURES.md promised expiry notices for risk acceptances; only asset assessments had them | Implemented for the risk register (owner and approver, in-app and e-mail) |
| A compliance route returned a raw error message with HTTP 400 | Uses the shared `requestError()` |

## CI

- New check `scripts/test-risk-monitoring.js` in the Security & Quality workflow. The database test `scripts/test-risk-monitoring-db.js` needs PostgreSQL and runs locally.
