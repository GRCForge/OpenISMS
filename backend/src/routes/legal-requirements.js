const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { LegalRequirement, User } = require('../models');
const { authenticate, requireWriteAccess, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await LegalRequirement.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['title', 'ASC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const { title, category, description, reference_url, applicable_since, review_date, owner_id, status, notes } = req.body;
    const item = await LegalRequirement.create({ title, category, description, reference_url, applicable_since, review_date, owner_id, status, notes });
    await auditFromReq(req, 'create', 'legal_requirement', item.id, item.title, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await LegalRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { title, category, description, reference_url, applicable_since, review_date, owner_id, status, notes } = req.body;
    await item.update({ title, category, description, reference_url, applicable_since, review_date, owner_id, status, notes });
    await auditFromReq(req, 'update', 'legal_requirement', item.id, item.title, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await LegalRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'legal_requirement', item.id, item.title, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
