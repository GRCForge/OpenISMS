# OpenISMS v3.5.0 — information domains and IT-Grundschutz check

Feature release. Contains database migrations (run automatically on start); no breaking changes, no configuration changes.

## New: information domains and modelling (BSI Standard 200-2) (#325)

IT-Grundschutz work is now organised by information domain (Informationsverbund) instead of one flat requirement list.

- **Information domains:** name, description, scope, protection approach (basic / standard / core) and the active catalogue. Several domains per installation.
- **Target objects:** assets from the asset register, assigned to a domain with their Grundschutz type (business process, application, IT system, ICS, room, building, network/communication link). The type is suggested from the asset type and can be changed.
- **Modelling:** assign Kompendium modules or Grundschutz++ practices to a target object or to the whole domain (process layers ISMS, ORP, CON, OPS, DER). Suggestions per target type (for Grundschutz++ from `target_object_categories`) are applied only by an explicit click. System-layer modules require a target object.
- **Visibility:** target objects follow the asset register's visibility rules on every path (list, modelling, suggestions, MCP); target objects of another domain cannot be used.
- **Permissions:** new permission `bsi_grundschutz.manage_domain` (admin and assessor by default). The `bsi_grundschutz` module switch applies. Every change is audit-logged.
- **API:** `/api/bsi-grundschutz/domains` (domains, target objects, modelling, suggestions; documented in OpenAPI).
- **MCP:** `isms_list_bsi_domains`, `isms_get_bsi_domain`, `isms_suggest_bsi_modeling`, `isms_assign_bsi_target_object`, `isms_model_bsi_module`.
- **UI:** "Information domain" tab on the IT-Grundschutz page (de, en, es).

## New: IT-Grundschutz check per target object

- **Check results** per target object or for the whole domain: yes / partially / no / dispensable / open (ja / teilweise / nein / entbehrlich / offen). "No" is a status of its own (`not_implemented`, deliberately not implemented) instead of being mapped to "open".
- **Mandatory justification** for "no" and "dispensable", enforced on the server on every write path (UI, requirement list, MCP). Existing entries without a justification stay editable; the rule applies as soon as status or justification is changed.
- **Details per entry:** responsible user and/or group, implementation due date, one-off and recurring costs (EUR per year), evidence documents (existing documents, visibility inherited from their asset), linked controls (via the existing control mapping; changing it requires `controls.edit`).
- **Protection approach filters the requirements:** basic = B, standard = B+S, core = B+S+H (Grundschutz++: normal-SdT; core adds erhöht).
- **Evaluation:** fulfilment per module and target object ((yes + 0.5 × partially) / (all − dispensable)) and cost totals.
- **Excel export** in the layout of reference document A.4 "IT-Grundschutz-Check"; cells starting with = + - @ are neutralised.
- **Nothing is discarded implicitly:** target objects with check data stay in the domain; entries outside the current modelling are listed separately.
- **API:** `/api/bsi-grundschutz/domains/{id}/check` (read, set, summary, export, linkable documents).
- **MCP:** `isms_get_bsi_check`, `isms_set_bsi_check_status`.
- **UI:** "IT-Grundschutz check" tab; justification field in the requirement list (de, en, es).

## Migrations

- New tables `bsi_information_domains`, `bsi_target_objects`, `bsi_modelings`, `bsi_requirement_documents`.
- `bsi_requirements` gains `domain_id`, `target_object_id`, `justification`, `responsible_group_id`, `due_date`, `cost_once`, `cost_recurring` and the status value `not_implemented`. Existing status values are unchanged.
- On first start a "Standard-Informationsverbund" (protection approach standard) is created and all existing BSI requirements are attached to it. Only `domain_id` is set; status, owner, notes and review date are kept. The previous requirement list is the domain level of this default domain.
- Activating a catalogue moves all domains to it. New requirements are created in the default domain only.

## Fixes

| Problem | Change |
|---|---|
| The BSI MCP tools mapped "nein" to `not_started`, so a deliberate "not implemented" looked like "not yet checked". | "nein" is stored as `not_implemented`, "offen" as `not_started`. |
| The German label of the status `not_started` read "Öffnen" (open, the verb). | "Offen". |

## CI

- New checks `scripts/test-bsi-domain.js` and `scripts/test-bsi-check.js` in the Security & Quality workflow. The database tests `scripts/test-bsi-domain-db.js` and `scripts/test-bsi-catalog-db.js` need PostgreSQL and run locally.
