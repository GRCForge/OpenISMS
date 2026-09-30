#!/usr/bin/env node
'use strict';

/**
 * NIS-2-Kriterienkatalog: Anwendbarkeit nach Betroffenheitsprofil.
 *
 * Die Erfuellungsquote ist die Zahl, die in einer Managementbewertung landet.
 * Wenn sie Kriterien mitzaehlt, die fuer die eigene Einstufung gar nicht gelten,
 * misst sie das Falsche — und zwar dauerhaft nach unten: Ein Zulieferer, der
 * nicht selbst im Anwendungsbereich liegt, kann die 24-Stunden-Fruehwarnung ans
 * CSIRT nicht leisten, weil er sie nicht schuldet.
 *
 * Geprueft wird deshalb vor allem, was NICHT mitzaehlt.
 *
 * Run: node scripts/test-nis2-applicability.js
 */

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const {
  PROFILES, OBLIGATIONS, DEFAULT_APPLICABILITY,
  normaliseApplicability, obligationFor, summarise, maturityFromRate,
} = require(path.join(SRC, 'services/nis2Applicability'));
const catalog = require(path.join(SRC, 'services/nis2Catalog'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const ok = (label, condition) => eq(label, !!condition, true);

console.log('Katalog:');
ok('Katalog ist nicht leer', catalog.length > 0);
eq('jede Artikelreferenz kommt nur einmal vor', catalog.length, new Set(catalog.map(c => c.article_ref)).size);
eq('jedes Kriterium hat eine Anwendbarkeit', catalog.filter(c => !c.applicability).length, 0);
for (const c of catalog) {
  const bad = Object.entries(c.applicability).filter(([k, v]) => !['essential', 'important', 'indirect'].includes(k) || !OBLIGATIONS.includes(v));
  if (bad.length) { failures++; console.log(`  FAIL  ${c.article_ref} hat unbekannte Werte: ${JSON.stringify(bad)}`); }
}
ok('Anwendbarkeiten des Katalogs sind gueltig', true);

// Die Fragen des ueblichen NIS-2-Self-Checks verteilen sich auf diese Artikel.
// Fehlt einer im Katalog, laesst sich ein externes Ergebnis nicht gegen das
// ISMS halten — und genau dafuer ist der Katalog da.
console.log('Abdeckung der im Self-Check abgefragten Artikel:');
const refs = new Set(catalog.map(c => c.article_ref));
for (const ref of ['Art. 20(1)', 'Art. 20(2)', 'Art. 21(2)(a)', 'Art. 21(2)(b)', 'Art. 21(2)(c)',
  'Art. 21(2)(d)', 'Art. 21(2)(e)', 'Art. 21(2)(f)', 'Art. 21(2)(g)', 'Art. 21(2)(h)',
  'Art. 21(2)(i)', 'Art. 21(2)(j)', 'Art. 21(3)', 'Art. 21(4)', 'Art. 23(1)', 'Art. 23(2)']) {
  ok(`${ref} im Katalog`, refs.has(ref));
}

console.log('Normalisierung fremder Eingaben:');
eq('null ergibt die Voreinstellung', normaliseApplicability(null), DEFAULT_APPLICABILITY);
eq('unbekannter Wert faellt auf die Voreinstellung zurueck',
  normaliseApplicability({ essential: 'vielleicht' }).essential, 'required');
eq('gueltiger Wert bleibt', normaliseApplicability({ indirect: 'not_applicable' }).indirect, 'not_applicable');
// Ein Client, der __proto__ oder zusaetzliche Schluessel mitschickt, darf nicht
// mehr erreichen als die drei bekannten Profile.
eq('fremde Schluessel werden verworfen', Object.keys(normaliseApplicability({ admin: 'required', __proto__: { x: 1 } })), ['essential', 'important', 'indirect']);
eq('Array ergibt die Voreinstellung', normaliseApplicability(['required']), DEFAULT_APPLICABILITY);

console.log('Pflicht je Profil:');
const meldepflicht = catalog.find(c => c.article_ref === 'Art. 23(1)');
eq('wesentliche Einrichtung schuldet die Fruehwarnung', obligationFor(meldepflicht.applicability, 'essential'), 'required');
eq('wichtige Einrichtung ebenso', obligationFor(meldepflicht.applicability, 'important'), 'required');
// Kern der Anforderung: Wer nicht selbst im Anwendungsbereich liegt, meldet
// nicht an die Behoerde, sondern vertraglich an seinen Auftraggeber.
eq('indirekt Betroffener schuldet sie nicht', obligationFor(meldepflicht.applicability, 'indirect'), 'not_applicable');
// Nicht eingestuft rechnet wie wesentlich — lieber zu viel pruefen als eine
// Pflicht uebersehen, die man hat.
eq('ohne Einstufung gilt der volle Katalog', obligationFor(meldepflicht.applicability, 'unknown'), 'required');
eq('unbekanntes Profil ebenso', obligationFor(meldepflicht.applicability, 'irgendwas'), 'required');

const lieferkette = catalog.find(c => c.article_ref === 'Art. 21(2)(d) ff.');
ok('es gibt ein Kriterium, das nur indirekt Betroffene schulden',
  obligationFor(lieferkette.applicability, 'indirect') === 'required'
  && obligationFor(lieferkette.applicability, 'essential') === 'recommended');

console.log('Erfuellungsquote:');
const alleOffen = catalog.map(c => ({ ...c, implementation_status: 'not_started' }));
const alleFertig = catalog.map(c => ({ ...c, implementation_status: 'implemented' }));

eq('alles offen → 0 %', summarise(alleOffen, 'essential').rate, 0);
eq('alles umgesetzt → 100 %', summarise(alleFertig, 'essential').rate, 100);
eq('alles umgesetzt → Reifegrad 5', summarise(alleFertig, 'essential').maturity, 5);

const essential = summarise(alleOffen, 'essential');
const indirect = summarise(alleOffen, 'indirect');
eq('wesentliche Einrichtung: nichts ausgeschlossen', essential.excluded_by_profile, 0);
ok('indirekt Betroffener: Meldepflichten fallen heraus', indirect.excluded_by_profile >= 3);
ok('indirekt Betroffener hat weniger anwendbare Kriterien', indirect.applicable < essential.applicable);
eq('Gesamtzahl bleibt sichtbar', indirect.total, catalog.length);

// Der eigentliche Fehler, den diese Unterscheidung verhindert: Ein indirekt
// Betroffener, der alles Anwendbare umgesetzt hat, muss 100 % erreichen — nicht
// 83 %, weil drei Meldepflichten offen stehen, die er nicht schuldet.
const indirectFertig = summarise(
  catalog.map(c => ({
    ...c,
    implementation_status: obligationFor(c.applicability, 'indirect') === 'not_applicable' ? 'not_started' : 'implemented',
  })),
  'indirect',
);
eq('alles Anwendbare umgesetzt → 100 %, trotz offener Meldepflichten', indirectFertig.rate, 100);

// Angefangenes zaehlt halb: als "nicht erfuellt" waere jede Zwischenmessung
// wertlos, voll gezaehlt waere die Quote geschoent.
eq('alles in Arbeit → 50 %', summarise(catalog.map(c => ({ ...c, implementation_status: 'in_progress' })), 'essential').rate, 50);

// Von Hand auf "nicht anwendbar" gesetzt sticht die Voreinstellung des
// Katalogs — die Entscheidung eines Menschen ueber den eigenen Betrieb gilt.
const handAusgenommen = summarise(
  alleFertig.map((c, i) => (i === 0 ? { ...c, implementation_status: 'not_applicable' } : c)),
  'essential',
);
eq('manuell ausgenommenes Kriterium zaehlt nicht mit', handAusgenommen.excluded_manually, 1);
eq('und senkt die Quote nicht', handAusgenommen.rate, 100);

console.log('Ober- und Unterkriterien:');
const tops = catalog.filter(c => !c.parent_ref);
const subs = catalog.filter(c => c.parent_ref);
ok('der Katalog hat Unterkriterien', subs.length > 50);
eq('jedes Unterkriterium zeigt auf ein vorhandenes Oberkriterium',
  subs.filter(c => !refs.has(c.parent_ref)).map(c => c.article_ref), []);
// Eine Artikelreferenz ist der Schluessel fuer den Katalogabgleich und fuer
// die Zuordnung der Fragebogenantworten. Doppelt vergeben waere beides kaputt.
eq('Artikelreferenzen bleiben eindeutig', new Set(catalog.map(c => c.article_ref)).size, catalog.length);
eq('keine Referenz laenger als die Spalte', catalog.filter(c => c.article_ref.length > 30).map(c => c.article_ref), []);
// Ein Unterkriterium darf nicht fuer ein Profil gelten, fuer das sein
// Oberkriterium nicht gilt — sonst zaehlt ein Bestandteil einer Pflicht mit,
// die es gar nicht gibt.
const byRef = new Map(catalog.map(c => [c.article_ref, c]));
const widerThanParent = subs.filter((c) => {
  const parent = byRef.get(c.parent_ref);
  return PROFILES.filter(p => p !== 'unknown').some(p =>
    obligationFor(parent.applicability, p) === 'not_applicable'
    && obligationFor(c.applicability, p) !== 'not_applicable');
});
eq('kein Unterkriterium gilt weiter als sein Oberkriterium', widerThanParent.map(c => c.article_ref), []);

console.log('Die Klammern zaehlen nicht mit:');
const allDone = catalog.map(c => ({ ...c, implementation_status: 'implemented' }));
const summary = summarise(allDone, 'essential');
// Ohne diese Regel ginge dieselbe Anforderung zweimal ein — einmal als
// Massnahme, einmal ueber ihre Bestandteile — und eine Massnahme mit acht
// Unterpunkten waere neunmal so wichtig wie eine ohne.
eq('gezaehlt werden nur Blaetter', summary.counted, catalog.length - summary.containers);
eq('und das sind nicht alle Kriterien', summary.counted < catalog.length, true);
eq('die Zahl der Klammern wird ausgewiesen', summary.containers, tops.filter(t => subs.some(c => c.parent_ref === t.article_ref)).length);
eq('alles umgesetzt bleibt 100 %', summary.rate, 100);
// Ein Oberkriterium, dessen Kinder offen sind, darf die Quote nicht
// beschoenigen, indem es selbst auf "umgesetzt" steht. Nur echte Klammern
// werden dafuer gesetzt: Ein Oberkriterium ohne Kinder ist selbst ein Blatt
// und zaehlt zu Recht mit.
const containerRefs = new Set(subs.map(c => c.parent_ref));
const parentLies = catalog.map(c => ({
  ...c,
  implementation_status: containerRefs.has(c.article_ref) ? 'implemented' : 'not_started',
}));
eq('ein erfuelltes Oberkriterium rettet offene Unterkriterien nicht',
  summarise(parentLies, 'essential').rate, 0);
// Die Gegenprobe: Erfuellte Blaetter zaehlen auch dann, wenn die Klammer
// darueber auf "nicht begonnen" steht.
const childrenDone = catalog.map(c => ({
  ...c,
  implementation_status: containerRefs.has(c.article_ref) ? 'not_started' : 'implemented',
}));
eq('erfuellte Unterkriterien zaehlen ohne Zutun der Klammer',
  summarise(childrenDone, 'essential').rate, 100);

console.log('Reifegrad-Stufen:');
eq('0 % → 1', maturityFromRate(0), 1);
eq('34 % → 2 (wie im Self-Check fuer Bedrohungsanalyse)', maturityFromRate(0.34), 2);
eq('64 % → 3', maturityFromRate(0.64), 3);
eq('87 % → 4', maturityFromRate(0.87), 4);
eq('100 % → 5', maturityFromRate(1), 5);

console.log('Kategorien:');
const byCat = summarise(alleFertig, 'essential').by_category;
ok('Kategorien werden einzeln ausgewiesen', Object.keys(byCat).length > 1);
ok('jede Kategorie traegt Quote, Reifegrad und Status',
  Object.values(byCat).every(c => typeof c.rate === 'number' && typeof c.maturity === 'number' && typeof c.status === 'string'));

console.log('Leerer Katalog:');
const leer = summarise([], 'essential');
eq('keine Division durch null', leer.rate, 0);
eq('Reifegrad 1 statt NaN', leer.maturity, 1);

eq('Profile sind vollstaendig', PROFILES, ['essential', 'important', 'indirect', 'unknown']);

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
