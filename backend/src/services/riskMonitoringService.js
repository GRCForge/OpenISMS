'use strict';

/**
 * Risk monitoring and review (3.9.0) - ISO/IEC 27005:2022 clause 10,
 * ISO/IEC 27001:2022 8.2 and 9.1, NIS-2 Art. 21. One path for REST and MCP.
 *
 *   - Periodic review: the review cycle per level comes from the methodology
 *     (review_cycles); the next review is due that many months after the last
 *     assessment or confirmed review (risks.last_reviewed_at), or on the
 *     manual review_date if that is earlier. Overdue reviews are flagged and
 *     become a task for the risk owner.
 *   - Triggers for reassessment: a new or raised incident on an asset of the
 *     risk, a new audit finding linked to the risk, an assessed threat
 *     advisory with affected assets, a new critical/high CVE on an asset of
 *     the risk, a KRI breach. Each flags the risk "needs reassessment" with
 *     the reason and a task for the owner. Deduplicated: at most one open flag
 *     - and one open task - per risk and trigger type. The assessment itself
 *     is never changed automatically.
 *   - KRIs: existing KPIs linked to a risk with threshold and direction;
 *     evaluated on every new measurement and daily. A breach raises the flag
 *     once per breach.
 *   - Expiring risk acceptances: 30 days ahead and on expiry, in-app and by
 *     e-mail to the owner and the approver (services/reminderService.js).
 *   - Figures for the dashboard and the management report.
 */

const { Op, QueryTypes } = require('sequelize');
const { pick } = require('../utils/massAssignment');
const { auditFromReq } = require('./auditService');
const { notify } = require('./notifyService');
const { hasRole } = require('./accessService');
const rm = require('./riskMethodology');

const { httpError } = rm;
const models = () => require('../models');
const riskSvc = () => require('./riskService');
const history = () => require('./riskHistoryService');

