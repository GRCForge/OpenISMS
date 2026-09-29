# OpenISMS v3.2.0 — NIS-2 self-check and gap analysis

v3.1.0 made the NIS-2 criteria catalogue adapt to how an organisation is
affected. This release adds the step that comes before it: **a 37-question
self-check that says where you actually stand**, and a gap view that turns the
answers into a ranked list of what still has to be done.

Additive. No existing data is migrated, rewritten or deleted.

---

## 1. Why a questionnaire and not just the catalogue

The criteria catalogue tracks the obligations under Art. 20, 21 and 23 and
their implementation status. That is the right structure for running the ISMS,
and the wrong one for starting it — a fresh catalogue is 18 rows all reading
"not started", which says nothing about the organisation.

A questionnaire says where you stand, in the form an initial audit or an
external self-check asks it. The two together give the gap: the questionnaire
measures coverage, the catalogue tracks the obligation, and the difference is
the work list.

### Two axes, because "we do that, nobody wrote it down" is a real finding

Every question is answered twice:

| Axis | Question |
|---|---|
| **Implementation** | Is the measure in place? |
| **Evidence** | Can we prove it? |

This is not a formality. Art. 21(1) requires an entity to be able to
demonstrate the appropriateness of its measures, and an auditor sees only what
is documented. A measure that exists but cannot be shown is a real gap — the
cheapest one to close and the one most often overlooked. Splitting the axes is
the only way it shows up at all.

---

## 2. The questionnaire

**37 questions across 16 topics**, each carrying:

- the **article** it maps to, so it lines up with the criteria catalogue,
- a **recommendation** — what to do when the answer is weak, which becomes the
  description of the remediation task,
- **per-profile applicability**, as in the criteria catalogue,
- a **stable identifier** (`q1` … `q37`) so an answer set collected elsewhere
  can be imported without matching anything by hand.

Topics: Governance · Risk analysis · Risk treatment · Threat analysis ·
Incident response · Continuity · Supply chain · System hardening · Control and
review · Cyber hygiene · Cryptography · Access and assets · Authentication and
communication · Corrective measures · Internal reporting · Customer and partner
information.

Answers save on click. A 37-question form with one Save button at the end
eventually loses a session.

### Coverage of the directive

Every question points at an article that exists in the criteria catalogue —
enforced by a test, because a question that maps to nothing leaves its gap
hanging in the air instead of attached to an obligation. The reverse is
reported rather than hidden: Art. 23(4) (final report within a month) is in the
catalogue but has no question, and the coverage view shows it as **unchecked**,
not as fulfilled.

---

## 3. Scoring, and what it is not

```
question score = 0                                   if implementation = no
               = 2/3 × implementation + 1/3 × evidence   otherwise
```

with yes = 1, partly = 0.5, no = 0.

- **Implementation weighs twice as much as evidence.** Without the measure
  there is nothing to document — but it still has to be documented.
- **"Not implemented but evidenced" is 0**, not a partial credit. It is a
  contradiction, not half a success.
- **Unanswered questions do not count as 0.** Otherwise every questionnaire
  starts at 0 % and the rate measures how far the filling-in has got. The
  completion rate is reported separately: 90 % fulfilment on 20 % of the
  questions is not good news, and you have to be able to see that.
- **A missing evidence answer is not "no evidence."** Nobody has been asked
  yet; the question then counts on implementation alone.

Per topic and overall, the result is a rate, a **maturity level 1–5** and a
status (good ≥ 80 %, improvable ≥ 50 %, critical below).

### It will not reproduce another tool's number

The maturity scale is five steps because external self-checks present their
results that way and the figures should be readable side by side. Side by side
is not the same as identical: a vendor tool weighs the same answers
differently, and how is not published. Against one concrete report this scale
landed on the same maturity level for 12 of 16 topics and for the overall
result; the deviations all went upward, because "partly" is treated more
leniently here.

Reproducing a number whose derivation is unknown would be guessing. What this
scale offers instead is that its derivation is written out in
`nis2SelfCheckScoring.js` and can be explained in an audit — for a GRC tool the
more useful property.

---

## 4. Gap analysis

Gaps are classified and ranked, worst first:

| Kind | Meaning |
|---|---|
| **Not implemented** | the measure is missing |
| **Partly implemented** | started, not finished |
| **Not evidenced** | in place, but nothing to show for it |

Each gap carries its recommendation and turns into a **task** with one click —
priority derived from the kind, description prefilled from the recommendation,
linked back to the question. A missing measure is high priority; a missing page
of paper is not.

**Coverage per NIS-2 element** puts the two sides next to each other: per
article, what the questionnaire found and what the criteria catalogue tracks.
That is the view that answers "which NIS-2 requirements still need work".

