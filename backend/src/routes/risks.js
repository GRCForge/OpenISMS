const express = require('express');
const { Op } = require('sequelize');
const { Risk, Task, RiskCategory, RiskTreatmentItem, RiskKri } = require('../models');
const { pick } = require('../utils/massAssignment');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError, requestError } = require('../utils/httpError');
const { setFilter } = require('../utils/queryFilters');
const { auditFromReq } = require('../services/auditService');
const { escapeLike } = require('../utils/sqlUtils');
const rm = require('../services/riskMethodology');
const riskService = require('../services/riskService');
const categories = require('../services/riskCategoryService');
const monitoring = require('../services/riskMonitoringService');
const riskHistory = require('../services/riskHistoryService');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// Validierungsfehler der Methodik mit allen Feldern beantworten; alles andere
// laeuft ueber requestError (keine DB-Interna nach aussen).
const methodologyError = (res, e) => {
  if (e && e.status === 400 && e.extra && Array.isArray(e.extra.errors)) {
    return res.status(400).json({ error: e.message, errors: e.extra.errors, warnings: e.extra.warnings || [] });
  }
  return requestError(res, e, 'risk-methodology');
};

// ── Risikomethodik ───────────────────────────────────────────────────────────
// Diese Routen stehen vor '/:id', sonst faengt die Detailroute sie ab.

// Aktive Methodik (Skalen, Stufen, Matrix, Appetit, Akzeptanz) - fuer Heatmap
// und Formulare. ?version=<id> liefert eine fruehere Version (nur lesen).
router.get('/scale', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    if (req.query.version !== undefined) {
      const id = parseId(req.query.version);
      if (!id) return res.status(400).json({ error: 'Ungültige Version.' });
      const p = await rm.getProfile(id);
      if (!p) return res.status(404).json({ error: 'Not found' });
      return res.json(rm.scaleInfo(p));
    }
    const active = await rm.getActiveProfile();
    res.json(rm.scaleInfo(active || rm.DEFAULT_PROFILE));
  } catch (e) { serverError(res, e, 'risk-methodology'); }
});

router.get('/methodology/versions', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try { res.json(await rm.listVersions()); } catch (e) { serverError(res, e, 'risk-methodology'); }
});

// Vorschau ohne Speichern: Pruefergebnis, Matrix, Zahl der Risiken, die danach
// neu zu bewerten waeren.
router.post('/methodology/validate', authenticate, requirePermission('risks', 'manage_methodology', 'admin'), async (req, res) => {
  try {
    const { profile, errors, warnings } = rm.validateProfile(req.body?.profile ?? req.body);
    errors.push(...await rm.appetiteCategoryErrors(profile));
    const active = await rm.getActiveProfile();
    const unchanged = !!active && rm.sameContent(active, profile);
    const affected = errors.length || unchanged ? 0 : await Risk.count();
    res.json({
      valid: errors.length === 0 && !unchanged,
      unchanged,
      errors,
      warnings,
      preview: errors.length ? null : rm.scaleInfo(profile),
      matrix_changed: !!active && !errors.length && (active.likelihood_levels.length !== profile.likelihood_levels.length || active.impact_levels.length !== profile.impact_levels.length),
      risks_to_reassess: affected,
    });
  } catch (e) { serverError(res, e, 'risk-methodology'); }
});

// Neue Version speichern und aktivieren. Die bisherige bleibt lesbar.
router.put('/methodology', authenticate, requirePermission('risks', 'manage_methodology', 'admin'), async (req, res) => {
  try {
    const input = req.body?.profile ?? req.body;
    const { profile, previous, warnings } = await rm.saveNewVersion(input, req.user, { changeNote: req.body?.change_note });
    await auditFromReq(req, 'update', 'risk_methodology', profile.id, `${profile.name} (v${profile.version})`, {
      version: profile.version,
      previous_version: previous?.version ?? null,
      change_note: profile.change_note,
      likelihood_size: profile.likelihood_levels.length,
      impact_size: profile.impact_levels.length,
      thresholds: profile.risk_levels.map(r => ({ key: r.key, min: r.min_score, max: r.max_score })),
      appetite: profile.appetite,
      acceptance: profile.acceptance,
      review_cycles: rm.reviewCyclesOf(profile),
    });
    const toReassess = await Risk.count({ where: { [Op.or]: [{ methodology_id: { [Op.ne]: profile.id } }, { methodology_id: null }] } });
    res.json({ ...rm.scaleInfo(profile), warnings, risks_to_reassess: toReassess });
  } catch (e) { methodologyError(res, e); }
});

