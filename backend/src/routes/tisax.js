const router = require('express').Router();
const { TisaxAssessment, TisaxRequirement, User } = require('../models');
const { authenticate, requireWriteAccess, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const tisaxCatalog = require('../services/tisaxCatalog');

// ── VDA-ISA-Anforderungen (Reifegrad-Selbstbewertung) ────────────
// Wichtig: vor den parametrischen /:id-Routen definiert.

router.get('/requirements', authenticate, async (req, res) => {
  try {
    const items = await TisaxRequirement.findAll({ order: [['ref', 'ASC']] });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lädt den VDA-ISA-Katalog, falls noch keine Anforderungen existieren
router.post('/requirements/seed', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const count = await TisaxRequirement.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    await TisaxRequirement.bulkCreate(tisaxCatalog);
    await auditFromReq(req, 'seed', 'tisax_requirement', null, 'VDA-ISA-Katalog', { count: tisaxCatalog.length });
    res.status(201).json({ ok: true, count: tisaxCatalog.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/requirements', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const { ref, chapter, title, question, maturity_level, target_level, status, notes } = req.body;
    const item = await TisaxRequirement.create({ ref, chapter, title, question, maturity_level, target_level, status, notes });
    await auditFromReq(req, 'create', 'tisax_requirement', item.id, item.ref, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/requirements/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await TisaxRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { ref, chapter, title, question, maturity_level, target_level, status, notes } = req.body;
    await item.update({ ref, chapter, title, question, maturity_level, target_level, status, notes });
    await auditFromReq(req, 'update', 'tisax_requirement', item.id, item.ref, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/requirements/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await TisaxRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'tisax_requirement', item.id, item.ref, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Assessments (Label-Tracking) ─────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await TisaxAssessment.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'DESC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const { scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes } = req.body;
    const item = await TisaxAssessment.create({ scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes });
    await auditFromReq(req, 'create', 'tisax_assessment', item.id, `Assessment ${item.id}`, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await TisaxAssessment.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes } = req.body;
    await item.update({ scope_description, assessment_level, label_requested, status, auditor_company, assessment_date, label_valid_until, owner_id, notes });
    await auditFromReq(req, 'update', 'tisax_assessment', item.id, `Assessment ${item.id}`, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await TisaxAssessment.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'tisax_assessment', item.id, `Assessment ${item.id}`, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
