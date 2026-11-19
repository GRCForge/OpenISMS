# OpenISMS v3.3.12 — dependency updates

Maintenance release. No migrations, no breaking changes, no configuration changes.

Bundles the dependency updates merged since v3.3.11. Until now they only refreshed the v3.3.11 image in place; this release gives them their own version.

## Backend

- `rotating-file-stream` 3.2.10 → 4.0.0 (#316). v4 requires Node.js 22; OpenISMS runs on Node.js 26. The options used by the log writer (`path`, `size`, `maxFiles`) are unchanged.
- `hono` 4.13.13 → 4.13.18 (#308), `@hono/node-server` 2.1.5 → 2.1.8 (#307)
- `nodemailer` 10.3.1 → 10.6.0 (#300, #319), `openai` 7.56.0 → 7.57.0 (#318)
- minor/patch groups #303, #310, #315

## Frontend

- `i18next` 26.7.2 → 27.1.2 (#311, #320), `react-i18next` 17.1.13 → 18.0.1
- `lucide-react` 1.70.0 → 1.71.0 (#309)
- minor/patch groups #304, #313, #317

## CI and docs

- `SonarSource/sonarqube-scan-action` 8.4.1 → 8.5.0 (#314)
- README restructured; new features, security, MCP and configuration guides (#312)
