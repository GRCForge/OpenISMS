'use strict';

/**
 * Risk acceptance with the four-eyes principle (3.8.0) - ISO/IEC 27001:2022
 * 6.1.3 f and 8.3, ISO/IEC 27005:2022 9.6. One path for REST and MCP
 * (entry points in services/riskService.js).
 *
 *   request  -> anyone with record rights on the risk (canWriteRisk) states the
 *               justification, the requested validity and the residual risk;
 *               the level at that moment is stored with the request
 *   approve  -> a person with acceptance authority for that level under the
 *               active methodology (riskMethodology.checkAcceptance) who is NOT
 *               the requester; the level must still be the requested one
 *   reject   -> the same authority, with a reason
 *   withdraw -> the requester (or admin) while the request is pending
 *   confirm  -> the risk owner confirms the acceptance of the residual risk
 *               (flag on the request, 6.1.3 f)
 *
 * Acceptances given before 3.8.0 stay valid on the risk (accepted_by_id,
 * accepted_until) without a request; nothing is migrated.
 */

const { Op } = require('sequelize');
const { pick } = require('../utils/massAssignment');
const { auditFromReq } = require('./auditService');
const { notify } = require('./notifyService');
const rm = require('./riskMethodology');

const { httpError } = rm;
const models = () => require('../models');
const riskSvc = () => require('./riskService');

const TEXT_MAX = 4000;
const REQUEST_FIELDS = ['justification', 'residual_risk_description', 'requested_until', 'confirm_as_owner'];
const DECISION_FIELDS = ['valid_until', 'note', 'reason'];
const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'];

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

const uniqueViolation = (e) => !!e && (e.name === 'SequelizeUniqueConstraintError' || e?.parent?.code === '23505');

// One pending request per risk, also against concurrent requests.
const ensureIndexes = async () => {
  await models().sequelize.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_acceptance_pending ON risk_acceptance_requests (risk_id) WHERE status = 'pending'",
  );
};

const includeRequest = () => {
  const { User } = models();
  return [
    { model: User, as: 'requestedBy', attributes: ['id', 'name'] },
    { model: User, as: 'decidedBy', attributes: ['id', 'name'] },
    { model: User, as: 'ownerConfirmedBy', attributes: ['id', 'name'] },
  ];
};

