'use strict';

/**
 * Assessment history of the risk register (3.9.0) - ISO/IEC 27005:2022
 * clause 10 (monitoring and review), ISO/IEC 27001:2022 8.2 and 9.1.
 *
 *   - Every change of the gross, net or target assessment of a risk becomes
 *     one immutable row in risk_assessment_history: values, levels,
 *     methodology version, trigger, user, time.
 *   - Captured in the Risk save hooks (models/index.js), so no write path can
 *     skip it. A service operation runs inside withHistory(): the several
 *     saves of one request (values, recalculated net risk, lapsed acceptance)
 *     are coalesced into one row carrying the operation's trigger and user.
 *   - Risks from before 3.9.0 get one starting row from their current state,
 *     marked "baseline_at_upgrade" (ensureBaseline, idempotent).
 *   - Read: history of one risk (chart) and the trend heat map - how many
 *     risks moved from which cell to which between two dates.
 */

const { AsyncLocalStorage } = require('async_hooks');
const rm = require('./riskMethodology');

const { httpError } = rm;
const models = () => require('../models');

const TRACKED = ['likelihood', 'impact', 'impact_dimensions', 'inherent_level', 'residual_likelihood', 'residual_impact', 'residual_level', 'residual_override',
  'target_likelihood', 'target_impact', 'target_level', 'methodology_id'];
const RESIDUAL_FIELDS = ['residual_likelihood', 'residual_impact', 'residual_level', 'residual_override'];
// A row with one of these triggers counts as an assessment by a person: it
// sets risks.last_reviewed_at, from which the next periodic review is due.
const REVIEW_TRIGGERS = ['created', 'assessment', 'reassessment', 'residual_override', 'review'];
const NOTE_MAX = 4000;
const DETAIL_MAX = 255;

const als = new AsyncLocalStorage();

