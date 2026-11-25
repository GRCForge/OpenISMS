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
 * Scope is the process. Jobs that must run once per period across several
 * instances use withJobSlot below (a row per job and period in job_runs).
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

/**
 * Run a job at most once per slot across ALL instances (3.9.0).
 *
 * withJobLock only covers the process. Jobs that notify people or create tasks
 * must not run twice when several instances share one database: the first
 * instance to insert (name, slot) into job_runs runs the job, every other one
 * skips. The slot names the period, e.g. the date for a daily job - so the
 * start-up run and the cron run of the same day are one run, too.
 *
 * A crashed run keeps its slot (status 'running'); the next period runs again.
 * The jobs themselves stay idempotent (unique indexes, existence checks), so a
 * run that is skipped or repeated cannot create duplicates.
 */
async function withJobSlot(name, slot, fn) {
  return withJobLock(name, async () => {
    const { JobRun } = require('../models');
    const holder = `${require('os').hostname()}:${process.pid}`.slice(0, 120);
    let row;
    try {
      row = await JobRun.create({ name, slot: String(slot).slice(0, 40), holder, started_at: new Date(), status: 'running' });
    } catch (e) {
      if (e && e.name === 'SequelizeUniqueConstraintError') return { skipped: true, reason: 'slot_taken' };
      throw e;
    }
    try {
      const result = await fn();
      await row.update({ status: 'done', finished_at: new Date() }).catch(() => {});
      return result;
    } catch (e) {
      await row.update({ status: 'failed', finished_at: new Date() }).catch(() => {});
      throw e;
    }
  });
}

/** Daily slot in UTC (YYYY-MM-DD). */
const dailySlot = (d = new Date()) => d.toISOString().slice(0, 10);

module.exports = { withJobLock, isJobRunning, withJobSlot, dailySlot };
