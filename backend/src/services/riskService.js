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
const categories = require('./riskCategoryService');

const models = () => require('../models');
const { httpError } = rm;

const FIELDS = ['title', 'description', 'category', 'owner_id', 'likelihood', 'impact', 'treatment', 'treatment_plan', 'status', 'review_date', 'acceptance_document_id',
  'impact_dimensions', 'likelihood_rationale', 'impact_rationale', 'target_likelihood', 'target_impact'];
const TREATMENTS = ['mitigate', 'accept', 'transfer', 'avoid'];
const STATUSES = ['open', 'in_treatment', 'accepted', 'closed'];
const SNAPSHOT = ['title', 'description', 'category', 'owner_id', 'likelihood', 'impact', 'impact_dimensions', 'inherent_level', 'likelihood_rationale', 'impact_rationale',
  'residual_likelihood', 'residual_impact', 'residual_level', 'residual_override', 'target_likelihood', 'target_impact', 'target_level',
  'treatment', 'status', 'review_date', 'methodology_id', 'accepted_by_id', 'accepted_until'];
const RATIONALE_MAX = 4000;
const MAX_SCENARIOS = 50;
const MAX_SCENARIO_ASSETS = 50;
const CLEAR_OVERRIDE = { residual_override: false, residual_override_reason: null, residual_override_by_id: null, residual_override_at: null };
const CLEAR_ACCEPTANCE = { accepted_by_id: null, accepted_at: null, accepted_until: null };