const TRIGGER_TYPES = ['incident', 'audit_finding', 'threat_advisory', 'cve', 'kri', 'review_overdue'];
const TYPE_LABEL = {
  incident: 'Sicherheitsvorfall', audit_finding: 'Auditfeststellung', threat_advisory: 'Bedrohungsmeldung',
  cve: 'Neue kritische/hohe Schwachstelle', kri: 'KRI-Schwellwert überschritten', review_overdue: 'Periodische Prüfung überfällig',
};
const MAX_OCCURRENCES = 50;
const TEXT_MAX = 4000;
const TASK_DUE_DAYS = 14;
const PRIVILEGED = ['admin', 'assessor', 'management'];
const SYSTEM_REQ = { user: null, ip: null };
const KRI_FIELDS = ['kpi_id', 'threshold', 'direction', 'note'];
const ACCEPTANCE_WARN_DAYS = 30;

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ');
const logError = (label, e) => console.error(`[RiskMonitoring] ${label}:`, oneLine(e && e.message));
const todayStr = () => rm.todayStr();
const addDays = (dateStr, n) => { const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const uniqueViolation = (e) => !!e && (e.name === 'SequelizeUniqueConstraintError' || e?.parent?.code === '23505');
const posIds = (arr) => [...new Set((Array.isArray(arr) ? arr : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
const text = (label, { required = false } = {}) => (v) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw httpError(400, `${label} ist erforderlich.`);
    return null;
  }
  if (typeof v !== 'string') throw httpError(400, `${label} muss Text sein.`);
  const s = v.trim();
  if (!s && required) throw httpError(400, `${label} ist erforderlich.`);
  if (s.length > TEXT_MAX) throw httpError(400, `${label} ist länger als ${TEXT_MAX} Zeichen.`);
  return s || null;
};

// At most one open flag per risk and trigger type, also against two events
// arriving at the same moment (two instances, two requests).
const ensureIndexes = async () => {
  await models().sequelize.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_review_flag_open ON risk_review_flags (risk_id, trigger_type) WHERE status = 'open'",
  );
};

// ── Periodic review ─────────────────────────────────────────────────────────

/**
 * Next review of a risk. The cycle comes from the ACTIVE methodology (the
 * risk criteria in force, like appetite); the level from the risk's own
 * version. Closed risks are not reviewed.
 */
const reviewInfo = (risk, own, active) => {
  const level = rm.effectiveLevel(risk, own);
  const months = level ? rm.reviewMonthsFor(active || own, level) : null;
  const base = dateOnly(risk.last_reviewed_at || risk.updated_at || risk.created_at);
  const byCycle = months && base ? rm.addMonths(base, months) : null;
  const manual = risk.review_date ? String(risk.review_date).slice(0, 10) : null;
  let next = byCycle;
  let source = byCycle ? 'cycle' : null;
  if (manual && (!next || manual < next)) { next = manual; source = 'review_date'; }
  const closed = risk.status === 'closed';
  return {
    review_cycle_months: months,
    last_reviewed_at: risk.last_reviewed_at || null,
    next_review_due: closed ? null : next,
    next_review_source: closed ? null : source,
    review_overdue: !closed && !!next && next < todayStr(),
  };
};

const acceptanceInfo = (risk) => {
  if (risk.status !== 'accepted' || !risk.accepted_until) return { acceptance_expiring: false, acceptance_expired: false, acceptance_days_left: null };
  const until = String(risk.accepted_until).slice(0, 10);
  const today = todayStr();
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return { acceptance_expiring: days >= 0 && days <= ACCEPTANCE_WARN_DAYS, acceptance_expired: days < 0, acceptance_days_left: days };
};

/**
 * Monitoring fields for responses (riskService.decorate): next review, open
 * reassessment flags (types only in the list; reasons in the detail view,
 * which checks the record rights), KRI breaches, acceptance expiry.
 */
const attachMonitoring = async (out, { detail = false } = {}) => {
  const ids = out.map(r => r && r.id).filter(Boolean);
  if (!ids.length) return;
  const { RiskReviewFlag, RiskKri } = models();
  const active = await rm.getActiveProfile();
  const [flags, kris] = await Promise.all([
    RiskReviewFlag.findAll({ where: { risk_id: ids, status: 'open' }, order: [['created_at', 'ASC'], ['id', 'ASC']], ...(detail ? {} : { attributes: ['id', 'risk_id', 'trigger_type'] }) }),
    RiskKri.findAll({ where: { risk_id: ids }, attributes: ['risk_id', 'breached'], raw: true }),
  ]);
  const flagsBy = new Map();
  for (const f of flags) { if (!flagsBy.has(f.risk_id)) flagsBy.set(f.risk_id, []); flagsBy.get(f.risk_id).push(f); }
  const krisBy = new Map();
  for (const k of kris) { const c = krisBy.get(k.risk_id) || { total: 0, breached: 0 }; c.total++; if (k.breached) c.breached++; krisBy.set(k.risk_id, c); }
  for (const r of out) {
    if (!r) continue;
    const own = await rm.profileForRisk(r);
    Object.assign(r, reviewInfo(r, own, active), acceptanceInfo(r));
    const fl = flagsBy.get(r.id) || [];
    r.review_flags_open = fl.length;
    r.review_flag_types = [...new Set(fl.map(f => f.trigger_type))];
    r.needs_review = fl.length > 0;
    const k = krisBy.get(r.id) || { total: 0, breached: 0 };
    r.kri_count = k.total;
    r.kri_breached = k.breached;
    if (detail) r.openReviewFlags = fl.map(f => (typeof f.toJSON === 'function' ? f.toJSON() : f));
  }
};

// ── Review flags ────────────────────────────────────────────────────────────

const ownerTaskFields = (risk, triggerType, reason, level) => {
  const PRIORITIES = ['low', 'medium', 'high', 'critical'];
  return {
    title: `${risk.ref || `R-${risk.id}`}: Neubewertung erforderlich – ${TYPE_LABEL[triggerType]}`.slice(0, 255),
    description: `${reason}\n\nBitte das Risiko „${risk.title}“ neu bewerten oder die Prüfung bestätigen (Risiken → Überwachung). Die Bewertung wird nicht automatisch geändert.`.slice(0, 8000),
    status: 'open',
    priority: PRIORITIES.includes(level) ? level : 'medium',
    due_date: addDays(todayStr(), TASK_DUE_DAYS),
    assigned_to_id: risk.owner_id || null,
    assigned_role: risk.owner_id ? null : 'assessor',
    related_type: 'risk',
    related_id: risk.id,
    tags: ['risk_reassessment', triggerType],
    created_by_id: null,
  };
};

const createFlagTask = async (risk, flag, reason, transaction) => {
  const { Task } = models();
  const level = await riskSvc().levelOf(risk);
  const task = await Task.create(ownerTaskFields(risk, flag.trigger_type, reason, level), { transaction });
  await flag.update({ task_id: task.id }, { transaction });
  return task;
};

const eventKey = (sourceType, sourceId, key) => `${sourceType || ''}:${sourceId ?? ''}:${key ?? ''}`;

/**
 * Flag a risk for reassessment. Returns { flag, created, task_created,
 * duplicate }. Never changes the assessment. Dedup: one open flag per (risk,
 * trigger type); the same event (source and key) is recorded only once; a new
 * task only when the flag has no open task.
 */
const raiseFlag = async ({ risk, triggerType, sourceType = null, sourceId = null, key = null, reason, req = null }) => {
  if (!TRIGGER_TYPES.includes(triggerType)) throw httpError(400, 'Unbekannte Auslöserart.');
  const { RiskReviewFlag, Task, sequelize } = models();
  const why = String(reason || TYPE_LABEL[triggerType]).slice(0, TEXT_MAX);
  const ev = eventKey(sourceType, sourceId, key);
  const now = new Date();
  const attempt = async () => sequelize.transaction(async (transaction) => {
    let flag = await RiskReviewFlag.findOne({ where: { risk_id: risk.id, trigger_type: triggerType, status: 'open' }, transaction, lock: transaction.LOCK.UPDATE });
    if (!flag) {
      flag = await RiskReviewFlag.create({
        risk_id: risk.id, trigger_type: triggerType, status: 'open', source_type: sourceType, source_id: sourceId, reason: why,
        occurrences: [{ key: ev, source_type: sourceType, source_id: sourceId, reason: why, at: now.toISOString() }], occurrence_count: 1, last_occurred_at: now,
      }, { transaction });
      const task = await createFlagTask(risk, flag, why, transaction);
      return { flag, created: true, task_created: true, task, duplicate: false };
    }
    const occ = Array.isArray(flag.occurrences) ? flag.occurrences : [];
    if (occ.some(o => o && o.key === ev)) return { flag, created: false, task_created: false, duplicate: true };
    const next = [...occ, { key: ev, source_type: sourceType, source_id: sourceId, reason: why, at: now.toISOString() }].slice(-MAX_OCCURRENCES);
    await flag.update({ occurrences: next, occurrence_count: (flag.occurrence_count || 1) + 1, last_occurred_at: now }, { transaction });
    let task = flag.task_id ? await Task.findByPk(flag.task_id, { transaction }) : null;
    let taskCreated = false;
    if (!task || !['open', 'in_progress'].includes(task.status)) {
      task = await createFlagTask(risk, flag, why, transaction);
      taskCreated = true;
    }
    return { flag, created: false, task_created: taskCreated, task, duplicate: false };
  });
  let result;
  try {
    result = await attempt();
  } catch (e) {
    // Two events at the same moment: the other one created the flag first.
    if (!uniqueViolation(e)) throw e;
    result = await attempt();
  }
  if (result.duplicate) return result;
  await auditFromReq(req || SYSTEM_REQ, 'update', 'risk', risk.id, risk.title, {
    action: 'review_flag_raised', flag_id: result.flag.id, trigger_type: triggerType, source_type: sourceType, source_id: sourceId,
    reason: why, flag_created: result.created, task_id: result.task_created ? result.task.id : null,
  });
  if (result.task_created) {
    await auditFromReq(req || SYSTEM_REQ, 'create', 'task', result.task.id, result.task.title, {
      related_type: 'risk', related_id: risk.id, assigned_to_id: result.task.assigned_to_id, assigned_role: result.task.assigned_role,
      due_date: result.task.due_date, priority: result.task.priority, review_flag_id: result.flag.id,
    });
    if (risk.owner_id) {
      await notify({ userId: risk.owner_id, actorId: null, type: 'reminder', title: 'Risiko neu bewerten', content: `${risk.ref || risk.title}: ${why}`.slice(0, 1000), link: '/risks/monitoring' });
    }
  }
  return result;
};

// Risks behind assets: direct links and risk scenarios. Closed risks are not
// flagged (nothing left to reassess).
const risksForAssets = async (assetIds) => {
  const ids = posIds(assetIds);
  if (!ids.length) return [];
  const { sequelize, Risk } = models();
  const rows = await sequelize.query(
    'SELECT risk_id FROM risk_assets WHERE asset_id IN (:ids) UNION SELECT s.risk_id FROM risk_scenarios s JOIN risk_scenario_assets sa ON sa.scenario_id = s.id WHERE sa.asset_id IN (:ids)',
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  const riskIds = posIds(rows.map(r => r.risk_id));
  if (!riskIds.length) return [];
  return Risk.findAll({ where: { id: riskIds, status: { [Op.ne]: 'closed' } }, order: [['id', 'ASC']] });
};

const assetNames = async (ids) => {
  const list = posIds(ids);
  if (!list.length) return '';
  const rows = await models().Asset.findAll({ where: { id: list }, attributes: ['id', 'name'], order: [['id', 'ASC']], limit: 5, raw: true });
  return rows.map(a => a.name).join(', ') + (list.length > 5 ? ' …' : '');
};

// Errors in triggers are logged, never thrown: the incident, finding or
// advisory itself has been saved.
const safely = (label, fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { logError(label, e); return { flagged: 0, error: true }; }
};

const flagRisks = async (risks, base) => {
  let flagged = 0;
  for (const risk of risks) {
    const r = await raiseFlag({ ...base, risk });
    if (!r.duplicate) flagged++;
  }
  return { flagged, risks: risks.map(r => r.id) };
};

/**
 * (a) Incident: new, or severity raised, with an asset of the risk (also
 * directly linked risks). On a plain update only newly linked assets/risks
 * count. opts: { created, previousSeverity, addedAssetIds, addedRiskIds }.
 */
const onIncident = safely('incident trigger', async (incident, opts = {}, req = null) => {
  if (!incident || incident.deleted) return { flagged: 0 };
  const raised = !!opts.created || (opts.previousSeverity && rm.rank(incident.severity) > rm.rank(opts.previousSeverity));
  const assetIds = raised ? (await incident.getAssets({ attributes: ['id'], joinTableAttributes: [] })).map(a => a.id) : posIds(opts.addedAssetIds);
  const direct = raised ? (await incident.getRisks({ attributes: ['id'], joinTableAttributes: [] })).map(r => r.id) : posIds(opts.addedRiskIds);
  const byAsset = await risksForAssets(assetIds);
  const directRisks = direct.length ? await models().Risk.findAll({ where: { id: direct, status: { [Op.ne]: 'closed' } } }) : [];
  const risks = [...new Map([...byAsset, ...directRisks].map(r => [r.id, r])).values()];
  if (!risks.length) return { flagged: 0, risks: [] };
  const names = await assetNames(assetIds);
  const what = opts.created ? 'Neuer Vorfall' : raised ? `Vorfall hochgestuft (${opts.previousSeverity} → ${incident.severity})` : 'Vorfall neu verknüpft';
  const reason = `${what} ${incident.ref || `#${incident.id}`} „${incident.title}“ (Schwere: ${incident.severity})${names ? `, betroffene Assets: ${names}` : ''}.`;
  return flagRisks(risks, { triggerType: 'incident', sourceType: 'incident', sourceId: incident.id, key: incident.severity, reason, req });
});

const incidentLinkIds = async (incident) => ({
  assets: (await incident.getAssets({ attributes: ['id'], joinTableAttributes: [] })).map(a => a.id),
  risks: (await incident.getRisks({ attributes: ['id'], joinTableAttributes: [] })).map(r => r.id),
});
const addedIncidentLinks = async (incident, before) => {
  const now = await incidentLinkIds(incident);
  return {
    addedAssetIds: now.assets.filter(id => !before.assets.includes(id)),
    addedRiskIds: now.risks.filter(id => !before.risks.includes(id)),
  };
};

/** (b) Audit finding linked to risks (new finding, or newly linked risks). */
const onAuditFinding = safely('audit finding trigger', async (finding, riskIds, req = null) => {
  const ids = posIds(riskIds);
  if (!finding || !ids.length) return { flagged: 0 };
  const risks = await models().Risk.findAll({ where: { id: ids, status: { [Op.ne]: 'closed' } } });
  const reason = `Auditfeststellung „${finding.title}“ (${finding.severity || 'observation'}) mit Bezug zu diesem Risiko.`;
  return flagRisks(risks, { triggerType: 'audit_finding', sourceType: 'audit_finding', sourceId: finding.id, reason, req });
});

/**
 * (c) Threat advisory assessed as relevant or critical with affected assets
 * (confirmed links). assetIds: only these (an asset newly linked to an
 * advisory that is already assessed); default all confirmed assets.
 */
const RELEVANT = ['relevant', 'critical'];
const onThreatAdvisory = safely('threat advisory trigger', async (advisory, { assetIds } = {}, req = null) => {
  if (!advisory || !RELEVANT.includes(advisory.relevance)) return { flagged: 0 };
  const { ThreatAdvisoryAsset } = models();
  const ids = assetIds ? posIds(assetIds) : (await ThreatAdvisoryAsset.findAll({ where: { advisory_id: advisory.id, confirmed: true }, attributes: ['asset_id'], raw: true })).map(l => l.asset_id);
  const risks = await risksForAssets(ids);
  if (!risks.length) return { flagged: 0, risks: [] };
  const names = await assetNames(ids);
  const reason = `Bedrohungsmeldung ${advisory.ref || `#${advisory.id}`} „${String(advisory.title).slice(0, 200)}“ als ${advisory.relevance} bewertet${names ? `, betroffene Assets: ${names}` : ''}.`;
  return flagRisks(risks, { triggerType: 'threat_advisory', sourceType: 'threat_advisory', sourceId: advisory.id, key: advisory.relevance, reason, req });
});

/**
 * (d) New critical/high CVE on an asset (Asset afterUpdate hook: nightly CVE
 * refresh and manual refresh). Compares the stored list with the previous one.
 */
const SEVERE = ['critical', 'high'];
const cveIdsOf = (list, severeOnly) => new Set((Array.isArray(list) ? list : [])
  .filter(c => c && typeof c.id === 'string' && (!severeOnly || SEVERE.includes(c.severity)))
  .map(c => c.id));
const newSevereCves = (previous, current) => {
  const before = cveIdsOf(previous, false);
  return [...cveIdsOf(current, true)].filter(id => !before.has(id)).sort();
};
const onAssetUpdated = async (asset, options = {}) => {
  try {
    const fields = Array.isArray(options.fields) ? options.fields : [];
    if (!fields.includes('cve_ids')) return;
    const fresh = newSevereCves(asset.previous('cve_ids'), asset.get('cve_ids'));
    if (!fresh.length) return;
    const risks = await risksForAssets([asset.id]);
    if (!risks.length) return;
    const shown = fresh.slice(0, 5).join(', ') + (fresh.length > 5 ? ` (+${fresh.length - 5})` : '');
    const reason = `Neue kritische/hohe Schwachstelle(n) auf Asset „${asset.name}“: ${shown}.`;
    await flagRisks(risks, { triggerType: 'cve', sourceType: 'asset', sourceId: asset.id, key: fresh.join(',').slice(0, 500), reason });
  } catch (e) { logError('CVE trigger', e); }
};

// ── Resolving flags ─────────────────────────────────────────────────────────

const resolveFlagRows = async (flags, { userId = null, resolution, note = null, req = null, risk = null, completeTasks = false, completedById = null } = {}) => {
  const { Task } = models();
  const done = [];
  for (const flag of flags) {
    if (flag.status !== 'open') continue;
    await flag.update({ status: 'resolved', resolved_at: new Date(), resolved_by_id: userId, resolution, resolution_note: note });
    let taskDone = null;
    if (completeTasks && flag.task_id) {
      const task = await Task.findByPk(flag.task_id);
      if (task && ['open', 'in_progress'].includes(task.status)) {
        await task.update({ status: 'done', completed_at: new Date(), completed_by_id: completedById });
        taskDone = task.id;
        await auditFromReq(req || SYSTEM_REQ, 'update', 'task', task.id, task.title, { action: 'status_from_review', review_flag_id: flag.id, before: { status: 'open' }, after: { status: 'done' } });
      }
    }
    done.push({ id: flag.id, trigger_type: flag.trigger_type, task_completed: taskDone });
  }
  if (done.length && risk) {
    await auditFromReq(req || SYSTEM_REQ, 'update', 'risk', risk.id, risk.title, { action: 'review_flags_resolved', resolution, note, flags: done });
  }
  return done;
};

// The reassessment task is done -> its flag is resolved (logged).
const onTaskUpdated = async (task, options = {}) => {
  try {
    const fields = Array.isArray(options.fields) ? options.fields : null;
    if (fields && !fields.includes('status')) return;
    if (task.status !== 'done') return;
    const flags = await models().RiskReviewFlag.findAll({ where: { task_id: task.id, status: 'open' } });
    if (!flags.length) return;
    const risk = await models().Risk.findByPk(flags[0].risk_id, { attributes: ['id', 'ref', 'title'] });
    await resolveFlagRows(flags, { userId: task.completed_by_id || null, resolution: 'task_done', note: `Aufgabe #${task.id} erledigt.`, risk, req: SYSTEM_REQ });
  } catch (e) { logError('task sync', e); }
};

const onTasksBulkUpdated = async (options = {}) => {
  try {
    if (!options.attributes || options.attributes.status !== 'done' || !options.where) return;
    const { Task, RiskReviewFlag, Risk } = models();
    const tasks = await Task.findAll({ where: options.where, attributes: ['id', 'status', 'completed_by_id'] });
    const done = tasks.filter(t => t.status === 'done');
    if (!done.length) return;
    const flags = await RiskReviewFlag.findAll({ where: { task_id: done.map(t => t.id), status: 'open' } });
    for (const flag of flags) {
      const task = done.find(t => t.id === flag.task_id);
      const risk = await Risk.findByPk(flag.risk_id, { attributes: ['id', 'ref', 'title'] });
      await resolveFlagRows([flag], { userId: task?.completed_by_id || null, resolution: 'task_done', note: `Aufgabe #${flag.task_id} erledigt.`, risk, req: SYSTEM_REQ });
    }
  } catch (e) { logError('task sync (bulk)', e); }
};

/**
 * Confirm the periodic review / reassessment of a risk (ISO 27005 10.5):
 * a note is mandatory. Writes a "review" history row (values unchanged; a
 * changed assessment is saved through the normal edit, which writes its own
 * row), sets last_reviewed_at, resolves the open flags (all or flag_ids) and
 * completes their open tasks. Record rights as for editing the risk.
 */
const reviewRisk = async (risk, body, user, req) => {
  const svc = riskSvc();
  if (!svc.canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const src = pick(body || {}, ['note', 'flag_ids']);
  const note = text('Prüfvermerk', { required: true })(src.note);
  const { RiskReviewFlag } = models();
  let flags = await RiskReviewFlag.findAll({ where: { risk_id: risk.id, status: 'open' }, order: [['id', 'ASC']] });
  if (src.flag_ids !== undefined && src.flag_ids !== null) {
    if (!Array.isArray(src.flag_ids)) throw httpError(400, 'flag_ids muss eine Liste sein.');
    const wanted = posIds(src.flag_ids);
    if (wanted.length !== src.flag_ids.length) throw httpError(400, 'flag_ids: ungültige Kennung.');
    const unknown = wanted.filter(id => !flags.some(f => f.id === id));
    if (unknown.length) throw httpError(400, 'flag_ids: Markierung nicht offen oder gehört zu einem anderen Risiko.');
    flags = flags.filter(f => wanted.includes(f.id));
  }
  const entry = await history().recordReview(risk, req, note);
  const resolved = await resolveFlagRows(flags, { userId: user?.id ?? null, resolution: 'reviewed', note, req, risk, completeTasks: true, completedById: user?.id ?? null });
  await auditFromReq(req, 'update', 'risk', risk.id, risk.title, { action: 'review', note, history_id: entry?.id ?? null, flags_resolved: resolved.map(f => f.id) });
  return svc.loadFull(risk.id);
};

// ── Flag lists ──────────────────────────────────────────────────────────────

/**
 * Reassessment list across risks with reasons. admin, assessor and management
 * see every risk; others the risks they own. Filters: status (open|resolved,
 * default open), trigger_type, risk_id.
 */
const listFlags = async (user, query = {}) => {
  if (!user?.id) throw httpError(403, 'Forbidden');
  const { RiskReviewFlag, Risk, User, Task } = models();
  const where = {};
  const st = query.status === undefined || query.status === '' ? 'open' : query.status;
  if (!['open', 'resolved', 'all'].includes(st)) throw httpError(400, 'Ungültiger Status. Möglich: open, resolved, all.');
  if (st !== 'all') where.status = st;
  if (query.trigger_type !== undefined && query.trigger_type !== '') {
    if (!TRIGGER_TYPES.includes(query.trigger_type)) throw httpError(400, `Ungültige Auslöserart. Möglich: ${TRIGGER_TYPES.join(', ')}.`);
    where.trigger_type = query.trigger_type;
  }
  if (query.risk_id !== undefined && query.risk_id !== '') {
    const id = Number(query.risk_id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Ungültige Kennung.');
    where.risk_id = id;
  }
  const riskWhere = hasRole(user, PRIVILEGED) ? {} : { owner_id: user.id };
  const rows = await RiskReviewFlag.findAll({
    where,
    include: [
      { model: Risk, as: 'risk', where: riskWhere, required: true, attributes: ['id', 'ref', 'title', 'status', 'owner_id', 'category', 'likelihood', 'impact', 'residual_likelihood', 'residual_impact', 'residual_level', 'inherent_level', 'methodology_id'], include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }] },
      { model: Task, as: 'task', attributes: ['id', 'title', 'status', 'due_date'] },
      { model: User, as: 'resolvedBy', attributes: ['id', 'name'] },
    ],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: 1000,
  });
  const decorated = new Map((await rm.decorateRisks([...new Map(rows.map(r => [r.risk.id, r.risk])).values()])).map(d => [d.id, d]));
  return rows.map(r => {
    const j = r.toJSON();
    const d = decorated.get(r.risk.id) || {};
    j.occurrences = (j.occurrences || []).map(o => ({ source_type: o.source_type, source_id: o.source_id, reason: o.reason, at: o.at }));
    j.risk = { id: j.risk.id, ref: j.risk.ref, title: j.risk.title, status: j.risk.status, owner: j.risk.owner || null, effective_level: d.effective_level ?? null, appetite_exceeded: !!d.appetite_exceeded };
    return j;
  });
};

const listRiskFlags = async (risk, user) => {
  if (!riskSvc().canViewRisk(user, risk)) throw httpError(403, 'Forbidden');
  const { RiskReviewFlag, Task, User } = models();
  const rows = await RiskReviewFlag.findAll({
    where: { risk_id: risk.id },
    include: [{ model: Task, as: 'task', attributes: ['id', 'title', 'status', 'due_date'] }, { model: User, as: 'resolvedBy', attributes: ['id', 'name'] }],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  return rows.map(r => {
    const j = r.toJSON();
    j.occurrences = (j.occurrences || []).map(o => ({ source_type: o.source_type, source_id: o.source_id, reason: o.reason, at: o.at }));
    return j;
  });
};

// ── KRIs ────────────────────────────────────────────────────────────────────

// Numeric value of a KPI measurement (stored as text). "12,5" and "80 %"
// are accepted; anything else is not evaluated. Anchored, linear pattern on
// short input only (no ReDoS).
const NUM_RE = /^-?\d{1,15}(\.\d{1,6})?$/;
const parseValue = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || s.length > 30) return null;
  if (s.endsWith('%')) s = s.slice(0, -1).trim();
  s = s.replace(',', '.');
  return NUM_RE.test(s) ? Number(s) : null;
};
const isBreach = (value, threshold, direction) => (value === null ? false : direction === 'below' ? value < Number(threshold) : value > Number(threshold));

const latestValue = async (kpiId) => {
  const { KpiMeasurement, Kpi } = models();
  const m = await KpiMeasurement.findOne({ where: { kpi_id: kpiId }, order: [['measured_at', 'DESC'], ['id', 'DESC']] });
  if (m) return { value: parseValue(m.value), measured_at: m.measured_at, raw: m.value };
  const kpi = await Kpi.findByPk(kpiId, { attributes: ['id', 'current_value'] });
  if (kpi && kpi.current_value !== null && kpi.current_value !== undefined && kpi.current_value !== '') return { value: parseValue(kpi.current_value), measured_at: null, raw: kpi.current_value };
  return null;
};

/** Evaluate one KRI link; a new breach (not breached -> breached) raises the flag once. */
const evaluateKri = async (link, req = null) => {
  const { Risk, Kpi } = models();
  const latest = await latestValue(link.kpi_id);
  if (!latest || latest.value === null) {
    await link.update({ last_evaluated_at: new Date() });
    return { breached: link.breached, changed: false, evaluated: false };
  }
  const breach = isBreach(latest.value, link.threshold, link.direction);
  const upd = { last_value: latest.value, last_measured_at: latest.measured_at, last_evaluated_at: new Date() };
  let raised = null;
  if (breach && !link.breached) {
    Object.assign(upd, { breached: true, breached_at: new Date(), breach_value: latest.value, breach_count: (link.breach_count || 0) + 1 });
  } else if (!breach && link.breached) {
    Object.assign(upd, { breached: false });
  }
  await link.update(upd);
  if (breach && upd.breached === true) {
    const risk = await Risk.findByPk(link.risk_id);
    const kpi = await Kpi.findByPk(link.kpi_id, { attributes: ['id', 'title'] });
    if (risk && risk.status !== 'closed') {
      const cmp = link.direction === 'below' ? 'unter' : 'über';
      const reason = `KRI „${kpi?.title || `KPI #${link.kpi_id}`}“: Wert ${latest.value} liegt ${cmp} dem Schwellwert ${Number(link.threshold)}.`;
      raised = await raiseFlag({ risk, triggerType: 'kri', sourceType: 'kri', sourceId: link.id, key: String(link.breach_count), reason, req });
    }
    await auditFromReq(req || SYSTEM_REQ, 'update', 'risk_kri', link.id, `KRI ${link.id}`, { action: 'breached', risk_id: link.risk_id, kpi_id: link.kpi_id, value: latest.value, threshold: Number(link.threshold), direction: link.direction });
  } else if (!breach && upd.breached === false) {
    await auditFromReq(req || SYSTEM_REQ, 'update', 'risk_kri', link.id, `KRI ${link.id}`, { action: 'back_within_threshold', risk_id: link.risk_id, kpi_id: link.kpi_id, value: latest.value, threshold: Number(link.threshold), direction: link.direction });
  }
  return { breached: breach, changed: upd.breached !== undefined, evaluated: true, flag: raised ? raised.flag.id : null };
};

const onKpiMeasurement = async (measurement) => {
  try {
    const links = await models().RiskKri.findAll({ where: { kpi_id: measurement.kpi_id } });
    for (const link of links) await evaluateKri(link);
  } catch (e) { logError('KRI evaluation', e); }
};

const kriInclude = () => {
  const { Kpi } = models();
  return [{ model: Kpi, as: 'kpi', attributes: ['id', 'title', 'target', 'current_value', 'status'] }];
};
const presentKri = (row) => {
  const j = typeof row.toJSON === 'function' ? row.toJSON() : { ...row };
  for (const k of ['threshold', 'breach_value', 'last_value']) j[k] = j[k] === null || j[k] === undefined ? null : Number(j[k]);
  return j;
};

const buildKriFields = (body, { existing = null } = {}) => {
  const src = pick(body || {}, KRI_FIELDS);
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  const f = {};
  if (!existing) {
    const id = Number(src.kpi_id);
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'kpi_id: KPI angeben.');
    f.kpi_id = id;
  } else if (has('kpi_id') && Number(src.kpi_id) !== existing.kpi_id) {
    throw httpError(400, 'Der KPI einer Verknüpfung lässt sich nicht ändern - neu verknüpfen.');
  }
  if (has('threshold') || !existing) {
    const v = src.threshold;
    const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseValue(v) : NaN);
    if (n === null || !Number.isFinite(n) || Math.abs(n) >= 1e14) throw httpError(400, 'Schwellwert: Zahl angeben.');
    f.threshold = n;
  }
  if (has('direction') || !existing) {
    const d = src.direction ?? 'above';
    if (!['above', 'below'].includes(d)) throw httpError(400, 'Richtung: above oder below.');
    f.direction = d;
  }
  if (has('note')) f.note = text('Notiz')(src.note);
  return f;
};

