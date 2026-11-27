'use strict';

/**
 * Risk analysis per BSI-Standard 200-3 within an information domain, and the
 * realisation plan (reference document A.6).
 *
 *   1. Selection (200-3 ch. 3): which target objects need a risk analysis -
 *      high or very high protection need, no module modelled, or an operating
 *      scenario the modules do not cover; added or removed by hand with a
 *      reason.
 *   2. Threat overview (200-3 ch. 4): the 47 elementary threats plus
 *      additional threats per target object; relevance and coverage by the
 *      modelled modules.
 *   3. Classification (200-3 ch. 5): frequency x impact on the scales of the
 *      active risk methodology -> one risk in the register per target object
 *      and threat (scenario asset x threat); a second classification updates
 *      it instead of creating another one.
 *   4. Treatment (200-3 ch. 6) runs through the treatment plan of the risk
 *      (3.8.0); consolidation (200-3 ch. 7): its measures show up as
 *      additional requirements of the target object in the IT-Grundschutz-Check
 *      and can be taken over into the realisation plan.
 *
 * REST (routes/bsi-domains.js) and MCP (mcp/server.js) call the same
 * functions; every write is signed into the audit log here (auditFromReq), so
 * both ways leave the same trace. Visibility follows the asset of the target
 * object (bsiDomainService), risks follow the risk register rules.
 *
 * Pure functions (protection need mapping, selection, priorities, plan rows)
 * are testable without a database (scripts/test-bsi-risk-analysis.js).
 */

const { Op } = require('sequelize');
const domains = require('./bsiDomainService');
const { auditFromReq } = require('./auditService');
const { pick } = require('../utils/massAssignment');

const getModels = () => require('../models');

class RiskAnalysisError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => new RiskAnalysisError(status, message);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── Protection need ─────────────────────────────────────────────────────────
//
// The asset assessment rates confidentiality, integrity and availability on a
// 1..5 scale (models/Assessment.js: 1 = very low, 5 = very high). BSI-Standard
// 200-2 (ch. 8.2) uses three categories: normal, high, very high.
// ASSUMPTION (documented in docs/FEATURES.md): 1-3 = normal, 4 = high,
// 5 = very high. The overall protection need is the maximum of the three
// (maximum principle, 200-2 ch. 8.2.2).
const PROTECTION_CATEGORIES = Object.freeze(['normal', 'high', 'very_high']);
const CIA = Object.freeze(['confidentiality', 'integrity', 'availability']);

function protectionCategory(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return null;
  if (n >= 5) return 'very_high';
  if (n >= 4) return 'high';
  return 'normal';
}

const categoryRank = (c) => PROTECTION_CATEGORIES.indexOf(c);

/**
 * @param {object|null} assessment  current assessment of the asset (or null)
 * @returns {null | {confidentiality, integrity, availability, overall, values, assessed_at, assessment_id}}
 */
function protectionNeed(assessment) {
  if (!assessment) return null;
  const out = { values: {}, assessed_at: assessment.assessed_at || null, assessment_id: assessment.id ?? null, notes: assessment.notes ?? null };
  let overall = null;
  for (const k of CIA) {
    const cat = protectionCategory(assessment[k]);
    out[k] = cat;
    out.values[k] = assessment[k] == null ? null : Number(assessment[k]);
    if (cat && (overall === null || categoryRank(cat) > categoryRank(overall))) overall = cat;
  }
  out.overall = overall;
  return out;
}

// ── Selection (200-3 ch. 3) ─────────────────────────────────────────────────

const SELECTION_REASONS = Object.freeze(['high_protection_need', 'no_module', 'scenario_not_covered']);
const DECISIONS = Object.freeze(['auto', 'include', 'exclude']);
const ANALYSIS_STATUSES = Object.freeze(['open', 'in_progress', 'completed']);

/**
 * Reasons why a target object needs a risk analysis.
 * @param {{protection: object|null, modelingCount: number, scenarioNotCovered: boolean}} p
 * @returns {string[]}
 */
function selectionReasons({ protection, modelingCount, scenarioNotCovered }) {
  const reasons = [];
  if (protection && (protection.overall === 'high' || protection.overall === 'very_high')) reasons.push('high_protection_need');
  if (!modelingCount) reasons.push('no_module');
  if (scenarioNotCovered) reasons.push('scenario_not_covered');
  return reasons;
}

/** A manual decision wins; otherwise any reason selects the target object. */
function isIncluded(decision, reasons) {
  if (decision === 'include') return true;
  if (decision === 'exclude') return false;
  return Array.isArray(reasons) && reasons.length > 0;
}

// ── Priorities in the realisation plan ──────────────────────────────────────

const PRIORITIES = Object.freeze(['high', 'medium', 'low']);

// Suggestion for a requirement without a set priority: basis requirements
// first (200-2 ch. 9: they are the minimum and come first), then standard,
// then those for elevated protection need. Grundschutz++: normal-SdT like
// basis, erhoeht like H.
function suggestRequirementPriority(level) {
  switch (level) {
    case 'basis': case 'normal_sdt': return 'high';
    case 'standard': return 'medium';
    case 'erhoehter_schutzbedarf': case 'erhoeht': return 'low';
    default: return 'medium';
  }
}

// Suggestion for an additional measure: from the level of the risk it treats
// (net before gross, like risk appetite).
function suggestMeasurePriority(level) {
  if (level === 'critical' || level === 'high') return 'high';
  if (level === 'low') return 'low';
  return 'medium';
}

const priorityRank = (p) => { const i = PRIORITIES.indexOf(p); return i < 0 ? PRIORITIES.length : i; };

/** Sort plan items: priority, then due date (empty last), then name. */
function sortPlanItems(items) {
  return [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)
    || String(a.due_date || '9999-99-99').localeCompare(String(b.due_date || '9999-99-99'))
    || String(a.target_name || '').localeCompare(String(b.target_name || ''))
    || String(a.ref || '').localeCompare(String(b.ref || '')));
}

