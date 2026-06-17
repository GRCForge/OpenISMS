const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { DataFlow, Asset } = require('../models');
const { authenticate, requireRole, isAdmin, isAssessor, isDpo } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.use(authenticate);

const flowInclude = [
  { model: Asset, as: 'source', attributes: ['id', 'name', 'type'] },
  { model: Asset, as: 'target', attributes: ['id', 'name', 'type'] },
];

// List all data flows
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.contains_personal_data !== undefined) {
      where.contains_personal_data = req.query.contains_personal_data === 'true';
    }
    const flows = await DataFlow.findAll({ where, include: flowInclude, order: [['name', 'ASC']] });
    res.json(flows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single flow (only admin, assessor, dpo can access)
router.get('/:id', async (req, res) => {
  try {
    // Verify authorization: only admin, assessor, dpo
    if (!isAdmin(req) && !isAssessor(req) && !isDpo(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const flow = await DataFlow.findByPk(req.params.id, { include: flowInclude });
    if (!flow) return res.status(404).json({ error: 'Not found' });
    res.json(flow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create
router.post('/', requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const { name, description, source_id, target_id, data_categories, transfer_mechanism, encryption, frequency, contains_personal_data, notes, status } = req.body;
    const flow = await DataFlow.create({ name, description, source_id, target_id, data_categories, transfer_mechanism, encryption, frequency, contains_personal_data, notes, status });
    await auditFromReq(req, 'create', 'dataflow', flow.id, flow.name, {
      name, description, source_id, target_id, data_categories, transfer_mechanism, encryption, frequency, contains_personal_data, notes, status
    });
    const full = await DataFlow.findByPk(flow.id, { include: flowInclude });
    res.status(201).json(full);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update
router.put('/:id', requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const flow = await DataFlow.findByPk(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Not found' });
    const { name, description, source_id, target_id, data_categories, transfer_mechanism, encryption, frequency, contains_personal_data, notes, status } = req.body;
    
    const fields = [
      'name', 'description', 'source_id', 'target_id', 'data_categories',
      'transfer_mechanism', 'encryption', 'frequency', 'contains_personal_data',
      'notes', 'status'
    ];
    
    const before = {};
    fields.forEach(f => before[f] = flow[f]);
    
    await flow.update({ name, description, source_id, target_id, data_categories, transfer_mechanism, encryption, frequency, contains_personal_data, notes, status });
    
    const after = {};
    fields.forEach(f => after[f] = flow[f]);
    
    await auditFromReq(req, 'update', 'dataflow', flow.id, flow.name, { before, after });
    const full = await DataFlow.findByPk(flow.id, { include: flowInclude });
    res.json(full);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Delete
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const flow = await DataFlow.findByPk(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Not found' });
    const name = flow.name;
    await flow.destroy();
    await auditFromReq(req, 'delete', 'dataflow', req.params.id, name, {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
