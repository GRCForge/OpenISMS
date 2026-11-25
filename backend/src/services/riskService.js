'use strict';

/**
 * Schreibende Vorgaenge am Risikoregister - ein Weg fuer REST und MCP.
 *
 * Bis 3.5.1 hatten Route und MCP-Tools je eine eigene Kopie: Der MCP-Weg rechnete
 * mit einer abweichenden Schwelle (Score 15/16 = high statt critical), pruefte
 * keine Datensatzrechte und konnte den Status "accepted" ohne Freigabe setzen.
 * Hier stehen die Regeln einmal:
 *   - Felder nur aus einer festen Liste (Massenzuweisung, utils/massAssignment.js)
 *   - "accepted" nur ueber die Freigabe, nach der Akzeptanzbefugnis der Methodik
 *   - steigt die Stufe eines akzeptierten Risikos, erlischt die Akzeptanz
 *   - Neubewertung nach einer neuen Methodik-Version nur ausdruecklich und protokolliert
 */

const { pick } = require('../utils/massAssignment');
const { auditFromReq } = require('./auditService');
const { notify } = require('./notifyService');
const { computeResidual } = require('./residual');
const rm = require('./riskMethodology');

const models = () => require('../models');
const { httpError } = rm;

const FIELDS = ['title', 'description', 'category', 'owner_id', 'likelihood', 'impact', 'treatment', 'treatment_plan', 'status', 'review_date', 'acceptance_document_id'];
const TREATMENTS = ['mitigate', 'accept', 'transfer', 'avoid'];
const STATUSES = ['open', 'in_treatment', 'accepted', 'closed'];
const SNAPSHOT = ['title', 'description', 'category', 'owner_id', 'likelihood', 'impact', 'inherent_level', 'residual_likelihood', 'residual_impact', 'residual_level', 'treatment', 'status', 'review_date', 'methodology_id', 'accepted_by_id', 'accepted_until'];
const CLEAR_ACCEPTANCE = { accepted_by_id: null, accepted_at: null, accepted_until: null };

