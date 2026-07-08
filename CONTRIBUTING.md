# Contributing to OpenISMS

Thank you for your interest in contributing to OpenISMS! This document outlines
how to set up your development environment, report issues, and submit changes.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Commit Messages](#commit-messages)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Style](#code-style)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to uphold this code. Please report unacceptable
behavior to **maximilian@herz.dev**.

---

## Ways to Contribute

| Type | How |
|---|---|
| **Bug report** | Open a GitHub Issue with steps to reproduce, expected vs. actual behavior, and your environment (OS, Node.js version, browser). |
| **Feature request** | Open a GitHub Issue describing the use case and why the feature belongs in an ISMS tool. |
| **Code change** | Fork the repository, create a branch (see below), make your changes, and open a Pull Request. |
| **Documentation** | Improvements to README, inline comments, or OpenAPI descriptions are always welcome. |
| **Security vulnerability** | **Do not** open a public issue. Email **maximilian@herz.dev** directly. |

---

## Development Setup

### Prerequisites

- **Node.js** ≥ 26.3.0 (enforced by the `engines` field and the Docker base image)
- **MySQL** 8.x (or a compatible fork such as MariaDB 10.6+)
- **Git**

### 1. Clone and install

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms

# Backend
cd backend && npm ci && cd ..

# Frontend
cd frontend && npm ci && cd ..
```

### 2. Configure the backend

Create `backend/.env` based on the example below:

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=openisms
DB_USER=openisms
DB_PASSWORD=changeme
JWT_SECRET=changeme-very-long-random-string
SESSION_SECRET=changeme-another-long-random-string
ENCRYPTION_KEY=changeme-separate-aes-key-for-secrets-at-rest
PORT=3001
```

### 3. Start the development servers

```bash
# Terminal 1 — backend (auto-restarts on change with nodemon if installed)
cd backend && node src/index.js

# Terminal 2 — frontend (Vite dev server with HMR)
cd frontend && npm run dev
```

The app is available at **http://localhost:5173** (proxied to the backend on port 3001).

### 4. Run the build

```bash
cd frontend && npm run build
```

TypeScript errors will fail the build — ensure `tsc` passes before opening a PR.

---

## Branch Strategy

All changes are developed on versioned branches, **never directly on `main`**.

| Change type | Branch name | Example |
|---|---|---|
| New feature | `release/vX.(Y+1).0` | `release/v2.3.0` |
| Bug fix / minor improvement | `release/vX.Y.(Z+1)` | `release/v2.2.2` |
| Security fix | `security/vX.Y.(Z+1)` | `security/v2.2.2` |
| Breaking change | `release/v(X+1).0.0` | `release/v3.0.0` |

Check the current version in `VERSION`, `backend/package.json`, and
`frontend/package.json` before creating a new branch. Do not bump version
numbers yourself — that happens on merge to `main`.

---

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]
```

Common types: `feat`, `fix`, `perf`, `refactor`, `docs`, `ci`, `chore`.

Examples:

```
feat(risks): add residual-risk calculation to assessment view
fix(auth): prevent session fixation on OIDC callback
perf(db): add index on assessments(is_current, assessed_at)
docs: update README with Docker Compose example
```

Keep the subject line under **72 characters**. The body explains *why*, not *what*.

---

## Submitting a Pull Request

1. Fork the repository and create your branch from the correct `release/` base
   (see [Branch Strategy](#branch-strategy)).
2. Make sure `cd frontend && npm run build` passes without errors.
3. Describe your changes clearly in the PR description:
   - What problem does it solve?
   - How was it tested?
   - Are there any breaking changes or migration steps?
4. Link any related issues with `Fixes #<number>` or `Closes #<number>`.
5. A maintainer will review your PR. Please be patient — this is a small team.

> **Note:** The project maintainer merges PRs centrally and handles version
> bumps. Do not modify `VERSION` or bump `package.json` versions in your PR
> unless explicitly asked.

---

## Code Style

### Backend (Node.js / Express)

- `'use strict';` at the top of every file.
- No transpilation — plain CommonJS, running on the Node.js ≥ 26.3 required by `package.json`.
- Error handling: always return `res.status(5xx).json({ error: e.message })`
  rather than leaking stack traces.
- Database access: use Sequelize models and parameterised queries — no raw SQL
  with string interpolation.

### Frontend (React / TypeScript)

- Strict TypeScript — avoid `any` unless genuinely necessary.
- Tailwind CSS utility classes only; no inline styles.
- Components live in `src/components/`, pages in `src/pages/`.
- Keep comments to a minimum: only document non-obvious *why*, not *what*.
- Do not add bundle dependencies without considering the size impact
  (check Vite's build output).

### Security

- Never commit secrets, credentials, or `.env` files.
- Validate all user input at API boundaries.
- Follow OWASP Top 10 guidelines — SQL injection, XSS, and CSRF are
  zero-tolerance.
