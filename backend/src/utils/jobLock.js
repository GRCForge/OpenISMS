'use strict';

/**
 * Keeps a scheduled job from running on top of itself.
 *
 * node-cron fires on the clock, not on completion: if the nightly CVE refresh is
 * still walking a few thousand assets when the next night comes around, a second
 * run starts alongside the first. Both then query the same upstream API and write
 * the same rows, which is slower than either run alone and can leave an asset
 * with counts from one run and a timestamp from the other.
 *
 * Scope is the process. A multi-instance deployment would need a lock in the
 * database, but the jobs here are wired up per instance anyway.
 */
const running = new Set();

async function withJobLock(name, fn) {
  if (running.has(name)) {
    console.warn(`[Cron] '${name}' läuft noch — dieser Durchlauf wird übersprungen.`);
    return { skipped: true };
  }
  running.add(name);
  const started = Date.now();
  try {
    return await fn();
  } finally {
    running.delete(name);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds > 60) console.log(`[Cron] '${name}' beendet nach ${seconds}s.`);
  }
}

/** For tests and diagnostics. */
const isJobRunning = (name) => running.has(name);

module.exports = { withJobLock, isJobRunning };
