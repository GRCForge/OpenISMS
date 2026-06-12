const router = require('express').Router();
const { AiSystem, User, Vendor } = require('../models');
const { authenticate, requireWriteAccess, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await AiSystem.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'vendor', attributes: ['id', 'name'] }
      ],
      order: [['risk_category', 'ASC'], ['name', 'ASC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const data = { ...req.body };
    ['owner_id', 'vendor_id'].forEach(f => { if (data[f] === '') data[f] = null; });
    ['deployed_since', 'last_review_date'].forEach(f => { if (data[f] === '') data[f] = null; });

    const item = await AiSystem.create(data);
    await auditFromReq(req, 'create', 'ai_system', item.id, item.name, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await AiSystem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    
    const data = { ...req.body };
    ['owner_id', 'vendor_id'].forEach(f => { if (data[f] === '') data[f] = null; });
    ['deployed_since', 'last_review_date'].forEach(f => { if (data[f] === '') data[f] = null; });

    await item.update(data);
    await auditFromReq(req, 'update', 'ai_system', item.id, item.name, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await AiSystem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'ai_system', item.id, item.name, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