---

## 5. Importing an existing answer set

Anyone who has already done this assessment elsewhere should not retype it 37
times. *Import answers* accepts one line per question:

```
q1;Ja;Ja
q2;Teilweise;Ja
q3;Ja;Ja;Schulungsnachweis 2026
```

Semicolon, tab or comma; German (`Ja` / `Teilweise` / `Nein`) and English
answers both recognised; a header line is skipped. The preview counts what was
recognised before anything is written, unreadable lines are reported rather
than dropped silently, and unknown question identifiers come back in the
response.

The import is transactional. A half-applied answer set is worse than none,
because nobody can tell afterwards which half is stale.

CSV export produces the same shape, so the round trip works.

---

## 6. New API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/nis2/self-check` | Questions with answers and per-profile obligation |
| `GET` | `/api/nis2/self-check/stats` | Rates per topic, coverage per article, ranked gaps |
| `POST` | `/api/nis2/self-check/seed` | Load the 37-question catalogue |
| `POST` | `/api/nis2/self-check/sync-catalog` | Add questions introduced in a newer version |
| `PUT` | `/api/nis2/self-check/:id` | Answer a question |
| `POST` | `/api/nis2/self-check/bulk-answer` | Import an answer set (transactional) |
| `POST` | `/api/nis2/self-check/:id/to-task` | Create a remediation task from a gap |
| `POST` | `/api/nis2/self-check` | Add an own question |
| `DELETE` | `/api/nis2/self-check/:id` | Delete an own question |

No new permissions: the existing `nis2` actions (`view`, `create`, `edit`,
`delete`, `seed`) apply. `openapi.json` covers all of them.

**New MCP tools**: `isms_list_nis2_self_check`, `isms_get_nis2_gaps`,
`isms_answer_nis2_self_check` — same permission matrix as the REST routes. The
gap tool is the useful one for an assistant: it returns the whole picture,
ranked, with recommendations.

---

## 7. Security and data integrity

- **Who answered comes from the session**, never from the request body — in
  the REST route and in the MCP tool alike.
- **The answered timestamp is only set when an answer actually arrives.** A
  note does not turn an open question into an answered one.
- **Catalogue questions cannot be deleted**, only set to "not applicable". A
  question that was deliberately excluded should be visible as excluded; one
  that vanished looks like one that was never asked. Own questions delete
  normally.
- **Bulk import is bounded** (500 rows), validates every answer value against
  the enum, and runs in a transaction.
- Answers are written through an explicit field allow-list.

---

## 8. Changed in the existing module

**Maturity scale unified.** The criteria catalogue and the questionnaire now
use one scale (≥ 95 → 5, ≥ 75 → 4, ≥ 50 → 3, ≥ 25 → 2, else 1). Previously the
catalogue used slightly different thresholds; two scales in one module would
have been a reporting trap.

**The self-check profile behaves differently from the catalogue, on purpose.**
In the criteria catalogue, the Art. 23 reporting duties are `not_applicable`
for an indirectly affected entity — it owes the authority nothing. In the
questionnaire, the corresponding questions (q35–q37) are about the *internal*
reporting path and informing customers, and that is exactly what a supplier
owes its affected client contractually. They stay `required`.

More generally: no question in this catalogue is one you should not ask a
supplier. What the profile changes is the *obligation*, so `required` and
`recommended` are counted and reported separately rather than inventing an
exclusion to make the mechanism look busy. Excluding a question by hand remains
possible.

---

## 9. New table

| Table | Content |
|---|---|
| `nis2_self_check` | 37 questions with implementation and evidence answer, evidence source, notes, responsible, recommendation, per-profile applicability, and the remediation task created from a gap |

Applied by `sequelize.sync({ alter })` on start.

---

## 10. Tests

**`scripts/test-nis2-self-check.js`**, wired into
`.github/workflows/security.yml`. It covers the three ways the rate could lie —
counting an unanswered question as 0, reading a missing evidence answer as "no
evidence", crediting "not implemented but evidenced" — plus catalogue
integrity, that every question maps to a criterion that exists, gap
classification and ranking, the coverage view including the article that has no
question, and the profile behaviour above.

All existing suites, `check-permissions`, `openapi-sync --check`,
`test-mcp-gate`, the frontend build and the module-load smoke test pass.

---

## 11. Upgrading

1. Deploy as usual.
2. Open *NIS-2 → Self-check* and load the question catalogue.
3. Either answer the 37 questions, or import an answer set you already have.
4. Work the *Gaps* view top down — each gap turns into a task with its
   recommendation attached.
5. *Coverage per element* shows which articles of the directive are still open,
   and which have not been checked at all.