// Bestaetigte Uebernahme in die aktive Version (nur bei gleicher Matrixgroesse).
router.post('/methodology/carry-over', authenticate, requirePermission('risks', 'manage_methodology', 'admin'), async (req, res) => {
  try {
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Übernahme bitte ausdrücklich bestätigen (confirm: true).' });
    res.json(await riskService.carryOver(req.body?.risk_ids, req));
  } catch (e) { requestError(res, e, 'risk-methodology'); }
});

// Liste "neu zu bewerten": Risiken, die nicht nach der aktiven Version bewertet sind.
router.get('/reassessment', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try { res.json(await riskService.listForReassessment()); } catch (e) { serverError(res, e, 'risks'); }
});

// ── Risk categories (taxonomy) ───────────────────────────────────────────────
// Reading follows risks.view (the form needs the list); maintaining the list is
// part of the risk criteria and follows risks.manage_methodology.

router.get('/categories', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try { res.json(await categories.list({ includeInactive: req.query.include_inactive !== 'false' })); } catch (e) { serverError(res, e, 'risk-categories'); }
});

router.post('/categories', authenticate, requirePermission('risks', 'manage_methodology', 'admin'), async (req, res) => {
  try {
    const row = await categories.create(req.body || {});
    await auditFromReq(req, 'create', 'risk_category', row.id, row.key, { key: row.key, label_de: row.label_de, label_en: row.label_en, label_es: row.label_es, active: row.active });
    res.status(201).json(row);
  } catch (e) { requestError(res, e, 'risk-categories'); }
});

router.put('/categories/:id', authenticate, requirePermission('risks', 'manage_methodology', 'admin'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const row = await RiskCategory.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { before, after } = await categories.update(row, req.body || {});
    await auditFromReq(req, 'update', 'risk_category', row.id, row.key, { before, after });
    res.json(after);
  } catch (e) { requestError(res, e, 'risk-categories'); }
});

router.delete('/categories/:id', authenticate, requirePermission('risks', 'manage_methodology', 'admin'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const row = await RiskCategory.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const before = await categories.remove(row);
    await auditFromReq(req, 'delete', 'risk_category', before.id, before.key, before);
    res.json({ message: 'Risk category deleted' });
  } catch (e) { requestError(res, e, 'risk-categories'); }
});

// ── Risk treatment plan and acceptance requests across risks (3.8.0) ────────
// Before '/:id'. Row visibility is decided in the services (record rights).


// Overview of all treatment items (ISO 27001 6.1.3 e evidence; Excel export in
// the frontend). Filters: status, overdue=true, risk_id, responsible_user_id.
router.get('/treatment-plan', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    res.json(await riskService.treatmentPlan(req.user, pick(req.query, ['status', 'overdue', 'risk_id', 'responsible_user_id'])));
  } catch (e) { requestError(res, e, 'risk-treatment'); }
});

// Acceptance requests across risks (approval queue). Filters: status, risk_id.
router.get('/acceptance-requests', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    res.json(await riskService.listAcceptanceRequests(req.user, pick(req.query, ['status', 'risk_id'])));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

// ── Risk monitoring across risks (3.9.0) ────────────────────────────────────
// Before '/:id'. Summary and trend are counts only (register list rights);
// the reassessment list carries reasons and follows the record rights
// (admin/assessor/management all, others their own risks).

router.get('/monitoring/summary', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try { res.json(await monitoring.monitoringSummary()); } catch (e) { serverError(res, e, 'risk-monitoring'); }
});

// Trend heat map: from/to (YYYY-MM-DD), basis residual|inherent.
router.get('/monitoring/trend', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const q = pick(req.query, ['from', 'to', 'basis']);
    res.json(await riskHistory.trendHeatmap({ from: q.from, to: q.to, basis: q.basis }));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

// Reassessment list with reasons. Filters: status (open|resolved|all), trigger_type, risk_id.
router.get('/review-flags', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try { res.json(await monitoring.listFlags(req.user, pick(req.query, ['status', 'trigger_type', 'risk_id']))); } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

// ── Risikoregister ───────────────────────────────────────────────────────────

router.get('/', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const { status, treatment, level, search, category } = req.query;
    const where = {};
    setFilter(where, 'status', status);
    setFilter(where, 'treatment', treatment);
    setFilter(where, 'inherent_level', level);
    setFilter(where, 'category', category);
    if (search) where.title = { [Op.iLike]: `%${escapeLike(search)}%` };
    const risks = await Risk.findAll({ where, include: riskService.includeAll(), order: [['created_at', 'DESC']] });
    let out = await riskService.decorate(risks);
    if (req.query.appetite_exceeded === 'true') out = out.filter(r => r.appetite_exceeded);
    if (req.query.needs_reassessment === 'true') out = out.filter(r => r.needs_reassessment);
    if (req.query.needs_review === 'true') out = out.filter(r => r.needs_review);
    if (req.query.review_overdue === 'true') out = out.filter(r => r.review_overdue);
    if (req.query.kri_breached === 'true') out = out.filter(r => r.kri_breached > 0);
    res.json(out);
  } catch (e) { serverError(res, e, 'risks'); }
});

