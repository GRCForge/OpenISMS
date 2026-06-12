const router = require('express').Router();
const { DoraThirdParty, DoraResilienceTest } = require('../models');
const { authenticate, requireWriteAccess, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

// ── Resilienztests (DORA Art. 24-26) ─────────────────────────────
// Wichtig: vor den parametrischen /:id-Routen definiert.

router.get('/tests', authenticate, async (req, res) => {
  try {
    const items = await DoraResilienceTest.findAll({ order: [['test_date', 'DESC'], ['created_at', 'DESC']] });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tests', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const { title, test_type, test_date, performed_by, status, result, findings, remediation, next_test_date, notes } = req.body;
    const item = await DoraResilienceTest.create({ title, test_type, test_date, performed_by, status, result, findings, remediation, next_test_date, notes });
    await auditFromReq(req, 'create', 'dora_test', item.id, item.title, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/tests/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await DoraResilienceTest.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { title, test_type, test_date, performed_by, status, result, findings, remediation, next_test_date, notes } = req.body;
    await item.update({ title, test_type, test_date, performed_by, status, result, findings, remediation, next_test_date, notes });
    await auditFromReq(req, 'update', 'dora_test', item.id, item.title, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/tests/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await DoraResilienceTest.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'dora_test', item.id, item.title, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IKT-Drittparteienregister ────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await DoraThirdParty.findAll({ order: [['criticality', 'ASC'], ['name', 'ASC']] });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const { name, ict_service, criticality, contract_start, contract_end, country, contact_name, contact_email, sla_rto_hours, sla_rpo_hours, last_review_date, next_review_date, status, notes } = req.body;
    const item = await DoraThirdParty.create({ name, ict_service, criticality, contract_start, contract_end, country, contact_name, contact_email, sla_rto_hours, sla_rpo_hours, last_review_date, next_review_date, status, notes });
    await auditFromReq(req, 'create', 'dora_third_party', item.id, item.name, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await DoraThirdParty.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { name, ict_service, criticality, contract_start, contract_end, country, contact_name, contact_email, sla_rto_hours, sla_rpo_hours, last_review_date, next_review_date, status, notes } = req.body;
    await item.update({ name, ict_service, criticality, contract_start, contract_end, country, contact_name, contact_email, sla_rto_hours, sla_rpo_hours, last_review_date, next_review_date, status, notes });
    await auditFromReq(req, 'update', 'dora_third_party', item.id, item.name, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await DoraThirdParty.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'dora_third_party', item.id, item.name, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