const includeAll = () => {
  const { User, Asset, Threat, Control, Document, VvtEntry, Incident } = models();
  return [
    { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
    { model: User, as: 'acceptedBy', attributes: ['id', 'name'] },
    { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
    { model: Threat, as: 'threats', attributes: ['id', 'code', 'title', 'source'], through: { attributes: [] } },
    { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework', 'status'], through: { attributes: ['effectiveness'] } },
    { model: Document, as: 'acceptanceDocument', attributes: ['id', 'original_name'] },
    { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
    { model: Incident, as: 'incidents', through: { attributes: [] } },
  ];
};

// Datensatzrechte (wie GET /api/risks/:id): admin und assessor alle, sonst nur eigene.
const canWriteRisk = (user, risk) => !!user && (user.role === 'admin' || user.role === 'assessor' || risk.owner_id === user.id);
const canViewRisk = canWriteRisk;
// Freigabe: zusaetzlich die Geschaeftsleitung fuer jedes Risiko. Ob die Rolle die
// Stufe akzeptieren darf, entscheidet danach die Akzeptanzbefugnis der Methodik.
const canSignoffRecord = (user, risk) => !!user && (['admin', 'assessor', 'management'].includes(user.role) || risk.owner_id === user.id);

const snapshot = (risk) => Object.fromEntries(SNAPSHOT.map(f => [f, risk[f] ?? null]));
const toInt = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };
const toDate = (v) => (v === '' || v === 'Invalid date' || v === undefined || v === null) ? null : v;

/**
 * Felder aus dem Body. full: fehlende Felder bekommen Standardwerte (Formular,
 * PUT ersetzt). partial: nur gesendete Felder (MCP).
 */
const buildFields = (body, { partial = false, existing = null } = {}) => {
  const src = pick(body, FIELDS);
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  const f = {};
  const set = (k, conv, dflt) => {
    if (has(k)) f[k] = conv(src[k]);
    else if (!partial) f[k] = typeof dflt === 'function' ? dflt() : dflt;
  };
  set('title', v => (v == null ? v : String(v)), undefined);
  set('description', v => v ?? null, null);
  set('category', v => v ?? null, null);
  set('owner_id', v => toInt(v) || null, null);
  set('likelihood', v => toInt(v) ?? 3, 3);
  set('impact', v => toInt(v) ?? 3, 3);
  set('treatment', v => v || 'mitigate', 'mitigate');
  set('treatment_plan', v => v ?? null, null);
  set('status', v => v || 'open', 'open');
  set('review_date', toDate, null);
  set('acceptance_document_id', v => toInt(v) || null, null);
  if (f.title !== undefined && (!f.title || !String(f.title).trim())) throw httpError(400, 'Titel ist erforderlich');
  if (f.treatment !== undefined && !TREATMENTS.includes(f.treatment)) throw httpError(400, 'Ungültige Behandlung.');
  if (f.status !== undefined && !STATUSES.includes(f.status)) throw httpError(400, 'Ungültiger Status.');
  if (f.status === 'accepted' && existing?.status !== 'accepted') {
    throw httpError(400, 'Der Status „akzeptiert“ wird nur über die Freigabe (Sign-off) gesetzt.');
  }
  return f;
};

const applyLinks = async (risk, body) => {
  const ops = [];
  if (Array.isArray(body.asset_ids)) ops.push(risk.setAssets(body.asset_ids));
  if (Array.isArray(body.threat_ids)) ops.push(risk.setThreats(body.threat_ids));
  if (Array.isArray(body.vvt_ids)) ops.push(risk.setVvtEntries(body.vvt_ids));
  if (Array.isArray(body.incident_ids)) ops.push(risk.setIncidents(body.incident_ids));
  if (Array.isArray(body.controls)) {
    ops.push((async () => {
      await risk.setControls([]);
      await Promise.all(
        body.controls.filter(c => c && c.id).map(c =>
          risk.addControl(c.id, { through: { effectiveness: Math.min(5, Math.max(1, parseInt(c.effectiveness, 10) || 3)) } })
        )
      );
    })());
  }
  await Promise.all(ops);
};

const recomputeResidual = async (risk) => {
  const controls = await risk.getControls({ joinTableAttributes: ['effectiveness'] });
  const links = controls.map(c => ({ effectiveness: c.RiskControl?.effectiveness, status: c.status }));
  const profile = await rm.profileForRisk(risk);
  await risk.update(computeResidual(risk.likelihood, risk.impact, links, profile));
};

const loadFull = async (id) => rm.decorateRisk(await models().Risk.findByPk(id, { include: includeAll() }));

const notifyOwner = async (risk, actor) => {
  if (!risk.owner_id) return;
  await notify({
    userId: risk.owner_id, actorId: actor?.id ?? null, type: 'assignment',
    title: 'Risiko zugewiesen',
    content: `Sie wurden als Risiko-Owner für „${risk.ref || risk.title}" zugewiesen.`,
    link: '/risks',
  });
};

// Stufe vor/nach einer Aenderung, berechnet nach der Version des Risikos.
const levelOf = async (risk) => rm.effectiveLevel(risk, await rm.profileForRisk(risk));

// Akzeptanz erlischt, wenn die massgebliche Stufe steigt: akzeptiert war ein
// geringeres Risiko, und die Befugnis kann fuer die neue Stufe fehlen.
const lapseIfRaised = async (risk, beforeLevel, auditReq) => {
  if (risk.status !== 'accepted') return false;
  const after = await levelOf(risk);
  if (!(rm.rank(after) > rm.rank(beforeLevel))) return false;
  const prev = { accepted_by_id: risk.accepted_by_id, accepted_until: risk.accepted_until };
  await risk.update({ status: 'in_treatment', ...CLEAR_ACCEPTANCE });
  await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, { action: 'acceptance_lapsed', reason: 'level_increased', from_level: beforeLevel, to_level: after, previous: prev });
  return true;
};

const createRisk = async (body, user, auditReq) => {
  const { Risk } = models();
  if (!body || !body.title) throw httpError(400, 'Titel ist erforderlich');
  const risk = await Risk.create(buildFields(body, { partial: false }));
  await applyLinks(risk, body);
  await recomputeResidual(risk);
  await auditFromReq(auditReq, 'create', 'risk', risk.id, risk.title, { level: risk.inherent_level, treatment: risk.treatment, methodology_id: risk.methodology_id });
  await notifyOwner(risk, user);
  return loadFull(risk.id);
};

const updateRisk = async (risk, body, user, auditReq, { partial = false } = {}) => {
  if (!canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const before = snapshot(risk);
  const beforeLevel = await levelOf(risk);
  const prevOwner = risk.owner_id;
  const f = buildFields(body, { partial, existing: risk });

  let reassess = null;
  if (body?.reassess === true || body?.reassess === 'true') {
    const active = await rm.getActiveProfile();
    const own = await rm.profileForRisk(risk);
    if (!active) throw httpError(409, 'Keine aktive Risikomethodik.');
    if (own.id === active.id) throw httpError(400, 'Das Risiko ist bereits nach der aktiven Methodik bewertet.');
    const hasOwn = (k) => body && Object.prototype.hasOwnProperty.call(body, k) && body[k] !== null && body[k] !== '';
    if (!hasOwn('likelihood') || !hasOwn('impact')) {
      throw httpError(400, 'Für die Neubewertung Wahrscheinlichkeit und Auswirkung nach der aktiven Skala angeben.');
    }
    f.methodology_id = active.id;
    // Netto-Werte stammen aus der alten Skala; recomputeResidual setzt sie gleich neu.
    Object.assign(f, { residual_likelihood: null, residual_impact: null, residual_level: null });
    reassess = { from_version: own.version ?? null, to_version: active.version };
  }
  if (risk.status === 'accepted' && f.status && f.status !== 'accepted') Object.assign(f, CLEAR_ACCEPTANCE);

  await risk.update(f);
  await applyLinks(risk, body || {});
  await recomputeResidual(risk);
  const lapsed = await lapseIfRaised(risk, beforeLevel, auditReq);

  if (risk.owner_id && String(prevOwner) !== String(risk.owner_id)) await notifyOwner(risk, user);
  const after = snapshot(risk);
  await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, { before, after, ...(lapsed ? { acceptance_lapsed: true } : {}) });
  if (reassess) {
    await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, {
      action: 'reassess', mode: 'manual', ...reassess,
      before: { likelihood: before.likelihood, impact: before.impact, inherent_level: before.inherent_level, residual_level: before.residual_level },
      after: { likelihood: after.likelihood, impact: after.impact, inherent_level: after.inherent_level, residual_level: after.residual_level },
    });
  }
  return loadFull(risk.id);
};

const signoffRisk = async (risk, user, validUntil, auditReq) => {
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!canSignoffRecord(user, risk)) throw httpError(403, 'Forbidden');
  const { level, rule, accepted_until, methodology_version } = await rm.checkAcceptance(risk, user, validUntil);
  await risk.update({ status: 'accepted', accepted_by_id: user.id, accepted_at: new Date(), accepted_until });
  await auditFromReq(auditReq, 'acknowledge', 'risk', risk.id, risk.title, {
    accepted_until, level, methodology_version, allowed_roles: rule.roles, max_months: rule.max_months,
  });
  return loadFull(risk.id);
};

