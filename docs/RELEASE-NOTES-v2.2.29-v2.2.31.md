# v2.2.29 → v2.2.31 — Security hardening, four production bugfixes, and WCAG 2.2 AA across the UI kit

Three releases landed back to back. This document covers all of them as one body of
work, because the pieces interlock: the accessibility review that started it uncovered
the rate-limiter defect, and the rate-limiter defect is what made the software approval
queue unusable.

**Scope:** 81 files, +1,380 / −861 lines. Backend 9 files (+356/−14), frontend 57 files
(+751/−737), plus CI, tooling and dependency updates.

| Release | PR | Contents |
|---|---|---|
| v2.2.29 | [#154](https://github.com/GRCForge/OpenISMS/pull/154) | OIDC audience binding, CORS tightening, `Permissions-Policy`, UI-kit accessibility, dependency updates |
| v2.2.30 | [#156](https://github.com/GRCForge/OpenISMS/pull/156) | Four reported production bugs, including the rate-limiter root cause |
| v2.2.31 | [#155](https://github.com/GRCForge/OpenISMS/pull/155) | Contrast sweep, `IconButton` primitive, form-control boundaries |

Superseded and closed: [#151](https://github.com/GRCForge/OpenISMS/pull/151),
[#152](https://github.com/GRCForge/OpenISMS/pull/152),
[#153](https://github.com/GRCForge/OpenISMS/pull/153) (Dependabot, all bumps contained in
#154 at equal or higher versions), and [#74](https://github.com/GRCForge/OpenISMS/pull/74)
(stale Crowdin branch whose only remaining diff was a regression).

---

## 1. Configuration surface

### No new environment variables were introduced

Nothing new has to be set for these releases. One existing variable is now **read in a
new place**, and two existing ones now **mean what they always claimed to mean**.

| Variable | Status | What changed |
|---|---|---|
| `NODE_ENV` | Existing — newly consumed in `backend/src/index.js` | Previously only `services/logger.js` read it. It now also gates the CORS development allowance. Already set to `production` by the `Dockerfile` and by `install.sh`, so no action is required for standard deployments. |
| `APP_URL` | Existing — behaviour unchanged, semantics clarified | It was always the CORS allow-list. It is now the *only* allow-list in production. Documented in `.env.example`. |
| `RATE_LIMIT_API_MAX` | Existing — now accurate | Default 5000/15 min. Was effectively **2500** because of double counting. |
| `RATE_LIMIT_HEAVY_MAX` | Existing — now accurate | Default 300/15 min. Was effectively **150**. |

> **Upgrade note.** If you run OpenISMS without `NODE_ENV=production` — for example a bare
> `npm start` behind your own reverse proxy — the CORS development allowance for
> `http://localhost:*` stays active. Set `NODE_ENV=production`, or list the origins you
> actually need in `APP_URL`.

> **Capacity note.** Because both rate-limit budgets were silently halved, real traffic
> now consumes them at half the previous rate. If either limit was raised to work around
> the old behaviour, it can be returned to its default.

### New module-level constants worth knowing about

These are code-level, not operator-facing, but they are the knobs a reviewer will look for.

| Constant | File | Purpose |
|---|---|---|
| `PERMISSIONS_POLICY` | `backend/src/middleware/securityHeaders.js` | The exported header value. Exported so it can be asserted against, and so the carve-outs are reviewable in one place. |
| `AUDIENCE_CLAIMS` | `backend/src/utils/oidcAudience.js` | `['azp', 'appid', 'client_id', 'aud']` — the claims consulted when binding a bearer token to our client. |
| `MAX_AVATAR_BYTES` | `backend/src/routes/authOidc.js` | 512 KB cap on a server-fetched profile picture. |
| `API_COUNTED`, `HEAVY_COUNTED` | `backend/src/middleware/rateLimiter.js` | `Symbol`s marking a request as already counted, so a limiter mounted twice counts once. Symbols specifically so they cannot collide with anything else hung off `req`. |

### New API endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/api/discovery/staged/bulk-delete` | `discovery:access` + write access | Body `{ ids: number[] }`. Deduplicated, integers only, max 2000 per call. Returns `{ deleted, missing }`. |
| `POST` | `/api/discovery/staged/bulk-ignore` | `discovery:access` + write access | Same contract, returns `{ ignored, missing }`. |

Both are covered in `openapi.json` (294 routes, spec in sync) and inherit the same
permission matrix entries as the existing per-item routes — no new permission was created.

### New files

```
backend/src/middleware/securityHeaders.js   Permissions-Policy middleware
backend/src/utils/oidcAudience.js           OIDC bearer audience binding
frontend/src/components/ui/IconButton.tsx   Icon-only button primitive
scripts/test-oidc-audience.js               Regression test, wired into CI
scripts/test-rate-limit-once.js             Regression test, wired into CI
```

### New i18n key

`common.ui.toggleOptions` — added to `de`, `en` and `es`. Names the `InputSelect` chevron
toggle, which previously had no accessible name.

---

## 2. Security changes and their value

### 2.1 OIDC access tokens were accepted on liveness alone — CWE-863

**Severity: high. Authentication bypass across tenant boundaries at the same IdP.**

When the HS256 session JWT fails to verify and OIDC is configured, `middleware/auth.js`
falls back to treating the bearer as an IdP access token and resolving the user from the
issuer's `userinfo` endpoint.

`userinfo` answers exactly one question: *is this token currently valid at this issuer?*
It says nothing about **who the token was issued to**. Any access token minted by the same
issuer for **any other client** therefore authenticated as whichever OpenISMS account
matched the email in the response.

Concretely: if the same Keycloak or Entra tenant also fronts Grafana, a wiki, or any
internal tool, a token issued to that tool was accepted as a valid OpenISMS session — with
that user's full permissions.

**Fix.** `utils/oidcAudience.js` reads `azp`, `appid`, `client_id` and `aud` from the token
and rejects it when it names an audience that is not our configured client id. The claim
list covers Keycloak (`azp`, with `aud` frequently just `account`), Entra ID v1 (`appid`)
and v2 (`azp`), and providers that set `client_id`.

**Deliberately permissive in one direction.** Opaque (non-JWT) tokens and tokens that carry
none of those claims cannot be judged locally and keep relying on the issuer exactly as
before. Only a token that *does* name an audience, and names someone else, is rejected —
so no working deployment changes behaviour.

**Guarded by** `scripts/test-oidc-audience.js`, covering both directions including the
actual attack shape: a foreign-client token carrying a valid OpenISMS user's email.

### 2.2 `http://localhost:*` was a CORS origin in production

**Severity: medium. Credentialed cross-origin access from any local process.**

The CORS callback allowed any `localhost` or `127.0.0.1` origin unconditionally, in every
environment, with `credentials: true`. Any process able to bind a port on an operator's
machine — a dev server, a browser extension helper, malware — could serve a page from
`http://localhost:1234` and make credentialed requests against the ISMS API.

**Fix.** The allowance is gated on `NODE_ENV !== 'production'`. Development is unaffected;
in production the `APP_URL` list is authoritative, and an operator who genuinely needs a
localhost origin adds it there like any other.

### 2.3 No `Permissions-Policy` header

**Severity: low. Defence in depth; also a recurring external-scanner finding.**

Helmet does not set this header, so the app never restricted powerful browser features for
its own origin or for anything it embeds. `middleware/securityHeaders.js` now switches off
twenty features the application does not use — camera, microphone, geolocation, payment,
USB, serial, display-capture and the rest.

Three carve-outs are deliberate and load-bearing:

- `publickey-credentials-get=(self)` and `publickey-credentials-create=(self)` — **without
  these, passkey login breaks silently.**
- `clipboard-write=(self)` — the "copy API token" and "copy agent command" buttons.
- `fullscreen=(self)` — the topology and Mermaid diagram views.

### 2.4 Both rate limiters counted every request twice — CWE-770

**Severity: medium. Every rate-limit budget in the application was silently halved.**

This is the highest-leverage finding in the set, because it undermined a control the
codebase had deliberately put in place.

Both limiters are mounted **twice** on most paths: once application-wide in `index.js`, and
once inside each router — the per-router mount being the one CodeQL wants to see on the
handler for CWE-770. `express-rate-limit` counts every pass through the middleware, so the
duplication meant one request consumed two counters.

**Measured, not inferred:** a limiter configured `max: 10` and mounted this way starts
returning 429 on the **6th** request, and `RateLimit-Remaining` drops by 2 each time.

| Path | Configured | Actually enforced |
|---|---|---|
| `/api/discovery` | 300 / 15 min | **150** |
| `/api` | 5000 / 15 min | **2500** |

The security consequence cuts both ways. Availability: legitimate bulk work hit 429 at half
the intended volume — which is exactly how the approval-queue bug below manifested. And
governance: a documented, reviewed control was not delivering what its configuration
claimed, which is precisely the class of finding an ISMS exists to surface.

**Fix.** The request is marked on the first pass and skipped on later ones. Both mounts stay
in place — CodeQL still sees a limiter on the route — while each request counts exactly
once. **Guarded by** `scripts/test-rate-limit-once.js`, which asserts on the *counter*
rather than on status codes: with real budgets of 5000 and 300, a doubled count does not
show up over a handful of requests, so a status-code test passes with the bug still present.
Verified to fail when the fix is reverted.

### 2.5 Server-side avatar fetching, with an SSRF guard

The OIDC `picture` claim is now fetched server-side and inlined as a `data:` URI (see §3.4).
That turns a URL supplied by the identity provider into a server-side request, which is an
SSRF primitive — at many IdPs a user can edit their own profile, so the value is not
necessarily administrator-controlled.

Bounded accordingly:

- `http`/`https` only.
- The **resolved** address must be public unicast. Loopback, `0.0.0.0/8`, RFC1918,
  link-local (including the `169.254.169.254` cloud metadata endpoint) and CGNAT are
  refused, for IPv4 and IPv6 including IPv4-mapped forms.
- **Redirects are refused outright** (`redirect: 'error'`) — a followed redirect would
  sidestep the address check.
- 4-second timeout, `image/*` content types only, 512 KB cap.

Any check that trips yields no avatar and leaves the login working.

### 2.6 Audit-trail integrity restored

The `isAcceptance` defect in §3.1 did not only produce an error message: assessments were
being **committed without their audit entry**. For an ISMS that is the serious half. See
§3.1 for the mechanism and the remediation check you should run.

### 2.7 Not an application bug, but worth acting on

The CSP violations observed in production for `static.cloudflareinsights.com/beacon.min.js`,
an inline script on `/auth/callback`, and Google Analytics `G-CDVZK44PKK` do **not**
originate in this application — it ships no analytics of any kind (no `gtag`, GTM, or
Cloudflare beacon anywhere in `frontend/`). They are injected by the proxy in front of the
deployment.

Worth acting on regardless of the console noise: those GA payloads carried
`dl=https://<host>/auth/callback?code=…`, i.e. the **OIDC authorization code** was being
sent to Google Analytics as a page-view URL. The CSP's `connect-src 'self'` is the only
reason it never left the browser.

Turning the injection off for this hostname is the fix. Loosening the CSP to silence the
console would be the wrong direction.

### 2.8 Supply chain

Backend and frontend dependencies plus GitHub Actions pins were brought current
(`@anthropic-ai/sdk`, `mysql2`, `openai`, `openid-client`, `otplib`, `rotating-file-stream`,
`swagger-ui-dist`, `nodemon`; `i18next`, `lucide-react`, `mermaid`, `react-i18next`,
`@vitejs/plugin-react`, `vite`, `@types/react-dom`; `codeql-action` 4.37.7 → 4.37.8, and
`crowdin/github-action` and `docker/setup-buildx-action` re-pinned to current commit SHAs).
`npm audit` reports no advisories in either workspace.

---

## 3. Functional bugfixes

### 3.1 Saving a risk assessment failed with `isAcceptance is not defined`

**Impact: every Schutzbedarfsfeststellung saved through the REST API since `86396a0`.**

`86396a0` wrapped the write in a transaction and moved the body into a callback. The
`const isAcceptance` declaration moved with it — but the audit-log call **after** the commit
still reads it, and that read sits outside the callback's scope. Every save threw a
`ReferenceError`, which the route's catch turned into a 400 carrying the raw message.

The sequence matters:

1. The transaction **committed** — the assessment was written.
2. `auditFromReq(...)` threw → **no audit entry was recorded**.
3. `checkAndManageAssetTasks(asset)` never ran → **related tasks were not auto-closed**.
4. The client received a 400 and the user assumed nothing had been saved.

**Fix.** `isAcceptance` is declared alongside `acceptedUntilDate`, where both the
transaction body and the audit call can see it.

> **Remediation to run.** Assessments created while this defect was live exist in the
> database **without a corresponding audit-log entry**, and may have duplicates from users
> retrying after the error. Reconcile `assessments` against `audit_logs` for
> `action = 'assess'` over the affected window.

The MCP tool `isms_create_assessment` builds the same task and reminder but keeps everything
in one scope, so it was never affected.

### 3.2 Software approval queue: "0 entries deleted"

**Impact: bulk delete unusable on any realistic queue.**

The UI looped over the selection and fired **one request per row**. With 291 staged items
that exhausted the halved discovery budget (§2.4) part-way through. Because every error was
swallowed by `catch {}`, the toast reported a count of zero with no reason, and the reload
immediately afterwards was rate-limited too — producing the second message, "Could not load
software to be approved". A retry then deleted nothing at all, because the window was
already spent.

**Fix.** `POST /discovery/staged/bulk-delete` and `/bulk-ignore` take the whole selection in
one request: one `DELETE … WHERE id IN (…)`, one rate-limit count. They report how many rows
actually went and how many were already gone, so a partial result is never rounded up to
"all done". The frontend sends one request and surfaces the server's error instead of
discarding it.

`bulkApprove` still loops, because approving creates an Asset and has no single-statement
equivalent. It now stops at the first 429 and says why, rather than hammering through the
rest of the selection.

### 3.3 The service worker cached nothing

**Impact: the PWA offline fallback had never worked.**

`caches.open()` is asynchronous. By the time its callback ran and called `res.clone()`, the
page had already consumed the response body — and `clone()` throws once the body is
disturbed. `put()` therefore never executed. Both the navigate branch and the
stale-while-revalidate branch had the same shape, so **nothing was ever written to the
cache**, and the offline fallback had nothing to fall back to.

**Fix.** Clone synchronously, before the response is returned.

### 3.4 OIDC profile pictures never rendered

**Impact: broken avatar for every non-Entra identity provider.**

Not the provider's fault. The application's own CSP is `img-src 'self' data: blob:`, so any
external image host is blocked and a stored remote URL can only ever render as a broken
image — however valid the URL is.

The MS Graph branch had already solved this by downloading the photo into a `data:` URI. The
standard `picture` claim now does the same, so it works for Authentik, Keycloak, Google and
the rest. See §2.5 for the SSRF guard this required.

---

## 4. Accessibility — WCAG 2.2 AA

Thirty-seven of the application's thirty-eight pages import the same handful of primitives,
so a gap in one of them was a gap on every screen.

### 4.1 Shared UI kit

| Component | Was | Now |
|---|---|---|
| `Input`, `Select` | `<label>` next to the control with nothing linking them — announced as an unlabelled field, and the label was not clickable | `useId` + `htmlFor`; a label ending in `*` sets `aria-required` (not `required`, which would add browser validation to fields that submit fine today) |
| `Input` error | Red text nothing pointed at, never announced | `role="alert"`, referenced from `aria-describedby`, `aria-invalid` on the control, plus a red border so the state is not carried by text colour alone |
| `Modal` | No dialog semantics at all; Tab walked into the page behind the overlay; closing dropped focus onto `<body>` | `role="dialog"`, `aria-modal`, `aria-labelledby`, a Tab trap, focus into the panel on open (respecting an `autoFocus`'d field) and back to the opener on close; the close button has a name |
| `InfoTooltip` | Hover-only `<span>` — the BCM and compliance definitions it carries were mouse-only | A real button, described by a `role="tooltip"` element, revealed on `:focus-visible` as well as hover |
| `Button` | No consistent focus indicator; icon-only buttons announced as "button" | `focus-visible` ring (3.60:1 light, 7.64:1 dark); `aria-label` derived from the `title` already present |
| `Table` | `Th` carried no `scope` | `scope="col"`, so a wide table is read column-by-column (the assessments list runs to twelve columns) |
| `Skeleton` | Placeholder blocks read as empty content | `aria-hidden`; every page's loading view already announces itself via `role="status"` |
| `InputSelect` | Chevron had `focus:outline-hidden` with no replacement ring and no name | Focus ring plus `common.ui.toggleOptions` |

### 4.2 Contrast — measured, not recalled

All ratios were computed from the **oklch values in `tailwindcss/theme.css`**. Tailwind v4
shifted several greys away from their v3 hexes, so a ratio recalled from memory would have
been wrong.

The trap: the failing token differs by mode, so a find-and-replace would have made dark mode
*worse*.

| Token | Light | Dark (on `slate-900`) |
|---|---|---|
| `text-gray-400` | **2.60:1 FAIL** | 6.85:1 PASS |
| `text-gray-500` | 4.84:1 PASS | **3.69:1 FAIL** |
| `slate-500` | 4.76:1 PASS | **3.74:1 FAIL** |
| `slate-400` | — | 6.78:1 PASS |

The sweep is therefore conditional per class list. Where a list already carried a resting
`dark:text-*`, only the light token moved (167 places). Where it did not — 229 places,
mostly the row icon buttons — the light token moved **and** an explicit `dark:text-gray-400`
was added, so dark mode keeps the ratio it already had.

Also in this pass: `dark:text-slate-500` → `slate-400` (183 places); the `wont_fix` and
`not_applicable` chips read `slate-500` on `slate-100` at 4.35:1 and moved to `slate-600`;
placeholders went 2.60:1 → 4.84:1 light and 3.07:1 → 5.56:1 dark.

**Incidental find:** the sidebar version line carried `dark:text-slate-650`. **`slate-650` is
not a Tailwind token**, so the class was inert and dark mode silently fell back to the light
`slate-500` at 3.74:1.

Only strings that are *entirely* a class list were rewritten, so an appended variant could
never land inside an expression; the three template literals that could not be proven safe
were done by hand.

**End state on `main`: zero occurrences** of light-mode `text-gray-400`, `dark:text-slate-500`,
`placeholder:text-gray-400`, or the inert `slate-650`.

### 4.3 Touch targets — WCAG 2.2 SC 2.5.8

The pattern across the application was `<button className="p-1"><Pencil size={14} /></button>`
— a **22 × 22 CSS px** target, under the 24 × 24 floor, and awkward on a touch screen.
**66 of them across 28 files, 40 with no accessible name at all.**

`components/ui/IconButton.tsx` takes `label` as a **required** prop — that is what stops
unnamed ones reappearing — and it becomes both `aria-label` and `title`. `p-1.5` takes a
14 px icon to 26 × 26 without changing the row height it sits in. Same `focus-visible` ring
as `Button`, plus a `danger` variant for deletes.

Labels reuse each button's existing `title` where it had one, and `common:actions.*`
otherwise. Buttons whose `className` was not a plain string, or whose icon had no obvious
action mapping, were left for hand-migration rather than guessed at — that was one, the
custom-role wrench in `Admin.tsx`.

**End state on `main`: 67 `IconButton` uses; zero sub-24 px icon-only buttons; zero unnamed.**

### 4.4 Form-control boundaries — WCAG SC 1.4.11

SC 1.4.11 asks for 3:1 on a control's visual boundary, and the border was the only thing
marking these fields — a white field on a white card.

- `border-gray-300` on white — **1.47:1**
- `dark:border-slate-700` on `slate-900` — **1.72:1**

There is no gentle option: `gray-400` reaches only 2.60:1 and `slate-600` only 2.35:1. Hence
`border-gray-500` (4.84:1) and `dark:border-slate-500` (3.74:1 against the card, 3.07:1
against the field fill). **Fields read a little heavier than before** — that is the tradeoff
the ratio forces.

Scoped to actual controls: the four field primitives, the `input-base` utility, the inline
date/textarea/select fields, checkbox borders, and the two boundaries marking an interactive
region (the Topology direction group, the Login SSO and passkey buttons). Decorative borders
keep `gray-300` — the dashed upload drop-zones and the Vendors blockquote rule — since
1.4.11 does not apply to them.

---

## 5. Verification

Local, on the merged tree:

- `npx tsc --noEmit` — clean
- `npm run build` (frontend) — clean
- `find src -name '*.js' -print0 | xargs -0 -n1 node --check` (backend) — clean
- Backend module-load smoke test — clean
- All eight consistency scripts pass, including the two new ones
- `npm audit` — no advisories in either workspace
- `openapi.json` in sync — 294 routes, 294 operations
- Permission matrix consistent with route fallbacks

CI on each merged head: all thirteen checks completed, with CodeQL's aggregate check
`neutral` (no new alerts) and Aikido `skipped` (not enabled).

Two new regression tests are wired into the consistency-check step in
`.github/workflows/security.yml`:

- `scripts/test-oidc-audience.js` — audience binding, both directions
- `scripts/test-rate-limit-once.js` — one request, one counter

---

## 6. Deliberately left open

**The session JWT lives in `localStorage`.** Any successful XSS reaches it. The application
defends the sinks well — the markdown renderer escapes before it builds HTML, the Mermaid
path never touches `innerHTML`, and the CSP pins scripts to `'self'` plus a nonce — but the
blast radius if one ever slips is a full session.

Moving it to an `httpOnly` cookie removes the read path. The catch is stated in
`backend/src/index.js`: the API skips CSRF protection *precisely because* it authenticates
from the `Authorization` header and never from a cookie. Putting the token in a cookie means
adding that protection back across **292 routes**.

That is a real tradeoff with real work behind it, not a change to slip into a bugfix
release. It is recorded here so it is a decision rather than an oversight.