// Elementary threats sorted by number (G 0.2 before G 0.10).
function threatOrder(a, b) {
  const num = (t) => {
    const m = /^G\s*0\.(\d{1,3})$/.exec(String(t.code || '').trim());
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  return num(a) - num(b) || String(a.code || '').localeCompare(String(b.code || '')) || String(a.title).localeCompare(String(b.title));
}

// ── Permissions ─────────────────────────────────────────────────────────────

const RISK_VIEW_FALLBACK = ['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee'];
const RISK_CREATE_FALLBACK = ['admin', 'assessor', 'it-staff', 'dpo', 'owner'];
const RISK_EDIT_FALLBACK = RISK_CREATE_FALLBACK;
const THREAT_CREATE_FALLBACK = ['admin'];
// Treatment items across risks: like the treatment plan overview
// (riskTreatmentService.listPlan).
const PRIVILEGED_PLAN = ['admin', 'assessor', 'management'];

// Roles come from the actor's groups (services/accessService.js, v3.10.0):
// role by role, allow-only, fallback roles where the matrix says nothing.
async function allowed(actor, module, action, fallback) {
  const { decide } = require('./permissionService');
  return decide(actor, module, action, fallback);
}

/** Filter for treatment items: privileged roles, risk owner, responsible user or group member. */
async function itemFilter(actor) {
  if (!actor?.id) return () => false;
  const { hasRole } = require('./accessService');
  if (hasRole(actor, PRIVILEGED_PLAN)) return () => true;
  const { GroupMember } = getModels();
  const groups = new Set((await GroupMember.findAll({ where: { user_id: actor.id }, attributes: ['group_id'], raw: true })).map(g => g.group_id));
  return (item, risk) => !!risk && (risk.owner_id === actor.id || item.responsible_user_id === actor.id || (item.responsible_group_id != null && groups.has(item.responsible_group_id)));
}

// ── Input helpers ───────────────────────────────────────────────────────────

const text = (v, field, max = 10000) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw fail(400, `${field} muss Text sein`);
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};
const bool = (v, field) => {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  throw fail(400, `${field} muss true oder false sein`);
};

const ASSET_ATTRS = ['id', 'name', 'type', 'status', 'classification', 'owner_id', 'assessor_id', 'description', 'location'];
const briefAsset = (a) => a && { id: a.id, name: a.name, type: a.type, status: a.status, classification: a.classification };

async function currentAssessments(assetIds) {
  const { Assessment } = getModels();
  if (!assetIds.length) return new Map();
  const rows = await Assessment.findAll({
    where: { asset_id: assetIds, is_current: true },
    attributes: ['id', 'asset_id', 'confidentiality', 'integrity', 'availability', 'assessed_at', 'notes'],
    order: [['assessed_at', 'DESC'], ['id', 'DESC']],
    raw: true,
  });
  const out = new Map();
  for (const r of rows) if (!out.has(r.asset_id)) out.set(r.asset_id, r);
  return out;
}

async function elementaryThreats() {
  const { Threat } = getModels();
  const rows = await Threat.findAll({ where: { source: 'bsi_elementar' }, attributes: ['id', 'code', 'title', 'description', 'source'], raw: true });
  return rows.sort(threatOrder);
}

// The imported catalogues carry no mapping of elementary threats to modules:
// the cross-reference tables of the Kompendium are published as separate
// spreadsheets, not in the XML edition, and Grundschutz++ has none. Coverage
// is therefore always set by hand; the API says so instead of guessing.
const CATALOG_THREAT_MAPPING = Object.freeze({
  available: false,
  note: 'The imported catalogue provides no mapping of elementary threats to modules; coverage is assessed manually.',
});

// ── Overview of a domain ────────────────────────────────────────────────────

/**
 * All visible target objects of a domain with protection need, selection
 * reasons, decision and progress of the threat overview.
 */
async function getAnalysis(domainId, actor) {
  const { BsiTargetObject, Asset, BsiModeling, BsiRiskAnalysisTarget, BsiRiskAnalysisThreat } = getModels();
  const domain = await domains.loadDomain(domainId);
  const visible = await domains.assetFilter(actor);
  const tos = (await BsiTargetObject.findAll({
    where: { domain_id: domain.id },
    include: [{ model: Asset, as: 'asset', attributes: ASSET_ATTRS }],
    order: [['target_type', 'ASC'], ['id', 'ASC']],
  })).filter(t => t.asset && visible(t.asset));
  const ids = tos.map(t => t.id);
  const [assessments, modelCounts, targetRows, threatRows, elementary] = await Promise.all([
    currentAssessments(tos.map(t => t.asset_id)),
    ids.length ? BsiModeling.count({ where: { domain_id: domain.id, target_object_id: ids }, group: ['target_object_id'] }) : [],
    ids.length ? BsiRiskAnalysisTarget.findAll({ where: { domain_id: domain.id, target_object_id: ids } }) : [],
    ids.length ? BsiRiskAnalysisThreat.findAll({ where: { domain_id: domain.id, target_object_id: ids }, attributes: ['target_object_id', 'relevant', 'risk_id', 'additional'], raw: true }) : [],
    elementaryThreats(),
  ]);
  const mc = new Map(modelCounts.map(r => [r.target_object_id, Number(r.count)]));
  const rowBy = new Map(targetRows.map(r => [r.target_object_id, r]));
  const stats = new Map();
  for (const r of threatRows) {
    const s = stats.get(r.target_object_id) || { assessed: 0, relevant: 0, not_relevant: 0, classified: 0, additional: 0 };
    if (r.relevant !== null) s.assessed++;
    if (r.relevant === true) s.relevant++;
    if (r.relevant === false) s.not_relevant++;
    if (r.risk_id) s.classified++;
    if (r.additional) s.additional++;
    stats.set(r.target_object_id, s);
  }
  const targets = tos.map(t => {
    const row = rowBy.get(t.id);
    const protection = protectionNeed(assessments.get(t.asset_id) || null);
    const reasons = selectionReasons({ protection, modelingCount: mc.get(t.id) || 0, scenarioNotCovered: !!row?.scenario_not_covered });
    const decision = row?.decision || 'auto';
    const s = stats.get(t.id) || { assessed: 0, relevant: 0, not_relevant: 0, classified: 0, additional: 0 };
    return {
      target_object_id: t.id, target_type: t.target_type, asset: briefAsset(t.asset),
      protection_need: protection,
      modeling_count: mc.get(t.id) || 0,
      reasons,
      decision, decision_reason: row?.decision_reason ?? null,
      scenario_not_covered: !!row?.scenario_not_covered, scenario_note: row?.scenario_note ?? null,
      included: isIncluded(decision, reasons),
      status: row?.status || 'open', completed_at: row?.completed_at ?? null,
      threats: { elementary_total: elementary.length, ...s },
    };
  });
  return {
    domain: { id: domain.id, name: domain.name, protection_approach: domain.protection_approach, catalog_id: domain.catalog_id },
    catalog_threat_mapping: CATALOG_THREAT_MAPPING,
    protection_mapping: { normal: [1, 2, 3], high: [4], very_high: [5] },
    summary: {
      target_objects: targets.length,
      included: targets.filter(t => t.included).length,
      completed: targets.filter(t => t.included && t.status === 'completed').length,
      classified_threats: targets.reduce((n, t) => n + t.threats.classified, 0),
      without_protection_need: targets.filter(t => !t.protection_need).length,
    },
    targets,
  };
}

