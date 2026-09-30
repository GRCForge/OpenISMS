# OpenISMS v3.3.1 — dependencies, and Dependabot pull requests that get checked

A maintenance release. It clears every open Dependabot alert, folds in the
four open Dependabot pull requests, and fixes the reason those pull requests
were never tested before being merged.

---

## 1. Every Dependabot alert closed

Six alerts were open against `backend/package-lock.json`. All six are gone;
`npm audit` reports **0 vulnerabilities** for both workspaces.

| Alert | Package | Resolution |
|---|---|---|
| #32, #33, #35, #36 | `ip-address` | 10.5.0 → **10.7.2** (Dependabot [#208]) |
| #34 | `moment` | 2.30.1 → **2.31.0** via `overrides` |
| #37 | `fast-uri` | 3.1.7 → **3.1.8** via `overrides` |

`moment` and `fast-uri` both arrive as transitive dependencies, so neither
could be bumped by editing a direct dependency:

- **`moment`** comes from `sequelize` and `moment-timezone`, which declare
  `^2.29.4`. 2.31.0 satisfies that range, so the override changes nothing
  about what those packages were willing to accept.
- **`fast-uri`** comes from `ajv`, via `@modelcontextprotocol/sdk`. The
  advisory covers 3.0.0–3.1.7 and the newest `ajv` (8.20.0) still declares
  `fast-uri: ^3.0.1`, so the 4.x line was not an option — forcing it would
  hand `ajv` a major version it never claimed to support. **3.1.8 is the fix
  inside the declared range.** The existing override already read `^3.1.7`,
  which is why the lockfile sat on the vulnerable top of the range.

## 2. Dependency bumps

Merged from the four open Dependabot pull requests rather than re-resolved
locally, so the lockfiles are the ones Dependabot generated:

| | |
|---|---|
| backend [#205] | `@modelcontextprotocol/sdk` 1.30.1 · `@simplewebauthn/server` 14.0.3 · `dotenv` 18.0.4 · `openai` 7.23.0 |
| frontend [#206] | `lucide-react` 1.48.0 · `vite` 8.3.1 |
| actions [#207] | `crowdin/github-action` v3.3.0 · `github/codeql-action` v4.38.2 |
| backend [#208] | `ip-address` 10.7.2 |

## 3. Dependabot pull requests are now checked before they merge

This is the substantive change.

The CI gate skipped **every** job for a `dependabot/*` branch. Branch
protection let those pull requests through, and the first thing that ever
looked at them was the push-to-main run — which is the same run that builds
and publishes the release image. A bump that broke the build was therefore
discovered on `main`, after the fact.

A Dependabot pull request now runs exactly three jobs:

- **Backend — Install & Smoke Test**
- **Frontend — TypeScript & Build**
- **npm audit — Dependency Vulnerabilities**

A dependency bump can realistically fail in two ways: it stops the app
building or starting, or it drags in a new advisory. Those three catch both,
need no secrets, and finish in a couple of minutes.

The rest stays off deliberately. Snyk and SonarQube **cannot** run there —
GitHub withholds Actions secrets from Dependabot pull requests — and CodeQL,
Gitleaks and Trivy have nothing to say about a lockfile bump. The
push-to-main run still covers all of them.

## 4. Auto-merge for minor and patch bumps

`.github/workflows/dependabot-auto-merge.yml` turns on GitHub's native
auto-merge for a Dependabot pull request, for **minor and patch bumps only**.
Major bumps are left for a human: they are the ones that break an API.

**Auto-merge does not mean "merge now".** GitHub holds the pull request until
every *required* status check has passed, and that requirement lives in the
branch protection ruleset, not in the workflow file. Two settings have to be
made by hand before this does anything useful — and until they are, the
workflow is inert rather than dangerous, because auto-merge cannot be enabled
on a repository that does not allow it:

```
Settings → General → Pull Requests → Allow auto-merge        [on]

Settings → Rules → ruleset for main → Require status checks:
    Backend — Install & Smoke Test
    Frontend — TypeScript & Build
    npm audit — Dependency Vulnerabilities
```

Do **not** add Snyk or SonarQube to the required set. They cannot run on a
Dependabot pull request, and a required check that never reports blocks the
merge forever.

The workflow also declines to enable auto-merge on a pull request with
conflicts. Dependabot rebases its own branches, so that normally resolves
itself; forcing it would only produce a merge nobody looked at.

It runs on `pull_request_target`, which means the version on `main` executes,
not the version in the branch — that is what makes the write permissions safe.
Nothing in the job checks out or runs code from the branch.

## 5. `sync-version.js` no longer rewrites the lockfiles

Bumping the version ran `npm install --package-lock-only` in both workspaces
purely to carry the number across. That re-resolves the whole dependency tree
with whatever npm happens to be installed, and when that differs from CI's it
rewrites the lockfile: bumping to 3.3.1 silently dropped the `libc` fields
from six platform-specific packages in `frontend/package-lock.json`, because
npm 10 does not know them and npm 11 writes them.

A version bump must not touch dependencies. The script now sets the two
fields that actually carry the version — the root and `packages[""]` — and
writes the file back. A JSON round-trip at two-space indent with a trailing
newline reproduces npm's own output byte for byte; that was verified against
both lockfiles before the change went in.

## 6. Upgrading

Nothing to do. No schema changes, no configuration changes, no API changes.
