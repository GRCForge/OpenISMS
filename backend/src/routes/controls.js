const express = require('express');
const { Op, fn, col } = require('sequelize');
const { Control, Policy, Iso27001Control } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { escapeLike } = require('../utils/sqlUtils');

// Maps controls.status → iso27001_controls.implementation_status
const SOA_TO_ISO = {
  implemented: 'implemented',
  not_applicable: 'not_applicable',
  planned: 'in_progress',
};

const router = express.Router();

const includeAll = [
  { model: Policy, as: 'policies', through: { attributes: [] } },
];

// SoA-Zusammenfassung (Abdeckung nach Status/Framework)
router.get('/stats', authenticate, async (req, res) => {
  try {
    const byStatus = await Control.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true });
    const byFramework = await Control.findAll({ attributes: ['framework', [fn('COUNT', col('id')), 'count']], group: ['framework'], raw: true });
    res.json({ total: await Control.count(), byStatus, byFramework });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const { framework, status, type, search } = req.query;
    const where = {};
    if (framework) where.framework = framework;
    if (status) where.status = status;
    if (type) where.type = type;
    if (search) where[Op.or] = [{ code: { [Op.like]: `%${escapeLike(search)}%` } }, { title: { [Op.like]: `%${escapeLike(search)}%` } }];
    const controls = await Control.findAll({ where, include: includeAll, order: [['framework', 'ASC'], ['code', 'ASC']] });
    res.json(controls);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const applyLinks = async (control, body) => {
  if (Array.isArray(body.policy_ids)) await control.setPolicies(body.policy_ids);
};

// SoA-Pflege: Status + Begruendung (Anwendbarkeit)
router.put('/:id', authenticate, requireRole('admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const control = await Control.findByPk(req.params.id);
    if (!control) return res.status(404).json({ error: 'Not found' });
    const { status, applicability_justification, title, description, type, policy_ids } = req.body;
    const before = { status: control.status };
    await control.update({
      ...(status !== undefined && { status }),
      ...(applicability_justification !== undefined && { applicability_justification }),
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(type !== undefined && { type }),
    });
    if (policy_ids !== undefined) await applyLinks(control, req.body);
    // Sync status back to module-specific table (best-effort)
    if (status !== undefined && control.framework === 'iso27001' && control.code && SOA_TO_ISO[status]) {
      Iso27001Control.update(
        { implementation_status: SOA_TO_ISO[status] },
        { where: { ref: control.code } }
      ).catch(() => {});
    }
    await auditFromReq(req, 'update', 'control', control.id, `${control.code} ${control.title}`, { before, after: { status: control.status } });
    const full = await Control.findByPk(control.id, { include: includeAll });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Eigene (custom) Massnahme anlegen
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { code, title, description, type, status, policy_ids } = req.body;
    if (!title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    const control = await Control.create({ framework: 'custom', code: code || null, title, description, type: type || 'organizational', status: status || 'planned' });
    if (policy_ids) await applyLinks(control, req.body);
    await auditFromReq(req, 'create', 'control', control.id, control.title, {});
    const full = await Control.findByPk(control.id, { include: includeAll });
    res.status(201).json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const control = await Control.findByPk(req.params.id);
    if (!control) return res.status(404).json({ error: 'Not found' });
    if (control.framework !== 'custom') return res.status(400).json({ error: 'Nur eigene (custom) Maßnahmen können gelöscht werden.' });
    await control.destroy();
    await auditFromReq(req, 'delete', 'control', control.id, control.title, {});
    res.json({ message: 'Control deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bulk-delete', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Ungültige IDs' });
    }
    const controls = await Control.findAll({ where: { id: ids } });
    if (controls.length === 0) {
      return res.status(404).json({ error: 'Keine Maßnahmen gefunden' });
    }
    const nonCustom = controls.filter(c => c.framework !== 'custom');
    if (nonCustom.length > 0) {
      return res.status(400).json({ error: 'Nur eigene (custom) Maßnahmen können gelöscht werden.' });
    }
    for (const control of controls) {
      await control.destroy();
      await auditFromReq(req, 'delete', 'control', control.id, control.title, {});
    }
    res.json({ message: `${controls.length} Maßnahmen gelöscht` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
