#!/usr/bin/env node
'use strict';

/**
 * Integration test against a THROWAWAY Postgres database: risk monitoring
 * (3.9.0).
 *
 *   1. Assessment history: one immutable row per change (coalesced per
 *      operation), trigger and user, residual recalculation, override,
 *      reassessment, carry-over, write paths outside the service, record
 *      rights, baseline at upgrade (idempotent).
 *   2. Trend heat map between two dates.
 *   3. Review cycles in the methodology; overdue review -> flag + task, once;
 *      confirmed review resolves flags and tasks.
 *   4. Triggers: incident, audit finding, threat advisory, CVE - dedup per
 *      risk and trigger type, one open task, concurrency, task done resolves.
 *   5. KRIs: breach once per breach, back within threshold, validation.
 *   6. Expiring and expired risk acceptances: notices once per stage.
 *   7. Summary figures, reassessment list visibility, job slot.
 *
 * Runs only with RISK_MONITORING_TEST_DB=1 and DB_* pointing at an empty test
 * database - schema public is dropped:
 *
 *   RISK_MONITORING_TEST_DB=1 DB_HOST=/tmp DB_PORT=55434 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x ENCRYPTION_KEY=x node scripts/test-risk-monitoring-db.js
 */

if (process.env.RISK_MONITORING_TEST_DB !== '1') {
  console.log('Skipped (set RISK_MONITORING_TEST_DB=1 and DB_* for a throwaway database).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const { Op } = require(path.join(SRC, '..', 'node_modules', 'sequelize'));

let failures = 0;
const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
};
const eq = (label, actual, expected) => {
  const ok = stable(actual) === stable(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await (typeof p === 'function' ? p() : p); return 'ok'; } catch (e) { if (process.env.DEBUG_TEST) console.log('   ', e.message); return e.status || e.name; } };
const daysFromToday = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const rm = require(path.join(SRC, 'services', 'riskMethodology'));
  const svc = require(path.join(SRC, 'services', 'riskService'));
  const cats = require(path.join(SRC, 'services', 'riskCategoryService'));
  const acc = require(path.join(SRC, 'services', 'riskAcceptanceService'));
  const hist = require(path.join(SRC, 'services', 'riskHistoryService'));
  const mon = require(path.join(SRC, 'services', 'riskMonitoringService'));
  const { withJobSlot } = require(path.join(SRC, 'utils', 'jobLock'));

  await m.sequelize.sync({ alter: { drop: false } });
  await rm.ensureDefaultProfile();
  await cats.ensureCategories();
  await acc.ensureIndexes();
  await mon.ensureIndexes();
  await hist.ensureBaseline();
  const mkUser = (name, role) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role });
  const admin = await mkUser('admin', 'admin');
  const assessor = await mkUser('assessor', 'assessor');
  const owner = await mkUser('owner', 'owner');
  const other = await mkUser('other', 'owner');
  const mgmt = await mkUser('mgmt', 'management');
  const req = (u) => ({ user: { id: u.id, name: u.name, role: u.role } });
  const R = { likelihood_rationale: 'Observed twice.', impact_rationale: 'Customer data.' };
  const upd = (risk, body, u = admin) => svc.updateRisk(risk, body, u, req(u), { partial: true });
  const reload = (id) => m.Risk.findByPk(id);
  const rows = (riskId) => m.RiskAssessmentHistory.findAll({ where: { risk_id: riskId }, order: [['id', 'ASC']] });
  const lastAudit = async (type, id) => m.AuditLog.findOne({ where: { entity_type: type, entity_id: id }, order: [['id', 'DESC']] });

  console.log('Assessment history:');
  const r1 = await svc.createRisk({ title: 'Ransomware', owner_id: owner.id, likelihood: 3, impact: 3, target_likelihood: 1, target_impact: 2, ...R }, admin, req(admin));
  let h = await rows(r1.id);
  eq('create: one row, trigger created, user, values and levels, methodology version', h.map(x => [x.trigger, x.user_id, x.user_name, x.likelihood, x.impact, x.inherent_level, x.residual_level, x.target_level, x.methodology_version]), [['created', admin.id, 'admin', 3, 3, 'medium', 'medium', 'low', 1]]);
  eq('create sets last_reviewed_at', !!(await reload(r1.id)).last_reviewed_at, true);
  await upd(await reload(r1.id), { likelihood: 4, likelihood_rationale: 'More attacks.' }, owner);
  h = await rows(r1.id);
  eq('value change: ONE coalesced row (values + recalculated net), trigger assessment, changed fields', [h.length, h[1].trigger, h[1].user_id, h[1].likelihood, h[1].residual_likelihood, h[1].inherent_level, h[1].changed_fields], [2, 'assessment', owner.id, 4, 4, 'high', ['likelihood', 'inherent_level', 'residual_likelihood', 'residual_level']]);
  await upd(await reload(r1.id), { title: 'Ransomware (renamed)' });
  eq('title-only change: no history row', (await rows(r1.id)).length, 2);
  const ctrl = await m.Control.create({ framework: 'custom', code: 'C-1', title: 'Backup', status: 'implemented' });
  await upd(await reload(r1.id), { controls: [{ id: ctrl.id, effectiveness: 5 }] });
  h = await rows(r1.id);
  eq('control linked: net risk recalculated -> trigger residual_recalculated, gross unchanged', [h.length, h[2].trigger, h[2].likelihood, h[2].residual_likelihood < 4], [3, 'residual_recalculated', 4, true]);
  await svc.overrideResidual(await reload(r1.id), { override: true, residual_likelihood: 2, residual_impact: 2, reason: 'Pen test result.' }, assessor, req(assessor));
  h = await rows(r1.id);
  eq('override: trigger residual_override with the reason as note', [h[3].trigger, h[3].residual_override, h[3].residual_likelihood, h[3].note, h[3].user_id], ['residual_override', true, 2, 'Pen test result.', assessor.id]);
  eq('history rows are immutable (update and destroy refused)', [await status(h[0].update({ likelihood: 1 })), await status(h[0].destroy()), await status(m.RiskAssessmentHistory.destroy({ where: { id: h[0].id } }))], [409, 409, 409]);
  const list = await hist.listHistory(await reload(r1.id), owner);
  eq('listHistory: owner sees rows with scores, oldest first', [list.length, list[0].inherent_score, list[1].inherent_score], [4, 9, 12]);
  eq('listHistory: other owner → 403', await status(hist.listHistory(await reload(r1.id), other)), 403);
  // Write path outside the service (like the threat advisory route).
  const direct = await m.Risk.create({ title: 'From advisory', likelihood: 2, impact: 2, owner_id: owner.id });
  eq('Risk.create outside the service: row "created" without user', (await rows(direct.id)).map(x => [x.trigger, x.user_id]), [['created', null]]);
  await (await reload(direct.id)).update({ impact: 4 });
  eq('Risk.update outside the service: row "system"', (await rows(direct.id)).map(x => x.trigger), ['created', 'system']);

  // Reassessment and carry-over after a new methodology version.
  const v2 = JSON.parse(JSON.stringify(rm.DEFAULT_PROFILE));
  v2.risk_levels = v2.risk_levels.map(l => (l.key === 'medium' ? { ...l, max_score: 7 } : l.key === 'high' ? { ...l, min_score: 8 } : l));
  await rm.saveNewVersion(v2, admin, { changeNote: 'thresholds' });
  const rc = await svc.carryOver([direct.id], req(admin));
  eq('carry-over: row with trigger carry_over, new version', [rc.carried.length, (await rows(direct.id)).slice(-1).map(x => [x.trigger, x.methodology_version])[0]], [1, ['carry_over', 2]]);
  await upd(await reload(r1.id), { reassess: true, likelihood: 3, impact: 3, ...R });
  eq('reassessment: trigger reassessment, version 2', (await rows(r1.id)).slice(-1).map(x => [x.trigger, x.methodology_version, x.residual_override])[0], ['reassessment', 2, false]);

  // Baseline at upgrade.
  const legacy = await m.Risk.create({ title: 'Legacy', likelihood: 2, impact: 3 });
  await sequelize.query(`DELETE FROM risk_assessment_history WHERE risk_id = ${legacy.id}`);
  await sequelize.query(`UPDATE risks SET last_reviewed_at = NULL, updated_at = '2026-01-15T10:00:00Z' WHERE id = ${legacy.id}`);
  const b1 = await hist.ensureBaseline();
  const b2 = await hist.ensureBaseline();
  const lh = await rows(legacy.id);
  eq('baseline: one row for the risk without history, marked, idempotent', [b1.baseline, b2.baseline, lh.length, lh[0].trigger, lh[0].trigger_detail, lh[0].likelihood, lh[0].impact, lh[0].inherent_level], [1, 0, 1, 'baseline_at_upgrade', 'baseline at upgrade', 2, 3, 'medium']);
  eq('baseline: last_reviewed_at taken from updated_at, once', [b1.last_reviewed_set, b2.last_reviewed_set, new Date((await reload(legacy.id)).last_reviewed_at).toISOString().slice(0, 10)], [1, 0, '2026-01-15']);
  eq('baseline index refuses a second baseline row', await status(sequelize.query(`INSERT INTO risk_assessment_history (risk_id, recorded_at, "trigger", residual_override, changed_fields) VALUES (${legacy.id}, now(), 'baseline_at_upgrade', false, '[]')`)), 'SequelizeUniqueConstraintError');

  console.log('\nTrend heat map:');
  const tA = await m.Risk.create({ title: 'Trend A', likelihood: 4, impact: 4 });
  const tB = await m.Risk.create({ title: 'Trend B', likelihood: 1, impact: 1 });
  // Rows are immutable through the model; the test moves them in time with SQL.
  await sequelize.query(`UPDATE risk_assessment_history SET recorded_at = now() - interval '100 days' WHERE risk_id IN (${tA.id}, ${tB.id})`);
  await (await reload(tA.id)).update({ likelihood: 1 });
  await (await reload(tB.id)).update({ impact: 5, likelihood: 4 });
  const trend = await hist.trendHeatmap({ from: daysFromToday(-95), to: daysFromToday(0), basis: 'inherent' });
  const mv = (id1, id2) => trend.moves.find(x => x.from.likelihood === id1.l && x.from.impact === id1.i && x.to.likelihood === id2.l && x.to.impact === id2.i);
  eq('moves: A 4x4 → 1x4, B 1x1 → 4x5', [mv({ l: 4, i: 4 }, { l: 1, i: 4 })?.count, mv({ l: 1, i: 1 }, { l: 4, i: 5 })?.count], [1, 1]);
  eq('summary: 2 compared, 1 improved, 1 worsened, others new since', [trend.summary.compared, trend.summary.improved, trend.summary.worsened, trend.summary.new_since > 0], [2, 1, 1, true]);
  eq('cells at from contain 4x4 and 1x1', [trend.cells_from.some(c => c.likelihood === 4 && c.impact === 4), trend.cells_from.some(c => c.likelihood === 1 && c.impact === 1)], [true, true]);
  eq('invalid date / from after to → 400', [await status(hist.trendHeatmap({ from: '2026-02-30', to: daysFromToday(0) })), await status(hist.trendHeatmap({ from: daysFromToday(0), to: daysFromToday(-1) })), await status(hist.trendHeatmap({ from: "2026-01-01' OR 1=1", to: daysFromToday(0) }))], [400, 400, 400]);

  console.log('\nReview cycles and periodic review:');
  const bad = JSON.parse(JSON.stringify(rm.DEFAULT_PROFILE));
  bad.review_cycles = [{ level: 'low', months: 0 }, { level: 'nope', months: 3 }];
  eq('validation: months 1-120, known levels only', rm.validateProfile(bad).errors.map(e => e.field).sort(), ['review_cycles', 'review_cycles.low']);
  eq('not sent: default cycles', rm.validateProfile({ ...rm.DEFAULT_PROFILE, review_cycles: undefined }).profile.review_cycles, rm.DEFAULT_REVIEW_CYCLES);
  eq('NULL on a version from before 3.9.0 = default cycles', rm.reviewCyclesOf({ review_cycles: null }), rm.DEFAULT_REVIEW_CYCLES);
  const v3 = JSON.parse(JSON.stringify(v2));
  v3.review_cycles = [{ level: 'low', months: null }, { level: 'medium', months: 6 }, { level: 'high', months: 3 }, { level: 'critical', months: 1 }];
  const saved = await rm.saveNewVersion(v3, admin, { changeNote: 'review cycles' });
  eq('changed cycles: new version 3, active', [saved.profile.version, rm.reviewCyclesOf(saved.profile).map(c => c.months)], [3, [null, 6, 3, 1]]);
  eq('same cycles again: no new version (400)', await status(rm.saveNewVersion(v3, admin, {})), 400);
  const rv = await svc.createRisk({ title: 'Review me', owner_id: owner.id, likelihood: 2, impact: 3, ...R }, admin, req(admin));
  await sequelize.query(`UPDATE risks SET last_reviewed_at = now() - interval '200 days' WHERE id = ${rv.id}`);
  let d = await svc.loadFull(rv.id);
  eq('medium (6 months), last review 200 days ago → overdue, source cycle', [d.effective_level, d.review_cycle_months, d.review_overdue, d.next_review_source], ['medium', 6, true, 'cycle']);
  const lowRisk = await svc.createRisk({ title: 'Low risk', owner_id: owner.id, likelihood: 1, impact: 1, review_date: daysFromToday(-1), ...R }, admin, req(admin));
  d = await svc.loadFull(lowRisk.id);
  eq('low (no cycle) with review_date yesterday → overdue via review_date', [d.review_cycle_months, d.next_review_due, d.next_review_source, d.review_overdue], [null, daysFromToday(-1), 'review_date', true]);
  const run1 = await mon.runDailyMonitoring();
  const run2 = await mon.runDailyMonitoring();
  const rvFlags = await m.RiskReviewFlag.findAll({ where: { risk_id: rv.id } });
  const rvTask = await m.Task.findByPk(rvFlags[0]?.task_id);
  eq('daily run: overdue → flag review_overdue + task for the owner; second run adds nothing', [rvFlags.length, rvFlags[0]?.trigger_type, rvTask?.assigned_to_id, rvTask?.related_type, rvTask?.related_id, run1.flagged >= 1, run2.flagged, await m.Task.count({ where: { related_type: 'risk', related_id: rv.id } })], [1, 'review_overdue', owner.id, 'risk', rv.id, true, 0, 1]);
  eq('owner notified once', await m.Notification.count({ where: { user_id: owner.id, title: 'Risiko neu bewerten', content: { [Op.like]: `${rv.ref}%` } } }), 1);
  eq('flag raise audit-logged', (await m.AuditLog.findOne({ where: { entity_type: 'risk', entity_id: rv.id }, order: [['id', 'DESC']] })).details.action, 'review_flag_raised');
  eq('review without note → 400; other owner → 403', [await status(mon.reviewRisk(await reload(rv.id), {}, owner, req(owner))), await status(mon.reviewRisk(await reload(rv.id), { note: 'x' }, other, req(other)))], [400, 403]);
  eq('flag_ids of another risk → 400', await status(mon.reviewRisk(await reload(rv.id), { note: 'x', flag_ids: [999999] }, owner, req(owner))), 400);
  d = await mon.reviewRisk(await reload(rv.id), { note: 'Reviewed with the IT lead, unchanged.', status: 'closed' }, owner, req(owner));
  const rvFlag = await m.RiskReviewFlag.findByPk(rvFlags[0].id);
  eq('review: flag resolved (reviewed), task done by the reviewer, not overdue, status untouched', [rvFlag.status, rvFlag.resolution, rvFlag.resolved_by_id, (await m.Task.findByPk(rvTask.id)).status, (await m.Task.findByPk(rvTask.id)).completed_by_id, d.review_overdue, d.status], ['resolved', 'reviewed', owner.id, 'done', owner.id, false, 'open']);
  eq('review: history row "review" with the note, values unchanged', (await rows(rv.id)).slice(-1).map(x => [x.trigger, x.note, x.changed_fields, x.likelihood])[0], ['review', 'Reviewed with the IT lead, unchanged.', [], 2]);
  // Overdue again, then the condition clears without a review (review_date moved).
  await mon.runDailyMonitoring();
  eq('low risk: flag raised via review_date', await m.RiskReviewFlag.count({ where: { risk_id: lowRisk.id, status: 'open', trigger_type: 'review_overdue' } }), 1);
  await upd(await reload(lowRisk.id), { review_date: daysFromToday(30) });
  await mon.runDailyMonitoring();
  const cleared = await m.RiskReviewFlag.findOne({ where: { risk_id: lowRisk.id } });
  eq('review_date moved → flag resolved as condition_cleared', [cleared.status, cleared.resolution], ['resolved', 'condition_cleared']);

  console.log('\nTriggers:');
  const mkAsset = (name) => m.Asset.create({ name, type: 'hardware', classification: 'internal', owner_id: owner.id, assessor_id: assessor.id });
  const srv = await mkAsset('Mail server');
  const fw = await mkAsset('Firewall');
  const unrelated = await mkAsset('Printer');
  const tr1 = await svc.createRisk({ title: 'Mail compromise', owner_id: owner.id, likelihood: 3, impact: 4, asset_ids: [srv.id], ...R }, admin, req(admin));
  const tr2 = await svc.createRisk({ title: 'Perimeter breach', owner_id: other.id, likelihood: 2, impact: 4, scenarios: [{ asset_ids: [fw.id], description: 'FW bypass' }], ...R }, admin, req(admin));
  const trClosed = await svc.createRisk({ title: 'Old', owner_id: owner.id, likelihood: 2, impact: 2, asset_ids: [srv.id], ...R }, admin, req(admin));
  await upd(await reload(trClosed.id), { status: 'closed' });
  const inc = await m.Incident.create({ title: 'Phishing on mail', severity: 'medium', reporter_id: admin.id });
  await inc.setAssets([srv.id, fw.id]);
  const ri = await mon.onIncident(inc, { created: true }, req(admin));
  const f1 = await m.RiskReviewFlag.findOne({ where: { risk_id: tr1.id, trigger_type: 'incident' } });
  const f2 = await m.RiskReviewFlag.findOne({ where: { risk_id: tr2.id, trigger_type: 'incident' } });
  eq('incident on assets: risks via direct link and via scenario flagged, closed risk not', [ri.flagged, !!f1, !!f2, await m.RiskReviewFlag.count({ where: { risk_id: trClosed.id } })], [2, true, true, 0]);
  eq('reason names the incident and assets; task for the respective owner', [f1.reason.includes('Phishing on mail') && f1.reason.includes('Mail server'), (await m.Task.findByPk(f2.task_id)).assigned_to_id], [true, other.id]);
  eq('assessment of the risk unchanged by the trigger', [(await reload(tr1.id)).likelihood, (await reload(tr1.id)).impact], [3, 4]);
  eq('same event again → nothing new', (await mon.onIncident(inc, { created: true }, req(admin))).flagged, 0);
  await inc.update({ severity: 'high' });
  await mon.onIncident(inc, { previousSeverity: 'medium', addedAssetIds: [], addedRiskIds: [] }, req(admin));
  const f1b = await m.RiskReviewFlag.findByPk(f1.id);
  eq('severity raised → occurrence appended to the open flag, no second task', [f1b.occurrence_count, await m.RiskReviewFlag.count({ where: { risk_id: tr1.id, status: 'open', trigger_type: 'incident' } }), await m.Task.count({ where: { related_type: 'risk', related_id: tr1.id, status: 'open' } })], [2, 1, 1]);
  await inc.update({ severity: 'low' });
  eq('severity lowered → no trigger', (await mon.onIncident(inc, { previousSeverity: 'high', addedAssetIds: [], addedRiskIds: [] }, req(admin))).flagged, 0);
  const inc2 = await m.Incident.create({ title: 'Printer jam', severity: 'low' });
  await inc2.setAssets([unrelated.id]);
  eq('incident on an unrelated asset → nothing', (await mon.onIncident(inc2, { created: true })).flagged, 0);
  const incDel = await m.Incident.create({ title: 'Deleted', severity: 'critical', deleted: true });
  await incDel.setAssets([srv.id]);
  eq('deleted incident → nothing', (await mon.onIncident(incDel, { created: true })).flagged, 0);
  eq('partial unique index: second open flag of the same type refused', await status(m.RiskReviewFlag.create({ risk_id: tr1.id, trigger_type: 'incident', reason: 'race' })), 'SequelizeUniqueConstraintError');
  // Concurrent events for the same risk and type.
  const tr3 = await svc.createRisk({ title: 'Concurrency', owner_id: owner.id, likelihood: 2, impact: 2, ...R }, admin, req(admin));
  const risk3 = await reload(tr3.id);
  await Promise.all([1, 2, 3, 4].map(i => mon.raiseFlag({ risk: risk3, triggerType: 'audit_finding', sourceType: 'audit_finding', sourceId: 100 + i, reason: `F${i}` })));
  const cf = await m.RiskReviewFlag.findAll({ where: { risk_id: tr3.id } });
  eq('4 concurrent events: one flag with 4 occurrences, one task', [cf.length, cf[0].occurrence_count, await m.Task.count({ where: { related_type: 'risk', related_id: tr3.id } })], [1, 4, 1]);
  // Task done resolves the flag; a new event then opens a new flag and task.
  const t1 = await m.Task.findByPk(f1.task_id);
  await t1.update({ status: 'done', completed_by_id: owner.id, completed_at: new Date() });
  const f1c = await m.RiskReviewFlag.findByPk(f1.id);
  eq('task done → flag resolved (task_done), logged', [f1c.status, f1c.resolution, f1c.resolved_by_id, (await lastAudit('risk', tr1.id)).details.action], ['resolved', 'task_done', owner.id, 'review_flags_resolved']);
  await m.Task.update({ status: 'done' }, { where: { id: f2.task_id } });
  eq('bulk task update done → flag resolved', (await m.RiskReviewFlag.findByPk(f2.id)).status, 'resolved');
  const inc3 = await m.Incident.create({ title: 'Second phishing', severity: 'critical' });
  await inc3.setAssets([srv.id]);
  await mon.onIncident(inc3, { created: true });
  eq('new incident after resolution: new open flag and new task', [await m.RiskReviewFlag.count({ where: { risk_id: tr1.id, trigger_type: 'incident' } }), await m.Task.count({ where: { related_type: 'risk', related_id: tr1.id, status: 'open' } })], [2, 1]);
  // (b) audit finding
  const audit = await m.Audit.create({ title: 'ISO audit' });
  const finding = await m.AuditFinding.create({ audit_id: audit.id, title: 'Backups untested', severity: 'major' });
  await finding.setRisks([tr1.id]);
  eq('audit finding linked to a risk → flag audit_finding', [(await mon.onAuditFinding(finding, [tr1.id], req(admin))).flagged, await m.RiskReviewFlag.count({ where: { risk_id: tr1.id, trigger_type: 'audit_finding', status: 'open' } })], [1, 1]);
  // (c) threat advisory
  const adv = await m.ThreatAdvisory.create({ title: 'Exchange RCE', severity: 'critical', relevance: 'not_relevant' });
  await m.ThreatAdvisoryAsset.create({ advisory_id: adv.id, asset_id: srv.id, match_source: 'manual', confirmed: true });
  await m.ThreatAdvisoryAsset.create({ advisory_id: adv.id, asset_id: fw.id, match_source: 'cve_match', confirmed: false });
  eq('advisory not relevant → nothing', (await mon.onThreatAdvisory(adv, {})).flagged, 0);
  await adv.update({ relevance: 'critical' });
  const ra = await mon.onThreatAdvisory(adv, {}, req(admin));
  eq('advisory critical: only confirmed assets count (mail server, not the firewall suggestion)', [ra.flagged, await m.RiskReviewFlag.count({ where: { trigger_type: 'threat_advisory' } }), await m.RiskReviewFlag.count({ where: { risk_id: tr2.id, trigger_type: 'threat_advisory' } })], [1, 1, 0]);
  // (d) CVE
  await srv.update({ cve_ids: [{ id: 'CVE-2026-0001', severity: 'medium' }] });
  eq('only a medium CVE → no flag', await m.RiskReviewFlag.count({ where: { trigger_type: 'cve' } }), 0);
  await srv.update({ cve_ids: [{ id: 'CVE-2026-0001', severity: 'medium' }, { id: 'CVE-2026-0002', severity: 'critical' }] });
  const cveFlag = await m.RiskReviewFlag.findOne({ where: { risk_id: tr1.id, trigger_type: 'cve' } });
  eq('new critical CVE on the asset → flag cve naming the CVE', [!!cveFlag, cveFlag && cveFlag.reason.includes('CVE-2026-0002')], [true, true]);
  await srv.update({ cve_ids: [{ id: 'CVE-2026-0002', severity: 'critical' }], name: 'Mail server' });
  await srv.update({ cve_ids: [{ id: 'CVE-2026-0002', severity: 'critical' }, { id: 'CVE-2026-0003', severity: 'high' }] });
  eq('known CVE again → nothing; new high CVE → occurrence on the open flag', [(await m.RiskReviewFlag.findByPk(cveFlag.id)).occurrence_count, await m.RiskReviewFlag.count({ where: { trigger_type: 'cve', status: 'open' } })], [2, 1]);
  eq('newSevereCves helper', mon.newSevereCves([{ id: 'A', severity: 'low' }], [{ id: 'A', severity: 'critical' }, { id: 'B', severity: 'high' }, { id: 'C', severity: 'low' }, { id: 1 }]), ['B']);

  console.log('\nKRIs:');
  const kpi = await m.Kpi.create({ title: 'Phishing click rate', target: '< 5 %' });
  const kr = await reload(tr3.id);
  eq('validation: no kpi, unknown kpi, bad threshold, bad direction', [await status(mon.createKri(kr, { threshold: 1 }, admin, req(admin))), await status(mon.createKri(kr, { kpi_id: 99999, threshold: 1 }, admin, req(admin))), await status(mon.createKri(kr, { kpi_id: kpi.id, threshold: 'abc' }, admin, req(admin))), await status(mon.createKri(kr, { kpi_id: kpi.id, threshold: 1, direction: 'sideways' }, admin, req(admin)))], [400, 400, 400, 400]);
  eq('other owner cannot link (record rights) → 403', await status(mon.createKri(kr, { kpi_id: kpi.id, threshold: 10 }, other, req(other))), 403);
  const link = await mon.createKri(kr, { kpi_id: kpi.id, threshold: '10', direction: 'above', id: 5, risk_id: tr1.id, breached: true }, owner, req(owner));
  eq('created: allowlist (id/risk_id/breached not settable), no value yet', [link.risk_id, link.threshold, link.breached, link.evaluation.evaluated], [tr3.id, 10, false, false]);
  eq('duplicate link → 409', await status(mon.createKri(kr, { kpi_id: kpi.id, threshold: 3 }, owner, req(owner))), 409);
  const flagsKri = () => m.RiskReviewFlag.findAll({ where: { risk_id: tr3.id, trigger_type: 'kri' } });
  await m.KpiMeasurement.create({ kpi_id: kpi.id, measured_at: daysFromToday(-3), value: '5' });
  eq('value 5 (≤ 10) → not breached', [(await m.RiskKri.findByPk(link.id)).breached, Number((await m.RiskKri.findByPk(link.id)).last_value), (await flagsKri()).length], [false, 5, 0]);
  await m.KpiMeasurement.create({ kpi_id: kpi.id, measured_at: daysFromToday(-2), value: '12,5' });
  let kl = await m.RiskKri.findByPk(link.id);
  let kf = await flagsKri();
  eq('value 12,5 → breached once: flag kri + task, breach count 1', [kl.breached, Number(kl.breach_value), kl.breach_count, kf.length, !!kf[0].task_id], [true, 12.5, 1, 1, true]);
  await m.KpiMeasurement.create({ kpi_id: kpi.id, measured_at: daysFromToday(-1), value: '15' });
  eq('still breached → no new event', [(await flagsKri())[0].occurrence_count, (await m.RiskKri.findByPk(link.id)).breach_count], [1, 1]);
  await m.KpiMeasurement.create({ kpi_id: kpi.id, measured_at: daysFromToday(0), value: 'n/a' });
  eq('non-numeric measurement: not evaluated, state kept', (await m.RiskKri.findByPk(link.id)).breached, true);
  await m.KpiMeasurement.create({ kpi_id: kpi.id, measured_at: daysFromToday(1), value: '8 %' });
  eq('value 8 % → back within threshold (flag stays open until reviewed)', [(await m.RiskKri.findByPk(link.id)).breached, (await flagsKri())[0].status], [false, 'open']);
  await m.KpiMeasurement.create({ kpi_id: kpi.id, measured_at: daysFromToday(2), value: '20' });
  kl = await m.RiskKri.findByPk(link.id);
  kf = await flagsKri();
  eq('second breach: count 2, occurrence on the open flag, still one open task', [kl.breach_count, kf.length, kf[0].occurrence_count, await m.Task.count({ where: { related_type: 'risk', related_id: tr3.id, status: 'open', tags: { [Op.contains]: ['kri'] } } })], [2, 1, 2, 1]);
  const below = await mon.updateKri(kr, await m.RiskKri.findByPk(link.id), { direction: 'below', threshold: 30, kpi_id: kpi.id }, owner, req(owner));
  eq('update to "below 30": value 20 still breached (no new event), logged', [below.direction, below.threshold, below.breached, (await lastAudit('risk_kri', link.id)).action], ['below', 30, true, 'update']);
  eq('changing the KPI of a link → 400', await status(mon.updateKri(kr, await m.RiskKri.findByPk(link.id), { kpi_id: 999 }, owner, req(owner))), 400);
  const listK = await mon.listKris(kr, owner);
  eq('listKris with KPI title; risk detail counts', [listK[0].kpi.title, (await svc.loadFull(tr3.id)).kri_breached, (await svc.loadFull(tr3.id)).kri_count], ['Phishing click rate', 1, 1]);
  eq('parseValue', [mon.parseValue('12,5'), mon.parseValue('80 %'), mon.parseValue('-3'), mon.parseValue('1e9'), mon.parseValue('9'.repeat(40)), mon.parseValue(7)], [12.5, 80, -3, null, null, 7]);
  await mon.deleteKri(kr, await m.RiskKri.findByPk(link.id), owner, req(owner));
  eq('unlink: link gone, KPI stays, logged', [await m.RiskKri.count({ where: { id: link.id } }), await m.Kpi.count({ where: { id: kpi.id } }), (await lastAudit('risk_kri', link.id)).action], [0, 1, 'delete']);

  console.log('\nExpiring risk acceptances:');
  const ra1 = await svc.createRisk({ title: 'Accepted soon expiring', owner_id: owner.id, likelihood: 1, impact: 2, ...R }, admin, req(admin));
  await sequelize.query(`UPDATE risks SET status = 'accepted', accepted_by_id = ${mgmt.id}, accepted_at = now(), accepted_until = '${daysFromToday(10)}' WHERE id = ${ra1.id}`);
  const ra2 = await svc.createRisk({ title: 'Accepted expired', owner_id: owner.id, likelihood: 1, impact: 2, ...R }, admin, req(admin));
  await sequelize.query(`UPDATE risks SET status = 'accepted', accepted_by_id = ${owner.id}, accepted_at = now(), accepted_until = '${daysFromToday(-2)}' WHERE id = ${ra2.id}`);
  const ra3 = await svc.createRisk({ title: 'Accepted far', owner_id: owner.id, likelihood: 1, impact: 2, ...R }, admin, req(admin));
  await sequelize.query(`UPDATE risks SET status = 'accepted', accepted_by_id = ${mgmt.id}, accepted_at = now(), accepted_until = '${daysFromToday(90)}' WHERE id = ${ra3.id}`);
  // E-mail captured instead of SMTP.
  const mails = [];
  require(path.join(SRC, 'services', 'emailService')).sendEmail = async (msg) => { mails.push(msg); };
  await sequelize.query(`UPDATE risks SET title = 'Accepted <b>soon</b> expiring' WHERE id = ${ra1.id}`);
  const e1 = await mon.checkExpiringRiskAcceptances();
  const e2 = await mon.checkExpiringRiskAcceptances();
  eq('notices: expiring → owner + approver, expired → owner (= approver) once; second run none', [e1.risks, e1.notified, e2.notified], [2, 3, 0]);
  eq('e-mails: one per notice, to owner and approver, risk title escaped in HTML', [mails.length, e1.mailed, mails.map(x => x.to).sort(), mails.some(x => x.html.includes('&lt;b&gt;soon&lt;/b&gt;')), mails.some(x => x.html.includes('<b>soon'))], [3, 3, ['mgmt@test.invalid', 'owner@test.invalid', 'owner@test.invalid'], true, false]);
  eq('expiring notice to the approver (management)', await m.Notification.count({ where: { user_id: mgmt.id, title: 'Risikoakzeptanz läuft ab' } }), 1);
  eq('expired notice to the owner', await m.Notification.count({ where: { user_id: owner.id, title: 'Risikoakzeptanz abgelaufen' } }), 1);
  const dx = await svc.decorate(await m.Risk.findAll({ where: { id: [ra1.id, ra2.id, ra3.id] }, order: [['id', 'ASC']] }));
  eq('register flags: expiring (10 days), expired (red), far', dx.map(r => [r.acceptance_expiring, r.acceptance_expired, r.acceptance_days_left]), [[true, false, 10], [false, true, -2], [false, false, 90]]);
  await sequelize.query(`UPDATE risks SET accepted_until = '${daysFromToday(20)}' WHERE id = ${ra1.id}`);
  eq('renewed acceptance date → new notices', (await mon.checkExpiringRiskAcceptances()).notified, 2);

  console.log('\nLists, summary, job slot:');
  const la = await mon.listFlags(admin, {});
  const lo = await mon.listFlags(owner, {});
  const lx = await mon.listFlags(other, {});
  eq('reassessment list: admin all open, owner own risks only, reasons included', [la.length > lo.length, lo.every(f => f.risk.owner?.id === owner.id), lx.every(f => f.risk.owner?.id === other.id), typeof la[0].reason], [true, true, true, 'string']);
  eq('management sees all', (await mon.listFlags(mgmt, {})).length, la.length);
  eq('filters: trigger type, invalid values → 400', [(await mon.listFlags(admin, { trigger_type: 'cve' })).length, await status(mon.listFlags(admin, { trigger_type: 'x' })), await status(mon.listFlags(admin, { status: 'x' })), await status(mon.listFlags(admin, { risk_id: 'abc' }))], [1, 400, 400, 400]);
  eq('resolved list', (await mon.listFlags(admin, { status: 'resolved' })).every(f => f.status === 'resolved'), true);
  eq('per-risk flags: other owner → 403', await status(mon.listRiskFlags(await reload(tr1.id), other)), 403);
  const sum = await mon.monitoringSummary();
  eq('summary figures present and consistent', [typeof sum.overdue_reviews, sum.kri_breaches >= 0, sum.open_reassessments > 0, sum.open_reassessments_by_trigger.cve, sum.acceptances_expiring, sum.acceptances_expired, typeof sum.trend.improved], ['number', true, true, 1, 1, 1, 'number']);
  const list2 = await svc.decorate(await m.Risk.findAll({ where: { id: tr1.id } }));
  eq('register list: flag types, no reasons', [list2[0].needs_review, list2[0].review_flag_types.sort(), list2[0].openReviewFlags], [true, ['audit_finding', 'cve', 'incident', 'threat_advisory'], undefined]);
  let runs = 0;
  const job = () => withJobSlot('test-job', '2026-11-25', async () => { runs++; return 'ran'; });
  const [j1, j2] = await Promise.all([job(), (async () => { await new Promise(r => setTimeout(r, 5)); return withJobSlot('test-job', '2026-11-25', async () => { runs++; return 'ran'; }); })()]);
  const j3 = await job();
  eq('job slot: once per slot (also a later call in the same slot is skipped)', [runs, [j1, j2, j3].filter(x => x === 'ran').length, j3.skipped], [1, 1, true]);
  // A second "instance": slot taken in the database, not in this process.
  await m.JobRun.create({ name: 'other-instance', slot: 'S1', started_at: new Date(), holder: 'host-b:1' });
  eq('slot taken by another instance → skipped', (await withJobSlot('other-instance', 'S1', async () => 'ran')).skipped, true);
  eq('risk deleted → history, KRIs, flags deleted with it', await (async () => {
    await (await reload(tr3.id)).destroy();
    return [await m.RiskAssessmentHistory.count({ where: { risk_id: tr3.id } }), await m.RiskReviewFlag.count({ where: { risk_id: tr3.id } })];
  })(), [0, 0]);

  await m.sequelize.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
