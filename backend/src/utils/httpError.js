'use strict';

const crypto = require('crypto');

/**
 * Answers an unexpected failure without handing the caller the internals.
 *
 * Route handlers used to end in `res.status(500).json({ error: e.message })`,
 * which puts whatever the failure produced on the wire: SQL fragments, table and
 * column names, constraint names, file system paths. That is a map of the
 * installation for anyone with a login, and it tells an attacker which of their
 * inputs got somewhere interesting.
 *
 * The detail belongs in the log instead. Each response carries a short reference
 * that also appears in the log line, so an operator can find the one failure a
 * user is reporting without grepping by timestamp.
 *
 * Deliberate 4xx answers keep their own message — those are written for the
 * caller and say what to do differently. This is only for the ones nobody meant.
 */
function serverError(res, err, context = 'API') {
  const ref = crypto.randomBytes(4).toString('hex');
  const safeContext = sanitizeForLog(context);
  const detail = sanitizeForLog(err?.stack || err?.message || err);
  console.error(`[${safeContext}] Fehler ${ref}:`, detail);
  if (res.headersSent) {
    // A response already on the wire cannot be turned into a 500; cutting it off
    // makes the failure visible instead of delivering a truncated body that looks
    // complete.
    res.destroy(err instanceof Error ? err : undefined);
    return;
  }
  res.status(500).json({ error: 'Interner Serverfehler.', ref });
}

// ── Fehler aus Request-Handlern (Security-Review 2026-11, OP-6) ──────────────
//
// Viele Handler endeten in `res.status(400).json({ error: e.message })`. Fuer
// selbst geworfene Meldungen ("Titel fehlt") ist das gewollt — aber derselbe
// catch faengt auch Sequelize- und Treiberfehler. Deren Text nennt Tabellen,
// Spalten, Constraints und SQL-Fragmente (`invalid input value for enum
// enum_risks_status: "x"`, `Key (email)=(a@b.de) already exists.`,
// `insert or update on table "tasks" violates foreign key constraint ...`).
//
// requestError() trennt beides: Meldungen, die fuer den Aufrufer geschrieben
// wurden, bleiben; alles, was aus Datenbank, Laufzeit oder Betriebssystem kommt,
// wird durch eine allgemeine Meldung mit Referenz ersetzt, die Details gehen ins
// Log (wie bei serverError).

const PROGRAMMING_ERRORS = new Set(['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'EvalError', 'URIError']);

const sanitizeForLog = (value) => String(value).replace(/[\r\n]+/g, ' ');

const isSequelizeError = (err) => typeof err?.name === 'string' && err.name.startsWith('Sequelize');

/**
 * Antwort fuer einen Datenbankfehler: Status und allgemeine Meldung, ohne
 * Tabellen-, Spalten- oder Constraint-Namen. Bei Validierungsfehlern werden nur
 * die Feldnamen genannt (die kennt der Aufrufer ohnehin, er hat sie gesendet).
 */
const describeSequelizeError = (err) => {
  switch (err.name) {
    case 'SequelizeUniqueConstraintError':
      return { status: 409, body: { error: 'Ein Eintrag mit diesen Werten existiert bereits.' } };
    case 'SequelizeValidationError': {
      const fields = [...new Set((err.errors || []).map((x) => x && x.path).filter((p) => typeof p === 'string'))];
      return { status: 400, body: { error: 'Ungültige Eingabe.', ...(fields.length ? { fields } : {}) } };
    }
    case 'SequelizeForeignKeyConstraintError':
      return { status: 400, body: { error: 'Der Datensatz verweist auf einen Eintrag, der nicht existiert oder noch verwendet wird.' } };
    case 'SequelizeDatabaseError':
      // Ungueltige Enum-Werte, Zahlen- oder Datumsformate aus dem Request.
      return { status: 400, body: { error: 'Ungültige Eingabe.' } };
    default:
      // Verbindung, Timeout, Sperren, Transaktionen: kein Fehler des Aufrufers.
      return null;
  }
};

/** Fehler aus Laufzeit oder Betriebssystem (fs, Netz) — Text nie nach aussen. */
const isInternalError = (err) =>
  !(err instanceof Error) ||
  PROGRAMMING_ERRORS.has(err.name) ||
  typeof err.syscall === 'string' ||
  typeof err.errno === 'number';

/**
 * Fehler eines Request-Handlers beantworten.
 *  - Sequelize-Fehler: allgemeine Meldung (400/409), Details ins Log;
 *    Verbindungs- und Transaktionsfehler werden zu serverError (500).
 *  - Programmier- und Systemfehler (TypeError, ENOENT ...): serverError (500).
 *  - Selbst geworfene Fehler: ihre Meldung, Status aus err.status oder `status`.
 */
function requestError(res, err, context = 'API', status = 400) {
  if (isSequelizeError(err)) {
    const mapped = describeSequelizeError(err);
    if (!mapped) return serverError(res, err, context);
    const ref = crypto.randomBytes(4).toString('hex');
    // Zeilenumbrueche entfernen: die Meldung kann Eingaben des Aufrufers enthalten
    // (Log-Injection, CodeQL js/log-injection).
    const safeContext = sanitizeForLog(context);
    const name = sanitizeForLog(err.name);
    const message = sanitizeForLog(err.message);
    console.warn(`[${safeContext}] Datenbankfehler ${ref}: ${name}: ${message}`);
    if (res.headersSent) return res.destroy();
    return res.status(mapped.status).json({ ...mapped.body, ref });
  }
  if (isInternalError(err)) return serverError(res, err, context);
  const code = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : status;
  if (res.headersSent) return res.destroy();
  return res.status(code).json({ error: err.message });
}

module.exports = { serverError, requestError, isSequelizeError };