// ── Threat overview of one target object ────────────────────────────────────

async function loadContext(domainId, targetId, actor, transaction) {
  const domain = await domains.loadDomain(domainId, transaction);
  const target = await domains.loadTargetObject(domain, targetId, actor, transaction);
  return { domain, target };
}

async function selectionOf(domain, target, transaction) {
  const { BsiModeling, BsiRiskAnalysisTarget } = getModels();
  const [row, modelingCount, assessments] = await Promise.all([
    BsiRiskAnalysisTarget.findOne({ where: { target_object_id: target.id }, transaction }),
    BsiModeling.count({ where: { domain_id: domain.id, target_object_id: target.id }, transaction }),
    currentAssessments([target.asset_id]),
  ]);
  const protection = protectionNeed(assessments.get(target.asset_id) || null);
  const reasons = selectionReasons({ protection, modelingCount, scenarioNotCovered: !!row?.scenario_not_covered });
  const decision = row?.decision || 'auto';
  return { row, protection, modelingCount, reasons, decision, included: isIncluded(decision, reasons) };
}

/** Risk summary for the overview: register-list fields, only with risks.view. */
const riskBrief = (d) => d && ({
  id: d.id, ref: d.ref, title: d.title, status: d.status, owner_id: d.owner_id,
  likelihood: d.likelihood, impact: d.impact, inherent_level: d.inherent_level,
  residual_likelihood: d.residual_likelihood, residual_impact: d.residual_impact, residual_level: d.residual_level,
  target_level: d.target_level, effective_level: d.effective_level ?? null, appetite_exceeded: !!d.appetite_exceeded,
  treatment: d.treatment, methodology_version: d.methodology_version ?? null, needs_reassessment: !!d.needs_reassessment,
});

/**
 * Treatment items of the given risks that the actor may see, with the
 * information whether they are in the realisation plan of the domain.
 * Discarded items are not additional requirements.
 */
async function additionalMeasures(domainId, risks, actor) {
  const { RiskTreatmentItem, User, Group, BsiRealizationMeasure } = getModels();
  const riskIds = risks.map(r => r.id);
  if (!riskIds.length) return [];
  const show = await itemFilter(actor);
  const riskBy = new Map(risks.map(r => [r.id, r]));
  const items = await RiskTreatmentItem.findAll({
    where: { risk_id: riskIds, status: { [Op.ne]: 'discarded' } },
    include: [
      { model: User, as: 'responsibleUser', attributes: ['id', 'name'] },
      { model: Group, as: 'responsibleGroup', attributes: ['id', 'name'] },
    ],
    order: [['risk_id', 'ASC'], ['sort_order', 'ASC'], ['id', 'ASC']],
  });
  const shown = items.filter(i => show(i, riskBy.get(i.risk_id)));
  const links = shown.length
    ? await BsiRealizationMeasure.findAll({ where: { domain_id: domainId, treatment_item_id: shown.map(i => i.id) }, raw: true })
    : [];
  const linkBy = new Map(links.map(l => [l.treatment_item_id, l]));
  return shown.map(i => {
    const r = riskBy.get(i.risk_id);
    const link = linkBy.get(i.id);
    return {
      treatment_item_id: i.id, risk_id: i.risk_id, risk_ref: r?.ref ?? null, risk_title: r?.title ?? null,
      title: i.title, treatment_option: i.treatment_option, status: i.status,
      responsible: i.responsibleUser ? { id: i.responsibleUser.id, name: i.responsibleUser.name } : null,
      responsible_group: i.responsibleGroup ? { id: i.responsibleGroup.id, name: i.responsibleGroup.name } : null,
      due_date: i.due_date, cost_once: i.cost_once == null ? null : Number(i.cost_once), cost_recurring: i.cost_recurring == null ? null : Number(i.cost_recurring),
      in_realization_plan: !!link, realization_measure_id: link ? link.id : null, realization_priority: link ? link.priority : null,
    };
  });
}

