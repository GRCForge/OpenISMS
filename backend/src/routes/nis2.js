const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Nis2Measure, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const catalog = require('../services/nis2Catalog');

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await Nis2Measure.findAll({
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['article_ref', 'ASC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/seed', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const count = await Nis2Measure.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    await Nis2Measure.bulkCreate(catalog);
    await auditFromReq(req, 'seed', 'nis2_measure', null, 'NIS-2-Katalog', { count: catalog.length });
    res.status(201).json({ ok: true, count: catalog.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const item = await Nis2Measure.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { implementation_status, responsible_id, evidence, deadline, notes, last_review_date } = req.body;
    await item.update({ implementation_status, responsible_id, evidence, deadline, notes, last_review_date });
    await auditFromReq(req, 'update', 'nis2_measure', item.id, item.article_ref, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await Nis2Measure.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'nis2_measure', item.id, item.article_ref, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
