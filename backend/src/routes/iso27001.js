const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Iso27001Control, User, Control } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const catalog = require('../services/iso27001Catalog');

// Maps iso27001_controls.implementation_status → controls.status
const ISO_TO_SOA = {
  implemented: 'implemented',
  not_applicable: 'not_applicable',
  not_started: 'planned',
  in_progress: 'planned',
};

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await Iso27001Control.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['ref', 'ASC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/seed', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const count = await Iso27001Control.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    await Iso27001Control.bulkCreate(catalog);
    await auditFromReq(req, 'seed', 'iso27001_control', null, 'Annex-A-Katalog', { count: catalog.length });
    res.status(201).json({ ok: true, count: catalog.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireRole('admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const item = await Iso27001Control.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { applicable, implementation_status, justification, owner_id, evidence, notes, last_review_date } = req.body;
    await item.update({ applicable, implementation_status, justification, owner_id, evidence, notes, last_review_date });
    // Sync status to SoA controls table (best-effort)
    if (implementation_status !== undefined && ISO_TO_SOA[implementation_status]) {
      Control.update(
        { status: ISO_TO_SOA[implementation_status] },
        { where: { framework: 'iso27001', code: item.ref } }
      ).catch(() => {});
    }
    await auditFromReq(req, 'update', 'iso27001_control', item.id, item.ref, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await Iso27001Control.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'iso27001_control', item.id, item.ref, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
