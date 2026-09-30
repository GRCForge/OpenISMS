# OpenISMS v3.3.0 — NIS-2 catalogue with sub-requirements and BSIG duties

v3.2.0 shipped the NIS-2 criteria catalogue as 18 entries — one per article of
the directive. That is the right set of legal anchors and the wrong level of
detail to work with: "maintain operations" as a single row is a table of
contents, not something anyone can tick off. It was also incomplete for a
German entity: the directive's articles are not the whole of what the BSIG
demands.

This release breaks the measures into **94 checkable sub-requirements**, adds
the reference a German entity is actually audited against, and adds the five
duties from BSIG chapter 2 that have no counterpart in Art. 20, 21 or 23.

---

## 1. Two levels

| | |
|---|---|
| **Top level** (23) | the legal anchors, worded close to the statute |
| **Sub-requirements** (94) | what an auditor actually asks to see |

"Maintain operations" (Art. 21(2)(c) / § 30 Abs. 2 Nr. 3 BSIG) is now six rows:
impact analysis, backup concept, restore tests, recovery plans, crisis
management, redundancy. Each of those is either in place or it is not.

The full breakdown:

| Measure | Sub-requirements |
|---|---|
| Art. 21(2)(a) · § 30 Abs. 2 Nr. 1 — risk analysis and security policy | 7 |
| Art. 21(2)(b) · Nr. 2 — incident handling | 7 |
| Art. 21(2)(c) · Nr. 3 — business continuity | 6 |
| Art. 21(2)(d) · Nr. 4 — supply chain | 5 |
| Art. 21(2)(e) · Nr. 5 — acquisition, development, vulnerabilities | 7 |
| Art. 21(2)(f) · Nr. 6 — effectiveness | 4 |
| Art. 21(2)(g) · Nr. 7 — cyber hygiene and training | 5 |
| Art. 21(2)(h) · Nr. 8 — cryptography | 4 |
| Art. 21(2)(i) · Nr. 9 — personnel, access control, asset management | 8 |
| Art. 21(2)(j) · Nr. 10 — MFA and secured communication | 4 |
| Art. 20(1), 20(2) — management approval and training | 6 |
| Art. 21(3), 21(4) — supplier practice, corrective measures | 5 |
| Art. 23(1), 23(2), 23(4) — reporting duties | 5 |
| § 33 BSIG — registration with the BSI | 5 |
| § 34 BSIG — additional registration for certain entity types | 3 |
| § 35 BSIG — informing recipients of the service | 4 |
| § 31 BSIG — attack detection, operators of critical facilities | 5 |
| § 39 BSIG — three-yearly evidence, operators of critical facilities | 4 |

## 2. Counting

**A criterion with children is a bracket and does not count itself.** Otherwise
the same requirement enters the rate twice — once as a measure, once through
its parts — and a measure with eight sub-items would weigh nine times as much
as one without.

So 117 rows, of which **95 are counted** (94 sub-requirements plus the one
top-level criterion that has no children) and 22 are brackets. A bracket shows
a derived progress bar instead of a status, and the API reports `counted` and
`containers` alongside the rate.

Setting a parent to "implemented" no longer flatters the rate, and implemented
children count without the parent being touched. Both directions are asserted
in `scripts/test-nis2-applicability.js`.

## 3. BSIG references

A German entity is not audited against the directive but against the BSIG. The
ten measures of Art. 21(2)(a)–(j) appear there as **§ 30 Abs. 2 Nr. 1–10**, and
that is how supervisors and consultants cite them. The catalogue now carries
that reference (`bsig_ref`) on the ten measures and their sub-requirements, and
the UI shows it under the article reference.

Where a reference is missing it is because it is not established. A guessed
paragraph number in a compliance tool is worse than none.

## 4. Applicability

Sub-requirements inherit the applicability of their parent, so the affectedness
profile keeps working unchanged: what does not apply to an indirectly affected
entity does not apply to its parts either. A test asserts no sub-requirement
applies more widely than its parent.

## 5. Upgrading

`POST /api/nis2/sync-catalog` (button *Sync catalogue*) adds the 99 new rows to
an existing installation. Status, evidence, responsible persons and adjusted
applicability on the existing 18 are untouched.

The three new columns on `nis2_measures` (`parent_ref`, `bsig_ref`,
`scope_note`) are added by `sequelize.sync({ alter })` on start.

**The NIS-2 module is off by default.** If the menu entry is missing, switch it
on under *Administration → Modules → NIS-2*; the self-check is the second tab
on that page.

## 6. Duties the directive does not state

Working the ten measures of Art. 21(2) does not make a German entity compliant.
BSIG chapter 2 carries obligations that appear nowhere in Art. 20, 21 or 23,
and missing one of them is not a gap in a maturity score — it is a missed
statutory deadline. Five of them are now in the catalogue:

| | |
|---|---|
| **§ 33 BSIG** | Registration with the BSI within three months of falling into scope, via the joint BSI/BBK facility. Changes to the registered data go in without delay and at the latest **within two weeks** of the entity learning of them (§ 33 Abs. 3). No notice triggers this — the duty arises by itself. |
| **§ 34 BSIG** | Additional registration data for DNS providers, TLD registries, cloud and data-centre services, CDNs, managed (security) service providers, online marketplaces, search engines and social network platforms. |
| **§ 35 BSIG** | Informing the recipients of the service about a significant incident, and — for the sectors the section names — about significant cyber threats and the remedies those recipients can apply themselves. This points outward and is a different duty from the report to the authority under § 32. |
| **§ 31 BSIG** | Attack detection systems for operators of critical facilities: continuous, automatic capture and evaluation of suitable parameters from live operation. A German requirement going beyond Art. 21. |
| **§ 39 BSIG** | Evidence to the BSI **every three years** that the risk management requirements are met — operators of critical facilities only. |

### Conditional duties

§ 31 and § 39 apply only to operators of critical facilities. The affectedness
profile cannot express that, because such an operator is always also an
*especially important* entity. So the condition sits on the criterion as a
`scope_note` and is shown in the UI.

Those criteria default to *required* for especially important entities and
*not applicable* for important ones. An especially important entity without a
critical facility sets them to "not applicable" in one click and they drop out
of the rate — reported as `excluded_manually`. That direction was chosen
deliberately: showing a duty that turns out not to apply costs a click, while
hiding one that does apply costs a deadline. It matches how the module already
treats an unclassified entity as *essential*.

### Not included

The BSI's #nis2know download page remained unreachable from the build
environment (the egress proxy answers 403 for `bsi.bund.de`), so no material
from it has been incorporated. The statutory references above come from the
BSIG text itself and each was verified before being written into the catalogue;
where a reference is not established, the field stays empty.