async function getTargetAnalysis(domainId, targetId, actor) {
  const { BsiModeling, BsiCatalogModule, BsiRiskAnalysisThreat, Threat, Risk, User } = getModels();
  const rm = require('./riskMethodology');
  const { domain, target } = await loadContext(domainId, targetId, actor);
  const sel = await selectionOf(domain, target);
  const [modelings, rows, elementary] = await Promise.all([
    BsiModeling.findAll({ where: { domain_id: domain.id, target_object_id: target.id }, attributes: ['module_id'], order: [['module_id', 'ASC']], raw: true }),
    BsiRiskAnalysisThreat.findAll({
      where: { target_object_id: target.id },
      include: [
        { model: Threat, as: 'threat', attributes: ['id', 'code', 'title', 'description', 'source'] },
        { model: User, as: 'assessedBy', attributes: ['id', 'name'] },
        { model: User, as: 'classifiedBy', attributes: ['id', 'name'] },
      ],
    }),
    elementaryThreats(),
  ]);
  const catMods = domain.catalog_id && modelings.length
    ? await BsiCatalogModule.findAll({ where: { catalog_id: domain.catalog_id, module_id: modelings.map(m => m.module_id) }, attributes: ['module_id', 'title', 'layer'], raw: true })
    : [];
  const modTitle = new Map(catMods.map(m => [m.module_id, m.title]));
  const seeRisks = await allowed(actor, 'risks', 'view', RISK_VIEW_FALLBACK);
  const riskIds = [...new Set(rows.map(r => r.risk_id).filter(Boolean))];
  const riskRows = riskIds.length ? await Risk.findAll({ where: { id: riskIds } }) : [];
  const decorated = seeRisks ? new Map((await rm.decorateRisks(riskRows)).map(d => [d.id, d])) : new Map();
  const rowBy = new Map(rows.map(r => [r.threat_id, r]));
  const list = [...elementary];
  for (const r of rows) if (r.threat && !elementary.some(e => e.id === r.threat_id)) list.push(r.threat.get({ plain: true }));
  const threats = list.map(t => {
    const r = rowBy.get(t.id);
    return {
      threat: { id: t.id, code: t.code, title: t.title, source: t.source, description: t.description ?? null },
      additional: r ? !!r.additional : t.source !== 'bsi_elementar',
      relevant: r ? r.relevant : null,
      relevance_note: r?.relevance_note ?? null,
      coverage: r?.coverage || 'unknown',
      coverage_note: r?.coverage_note ?? null,
      assessed_by: r?.assessedBy ? { id: r.assessedBy.id, name: r.assessedBy.name } : null,
      assessed_at: r?.assessed_at ?? null,
      classified_by: r?.classifiedBy ? { id: r.classifiedBy.id, name: r.classifiedBy.name } : null,
      classified_at: r?.classified_at ?? null,
      has_risk: !!r?.risk_id,
      risk: r?.risk_id && seeRisks ? riskBrief(decorated.get(r.risk_id)) : null,
    };
  });
  const measures = seeRisks ? await additionalMeasures(domain.id, riskRows, actor) : [];
  const active = await rm.getActiveProfile();
  return {
    domain: { id: domain.id, name: domain.name, protection_approach: domain.protection_approach },
    target: { id: target.id, target_type: target.target_type, asset: briefAsset(target.asset) },
    protection_need: sel.protection,
    reasons: sel.reasons,
    decision: sel.decision,
    decision_reason: sel.row?.decision_reason ?? null,
    scenario_not_covered: !!sel.row?.scenario_not_covered,
    scenario_note: sel.row?.scenario_note ?? null,
    included: sel.included,
    status: sel.row?.status || 'open',
    completed_at: sel.row?.completed_at ?? null,
    modules: modelings.map(m => ({ module_id: m.module_id, title: modTitle.get(m.module_id) || null })),
    catalog_threat_mapping: CATALOG_THREAT_MAPPING,
    methodology: active ? { id: active.id, version: active.version, likelihood_size: active.likelihood_levels.length, impact_size: active.impact_levels.length } : null,
    can_see_risks: seeRisks,
    threats,
    additional_measures: measures,
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

const TARGET_FIELDS = Object.freeze(['decision', 'decision_reason', 'scenario_not_covered', 'scenario_note', 'status']);

/**
 * Decide by hand whether a target object is analysed, mark an operating
 * scenario the modules do not cover, set the progress. A manual decision needs
 * a reason, the scenario flag a note.
 */
async function setTargetDecision(domainId, targetId, body, actor, auditReq) {
  const { sequelize, BsiRiskAnalysisTarget } = getModels();
  const src = pick(body && typeof body === 'object' ? body : {}, TARGET_FIELDS);
  const values = {};
  if (hasOwn(src, 'decision')) {
    if (!DECISIONS.includes(src.decision)) throw fail(400, `decision muss einer von ${DECISIONS.join(', ')} sein`);
    values.decision = src.decision;
  }
  if (hasOwn(src, 'decision_reason')) values.decision_reason = text(src.decision_reason, 'Begruendung');
  if (hasOwn(src, 'scenario_not_covered')) values.scenario_not_covered = bool(src.scenario_not_covered, 'scenario_not_covered');
  if (hasOwn(src, 'scenario_note')) values.scenario_note = text(src.scenario_note, 'Beschreibung des Einsatzszenarios');
  if (hasOwn(src, 'status')) {
    if (!ANALYSIS_STATUSES.includes(src.status)) throw fail(400, `status muss einer von ${ANALYSIS_STATUSES.join(', ')} sein`);
    values.status = src.status;
  }
  if (!Object.keys(values).length) throw fail(400, 'Keine Aenderung angegeben');

  const result = await sequelize.transaction(async (transaction) => {
    const { domain, target } = await loadContext(domainId, targetId, actor, transaction);
    let row = await BsiRiskAnalysisTarget.findOne({ where: { target_object_id: target.id }, transaction, lock: transaction.LOCK.UPDATE });
    const cur = row ? row.get({ plain: true }) : { decision: 'auto', decision_reason: null, scenario_not_covered: false, scenario_note: null, status: 'open', completed_at: null };
    const next = { ...cur, ...values };
    if ((hasOwn(values, 'decision') || hasOwn(values, 'decision_reason')) && next.decision !== 'auto' && !next.decision_reason) {
      throw fail(400, 'Fuer das manuelle Hinzufuegen oder Entfernen ist eine Begruendung erforderlich');
    }
    if ((hasOwn(values, 'scenario_not_covered') || hasOwn(values, 'scenario_note')) && next.scenario_not_covered && !next.scenario_note) {
      throw fail(400, 'Fuer ein nicht abgedecktes Einsatzszenario ist eine Beschreibung erforderlich');
    }
    if (hasOwn(values, 'status')) values.completed_at = values.status === 'completed' ? (cur.status === 'completed' ? cur.completed_at : new Date()) : null;
    const before = {};
    const changes = {};
    for (const k of [...TARGET_FIELDS, 'completed_at']) {
      if (!hasOwn(values, k)) continue;
      const a = cur[k] instanceof Date ? cur[k].toISOString() : cur[k];
      const b = values[k] instanceof Date ? values[k].toISOString() : values[k];
      if (a !== b) { before[k] = cur[k] ?? null; changes[k] = values[k]; }
    }
    let created = false;
    if (!row) {
      row = await BsiRiskAnalysisTarget.create({
        domain_id: domain.id, target_object_id: target.id, ...next, completed_at: values.completed_at ?? null, updated_by_id: actor?.id || null,
      }, { transaction });
      created = true;
    } else if (Object.keys(changes).length) {
      await row.update({ ...changes, updated_by_id: actor?.id || null }, { transaction });
    }
    return { domain, target, row, before, changes, created };
  });
  if (result.created || Object.keys(result.changes).length) {
    await auditFromReq(auditReq, result.created ? 'create' : 'update', 'bsi_risk_analysis_target', result.row.id, result.target.asset?.name || `#${result.target.id}`, {
      domain_id: result.domain.id, target_object_id: result.target.id, asset_id: result.target.asset_id, before: result.before, after: result.changes,
    });
  }
  return getTargetAnalysis(domainId, targetId, actor);
}

const THREAT_FIELDS = Object.freeze(['relevant', 'relevance_note', 'coverage', 'coverage_note']);
const COVERAGES = Object.freeze(['unknown', 'covered', 'partially', 'not_covered']);

function threatValues(body) {
  const src = pick(body && typeof body === 'object' ? body : {}, THREAT_FIELDS);
  const values = {};
  if (hasOwn(src, 'relevant')) values.relevant = src.relevant === null || src.relevant === '' ? null : bool(src.relevant, 'relevant');
  if (hasOwn(src, 'relevance_note')) values.relevance_note = text(src.relevance_note, 'Begruendung der Relevanz');
  if (hasOwn(src, 'coverage')) {
    if (!COVERAGES.includes(src.coverage)) throw fail(400, `coverage muss einer von ${COVERAGES.join(', ')} sein`);
    values.coverage = src.coverage;
  }
  if (hasOwn(src, 'coverage_note')) values.coverage_note = text(src.coverage_note, 'Begruendung der Abdeckung');
  return values;
}

async function requireIncluded(domain, target, transaction) {
  const sel = await selectionOf(domain, target, transaction);
  if (!sel.included) throw fail(409, 'Das Zielobjekt ist nicht fuer die Risikoanalyse ausgewaehlt; zuerst hinzufuegen');
  return sel;
}

async function loadThreat(threatId, transaction) {
  const { Threat } = getModels();
  const id = domains.toId(threatId);
  const t = id && await Threat.findByPk(id, { attributes: ['id', 'code', 'title', 'source'], transaction });
  if (!t) throw fail(404, 'Gefaehrdung nicht gefunden');
  return t;
}

const threatLabel = (t) => `${t.code ? `${t.code} ` : ''}${t.title}`.slice(0, 255);

/** Relevance and coverage of a threat for a target object (upsert of the overview line). */
async function setThreatAssessment(domainId, targetId, threatId, body, actor, auditReq) {
  const { sequelize, BsiRiskAnalysisThreat } = getModels();
  const values = threatValues(body);
  if (!Object.keys(values).length) throw fail(400, 'Keine Aenderung angegeben');
  const result = await sequelize.transaction(async (transaction) => {
    const { domain, target } = await loadContext(domainId, targetId, actor, transaction);
    await requireIncluded(domain, target, transaction);
    const threat = await loadThreat(threatId, transaction);
    let row = await BsiRiskAnalysisThreat.findOne({ where: { target_object_id: target.id, threat_id: threat.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row && threat.source !== 'bsi_elementar') throw fail(404, 'Die Gefaehrdung ist nicht Teil der Gefaehrdungsuebersicht; zuerst als zusaetzliche Gefaehrdung hinzufuegen');
    const before = {};
    const changes = {};
    for (const k of THREAT_FIELDS) {
      if (!hasOwn(values, k)) continue;
      const cur = row ? row[k] : (k === 'coverage' ? 'unknown' : null);
      if (cur !== values[k]) { before[k] = cur ?? null; changes[k] = values[k]; }
    }
    let created = false;
    const stamp = Object.keys(changes).length ? { assessed_by_id: actor?.id || null, assessed_at: new Date() } : {};
    if (!row) {
      row = await BsiRiskAnalysisThreat.create({ domain_id: domain.id, target_object_id: target.id, threat_id: threat.id, additional: false, ...values, ...stamp }, { transaction });
      created = true;
    } else if (Object.keys(changes).length) {
      await row.update({ ...changes, ...stamp }, { transaction });
    }
    return { domain, target, threat, row, before, changes, created };
  });
  if (result.created || Object.keys(result.changes).length) {
    await auditFromReq(auditReq, result.created ? 'create' : 'update', 'bsi_risk_analysis_threat', result.row.id, threatLabel(result.threat), {
      domain_id: result.domain.id, target_object_id: result.target.id, asset_id: result.target.asset_id, threat_id: result.threat.id,
      before: result.before, after: result.changes,
    });
  }
  return result.row;
}

/**
 * Add an additional threat (200-3 ch. 4.2) to the overview of a target
 * object: an existing threat that is not elementary (threat_id), or a new
 * one (title, code, description) - creating a threat needs threats.create.
 */
async function addAdditionalThreat(domainId, targetId, body, actor, auditReq) {
  const { sequelize, Threat, BsiRiskAnalysisThreat } = getModels();
  const src = pick(body && typeof body === 'object' ? body : {}, ['threat_id', 'title', 'code', 'description', 'relevance_note']);
  const hasId = src.threat_id !== undefined && src.threat_id !== null && src.threat_id !== '';
  const title = text(src.title, 'Titel', 255);
  if (!hasId && !title) throw fail(400, 'threat_id oder title angeben');
  if (hasId && title) throw fail(400, 'Entweder threat_id oder title angeben, nicht beides');
  const code = text(src.code, 'Kennung', 20);
  const description = text(src.description, 'Beschreibung');
  const note = text(src.relevance_note, 'Begruendung der Relevanz');
  if (!hasId && !(await allowed(actor, 'threats', 'create', THREAT_CREATE_FALLBACK))) {
    throw fail(403, 'Eine neue Gefaehrdung anzulegen erfordert die Berechtigung threats.create; eine bestehende Gefaehrdung kann ueber threat_id hinzugefuegt werden');
  }
  const result = await sequelize.transaction(async (transaction) => {
    const { domain, target } = await loadContext(domainId, targetId, actor, transaction);
    await requireIncluded(domain, target, transaction);
    let threat;
    let threatCreated = false;
    if (hasId) {
      threat = await loadThreat(src.threat_id, transaction);
      if (threat.source === 'bsi_elementar') throw fail(409, 'Elementare Gefaehrdungen sind bereits Teil der Gefaehrdungsuebersicht');
    } else {
      threat = await Threat.create({ source: 'custom', code: code ?? null, title, description: description ?? null }, { transaction });
      threatCreated = true;
    }
    const dup = await BsiRiskAnalysisThreat.findOne({ where: { target_object_id: target.id, threat_id: threat.id }, transaction });
    if (dup) throw fail(409, 'Die Gefaehrdung ist bereits Teil der Gefaehrdungsuebersicht dieses Zielobjekts');
    const row = await BsiRiskAnalysisThreat.create({
      domain_id: domain.id, target_object_id: target.id, threat_id: threat.id, additional: true,
      relevant: true, relevance_note: note ?? null, coverage: 'not_covered',
      assessed_by_id: actor?.id || null, assessed_at: new Date(),
    }, { transaction });
    return { domain, target, threat, threatCreated, row };
  });
  if (result.threatCreated) {
    await auditFromReq(auditReq, 'create', 'threat', result.threat.id, result.threat.title, { source: 'custom', code: result.threat.code, origin: 'bsi_risk_analysis' });
  }
  await auditFromReq(auditReq, 'create', 'bsi_risk_analysis_threat', result.row.id, threatLabel(result.threat), {
    domain_id: result.domain.id, target_object_id: result.target.id, asset_id: result.target.asset_id, threat_id: result.threat.id,
    additional: true, relevant: true, coverage: 'not_covered',
  });
  return result.row;
}

const CLASSIFY_FIELDS = Object.freeze(['likelihood', 'impact', 'likelihood_rationale', 'impact_rationale', 'impact_dimensions', 'owner_id', 'category']);

/**
 * Risk classification (200-3 ch. 5): frequency x impact on the scales of the
 * active risk methodology. Creates the risk (scenario: asset of the target
 * object x threat) on the first classification and updates it afterwards -
 * the overview line holds the risk and is locked for the duration, so two
 * concurrent classifications cannot create two risks. Rationales are
 * mandatory like everywhere in the register (services/riskService.js).
 */
async function classifyThreat(domainId, targetId, threatId, body, actor, auditReq) {
  const { sequelize, BsiRiskAnalysisThreat, Risk, Asset } = getModels();
  const riskService = require('./riskService');
  const src = pick(body && typeof body === 'object' ? body : {}, CLASSIFY_FIELDS);
  for (const k of ['likelihood', 'impact']) {
    if (src[k] === undefined || src[k] === null || src[k] === '') throw fail(400, 'Haeufigkeit (likelihood) und Auswirkung (impact) angeben');
  }
  let outcome = null;
  // The transaction only holds the row lock (SELECT ... FOR UPDATE) of the
  // overview line; the risk itself is written by the risk service on its own
  // connection, with its validation, history and audit entries.
  await sequelize.transaction(async (transaction) => {
    const { domain, target } = await loadContext(domainId, targetId, actor, transaction);
    await requireIncluded(domain, target, transaction);
    const threat = await loadThreat(threatId, transaction);
    const row = await BsiRiskAnalysisThreat.findOne({ where: { target_object_id: target.id, threat_id: threat.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!row || row.relevant !== true) throw fail(409, 'Die Gefaehrdung ist fuer dieses Zielobjekt nicht als relevant eingestuft');
    const existing = row.risk_id ? await Risk.findByPk(row.risk_id) : null;
    let risk;
    let created = false;
    if (existing) {
      if (!(await allowed(actor, 'risks', 'edit', RISK_EDIT_FALLBACK)) || !riskService.canWriteRisk(actor, existing)) {
        throw fail(403, `Das Risiko ${existing.ref || existing.id} darf nur der Risiko-Owner, admin oder assessor aendern`);
      }
      const upd = pick(src, ['likelihood', 'impact', 'likelihood_rationale', 'impact_rationale', 'impact_dimensions', 'category', 'owner_id']);
      risk = await riskService.updateRisk(existing, upd, actor, auditReq, { partial: true });
    } else {
      if (!(await allowed(actor, 'risks', 'create', RISK_CREATE_FALLBACK))) throw fail(403, 'Ein Risiko anzulegen erfordert die Berechtigung risks.create');
      const asset = await Asset.findByPk(target.asset_id, { attributes: ['id', 'name', 'owner_id'], transaction });
      const label = threatLabel(threat);
      const title = `${label} – ${asset.name}`.slice(0, 255);
      const description = `Risikoanalyse nach BSI-Standard 200-3: Informationsverbund „${domain.name}“, Zielobjekt „${asset.name}“, Gefährdung ${label}.`;
      risk = await riskService.createRisk({
        ...src,
        title,
        description,
        owner_id: src.owner_id ?? asset.owner_id ?? null,
        asset_ids: [asset.id],
        threat_ids: [threat.id],
        scenarios: [{ asset_ids: [asset.id], threat_id: threat.id, description: `BSI 200-3: ${label}` }],
      }, actor, auditReq);
      created = true;
    }
    await row.update({ risk_id: risk.id, classified_by_id: actor?.id || null, classified_at: new Date() }, { transaction });
    outcome = { domain, target, threat, row, risk, created };
  });
  await auditFromReq(auditReq, 'update', 'bsi_risk_analysis_threat', outcome.row.id, threatLabel(outcome.threat), {
    action: 'classify', domain_id: outcome.domain.id, target_object_id: outcome.target.id, asset_id: outcome.target.asset_id,
    threat_id: outcome.threat.id, risk_id: outcome.risk.id, risk_created: outcome.created,
    likelihood: outcome.risk.likelihood, impact: outcome.risk.impact, inherent_level: outcome.risk.inherent_level,
  });
  return { created: outcome.created, risk: outcome.risk };
}

// ── Consolidation (200-3 ch. 7) ─────────────────────────────────────────────

/** Risks created from the risk analysis of a domain: risk_id -> [target_object_id]. */
async function domainRiskTargets(domainId, transaction) {
  const { BsiRiskAnalysisThreat } = getModels();
  const rows = await BsiRiskAnalysisThreat.findAll({ where: { domain_id: domainId, risk_id: { [Op.ne]: null } }, attributes: ['risk_id', 'target_object_id'], raw: true, transaction });
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.risk_id)) out.set(r.risk_id, []);
    if (!out.get(r.risk_id).includes(r.target_object_id)) out.get(r.risk_id).push(r.target_object_id);
  }
  return out;
}

/**
 * Additional requirements of target objects for the IT-Grundschutz-Check:
 * the measures (planned, in progress, implemented) of the risks from the risk
 * analysis, grouped by target object. Only target objects in visibleTargetIds
 * and only measures the actor may see. Empty without risks.view.
 * @returns {Map<number, object[]>}
 */
async function measuresByTarget(domainId, actor, visibleTargetIds) {
  const { Risk } = getModels();
  const out = new Map();
  if (!(await allowed(actor, 'risks', 'view', RISK_VIEW_FALLBACK))) return out;
  const targetsByRisk = await domainRiskTargets(domainId);
  const riskIds = [...targetsByRisk.keys()];
  if (!riskIds.length) return out;
  const risks = await Risk.findAll({ where: { id: riskIds }, attributes: ['id', 'ref', 'title', 'owner_id'] });
  const measures = await additionalMeasures(domainId, risks, actor);
  for (const m of measures) {
    for (const tid of targetsByRisk.get(m.risk_id) || []) {
      if (!visibleTargetIds.has(tid)) continue;
      if (!out.has(tid)) out.set(tid, []);
      out.get(tid).push(m);
    }
  }
  return out;
}

async function loadMeasureContext(domainId, treatmentItemId, actor, transaction) {
  const { BsiTargetObject, Asset, RiskTreatmentItem, Risk } = getModels();
  const domain = await domains.loadDomain(domainId, transaction);
  const id = domains.toId(treatmentItemId);
  const item = id && await RiskTreatmentItem.findByPk(id, { include: [{ model: Risk, as: 'risk', attributes: ['id', 'ref', 'title', 'owner_id'] }], transaction });
  const show = await itemFilter(actor);
  if (!item || !item.risk || !show(item, item.risk)) throw fail(404, 'Massnahme nicht gefunden');
  const targetIds = (await domainRiskTargets(domain.id, transaction)).get(item.risk_id) || [];
  if (!targetIds.length) throw fail(409, 'Die Massnahme gehoert zu keinem Risiko aus der Risikoanalyse dieses Informationsverbunds');
  const visible = await domains.assetFilter(actor);
  const tos = await BsiTargetObject.findAll({ where: { id: targetIds }, include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'owner_id', 'assessor_id'] }], transaction });
  if (!tos.some(t => t.asset && visible(t.asset))) throw fail(404, 'Massnahme nicht gefunden');
  return { domain, item };
}

