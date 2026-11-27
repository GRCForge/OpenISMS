# OpenISMS v3.9.1 — maintenance release

Patch release. No database migrations, no configuration changes, no behaviour changes for users or API clients.

## Security and code scanning

- **Log injection (CodeQL `js/log-injection`):** the log sanitising in `utils/httpError.js` (`serverError`, `requestError`) and in the MCP risk error path removed line breaks with `replace(/[\r\n]+/g, ' ')`. CodeQL does not accept that form as a sanitiser, so three medium alerts stayed open. Line breaks are now removed with `replace(/\n|\r/g, '')`; the alerts are closed (#353). Log lines from these paths no longer contain a space where a line break was; stack frames stay readable because each frame starts with spaces.

## CI

- **Catch-up runs on `main` build again:** `main-catchup.yml` starts Security & Quality by `workflow_dispatch` after Dependabot auto-merges. The gate in `security.yml` treated a dispatch like a pull request from a feature branch and skipped `Backend — Install & Smoke Test` and `Frontend — TypeScript & Build`. A dispatch now runs the same sections as a push (#353).
- `SonarSource/sonarqube-scan-action` 8.5.0 → 8.5.1 (#351).

## Dependencies

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

Lockfiles refreshed within the existing ranges (minor/patch only). `npm audit` reports no known vulnerabilities in backend and frontend (#349, #350, #352, #353).

## Upgrade

Replace the image or run the updater as usual; nothing else to do.
