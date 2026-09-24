# v2.3.0 — PostgreSQL, and relationships you can actually ask about

> **BREAKING: MySQL is no longer supported, and there is no upgrade path from 2.2.x.**
> Existing installations stay on 2.2.x. See [Upgrading](#upgrading) before you read
> anything else.

Two things happened in this release, and the second is the reason for the first.

OpenISMS moved from MySQL to PostgreSQL. On its own that would be a platform swap
with nothing to show for it. What it buys is **Apache AGE**: a graph living in the
same database, in the same transaction, as the tables — no second datastore, no
synchronisation between two systems, one backup.

That graph answers the questions the list views were never built for. Not "which
risks are linked to this asset" — that was always a join. The open-ended ones:

- Which business processes stop if this server fails, across however many steps it
  takes to get there?
- Why does this C5 criterion count as met — show me the chain, not an assertion.
- Which frameworks does this one control actually cover?

---

## Upgrading

**There is no upgrade path from 2.2.x.** This is a deliberate decision, not an
omission. A migration would have had to carry MySQL data into a different dialect
with different comparison semantics — and the places where those semantics differ
are exactly the places where a silent mistake does the most damage (see
[What changed underneath](#what-changed-underneath)).

- Running 2.2.x on MySQL? **Stay there.** 2.2.x keeps working.
- Setting up fresh? Use 2.3.0.

The bundled `docker-compose.yml` brings PostgreSQL 18 with AGE along. For an
external database, see `.env.example`.

---

## Relationship analysis

A new page, **Relationships**, with three tabs.

### Impact analysis

Pick an object, pick a depth, get everything that hangs off it — grouped by kind,
each entry with its distance. Edges are followed in **both** directions, which is
the whole point: a process depends on an asset, so the failure travels against the
arrow. Following only the arrow would have left out the answer the analysis exists
for.

Only the shortest route to each target is shown. Without that the same asset
appears once per path length and the interesting entries drown in repetitions.

### Evidence as a path

Enter a framework and a reference. You get the controls that satisfy it, the risks
those controls mitigate, and the assets behind them — and, at the top, whether the
requirement is **covered at all**. A requirement with no control mapped to it is
not covered, and saying so plainly is half the reason for this view.

### Connection

The shortest path between two objects, as a diagram. "How are these two related"
is asked in every audit and was reconstructed by hand until now.

---

## One control, several frameworks

Until 2.2.x a control carried exactly one `framework`, and the requirement
catalogues (ISO 27001, BSI IT-Grundschutz, NIS 2, C5, TISAX) sat next to them
completely unconnected. Anyone wanting to evidence the same control for ISO
A.5.15, BSI ORP.4.A1 **and** C5 IDM-01 had to create it three times — and maintain
three copies that drift apart.

Controls now carry requirement mappings across framework boundaries, editable in
the control dialog, with full/partial coverage per mapping. Each mapping is saved
immediately and recorded in the audit log: it is a statement about meeting a
normative requirement, not a field on a form.

New alongside it: **BCM process → asset** links. `bcm_processes.dependencies` was
free text. The right answer was usually in there, but only for humans — no
analysis could derive from it which processes stop when a given server fails. The
free-text field stays; it carries dependencies that aren't assets (staff,
premises, supply).

---

## Tables stay authoritative

The graph is a **projection**. Relationships continue to live in junction tables
with foreign keys; database triggers mirror them into the graph in the same
transaction.

For an ISMS this is the right way round:

| | Tables authoritative (chosen) | Graph authoritative |
|---|---|---|
| Integrity | enforced by the database | application's job |
| Audit trail | the existing one, unchanged | would need building |
| Broken graph | `POST /api/graph/rebuild` | data loss |

Both properties were verified rather than assumed: `cypher()` is callable from
plpgsql, and a `ROLLBACK` takes the graph change back with it.

The mapping lives in exactly one file (`services/graphProjection.js`). Both the 34
triggers and the rebuild are generated from it — two lists would have drifted, and
the difference only shows up when someone rebuilds and the analysis changes.

---

## What changed underneath

A dialect change doesn't announce itself where something breaks. It announces
itself where something keeps working and quietly means something else.

**`LIKE` used to ignore case.** MySQL's collation gave that for free; PostgreSQL
compares exactly. All 41 comparisons are now `ILIKE`. Not just the search boxes:
network discovery matches found hosts against the inventory this way, and `SRV-01`
would have created a *second* asset next to `srv-01`.

**Email is the login identity.** The same collation let `Max@example.com` find the
account `max@example.com` — relied upon everywhere, written down nowhere. Under
PostgreSQL an identity provider spelling the address differently would have found
no account and, with auto-provisioning on, created a second one: a second identity
for the same person, carrying the default role instead of the mapped one.

Addresses are now normalised on write, looked up normalised, and held unique by an
index on `lower(email)` — stricter than MySQL ever was, which had no index on
`email` at all.

**Restore has to fix the sequences.** Restoring writes ids explicitly.
`AUTO_INCREMENT` followed along; a sequence does not. Without the adjustment a
restore would look completely uneventful — until the first *new* record fails on a
key conflict, and again on every attempt after that.

---

## Also in this release

- **SSO configurable by environment variable.** `OIDC_ENABLED`, `OIDC_ISSUER`,
  `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_DISPLAY_NAME`,
  `OIDC_CLAIM_MAPPINGS`. The environment wins hard: fields set there are shown
  read-only and changes are rejected with a named reason, rather than reporting a
  save that has no effect. A value from the environment is never written to the
  database.
- **Backup export was broken.** `archiver` 8.0.0 (which arrived via a Dependabot
  batch) no longer exports a callable function. Every export returned HTTP 500.
  It doesn't show at startup because the failure only happens on download.
- **Translations were served up to 24 hours stale after an update.** The JSON files
  carry no content hash and are cached for a day, and i18next fetches them after
  page load, where a hard reload doesn't reach. New labels were missing, changed
  ones stayed put, and it never looked like a cache. The app version is now part
  of the load URL.

---

## Endpoints

```
GET  /api/graph/meta
GET  /api/graph/impact/:type/:id?depth=1..4
GET  /api/graph/evidence/:framework/:ref
GET  /api/graph/coverage/:controlId
GET  /api/graph/path/:fromType/:fromId/:toType/:toId
POST /api/graph/rebuild                          (admin, audit-logged)

GET    /api/controls/:controlId/requirements
POST   /api/controls/:controlId/requirements
DELETE /api/controls/:controlId/requirements/:id
```

If AGE is missing, only the analysis switches off — with a 503 that says what is
missing and how to set it up. A missing graph extension must not take down an
otherwise working ISMS.

---

## Notes for operators

- **AGE must be preloaded.** `shared_preload_libraries = 'age'`. `LOAD 'age'` is
  not permitted for a regular user, so without it every Cypher query fails. The
  bundled compose file does this; an external database needs it set once.
- **The AGE image is pinned** (`apache/age:release_PG18_1.8.0`), not `latest`. AGE
  picks up new PostgreSQL major versions one at a time, so a floating tag could
  land on a version the extension doesn't support yet — and that only shows on
  startup, with the data already in the volume.
- **Restore needs `session_replication_role`.** It replaces
  `FOREIGN_KEY_CHECKS` and requires elevated rights. Where they are missing the
  restore is refused with a named reason instead of stopping half-way.
- **Bulk imports can defer graph maintenance** with
  `SET LOCAL isms.graph_sync = 'off'`, then `POST /api/graph/rebuild`.