const findRequest = async (riskId, requestId) => {
  const id = Number(requestId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return models().RiskAcceptanceRequest.findOne({ where: { id, risk_id: riskId } });
};

const pendingRequest = async (riskId, requestId = null) => {
  const { RiskAcceptanceRequest } = models();
  if (requestId !== null && requestId !== undefined && requestId !== '') {
    const row = await findRequest(riskId, requestId);
    return row && row.status === 'pending' ? row : null;
  }
  return RiskAcceptanceRequest.findOne({ where: { risk_id: riskId, status: 'pending' } });
};

// Values the effective level is computed from (net before gross), as stored
// with the request.
const levelValues = (risk) => (risk.residual_likelihood != null && risk.residual_impact != null
  ? { l: risk.residual_likelihood, i: risk.residual_impact }
  : { l: risk.likelihood, i: risk.impact });

const ruleFor = (profile, level) => (profile?.acceptance || []).find(a => a.level === level) || null;

const notifyMany = async (userIds, actor, title, content) => {
  const seen = new Set();
  for (const id of userIds) {
    if (!id || seen.has(id) || id === actor?.id) continue;
    seen.add(id);
    await notify({ userId: id, actorId: actor?.id ?? null, type: 'assignment', title, content, link: '/risks' });
  }
};

// People who may decide: active users with a role the methodology allows for
// the level. Bounded - a notification, not a mailing list.
const approverIds = async (roles) => {
  if (!roles || !roles.length) return [];
  const { User } = models();
  const rows = await User.findAll({ where: { role: { [Op.in]: roles }, active: true }, attributes: ['id'], limit: 50, order: [['id', 'ASC']] });
  return rows.map(u => u.id);
};

const requestAcceptance = async (risk, body, user, auditReq) => {
  const svc = riskSvc();
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!svc.canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const src = pick(body || {}, REQUEST_FIELDS);
  const justification = text('Begründung')(src.justification);
  if (!justification) throw httpError(400, 'Begründung des Akzeptanzantrags ist erforderlich.');
  const residualText = text('Beschreibung des Restrisikos')(src.residual_risk_description);
  const requestedUntil = rm.normalizeDate(src.requested_until);
  if (requestedUntil && requestedUntil < rm.todayStr()) throw httpError(400, 'Die gewünschte Gültigkeit liegt in der Vergangenheit.');

  const active = await rm.getActiveProfile();
  const own = await rm.profileForRisk(risk);
  if (active && own.id && own.id !== active.id) {
    throw httpError(409, `Das Risiko ist nach Version ${own.version} der Risikomethodik bewertet, aktiv ist Version ${active.version}. Vor dem Antrag neu bewerten.`);
  }
  const level = rm.effectiveLevel(risk, own);
  if (!level) throw httpError(400, 'Das Risiko ist nicht bewertet.');
  const rules = active || own;
  const rule = ruleFor(rules, level);
  if (!rule || !rule.roles.length) throw httpError(400, 'Für diese Risikostufe sieht die Methodik keine Akzeptanz vor.');
  if (rule.max_months && requestedUntil) {
    const latest = rm.addMonths(rm.todayStr(), rule.max_months);
    if (requestedUntil > latest) throw httpError(400, `Für diese Stufe ist eine Akzeptanz höchstens ${rule.max_months} Monate gültig (bis ${latest}).`);
  }
  let ownerConfirmed = false;
  if (src.confirm_as_owner === true || src.confirm_as_owner === 'true') {
    if (risk.owner_id !== user.id) throw httpError(400, 'Nur der Risikoeigner kann die Akzeptanz des Restrisikos bestätigen.');
    ownerConfirmed = true;
  }
  const { RiskAcceptanceRequest } = models();
  if (await RiskAcceptanceRequest.count({ where: { risk_id: risk.id, status: 'pending' } })) {
    throw httpError(409, 'Für dieses Risiko liegt bereits ein offener Akzeptanzantrag vor.');
  }
  const vals = levelValues(risk);
  const now = new Date();
  let row;
  try {
    row = await RiskAcceptanceRequest.create({
      risk_id: risk.id, status: 'pending', justification, residual_risk_description: residualText, requested_until: requestedUntil,
      residual_level: level, residual_likelihood: vals.l, residual_impact: vals.i, methodology_id: own.id ?? null,
      requested_by_id: user.id, requested_at: now,
      owner_confirmed: ownerConfirmed, owner_confirmed_by_id: ownerConfirmed ? user.id : null, owner_confirmed_at: ownerConfirmed ? now : null,
    });
  } catch (e) {
    if (uniqueViolation(e)) throw httpError(409, 'Für dieses Risiko liegt bereits ein offener Akzeptanzantrag vor.');
    throw e;
  }
  await auditFromReq(auditReq, 'create', 'risk_acceptance_request', row.id, risk.ref || risk.title, {
    risk_id: risk.id, justification, residual_risk_description: residualText, requested_until: requestedUntil,
    residual_level: level, residual_likelihood: vals.l, residual_impact: vals.i, methodology_version: own.version ?? null,
    owner_confirmed: ownerConfirmed, allowed_roles: rule.roles,
  });
  const ref = risk.ref || risk.title;
  await notifyMany(await approverIds(rule.roles), user, 'Akzeptanzantrag zur Freigabe', `Für „${ref}" wurde die Akzeptanz beantragt. Bitte prüfen und freigeben oder ablehnen.`);
  if (risk.owner_id && !ownerConfirmed) {
    await notifyMany([risk.owner_id], user, 'Akzeptanz des Restrisikos bestätigen', `Für „${ref}" wurde die Akzeptanz beantragt. Als Risikoeigner bestätigen Sie die Akzeptanz des Restrisikos.`);
  }
  return svc.loadFull(risk.id);
};

const approveRequest = async (risk, reqRow, user, body, auditReq) => {
  const svc = riskSvc();
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!svc.canSignoffRecord(user, risk)) throw httpError(403, 'Forbidden');
  if (!reqRow || reqRow.risk_id !== risk.id) throw httpError(404, 'Not found');
  if (reqRow.status !== 'pending') throw httpError(409, 'Der Antrag ist nicht mehr offen.');
  if (reqRow.requested_by_id === user.id) throw httpError(403, 'Vier-Augen-Prinzip: Wer die Akzeptanz beantragt hat, kann sie nicht selbst freigeben.');
  const src = pick(body || {}, DECISION_FIELDS);
  const note = text('Anmerkung')(src.note);
  const own = await rm.profileForRisk(risk);
  const level = rm.effectiveLevel(risk, own);
  if (level !== reqRow.residual_level || (reqRow.methodology_id && own.id && reqRow.methodology_id !== own.id)) {
    throw httpError(409, 'Die Risikostufe hat sich seit dem Antrag geändert. Den Antrag ablehnen oder zurückziehen und neu stellen.');
  }
  const validUntil = src.valid_until !== undefined && src.valid_until !== null && src.valid_until !== '' ? src.valid_until : reqRow.requested_until;
  const { rule, accepted_until, methodology_version } = await rm.checkAcceptance(risk, user, validUntil);
  const now = new Date();
  const previousRequestId = risk.acceptance_request_id ?? null;
  if (risk.status === 'accepted') await svc.endAcceptanceRequest(risk, 'superseded');
  await reqRow.update({ status: 'approved', decided_by_id: user.id, decided_at: now, approved_until: accepted_until, decision_reason: note });
  await risk.update({ status: 'accepted', accepted_by_id: user.id, accepted_at: now, accepted_until, acceptance_request_id: reqRow.id });
  // Same audit action as the sign-off before 3.8.0, plus the request.
  await auditFromReq(auditReq, 'acknowledge', 'risk', risk.id, risk.title, {
    accepted_until, level, methodology_version, allowed_roles: rule.roles, max_months: rule.max_months,
    acceptance_request_id: reqRow.id, requested_by_id: reqRow.requested_by_id, owner_confirmed: reqRow.owner_confirmed,
    ...(previousRequestId && previousRequestId !== reqRow.id ? { superseded_request_id: previousRequestId } : {}),
  });
  await auditFromReq(auditReq, 'update', 'risk_acceptance_request', reqRow.id, risk.ref || risk.title, {
    action: 'approved', risk_id: risk.id, approved_until: accepted_until, note, requested_by_id: reqRow.requested_by_id,
  });
  await notifyMany([reqRow.requested_by_id, risk.owner_id], user, 'Akzeptanz freigegeben', `Die Akzeptanz für „${risk.ref || risk.title}" wurde freigegeben${accepted_until ? ` (gültig bis ${accepted_until})` : ''}.`);
  return svc.loadFull(risk.id);
};

