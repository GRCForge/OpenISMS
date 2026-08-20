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
  console.error(`[${context}] Fehler ${ref}:`, err?.stack || err?.message || err);
  if (res.headersSent) {
    // A response already on the wire cannot be turned into a 500; cutting it off
    // makes the failure visible instead of delivering a truncated body that looks
    // complete.
    res.destroy(err instanceof Error ? err : undefined);
    return;
  }
  res.status(500).json({ error: 'Interner Serverfehler.', ref });
}

module.exports = { serverError };
