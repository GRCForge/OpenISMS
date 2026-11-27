# OpenISMS v3.10.0 — roles and groups, BSI risk analysis, reports, maintenance

Feature release. It combines three strands that were developed separately:

1. **Roles and groups:** roles are named sets of permissions, and users receive them only through groups. A user can hold several roles at once.
2. **Risk analysis per BSI-Standard 200-3**, the **realisation plan** (reference document A.6) and **reports as DOCX and PDF** (risk report, risk treatment plan, BSI reference documents A.1–A.6).
3. **Maintenance** that had been prepared as v3.9.1 (CodeQL log injection, catch-up build on `main`, dependency updates). There is no separate 3.9.1 release; everything since v3.9.0 is in this release.

Contains database migrations (run automatically on start).

## Breaking changes and upgrade notes

Read before upgrading.

- **New users without a group get no role.** Since 3.10.0 a user has only the roles of their groups. A user created in the UI, through the API, the import, SSO or MCP auto-provisioning without groups (and without a legacy `role`), and an SSO user that matches no claim mapping while no SSO default group is set, can only see their own account. Before, new users were `viewer` by default. Check **Administration → General → SSO default group** after the upgrade and assign groups when creating users.
- **Existing users keep their access.** The migration puts every user into the group of their former role (custom role wins, as before). This was verified decision by decision against the v3.9.0 logic (see [Migration](#migration-automatic-first-start)).
- **Custom roles: `false` no longer takes away.** Roles add up (allow-only). For a migrated user with one role nothing changes. If you later give a user several roles, a `false` in one role's set does not remove what another role allows.
- **Inconsistent role data:** a user whose `users.role` differed from the base role of their custom role (only possible through direct database edits before 3.10.0) keeps both roles, so nothing is lost. Such users are listed in the start log (`[Access] User #…`) and in the settings key `access_model.inconsistentUsers`; review their groups.
- **MCP `isms_delete_user` deactivates** the account instead of deleting it, like the web UI.
- **Exports are audit-logged:** the A.4 export of the IT-Grundschutz-Check now writes an audit entry, like the new A.6 export and every report download.
- **New permission `bsi_grundschutz.risk_analysis`** (default: `admin`, `assessor`). Custom roles with their own permission set do not list it; for them the base role decides, as for every action a set does not mention.
- Log lines from `serverError` / `requestError` and the MCP risk error path no longer contain a space where a line break was (CodeQL `js/log-injection`).

## New: roles as permission sets

- A **role** is a named set of permission objects (module × action, e.g. `incidents.edit`). The eight built-in roles are predefined roles. Their permission sets are still the columns of the permission matrix (**Administration → Roles & permissions**). Custom roles keep their own sets.
- Roles **add up (allow-only)**. If any of a user's roles allows an action, the user may perform it. A custom role that sets an action to `false` no longer takes it away from a user whose other roles allow it.
- Write protection follows the same rule. A user is read-only only if **all** of their roles are read-only (`viewer`, `management`, `employee`).

## New: groups carry roles

- Every group (**Administration → Groups**) can carry any combination of built-in and custom roles. Every member receives all roles of all their groups.
- Groups without roles remain plain teams for task assignment and @-mentions. They grant nothing.
- Roles are **never assigned directly** to a user. The user form now selects groups and shows the roles each group grants. The user list shows each user's groups and effective roles, and flags users without a role.
- **Guard rails**
  - Assigning roles to a group, deleting a group that carries roles, and changing the members of such a group require the permission `admin.roles` in addition to `groups.manage`.
  - No change may leave the installation without an active administrator; such a change gets `409`. Administrators cannot take the administrator role away from themselves.
  - Group role and membership changes are written to the audit log.
- The risk acceptance authority, the treatment plan and risk monitoring (3.8.0 / 3.9.0) consider all of a user's roles: a user may decide on an acceptance request if any of their roles is allowed for the level. Approvers are notified through group membership.
- `users.role` remains as a cache of the most privileged role, for display and filters. It is `none` for users without a role. Access decisions no longer read it.

## New: SSO grants groups

- OIDC claim mappings now map an IdP claim to an **OpenISMS group**. **Every** matching mapping applies (before: only the first), so a user in several IdP groups receives the roles of all mapped groups.
- **SSO default group** replaces the SSO default role (**Administration → General**). Users matching no mapping join it. Without a default group they have no role until an administrator adds them to a group.
- Memberships granted by SSO are marked *SSO*. **Strict sync** now removes only those memberships, when no mapping grants them any more. Memberships added by hand are never touched, and the last administrator is never removed.
- `OIDC_CLAIM_MAPPINGS` accepts `"group": "<group name>"`. `"role"` and `"custom_role"` keep working and mean the group that carries that role. If no such group exists, it is created on first use.

## Migration (automatic, first start)

The migration runs once and keeps every user's effective access unchanged:

- **Atomic:** memberships, mappings, the SSO default group and the state key `access_model` are written in one transaction. A failed start leaves the database as it was; the next start retries.
- **Idempotent:** a group that already carries a role is reused, never duplicated; a second run changes nothing.
- **One runner:** an advisory lock serialises concurrent starts (several replicas); the others see the finished state.

- It creates one group per role in use: *Administrators*, *Assessors*, *Data Protection*, *IT Staff*, *Asset Owners*, *Management*, *Employees*, *Viewers*, and *Role: \<name\>* for custom roles. If a name is already taken, a suffix is added, e.g. *Administrators (2)*.
- Every user joins the group of their former role. A custom role wins over the column role, as before.
- OIDC claim mappings stored in the database now point to the matching group. The SSO default role becomes the SSO default group.
- Existing groups are not changed and carry no roles.
- The log shows `[Access] Migrated to group-based permissions: …`. The state is kept in the settings key `access_model`.

**Verified:** `scripts/test-access-equivalence-db.js` builds v3.9.0 data (all eight roles, custom roles with and without their own set, `true`/`false` entries, entries beyond the base role, unknown modules, matrix overrides, inactive users, SSO mappings, a hand-made role group, an ordinary team) and compares, for every user, every module.action and every fallback role list a route can carry, the v3.9.0 decision with the decision after the migration, plus the role rules (`requireRole`, `isAdmin`, `canViewAllAssets`, write protection). Result on PostgreSQL 18: 30 880 decisions, no right lost, no right gained for consistent users; the active administrators and the `users.role` cache are unchanged. The embedded v3.9.0 reference was checked against the real v3.9.0 code (3 072 decisions, identical). Three concurrent starts migrate once.

**After the upgrade:** review **Administration → Groups**. If you had a team named like a role (e.g. "Administrators"), the role group carries a suffix, and you may want to rename one of them. You can now merge roles into fewer groups, e.g. one "ISMS team" group that carries both `assessor` and `dpo`.

## New: risk analysis per BSI-Standard 200-3

In **BSI IT-Grundschutz → Risk analysis (200-3)**, per information domain:

- **Selection** (ch. 3): a target object needs a risk analysis when its protection need is high or very high, when no module is modelled for it, or when an operating scenario is marked as not covered. A manual decision (include / exclude) needs a reason.
- **Protection need** from the current CIA assessment of the asset: 1–3 normal, 4 high, 5 very high (an assumption of OpenISMS, documented in `docs/FEATURES.md`); maximum of C, I and A.
- **Threat overview** (ch. 4): the 47 elementary threats plus additional threats (existing, or new with `threats.create`); relevance and coverage by the modelled modules are assessed by hand, because the catalogues carry no threat mapping.
- **Classification** (ch. 5): frequency × impact on the scales of the active risk methodology, each with a rationale. The first classification creates one risk in the register (asset × threat, owner = asset owner); later ones update it. Concurrent classifications create one risk.
- **Consolidation** (ch. 7): the measures from the treatment plans of these risks show up in the IT-Grundschutz-Check as additional requirements and can be taken over into the realisation plan.
- Every change writes a signed audit entry, through REST and MCP alike. A target object with analysis data stays in its domain.

## New: realisation plan (reference document A.6)

**BSI IT-Grundschutz → Realisation plan**: requirements with status "no" or "partially" from the check plus the measures taken over, with responsible, due date, costs and priority. The priority is set or suggested (basic high, standard medium, elevated protection need low; measures by risk level); the check entry has a new field for it. Excel export in the A.6 layout.

## New: reports as DOCX and PDF

- **Risk register → Risk report** and **Risk treatment plan → Treatment plan**, each as DOCX or PDF.
- **Realisation plan → Reference documents**: A.1 structure analysis, A.2 protection need, A.3 modelling, A.4 check, A.5 risk analysis, A.6 realisation plan, or all in one document.
- The reports contain only what the requesting user may see and say "no data" where data is missing. Every download is written to the audit log. Rendered on the server with `docx` 9.16.1 and `pdfmake` 0.3.15 (both MIT).

## Behaviour changes

| Area | Before | Since 3.10.0 |
|---|---|---|
| New users (UI, API, import, SSO, MCP auto-provisioning) | Role `viewer` unless set | No role unless groups (or a legacy `role`) are given, or the SSO default group applies |
| `POST/PUT /api/users` | `role`, `custom_role_id` | `group_ids` (replaces the user's groups). `role` / `custom_role_id` still work and add the user to the group carrying that role |
| User import | Role column set `users.role` | Role column adds the user to the role's group |
| Several roles | Not possible | Union of all roles from all groups |
| SSO claim mappings | First match sets the role | Every match adds its group |
| MCP `isms_delete_user` | Deleted the account | **Deactivates** the account, like the web UI |
| User without any role | — | Only own account; on MCP only `isms_get_my_overview`, `isms_list_notifications` and own API tokens |

## API

- `GET /api/auth/me` and `GET /api/me/permissions` return `roles` (all effective base roles) and `group_ids`. `role` is the most privileged role (or `none`).
- `GET /api/users` (admin) returns each user's `groups` (with `source`: `manual` / `sso`) and `access_roles`.
- `GET/POST/PUT /api/groups` read and write `roles`: `[{ "system_role": "assessor" }, { "custom_role_id": 3 }]`. Members carry `source`.
- `GET /api/admin/custom-roles` returns the `groups` that carry each role. `users_count` counts users through those groups.
- `POST /api/admin/oidc-mappings` takes `group_id` (`role` / `custom_role_id` are still accepted and resolved to a group).
- `PUT /api/admin/settings` and MCP `isms_update_settings` take `ssoDefaultGroupId` (`null` = none). `ssoDefaultRole` is still accepted and sets the default group to the group carrying that role.

## API: risk analysis and reports

- `GET /api/bsi-grundschutz/domains/:id/risk-analysis[/:targetId]`, `PUT /…/risk-analysis/:targetId`, `POST /…/risk-analysis/:targetId/threats`, `PUT /…/threats/:threatId`, `POST /…/threats/:threatId/classify`
- `GET /api/bsi-grundschutz/domains/:id/realization-plan[/export]`, `POST/PUT/DELETE /…/realization-plan/measures[/:measureId]`
- `GET /api/bsi-grundschutz/domains/:id/reports/:doc?format=docx|pdf` (`a1`…`a6`, `all`) and `GET /api/risks/reports/risk-report|treatment-plan?format=docx|pdf` (rate limit `heavyLimiter`)
- `PUT /api/bsi-grundschutz/domains/:id/check` takes `realization_priority`.

## MCP

- `isms_create_user` / `isms_update_user` take `group_ids`. `role` / `custom_role_id` still work, as above.
- `isms_create_group` / `isms_update_group` take `roles`. `isms_list_groups` / `isms_get_group` return the roles a group carries.
- `isms_list_users` filters by role through group membership. `isms_list_custom_roles` reports the carrying groups.
- `isms_delete_user` deactivates instead of deleting.
- The tool gate evaluates every role of the caller (allow-only), like the REST API.
- New tools (251 in total): `isms_get_bsi_risk_analysis`, `isms_set_bsi_risk_analysis_target`, `isms_assess_bsi_threat`, `isms_classify_bsi_threat`, `isms_get_bsi_realization_plan`, `isms_list_reports` (metadata and download paths only, filtered by the caller's permissions). They are bound to the authenticated account like every tool and decide through the caller's groups. `isms_set_bsi_check_status` takes `realization_priority`.

## Migrations

- New table `group_roles` (group, built-in role or custom role).
- `group_members` gains `source` (`manual` / `sso`).
- `oidc_claim_mappings` gains `group_id`.
- `users.role` gains the value `none`, which is also the new default.
- New tables `bsi_risk_analysis_targets`, `bsi_risk_analysis_threats`, `bsi_realization_measures`.
- `bsi_requirements` gains `realization_priority` (`high` / `medium` / `low`, `NULL` = suggested).

## Outlook: phase 2

Some rules still ask for a role rather than a permission: object visibility (e.g. contracts hidden from IT staff and viewers, owners seeing their own assets), the write protection of read-only roles, and the role lists that decide where the matrix says nothing. They now see the set of all of a user's roles. The next step turns them into permission objects as well, so that every decision is made by the permission sets alone.

## CI

- New check `scripts/test-group-access.js` in the Security & Quality workflow covers role helpers, allow-only decisions, the last-administrator guard and SSO group sync.
- The database test `scripts/test-group-access-db.js` covers the migration and the guards on PostgreSQL and runs locally.
- New database test `scripts/test-access-equivalence-db.js` (see Migration) and `scripts/test-bsi-risk-analysis-db.js` (selection, threat overview, classification, consolidation, realisation plan, reports parsed back from DOCX and PDF); new check `scripts/test-bsi-risk-analysis.js`.
- The module-load smoke test also loads the MCP server, the report services, `docx` and `pdfmake`.
- New job `Docker — multi-arch build (no push)` in Security & Quality: a manual run on a release branch builds the image for `linux/amd64` and `linux/arm64` like `release.yml`, without pushing.
- **Catch-up runs on `main` build again:** `main-catchup.yml` starts Security & Quality by `workflow_dispatch` after Dependabot auto-merges. The gate in `security.yml` treated a dispatch like a pull request from a feature branch and skipped `Backend — Install & Smoke Test` and `Frontend — TypeScript & Build`. A dispatch now runs the same sections as a push (#353).
- `SonarSource/sonarqube-scan-action` 8.5.0 → 8.5.1 (#351).

## Security and code scanning

- **Log injection (CodeQL `js/log-injection`):** the log sanitising in `utils/httpError.js` (`serverError`, `requestError`) and in the MCP risk error path removed line breaks with `replace(/[\r\n]+/g, ' ')`. CodeQL does not accept that form as a sanitiser. Line breaks are now removed with `replace(/\n|\r/g, '')`; the three alerts are closed (#353).

## Dependencies

New: `docx` 9.16.1 and `pdfmake` 0.3.15 (backend, MIT).

Updated since v3.9.0:

| Package | From | To |
|---|---|---|
| `@anthropic-ai/sdk` | 1.12.0 | 1.14.0 |
| `openai` | 7.62.0 | 7.65.0 |
| `swagger-ui-dist` | 5.35.1 | 5.36.0 |
| `i18next` | 27.2.3 | 27.2.9 |
| `i18next-http-backend` | 4.1.0 | 4.1.2 |
| `lucide-react` | 1.77.0 | 1.82.0 |
| `react-router` | 8.5.2 | 8.5.3 |
| `recharts` | 3.11.0 | 3.11.1 |
| `@types/react` | 19.3.0 | 19.3.3 |
| `vite` | 8.3.8 | 8.4.0 |

`npm audit` reports no known vulnerabilities in backend and frontend (#349, #350, #352, #353).

## Upgrade

Replace the image or run the updater as usual. The migrations run on the first start. Afterwards review **Administration → Groups**, the **SSO default group** and the start log for `[Access] User #…` lines.
