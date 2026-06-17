# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 2.2.x (latest) | ✅ |
| < 2.2 | ❌ |

Only the latest minor release receives security patches.

## Reporting a Vulnerability

**Please do not report security vulnerabilities via GitHub Issues.**

Report vulnerabilities via one of the following channels:

- **GitHub Private Vulnerability Reporting**: [Security → Report a vulnerability](../../security/advisories/new)
- **E-Mail**: info@herz.dev

### What to include

- Affected version(s)
- Description of the vulnerability and potential impact
- Steps to reproduce or proof-of-concept (if available)
- Suggested fix (optional)

### Response timeline

| Milestone | Target |
|---|---|
| Initial acknowledgement | within 48 hours |
| Severity assessment | within 5 business days |
| Patch release (critical/high) | within 14 days |
| Public disclosure | after patch is available |

## Security Measures

This repository uses an automated security pipeline on every pull request:

| Tool | Purpose |
|---|---|
| **CodeQL** | Static application security testing (SAST) |
| **Snyk** | Dependency vulnerability scanning |
| **Trivy** | Lockfile CVEs, Dockerfile misconfigurations, hardcoded secrets |
| **Gitleaks** | Secret scanning across full git history |
| **npm audit** | Known vulnerabilities in direct dependencies |
| **SonarQube** | Code quality & additional SAST rules |

## Authentication Hardening

- Login failures return generic error messages so attackers cannot infer whether an email address is registered.
- Password reset requests are anonymous and always return the same confirmation text.
- Reset tokens are stored only as SHA-256 hashes and expire after one hour.
- Failed authentication and lockout events are audited internally, while client responses avoid leaking sensitive details.

## Verifikation von Abhängigkeiten

Bei einem Upgrade der Node.js-Laufzeit (z. B. auf Node.js 26.3.0) ist eine sorgfältige Verifikation der Abhängigkeiten erforderlich, um Regressions- oder Kompatibilitätsprobleme zu vermeiden. Empfohlene Schritte zum lokalen Testen:

```bash
# Backend
cd backend
npm ci
npm audit --audit-level=high

# Frontend
cd ../frontend
npm ci
npm audit --audit-level=high

# Weitere Prüfungen
npm outdated
npx npm-check-updates -u   # nur zum Vorschlagen von Upgrades; immer testen
```

Zusätzlich zu `npm audit` empfehlen wir die Nutzung von Snyk, Trivy und CodeQL (bereits in den CI-Workflows eingebunden). Wenn kritische Fixes verfügbar sind, testen Sie diese in einer isolierten Branch/Umgebung und erstellen Sie einen PR mit dem Upgrade + Testbericht.

Hinweis: Um Builds und Tests reproduzierbar zu machen, verwenden Sie dieselbe Node-Version lokal wie in CI (Node.js `26.3.0`). Siehe [README.md](README.md) für lokale Entwicklungsanforderungen.

## Scope

This project is an Information Security Management System (ISMS) tool aligned with ISO 27001. The following are considered in scope for vulnerability reports:

- Authentication and session management
- Authorization and access control
- Data encryption and key management
- API endpoints and input validation
- Dependency vulnerabilities with a known exploit
