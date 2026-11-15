const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { AiSystem, User, Vendor, Task } = require('../models');
const { Op } = require('sequelize');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { pick } = require('../utils/massAssignment');

// Felder, die POST/PUT setzen duerfen (Security-Review 2026-11, OP-4). id und die
// Zeitstempel pflegt der Server; vorher landete jeder Schluessel aus dem Body
// ({ ...req.body }) im Modell.
const AI_SYSTEM_FIELDS = [
  'name', 'description', 'risk_category', 'use_case', 'provider', 'vendor_id',
  'location', 'deployed_since', 'owner_id', 'conformity_status', 'approval_status',
  'documentation_url', 'last_review_date', 'notes',
];

router.get('/', authenticate, requirePermission('ai_act','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const items = await AiSystem.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'vendor', attributes: ['id', 'name'] }
      ],
      order: [['risk_category', 'ASC'], ['name', 'ASC']],
    });
    res.json(items);
  } catch (e) { serverError(res, e, 'ai-act'); }
});

router.post('/', authenticate, requirePermission('ai_act','create','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const data = pick(req.body, AI_SYSTEM_FIELDS);
    ['owner_id', 'vendor_id'].forEach(f => { if (data[f] === '') data[f] = null; });
    ['deployed_since', 'last_review_date'].forEach(f => { if (data[f] === '') data[f] = null; });

    const item = await AiSystem.create(data);
    await auditFromReq(req, 'create', 'ai_system', item.id, item.name, {});
    res.status(201).json(item);
  } catch (e) { serverError(res, e, 'ai-act'); }
});

router.put('/:id', authenticate, requirePermission('ai_act','edit','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const item = await AiSystem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    
    const data = pick(req.body, AI_SYSTEM_FIELDS);
    ['owner_id', 'vendor_id'].forEach(f => { if (data[f] === '') data[f] = null; });
    ['deployed_since', 'last_review_date'].forEach(f => { if (data[f] === '') data[f] = null; });

    await item.update(data);
    await auditFromReq(req, 'update', 'ai_system', item.id, item.name, {});
    res.json(item);
  } catch (e) { serverError(res, e, 'ai-act'); }
});

router.delete('/:id', authenticate, requirePermission('ai_act','delete','admin','assessor'), async (req, res) => {
  try {
    const item = await AiSystem.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'ai_system', related_id: item.id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );
    await auditFromReq(req, 'delete', 'ai_system', item.id, item.name, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'ai-act'); }
});

module.exports = router;
