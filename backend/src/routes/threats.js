const express = require('express');
const { Op } = require('sequelize');
const { Threat } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { source, search } = req.query;
    const where = {};
    if (source) where.source = source;
    if (search) where[Op.or] = [{ code: { [Op.like]: `%${search}%` } }, { title: { [Op.like]: `%${search}%` } }];
    const threats = await Threat.findAll({ where, order: [['source', 'ASC'], ['code', 'ASC'], ['title', 'ASC']] });
    res.json(threats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eigene Bedrohung ergaenzen
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    const threat = await Threat.create({ source: 'custom', code: req.body.code || null, title: req.body.title, description: req.body.description });
    await auditFromReq(req, 'create', 'settings', threat.id, threat.title, { action: 'create_custom_threat', code: threat.code });
    res.status(201).json(threat);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
