# OpenISMS v3.3.10 — MCP fix, web-push 4

Maintenance release. No migrations, no breaking changes.

## Fixes

| Problem | Change |
|---|---|
| The MCP tool `isms_get_my_overview` failed on PostgreSQL with `invalid input value for enum enum_policies_status: "published"`. `Policy.status` only knows `draft`, `active` and `retired`. | Pending policy acknowledgments are computed against `active` policies (#297). |

## Dependencies

- `web-push` 3.6.7 → 4.0.0 (backend, #292). The package is ESM-only now; the backend keeps loading it with `require()`, which Node ≥ 22.12 supports for ES modules without top-level `await` (OpenISMS requires Node ≥ 26.12.1). `generateVAPIDKeys`, `setVapidDetails` and `sendNotification` are unchanged.
