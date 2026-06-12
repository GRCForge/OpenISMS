const express = require('express');
const { fn, col, Op } = require('sequelize');
const { Asset, Risk, Control, Incident, Reminder, ReviewSignOff, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// Aggregierte Kennzahlen fuer das Management-Review (ISO 27001 Kap. 9.3).
router.get('/kpis', authenticate, async (req, res) => {
  try {
    const [
      totalAssets, activeAssets,
      risksByLevel, risksByStatus, acceptedSignedOff, totalRisks,
      controlsByStatus, totalControls,
      incidentsBySeverity, openIncidents, nis2Incidents, totalIncidents,
      overdueReviews,
    ] = await Promise.all([
      Asset.count(),
      Asset.count({ where: { status: 'active' } }),
      Risk.findAll({ attributes: ['inherent_level', [fn('COUNT', col('id')), 'count']], group: ['inherent_level'], raw: true }),
      Risk.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true }),
      Risk.count({ where: { status: 'accepted', accepted_by_id: { [Op.ne]: null } } }),
      Risk.count(),
      Control.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true }),
      Control.count(),
      Incident.findAll({ attributes: ['severity', [fn('COUNT', col('id')), 'count']], group: ['severity'], raw: true }),
      Incident.count({ where: { status: { [Op.notIn]: ['resolved', 'closed'] } } }),
      Incident.count({ where: { nis2_reportable: true } }),
      Incident.count(),
      Reminder.count({ where: { status: 'overdue' } }),
    ]);

    const toMap = (rows, key) => rows.reduce((m, r) => { m[r[key]] = parseInt(r.count); return m; }, {});
    const implemented = toMap(controlsByStatus, 'status').implemented || 0;
    const soaCoverage = totalControls ? Math.round((implemented / totalControls) * 100) : 0;

    res.json({
      generatedAt: new Date(),
      assets: { total: totalAssets, active: activeAssets },
      risks: { total: totalRisks, byLevel: toMap(risksByLevel, 'inherent_level'), byStatus: toMap(risksByStatus, 'status'), acceptedSignedOff },
      soa: { total: totalControls, byStatus: toMap(controlsByStatus, 'status'), coverage: soaCoverage },
      incidents: { total: totalIncidents, open: openIncidents, nis2: nis2Incidents, bySeverity: toMap(incidentsBySeverity, 'severity') },
      reviews: { overdue: overdueReviews },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/sign-offs', authenticate, async (req, res) => {
  try {
    const signOffs = await ReviewSignOff.findAll({
      include: [{ model: User, as: 'approvedBy', attributes: ['id', 'name', 'email'] }],
      order: [['approved_at', 'DESC']],
    });
    res.json(signOffs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sign-off', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const { report_date, notes } = req.body;
    const signOff = await ReviewSignOff.create({
      report_date: report_date || new Date().toISOString().slice(0, 10),
      approved_by_id: req.user.id,
      approved_at: new Date(),
      notes,
    });
    const full = await ReviewSignOff.findByPk(signOff.id, {
      include: [{ model: User, as: 'approvedBy', attributes: ['id', 'name', 'email'] }],
    });
    res.status(201).json(full);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
