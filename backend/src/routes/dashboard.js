const express = require('express');
const { Op, fn, col } = require('sequelize');
const { Asset, Assessment, Reminder, User, AuditLog } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const { heavyLimiter } = require('../middleware/rateLimiter');
router.use(heavyLimiter);

router.get('/', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().split('T')[0];

    // Mark overdue
    await Reminder.update(
      { status: 'overdue' },
      { where: { status: 'pending', due_date: { [Op.lt]: todayStr } } }
    );

    const [
      totalAssets, activeAssets, overdueReminders,
      upcomingReminders, riskDistribution, recentAssessments,
      assetsByClassification, assetsByType, recentActivity, complianceAssets,
    ] = await Promise.all([
      Asset.count({ where: { status: { [Op.ne]: 'decommissioned' } } }),
      Asset.count({ where: { status: 'active' } }),
      Reminder.count({ where: { status: 'overdue' } }),
      Reminder.findAll({
        where: { status: 'pending', due_date: { [Op.between]: [todayStr, in30Str] } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'] }],
        order: [['due_date', 'ASC']],
        limit: 10,
      }),
      Assessment.findAll({
        attributes: ['risk_level', [fn('COUNT', col('id')), 'count']],
        where: { is_current: true },
        group: ['risk_level'],
        raw: true,
      }),
      Assessment.findAll({
        where: { is_current: true },
        include: [
          { model: Asset, attributes: ['id', 'name', 'type', 'classification'] },
          { model: User, as: 'assessorUser', attributes: ['id', 'name'] },
        ],
        order: [['assessed_at', 'DESC']],
        limit: 5,
      }),
      Asset.findAll({
        attributes: ['classification', [fn('COUNT', col('id')), 'count']],
        where: { status: 'active' },
        group: ['classification'],
        raw: true,
      }),
      Asset.findAll({
        attributes: ['type', [fn('COUNT', col('id')), 'count']],
        where: { status: 'active' },
        group: ['type'],
        raw: true,
      }),
      AuditLog.findAll({
        // Keine Login/Logout- (auth) und Benutzer-Aktivitaeten im Dashboard,
        // aber alle Aenderungen an Assets, Bewertungen, Erinnerungen etc.
        where: { entity_type: { [Op.notIn]: ['auth', 'user'] } },
        order: [['created_at', 'DESC']],
        limit: 10,
      }),
      Asset.findAll({
        where: { status: 'active' },
        attributes: ['frameworks'],
        raw: true,
      }),
    ]);

    console.log('[Dashboard] Data fetched:', { totalAssets, activeAssets, riskDistribution, assetsByType });

    // Compliance framework counts
    const fwCounts = { iso27001: 0, nis2: 0, gdpr: 0 };
    let covered = 0;
    
    (complianceAssets || []).forEach(a => {
      let fws = [];
      try {
        fws = Array.isArray(a.frameworks) ? a.frameworks : 
              (typeof a.frameworks === 'string' ? JSON.parse(a.frameworks) : []);
      } catch (e) { fws = []; }
      
      if (!Array.isArray(fws)) fws = [];
      
      if (fws.length > 0) covered++;
      fws.forEach(fw => { if (fwCounts[fw] !== undefined) fwCounts[fw]++; });
    });
    const compliancePct = activeAssets > 0 ? Math.round((covered / activeAssets) * 100) : 0;

    const highRisk = riskDistribution
      .filter(r => ['high', 'critical'].includes(r.risk_level))
      .reduce((s, r) => s + parseInt(r.count), 0);

    res.json({
      stats: {
        totalAssets, activeAssets, overdueReminders,
        upcomingReminders: upcomingReminders.length,
        highRisk, compliancePct,
      },
      upcomingReminders,
      riskDistribution,
      recentAssessments,
      assetsByClassification,
      assetsByType,
      recentActivity,
      frameworkCoverage: { ...fwCounts, total: activeAssets },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