// Zuruecknehmen darf, wer akzeptiert hat, admin, oder wer diese Stufe selbst
// akzeptieren duerfte.
const revokeRisk = async (risk, user, auditReq) => {
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!canSignoffRecord(user, risk) && risk.accepted_by_id !== user.id) throw httpError(403, 'Forbidden');
  if (user.role !== 'admin' && risk.accepted_by_id !== user.id) {
    const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
    const level = await levelOf(risk);
    const rule = (active.acceptance || []).find(a => a.level === level);
    if (!rule || !rule.roles.includes(user.role)) throw httpError(403, 'Die Freigabe darf nur zurücknehmen, wer sie erteilt hat oder diese Stufe akzeptieren darf.');
  }
  const prev = { accepted_by_id: risk.accepted_by_id, accepted_at: risk.accepted_at, accepted_until: risk.accepted_until };
  await risk.update({ status: 'in_treatment', ...CLEAR_ACCEPTANCE });
  await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, { action: 'revoke_signoff', previous: prev });
  return loadFull(risk.id);
};

/**
 * Uebernahme in die aktive Version ohne neue Werte - nur wenn die Matrixgroesse
 * gleich geblieben ist. Die Stufen werden nach den neuen Schwellen berechnet und
 * je Risiko protokolliert. Bei geaenderter Matrixgroesse ist eine
 * Einzelbewertung noetig (PUT mit reassess).
 */
const carryOver = async (riskIds, auditReq) => {
  const { Risk } = models();
  const ids = [...new Set((Array.isArray(riskIds) ? riskIds : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 500);
  if (!ids.length) throw httpError(400, 'Keine Risiken angegeben.');
  const active = await rm.getActiveProfile();
  if (!active) throw httpError(409, 'Keine aktive Risikomethodik.');
  const risks = await Risk.findAll({ where: { id: ids }, order: [['id', 'ASC']] });
  const carried = [];
  const skipped = ids.filter(id => !risks.some(r => r.id === id)).map(id => ({ id, reason: 'not_found' }));
  for (const risk of risks) {
    const own = await rm.profileForRisk(risk);
    if (own.id === active.id) { skipped.push({ id: risk.id, reason: 'already_current' }); continue; }
    if (own.likelihood_levels.length !== active.likelihood_levels.length || own.impact_levels.length !== active.impact_levels.length) {
      skipped.push({ id: risk.id, reason: 'matrix_changed' });
      continue;
    }
    const before = { inherent_level: risk.inherent_level, residual_level: risk.residual_level };
    const beforeLevel = await levelOf(risk);
    await risk.update({ methodology_id: active.id });
    const lapsed = await lapseIfRaised(risk, beforeLevel, auditReq);
    const after = { inherent_level: risk.inherent_level, residual_level: risk.residual_level };
    await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, {
      action: 'reassess', mode: 'carry_over', from_version: own.version ?? null, to_version: active.version,
      likelihood: risk.likelihood, impact: risk.impact, before, after, ...(lapsed ? { acceptance_lapsed: true } : {}),
    });
    carried.push({ id: risk.id, ref: risk.ref, before, after, acceptance_lapsed: lapsed });
  }
  return { to_version: active.version, carried, skipped };
};

const listForReassessment = async () => {
  const { Risk, User } = models();
  const { Op } = require('sequelize');
  const active = await rm.getActiveProfile();
  if (!active) return [];
  const rows = await Risk.findAll({
    where: { [Op.or]: [{ methodology_id: { [Op.ne]: active.id } }, { methodology_id: null }] },
    include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }],
    order: [['id', 'ASC']],
  });
  return rm.decorateRisks(rows);
};

module.exports = {
  FIELDS, includeAll, canWriteRisk, canViewRisk, canSignoffRecord, buildFields,
  createRisk, updateRisk, signoffRisk, revokeRisk, carryOver, listForReassessment, recomputeResidual, loadFull,
};
