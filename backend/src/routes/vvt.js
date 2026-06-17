const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { VvtEntry, User, Vendor, Asset, Dsfa } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.use(authenticate);

const includeAll = [
  { model: User, as: 'responsible', attributes: ['id', 'name', 'email'] },
  { model: Vendor, as: 'processor', attributes: ['id', 'name'] },
  { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
  { model: Vendor, as: 'vendors', attributes: ['id', 'name'], through: { attributes: [] } },
];

const applyLinks = async (entry, body) => {
  if (Array.isArray(body.asset_ids)) await entry.setAssets(body.asset_ids);
  if (Array.isArray(body.vendor_ids)) await entry.setVendors(body.vendor_ids);
};

// List all VVT entries
router.get('/', authenticate, async (req, res) => {
  try {
    const entries = await VvtEntry.findAll({
      include: includeAll,
      order: [['name', 'ASC']],
    });
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single entry
router.get('/:id', requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const entry = await VvtEntry.findByPk(req.params.id, {
      include: includeAll,
    });
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const pickVvtFields = (body) => {
  const { name, purpose, legal_basis, data_categories, special_categories, data_subjects, recipients, third_country_transfers, transfer_safeguards, retention_period, retention_legal_basis, deletion_procedure, security_measures, responsible_id, processor_id, status, notes, dsfa_required, last_review_date } = body;
  return { name, purpose, legal_basis, data_categories, special_categories, data_subjects, recipients, third_country_transfers, transfer_safeguards, retention_period, retention_legal_basis, deletion_procedure, security_measures, responsible_id, processor_id, status, notes, dsfa_required, last_review_date };
};

// Create entry (dpo, admin, assessor)
router.post('/', authenticate, requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const fields = pickVvtFields(req.body);
    const entry = await VvtEntry.create(fields);
    await applyLinks(entry, req.body);
    await auditFromReq(req, 'create', 'vvt', entry.id, entry.name, fields);
    const full = await VvtEntry.findByPk(entry.id, { include: includeAll });
    res.status(201).json(full);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update entry
router.put('/:id', requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const entry = await VvtEntry.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    
    const fields = [
      'name', 'purpose', 'legal_basis', 'data_categories', 'special_categories',
      'data_subjects', 'recipients', 'third_country_transfers', 'transfer_safeguards',
      'retention_period', 'retention_legal_basis', 'deletion_procedure', 'security_measures',
      'responsible_id', 'processor_id', 'status', 'notes', 'dsfa_required', 'last_review_date'
    ];
    
    const before = {};
    fields.forEach(f => before[f] = entry[f]);
    
    await entry.update(pickVvtFields(req.body));
    await applyLinks(entry, req.body);
    
    const after = {};
    fields.forEach(f => after[f] = entry[f]);
    
    await auditFromReq(req, 'update', 'vvt', entry.id, entry.name, { before, after });
    const full = await VvtEntry.findByPk(entry.id, { include: includeAll });
    res.json(full);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── DSFA (Datenschutz-Folgenabschätzung, Art. 35) ──────────────────────────
// Must be defined before /:id routes to avoid conflicts.

router.get('/:vvtId/dsfa', requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const item = await Dsfa.findOne({
      where: { vvt_id: req.params.vvtId },
      include: [{ model: User, as: 'approver', attributes: ['id', 'name'] }],
    });
    res.json(item || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const pickDsfaFields = (body) => {
  const { title, processing_description, necessity_assessment, risks_identified, measures_taken, residual_risk, dpa_consultation_required, status, approver_id, approval_date, next_review_date, notes } = body;
  return { title, processing_description, necessity_assessment, risks_identified, measures_taken, residual_risk, dpa_consultation_required, status, approver_id, approval_date, next_review_date, notes };
};

router.post('/:vvtId/dsfa', requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const existing = await Dsfa.findOne({ where: { vvt_id: req.params.vvtId } });
    if (existing) return res.status(409).json({ error: 'DSFA für diesen Eintrag bereits vorhanden.' });
    const item = await Dsfa.create({ ...pickDsfaFields(req.body), vvt_id: req.params.vvtId });
    await auditFromReq(req, 'create', 'dsfa', item.id, item.title || `DSFA ${item.id}`, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:vvtId/dsfa/:id', requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const item = await Dsfa.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await item.update(pickDsfaFields(req.body));
    await auditFromReq(req, 'update', 'dsfa', item.id, item.title || `DSFA ${item.id}`, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:vvtId/dsfa/:id', requireRole('admin'), async (req, res) => {
  try {
    const item = await Dsfa.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'dsfa', item.id, item.title || `DSFA ${item.id}`, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────────────────

// Delete entry (admin/dpo only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const entry = await VvtEntry.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    const name = entry.name;
    await entry.destroy();
    await auditFromReq(req, 'delete', 'vvt', req.params.id, name, {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