const includeAll = () => {
  const { User, Asset, Threat, Control, Document, VvtEntry, Incident } = models();
  return [
    { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
    { model: User, as: 'acceptedBy', attributes: ['id', 'name'] },
    { model: User, as: 'residualOverrideBy', attributes: ['id', 'name'] },
    { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
    { model: Threat, as: 'threats', attributes: ['id', 'code', 'title', 'source'], through: { attributes: [] } },
    { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework', 'status'], through: { attributes: ['effectiveness'] } },
    { model: Document, as: 'acceptanceDocument', attributes: ['id', 'original_name'] },
    { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
    { model: Incident, as: 'incidents', through: { attributes: [] } },
  ];
};

// Datensatzrechte (wie GET /api/risks/:id): admin und assessor alle, sonst nur eigene.
const { hasRole } = require('./accessService');
const canWriteRisk = (user, risk) => !!user && (hasRole(user, 'admin', 'assessor') || risk.owner_id === user.id);
const canViewRisk = canWriteRisk;
// Freigabe: zusaetzlich die Geschaeftsleitung fuer jedes Risiko. Ob die Rolle die
// Stufe akzeptieren darf, entscheidet danach die Akzeptanzbefugnis der Methodik.
const canSignoffRecord = (user, risk) => !!user && (hasRole(user, 'admin', 'assessor', 'management') || risk.owner_id === user.id);

// Risk scenarios (asset(s) x threat x vulnerability) - only in the detail view
// (GET /api/risks/:id, isms_get_risk), which checks the record rights. The
// register list is readable by more roles and does not carry them.
const includeScenarios = () => {
  const { RiskScenario, Asset, Threat, Vulnerability } = models();
  return {
    model: RiskScenario, as: 'scenarios', separate: true, order: [['sort_order', 'ASC'], ['id', 'ASC']],
    include: [
      { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
      { model: Threat, as: 'threat', attributes: ['id', 'code', 'title', 'source'] },
      { model: Vulnerability, as: 'vulnerability', attributes: ['id', 'ref', 'title', 'source', 'cve_id', 'severity', 'status'] },
    ],
  };
};
const includeDetail = () => [...includeAll(), includeScenarios()];

const snapshot = (risk) => Object.fromEntries(SNAPSHOT.map(f => [f, risk[f] ?? null]));
const toInt = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) ? n : null; };
const toDate = (v) => (v === '' || v === 'Invalid date' || v === undefined || v === null) ? null : v;
const rationale = (label) => (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw httpError(400, `${label} muss Text sein.`);
  const s = v.trim();
  if (s.length > RATIONALE_MAX) throw httpError(400, `${label} ist länger als ${RATIONALE_MAX} Zeichen.`);
  return s || null;
};
// Dimension values from the fixed catalogue only - the input's keys are
// checked by the hook (riskMethodology.normalizeDimensions), never copied.
const dimensions = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw httpError(400, 'Auswirkungsdimensionen: Objekt { dimension: Wert } erwartet.');
  const foreign = Object.keys(v).filter(k => !rm.DIMENSION_KEYS.includes(k));
  if (foreign.length) throw httpError(400, `Unbekannte Auswirkungsdimension. Möglich: ${rm.DIMENSION_KEYS.join(', ')}.`);
  const out = {};
  for (const key of rm.DIMENSION_KEYS) {
    const raw = v[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = toInt(raw);
    if (n === null) throw httpError(400, `Auswirkung „${key}“ muss eine ganze Zahl sein.`);
    out[key] = n;
  }
  return Object.keys(out).length ? out : null;
};
const stableDims = (d) => JSON.stringify(rm.DIMENSION_KEYS.map(k => (d && d[k] != null ? Number(d[k]) : null)));

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
  // Fields added in 3.7.0 change only when sent - also on a full PUT, so a
  // client that does not know them yet cannot wipe them by omission.
  const setIfSent = (k, conv) => { if (has(k)) f[k] = conv(src[k]); };
  setIfSent('impact_dimensions', dimensions);
  setIfSent('likelihood_rationale', rationale('Begründung der Wahrscheinlichkeit'));
  setIfSent('impact_rationale', rationale('Begründung der Auswirkung'));
  setIfSent('target_likelihood', v => toInt(v));
  setIfSent('target_impact', v => toInt(v));
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

const controlLinks = (controls) => (controls || []).map(c => ({ effectiveness: c.RiskControl?.effectiveness, status: c.status }));

// Net risk from the implemented controls. An overridden net risk stays as set;
// the calculated value is still reported (decorate: residual_calculated).
const recomputeResidual = async (risk) => {
  if (risk.residual_override) return;
  const controls = await risk.getControls({ joinTableAttributes: ['effectiveness'] });
  const profile = await rm.profileForRisk(risk);
  await risk.update(computeResidual(risk.likelihood, risk.impact, controlLinks(controls), profile));
};

const calculatedResidual = async (risk) => {
  const controls = Array.isArray(risk.controls) ? risk.controls : await risk.getControls({ joinTableAttributes: ['effectiveness'] });
  return computeResidual(risk.likelihood, risk.impact, controlLinks(controls), await rm.profileForRisk(risk));
};

/**
 * Methodology fields (riskMethodology.decorateRisks) plus, for an overridden
 * net risk, the value the calculation would give - so the deviation stays
 * visible wherever the override is shown.
 */
const decorate = async (rows) => {
  const out = await rm.decorateRisks(rows);
  for (const r of out) {
    if (!r.residual_override || !Array.isArray(r.controls)) continue;
    const own = await rm.profileForRisk(r);
    r.residual_calculated = computeResidual(r.likelihood, r.impact, controlLinks(r.controls), own);
  }
  return out;
};

const loadFull = async (id) => (await decorate([await models().Risk.findByPk(id, { include: includeDetail() })]))[0];

// ── Rationale (ISO 27005:2022 8.3) ──────────────────────────────────────────
//
// Whoever sets or changes likelihood or impact (including an impact dimension)
// states why, in the same request. Existing risks without a rationale stay
// editable as long as their values do not change - like the justification of
// the BSI check (services/bsiCheckService.js).
const effectiveImpact = (dims, impact) => {
  const vals = dims ? Object.values(dims).filter(v => v != null).map(Number) : [];
  return vals.length ? Math.max(...vals) : (impact == null ? null : Number(impact));
};
const requireRationale = (existing, f, body, { reassess = false } = {}) => {
  const sent = (k) => !!body && Object.prototype.hasOwnProperty.call(body, k) && typeof f[k] === 'string' && f[k] !== '';
  const newL = f.likelihood !== undefined ? f.likelihood : existing?.likelihood;
  const newDims = f.impact_dimensions !== undefined ? f.impact_dimensions : (existing?.impact_dimensions ?? null);
  const newI = effectiveImpact(newDims, f.impact !== undefined ? f.impact : existing?.impact);
  const likelihoodChanged = !existing || reassess || Number(newL) !== Number(existing.likelihood);
  const impactChanged = !existing || reassess || newI !== Number(existing.impact) || stableDims(newDims) !== stableDims(existing.impact_dimensions);
  if (likelihoodChanged && !sent('likelihood_rationale')) {
    throw httpError(400, 'Begründung der Wahrscheinlichkeit erforderlich: Bei jeder Bewertung oder Änderung der Wahrscheinlichkeit angeben (likelihood_rationale).');
  }
  if (impactChanged && !sent('impact_rationale')) {
    throw httpError(400, 'Begründung der Auswirkung erforderlich: Bei jeder Bewertung oder Änderung der Auswirkung angeben (impact_rationale).');
  }
  return { likelihoodChanged, impactChanged };
};

// ── Scenarios: asset(s) x threat x vulnerability ────────────────────────────

const parseScenarios = async (raw) => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw httpError(400, 'scenarios muss eine Liste sein.');
  if (raw.length > MAX_SCENARIOS) throw httpError(400, `Höchstens ${MAX_SCENARIOS} Szenarien je Risiko.`);
  const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const list = raw.map((o, idx) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw httpError(400, `Szenario ${idx + 1}: ungültig.`);
    const rawAssets = o.asset_ids === undefined || o.asset_ids === null ? [] : o.asset_ids;
    if (!Array.isArray(rawAssets)) throw httpError(400, `Szenario ${idx + 1}: asset_ids muss eine Liste sein.`);
    const asset_ids = [...new Set(rawAssets.map(posInt))];
    if (asset_ids.includes(null)) throw httpError(400, `Szenario ${idx + 1}: ungültige Asset-Kennung.`);
    if (asset_ids.length > MAX_SCENARIO_ASSETS) throw httpError(400, `Szenario ${idx + 1}: höchstens ${MAX_SCENARIO_ASSETS} Assets.`);
    const threat_id = o.threat_id === undefined || o.threat_id === null || o.threat_id === '' ? null : posInt(o.threat_id);
    const vulnerability_id = o.vulnerability_id === undefined || o.vulnerability_id === null || o.vulnerability_id === '' ? null : posInt(o.vulnerability_id);
    if ((o.threat_id != null && o.threat_id !== '' && !threat_id) || (o.vulnerability_id != null && o.vulnerability_id !== '' && !vulnerability_id)) {
      throw httpError(400, `Szenario ${idx + 1}: ungültige Kennung.`);
    }
    let description = null;
    if (o.description !== undefined && o.description !== null) {
      if (typeof o.description !== 'string') throw httpError(400, `Szenario ${idx + 1}: Beschreibung muss Text sein.`);
      description = o.description.trim().slice(0, 2000) || null;
    }
    if (!asset_ids.length && !threat_id && !vulnerability_id) throw httpError(400, `Szenario ${idx + 1}: mindestens ein Asset, eine Bedrohung oder eine Schwachstelle angeben.`);
    return { asset_ids: asset_ids.sort((a, b) => a - b), threat_id, vulnerability_id, description };
  });
  const { Asset, Threat, Vulnerability } = models();
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const assets = uniq(list.flatMap(s => s.asset_ids));
  const threats = uniq(list.map(s => s.threat_id));
  const vulns = uniq(list.map(s => s.vulnerability_id));
  if (assets.length && await Asset.count({ where: { id: assets } }) !== assets.length) throw httpError(400, 'Szenario: unbekanntes Asset.');
  if (threats.length && await Threat.count({ where: { id: threats } }) !== threats.length) throw httpError(400, 'Szenario: unbekannte Bedrohung.');
  if (vulns.length && await Vulnerability.count({ where: { id: vulns } }) !== vulns.length) throw httpError(400, 'Szenario: unbekannte Schwachstelle.');
  return list;
};

const scenarioSnapshot = async (riskId) => {
  const { RiskScenario, Asset } = models();
  const rows = await RiskScenario.findAll({ where: { risk_id: riskId }, order: [['sort_order', 'ASC'], ['id', 'ASC']], include: [{ model: Asset, as: 'assets', attributes: ['id'], through: { attributes: [] } }] });
  return rows.map(r => ({ asset_ids: r.assets.map(a => a.id).sort((a, b) => a - b), threat_id: r.threat_id, vulnerability_id: r.vulnerability_id, description: r.description }));
};

const replaceScenarios = async (riskId, list) => {
  const { RiskScenario, sequelize } = models();
  await sequelize.transaction(async (transaction) => {
    await RiskScenario.destroy({ where: { risk_id: riskId }, transaction });
    for (const [idx, s] of list.entries()) {
      const row = await RiskScenario.create({ risk_id: riskId, threat_id: s.threat_id, vulnerability_id: s.vulnerability_id, description: s.description, sort_order: idx }, { transaction });
      if (s.asset_ids.length) await row.setAssets(s.asset_ids, { transaction });
    }
  });
};

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
  const f = buildFields(body, { partial: false });
  f.category = await categories.checkForRisk(f.category, undefined);
  requireRationale(null, f, body);
  const scenarios = await parseScenarios(body.scenarios);
  const risk = await Risk.create(f);
  await applyLinks(risk, body);
  if (scenarios) await replaceScenarios(risk.id, scenarios);
  await recomputeResidual(risk);
  await auditFromReq(auditReq, 'create', 'risk', risk.id, risk.title, {
    level: risk.inherent_level, treatment: risk.treatment, methodology_id: risk.methodology_id, category: risk.category,
    likelihood: risk.likelihood, impact: risk.impact, impact_dimensions: risk.impact_dimensions,
    likelihood_rationale: risk.likelihood_rationale, impact_rationale: risk.impact_rationale,
    target_level: risk.target_level, ...(scenarios ? { scenarios } : {}),
  });
  await notifyOwner(risk, user);
  return loadFull(risk.id);
};