const listKris = async (risk, user) => {
  if (!riskSvc().canViewRisk(user, risk)) throw httpError(403, 'Forbidden');
  const rows = await models().RiskKri.findAll({ where: { risk_id: risk.id }, include: kriInclude(), order: [['id', 'ASC']] });
  return rows.map(presentKri);
};

const createKri = async (risk, body, user, req) => {
  if (!riskSvc().canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const { RiskKri, Kpi } = models();
  const f = buildKriFields(body);
  if (!(await Kpi.count({ where: { id: f.kpi_id } }))) throw httpError(400, 'Unbekannter KPI.');
  if (await RiskKri.count({ where: { risk_id: risk.id } }) >= 50) throw httpError(400, 'Höchstens 50 KRIs je Risiko.');
  let link;
  try {
    link = await RiskKri.create({ ...f, risk_id: risk.id, created_by_id: user?.id ?? null });
  } catch (e) {
    if (uniqueViolation(e)) throw httpError(409, 'Dieser KPI ist mit dem Risiko bereits verknüpft.');
    throw e;
  }
  await auditFromReq(req, 'create', 'risk_kri', link.id, `${risk.ref || risk.id}: KPI ${f.kpi_id}`, { risk_id: risk.id, kpi_id: f.kpi_id, threshold: f.threshold, direction: f.direction, note: f.note ?? null });
  const evaluation = await evaluateKri(link, req);
  return { ...presentKri(await RiskKri.findByPk(link.id, { include: kriInclude() })), evaluation };
};

const updateKri = async (risk, link, body, user, req) => {
  if (!riskSvc().canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  if (!link || link.risk_id !== risk.id) throw httpError(404, 'Not found');
  const before = { threshold: Number(link.threshold), direction: link.direction, note: link.note };
  const f = buildKriFields(body, { existing: link });
  await link.update(f);
  await auditFromReq(req, 'update', 'risk_kri', link.id, `${risk.ref || risk.id}: KPI ${link.kpi_id}`, { risk_id: risk.id, before, after: { threshold: Number(link.threshold), direction: link.direction, note: link.note } });
  const evaluation = await evaluateKri(link, req);
  return { ...presentKri(await models().RiskKri.findByPk(link.id, { include: kriInclude() })), evaluation };
};

const deleteKri = async (risk, link, user, req) => {
  if (!riskSvc().canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  if (!link || link.risk_id !== risk.id) throw httpError(404, 'Not found');
  const snap = presentKri(link);
  await link.destroy();
  await auditFromReq(req, 'delete', 'risk_kri', snap.id, `${risk.ref || risk.id}: KPI ${snap.kpi_id}`, { risk_id: risk.id, kpi_id: snap.kpi_id, threshold: snap.threshold, direction: snap.direction, breached: snap.breached });
  return { message: 'KRI link deleted' };
};

// ── Expiring risk acceptances (services/reminderService.js) ─────────────────

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Accepted risks whose acceptance expires within 30 days, or has expired:
 * in-app notification and e-mail to the risk owner and the approver
 * (accepted_by). Once per stage (expiring / expired) and acceptance date - a
 * renewed acceptance gets its own notices.
 */
const checkExpiringRiskAcceptances = async () => {
  const { Risk, User, Notification } = models();
  const { sendEmail } = require('./emailService');
  const today = todayStr();
  const warn = addDays(today, ACCEPTANCE_WARN_DAYS);
  const risks = await Risk.findAll({
    where: { status: 'accepted', accepted_until: { [Op.ne]: null, [Op.lte]: warn } },
    include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }, { model: User, as: 'acceptedBy', attributes: ['id', 'name', 'email'] }],
    order: [['id', 'ASC']],
    limit: 2000,
  });
  let notified = 0; let mailed = 0;
  for (const risk of risks) {
    const until = String(risk.accepted_until).slice(0, 10);
    const expired = until < today;
    const title = expired ? 'Risikoakzeptanz abgelaufen' : 'Risikoakzeptanz läuft ab';
    const label = `${risk.ref || `R-${risk.id}`} „${risk.title}“`;
    const content = expired
      ? `Die Akzeptanz des Risikos ${label} ist am ${until} abgelaufen. Bitte neu bewerten oder die Akzeptanz erneut beantragen.`
      : `Die Akzeptanz des Risikos ${label} läuft am ${until} ab. Bitte prüfen, ob sie erneuert oder das Risiko anders behandelt werden soll.`;
    const link = '/risks/monitoring';
    const recipients = [risk.owner, risk.acceptedBy].filter(Boolean).filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i);
    for (const u of recipients) {
      const exists = await Notification.findOne({ where: { user_id: u.id, title, content, link } });
      if (exists) continue;
      await notify({ userId: u.id, actorId: null, type: 'reminder', title, content, link });
      notified++;
      if (!u.email) continue;
      try {
        await sendEmail({
          to: u.email,
          subject: `[OpenISMS] ${title}: ${risk.ref || risk.title}`,
          text: `Hallo ${u.name},\n\n${content}\n\nMit freundlichen Grüßen\nIhr OpenISMS-System`,
          html: `<p>Hallo ${escapeHtml(u.name)},</p><p>${escapeHtml(content)}</p><p>Mit freundlichen Grüßen<br>Ihr OpenISMS-System</p>`,
        });
        mailed++;
      } catch (mailErr) {
        console.warn('[Reminders] Could not send risk acceptance expiry e-mail:', oneLine(mailErr.message));
      }
    }
  }
  return { risks: risks.length, notified, mailed };
};

