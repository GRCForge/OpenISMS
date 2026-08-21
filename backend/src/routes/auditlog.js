const express = require('express');
const { Op } = require('sequelize');
const { AuditLog } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { scalar, boundedInt, validDate, setFilter } = require('../utils/queryFilters');
const { verifyAuditRow } = require('../services/auditService');
const { escapeLike } = require('../utils/sqlUtils');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

// Integrity check: recompute the HMAC for every audit row and report any that were
// tampered with (or predate the integrity feature and cannot be verified).
router.get('/verify', authenticate, requirePermission('auditlog','verify','admin'), async (req, res) => {
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
    serverError(res, e, 'auditlog');
  }
});

router.get('/', authenticate, requirePermission('auditlog','view','admin','assessor'), async (req, res) => {
  try {
    const { entity_type, action, actor_id, from, to, search, limit = 200, offset = 0 } = req.query;

    // Query parameters arrive as whatever the client sent: ?limit=abc parsed to
    // NaN and ?limit=-1 passed the upper bound, both of which reached MySQL as an
    // invalid LIMIT and came back as a 500. A malformed filter should narrow to a
    // sane default, not fail the page.
    const where = {};
    setFilter(where, 'entity_type', entity_type);
    setFilter(where, 'action', action);
    setFilter(where, 'actor_id', actor_id);
    if (scalar(search)) where.entity_name = { [Op.like]: `%${escapeLike(String(search))}%` };
    const fromDate = validDate(from);
    const toDate = validDate(to, true);
    if (fromDate || toDate) {
      where.created_at = {};
      if (fromDate) where.created_at[Op.gte] = fromDate;
      if (toDate) where.created_at[Op.lte] = toDate;
    }

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit: boundedInt(limit, 200, 1, 500),
      offset: boundedInt(offset, 0, 0, Number.MAX_SAFE_INTEGER),
    });

    res.json({ logs: rows, total: count });
  } catch (e) {
    serverError(res, e, 'auditlog');
  }
});

module.exports = router;