router.get('/:id', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id, { include: riskService.includeDetail() });
    if (!risk) return res.status(404).json({ error: 'Not found' });
    // Authorization: only admin, assessor or the risk owner can view the detail.
    if (!riskService.canViewRisk(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    res.json((await riskService.decorate([risk], { detail: true }))[0]);
  } catch (e) { serverError(res, e, 'risks'); }
});

router.post('/', authenticate, requirePermission('risks', 'create', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    if (!req.body?.title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    res.status(201).json(await riskService.createRisk(req.body, req.user, req));
  } catch (e) { requestError(res, e, 'risks'); }
});

router.put('/:id', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    if (!riskService.canWriteRisk(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    res.json(await riskService.updateRisk(risk, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risks'); }
});

// Risk-Owner Sign-off (NIS-2 Management-Haftung): digitale Freigabe mit
// Zeitstempel. Wer welche Stufe wie lange akzeptieren darf, regelt die
// Akzeptanzbefugnis der aktiven Risikomethodik. Since 3.8.0 this approves the
// pending acceptance request (four-eyes principle); without one: 409.
router.patch('/:id/signoff', authenticate, requirePermission('risks', 'sign_off', 'admin', 'assessor', 'owner', 'management'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    res.json(await riskService.signoffRisk(risk, req.user, req.body?.valid_until, req, { requestId: req.body?.request_id ?? null, note: req.body?.note }));
  } catch (e) { requestError(res, e, 'risks'); }
});

// ── Treatment items of a risk (3.8.0) ───────────────────────────────────────
// Reading: record rights as for the detail view; writing: as for editing.

const loadRisk = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: 'Ungültige Kennung.' }); return null; }
  const risk = await Risk.findByPk(id);
  if (!risk) { res.status(404).json({ error: 'Not found' }); return null; }
  return risk;
};
const loadItem = async (req, res, risk) => {
  const itemId = parseId(req.params.itemId);
  if (!itemId) { res.status(400).json({ error: 'Ungültige Kennung.' }); return null; }
  const item = await RiskTreatmentItem.findOne({ where: { id: itemId, risk_id: risk.id } });
  if (!item) { res.status(404).json({ error: 'Not found' }); return null; }
  return item;
};

router.get('/:id/treatment-items', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.json(await riskService.listTreatmentItems(risk, req.user));
  } catch (e) { requestError(res, e, 'risk-treatment'); }
});

router.post('/:id/treatment-items', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.status(201).json(await riskService.createTreatmentItem(risk, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risk-treatment'); }
});

router.put('/:id/treatment-items/:itemId', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const item = await loadItem(req, res, risk); if (!item) return;
    res.json(await riskService.updateTreatmentItem(risk, item, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risk-treatment'); }
});

// Create a task from the item (tasks.create is checked in the service).
router.post('/:id/treatment-items/:itemId/task', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const item = await loadItem(req, res, risk); if (!item) return;
    res.status(201).json(await riskService.createTaskForTreatmentItem(risk, item, req.user, req, { priority: req.body?.priority }));
  } catch (e) { requestError(res, e, 'risk-treatment'); }
});

// ── Monitoring of a risk (3.9.0) ────────────────────────────────────────────
// Reading: record rights as for the detail view; writing: as for editing.

