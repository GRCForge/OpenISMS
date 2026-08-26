#!/usr/bin/env node
'use strict';

/**
 * Beide Limiter haengen doppelt in der Kette: einmal app-weit in index.js und
 * einmal im jeweiligen Router (das ist die Stelle, die CodeQL fuer CWE-770 sehen
 * will). express-rate-limit zaehlt jeden Durchlauf, also halbierte diese
 * Doppelung still jedes Budget — /api/discovery erlaubte 150 statt 300 Anfragen
 * pro Fenster.
 *
 * Sichtbar wurde das beim Loeschen von 291 freizugebenden Software-Eintraegen:
 * der Lauf brach in der Mitte ab, jede weitere Anfrage inklusive Reload kam als
 * 429 zurueck, und die Oberflaeche meldete "0 Eintraege geloescht".
 *
 * Geprueft wird deshalb der ZAEHLER, nicht der Statuscode: bei Budgets von 5000
 * bzw. 300 faellt eine Doppelzaehlung ueber ein paar Anfragen sonst gar nicht
 * auf. RateLimit-Remaining muss pro Anfrage um genau 1 sinken.
 *
 * Run: node scripts/test-rate-limit-once.js
 */

const path = require('path');
// Die Skripte laufen aus dem Repo-Root, die Abhaengigkeiten liegen unter
// backend/node_modules — daher der explizite Pfad.
const BACKEND_MODULES = path.join(__dirname, '..', 'backend', 'node_modules');
const express = require(path.join(BACKEND_MODULES, 'express'));
const rateLimit = require(path.join(BACKEND_MODULES, 'express-rate-limit'));
const { apiLimiter, heavyLimiter } =
  require(path.join(__dirname, '..', 'backend', 'src', 'middleware', 'rateLimiter'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

/** Mountet den Limiter zweimal, genau wie index.js + der Router es tun. */
const doubleMounted = (limiter) => {
  const app = express();
  app.use('/api/x', limiter);
  const r = express.Router();
  r.use(limiter);
  r.get('/hit', (req, res) => res.json({ ok: true }));
  app.use('/api/x', r);
  return app;
};

/** Feuert `count` Anfragen und liefert Status + RateLimit-Remaining je Anfrage. */
const drain = (app, count) => new Promise((resolve) => {
  const srv = app.listen(0, async () => {
    const port = srv.address().port;
    const out = [];
    for (let i = 0; i < count; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/x/hit`);
      out.push({ status: res.status, remaining: Number(res.headers.get('ratelimit-remaining')) });
    }
    srv.close(() => resolve(out));
  });
});

/** Wie viele Zaehler verbraucht eine Anfrage? */
const perRequestCost = (rows) => {
  const deltas = [];
  for (let i = 1; i < rows.length; i++) deltas.push(rows[i - 1].remaining - rows[i].remaining);
  return [...new Set(deltas)];
};

(async () => {
  console.log('apiLimiter, doppelt gemountet:');
  const api = await drain(doubleMounted(apiLimiter), 6);
  eq('jede Anfrage verbraucht genau 1 Zaehler', perRequestCost(api), [1]);

  console.log('\nheavyLimiter, doppelt gemountet:');
  const heavy = await drain(doubleMounted(heavyLimiter), 6);
  eq('jede Anfrage verbraucht genau 1 Zaehler', perRequestCost(heavy), [1]);

  console.log('\nDer Limiter greift weiterhin — einfach gemountet, Budget 3:');
  const tiny = rateLimit({ windowMs: 60_000, max: 3, keyGenerator: () => 'k', standardHeaders: true, legacyHeaders: false });
  const app = express();
  app.get('/api/x/hit', tiny, (req, res) => res.json({ ok: true }));
  const tight = await drain(app, 5);
  eq('3 kommen durch', tight.filter((r) => r.status === 200).length, 3);
  eq('danach 429', tight.filter((r) => r.status === 429).length, 2);

  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
  process.exit(failures ? 1 : 0);
})();
