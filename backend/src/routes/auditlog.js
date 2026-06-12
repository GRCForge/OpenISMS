const express = require('express');
const { Op } = require('sequelize');
const { AuditLog } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const { entity_type, action, actor_id, from, to, search, limit = 200, offset = 0 } = req.query;
    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (action) where.action = action;
    if (actor_id) where.actor_id = actor_id;
    if (search) where.entity_name = { [Op.like]: `%${search}%` };
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
