#!/usr/bin/env node
'use strict';

/**
 * node-cron fires on the clock, not on completion, so a nightly job that runs
 * long enough starts again while the first pass is still working. withJobLock
 * turns the second start into a skip.
 *
 * Run: node scripts/test-job-lock.js
 */

const path = require('path');
const { withJobLock, isJobRunning } = require(path.join(__dirname, '..', 'backend', 'src', 'utils', 'jobLock'));

let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  let runs = 0;
  const slow = () => withJobLock('demo', async () => { runs++; await wait(50); return 'fertig'; });

  const first = slow();
  await wait(10);
  const second = await slow();

  check('zweiter Start während des ersten wird übersprungen', second && second.skipped === true);
  check('der Job selbst lief dabei nur einmal', runs === 1);
  check('Lock ist während des Laufs sichtbar', isJobRunning('demo'));

  const firstResult = await first;
  check('erster Lauf liefert sein Ergebnis', firstResult === 'fertig');
  check('Lock ist danach frei', !isJobRunning('demo'));

  const third = await slow();
  check('nach Abschluss läuft der Job wieder', third === 'fertig' && runs === 2);

  // Ein geworfener Fehler darf den Lock nicht dauerhaft halten, sonst läuft der
  // Job nach dem ersten Fehlschlag nie wieder.
  await withJobLock('kaputt', async () => { throw new Error('geplatzt'); }).catch(() => {});
  check('Lock wird auch nach einem Fehler freigegeben', !isJobRunning('kaputt'));

  // Verschiedene Jobs blockieren sich nicht gegenseitig.
  const a = withJobLock('a', async () => { await wait(30); return 'a'; });
  const b = await withJobLock('b', async () => 'b');
  check('unterschiedliche Jobs laufen unabhängig', b === 'b');
  await a;

  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
  process.exit(failures ? 1 : 0);
})();