const stable = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== null && v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
};
const norm = (k, v) => {
  if (v === undefined || v === null) return k === 'residual_override' ? false : null;
  if (k === 'impact_dimensions') return typeof v === 'object' && Object.keys(v).length ? v : null;
  if (k === 'residual_override') return !!v;
  if (k.endsWith('_level')) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const stateOf = (get) => Object.fromEntries(TRACKED.map(k => [k, norm(k, get(k))]));
const changedFields = (before, after) => (before ? TRACKED.filter(k => stable(before[k]) !== stable(after[k])) : []);

const actorOf = (req) => (req && req.user ? { id: req.user.id ?? null, name: req.user.name ?? null } : { id: null, name: null });
const clip = (s, max) => (typeof s === 'string' ? s.slice(0, max) : null);

/**
 * Run fn as one assessment operation: saves of risks inside it are coalesced
 * into one history row per risk with this context. Nested calls join the
 * outer operation (the outer trigger wins).
 *
 * ctx: { trigger, req (for the user), detail, note }
 */
const withHistory = async (ctx, fn) => {
  if (als.getStore()) return fn();
  const store = { ctx: ctx || {}, pending: new Map() };
  try {
    return await als.run(store, fn);
  } finally {
    await flush(store);
  }
};

// Trigger of the coalesced row: an "assessment" that only moved the net risk
// (controls changed) is a recalculation, not an assessment.
const resolveTrigger = (trigger, changed, created) => {
  if (created) return 'created';
  const t = trigger || 'system';
  if (t === 'assessment' && changed.length && changed.every(k => RESIDUAL_FIELDS.includes(k))) return 'residual_recalculated';
  return t;
};

const versionOf = async (methodologyId) => {
  if (!methodologyId) return null;
  const p = await rm.getProfile(methodologyId);
  return p?.version ?? null;
};

const writeEntry = async (riskId, state, before, ctx, { transaction, created = false, force = false } = {}) => {
  const { RiskAssessmentHistory, Risk } = models();
  const changed = changedFields(before, state);
  if (!created && !force && !changed.length) return null;
  const trigger = resolveTrigger(ctx?.trigger, changed, created);
  const actor = actorOf(ctx?.req);
  const row = await RiskAssessmentHistory.create({
    risk_id: riskId,
    recorded_at: new Date(),
    trigger,
    trigger_detail: clip(ctx?.detail, DETAIL_MAX),
    user_id: actor.id,
    user_name: clip(actor.name, 255),
    methodology_id: state.methodology_id,
    methodology_version: await versionOf(state.methodology_id),
    ...Object.fromEntries(TRACKED.filter(k => k !== 'methodology_id').map(k => [k, state[k]])),
    changed_fields: changed,
    note: clip(ctx?.note, NOTE_MAX),
  }, { transaction });
  if (REVIEW_TRIGGERS.includes(trigger)) {
    await Risk.update({ last_reviewed_at: row.recorded_at }, { where: { id: riskId }, hooks: false, silent: true, validate: false, transaction });
  }
  return row;
};

const record = async (riskId, before, after, options = {}) => {
  const store = als.getStore();
  if (store) {
    const p = store.pending.get(riskId);
    if (p) p.after = after;
    else store.pending.set(riskId, { before, after, created: before === null });
    return;
  }
  // Outside a service operation (import, threat advisory, direct model use):
  // written at once, with the context the caller passed in the save options.
  const ctx = options.riskHistory || { trigger: before === null ? 'created' : 'system' };
  await writeEntry(riskId, after, before, ctx, { transaction: options.transaction, created: before === null });
};

const flush = async (store) => {
  for (const [riskId, p] of store.pending) {
    try {
      await writeEntry(riskId, p.after, p.before, store.ctx, { created: p.created });
    } catch (e) {
      console.error('[RiskHistory] Could not write history entry:', String(e.message).replace(/[\r\n]+/g, ' '));
    }
  }
  store.pending.clear();
};

// ── Hooks (models/index.js) ─────────────────────────────────────────────────

const onRiskCreated = async (risk, options = {}) => {
  delete risk._historyCreating;
  try {
    await record(risk.id, null, stateOf(k => risk.get(k)), options);
  } catch (e) {
    console.error('[RiskHistory] Hook (create) failed:', String(e.message).replace(/[\r\n]+/g, ' '));
  }
};

const onRiskUpdated = async (risk, options = {}) => {
  try {
    if (risk._historyCreating) return;
    const fields = Array.isArray(options.fields) ? options.fields : [];
    if (!fields.some(f => TRACKED.includes(f))) return;
    // _previousDataValues still holds the values before this save.
    const before = stateOf(k => (fields.includes(k) ? risk.previous(k) : risk.get(k)));
    const after = stateOf(k => risk.get(k));
    if (!changedFields(before, after).length) return;
    await record(risk.id, before, after, options);
  } catch (e) {
    console.error('[RiskHistory] Hook (update) failed:', String(e.message).replace(/[\r\n]+/g, ' '));
  }
};

/**
 * Confirmed periodic review without a change of values: one row with trigger
 * "review" (evidence that the risk was looked at, ISO 27005 10.5).
 */
const recordReview = async (risk, req, note, { transaction } = {}) => writeEntry(risk.id, stateOf(k => risk.get(k)), null, { trigger: 'review', req, note }, { transaction, force: true, created: false });

// ── Upgrade (idempotent) ────────────────────────────────────────────────────

/**
 * One starting row per risk without any history row, from its current state,
 * marked baseline_at_upgrade. The partial unique index makes a second run (or
 * a second instance starting at the same moment) a no-op. last_reviewed_at of
 * risks from before 3.9.0 is taken from updated_at - the best evidence of the
 * last assessment the data has.
 */
const ensureBaseline = async () => {
  const { sequelize } = models();
  await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_history_baseline ON risk_assessment_history (risk_id) WHERE \"trigger\" = 'baseline_at_upgrade'");
  const [, meta] = await sequelize.query(`
    INSERT INTO risk_assessment_history
      (risk_id, recorded_at, "trigger", trigger_detail, user_id, user_name, methodology_id, methodology_version,
       likelihood, impact, impact_dimensions, inherent_level, residual_likelihood, residual_impact, residual_level, residual_override,
       target_likelihood, target_impact, target_level, changed_fields, note)
    SELECT r.id, now(), 'baseline_at_upgrade', 'baseline at upgrade', NULL, NULL, r.methodology_id, m.version,
       r.likelihood, r.impact, r.impact_dimensions, r.inherent_level::text::"enum_risk_assessment_history_inherent_level",
       r.residual_likelihood, r.residual_impact, r.residual_level::text::"enum_risk_assessment_history_residual_level", COALESCE(r.residual_override, false),
       r.target_likelihood, r.target_impact, r.target_level::text::"enum_risk_assessment_history_target_level", '[]'::jsonb,
       'Starting entry from the assessment at the time of the upgrade (3.9.0); earlier changes are in the audit log.'
    FROM risks r
    LEFT JOIN risk_methodologies m ON m.id = r.methodology_id
    WHERE NOT EXISTS (SELECT 1 FROM risk_assessment_history h WHERE h.risk_id = r.id)
    ON CONFLICT DO NOTHING`);
  const inserted = typeof meta === 'number' ? meta : (meta?.rowCount ?? 0);
  const [, meta2] = await sequelize.query('UPDATE risks SET last_reviewed_at = COALESCE(updated_at, created_at) WHERE last_reviewed_at IS NULL');
  const reviewed = typeof meta2 === 'number' ? meta2 : (meta2?.rowCount ?? 0);
  return { baseline: inserted, last_reviewed_set: reviewed };
};

