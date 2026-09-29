'use strict';

/**
 * Auswertung des NIS-2-Fragebogens.
 *
 * Zwei Antworten je Frage, unterschiedlich gewichtet — voreingestellt:
 *
 *   Umsetzung  zwei Drittel — ohne die Massnahme gibt es nichts zu belegen.
 *   Nachweis   ein Drittel  — belegen muss man sie trotzdem. Art. 21(1)
 *              verlangt ausdruecklich, die Angemessenheit der Massnahmen
 *              nachweisen zu koennen, und ein Auditor sieht nur, was
 *              dokumentiert ist.
 *
 * Die Gewichte, der Wert von "teilweise" und die Schwellwerte sind
 * einstellbar (services/nis2ScoringModel.js). Wer sein Ergebnis gegen einen
 * externen Bericht halten will, braucht Stellschrauben; wer es in einem Audit
 * vertreten muss, braucht die Angabe, welche eingestellt waren. Beides steht
 * dort.
 *
 * Eine Regel ausserhalb dieser Gewichtung: Ist die Umsetzung 'no', ist die
 * Frage 0 — egal, was in der Nachweisspalte steht. Ein Nachweis fuer eine
 * Massnahme, die es nicht gibt, ist kein Teilerfolg, sondern ein Widerspruch.
 *
 * Nicht beantwortete Fragen zaehlen NICHT als 0, sondern gar nicht. Sonst
 * beginnt jeder Fragebogen bei 0 % und die Quote misst am ersten Tag nur, wie
 * weit das Ausfuellen gediehen ist. Stattdessen wird die Antwortquote getrennt
 * ausgewiesen: Eine Erfuellungsquote von 90 % bei 20 % beantworteten Fragen
 * ist keine gute Nachricht, und das muss man sehen koennen.
 *
 * Die Voreinstellung reproduziert bewusst nicht die Zahl eines bestimmten
 * externen Werkzeugs. Deren Gewichtung ist nicht veroeffentlicht, und der
 * Versuch, sie aus 16 Kategoriewerten zurueckzurechnen, zeigte: Es ist kein
 * gewichtetes Mittel. Das beste erreichbare Modell dieser Form lag im Mittel
 * noch 5 Prozentpunkte daneben, im schlechtesten Fall 14. Naeher herankommen
 * kann man ueber die Einstellungen; exakt treffen nicht. Was hier steht, ist
 * dafuer vollstaendig hergeleitet und laesst sich erklaeren — fuer ein
 * GRC-Werkzeug die wichtigere Eigenschaft.
 */

const { obligationFor } = require('./nis2Applicability');
const { DEFAULT_SCORING, maturityFromRate, statusLabel, scoreAnswers } = require('./nis2ScoringModel');

const ANSWERS = ['not_assessed', 'yes', 'partly', 'no'];

const isAnswered = (item) => item.answer_implementation !== 'not_assessed';

/**
 * Punktwert einer beantworteten Frage, 0 bis 1.
 * Gibt null zurueck, solange die Umsetzung nicht beantwortet ist.
 */
const scoreItem = (item, model = DEFAULT_SCORING) =>
  scoreAnswers(item.answer_implementation, item.answer_evidence, model);

/**
 * Ist diese Frage fuer eine Luecke verantwortlich?
 *
 * Alles unterhalb von "umgesetzt und belegt" ist eine Luecke — mit
 * unterschiedlicher Dringlichkeit. 'open' heisst: nicht umgesetzt.
 * 'partial' heisst: teilweise umgesetzt. 'undocumented' heisst: umgesetzt,
 * aber nicht belegbar — der Befund, den man am billigsten schliesst und am
 * haeufigsten uebersieht.
 */
const gapKind = (item) => {
  if (!isAnswered(item)) return 'unanswered';
  if (item.answer_implementation === 'no') return 'open';
  if (item.answer_implementation === 'partly') return 'partial';
  // Umsetzung 'yes' ab hier.
  if (item.answer_evidence === 'no') return 'undocumented';
  if (item.answer_evidence === 'partly') return 'undocumented';
  return null;
};

const GAP_SEVERITY = { open: 3, partial: 2, undocumented: 1, unanswered: 0 };

/**
 * Vollstaendige Auswertung.
 *
 * @param {Array} items         Fragen samt Antworten
 * @param {string} entityType   Betroffenheitsprofil
 * @param {Array} [measures]    Kriterienkatalog, fuer die Sicht je NIS-2-Element
 * @param {object} [model]      Bewertungsmodell (Gewichte und Schwellwerte)
 */
