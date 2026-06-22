const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { SubjectRequest, User, Task } = require('../models');
const { Op } = require('sequelize');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.use(authenticate);

const canWrite = requireRole('admin', 'dpo');

const include = [
  { model: User, as: 'handler', attributes: ['id', 'name', 'email'] },
];

router.get('/', requireRole('admin', 'dpo', 'assessor'), async (req, res) => {
  try {
    const requests = await SubjectRequest.findAll({
      include,
      order: [['received_date', 'DESC'], ['id', 'DESC']],
    });
    res.json(requests);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', canWrite, async (req, res) => {
  try {
    const body = { ...req.body };

    if (!body.due_date && body.received_date) {
      const d = new Date(body.received_date);
      d.setDate(d.getDate() + 30);
      body.due_date = d.toISOString().split('T')[0];
    }

    const request = await SubjectRequest.create(body);
    const year = new Date(request.created_at || new Date()).getFullYear();
    await request.update({ ref: `BSA-${year}-${String(request.id).padStart(3, '0')}` });
    await auditFromReq(req, 'create', 'subject_request', request.id, `${body.ref} (${request.requester_name})`, {});

    const created = await SubjectRequest.findByPk(request.id, { include });
    res.status(201).json(created);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const ALLOWED_UPDATE_FIELDS = [
  'type', 'status', 'requester_name', 'requester_email', 'requester_id_verified',
  'received_date', 'due_date', 'extended_until', 'extension_reason',
  'description', 'decision', 'notes', 'handler_id',
];

router.put('/:id', canWrite, async (req, res) => {
  try {
    const request = await SubjectRequest.findByPk(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });

    const updates = Object.fromEntries(
      ALLOWED_UPDATE_FIELDS.filter(k => k in req.body).map(k => [k, req.body[k]])
    );
    if (updates.status === 'completed' && !request.completed_at) {
      updates.completed_at = new Date();
    }

    const before = {};
    ALLOWED_UPDATE_FIELDS.forEach(f => before[f] = request[f]);

    await request.update(updates);
    
    const after = {};
    ALLOWED_UPDATE_FIELDS.forEach(f => after[f] = request[f]);

    await auditFromReq(req, 'update', 'subject_request', request.id, request.ref, { before, after });

    const updated = await SubjectRequest.findByPk(request.id, { include });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const request = await SubjectRequest.findByPk(req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'subject_request', related_id: request.id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );
    await auditFromReq(req, 'delete', 'subject_request', request.id, request.ref, {});
    await request.destroy();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