const priorityValue = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!PRIORITIES.includes(v)) throw fail(400, `priority muss einer von ${PRIORITIES.join(', ')} sein`);
  return v;
};

/** Take a measure of the treatment plan over into the realisation plan of the domain. */
async function addRealizationMeasure(domainId, body, actor, auditReq) {
  const { sequelize, BsiRealizationMeasure } = getModels();
  const src = pick(body && typeof body === 'object' ? body : {}, ['treatment_item_id', 'priority']);
  const priority = priorityValue(src.priority) ?? null;
  const result = await sequelize.transaction(async (transaction) => {
    const { domain, item } = await loadMeasureContext(domainId, src.treatment_item_id, actor, transaction);
    if (item.status === 'discarded') throw fail(409, 'Eine verworfene Massnahme wird nicht in den Realisierungsplan uebernommen');
    const dup = await BsiRealizationMeasure.findOne({ where: { domain_id: domain.id, treatment_item_id: item.id }, transaction });
    if (dup) throw fail(409, 'Die Massnahme ist bereits im Realisierungsplan');
    const row = await BsiRealizationMeasure.create({ domain_id: domain.id, treatment_item_id: item.id, priority, added_by_id: actor?.id || null }, { transaction });
    return { domain, item, row };
  });
  await auditFromReq(auditReq, 'create', 'bsi_realization_measure', result.row.id, result.item.title, {
    domain_id: result.domain.id, treatment_item_id: result.item.id, risk_id: result.item.risk_id, priority,
  });
  return result.row;
}

