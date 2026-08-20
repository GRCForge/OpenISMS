#!/usr/bin/env node
'use strict';

/**
 * Query-string input reaches Sequelize where clauses and LIMIT/OFFSET directly.
 * Express turns ?status[ne]=x into an object and ?limit=abc into a string, and
 * both used to travel all the way to MySQL and come back as a failed request.
 * These helpers drop what cannot be compared and clamp what can.
 *
 * Run: node scripts/test-query-filters.js
 */

const path = require('path');
const { scalar, scalarOrList, boundedInt, validDate, setFilter } =
  require(path.join(__dirname, '..', 'backend', 'src', 'utils', 'queryFilters'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

console.log('scalar / scalarOrList:');
eq("'active' bleibt", scalar('active'), 'active');
eq('Zahl bleibt', scalar(42), 42);
eq('Objekt (?status[ne]=x) wird verworfen', scalar({ ne: 'x' }), undefined);
eq('Array wird von scalar verworfen', scalar(['a']), undefined);
eq('Array von Scalars wird zur IN-Liste', scalarOrList(['a', 'b']), ['a', 'b']);
eq('Array mit Objekt darin wird gefiltert', scalarOrList(['a', { ne: 'b' }]), ['a']);
eq('Array nur mit Objekten wird verworfen', scalarOrList([{ ne: 'b' }]), undefined);

console.log('setFilter:');
eq('gültiger Wert landet im where', setFilter({}, 'status', 'active'), { status: 'active' });
eq('Objekt landet nicht im where', setFilter({}, 'status', { ne: 'x' }), {});
eq('undefined landet nicht im where', setFilter({}, 'status', undefined), {});
// Die UI sendet ?status= wenn ein Filter geleert wird — das muss "alles zeigen"
// heißen, nicht "nur Datensätze mit leerem Status".
eq('leerer String wird übersprungen (Filter geleert)', setFilter({}, 'status', ''), {});
eq('0 bleibt ein gültiger Filterwert', setFilter({}, 'count', 0), { count: 0 });

console.log('boundedInt:');
eq("'abc' → Standardwert", boundedInt('abc', 200, 1, 500), 200);
eq('-1 → Untergrenze', boundedInt('-1', 200, 1, 500), 1);
eq('99999 → Obergrenze', boundedInt('99999', 200, 1, 500), 500);
eq("'50' → 50", boundedInt('50', 200, 1, 500), 50);
eq('undefined → Standardwert', boundedInt(undefined, 200, 1, 500), 200);
eq('Objekt → Standardwert', boundedInt({ a: 1 }, 200, 1, 500), 200);

console.log('validDate:');
eq('ISO-Datum wird akzeptiert', validDate('2026-08-20') instanceof Date, true);
eq('Tagesende wird gesetzt', validDate('2026-08-20', true).toISOString().slice(11, 19), '23:59:59');
eq('Unsinn → null', validDate('nicht-ein-datum'), null);
eq('leer → null', validDate(''), null);
eq('Objekt → null', validDate({}), null);

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(failures ? 1 : 0);