// Deciding needs the acceptance authority for the requested level - also
// for a rejection. The level of the request counts (it may have changed).
const requireAuthority = async (user, level) => {
  const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
  const rule = ruleFor(active, level);
  if (!rule || !rule.roles.includes(user.role)) {
    throw httpError(403, `Über Anträge dieser Stufe entscheiden nur folgende Rollen: ${(rule?.roles || []).join(', ') || '–'}.`);
  }
};

const rejectRequest = async (risk, reqRow, user, body, auditReq) => {
  const svc = riskSvc();
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!svc.canSignoffRecord(user, risk)) throw httpError(403, 'Forbidden');
  if (!reqRow || reqRow.risk_id !== risk.id) throw httpError(404, 'Not found');
  if (reqRow.status !== 'pending') throw httpError(409, 'Der Antrag ist nicht mehr offen.');
  if (reqRow.requested_by_id === user.id) throw httpError(403, 'Vier-Augen-Prinzip: Den eigenen Antrag zurückziehen statt ablehnen.');
  const reason = text('Begründung der Ablehnung')(pick(body || {}, DECISION_FIELDS).reason);
  if (!reason) throw httpError(400, 'Für die Ablehnung ist eine Begründung erforderlich.');
  await requireAuthority(user, reqRow.residual_level);
  await reqRow.update({ status: 'rejected', decided_by_id: user.id, decided_at: new Date(), decision_reason: reason });
  await auditFromReq(auditReq, 'update', 'risk_acceptance_request', reqRow.id, risk.ref || risk.title, {
    action: 'rejected', risk_id: risk.id, reason, requested_by_id: reqRow.requested_by_id,
  });
  await notifyMany([reqRow.requested_by_id], user, 'Akzeptanzantrag abgelehnt', `Der Akzeptanzantrag für „${risk.ref || risk.title}" wurde abgelehnt: ${reason.slice(0, 300)}`);
  return svc.loadFull(risk.id);
};

