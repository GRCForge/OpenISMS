'use strict';

/**
 * Fragenkatalog fuer die NIS-2-Standortbestimmung.
 *
 * Der Kriterienkatalog (nis2Catalog.js) fuehrt die Pflichten. Dieser Katalog
 * fragt sie ab — in der Form, in der ein Erstaudit oder ein externer Self-Check
 * sie stellt, und mit derselben Aufteilung in 16 Themen. Jede Frage traegt die
 * Artikelreferenz, unter der sie im Kriterienkatalog wieder auftaucht; darueber
 * entsteht die Gap-Liste je NIS-2-Element.
 *
 * Zwei Antworten je Frage, und das ist der Kern:
 *
 *   Umsetzung  Ist die Massnahme da?
 *   Nachweis   Koennen wir sie belegen?
 *
 * "Machen wir, hat nur nie jemand aufgeschrieben" ist der haeufigste Befund
 * eines Erstaudits. Er faellt nur auf, wenn beide Achsen getrennt erfasst
 * werden — und er ist ein echter Mangel, weil NIS-2 die Nachweisfuehrung
 * ausdruecklich verlangt (Art. 21(1): "geeignete und verhaeltnismaessige
 * Massnahmen … nachweisen").
 *
 * question_ref (q1 … q37) ist stabil. Ein anderswo erhobener Antwortsatz mit
 * denselben Kennungen laesst sich darueber importieren, ohne ihn von Hand
 * zuzuordnen.
 *
 * applicability folgt derselben Logik wie im Kriterienkatalog. Eine Feinheit:
 * Die Meldepflichten aus Art. 23 gelten fuer indirekt Betroffene NICHT
 * gegenueber der Behoerde — die zugehoerigen Kriterien stehen dort deshalb auf
 * 'not_applicable'. Die Fragen q35 bis q37 zielen aber auf den INTERNEN
 * Meldeweg und die Information von Kunden und Partnern, und genau das schuldet
 * ein Zulieferer seinem betroffenen Auftraggeber vertraglich. Sie bleiben
 * deshalb 'required'.
 */

const ALL = { essential: 'required', important: 'required', indirect: 'required' };
const DIRECT_ONLY = { essential: 'required', important: 'required', indirect: 'recommended' };

