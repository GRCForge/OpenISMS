const express = require('express');
const { Op } = require('sequelize');
const { Risk, Task } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError, requestError } = require('../utils/httpError');
const { setFilter } = require('../utils/queryFilters');
const { auditFromReq } = require('../services/auditService');
const { escapeLike } = require('../utils/sqlUtils');
const rm = require('../services/riskMethodology');
const riskService = require('../services/riskService');

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

// ── Risikoregister ───────────────────────────────────────────────────────────

router.get('/', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const { status, treatment, level, search } = req.query;
    const where = {};
    setFilter(where, 'status', status);
    setFilter(where, 'treatment', treatment);
    setFilter(where, 'inherent_level', level);
    if (search) where.title = { [Op.iLike]: `%${escapeLike(search)}%` };
    const risks = await Risk.findAll({ where, include: riskService.includeAll(), order: [['created_at', 'DESC']] });
    let out = await rm.decorateRisks(risks);
    if (req.query.appetite_exceeded === 'true') out = out.filter(r => r.appetite_exceeded);
    if (req.query.needs_reassessment === 'true') out = out.filter(r => r.needs_reassessment);
    res.json(out);
  } catch (e) { serverError(res, e, 'risks'); }
});

router.get('/:id', authenticate, requirePermission('risks', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id, { include: riskService.includeAll() });
    if (!risk) return res.status(404).json({ error: 'Not found' });
    // Authorization: only admin, assessor or the risk owner can view the detail.
    if (!riskService.canViewRisk(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    res.json(await rm.decorateRisk(risk));
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
// Akzeptanzbefugnis der aktiven Risikomethodik.
router.patch('/:id/signoff', authenticate, requirePermission('risks', 'sign_off', 'admin', 'assessor', 'owner', 'management'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const risk = await Risk.findByPk(id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    res.json(await riskService.signoffRisk(risk, req.user, req.body?.valid_until, req));
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
