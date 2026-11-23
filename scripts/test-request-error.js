#!/usr/bin/env node
'use strict';

/**
 * Keine Datenbank-Fehlermeldungen nach aussen (Security-Review 2026-11, OP-6).
 *
 * backend/src/utils/httpError.js — requestError():
 *  - echte Sequelize-Fehlerklassen (Unique, Validation, ForeignKey, Database,
 *    Connection) -> allgemeine Meldung + ref, kein Tabellen-/Spalten-/SQL-Text
 *  - TypeError, Systemfehler (ENOENT mit Pfad) -> 500 mit ref, ohne Text
 *  - selbst geworfene Fehler -> ihre Meldung, Status aus err.status
 *
 * Und ein Quelltext-Check: kein Route-Handler gibt mehr `e.message` aus einem
 * catch direkt als 400 zurueck.
 *
 * Keine Datenbank, kein Netz. Run: node scripts/test-request-error.js
 */

const fs = require('fs');
const path = require('path');

const backendSrc = path.join(__dirname, '..', 'backend', 'src');
// Abhaengigkeiten liegen unter backend/node_modules, das Skript laeuft aus dem Repo-Root.
const S = require(require.resolve('sequelize', { paths: [path.join(backendSrc, '..')] }));
const { requestError } = require(path.join(backendSrc, 'utils', 'httpError.js'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

// Log-Ausgaben der Fehlerpfade sind hier erwartet und stoeren nur.
const quiet = (fn) => {
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try { return fn(); } finally { console.error = error; console.warn = warn; }
};

const send = (err, status) => quiet(() => {
  const res = {
    statusCode: 200, body: undefined, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    destroy() {},
  };
  requestError(res, err, 'test', status);
  return res;
});

const leaks = (body, ...needles) => needles.some((n) => JSON.stringify(body).includes(n));
const hasRef = (body) => typeof body?.ref === 'string' && /^[0-9a-f]{8}$/.test(body.ref);

const pgError = (message, extra = {}) => Object.assign(new Error(message), extra);

console.log('Sequelize-Fehler:');
{
  const parent = pgError('duplicate key value violates unique constraint "users_email_key"', { detail: 'Key (email)=(a@b.de) already exists.' });
  const err = new S.UniqueConstraintError({ parent, errors: [new S.ValidationErrorItem('email must be unique', 'unique violation', 'email', 'a@b.de')] });
  const r = send(err);
  eq('Unique -> 409', r.statusCode, 409);
  eq('Unique -> keine Constraint-/Wertangabe', leaks(r.body, 'users_email_key', 'a@b.de', 'duplicate key'), false);
  eq('Unique -> ref', hasRef(r.body), true);
}
{
  const err = new S.ValidationError('notNull Violation: Risk.title cannot be null', [
    new S.ValidationErrorItem('Risk.title cannot be null', 'notNull Violation', 'title', null),
    new S.ValidationErrorItem('Validation isIn on status failed', 'Validation error', 'status', 'x'),
  ]);
  const r = send(err);
  eq('Validation -> 400', r.statusCode, 400);
  eq('Validation -> nur Feldnamen', r.body.fields, ['title', 'status']);
  eq('Validation -> kein Modellname/Validator', leaks(r.body, 'Risk.title', 'isIn', 'notNull'), false);
}
{
  const parent = pgError('insert or update on table "tasks" violates foreign key constraint "tasks_asset_id_fkey"');
  const r = send(new S.ForeignKeyConstraintError({ parent, table: 'tasks', fields: ['asset_id'] }));
  eq('ForeignKey -> 400', r.statusCode, 400);
  eq('ForeignKey -> kein Tabellen-/Constraint-Name', leaks(r.body, 'tasks_asset_id_fkey', '"tasks"'), false);
}
{
  const parent = pgError('invalid input value for enum enum_risks_status: "x"', { sql: 'UPDATE "risks" SET "status"=$1 WHERE "id" = $2' });
  const r = send(new S.DatabaseError(parent));
  eq('DatabaseError -> 400', r.statusCode, 400);
  eq('DatabaseError -> kein Enum-/SQL-Text', leaks(r.body, 'enum_risks_status', 'UPDATE', 'risks'), false);
  eq('DatabaseError -> Meldung', r.body.error, 'Ungültige Eingabe.');
}
{
  const r = send(new S.ConnectionRefusedError(pgError('connect ECONNREFUSED 10.0.0.5:5432')));
  eq('Connection -> 500', r.statusCode, 500);
  eq('Connection -> keine Adresse', leaks(r.body, '10.0.0.5', 'ECONNREFUSED'), false);
  eq('Connection -> ref', hasRef(r.body), true);
}

console.log('\nLaufzeit- und Systemfehler:');
{
  const r = send(new TypeError("Cannot read properties of undefined (reading 'owner_id')"));
  eq('TypeError -> 500', r.statusCode, 500);
  eq('TypeError -> kein Text', leaks(r.body, 'owner_id'), false);
}
{
  const err = Object.assign(new Error("ENOENT: no such file or directory, open '/app/uploads/policies/x.pdf'"), { code: 'ENOENT', errno: -2, syscall: 'open' });
  const r = send(err);
  eq('ENOENT -> 500', r.statusCode, 500);
  eq('ENOENT -> kein Pfad', leaks(r.body, '/app/uploads'), false);
}
{
  const r = send('kein Error-Objekt');
  eq('Nicht-Error -> 500', r.statusCode, 500);
}

console.log('\nSelbst geworfene Meldungen bleiben:');
{
  const r = send(new Error('Titel ist ein Pflichtfeld.'));
  eq('Error -> 400 + Meldung', [r.statusCode, r.body], [400, { error: 'Titel ist ein Pflichtfeld.' }]);
}
{
  const r = send(Object.assign(new Error('CheckMK-Anbindung unvollstaendig konfiguriert.'), { status: 400 }), 500);
  eq('err.status hat Vorrang', [r.statusCode, r.body.error], [400, 'CheckMK-Anbindung unvollstaendig konfiguriert.']);
}
{
  const r = send(Object.assign(new Error('Nicht gefunden.'), { status: 404 }));
  eq('404 bleibt 404', r.statusCode, 404);
}
{
  const r = send(new Error('Adapter antwortet nicht.'), 500);
  eq('Fallback-Status aus Aufruf', r.statusCode, 500);
}

console.log('\nQuelltext — kein e.message aus catch als 400:');
{
  const routes = path.join(backendSrc, 'routes');
  const offenders = [];
  for (const f of fs.readdirSync(routes).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(routes, f), 'utf8');
    if (/res\.status\(400\)\.json\(\{\s*error:\s*(e|err|error)\.message\s*\}\)/.test(src)) offenders.push(f);
  }
  eq('keine Fundstelle', offenders, []);
}

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