const updateRisk = async (risk, body, user, auditReq, { partial = false } = {}) => {
  if (!canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const before = snapshot(risk);
  const beforeLevel = await levelOf(risk);
  const prevOwner = risk.owner_id;
  const f = buildFields(body, { partial, existing: risk });
  if (f.category !== undefined) f.category = await categories.checkForRisk(f.category, risk.category);
  const scenarios = await parseScenarios(body?.scenarios);

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
    // The same goes for an override, the target risk and impact dimensions of
    // the old version: they are dropped unless sent for the new scale.
    Object.assign(f, { residual_likelihood: null, residual_impact: null, residual_level: null, ...CLEAR_OVERRIDE });
    if (f.target_likelihood === undefined && f.target_impact === undefined) Object.assign(f, { target_likelihood: null, target_impact: null });
    if (f.impact_dimensions === undefined) f.impact_dimensions = null;
    reassess = { from_version: own.version ?? null, to_version: active.version, override_cleared: !!risk.residual_override };
  }
  requireRationale(risk, f, body, { reassess: !!reassess });
  const beforeScenarios = scenarios ? await scenarioSnapshot(risk.id) : null;
  if (risk.status === 'accepted' && f.status && f.status !== 'accepted') Object.assign(f, CLEAR_ACCEPTANCE);

  await risk.update(f);
  await applyLinks(risk, body || {});
  if (scenarios) await replaceScenarios(risk.id, scenarios);
  await recomputeResidual(risk);
  const lapsed = await lapseIfRaised(risk, beforeLevel, auditReq);

  if (risk.owner_id && String(prevOwner) !== String(risk.owner_id)) await notifyOwner(risk, user);
  const after = snapshot(risk);
  const scenarioChange = scenarios && JSON.stringify(beforeScenarios) !== JSON.stringify(scenarios) ? { scenarios: { before: beforeScenarios, after: scenarios } } : {};
  await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, { before, after, ...scenarioChange, ...(lapsed ? { acceptance_lapsed: true } : {}) });
  if (reassess) {
    await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, {
      action: 'reassess', mode: 'manual', ...reassess,
      before: { likelihood: before.likelihood, impact: before.impact, impact_dimensions: before.impact_dimensions, inherent_level: before.inherent_level, residual_level: before.residual_level, target_level: before.target_level },
      after: { likelihood: after.likelihood, impact: after.impact, impact_dimensions: after.impact_dimensions, inherent_level: after.inherent_level, residual_level: after.residual_level, target_level: after.target_level },
      likelihood_rationale: after.likelihood_rationale, impact_rationale: after.impact_rationale,
    });
  }
  return loadFull(risk.id);
};