async function loadRealizationMeasure(domainId, measureId, actor, transaction) {
  const { BsiRealizationMeasure } = getModels();
  const domain = await domains.loadDomain(domainId, transaction);
  const id = domains.toId(measureId);
  const row = id && await BsiRealizationMeasure.findOne({ where: { id, domain_id: domain.id }, transaction, lock: transaction ? transaction.LOCK.UPDATE : undefined });
  if (!row) throw fail(404, 'Eintrag im Realisierungsplan nicht gefunden');
  const { item } = await loadMeasureContext(domain.id, row.treatment_item_id, actor, transaction);
  return { domain, row, item };
}

async function updateRealizationMeasure(domainId, measureId, body, actor, auditReq) {
  const { sequelize } = getModels();
  const src = pick(body && typeof body === 'object' ? body : {}, ['priority']);
  if (!hasOwn(src, 'priority')) throw fail(400, 'priority angeben');
  const priority = priorityValue(src.priority);
  const result = await sequelize.transaction(async (transaction) => {
    const { domain, row, item } = await loadRealizationMeasure(domainId, measureId, actor, transaction);
    const before = row.priority;
    if (before !== priority) await row.update({ priority }, { transaction });
    return { domain, row, item, before };
  });
  if (result.before !== priority) {
    await auditFromReq(auditReq, 'update', 'bsi_realization_measure', result.row.id, result.item.title, {
      domain_id: result.domain.id, treatment_item_id: result.item.id, before: { priority: result.before }, after: { priority },
    });
  }
  return result.row;
}