// ── Read ────────────────────────────────────────────────────────────────────

const score = (l, i) => (l != null && i != null ? Number(l) * Number(i) : null);
const present = (row) => {
  const j = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  return {
    ...j,
    inherent_score: score(j.likelihood, j.impact),
    residual_score: score(j.residual_likelihood, j.residual_impact),
    target_score: score(j.target_likelihood, j.target_impact),
  };
};

const listHistory = async (risk, user, { limit = 500 } = {}) => {
  const riskSvc = require('./riskService');
  if (!riskSvc.canViewRisk(user, risk)) throw httpError(403, 'Forbidden');
  const { RiskAssessmentHistory, User } = models();
  const n = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);
  const rows = await RiskAssessmentHistory.findAll({
    where: { risk_id: risk.id },
    include: [{ model: User, as: 'user', attributes: ['id', 'name'] }],
    order: [['recorded_at', 'DESC'], ['id', 'DESC']],
    limit: n,
  });
  return rows.reverse().map(present);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (v, label) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw httpError(400, `${label}: Datum JJJJ-MM-TT angeben.`);
  const d = new Date(`${v}T23:59:59.999Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw httpError(400, `${label}: ungültiges Datum.`);
  return d;
};

// Last row per risk recorded up to the end of `day` (UTC).
const stateAt = async (end) => {
  const { sequelize } = models();
  const [rows] = await sequelize.query(`
    SELECT DISTINCT ON (h.risk_id) h.risk_id, h.likelihood, h.impact, h.inherent_level, h.residual_likelihood, h.residual_impact, h.residual_level, h.methodology_id
    FROM risk_assessment_history h
    WHERE h.recorded_at <= :end
    ORDER BY h.risk_id, h.recorded_at DESC, h.id DESC`, { replacements: { end } });
  return new Map(rows.map(r => [r.risk_id, r]));
};

const cellOf = (row, basis) => {
  const useNet = basis === 'residual' && row.residual_likelihood != null && row.residual_impact != null;
  return {
    likelihood: Number(useNet ? row.residual_likelihood : row.likelihood),
    impact: Number(useNet ? row.residual_impact : row.impact),
    level: (useNet ? row.residual_level : row.inherent_level) || null,
  };
};

/**
 * Trend heat map: compares the assessments valid at two dates. For every risk
 * with a history row at both dates: the cell (likelihood x impact) at `from`
 * and at `to`, aggregated into moves; plus level transitions, which stay
 * meaningful across methodology versions with different matrix sizes.
 * basis: 'residual' (net, falls back to gross where there is no net) or
 * 'inherent' (gross). Counts only - no titles, so the register list rights
 * (risks.view) suffice.
 */
const trendHeatmap = async ({ from, to, basis = 'residual' } = {}) => {
  const b = basis === 'inherent' ? 'inherent' : 'residual';
  const fromEnd = parseDay(from, 'Von');
  const toEnd = parseDay(to, 'Bis');
  if (fromEnd > toEnd) throw httpError(400, '„Von“ liegt nach „Bis“.');
  const { Risk } = models();
  const [atFrom, atTo, risks] = await Promise.all([stateAt(fromEnd), stateAt(toEnd), Risk.findAll({ attributes: ['id', 'status', 'methodology_id'], raw: true })]);
  const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
  const cells = (map) => {
    const acc = new Map();
    for (const row of map.values()) {
      const c = cellOf(row, b);
      if (!Number.isInteger(c.likelihood) || !Number.isInteger(c.impact)) continue;
      const key = `${c.likelihood}x${c.impact}`;
      const cur = acc.get(key) || { likelihood: c.likelihood, impact: c.impact, count: 0 };
      cur.count++;
      acc.set(key, cur);
    }
    return [...acc.values()].sort((x, y) => (y.likelihood - x.likelihood) || (x.impact - y.impact));
  };
  const moves = new Map();
  const transitions = new Map();
  const summary = { compared: 0, improved: 0, worsened: 0, unchanged: 0, moved_cell: 0, new_since: 0, no_data: 0 };
  const existing = new Set(risks.map(r => r.id));
  for (const id of existing) {
    const a = atFrom.get(id);
    const z = atTo.get(id);
    if (!z) { summary.no_data++; continue; }
    if (!a) { summary.new_since++; continue; }
    summary.compared++;
    const ca = cellOf(a, b);
    const cz = cellOf(z, b);
    const ra = rm.rank(ca.level);
    const rz = rm.rank(cz.level);
    if (rz < ra) summary.improved++;
    else if (rz > ra) summary.worsened++;
    else summary.unchanged++;
    if (ca.likelihood !== cz.likelihood || ca.impact !== cz.impact) summary.moved_cell++;
    const mk = `${ca.likelihood}x${ca.impact}>${cz.likelihood}x${cz.impact}`;
    const m = moves.get(mk) || { from: { likelihood: ca.likelihood, impact: ca.impact, level: ca.level }, to: { likelihood: cz.likelihood, impact: cz.impact, level: cz.level }, count: 0 };
    m.count++;
    moves.set(mk, m);
    const tk = `${ca.level}>${cz.level}`;
    const t = transitions.get(tk) || { from_level: ca.level, to_level: cz.level, count: 0 };
    t.count++;
    transitions.set(tk, t);
  }
  const only = (map) => new Map([...map].filter(([id]) => existing.has(id)));
  return {
    from, to, basis: b,
    likelihood_size: active.likelihood_levels.length,
    impact_size: active.impact_levels.length,
    risk_levels: active.risk_levels,
    cells_from: cells(only(atFrom)),
    cells_to: cells(only(atTo)),
    moves: [...moves.values()].sort((x, y) => y.count - x.count),
    level_transitions: [...transitions.values()].sort((x, y) => rm.rank(x.from_level) - rm.rank(y.from_level) || rm.rank(x.to_level) - rm.rank(y.to_level)),
    summary,
  };
};

module.exports = {
  TRACKED, REVIEW_TRIGGERS, withHistory, onRiskCreated, onRiskUpdated, recordReview, ensureBaseline, listHistory, trendHeatmap,
  resolveTrigger, changedFields, stateOf, parseDay, present,
  // For tests: is a service operation in progress?
  inOperation: () => !!als.getStore(),
};
