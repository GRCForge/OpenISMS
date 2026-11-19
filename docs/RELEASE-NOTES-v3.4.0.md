# OpenISMS v3.4.0 — versioned IT-Grundschutz catalogues

Feature release. Contains database migrations (run automatically on start); no breaking changes, no configuration changes.

## New: versioned BSI IT-Grundschutz catalogues (#324)

IT-Grundschutz requirements are no longer limited to the built-in excerpt. Administrators and assessors import a full catalogue, review it and activate it deliberately.

- **Formats:** IT-Grundschutz-Kompendium Edition 2023 (DocBook 5 XML as published by the BSI) and Grundschutz++ (OSCAL 1.1.3 catalog from the BSI Stand-der-Technik-Bibliothek). OSCAL profiles and mapping collections are not supported yet.
- **Sources:** file upload (.xml, .json, in memory only) or a public URL. URL fetches use the existing SSRF protection and do not follow redirects.
- **Preview first:** an imported catalogue is a preview with a comparison against the active one (new / changed / withdrawn). Only "Activate" applies it.
- **Activation keeps your work:** status, owner, notes and review date of existing requirements are kept. Requirements that are missing from the new catalogue or marked ENTFALLEN are flagged as retired, never deleted. Previews can be discarded.
- **Levels:** Basis, Standard and erhöht (Kompendium) as well as normal-SdT and erhöht (Grundschutz++).
- **Permissions:** new permission `bsi_grundschutz.manage_catalog` (admin and assessor by default), enforced on the server. The `bsi_grundschutz` module switch still applies. Every import, activation and discard is audit-logged.
- **API:** `/api/bsi-grundschutz/catalogs` — list, detail, requirements, comparison, import from file or URL, activate, discard (8 endpoints, documented in OpenAPI).
- **UI:** "Catalogues" dialog on the IT-Grundschutz page (de, en, es).
- **Hardening:** XML containing a DOCTYPE is rejected (no XXE, no entities); 25 MB size limit plus limits on element count and nesting depth. New dependency `saxes` 6.0.0.
- No catalogue text ships in the repository; catalogues are imported at runtime.

### Migrations

- New tables `bsi_catalogs`, `bsi_catalog_modules`, `bsi_catalog_requirements`.
- `bsi_requirements` gains `catalog_id`, `retired` and the levels `normal_sdt` / `erhoeht`.
- On first start the built-in excerpt becomes the catalogue "IT-Grundschutz-Kompendium 2023 (Auszug)". On installations that already hold BSI requirements it is activated at once and existing rows are attached to it; their status is kept.

## Fixes

| Problem | Change |
|---|---|
| The MCP tool `isms_list_bsi_requirements` described the layer filter with "ORG", while the catalogue uses "ORP"; filtering on ORG returned nothing. | The filter accepts ISMS, ORP, CON, OPS, DER, APP, SYS, IND, NET, INF; "ORG" is accepted as an alias for ORP (#323). |
| The BSI MCP tools expected the status values `ja/teilweise/nein/entbehrlich`, the database column only knows `not_started/in_progress/implemented/not_applicable`. The status filter never matched. | The tools use the column values and translate the old ones (#323). |
| The IT-Grundschutz page did not offer the layer IND. | Added (#323). |

## CI

- New checks `scripts/test-bsi-layers.js` and `scripts/test-bsi-catalog-import.js` in the Security & Quality workflow.