router.get('/:id/history', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.json(await riskHistory.listHistory(risk, req.user, { limit: req.query.limit }));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

router.get('/:id/review-flags', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.json(await monitoring.listRiskFlags(risk, req.user));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

// Confirm the periodic review / reassessment (note mandatory); resolves the
// open flags (all or flag_ids) and completes their tasks.
router.post('/:id/review', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.json(await monitoring.reviewRisk(risk, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

const loadKri = async (req, res, risk) => {
  const kriId = parseId(req.params.kriId);
  if (!kriId) { res.status(400).json({ error: 'Ungültige Kennung.' }); return null; }
  const link = await RiskKri.findOne({ where: { id: kriId, risk_id: risk.id } });
  if (!link) { res.status(404).json({ error: 'Not found' }); return null; }
  return link;
};

router.get('/:id/kris', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.json(await monitoring.listKris(risk, req.user));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

router.post('/:id/kris', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.status(201).json(await monitoring.createKri(risk, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

router.put('/:id/kris/:kriId', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const link = await loadKri(req, res, risk); if (!link) return;
    res.json(await monitoring.updateKri(risk, link, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

router.delete('/:id/kris/:kriId', authenticate, requirePermission('risks', 'edit', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const link = await loadKri(req, res, risk); if (!link) return;
    res.json(await monitoring.deleteKri(risk, link, req.user, req));
  } catch (e) { requestError(res, e, 'risk-monitoring'); }
});

// ── Acceptance requests of a risk (3.8.0, four-eyes principle) ──────────────

const loadRequest = async (req, res, risk) => {
  const reqRow = await riskService.findAcceptanceRequest(risk.id, req.params.requestId);
  if (!reqRow) { res.status(404).json({ error: 'Not found' }); return null; }
  return reqRow;
};

router.get('/:id/acceptance-requests', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    if (!riskService.canViewRisk(req.user, risk) && !riskService.canSignoffRecord(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    res.json(await riskService.listAcceptanceRequests(req.user, { risk_id: String(risk.id) }));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

router.post('/:id/acceptance-requests', authenticate, requirePermission('risks', 'request_acceptance', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    res.status(201).json(await riskService.requestAcceptance(risk, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

router.post('/:id/acceptance-requests/:requestId/approve', authenticate, requirePermission('risks', 'sign_off', 'admin', 'assessor', 'owner', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const reqRow = await loadRequest(req, res, risk); if (!reqRow) return;
    res.json(await riskService.approveAcceptance(risk, reqRow, req.user, req.body || {}, req));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

router.post('/:id/acceptance-requests/:requestId/reject', authenticate, requirePermission('risks', 'sign_off', 'admin', 'assessor', 'owner', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const reqRow = await loadRequest(req, res, risk); if (!reqRow) return;
    res.json(await riskService.rejectAcceptance(risk, reqRow, req.user, req.body || {}, req));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

router.post('/:id/acceptance-requests/:requestId/withdraw', authenticate, requirePermission('risks', 'request_acceptance', 'admin', 'owner', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const reqRow = await loadRequest(req, res, risk); if (!reqRow) return;
    res.json(await riskService.withdrawAcceptance(risk, reqRow, req.user, req.body || {}, req));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

// The risk owner confirms the acceptance of the residual risk (6.1.3 f). Any
// role may own a risk, so the gate is risks.view plus the owner check.
router.post('/:id/acceptance-requests/:requestId/confirm-owner', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const risk = await loadRisk(req, res); if (!risk) return;
    const reqRow = await loadRequest(req, res, risk); if (!reqRow) return;
    res.json(await riskService.confirmAcceptanceAsOwner(risk, reqRow, req.user, req));
  } catch (e) { requestError(res, e, 'risk-acceptance'); }
});

// Override the calculated net risk with a rationale (or return to the
// calculation). Separate permission: the calculation is the default, deviating
// from it is a decision of its own. Record rights as for editing.
router.patch('/:id/residual-override', authenticate, requirePermission('risks', 'override_residual', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    res.json(await riskService.overrideResidual(risk, req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'risks'); }
});

// Sign-off zuruecknehmen
router.patch('/:id/revoke', authenticate, requirePermission('risks', 'sign_off', 'admin', 'assessor', 'owner', 'management'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    res.json(await riskService.revokeRisk(risk, req.user, req));
  } catch (e) { requestError(res, e, 'risks'); }
});

router.delete('/:id', authenticate, requirePermission('risks', 'delete', 'admin'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'risk', related_id: risk.id, status: { [Op.in]: ['open', 'in_progress'] } } }
    );
    await risk.destroy();
    await auditFromReq(req, 'delete', 'risk', risk.id, risk.title, {});
    res.json({ message: 'Risk deleted' });
  } catch (e) { serverError(res, e, 'risks'); }
});

module.exports = router;
