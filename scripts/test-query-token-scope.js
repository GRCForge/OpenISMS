#!/usr/bin/env node
'use strict';

/**
 * Query-Token nur fuer Server-Sent Events (Security-Review 2026-11, OP-2).
 *
 * backend/src/utils/queryToken.js und middleware/auth.js (REST-API):
 *  - GET mit Accept: text/event-stream und ?token=  -> Token wird gelesen
 *  - normaler GET (Link, fetch, Download) mit ?token= -> ignoriert, 401
 *  - POST mit ?token= und Event-Stream-Accept        -> ignoriert
 *  - Authorization-Header gilt unveraendert fuer alle Methoden
 *
 * Models sind gemockt, keine Datenbank, kein Netz.
 *
 * Run: node scripts/test-query-token-scope.js
 */

const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-query-token-only';

const backendSrc = path.join(__dirname, '..', 'backend', 'src');
// Abhaengigkeiten liegen unter backend/node_modules, das Skript laeuft aus dem Repo-Root.
const jwt = require(require.resolve('jsonwebtoken', { paths: [path.join(backendSrc, '..')] }));
const mock = (rel, exports) => {
  const file = require.resolve(path.join(backendSrc, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const user = { id: 1, role: 'admin', active: true, last_seen_at: new Date(), save: async () => {} };
mock('models/index.js', {
  User: { findByPk: async (id) => (id === 1 ? user : null), findOne: async () => null },
  ApiToken: { findOne: async () => null },
});
mock('services/notifyService.js', { notify: async () => {} });

const { isEventStreamRequest, getQueryToken } = require(path.join(backendSrc, 'utils', 'queryToken.js'));
const { authenticate, getTokenFromHeaders } = require(path.join(backendSrc, 'middleware', 'auth.js'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  // Keine Werte ausgeben: actual/expected koennen Tokens enthalten (CodeQL js/clear-text-logging).
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ' → Ergebnis weicht ab'}`);
};

const req = ({ method = 'GET', accept, query = {}, authorization } = {}) => ({
  method,
  query,
  headers: { ...(accept ? { accept } : {}), ...(authorization ? { authorization } : {}) },
});

const run = (r) => new Promise((resolve) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(body) { resolve({ status: this.statusCode, body }); return this; },
  };
  authenticate(r, res, () => resolve({ status: 'next', user: r.user && r.user.id }));
});

(async () => {
  console.log('isEventStreamRequest:');
  eq('GET + text/event-stream', isEventStreamRequest(req({ accept: 'text/event-stream' })), true);
  eq('GET + Liste mit q-Wert', isEventStreamRequest(req({ accept: 'application/json;q=0.9, text/event-stream;q=1' })), true);
  eq('GET + Grossschreibung', isEventStreamRequest(req({ accept: 'Text/Event-Stream' })), true);
  eq('GET ohne Accept', isEventStreamRequest(req()), false);
  eq('GET + application/json', isEventStreamRequest(req({ accept: 'application/json' })), false);
  eq('GET + */*', isEventStreamRequest(req({ accept: '*/*' })), false);
  eq('Teilstring zaehlt nicht', isEventStreamRequest(req({ accept: 'text/event-streamx' })), false);
  eq('POST + text/event-stream', isEventStreamRequest(req({ method: 'POST', accept: 'text/event-stream' })), false);

  console.log('\ngetQueryToken:');
  eq('SSE: ?token=', getQueryToken(req({ accept: 'text/event-stream', query: { token: ' abc ' } })), 'abc');
  eq('SSE: ?api_key=', getQueryToken(req({ accept: 'text/event-stream', query: { api_key: 'k' } })), 'k');
  eq('SSE: Array-Parameter wird ignoriert', getQueryToken(req({ accept: 'text/event-stream', query: { token: ['a', 'b'] } })), null);
  eq('normaler GET: ?token= ignoriert', getQueryToken(req({ query: { token: 'abc' } })), null);
  eq('POST: ?token= ignoriert', getQueryToken(req({ method: 'POST', accept: 'text/event-stream', query: { token: 'abc' } })), null);

  console.log('\nmiddleware/auth.js — getTokenFromHeaders:');
  eq('Bearer-Header', getTokenFromHeaders(req({ authorization: 'Bearer xyz' })), 'xyz');
  eq('Header hat Vorrang vor Query', getTokenFromHeaders(req({ accept: 'text/event-stream', authorization: 'Bearer h', query: { token: 'q' } })), 'h');
  eq('normaler GET mit ?token= -> kein Token', getTokenFromHeaders(req({ query: { token: 'abc' } })), null);

  console.log('\nmiddleware/auth.js — authenticate:');
  const good = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
  eq('normaler GET mit gueltigem ?token= -> 401', (await run(req({ query: { token: good } }))).status, 401);
  eq('Download-Link (Accept */*) mit ?token= -> 401', (await run(req({ accept: '*/*', query: { token: good } }))).status, 401);
  eq('SSE-GET mit gueltigem ?token= -> angemeldet', await run(req({ accept: 'text/event-stream', query: { token: good } })), { status: 'next', user: 1 });
  eq('Bearer-Header -> angemeldet', await run(req({ authorization: `Bearer ${good}` })), { status: 'next', user: 1 });
})()
  .catch((e) => { failures++; console.log('  FAIL  Tests abgebrochen:', e.message); })
  .finally(() => {
    console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
    process.exit(failures ? 1 : 0);
  });
