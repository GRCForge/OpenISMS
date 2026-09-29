#!/usr/bin/env node
'use strict';

/**
 * Das einstellbare NIS-2-Bewertungsmodell.
 *
 * Sobald Gewichte und Schwellwerte aus der Datenbank kommen, sind sie
 * Fremdeingabe wie jede andere. Drei Dinge duerfen dabei nicht passieren:
 *
 *   - Die Voreinstellung aendert sich. Eine bestehende Installation, die nie
 *     etwas eingestellt hat, muss dieselben Zahlen zeigen wie vorher.
 *   - Ein unbrauchbarer Einzelwert nimmt die uebrigen Einstellungen mit.
 *   - Verdrehte Reifegradgrenzen bleiben stehen. Laege l3 ueber l4, waere eine
 *     hoehere Quote ploetzlich ein niedrigerer Reifegrad — eine Zahl, die
 *     niemand erklaeren kann.
 *
 * Run: node scripts/test-nis2-scoring-model.js
 */

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const {
  DEFAULT_SCORING, normaliseScoring, scoreAnswers, maturityFromRate, statusLabel,
} = require(path.join(SRC, 'services/nis2ScoringModel'));
const selfCheck = require(path.join(SRC, 'services/nis2SelfCheckScoring'));
const applicability = require(path.join(SRC, 'services/nis2Applicability'));
const catalog = require(path.join(SRC, 'services/nis2SelfCheckCatalog'));
const measureCatalog = require(path.join(SRC, 'services/nis2Catalog'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const ok = (label, condition) => eq(label, !!condition, true);
const near = (label, actual, expected, tol = 0.0005) => {
  const good = Math.abs(actual - expected) <= tol;
  if (!good) failures++;
  console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${label}${good ? '' : ` → ${actual}, erwartet ${expected}`}`);
};

console.log('Voreinstellung:');
near('Umsetzung wiegt zwei Drittel', DEFAULT_SCORING.implementation_weight, 2 / 3);
eq('"teilweise" ist die Haelfte', DEFAULT_SCORING.partly_value, 0.5);
eq('nicht umgesetzt sperrt den Punktwert', DEFAULT_SCORING.zero_on_not_implemented, true);
// Die Voreinstellung ist eingefroren: Ein versehentliches Ueberschreiben an
// einer Aufrufstelle wuerde sonst jede Installation treffen, die nie etwas
// eingestellt hat. Unter 'use strict' wirft der Versuch — beides ist recht,
// solange der Wert stehen bleibt.
try { DEFAULT_SCORING.partly_value = 0.99; } catch { /* eingefroren, wie gewollt */ }
eq('Voreinstellung laesst sich nicht von aussen veraendern', DEFAULT_SCORING.partly_value, 0.5);
try { DEFAULT_SCORING.maturity_thresholds.l4 = 0.1; } catch { /* auch verschachtelt */ }
eq('auch die verschachtelten Grenzen sind eingefroren', DEFAULT_SCORING.maturity_thresholds.l4, 0.75);

console.log('Punktwerte mit der Voreinstellung:');
eq('umgesetzt und belegt', scoreAnswers('yes', 'yes'), 1);
near('umgesetzt, teilweise belegt', scoreAnswers('yes', 'partly'), 2 / 3 + 1 / 6);
eq('nicht umgesetzt, aber belegt', scoreAnswers('no', 'yes'), 0);
eq('unbeantwortet', scoreAnswers('not_assessed', 'yes'), null);
eq('Nachweis offen zaehlt allein die Umsetzung', scoreAnswers('yes', 'not_assessed'), 1);

console.log('Eigene Einstellung wirkt:');
const strict = normaliseScoring({ partly_value: 0.29 });
near('"teilweise" auf beiden Achsen', scoreAnswers('partly', 'partly', strict), 0.29);
const evidenceHeavy = normaliseScoring({ implementation_weight: 0.25 });
near('Nachweis darf schwerer wiegen als die Umsetzung',
  scoreAnswers('yes', 'no', evidenceHeavy), 0.25);
// Abschaltbar, falls ein Bezugsrahmen den Nachweis auch ohne Umsetzung zaehlt.
const noGate = normaliseScoring({ zero_on_not_implemented: false });
near('Sperre abschaltbar', scoreAnswers('no', 'yes', noGate), 1 / 3);
eq('mit Sperre bleibt es 0', scoreAnswers('no', 'yes', normaliseScoring({})), 0);

console.log('Normalisierung fremder Eingaben:');
eq('null ergibt die Voreinstellung', normaliseScoring(null), DEFAULT_SCORING);
eq('Array ergibt die Voreinstellung', normaliseScoring([1, 2]), DEFAULT_SCORING);
// Ein vertippter Einzelwert darf die uebrigen Einstellungen nicht mitnehmen.
const partial = normaliseScoring({ partly_value: 'ein bisschen', implementation_weight: 0.4 });
eq('unbrauchbarer Wert faellt zurueck', partial.partly_value, 0.5);
eq('der gueltige daneben bleibt', partial.implementation_weight, 0.4);
eq('Gewicht ausserhalb 0..1 faellt zurueck', normaliseScoring({ implementation_weight: 1.5 }).implementation_weight, DEFAULT_SCORING.implementation_weight);
eq('negatives Gewicht faellt zurueck', normaliseScoring({ implementation_weight: -1 }).implementation_weight, DEFAULT_SCORING.implementation_weight);
eq('nicht-boolescher Schalter faellt zurueck', normaliseScoring({ zero_on_not_implemented: 'nein' }).zero_on_not_implemented, true);
eq('Schalter false wird uebernommen', normaliseScoring({ zero_on_not_implemented: false }).zero_on_not_implemented, false);
eq('fremde Schluessel verschwinden',
  Object.keys(normaliseScoring({ hack: 1, __proto__: { x: 1 } })).sort(),
  ['implementation_weight', 'maturity_thresholds', 'partly_value', 'status_thresholds', 'zero_on_not_implemented']);

console.log('Reifegradgrenzen:');
// Verdrehte Grenzen werden absteigend erzwungen, nicht verworfen — sonst
// ergaebe eine hoehere Quote einen niedrigeren Reifegrad.
const twisted = normaliseScoring({ maturity_thresholds: { l5: 0.9, l4: 0.95, l3: 0.2, l2: 0.8 } });
const t = twisted.maturity_thresholds;
ok('absteigend erzwungen', t.l5 >= t.l4 && t.l4 >= t.l3 && t.l3 >= t.l2);
ok('Reifegrad steigt monoton mit der Quote', (() => {
  let last = 0;
  for (let r = 0; r <= 1.0001; r += 0.01) {
    const m = maturityFromRate(r, twisted);
    if (m < last) return false;
    last = m;
  }
  return true;
})());
eq('Untergrenze trifft genau', maturityFromRate(0.75, DEFAULT_SCORING), 4);
eq('knapp darunter eine Stufe tiefer', maturityFromRate(0.7499, DEFAULT_SCORING), 3);
eq('eigene Grenzen wirken', maturityFromRate(0.6, normaliseScoring({ maturity_thresholds: { l4: 0.6 } })), 4);
eq('Status folgt eigenen Grenzen', statusLabel(0.6, normaliseScoring({ status_thresholds: { good: 0.6 } })), 'good');
ok('Status-Grenzen ebenfalls geordnet', (() => {
  const s = normaliseScoring({ status_thresholds: { good: 0.3, improvable: 0.9 } }).status_thresholds;
  return s.good >= s.improvable;
})());

console.log('Fragebogen rechnet mit dem Modell:');
const answered = catalog.map(c => ({ ...c, answer_implementation: 'partly', answer_evidence: 'partly' }));
eq('Voreinstellung: alles teilweise → 50 %', selfCheck.summarise(answered, 'essential').rate, 50);
eq('strenger eingestellt → 29 %', selfCheck.summarise(answered, 'essential', [], strict).rate, 29);
// Ohne durchgereichtes Modell muss weiterhin die Voreinstellung gelten, sonst
// zeigt eine Aufrufstelle, die es vergisst, stillschweigend andere Zahlen.
eq('ohne Modell bleibt es die Voreinstellung',
  selfCheck.summarise(answered, 'essential').rate,
  selfCheck.summarise(answered, 'essential', [], DEFAULT_SCORING).rate);

console.log('Kriterienkatalog rechnet mit demselben Modell:');
const inProgress = measureCatalog.map(m => ({ ...m, implementation_status: 'in_progress' }));
eq('Voreinstellung: alles in Arbeit → 50 %', applicability.summarise(inProgress, 'essential').rate, 50);
// Derselbe Parameter entscheidet in beiden Modulen, was "halb fertig" wert
// ist. Zwei Begriffe davon waeren eine Falle fuer jeden, der die Zahlen
// nebeneinander liest.
eq('strenger eingestellt → 29 %', applicability.summarise(inProgress, 'essential', strict).rate, 29);

console.log('Grenzfaelle:');
eq('Gewicht 0: nur der Nachweis zaehlt',
  scoreAnswers('partly', 'yes', normaliseScoring({ implementation_weight: 0 })), 1);
eq('Gewicht 1: nur die Umsetzung zaehlt',
  scoreAnswers('yes', 'no', normaliseScoring({ implementation_weight: 1 })), 1);
eq('"teilweise" auf 0 macht daraus ein Nein',
  scoreAnswers('partly', 'partly', normaliseScoring({ partly_value: 0 })), 0);
eq('"teilweise" auf 1 macht daraus ein Ja',
  scoreAnswers('partly', 'partly', normaliseScoring({ partly_value: 1 })), 1);

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