const catalog = [
  // ── Governance (Art. 20) ───────────────────────────────────────────────────
  {
    question_ref: 'q1', category: 'Governance', article_ref: 'Art. 20(1)',
    question: 'Kennt die Geschaeftsleitung die Massnahmen zum Management von Cybersicherheitsrisiken und hat sie diese formal gebilligt?',
    recommendation: 'Massnahmenkatalog der Leitung vorlegen und die Freigabe protokollieren — Beschlussvorlage, Protokoll oder unterzeichnete Leitlinie. Ohne dokumentierte Billigung greift die persoenliche Haftung aus Art. 20(1) ins Leere.',
    applicability: DIRECT_ONLY,
  },
  {
    question_ref: 'q2', category: 'Governance', article_ref: 'Art. 20(1)',
    question: 'Entscheidet die Geschaeftsleitung aktiv ueber IT-Sicherheit — etwa ueber Budget, Prioritaeten und einzelne Massnahmen?',
    recommendation: 'Informationssicherheit als festen Tagesordnungspunkt in der Leitungsrunde verankern und die Entscheidungen zentral ablegen. Ein Budgetbeschluss und ein Protokoll sind der belastbarste Nachweis fuer aktive Steuerung.',
    applicability: DIRECT_ONLY,
  },
  {
    question_ref: 'q3', category: 'Governance', article_ref: 'Art. 20(2)',
    question: 'Verfuegen die Mitglieder der Leitungsorgane ueber ausreichende Kenntnisse, um Cyberrisiken beurteilen zu koennen, und ist das nachgewiesen?',
    recommendation: 'Schulung fuer die Leitungsebene ansetzen und Teilnahme, Inhalt und Datum festhalten. Art. 20(2) verlangt die Schulung ausdruecklich; eine Teilnahmebestaetigung genuegt als Nachweis.',
    applicability: DIRECT_ONLY,
  },

  // ── Risikoanalyse (Art. 21(2)(a)) ──────────────────────────────────────────
  {
    question_ref: 'q4', category: 'Risikoanalyse', article_ref: 'Art. 21(2)(a)',
    question: 'Wurden Cyberrisiken systematisch erhoben, analysiert und bewertet — nach einem nachvollziehbaren Verfahren?',
    recommendation: 'Risikoanalyse nach einem anerkannten Verfahren durchfuehren (ISO 27005 oder BSI 200-3) und im Risikoregister fuehren. Das Modul Risiken bildet Wahrscheinlichkeit x Auswirkung bereits ab.',
    applicability: ALL,
  },
  {
    question_ref: 'q5', category: 'Risikoanalyse', article_ref: 'Art. 21(2)(a)',
    question: 'Werden die Risiken regelmaessig und zusaetzlich bei wesentlichen Veraenderungen erneut geprueft?',
    recommendation: 'Review-Turnus verbindlich festlegen (mindestens jaehrlich) und Termine samt Verantwortlichen hinterlegen. Ein Anlass wie eine neue Anwendung oder ein Dienstleisterwechsel muss die Pruefung ebenfalls ausloesen.',
    applicability: ALL,
  },

  // ── Risikobehandlung (Art. 21(2)(a)) ───────────────────────────────────────
  {
    question_ref: 'q6', category: 'Risikobehandlung', article_ref: 'Art. 21(2)(a)',
    question: 'Werden erkannte Risiken aktiv behandelt — durch Massnahmen, bewusste Akzeptanz oder Transfer — und ist die Entscheidung dokumentiert?',
    recommendation: 'Je Risiko eine Behandlungsentscheidung treffen und begruenden. Akzeptanzen brauchen eine Freigabe mit Namen und Befristung; das Risikomodul unterstuetzt den Sign-off bereits.',
    applicability: ALL,
  },

  // ── Bedrohungsanalyse (Art. 21(2)(a)) ──────────────────────────────────────
  {
    question_ref: 'q7', category: 'Bedrohungsanalyse', article_ref: 'Art. 21(2)(a)',
    question: 'Werden aktuelle Cyberbedrohungen regelmaessig verfolgt und bewertet — insbesondere Warnmeldungen der nationalen Cybersicherheitsbehoerde beziehungsweise des nationalen CSIRT sowie einschlaegige Sicherheitsnews?',
    recommendation: 'Quellen im Modul Bedrohungslage eintragen, Turnus und Verantwortliche festlegen und jede Durchsicht dort festhalten. Das nationale CSIRT gehoert zwingend dazu; die Bewertung jeder Meldung und ihre Ueberfuehrung in Risiko oder Aufgabe ist der Nachweis.',
    applicability: ALL,
  },

  // ── Incident Response (Art. 21(2)(b)) ──────────────────────────────────────
  {
    question_ref: 'q8', category: 'Incident Response', article_ref: 'Art. 21(2)(b)',
    question: 'Gibt es ein festgelegtes Vorgehen fuer IT-Sicherheitsvorfaelle — wer reagiert, in welcher Reihenfolge, mit welchen Befugnissen?',
    recommendation: 'Vorfallplan schriftlich fassen: Rollen, Erreichbarkeiten, Erstmassnahmen, Eskalationsstufen. Ein Plan, der nur in Koepfen existiert, faellt im Ernstfall genau dann aus, wenn die Koepfe fehlen.',
    applicability: ALL,
  },
  {
    question_ref: 'q9', category: 'Incident Response', article_ref: 'Art. 21(2)(b)',
    question: 'Existiert ein definierter Prozess zur Ersteinstufung, Priorisierung und Eskalation von Vorfaellen?',
    recommendation: 'Triage-Kriterien und Schweregrade festlegen und an Eskalationsstufen koppeln. Ohne verbindliche Einstufung entscheidet im Ernstfall der Zufall, welcher Vorfall zuerst bearbeitet wird.',
    applicability: ALL,
  },
  {
    question_ref: 'q10', category: 'Incident Response', article_ref: 'Art. 21(2)(b)',
    question: 'Wurde der Vorfallplan bereits geuebt oder im Ernstfall angewendet, und wurde das Ergebnis ausgewertet?',
    recommendation: 'Mindestens jaehrlich eine Uebung ansetzen — ein Planspiel am Tisch genuegt fuer den Anfang — und die Erkenntnisse protokollieren. Ein ungeuebter Plan ist eine Annahme, kein Verfahren.',
    applicability: ALL,
  },
  {
    question_ref: 'q11', category: 'Incident Response', article_ref: 'Art. 21(2)(b)',
    question: 'Werden sicherheitsrelevante Ereignisse systematisch protokolliert und ueberwacht — Zugriffe, Aenderungen, Ausfaelle?',
    recommendation: 'Zentrale Protokollierung der wichtigen Systeme einrichten, Aufbewahrungsfrist festlegen und die Auswertung jemandem zuweisen. Protokolle, die niemand ansieht, belegen nur, dass protokolliert wurde.',
    applicability: ALL,
  },

  // ── Notfallmanagement (Art. 21(2)(c)) ──────────────────────────────────────
  {
    question_ref: 'q12', category: 'Notfallmanagement', article_ref: 'Art. 21(2)(c)',
    question: 'Werden die Plaene fuer Betriebsfortfuehrung und Wiederherstellung regelmaessig getestet?',
    recommendation: 'Testplan mit Turnus aufstellen und jeden Test mit Datum, Umfang und Ergebnis dokumentieren. Ein Wiederherstellungsplan ohne Test ist eine Hoffnung.',
    applicability: DIRECT_ONLY,
  },
  {
    question_ref: 'q13', category: 'Notfallmanagement', article_ref: 'Art. 21(2)(c)',
    question: 'Sind die besonders wichtigen Geschaeftsprozesse identifiziert, deren Verfuegbarkeit gesichert sein muss?',
    recommendation: 'Auswirkungsanalyse mit den Fachbereichen durchfuehren und je Prozess Wiederanlaufzeit und Datenverlusttoleranz festlegen. Das BCM-Modul verknuepft Prozesse bereits mit Assets.',
    applicability: DIRECT_ONLY,
  },
  {
    question_ref: 'q14', category: 'Notfallmanagement', article_ref: 'Art. 21(2)(c)',
    question: 'Gibt es ein Konzept dafuer, wie im Krisenfall kommuniziert, koordiniert und entschieden wird?',
    recommendation: 'Krisenstab benennen, Entscheidungswege und Erreichbarkeiten festhalten, Vorlagen fuer die Kommunikation vorbereiten — auch fuer den Fall, dass die eigene IT nicht zur Verfuegung steht.',
    applicability: DIRECT_ONLY,
  },
  {
    question_ref: 'q15', category: 'Notfallmanagement', article_ref: 'Art. 21(2)(c)',
    question: 'Werden Datensicherungen regelmaessig erstellt, auf Wiederherstellbarkeit geprueft und getrennt aufbewahrt?',
    recommendation: 'Backup-Richtlinie mit Frequenz, Aufbewahrung, getrennter Lagerung und Rueckspieltests festschreiben. Ein Backup zaehlt erst, wenn eine Rueckspielung nachweislich funktioniert hat.',
    applicability: ALL,
  },

  // ── Lieferkettensicherheit (Art. 21(2)(d), 21(3)) ──────────────────────────
  {
    question_ref: 'q16', category: 'Lieferkettensicherheit', article_ref: 'Art. 21(2)(d)',
    question: 'Werden IT-Dienstleister nach Sicherheitsgesichtspunkten bewertet und nach ihrer Kritikalitaet eingestuft?',
    recommendation: 'Kritikalitaetsstufen definieren und je Dienstleister eine Sicherheitsbewertung hinterlegen. Das Dienstleistermodul mit Triage bildet das ab; kritische Anbieter brauchen eine eigene Risikobetrachtung.',
    applicability: ALL,
  },
  {
    question_ref: 'q17', category: 'Lieferkettensicherheit', article_ref: 'Art. 21(2)(d)',
    question: 'Werden Sicherheitsanforderungen vertraglich mit externen Partnern vereinbart?',
    recommendation: 'Standardklauseln erstellen: Meldepflicht bei Vorfaellen, Auskunfts- und Auditrechte, Subunternehmer, Rueckgabe und Loeschung von Daten. Einmal formuliert, wandern sie in jeden neuen Vertrag.',
    applicability: ALL,
  },

  // ── Systemhaertung (Art. 21(2)(e)) ─────────────────────────────────────────
  {
    question_ref: 'q18', category: 'Systemhaertung', article_ref: 'Art. 21(2)(e)',
    question: 'Werden bei der Beschaffung von IT Sicherheitsanforderungen beruecksichtigt — etwa Standardpasswoerter, Update-Faehigkeit, Supportzeitraum?',
    recommendation: 'Kurze Sicherheitscheckliste fuer Beschaffungen erstellen und verbindlich machen. Der guenstigste Zeitpunkt, eine Anforderung durchzusetzen, ist vor dem Kauf.',
    applicability: ALL,
  },
  {
    question_ref: 'q19', category: 'Systemhaertung', article_ref: 'Art. 21(2)(e)',
    question: 'Gibt es ein Verfahren, um Schwachstellen zu erkennen und zu beheben?',
    recommendation: 'Schwachstellenprozess festlegen: Quelle, Bewertung, Fristen je Schweregrad, Verantwortliche. Der CVE-Abgleich im Asset-Register und das Modul Bedrohungslage liefern die Eingangsseite.',
    applicability: ALL,
  },
  {
    question_ref: 'q20', category: 'Systemhaertung', article_ref: 'Art. 21(2)(e)',
    question: 'Werden sichere Entwicklungspraktiken eingehalten, wo selbst entwickelt wird — Trennung von Umgebungen, Codepruefung, Abhaengigkeitspflege?',
    recommendation: 'Entwicklungsvorgaben schriftlich festhalten und in die Pipeline bringen: getrennte Umgebungen, Vier-Augen-Prinzip, automatisierte Abhaengigkeitspruefung.',
    applicability: ALL,
  },
  {
    question_ref: 'q21', category: 'Systemhaertung', article_ref: 'Art. 21(2)(e)',
    question: 'Werden sicherheitsrelevante Aktualisierungen zeitnah eingespielt, und ist das nachvollziehbar?',
    recommendation: 'Patch-Richtlinie mit Fristen je Schweregrad und Eskalation bei Ueberschreitung einfuehren. Ausnahmen begruenden und befristen, statt sie unausgesprochen zu lassen.',
    applicability: ALL,
  },

  // ── Kontrolle & Bewertung (Art. 21(2)(f)) ──────────────────────────────────
  {
    question_ref: 'q22', category: 'Kontrolle & Bewertung', article_ref: 'Art. 21(2)(f)',
    question: 'Sind Kennzahlen fuer die Wirksamkeit der Sicherheitsmassnahmen definiert, und werden sie regelmaessig ausgewertet?',
    recommendation: 'Eine Handvoll aussagefaehiger Kennzahlen genuegt zum Start — Patchstand, offene kritische Risiken, Schulungsquote, Zeit bis zur Vorfallbearbeitung. Wichtiger als die Menge ist, dass sie regelmaessig besprochen werden.',
    applicability: DIRECT_ONLY,
  },
  {
    question_ref: 'q23', category: 'Kontrolle & Bewertung', article_ref: 'Art. 21(2)(f)',
    question: 'Werden interne und externe Pruefungen durchgefuehrt, einschliesslich technischer Tests wie Penetrationstests?',
    recommendation: 'Pruefplan ueber das Jahr aufstellen: interne Stichproben, mindestens ein externer Blick, technische Tests fuer exponierte Systeme. Ergebnisse und Massnahmen nachhalten.',
    applicability: DIRECT_ONLY,
  },

  // ── Cyberhygiene (Art. 21(2)(g)) ───────────────────────────────────────────
  {
    question_ref: 'q24', category: 'Cyberhygiene', article_ref: 'Art. 21(2)(g)',
    question: 'Werden Beschaeftigte regelmaessig fuer den sicheren Umgang mit IT sensibilisiert oder geschult?',
    recommendation: 'Schulung mit festem Turnus aufsetzen und Teilnehmer, Inhalt und Wiederholungstermin dokumentieren. Neueintritte brauchen die Schulung vor dem ersten Zugriff, nicht irgendwann danach.',
    applicability: ALL,
  },
  {
    question_ref: 'q25', category: 'Cyberhygiene', article_ref: 'Art. 21(2)(g)',
    question: 'Gibt es verbindliche Grundregeln zur IT-Nutzung — Umgang mit E-Mail, Passwoertern, mobilen Geraeten?',
    recommendation: 'Kurze, lesbare Nutzungsrichtlinie erstellen, zentral bereitstellen und die Kenntnisnahme erfassen. Zwei Seiten, die gelesen werden, schlagen zwanzig, die abgelegt werden.',
    applicability: ALL,
  },

  // ── Kryptografie (Art. 21(2)(h)) ───────────────────────────────────────────
  {
    question_ref: 'q26', category: 'Kryptografie', article_ref: 'Art. 21(2)(h)',
    question: 'Werden vertrauliche Daten nach einer definierten Vorgabe verschluesselt — bei Uebertragung und Speicherung?',
    recommendation: 'Verschluesselungsvorgabe je Schutzklasse festlegen und an die Klassifizierung im Asset-Register koppeln. Ohne Bezug zur Klassifizierung bleibt die Vorgabe eine Absichtserklaerung.',
    applicability: ALL,
  },
  {
    question_ref: 'q27', category: 'Kryptografie', article_ref: 'Art. 21(2)(h)',
    question: 'Gibt es eine Regelung zur Schluesselverwaltung — Erzeugung, Verteilung, Wechsel, Widerruf?',
    recommendation: 'Schluessellebenszyklus schriftlich regeln und Zustaendigkeiten benennen. Der Widerruf ist der Teil, der am haeufigsten fehlt und im Ernstfall am meisten kostet.',
    applicability: ALL,
  },

  // ── Zugriff & Assets (Art. 21(2)(i)) ───────────────────────────────────────
  {
    question_ref: 'q28', category: 'Zugriff & Assets', article_ref: 'Art. 21(2)(i)',
    question: 'Gibt es einen geregelten Prozess fuer Einrichtung, Aenderung und Entzug von Zugriffsrechten?',
    recommendation: 'Rollenmodell und Berechtigungsprozess festlegen, insbesondere den Entzug beim Austritt. Eine regelmaessige Rezertifizierung deckt auf, was sich angesammelt hat.',
    applicability: ALL,
  },
  {
    question_ref: 'q29', category: 'Zugriff & Assets', article_ref: 'Art. 21(2)(i)',
    question: 'Sind alle IT-Systeme und Geraete inventarisiert — einschliesslich Cloud-Diensten und mobilen Geraeten?',
    recommendation: 'Inventar vervollstaendigen und einen Verantwortlichen je Asset benennen. Netzwerk-Erkennung und CheckMK-Anbindung fuellen den technischen Teil; Cloud-Dienste und Schatten-IT muessen erfragt werden.',
    applicability: ALL,
  },
  {
    question_ref: 'q30', category: 'Zugriff & Assets', article_ref: 'Art. 21(2)(i)',
    question: 'Gibt es Regeln fuer den Umgang mit externen Datentraegern?',
    recommendation: 'Vorgabe formulieren und technisch flankieren — Sperrung, Verschluesselungszwang oder Freigabe im Einzelfall. Eine Regel ohne technische Stuetze wird im Alltag umgangen.',
    applicability: ALL,
  },

  // ── Authentifizierung & Kommunikation (Art. 21(2)(j)) ──────────────────────
  {
    question_ref: 'q31', category: 'Authentifizierung & Kommunikation', article_ref: 'Art. 21(2)(j)',
    question: 'Wird Mehrfaktor-Authentifizierung fuer sensible Zugaenge eingesetzt — administrativ, extern, Cloud?',
    recommendation: 'Mehrfaktor zuerst fuer administrative und von aussen erreichbare Zugaenge durchsetzen, danach flaechig. Die eingesetzten Verfahren und die abgedeckten Gruppen dokumentieren.',
    applicability: ALL,
  },
  {
    question_ref: 'q32', category: 'Authentifizierung & Kommunikation', article_ref: 'Art. 21(2)(j)',
    question: 'Werden gesicherte Kommunikationswege genutzt — etwa VPN fuer Fernzugriffe und Verschluesselung fuer sensible Nachrichten?',
    recommendation: 'Fernzugriff ausschliesslich ueber gesicherte Kanaele zulassen und die Verschluesselung sensibler Kommunikation verbindlich regeln. Die Konfiguration als Nachweis festhalten.',
    applicability: ALL,
  },

  // ── Lieferkette: Bewertung der Praxis (Art. 21(3)) ─────────────────────────
  {
    question_ref: 'q33', category: 'Lieferkettensicherheit', article_ref: 'Art. 21(3)',
    question: 'Wird die Sicherheitspraxis der Dienstleister aktiv geprueft — etwa ueber Zertifikate, Berichte oder eigene Audits?',
    recommendation: 'Je nach Kritikalitaet Nachweise einfordern: Zertifikat, Pruefbericht, ausgefuellter Fragebogen oder Audit. Eingang, Gueltigkeit und Bewertung im Dienstleisterregister festhalten.',
    applicability: ALL,
  },

  // ── Korrekturmassnahmen (Art. 21(4)) ───────────────────────────────────────
  {
    question_ref: 'q34', category: 'Korrekturmassnahmen', article_ref: 'Art. 21(4)',
    question: 'Gibt es ein Verfahren, um festgestellte Sicherheitsmaengel zu erfassen und abzustellen?',
    recommendation: 'Korrekturmassnahmen an einer Stelle fuehren — mit Verantwortlichem, Frist und Status — und den Abschluss pruefen. Art. 21(4) verlangt unverzuegliches Handeln bei Nichteinhaltung; das setzt voraus, dass die Maengel ueberhaupt gesammelt werden.',
    applicability: DIRECT_ONLY,
  },

  // ── Meldepflicht intern (Art. 23(1)) ───────────────────────────────────────
  // Auch fuer indirekt Betroffene 'required': Gegenueber der Behoerde besteht
  // keine Pflicht, gegenueber dem betroffenen Auftraggeber sehr wohl — und die
  // braucht denselben internen Meldeweg.
  {
    question_ref: 'q35', category: 'Meldepflicht intern', article_ref: 'Art. 23(1)',
    question: 'Ist intern geregelt, wer Vorfaelle meldet, auf welchem Weg und in welcher Frist?',
    recommendation: 'Meldeweg schriftlich festlegen und an die gesetzlichen Fristen koppeln: Fruehwarnung binnen 24 Stunden, Meldung binnen 72 Stunden, Abschlussbericht binnen eines Monats. Wer nur indirekt betroffen ist, koppelt ihn an die vertraglichen Fristen des Auftraggebers.',
    applicability: ALL,
  },
  {
    question_ref: 'q36', category: 'Meldepflicht intern', article_ref: 'Art. 23(1)',
    question: 'Gibt es eine benannte Stelle oder Person, an die Vorfaelle gemeldet werden?',
    recommendation: 'Ansprechstelle benennen, Erreichbarkeit auch ausserhalb der Geschaeftszeiten regeln und beides bekannt machen. Eine Meldestelle, die niemand kennt, verlaengert jede Reaktionszeit.',
    applicability: ALL,
  },

  // ── Kunden-/Partnerinformation (Art. 23(2)) ────────────────────────────────
  {
    question_ref: 'q37', category: 'Kunden-/Partnerinformation', article_ref: 'Art. 23(2)',
    question: 'Ist geregelt, wie Kunden und Partner bei einem erheblichen Vorfall informiert werden?',
    recommendation: 'Informationswege, Zustaendigkeiten und Textbausteine vorbereiten. Unter Zeitdruck wird formuliert, was vorbereitet ist — und nur das ist mit der Rechtsabteilung abgestimmt.',
    applicability: ALL,
  },
];

// sort_order haelt die Reihenfolge des Fragebogens fest. Nach question_ref zu
// sortieren waere falsch: 'q10' steht alphabetisch vor 'q2'.
catalog.forEach((item, index) => { item.sort_order = index + 1; });

module.exports = catalog;