// ── Daily job ───────────────────────────────────────────────────────────────

/**
 * Daily monitoring run (index.js, once per day across instances via
 * withJobSlot): overdue reviews -> flag + task; reviews no longer overdue ->
 * open review flag resolved; all KRIs evaluated.
 */
const runDailyMonitoring = async () => {
  const { Risk, RiskReviewFlag, RiskKri } = models();
  const active = await rm.getActiveProfile();
  const risks = await Risk.findAll({ where: { status: { [Op.ne]: 'closed' } }, order: [['id', 'ASC']] });
  let overdue = 0; let flagged = 0; let cleared = 0;
  for (const risk of risks) {
    try {
      const own = await rm.profileForRisk(risk);
      const info = reviewInfo(risk, own, active);
      if (info.review_overdue) {
        overdue++;
        const reason = `Periodische Prüfung überfällig seit ${info.next_review_due}${info.next_review_source === 'cycle' ? ` (Prüfzyklus ${info.review_cycle_months} Monate)` : ' (Prüftermin)'}.`;
        const r = await raiseFlag({ risk, triggerType: 'review_overdue', sourceType: 'review', sourceId: risk.id, key: info.next_review_due, reason });
        if (!r.duplicate) flagged++;
      } else {
        const open = await RiskReviewFlag.findAll({ where: { risk_id: risk.id, trigger_type: 'review_overdue', status: 'open' } });
        if (open.length) {
          await resolveFlagRows(open, { resolution: 'condition_cleared', note: `Nächste Prüfung fällig am ${info.next_review_due || '–'}.`, risk, completeTasks: false });
          cleared += open.length;
        }
      }
    } catch (e) { logError(`daily review check (risk ${risk.id})`, e); }
  }
  let kris = 0; let kriBreaches = 0;
  for (const link of await RiskKri.findAll({ order: [['id', 'ASC']] })) {
    try {
      const r = await evaluateKri(link);
      kris++;
      if (r.breached) kriBreaches++;
    } catch (e) { logError(`daily KRI check (link ${link.id})`, e); }
  }
  return { risks: risks.length, overdue, flagged, cleared, kris, kri_breaches: kriBreaches };
};

