const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { BsiRequirement, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const catalog = require('../services/bsiCatalog');

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await BsiRequirement.findAll({
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['layer', 'ASC'], ['baustein_id', 'ASC'], ['req_id', 'ASC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/seed', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const count = await BsiRequirement.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    await BsiRequirement.bulkCreate(catalog);
    await auditFromReq(req, 'seed', 'bsi_requirement', null, 'BSI-Katalog', { count: catalog.length });
    res.status(201).json({ ok: true, count: catalog.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireRole('admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const item = await BsiRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { implementation_status, responsible_id, notes, last_review_date } = req.body;
    await item.update({ implementation_status, responsible_id, notes, last_review_date });
    await auditFromReq(req, 'update', 'bsi_requirement', item.id, item.req_id, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BsiRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'bsi_requirement', item.id, item.req_id, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
