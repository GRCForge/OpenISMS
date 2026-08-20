const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { TisaxAssessment, TisaxRequirement, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const tisaxCatalog = require('../services/tisaxCatalog');

// ── VDA-ISA-Anforderungen (Reifegrad-Selbstbewertung) ────────────
// Wichtig: vor den parametrischen /:id-Routen definiert.

router.get('/requirements', authenticate, requirePermission('tisax','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const items = await TisaxRequirement.findAll({ order: [['ref', 'ASC']] });
    res.json(items);
  } catch (e) { serverError(res, e, 'tisax'); }
});

// Lädt den VDA-ISA-Katalog, falls noch keine Anforderungen existieren
router.post('/requirements/seed', authenticate, requirePermission('tisax','seed','admin','assessor'), async (req, res) => {
  try {
    const count = await TisaxRequirement.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    await TisaxRequirement.bulkCreate(tisaxCatalog);
    await auditFromReq(req, 'seed', 'tisax_requirement', null, 'VDA-ISA-Katalog', { count: tisaxCatalog.length });
    res.status(201).json({ ok: true, count: tisaxCatalog.length });
  } catch (e) { serverError(res, e, 'tisax'); }
});

router.post('/requirements', authenticate, requirePermission('tisax','create','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const { ref, chapter, title, question, maturity_level, target_level, status, notes } = req.body;
    const item = await TisaxRequirement.create({ ref, chapter, title, question, maturity_level, target_level, status, notes });
    await auditFromReq(req, 'create', 'tisax_requirement', item.id, item.ref, {});
    res.status(201).json(item);
  } catch (e) { serverError(res, e, 'tisax'); }
});

router.put('/requirements/:id', authenticate, requirePermission('tisax','edit','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const item = await TisaxRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { ref, chapter, title, question, maturity_level, target_level, status, notes } = req.body;
    await item.update({ ref, chapter, title, question, maturity_level, target_level, status, notes });
    await auditFromReq(req, 'update', 'tisax_requirement', item.id, item.ref, {});
    res.json(item);
  } catch (e) { serverError(res, e, 'tisax'); }
});

router.delete('/requirements/:id', authenticate, requirePermission('tisax','delete','admin','assessor'), async (req, res) => {
  try {
    const item = await TisaxRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'tisax_requirement', item.id, item.ref, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'tisax'); }
});

// ── Assessments (Label-Tracking) ─────────────────────────────────

router.get('/', authenticate, requirePermission('tisax','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const items = await TisaxAssessment.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'DESC']],
    });
    res.json(items);
  } catch (e) { serverError(res, e, 'tisax'); }
});

router.post('/', authenticate, requirePermission('tisax','create','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const { scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes } = req.body;
    const item = await TisaxAssessment.create({ scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes });
    await auditFromReq(req, 'create', 'tisax_assessment', item.id, `Assessment ${item.id}`, {});
    res.status(201).json(item);
  } catch (e) { serverError(res, e, 'tisax'); }
});

router.put('/:id', authenticate, requirePermission('tisax','edit','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const item = await TisaxAssessment.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes } = req.body;
    await item.update({ scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes });
    await auditFromReq(req, 'update', 'tisax_assessment', item.id, `Assessment ${item.id}`, {});
    res.json(item);
  } catch (e) { serverError(res, e, 'tisax'); }
});

router.delete('/:id', authenticate, requirePermission('tisax','delete','admin','assessor'), async (req, res) => {
  try {
    const item = await TisaxAssessment.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'tisax_assessment', item.id, `Assessment ${item.id}`, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'tisax'); }
});

module.exports = router;