const summarise = (items, entityType, measures = [], model = DEFAULT_SCORING) => {
  const rows = (items || []).map((i) => (i.toJSON ? i.toJSON() : i));
  const measureRows = (measures || []).map((m) => (m.toJSON ? m.toJSON() : m));

  // Anders als im Kriterienkatalog faellt hier in aller Regel nichts heraus:
  // Es gibt keine dieser 37 Fragen, die man einem Zulieferer nicht stellen
  // sollte. Was sich mit dem Profil aendert, ist die Verbindlichkeit — was
  // eine wesentliche Einrichtung schuldet, wird einem Zulieferer vertraglich
  // durchgereicht oder ist gute Praxis. Deshalb werden 'required' und
  // 'recommended' getrennt ausgewiesen, statt eine Ausnahme zu erfinden. Die
  // Moeglichkeit, eine Frage auszunehmen, bleibt trotzdem: Ein Betrieb kann
  // ihre Anwendbarkeit von Hand auf 'not_applicable' setzen.
  const applicable = [];
  let excludedByProfile = 0;
  let required = 0;
  let recommended = 0;
  for (const item of rows) {
    const obligation = obligationFor(item.applicability, entityType);
    if (obligation === 'not_applicable') { excludedByProfile++; continue; }
    if (obligation === 'required') required++; else recommended++;
    applicable.push(item);
  }

  const answered = applicable.filter(isAnswered);
  const scored = answered.map((item) => ({ item, score: scoreItem(item, model) }));
  const rate = scored.length ? scored.reduce((sum, s) => sum + s.score, 0) / scored.length : 0;

  // ── Kategorien ────────────────────────────────────────────────────────────
  const byCategory = {};
  for (const item of applicable) {
    const key = item.category || 'Ohne Kategorie';
    byCategory[key] ??= { total: 0, answered: 0, sum: 0, gaps: 0, questions: [] };
    const entry = byCategory[key];
    entry.total++;
    entry.questions.push(item.question_ref);
    const score = scoreItem(item, model);
    if (score !== null) { entry.answered++; entry.sum += score; }
    if (gapKind(item) && gapKind(item) !== 'unanswered') entry.gaps++;
  }
  for (const entry of Object.values(byCategory)) {
    const catRate = entry.answered ? entry.sum / entry.answered : 0;
    entry.rate = Math.round(catRate * 100);
    entry.maturity = entry.answered ? maturityFromRate(catRate, model) : null;
    entry.status = entry.answered ? statusLabel(catRate, model) : 'unanswered';
    entry.unanswered = entry.total - entry.answered;
    delete entry.sum;
  }

  // ── Sicht je NIS-2-Element ────────────────────────────────────────────────
  // Der Fragebogen sagt, wo man steht; der Kriterienkatalog sagt, was daraus
  // als Massnahme gefuehrt wird. Nebeneinander gestellt zeigen beide, welche
  // Anforderung noch offen ist — und ob ein Artikel ueberhaupt abgefragt wird.
  const measureByArticle = new Map(measureRows.map((m) => [m.article_ref, m]));
  const byArticle = {};
  for (const item of applicable) {
    const key = item.article_ref;
    byArticle[key] ??= {
      article_ref: key,
      questions: 0,
      answered: 0,
      sum: 0,
      gaps: [],
      measure_status: measureByArticle.get(key)?.implementation_status ?? null,
      measure_title: measureByArticle.get(key)?.title ?? null,
    };
    const entry = byArticle[key];
    entry.questions++;
    const score = scoreItem(item, model);
    if (score !== null) { entry.answered++; entry.sum += score; }
    const kind = gapKind(item);
    if (kind) entry.gaps.push({ question_ref: item.question_ref, kind });
  }
  for (const entry of Object.values(byArticle)) {
    entry.rate = entry.answered ? Math.round((entry.sum / entry.answered) * 100) : null;
    delete entry.sum;
  }
  // Kriterien, zu denen der Fragebogen nichts fragt, gehoeren trotzdem in die
  // Uebersicht — sonst sieht eine Anforderung ohne Frage aus wie eine erfuellte.
  for (const measure of measureRows) {
    if (byArticle[measure.article_ref]) continue;
    if (obligationFor(measure.applicability, entityType) === 'not_applicable') continue;
    byArticle[measure.article_ref] = {
      article_ref: measure.article_ref,
      questions: 0, answered: 0, rate: null, gaps: [],
      measure_status: measure.implementation_status,
      measure_title: measure.title,
    };
  }

  // ── Luecken, nach Dringlichkeit ───────────────────────────────────────────
  const gaps = applicable
    .map((item) => ({ item, kind: gapKind(item) }))
    .filter(({ kind }) => kind && kind !== 'unanswered')
    .sort((a, b) => (GAP_SEVERITY[b.kind] - GAP_SEVERITY[a.kind])
      || (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0))
    .map(({ item, kind }) => ({
      id: item.id,
      question_ref: item.question_ref,
      category: item.category,
      article_ref: item.article_ref,
      question: item.question,
      recommendation: item.recommendation,
      kind,
      answer_implementation: item.answer_implementation,
      answer_evidence: item.answer_evidence,
      task_id: item.task_id ?? null,
      due_date: item.due_date ?? null,
    }));

  const counts = { open: 0, partial: 0, undocumented: 0, unanswered: 0 };
  for (const item of applicable) {
    const kind = gapKind(item);
    if (kind) counts[kind]++;
  }

  return {
    total: rows.length,
    applicable: applicable.length,
    excluded_by_profile: excludedByProfile,
    required,
    recommended,
    answered: answered.length,
    unanswered: applicable.length - answered.length,
    completion: applicable.length ? Math.round((answered.length / applicable.length) * 100) : 0,
    rate: Math.round(rate * 100),
    maturity: answered.length ? maturityFromRate(rate, model) : null,
    status: answered.length ? statusLabel(rate, model) : 'unanswered',
    gap_counts: counts,
    by_category: byCategory,
    by_article: byArticle,
    gaps,
  };
};

module.exports = {
  ANSWERS, scoreItem, gapKind, summarise, isAnswered,
};
