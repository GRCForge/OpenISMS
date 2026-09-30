# OpenISMS v3.3.0 — NIS-2 catalogue with sub-requirements and BSIG references

v3.2.0 shipped the NIS-2 criteria catalogue as 18 entries — one per article of
the directive. That is the right set of legal anchors and the wrong level of
detail to work with: "maintain operations" as a single row is a table of
contents, not something anyone can tick off.

This release breaks the ten measures into **73 checkable sub-requirements** and
adds the reference a German entity is actually audited against.

---

## 1. Two levels

| | |
|---|---|
| **Top level** (18) | the legal anchors, worded close to the statute |
| **Sub-requirements** (73) | what an auditor actually asks to see |

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

## 2. Counting

**A criterion with children is a bracket and does not count itself.** Otherwise
the same requirement enters the rate twice — once as a measure, once through
its parts — and a measure with eight sub-items would weigh nine times as much
as one without.

So 91 rows, of which **74 are counted** (73 sub-requirements plus the one
top-level criterion that has no children) and 17 are brackets. A bracket shows
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

`POST /api/nis2/sync-catalog` (button *Sync catalogue*) adds the 73 new
sub-requirements to an existing installation. Status, evidence, responsible
persons and adjusted applicability on the existing 18 are untouched.

The two new columns on `nis2_measures` (`parent_ref`, `bsig_ref`) are added by
`sequelize.sync({ alter })` on start.

**The NIS-2 module is off by default.** If the menu entry is missing, switch it
on under *Administration → Modules → NIS-2*; the self-check is the second tab
on that page.

## 6. Not included

The BSI's own #nis2know material was not reachable from the build environment,
so nothing from it has been incorporated. Specifically still open, pending
verified references:

- the registration duty with the BSI,
- attack-detection systems for operators of critical installations,
- the duty to inform recipients of the service,

each of which is a German addition or specification rather than a direct
restatement of the directive.
