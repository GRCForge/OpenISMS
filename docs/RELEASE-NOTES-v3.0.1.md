# v3.0.1 — A score that stops flattering you, and sources instead of special cases

A patch release with no breaking changes. Upgrade from 3.0.0 is a normal
deployment; the database migrates itself on first start.

Three things, all of them found by looking at what a *blank* installation shows.

---

## The health score said 45 out of 100 with nothing in it

A fresh installation — no assets, no risks, nothing assessed — reported a health
score of 45 in the management report.

Two of the four components measure that something is **absent**: no overdue
reviews, no critical risks. Both paid out in full when there was no inventory at
all:

```
(0/100) * 30                  =  0   controls implemented
(0/100) * 25                  =  0   assets assessed
max(0, 1 - 0/max(0,1)) * 25   = 25   "no overdue reviews"
max(0, 1 - 0) * 20            = 20   "no critical risks"
                                45
```

This failed in the dangerous direction: it **overstated** maturity. "No overdue
reviews" is trivially true while no asset exists to review. Nothing recorded
looked like nothing wrong — in a report that carries management decisions.

An absence component now scores only when there is an inventory in which
something *could* go wrong. An empty ISMS scores 0 of 100.

The report also returns `health_score_parts` and `health_score_basis`
(assets, controls, risks). Without the basis, a 0 cannot be told apart from
"everything is bad" — which is exactly the confusion that started this.

### The same figure was calculated three times

| Where | Weights | Result on the same blank system |
|---|---|---|
| `routes/report.js` | 30/25/25/20 over controls, assessments, reviews, risks | 45 |
| `mcp/server.js` | 40/20/30/10 over controls, **tasks**, risks, reviews | 40 |
| `ManagementReport.tsx` | copy of the report formula, as a client-side fallback | — |

Even "open high risks" meant different things: in the report it came from the
assets' CIA ratings, in MCP from the risk register.

One implementation now serves all three (`services/healthScore.js`). The
frontend no longer falls back to a formula of its own: if the value is missing,
it says *not determinable* rather than hiding a gap behind a substitute number.

The shared source for risks is the **register**, not the CIA rating: a high
residual risk is an assessed, named statement; a high protection requirement is
only a requirement. Accepted and closed risks do not count as open — an
acceptance is a decision that was made.

---

## Integrations are sources now, not wiring

CheckMK was not a source, it was wiring: five fixed routes, its own settings key,
its own sync service. A second source would have copied all of it.

An integration now lives in `services/integrations/` and brings what defines it:
config fields, connection test, mapping to proposals. Routes run through
`/api/integrations/<source>/...`, and the previous `/checkmk/` paths are
unchanged — `checkmk` is simply a value of `:source` now. **Adding Wazuh or
Proxmox is one file plus one line in the registry.**

The reconcile with its four cases — update linked asset · update proposal ·
create proposal · mark assets the source no longer reports as `MISSING` — exists
once, in `services/discoverySync.js`.

### Not every source may argue from absence

The fourth case concludes, from a record being missing, that an asset is gone.
Only a source that enumerates its inventory completely may do that. A monitoring
system reports every host it knows. An uploaded spreadsheet is an excerpt
somebody sent — concluding that everything it fails to mention is gone would be
nonsense with data loss attached. Each adapter states this about itself.

---

## The file import was the way around the approval

`/api/import` created an asset directly for every row. While CheckMK was only
allowed to *propose*, and every adoption was a documented human decision, a
spreadsheet from an inbox was enough to get into the inventory past that same
control point.

Rows now become proposals (`source='excel'`) and go through the same approval
under Network Discovery. Imports are repeatable via an inventory number from the
file (the name otherwise): the same key updates the proposal instead of adding a
second one.

What a re-import does **not** do: overwrite maintained fields of an approved
asset. A spreadsheet must not overturn a classification decided inside the ISMS.

Three further findings on the way:

- **"Department" was mapped as an import field, but `Asset` has no such column.**
  Sequelize ignores unknown attributes on create — the asset was created, just
  without the value somebody had taken care to fill in. It is kept as a tag now.
- **Network Discovery labelled every source except `network-scan` as "Agent".**
  A host reported by CheckMK appeared there as an agent finding.
- **`discovered_softwares.os` carries the provenance line** (`CheckMK host: x |
  IP: ... | 6x CRIT: ...`). With real service names that exceeds 255 characters,
  and PostgreSQL does not truncate, it aborts — so the host with the most open
  alerts was the one that did not make it into staging. The column is `TEXT`
  now; 3.0.0 installations are migrated by an explicit `ALTER` on start.

---

## Upgrading from 3.0.0

Nothing to do beyond deploying. On first start the application widens
`discovered_softwares.os` and adds the `payload` column, and logs both.

Installations that already have staged CheckMK entries keep them; their source
label changes from "Agent" to "CheckMK" in the UI, which is what they always
were.

---

## Verified

- `scripts/test-discovery-sync.js` (new, in CI): the four cases, both guards
  against arguing from absence, separation between sources, dry-run writes
  nothing, the payload allow-list, the CheckMK mapping including the measured
  overlength of the provenance line.
- Against a running instance (PostgreSQL 18 + AGE): blank installation scores 0
  in both the report and MCP; with test data both return 92 with identical
  components. Import of 3 rows → 3 proposals, no assets; same import again → no
  duplicates; approval → 3 assets with classification, hosting, location, tags
  and provenance link; import after approval → updates, no new proposal; all
  three present as nodes in the graph.