/**
 * Override the calculated net risk with a rationale, or return to the
 * calculation. The default is always the calculation; an override is marked
 * (residual_override), carries who/when/why and is written to the audit log
 * together with the value the calculation gives at that moment.
 */
const overrideResidual = async (risk, body, user, auditReq) => {
  if (!canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const src = pick(body || {}, ['override', 'residual_likelihood', 'residual_impact', 'reason']);
  if (typeof src.override !== 'boolean') throw httpError(400, 'override (true/false) angeben.');
  const beforeLevel = await levelOf(risk);
  const before = { residual_override: risk.residual_override, residual_likelihood: risk.residual_likelihood, residual_impact: risk.residual_impact, residual_level: risk.residual_level, reason: risk.residual_override_reason };
  const calc = await calculatedResidual(risk);
  if (src.override) {
    const reason = rationale('Begründung der Überschreibung')(src.reason);
    if (!reason) throw httpError(400, 'Für das Überschreiben des Netto-Risikos ist eine Begründung erforderlich.');
    const rl = toInt(src.residual_likelihood);
    const ri = toInt(src.residual_impact);
    if (rl === null || ri === null) throw httpError(400, 'Netto-Wahrscheinlichkeit und Netto-Auswirkung angeben.');
    await risk.update({ residual_override: true, residual_likelihood: rl, residual_impact: ri, residual_override_reason: reason, residual_override_by_id: user?.id ?? null, residual_override_at: new Date() });
    await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, {
      action: 'residual_override', before,
      after: { residual_likelihood: risk.residual_likelihood, residual_impact: risk.residual_impact, residual_level: risk.residual_level },
      calculated: calc, reason,
    });
  } else {
    if (!risk.residual_override) throw httpError(400, 'Das Netto-Risiko ist nicht überschrieben.');
    await risk.update({ ...CLEAR_OVERRIDE });
    await recomputeResidual(risk);
    await auditFromReq(auditReq, 'update', 'risk', risk.id, risk.title, {
      action: 'residual_override_removed', before,
      after: { residual_likelihood: risk.residual_likelihood, residual_impact: risk.residual_impact, residual_level: risk.residual_level },
    });
  }
  const lapsed = await lapseIfRaised(risk, beforeLevel, auditReq);
  const out = await loadFull(risk.id);
  return lapsed ? { ...out, acceptance_lapsed: true } : out;
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
  if (!hasRole(user, 'admin') && risk.accepted_by_id !== user.id) {
    const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
    const level = await levelOf(risk);
    const rule = (active.acceptance || []).find(a => a.level === level);
    if (!rule || !hasRole(user, rule.roles)) throw httpError(403, 'Die Freigabe darf nur zurücknehmen, wer sie erteilt hat oder diese Stufe akzeptieren darf.');
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
    // Rated impact dimensions the active version no longer has would change the
    // overall impact - that needs a reassessment, not a carry-over.
    const activeDims = rm.dimensionsOf(active).map(d => d.key);
    if (risk.impact_dimensions && Object.keys(risk.impact_dimensions).some(k => !activeDims.includes(k))) {
      skipped.push({ id: risk.id, reason: 'dimensions_changed' });
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
  return decorate(rows);
};

module.exports = {
  FIELDS, includeAll, includeDetail, includeScenarios, decorate, overrideResidual, requireRationale, parseScenarios, canWriteRisk, canViewRisk, canSignoffRecord, buildFields,
  createRisk, updateRisk, signoffRisk, revokeRisk, carryOver, listForReassessment, recomputeResidual, loadFull,
};
