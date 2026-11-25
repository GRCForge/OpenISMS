# OpenISMS v3.7.0 — deeper risk assessment

Feature release. Contains database migrations (run automatically on start); no configuration changes. The rationale for likelihood and impact is now mandatory whenever a risk is created, reassessed or its values change — API and MCP clients that create or re-rate risks must send `likelihood_rationale` / `impact_rationale`.

## New: impact dimensions (ISO 27005:2022 7.2 / 8.3.3, BSI 200-3)

- The risk methodology decides which dimensions of impact are rated separately: confidentiality, integrity, availability, financial, legal/regulatory, reputation, operational. Labels and a criterion per dimension can be set. Changing the selection creates a new methodology version.
- The overall impact of a risk is the maximum of its rated dimensions (maximum principle); dimensions may stay empty. Dimensions apply to the gross risk; net and target risk are single values.
- The default methodology has no dimensions; nothing changes until an administrator enables them. Existing risks keep their single impact value; nothing is converted.

## New: mandatory rationale

- Whoever sets or changes likelihood or impact (including a dimension) states why, in the same request, on every write path (UI, API, MCP), also on reassessment. The form pre-fills the previous text.
- Existing risks without a rationale stay editable as long as their values do not change.

## New: vulnerabilities and risk scenarios

- **Vulnerability register:** manual entries (title, description, severity, CVSS, related assets) or CVEs taken over from the CVE data of an asset — by selection, never automatically. One entry per CVE; a further asset is linked. A vulnerability used in a scenario cannot be deleted.
- **Risk scenarios:** asset(s) × threat × vulnerability, several per risk, shown in the risk detail (record rights as for the risk detail).
- **Permissions:** new module `vulnerabilities` (`view` for admin, assessor, IT staff, DPO, owner, management; `manage` admin/assessor/IT staff; `delete` admin/assessor).
- **API:** `/api/vulnerabilities` (list, detail, create, update, delete, `asset-cves/{assetId}`, `from-asset-cves`).
- **UI:** new page "Vulnerabilities" with a dialog to take over CVEs (de, en, es).

## New: gross, net and target risk

- **Net risk** is still calculated from the implemented controls. It can be overridden with a mandatory rationale (`PATCH /api/risks/{id}/residual-override`, new permission `risks.override_residual`, admin and assessor by default). Overridden risks are flagged; who, when, why and the calculated value are shown and audit-logged. A reassessment removes the override and the target risk (logged).
- **Target risk** after the planned treatment is set manually.
- The register shows all three levels; the heatmap switches between gross, net and target.

## New: risk categories as a maintained list

- Key, labels (de/en/es), order and active flag; the key never changes. Deactivated categories are not offered for new risks; an entry can only be deleted while no risk and no methodology version refers to it.
- Risk appetite rows must reference an entry. Imports accept the key or a label; unknown values fail the row.
- The German label of `privacy` is now "Datenschutz"; Spanish has its own category labels.
- **API:** `/api/risks/categories`.

## MCP

- New tools: `isms_override_risk_residual`, `isms_list_risk_categories`, `isms_create_risk_category`, `isms_update_risk_category`, `isms_list_vulnerabilities`, `isms_create_vulnerability`, `isms_update_vulnerability`, `isms_delete_vulnerability`, `isms_import_asset_cves_as_vulnerabilities` (225 tools).
- `isms_create_risk` / `isms_update_risk` accept impact dimensions, rationale, target risk and scenarios; `isms_get_risk` returns scenarios and the net-risk override.

## Migrations

- `risks` gains `impact_dimensions`, `likelihood_rationale`, `impact_rationale`, `residual_override`, `residual_override_reason`, `residual_override_by_id`, `residual_override_at`, `target_likelihood`, `target_impact`, `target_level`. Existing values are unchanged.
- `risk_methodologies` gains `impact_dimensions` (NULL on existing versions = no dimensions; versions stay immutable).
- New tables `risk_categories`, `vulnerabilities`, `vulnerability_assets`, `risk_scenarios`, `risk_scenario_assets`; unique index on `vulnerabilities.cve_id`.
- On first start the nine former category values and "Bedrohungslage" become category entries; every other value found in existing risks or risk appetites becomes an entry as well. Risks are not changed.

## CI

- New check `scripts/test-risk-assessment.js` in the Security & Quality workflow. The database test `scripts/test-risk-assessment-db.js` needs PostgreSQL and runs locally.