const withdrawRequest = async (risk, reqRow, user, body, auditReq) => {
  const svc = riskSvc();
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!reqRow || reqRow.risk_id !== risk.id) throw httpError(404, 'Not found');
  if (reqRow.status !== 'pending') throw httpError(409, 'Der Antrag ist nicht mehr offen.');
  if (reqRow.requested_by_id !== user.id && user.role !== 'admin') throw httpError(403, 'Zurückziehen kann nur, wer den Antrag gestellt hat.');
  const note = text('Anmerkung')(pick(body || {}, DECISION_FIELDS).note);
  await reqRow.update({ status: 'withdrawn', decided_by_id: user.id, decided_at: new Date(), decision_reason: note });
  await auditFromReq(auditReq, 'update', 'risk_acceptance_request', reqRow.id, risk.ref || risk.title, { action: 'withdrawn', risk_id: risk.id, note });
  return svc.loadFull(risk.id);
};

const confirmAsOwner = async (risk, reqRow, user, auditReq) => {
  const svc = riskSvc();
  if (!user?.id) throw httpError(403, 'Forbidden');
  if (!reqRow || reqRow.risk_id !== risk.id) throw httpError(404, 'Not found');
  if (risk.owner_id !== user.id) throw httpError(403, 'Nur der Risikoeigner bestätigt die Akzeptanz des Restrisikos.');
  if (!['pending', 'approved'].includes(reqRow.status) || reqRow.ended_at) throw httpError(409, 'Der Antrag ist weder offen noch freigegeben.');
  if (reqRow.owner_confirmed) throw httpError(409, 'Die Akzeptanz des Restrisikos ist bereits bestätigt.');
  await reqRow.update({ owner_confirmed: true, owner_confirmed_by_id: user.id, owner_confirmed_at: new Date() });
  await auditFromReq(auditReq, 'update', 'risk_acceptance_request', reqRow.id, risk.ref || risk.title, {
    action: 'owner_confirmed', risk_id: risk.id, request_status: reqRow.status, residual_level: reqRow.residual_level,
  });
  return svc.loadFull(risk.id);
};

/**
 * Requests across risks (approval queue, MCP). Visible: requests on risks the
 * user may sign off (admin, assessor, management, risk owner) and the user's
 * own requests.
 */
const listRequests = async (user, { status, risk_id } = {}) => {
  const svc = riskSvc();
  const { RiskAcceptanceRequest, Risk, User } = models();
  const where = {};
  if (status !== undefined && status !== '') {
    if (!STATUSES.includes(status)) throw httpError(400, `Ungültiger Status. Möglich: ${STATUSES.join(', ')}.`);
    where.status = status;
  }
  if (risk_id !== undefined && risk_id !== '') {
    const id = typeof risk_id === 'number' || typeof risk_id === 'string' ? Number(risk_id) : NaN;
    if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Ungültige Risiko-Kennung.');
    where.risk_id = id;
  }
  const rows = await RiskAcceptanceRequest.findAll({
    where,
    include: [...includeRequest(), { model: Risk, as: 'risk', attributes: ['id', 'ref', 'title', 'owner_id', 'status', 'accepted_until'], include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }] }],
    order: [['requested_at', 'DESC'], ['id', 'DESC']],
    limit: 500,
  });
  return rows
    .filter(r => r.risk && (svc.canSignoffRecord(user, r.risk) || r.requested_by_id === user?.id))
    .map(r => r.toJSON());
};

module.exports = {
  STATUSES, ensureIndexes, findRequest, pendingRequest, requestAcceptance, approveRequest, rejectRequest, withdrawRequest, confirmAsOwner, listRequests,
};
