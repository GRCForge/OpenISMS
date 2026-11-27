# OpenISMS v3.10.0 — roles and groups

Feature release. Contains database migrations (run automatically on start). Every user keeps exactly the access they had. What changes is how access is granted: **roles are named sets of permissions, and users receive them only through groups**. A user can now hold several roles at once.

**Read before upgrading:** new users no longer get a role by default (see [Behaviour changes](#behaviour-changes)). Scripts that set `role` on users through the API still work, but the role now comes from group membership.

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

The migration runs once, in a transaction, and keeps every user's effective access unchanged:

- It creates one group per role in use: *Administrators*, *Assessors*, *Data Protection*, *IT Staff*, *Asset Owners*, *Management*, *Employees*, *Viewers*, and *Role: \<name\>* for custom roles. If a name is already taken, a suffix is added, e.g. *Administrators (2)*.
- Every user joins the group of their former role. A custom role wins over the column role, as before.
- OIDC claim mappings stored in the database now point to the matching group. The SSO default role becomes the SSO default group.
- Existing groups are not changed and carry no roles.
- The log shows `[Access] Migrated to group-based permissions: …`. The state is kept in the settings key `access_model`.

**After the upgrade:** review **Administration → Groups**. If you had a team named like a role (e.g. "Administrators"), the role group carries a suffix, and you may want to rename one of them. You can now merge roles into fewer groups, e.g. one "ISMS team" group that carries both `assessor` and `dpo`.

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

## MCP

- `isms_create_user` / `isms_update_user` take `group_ids`. `role` / `custom_role_id` still work, as above.
- `isms_create_group` / `isms_update_group` take `roles`. `isms_list_groups` / `isms_get_group` return the roles a group carries.
- `isms_list_users` filters by role through group membership. `isms_list_custom_roles` reports the carrying groups.
- `isms_delete_user` deactivates instead of deleting.
- The tool gate evaluates every role of the caller (allow-only), like the REST API.

## Migrations

- New table `group_roles` (group, built-in role or custom role).
- `group_members` gains `source` (`manual` / `sso`).
- `oidc_claim_mappings` gains `group_id`.
- `users.role` gains the value `none`, which is also the new default.

## Outlook: phase 2

Some rules still ask for a role rather than a permission: object visibility (e.g. contracts hidden from IT staff and viewers, owners seeing their own assets), the write protection of read-only roles, and the role lists that decide where the matrix says nothing. They now see the set of all of a user's roles. The next step turns them into permission objects as well, so that every decision is made by the permission sets alone.

## CI

- New check `scripts/test-group-access.js` in the Security & Quality workflow covers role helpers, allow-only decisions, the last-administrator guard and SSO group sync.
- The database test `scripts/test-group-access-db.js` covers the migration and the guards on PostgreSQL and runs locally.
