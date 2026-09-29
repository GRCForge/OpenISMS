#!/usr/bin/env node
'use strict';

/**
 * NIS-2-Fragebogen: Bewertung, Lueckenerkennung und Sicht je Element.
 *
 * Die Erfuellungsquote dieses Fragebogens landet in einer Managementbewertung
 * und begruendet, wofuer Budget ausgegeben wird. Drei Wege, auf denen sie
 * luegen koennte, stehen hier:
 *
 *   - Eine unbeantwortete Frage als 0 zu werten. Dann faengt jeder Fragebogen
 *     bei 0 % an und die Quote misst nur den Ausfuellstand.
 *   - Eine fehlende Nachweisangabe als "kein Nachweis" zu werten. Gefragt
 *     wurde noch nicht; das ist keine Antwort.
 *   - "Nicht umgesetzt, aber belegt" als Teilerfolg zu werten. Das ist ein
 *     Widerspruch, kein halber Punkt.
 *
 * Run: node scripts/test-nis2-self-check.js
 */

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const { scoreItem, gapKind, summarise } = require(path.join(SRC, 'services/nis2SelfCheckScoring'));
const catalog = require(path.join(SRC, 'services/nis2SelfCheckCatalog'));
const measureCatalog = require(path.join(SRC, 'services/nis2Catalog'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const ok = (label, condition) => eq(label, !!condition, true);
const near = (label, actual, expected, tol = 0.001) => {
  const good = Math.abs(actual - expected) <= tol;
  if (!good) failures++;
  console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${label}${good ? '' : ` → ${actual}, erwartet ${expected}`}`);
};

const ALL = { essential: 'required', important: 'required', indirect: 'required' };
const q = (impl, evid, extra = {}) => ({
  question_ref: 'qX', category: 'Test', article_ref: 'Art. 21(2)(a)', question: 'f',
  applicability: ALL, answer_implementation: impl, answer_evidence: evid, ...extra,
});

console.log('Katalog:');
eq('37 Fragen', catalog.length, 37);
eq('Fragekennungen eindeutig', new Set(catalog.map(c => c.question_ref)).size, 37);
eq('Sortierreihenfolge eindeutig', new Set(catalog.map(c => c.sort_order)).size, 37);
ok('jede Frage hat eine Empfehlung', catalog.every(c => c.recommendation && c.recommendation.length > 20));
ok('jede Frage hat eine Anwendbarkeit', catalog.every(c => c.applicability));
// Ohne diese Zuordnung gibt es keine Sicht je NIS-2-Element — die Gap-Liste
// haenge dann in der Luft statt an einer Anforderung.
const measureRefs = new Set(measureCatalog.map(m => m.article_ref));
const orphans = catalog.filter(c => !measureRefs.has(c.article_ref)).map(c => `${c.question_ref}:${c.article_ref}`);
eq('jede Frage zeigt auf ein Kriterium des Katalogs', orphans, []);
eq('16 Themen', new Set(catalog.map(c => c.category)).size, 16);
// sort_order und nicht question_ref: 'q10' steht alphabetisch vor 'q2'.
eq('Reihenfolge folgt sort_order, nicht der Kennung',
  catalog.slice(0, 11).map(c => c.question_ref),
  ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11']);

console.log('Punktwert einer Frage:');
eq('umgesetzt und belegt → 1', scoreItem(q('yes', 'yes')), 1);
near('umgesetzt, teilweise belegt', scoreItem(q('yes', 'partly')), 2 / 3 + 1 / 6);
near('umgesetzt, nicht belegt', scoreItem(q('yes', 'no')), 2 / 3);
near('teilweise umgesetzt, belegt', scoreItem(q('partly', 'yes')), 1 / 3 + 1 / 3);
near('beides teilweise → genau die Haelfte', scoreItem(q('partly', 'partly')), 0.5);
// Ein Nachweis fuer eine Massnahme, die es nicht gibt, ist kein halber Punkt.
eq('nicht umgesetzt, aber belegt → 0', scoreItem(q('no', 'yes')), 0);
eq('nicht umgesetzt, nicht belegt → 0', scoreItem(q('no', 'no')), 0);
// Unbeantwortet ist keine Null, sondern keine Antwort.
eq('unbeantwortet → null, nicht 0', scoreItem(q('not_assessed', 'yes')), null);
// Nach dem Nachweis wurde noch nicht gefragt — das darf die Frage nicht
// abwerten, als waere er verneint worden.
eq('Nachweis offen → zaehlt allein die Umsetzung', scoreItem(q('yes', 'not_assessed')), 1);
near('Nachweis offen, Umsetzung teilweise', scoreItem(q('partly', 'not_assessed')), 0.5);

console.log('Art der Luecke:');
eq('nicht umgesetzt → offen', gapKind(q('no', 'no')), 'open');
eq('teilweise umgesetzt → teilweise', gapKind(q('partly', 'yes')), 'partial');
// Der billigste Befund und der am haeufigsten uebersehene: die Massnahme gibt
// es, nur belegen kann sie niemand.
eq('umgesetzt, nicht belegt → nicht dokumentiert', gapKind(q('yes', 'no')), 'undocumented');
eq('umgesetzt, teilweise belegt → nicht dokumentiert', gapKind(q('yes', 'partly')), 'undocumented');
eq('umgesetzt und belegt → keine Luecke', gapKind(q('yes', 'yes')), null);
eq('unbeantwortet → eigene Kategorie', gapKind(q('not_assessed', 'not_assessed')), 'unanswered');

console.log('Auswertung insgesamt:');
const allYes = catalog.map(c => ({ ...c, answer_implementation: 'yes', answer_evidence: 'yes' }));
const allNo = catalog.map(c => ({ ...c, answer_implementation: 'no', answer_evidence: 'no' }));
const untouched = catalog.map(c => ({ ...c, answer_implementation: 'not_assessed', answer_evidence: 'not_assessed' }));

eq('alles erfuellt → 100 %', summarise(allYes, 'essential').rate, 100);
eq('alles erfuellt → Reifegrad 5', summarise(allYes, 'essential').maturity, 5);
eq('alles erfuellt → keine Luecken', summarise(allYes, 'essential').gaps.length, 0);
eq('nichts erfuellt → 0 %', summarise(allNo, 'essential').rate, 0);
eq('nichts erfuellt → 37 offene Luecken', summarise(allNo, 'essential').gap_counts.open, 37);

const fresh = summarise(untouched, 'essential');
// Der wichtigste Einzelfall: Ein frisch geladener Fragebogen darf nicht als
// "0 % erfuellt" dastehen. Er ist unbeantwortet, und das ist etwas anderes.
eq('frischer Fragebogen: Antwortquote 0 %', fresh.completion, 0);
eq('frischer Fragebogen: kein Reifegrad statt Reifegrad 1', fresh.maturity, null);
eq('frischer Fragebogen: Status "unbeantwortet"', fresh.status, 'unanswered');
eq('frischer Fragebogen: 37 offene Fragen', fresh.unanswered, 37);
eq('frischer Fragebogen: keine Luecken gemeldet', fresh.gaps.length, 0);

// Halb ausgefuellt: Die Quote bezieht sich auf das Beantwortete, der
// Ausfuellstand steht daneben. Beides zusammen ist ehrlich, die Quote allein
// waere es nicht.
const halfDone = catalog.map((c, i) => ({
  ...c,
  answer_implementation: i < 10 ? 'yes' : 'not_assessed',
  answer_evidence: i < 10 ? 'yes' : 'not_assessed',
}));
const half = summarise(halfDone, 'essential');
eq('10 von 37 beantwortet → Antwortquote 27 %', half.completion, 27);
eq('und 100 % Erfuellung auf dem Beantworteten', half.rate, 100);
eq('Zahl der offenen Fragen bleibt sichtbar', half.unanswered, 27);

console.log('Betroffenheitsprofil:');
const essential = summarise(allNo, 'essential');
const indirect = summarise(allNo, 'indirect');
eq('wesentliche Einrichtung: alle 37 anwendbar', essential.applicable, 37);
eq('wesentliche Einrichtung: alle 37 verpflichtend', essential.required, 37);
// Anders als beim Kriterienkatalog faellt hier nichts heraus: Es gibt keine
// dieser Fragen, die man einem Zulieferer nicht stellen sollte. Was sich
// aendert, ist die Verbindlichkeit — und genau das muss die Auswertung zeigen,
// statt eine Ausnahme vorzutaeuschen.
eq('indirekt Betroffener: ebenfalls alle 37 anwendbar', indirect.applicable, 37);
ok('aber ein Teil davon nur empfohlen', indirect.recommended > 0);
ok('und entsprechend weniger verpflichtend', indirect.required < essential.required);
eq('verpflichtend plus empfohlen ergibt das Anwendbare', indirect.required + indirect.recommended, indirect.applicable);
eq('Gesamtzahl bleibt sichtbar', indirect.total, 37);
// Eine Frage laesst sich trotzdem ausnehmen — von Hand, nicht durch das Profil.
const handExcluded = catalog.map((c, i) => ({
  ...c,
  applicability: i === 0 ? { essential: 'not_applicable', important: 'not_applicable', indirect: 'not_applicable' } : c.applicability,
  answer_implementation: 'no', answer_evidence: 'no',
}));
eq('von Hand ausgenommene Frage faellt heraus', summarise(handExcluded, 'essential').applicable, 36);
eq('und wird als ausgenommen ausgewiesen', summarise(handExcluded, 'essential').excluded_by_profile, 1);
// Der interne Meldeweg bleibt Pflicht, auch ohne Pflicht gegenueber der
// Behoerde: Wer einen betroffenen Auftraggeber beliefert, muss IHN melden.
const reporting = catalog.filter(c => ['q35', 'q36', 'q37'].includes(c.question_ref));
ok('interner Meldeweg gilt auch fuer indirekt Betroffene',
  reporting.every(c => c.applicability.indirect === 'required'));

console.log('Kategorien:');
const mixed = catalog.map(c => ({
  ...c,
  answer_implementation: c.category === 'Cyberhygiene' ? 'yes' : 'no',
  answer_evidence: c.category === 'Cyberhygiene' ? 'yes' : 'no',
}));
const mixedStats = summarise(mixed, 'essential');
eq('erfuellte Kategorie → 100 %', mixedStats.by_category['Cyberhygiene'].rate, 100);
eq('erfuellte Kategorie → Status gut', mixedStats.by_category['Cyberhygiene'].status, 'good');
eq('leere Kategorie → Status kritisch', mixedStats.by_category['Kryptografie'].status, 'critical');
ok('jede Kategorie traegt Quote, Reifegrad und Lueckenzahl',
  Object.values(mixedStats.by_category).every(c => typeof c.rate === 'number' && typeof c.gaps === 'number'));

console.log('Sicht je NIS-2-Element:');
const withMeasures = summarise(allNo, 'essential', measureCatalog.map(m => ({ ...m, implementation_status: 'not_started' })));
ok('Elemente werden ausgewiesen', Object.keys(withMeasures.by_article).length > 10);
ok('der Massnahmenstatus steht daneben',
  Object.values(withMeasures.by_article).every(a => a.measure_status !== undefined));
// Art. 23(4) (Abschlussbericht) steht im Kriterienkatalog, wird vom Fragebogen
// aber nicht abgefragt. Fehlte das Element hier, saehe eine ungepruefte
// Anforderung aus wie eine erfuellte.
ok('ein Kriterium ohne Frage erscheint trotzdem', !!withMeasures.by_article['Art. 23(4)']);
eq('und zwar mit null Fragen', withMeasures.by_article['Art. 23(4)'].questions, 0);
eq('Art. 21(2)(a) buendelt vier Fragen', withMeasures.by_article['Art. 21(2)(a)'].questions, 4);

console.log('Reihenfolge der Luecken:');
const priorities = catalog.map((c, i) => ({
  ...c,
  answer_implementation: i === 0 ? 'yes' : i === 1 ? 'partly' : i === 2 ? 'no' : 'yes',
  answer_evidence: i === 0 ? 'no' : i === 1 ? 'yes' : i === 2 ? 'yes' : 'yes',
}));
const ordered = summarise(priorities, 'essential').gaps;
// Was fehlt, wiegt schwerer als was nur nicht aufgeschrieben ist.
eq('nicht umgesetzt steht vorn', ordered[0].kind, 'open');
eq('danach teilweise umgesetzt', ordered[1].kind, 'partial');
eq('zuletzt das Nichtdokumentierte', ordered[2].kind, 'undocumented');
ok('jede Luecke traegt ihre Empfehlung mit', ordered.every(g => g.recommendation));

console.log('Randfaelle:');
const empty = summarise([], 'essential');
eq('leerer Fragebogen: keine Division durch null', empty.rate, 0);
eq('leerer Fragebogen: kein Reifegrad', empty.maturity, null);
eq('leerer Fragebogen: Antwortquote 0', empty.completion, 0);
eq('unbekanntes Profil rechnet wie wesentlich',
  summarise(allNo, 'irgendwas').applicable, essential.applicable);

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