/** Take a measure out of the realisation plan again (the treatment item stays). */
async function removeRealizationMeasure(domainId, measureId, actor, auditReq) {
  const { sequelize } = getModels();
  const result = await sequelize.transaction(async (transaction) => {
    const { domain, row, item } = await loadRealizationMeasure(domainId, measureId, actor, transaction);
    const snapshot = { treatment_item_id: row.treatment_item_id, priority: row.priority, added_by_id: row.added_by_id };
    await row.destroy({ transaction });
    return { domain, row, item, snapshot };
  });
  await auditFromReq(auditReq, 'delete', 'bsi_realization_measure', result.row.id, result.item.title, { domain_id: result.domain.id, ...result.snapshot });
  return { ok: true };
}

// ── Realisation plan (reference document A.6) ───────────────────────────────

const OPEN_CHECK_STATUSES = Object.freeze(['not_implemented', 'in_progress']);
const todayStr = () => new Date().toISOString().slice(0, 10);
const cents = (v) => (v == null ? 0 : Math.round(Number(v) * 100));

/** Requirement entries of the check that belong into the plan (nein / teilweise). */
function requirementPlanItems(check) {
  return check.entries
    .filter(e => OPEN_CHECK_STATUSES.includes(e.implementation_status))
    .map(e => ({
      kind: 'requirement',
      key: `r:${e.target_object_id ?? 'domain'}:${e.req_id}`,
      entry_id: e.entry_id,
      target_object_id: e.target_object_id,
      target_name: e.target_object_id == null ? null : e.target_name,
      target_type: e.target_type,
      ref: e.req_id,
      title: e.title,
      module_id: e.module_id,
      module_title: e.module_title,
      level: e.requirement_level,
      status: e.implementation_status,
      responsible: e.responsible?.name || e.responsible_group?.name || null,
      responsible_user_id: e.responsible?.id ?? null,
      responsible_group_id: e.responsible_group?.id ?? null,
      due_date: e.due_date,
      cost_once: e.cost_once,
      cost_recurring: e.cost_recurring,
      priority: e.realization_priority || suggestRequirementPriority(e.requirement_level),
      priority_source: e.realization_priority ? 'set' : 'suggested',
      note: e.justification || e.notes || null,
    }));
}

function summarizePlan(items, extra = {}) {
  const today = todayStr();
  const done = (i) => i.status === 'implemented';
  const sum = (k) => items.reduce((s, i) => s + cents(i[k]), 0) / 100;
  return {
    items: items.length,
    requirements: items.filter(i => i.kind === 'requirement').length,
    measures: items.filter(i => i.kind === 'measure').length,
    by_priority: Object.fromEntries(PRIORITIES.map(p => [p, items.filter(i => i.priority === p).length])),
    overdue: items.filter(i => !done(i) && i.due_date && String(i.due_date).slice(0, 10) < today).length,
    without_responsible: items.filter(i => !i.responsible).length,
    without_due_date: items.filter(i => !i.due_date).length,
    cost_once_total: sum('cost_once'),
    cost_recurring_total: sum('cost_recurring'),
    ...extra,
  };
}

