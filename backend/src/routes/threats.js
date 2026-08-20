const express = require('express');
const { Op } = require('sequelize');
const { Threat } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { setFilter } = require('../utils/queryFilters');
const { auditFromReq } = require('../services/auditService');
const { escapeLike } = require('../utils/sqlUtils');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

router.get('/', authenticate, requirePermission('threats','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const { source, search } = req.query;
    const where = {};
    setFilter(where, 'source', source);
    if (search) where[Op.or] = [{ code: { [Op.like]: `%${escapeLike(search)}%` } }, { title: { [Op.like]: `%${escapeLike(search)}%` } }];
    const threats = await Threat.findAll({ where, order: [['source', 'ASC'], ['code', 'ASC'], ['title', 'ASC']] });
    res.json(threats);
  } catch (e) { serverError(res, e, 'threats'); }
});

// Eigene Bedrohung ergaenzen
router.post('/', authenticate, requirePermission('threats','create','admin'), async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    const threat = await Threat.create({ source: 'custom', code: req.body.code || null, title: req.body.title, description: req.body.description });
    await auditFromReq(req, 'create', 'settings', threat.id, threat.title, { action: 'create_custom_threat', code: threat.code });
    res.status(201).json(threat);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
