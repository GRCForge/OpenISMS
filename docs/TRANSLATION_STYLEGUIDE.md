# OpenISMS Translation Style Guide

This guide defines terminology conventions, tone, and rules for all translations of the OpenISMS UI. It applies to all contributors, Crowdin translators, and AI-assisted translation workflows.

---

## Table of Contents

1. [General Principles](#1-general-principles)
2. [Tone and Register](#2-tone-and-register)
3. [Terminology – Do Not Translate List](#3-terminology--do-not-translate-list)
4. [Terminology – Preferred Translations (EN → DE)](#4-terminology--preferred-translations-en--de)
5. [Capitalization](#5-capitalization)
6. [Abbreviations and Acronyms](#6-abbreviations-and-acronyms)
7. [Placeholders and Interpolations](#7-placeholders-and-interpolations)
8. [Plural Forms](#8-plural-forms)
9. [Error and Toast Messages](#9-error-and-toast-messages)
10. [Date and Number Formats](#10-date-and-number-formats)
11. [UI Labels – Specific Rules](#11-ui-labels--specific-rules)
12. [Adding New Locale Strings](#12-adding-new-locale-strings)

---

## 1. General Principles

- **Accuracy first.** ISMS is a compliance-critical domain. Mistranslations of regulatory terms have legal implications.
- **Consistency above all.** Use the same term every time. If "Verarbeitungstätigkeit" was used for "Processing Activity" in one place, use it everywhere.
- **Clarity for professionals.** The audience is IT security professionals, DPOs and auditors — not general consumers. Technical vocabulary is expected and preferred over simplified alternatives.
- **No machine-translation without review.** Crowdin's auto-translation suggestions must be verified against this guide before approval.

---

## 2. Tone and Register

| Context | Register | Example |
|---|---|---|
| UI labels, table headers | Concise noun phrases | "Asset Owner", "Patch-Status" |
| Button labels | Imperative verb or short noun | "Speichern", "Hochladen", "Bewerten" |
| Help texts, tooltips | Formal, third-person | "Gibt die maximale Zeitdauer an, innerhalb derer…" |
| Empty-state messages | Neutral, no-blame | "Noch keine Einträge vorhanden." |
| Error messages | Factual, no exclamation marks | "Fehler beim Speichern." |
| Confirmation dialogs | Direct question | "Datei wirklich löschen?" |

**German:** Use the formal *Sie* form in any instructional or user-facing text. Never use *du*.

---

## 3. Terminology – Do Not Translate List

The following terms must appear in their **original English form** in all languages, including German:

| Term | Reason |
|---|---|
| Asset | Industry standard; "Objekt" or "Vermögenswert" are not used in ISMS practice |
| Asset Owner | Industry standard role name |
| Dashboard | Universal UI term |
| GDPR (in EN) | Official abbreviation |
| DSGVO (in DE) | Official German abbreviation |
| ISO 27001 | Standard identifier |
| NIS-2 | Official directive name (keep hyphen) |
| TISAX | Registered trademark |
| DORA | Official regulation abbreviation |
| EU AI Act | Official regulation name |
| BSI | Official agency name |
| BSI IT-Grundschutz | Official standard name |
| BSI C5 | Official standard name |
| CVE | Registered identifier system |
| CVSS | Scoring system name |
| CPE | Naming scheme identifier |
| RTO | Standard acronym; always write out in first usage per page |
| RPO | Standard acronym |
| SDO | Standard acronym |
| MTO | Standard acronym |
| BCM | Standard acronym |
| CIA | Acronym for Confidentiality/Integrity/Availability |
| TOM / TOMs | Standard acronym (Technische und organisatorische Maßnahmen) |
| VVT | Standard German acronym for Verzeichnis von Verarbeitungstätigkeiten |
| DPA (as contract) | Standard English abbreviation for Data Processing Agreement |
| AVV (in DE) | Standard German abbreviation for Auftragsverarbeitungsvertrag |
| CISO | Universal role name |
| DPO | Universal role name |
| DPIA | Standard acronym |
| DSFA (in DE) | German acronym for Datenschutz-Folgenabschätzung |

---

## 4. Terminology – Preferred Translations (EN → DE)

| English | German | Notes |
|---|---|---|
| Asset | Asset | Do not translate |
| Risk Assessment | Risikobewertung | |
| Protection Assessment | Schutzbedarfsfeststellung | BSI Grundschutz term |
| Risk Score | Risiko-Score | Hyphenated compound |
| Risk Level | Risikoklasse | Alternatively "Risikoniveau" |
| Risk Treatment | Risikobehandlung | |
| Risk Acceptance | Risikoakzeptanz | |
| Risk Mitigation | Risikominderung | |
| Residual Risk | Restrisiko | |
| Inherent Risk | Ausgangsrisiko | |
| Control | Maßnahme | Not "Kontrolle" in ISMS context |
| Vulnerability | Schwachstelle | |
| Incident | Vorfall | Not "Ereignis" |
| Compliance | Compliance | Do not translate |
| Framework | Framework | Do not translate |
| Policy | Richtlinie | |
| Guideline | Leitfaden | |
| Procedure | Verfahrensanweisung | |
| Certificate | Zertifikat | |
| Vendor | Dienstleister (for service providers) / Hersteller (for manufacturers) | Context-dependent |
| Service Provider | Dienstleister | |
| Supply Chain | Lieferkette | In NIS-2 context |
| Topology | Topologie | |
| Lifecycle | Lebenszyklus | |
| Patch Status | Patch-Status | Hyphenated |
| End of Life (EOL) | End-of-Life (EOL) | Keep English, add hyphen |
| Hardening | Hardening | Do not translate |
| Confidentiality | Vertraulichkeit | CIA context |
| Integrity | Integrität | CIA context |
| Availability | Verfügbarkeit | CIA context |
| Classification | Klassifizierung | |
| Protection Level / Protection Class | Schutzbedarf | BSI term; not "Schutzklasse" |
| Processing Activity | Verarbeitungstätigkeit | GDPR term |
| Data Subject | Betroffene Person | GDPR term |
| Data Subject Request | Betroffenenanfrage | |
| Data Controller | Verantwortlicher | GDPR term |
| Data Processor | Auftragsverarbeiter | GDPR term |
| Data Processing Agreement | Auftragsverarbeitungsvertrag (AVV) | |
| Data Protection Officer | Datenschutzbeauftragter (DSB) | |
| Data Protection Impact Assessment | Datenschutz-Folgenabschätzung (DSFA) | |
| Audit Log | Auditprotokoll | |
| Management Report | Managementbericht | |
| Subject Request | Betroffenenantrag | |
| Data Flow | Datenfluss | |
| Penetration Test | Penetrationstest | |
| Review | Review | "Überprüfung" acceptable in non-technical contexts |
| Dashboard | Dashboard | Do not translate |
| Module | Modul | |
| Role | Rolle | |
| Permission | Berechtigung | |
| Assessment | Bewertung | |
| Assessor | Assessor | Do not translate (role name) |
| Owner | Owner | Do not translate (role name) |
| Viewer | Betrachter | |
| Editor | Bearbeiter | |
| Backup Plan | Backup-Plan | |
| Restore Test | Restore-Test | |
| Not defined | Nicht definiert | |
| Not assessed | Nicht bewertet | |
| Pending | Ausstehend | |
| Active | Aktiv | |
| Inactive | Inaktiv | |
| Archived | Archiviert | |
| Decommissioned | Außer Betrieb | |

---

## 5. Capitalization

### German
- All nouns are capitalised — this is a grammar rule, not a style choice.
- Compound words take the capitalisation of their last element: "Risikoakzeptanz", "Schutzbedarfsfeststellung".
- Acronyms: always fully capitalised: RTO, RPO, CIA, DSGVO.
- Technical/English loan words integrated into German: "das Dashboard" (lowercase article, uppercase noun).

### English
- UI section headers: Title Case ("Protection Assessment", "Risk Register").
- Button labels: Title Case for 2+ words, lowercase for single common verbs is acceptable ("Save", "Cancel", "Upload").
- Table column headers: Title Case.
- Help text and descriptions: Sentence case.
- Empty-state messages: Sentence case.

---

## 6. Abbreviations and Acronyms

- On **first use per page**, write out the full form followed by the abbreviation in parentheses: "Recovery Time Objective (RTO)".
- In **table headers and labels** where space is limited, the abbreviation alone is acceptable.
- In **tooltip text**, always provide the full expansion.
- Do **not** invent new abbreviations not listed in this guide.

---

## 7. Placeholders and Interpolations

i18next uses `{{variable}}` syntax for interpolated values. Rules:

- **Never modify** the variable names inside `{{...}}`. `{{count}}` must remain `{{count}}`.
- **Never remove** a placeholder from a translated string — if the source has `{{count}} entries`, the translation must also contain `{{count}}`.
- Surrounding text may be adapted for grammatical gender and case.
- For German plural forms, use the `_one` / `_other` pattern:
  ```json
  "subtitle_one":   "{{count}} Eintrag",
  "subtitle_other": "{{count}} Einträge"
  ```

---

## 8. Plural Forms

| Key suffix | When used |
|---|---|
| `_one` | Exactly 1 |
| `_other` | 2 or more (also 0 in German) |

German does **not** use a separate zero form — `_other` covers 0 and 2+.

---

## 9. Error and Toast Messages

- Keep short (max 60 characters if possible).
- State the outcome, not the internal error: "Fehler beim Speichern." not "SQL constraint violation."
- Do not end with exclamation marks.
- Positive confirmations may use a past-tense form: "Gespeichert.", "Hochgeladen.", "Gelöscht."

---

## 10. Date and Number Formats

Dates and numbers are formatted by the application code, not by translation strings.

- **Date format (DE):** `dd.MM.yyyy` — handled by `date-fns` with `de` locale.
- **Date format (EN):** `dd/MM/yyyy` or `MMM d, yyyy` — handled by `date-fns` with default locale.
- Do **not** hardcode date formats into translation strings.
- Decimal separator: `.` in code (database/API), locale-formatted in display.

---

## 11. UI Labels – Specific Rules

### Buttons
| English | German | Notes |
|---|---|---|
| Save | Speichern | |
| Cancel | Abbrechen | |
| Delete | Löschen | |
| Edit | Bearbeiten | |
| Create | Anlegen / Erstellen | "Anlegen" for new records; "Erstellen" for more complex creation flows |
| Upload | Hochladen | |
| Download | Herunterladen / Speichern | "Speichern" for download-as-file; "Herunterladen" for explicit file download |
| Back | Zurück | |
| Close | Schließen | |
| Assess | Bewerten | |
| Link | Verknüpfen | |
| Post (comment) | Posten | |
| Reply | Antworten | |

### Status Badges
Status values that appear in badges should reflect the actual meaning, not just the key:

| Key | EN label | DE label |
|---|---|---|
| `active` | Active | Aktiv |
| `inactive` | Inactive | Inaktiv |
| `decommissioned` | Decommissioned | Außer Betrieb |
| `evaluation` | Evaluation | In Evaluierung |
| `production` | Production | Produktion |
| `maintenance` | Maintenance | Wartung |
| `archived` | Archived | Archiviert |
| `compliant` | Compliant | Konform |
| `non_compliant` | Non-compliant | Nicht konform |
| `in_assessment` | In Assessment | In Bewertung |
| `not_assessed` | Not assessed | Nicht bewertet |
| `draft` | Draft | Entwurf |
| `low` | Low | Gering |
| `medium` | Medium | Mittel |
| `high` | High | Hoch |
| `critical` | Critical | Kritisch |

---

## 12. Adding New Locale Strings

### File locations
```
frontend/public/locales/
  en/           ← source language (English)
    assets.json
    risks.json
    ...
  de/           ← German translations
    assets.json
    risks.json
    ...
```

### Workflow
1. **Always add to `en/` first.** The English file is the Crowdin source.
2. Add the German translation to `de/` at the same time.
3. Keys are structured hierarchically with dots: `detail.tabs.basics`.
4. Use `_one` / `_other` suffixes for countable strings.
5. Use `{{variable}}` for dynamic values — document what the variable contains in a comment or the key name.
6. Run `npm run build` in `frontend/` to confirm there are no TypeScript errors from missing keys.
7. Crowdin will auto-detect new keys and create translation tasks for other supported languages.

### Naming conventions
- Namespace per page/feature area: `assets`, `risks`, `incidents`, `compliance`, etc.
- Sub-keys for sections: `detail.*`, `modal.*`, `toast.*`, `table.*`, `form.*`, `filters.*`
- Boolean-style labels: `yn.yes` / `yn.no`
- Plural keys: `subtitle_one` / `subtitle_other`

### Crowdin Glossary
The file `docs/crowdin-glossary.csv` contains the official term glossary. Upload it to Crowdin via **Glossaries → Import Glossary** to enforce consistent terminology across all translators.