// ── Figures for dashboard and management report ─────────────────────────────

const TREND_DAYS = 90;

const monitoringSummary = async () => {
  const { Risk, RiskReviewFlag, RiskKri } = models();
  const rows = await Risk.findAll({ where: { status: { [Op.ne]: 'closed' } } });
  const decorated = await rm.decorateRisks(rows);
  await attachMonitoring(decorated);
  const byLevel = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of decorated) if (byLevel[r.effective_level] !== undefined) byLevel[r.effective_level]++;
  const flags = await RiskReviewFlag.findAll({ where: { status: 'open' }, include: [{ model: Risk, as: 'risk', attributes: ['id'], where: { status: { [Op.ne]: 'closed' } }, required: true }], attributes: ['id', 'risk_id', 'trigger_type'] });
  const byType = Object.fromEntries(TRIGGER_TYPES.map(t => [t, 0]));
  for (const f of flags) byType[f.trigger_type]++;
  const breachedRisks = new Set((await RiskKri.findAll({ where: { breached: true }, attributes: ['risk_id'], raw: true })).map(k => k.risk_id));
  const openIds = new Set(decorated.map(r => r.id));
  const to = todayStr();
  const from = addDays(to, -TREND_DAYS);
  let trend = null;
  try {
    const t = await history().trendHeatmap({ from, to, basis: 'residual' });
    trend = { from, to, days: TREND_DAYS, ...t.summary, level_transitions: t.level_transitions };
  } catch (e) { logError('trend', e); }
  return {
    generated_at: new Date().toISOString(),
    open_risks: decorated.length,
    by_level: byLevel,
    trend,
    overdue_reviews: decorated.filter(r => r.review_overdue).length,
    reviews_due_30_days: decorated.filter(r => !r.review_overdue && r.next_review_due && r.next_review_due <= addDays(to, 30)).length,
    kri_breaches: [...breachedRisks].filter(id => openIds.has(id)).length,
    appetite_exceeded: decorated.filter(r => r.appetite_exceeded).length,
    open_reassessments: new Set(flags.map(f => f.risk_id)).size,
    open_reassessment_flags: flags.length,
    open_reassessments_by_trigger: byType,
    methodology_reassessment: decorated.filter(r => r.needs_reassessment).length,
    acceptances_expiring: decorated.filter(r => r.acceptance_expiring).length,
    acceptances_expired: decorated.filter(r => r.acceptance_expired).length,
  };
};

module.exports = {
  TRIGGER_TYPES, TYPE_LABEL, ensureIndexes, reviewInfo, acceptanceInfo, attachMonitoring,
  raiseFlag, risksForAssets, onIncident, incidentLinkIds, addedIncidentLinks, onAuditFinding, onThreatAdvisory, onAssetUpdated, newSevereCves,
  onTaskUpdated, onTasksBulkUpdated, reviewRisk, listFlags, listRiskFlags,
  parseValue, isBreach, evaluateKri, onKpiMeasurement, buildKriFields, listKris, createKri, updateKri, deleteKri,
  checkExpiringRiskAcceptances, runDailyMonitoring, monitoringSummary, escapeHtml,
};