async function getRealizationPlan(domainId, actor) {
  const { BsiRealizationMeasure, RiskTreatmentItem, Risk, User, Group, BsiTargetObject, Asset } = getModels();
  const bsiCheck = require('./bsiCheckService');
  const rm = require('./riskMethodology');
  const check = await bsiCheck.getCheck(domainId, actor, { withMeasures: false });
  const items = requirementPlanItems(check);
  const notChecked = check.entries.filter(e => e.implementation_status === 'not_started').length;

  // Measures taken over from the treatment plans: visible like the treatment
  // plan overview, and only with a visible target object.
  if (await allowed(actor, 'risks', 'view', RISK_VIEW_FALLBACK)) {
    const links = await BsiRealizationMeasure.findAll({
      where: { domain_id: check.domain.id },
      include: [{
        model: RiskTreatmentItem, as: 'treatmentItem',
        include: [
          { model: Risk, as: 'risk', attributes: ['id', 'ref', 'title', 'owner_id', 'likelihood', 'impact', 'residual_likelihood', 'residual_impact', 'inherent_level', 'residual_level', 'methodology_id', 'category'] },
          { model: User, as: 'responsibleUser', attributes: ['id', 'name'] },
          { model: Group, as: 'responsibleGroup', attributes: ['id', 'name'] },
        ],
      }],
    });
    const show = await itemFilter(actor);
    const visibleLinks = links.filter(l => l.treatmentItem?.risk && show(l.treatmentItem, l.treatmentItem.risk));
    const targetsByRisk = await domainRiskTargets(check.domain.id);
    const visible = await domains.assetFilter(actor);
    const allTargetIds = [...new Set(visibleLinks.flatMap(l => targetsByRisk.get(l.treatmentItem.risk_id) || []))];
    const tos = allTargetIds.length
      ? await BsiTargetObject.findAll({ where: { id: allTargetIds }, include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'owner_id', 'assessor_id'] }] })
      : [];
    const targetBy = new Map(tos.filter(t => t.asset && visible(t.asset)).map(t => [t.id, t]));
    const decorated = new Map((await rm.decorateRisks(visibleLinks.map(l => l.treatmentItem.risk))).map(d => [d.id, d]));
    for (const l of visibleLinks) {
      const it = l.treatmentItem;
      const targets = (targetsByRisk.get(it.risk_id) || []).map(id => targetBy.get(id)).filter(Boolean);
      if (!targets.length) continue;
      const d = decorated.get(it.risk_id) || {};
      items.push({
        kind: 'measure',
        key: `m:${l.id}`,
        realization_measure_id: l.id,
        treatment_item_id: it.id,
        risk_id: it.risk_id,
        target_object_id: targets[0].id,
        target_name: targets.map(t => t.asset.name).join(', '),
        target_type: targets[0].target_type,
        ref: it.risk.ref,
        title: it.title,
        risk_title: it.risk.title,
        level: d.effective_level ?? null,
        treatment_option: it.treatment_option,
        status: it.status,
        responsible: it.responsibleUser?.name || it.responsibleGroup?.name || null,
        responsible_user_id: it.responsible_user_id ?? null,
        responsible_group_id: it.responsible_group_id ?? null,
        due_date: it.due_date,
        cost_once: it.cost_once == null ? null : Number(it.cost_once),
        cost_recurring: it.cost_recurring == null ? null : Number(it.cost_recurring),
        priority: l.priority || suggestMeasurePriority(d.effective_level),
        priority_source: l.priority ? 'set' : 'suggested',
        note: it.description || null,
      });
    }
  }
  const sorted = sortPlanItems(items);
  return {
    domain: check.domain,
    generated_at: new Date().toISOString(),
    summary: summarizePlan(sorted, { not_checked_requirements: notChecked }),
    items: sorted,
  };
}

// Columns of the realisation plan export (reference document A.6:
// Zielobjekt, Baustein/Anforderung bzw. Massnahme, Verantwortlich, Termin,
// Kosten, Prioritaet), formula-neutralised like the A.4 export.
const A6_COLUMNS = Object.freeze([
  'Priorität', 'Art', 'Zielobjekt', 'Referenz', 'Anforderung / Maßnahme', 'Baustein / Risiko', 'Stufe', 'Status',
  'Verantwortlich', 'Umsetzung bis', 'Kosten einmalig (EUR)', 'Kosten laufend (EUR/Jahr)', 'Bemerkung',
]);
const PRIORITY_LABELS = Object.freeze({ high: 'hoch', medium: 'mittel', low: 'niedrig' });
const KIND_LABELS = Object.freeze({ requirement: 'Anforderung (IT-Grundschutz-Check)', measure: 'Zusätzliche Maßnahme (Risikoanalyse)' });
const STATUS_LABELS = Object.freeze({
  not_implemented: 'nein', in_progress: 'teilweise', implemented: 'umgesetzt', not_applicable: 'entbehrlich', not_started: 'offen',
  planned: 'geplant', discarded: 'verworfen',
});
const LEVEL_LABELS = Object.freeze({
  basis: 'B', standard: 'S', erhoehter_schutzbedarf: 'H', normal_sdt: 'normal-SdT', erhoeht: 'erhöht',
  low: 'niedrig', medium: 'mittel', high: 'hoch', critical: 'kritisch',
});

function buildA6Rows(plan) {
  const { neutralize } = require('./bsiCheckService');
  const rows = plan.items.map(i => [
    neutralize(`${PRIORITY_LABELS[i.priority] || i.priority}${i.priority_source === 'suggested' ? ' (Vorschlag)' : ''}`),
    neutralize(KIND_LABELS[i.kind]),
    neutralize(i.target_name || `Informationsverbund: ${plan.domain.name}`),
    neutralize(i.ref),
    neutralize(i.title),
    neutralize(i.kind === 'requirement' ? [i.module_id, i.module_title].filter(Boolean).join(' ') : i.risk_title),
    neutralize(LEVEL_LABELS[i.level] || i.level || ''),
    neutralize(i.kind === 'measure' && i.status === 'in_progress' ? 'in Umsetzung' : (STATUS_LABELS[i.status] || i.status)),
    neutralize(i.responsible),
    neutralize(i.due_date ? String(i.due_date).slice(0, 10) : ''),
    i.cost_once == null ? null : Number(i.cost_once),
    i.cost_recurring == null ? null : Number(i.cost_recurring),
    neutralize(i.note),
  ]);
  return { columns: A6_COLUMNS, rows };
}

module.exports = {
  RiskAnalysisError,
  PROTECTION_CATEGORIES,
  SELECTION_REASONS,
  DECISIONS,
  ANALYSIS_STATUSES,
  COVERAGES,
  PRIORITIES,
  OPEN_CHECK_STATUSES,
  A6_COLUMNS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  LEVEL_LABELS,
  CATALOG_THREAT_MAPPING,
  protectionCategory,
  protectionNeed,
  selectionReasons,
  isIncluded,
  suggestRequirementPriority,
  suggestMeasurePriority,
  sortPlanItems,
  threatOrder,
  requirementPlanItems,
  summarizePlan,
  buildA6Rows,
  currentAssessments,
  getAnalysis,
  getTargetAnalysis,
  setTargetDecision,
  setThreatAssessment,
  addAdditionalThreat,
  classifyThreat,
  measuresByTarget,
  domainRiskTargets,
  addRealizationMeasure,
  updateRealizationMeasure,
  removeRealizationMeasure,
  getRealizationPlan,
};
