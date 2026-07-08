const express = require('express');
const { Op } = require('sequelize');
const { AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { verifyAuditRow } = require('../services/auditService');
const { escapeLike } = require('../utils/sqlUtils');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

// Integrity check: recompute the HMAC for every audit row and report any that were
// tampered with (or predate the integrity feature and cannot be verified).
router.get('/verify', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Stream in batches so the append-only, unbounded audit_log never has to be
    // fully materialized in memory.
    const BATCH = 1000;
    let offset = 0, total = 0, intact = 0, tampered = 0, unverifiable = 0;
    const tamperedIds = [];
    for (;;) {
      const rows = await AuditLog.findAll({ order: [['id', 'ASC']], limit: BATCH, offset });
      if (rows.length === 0) break;
      for (const row of rows) {
        total++;
        const result = verifyAuditRow(row);
        if (result === null) unverifiable++;
        else if (result) intact++;
        else { tampered++; if (tamperedIds.length < 100) tamperedIds.push(row.id); }
      }
      offset += rows.length;
      if (rows.length < BATCH) break;
    }
    res.json({ total, intact, tampered, unverifiable, tamperedIds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const { entity_type, action, actor_id, from, to, search, limit = 200, offset = 0 } = req.query;
    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (action) where.action = action;
    if (actor_id) where.actor_id = actor_id;
    if (search) where.entity_name = { [Op.like]: `%${escapeLike(search)}%` };
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(parseInt(limit), 500),
      offset: parseInt(offset),
    });

    res.json({ logs: rows, total: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
