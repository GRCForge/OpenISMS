const router = require('express').Router();
const { heavyLimiter } = require('../middleware/rateLimiter');
router.use(heavyLimiter);
const { Op } = require('sequelize');
const { Asset, Assessment, Risk, Incident, Control, Task, Reminder, Kpi, KpiMeasurement } = require('../models');
const healthScore = require('../services/healthScore');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');

router.use(authenticate);
router.use(requirePermission('reports','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'));

// Build array of last N months as { label, start, end }
function lastNMonths(n) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    months.push({
      label: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`,
      start,
      end,
    });
  }
  return months;
}

router.get('/trends', async (req, res) => {
  try {
    const months = lastNMonths(12);
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // Fetch raw data created in last 12 months for bucketing
    const [incidents, risks, assets, tasksDone, controls, allReminders, allAssessments, allTasks] = await Promise.all([
      Incident.findAll({ where: { created_at: { [Op.gte]: twelveMonthsAgo } }, attributes: ['created_at', 'severity', 'status'], raw: true }),
      Risk.findAll({ where: { created_at: { [Op.gte]: twelveMonthsAgo } }, attributes: ['created_at', 'inherent_level'], raw: true }),
      Asset.findAll({ where: { created_at: { [Op.gte]: twelveMonthsAgo } }, attributes: ['created_at'], raw: true }),
      Task.findAll({ where: { status: 'done', completed_at: { [Op.gte]: twelveMonthsAgo } }, attributes: ['completed_at'], raw: true }),
      Control.findAll({ attributes: ['status'], raw: true }),
      Reminder.findAll({ attributes: ['status'], raw: true }),
      Assessment.findAll({
        where: { is_current: true },
        attributes: ['risk_level', 'risk_treatment'],
        include: [{
          model: Asset,
          attributes: [],
          where: { status: { [Op.ne]: 'decommissioned' } }
        }],
        raw: true
      }),
      Task.findAll({ where: { status: { [Op.ne]: 'cancelled' } }, attributes: ['status'], raw: true }),
    ]);

    // Second batch of independent aggregates — run in parallel instead of four
    // sequential round-trips (none depend on the bucketing/distribution above).
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const [totalAssets, resolvedIncidents, kpis, openIncidents, allRisks] = await Promise.all([
      Asset.count({ where: { status: { [Op.ne]: 'decommissioned' } } }),
      Incident.findAll({
        where: { status: { [Op.in]: ['resolved', 'closed'] }, updated_at: { [Op.gte]: ninetyDaysAgo } },
        attributes: ['created_at', 'updated_at'], raw: true,
      }),
      Kpi.findAll({
        include: [{ model: KpiMeasurement, as: 'measurements', order: [['measured_at', 'DESC']], limit: 6 }],
        order: [['title', 'ASC']],
      }),
      Incident.count({ where: { status: { [Op.in]: ['reported', 'investigating', 'contained'] } } }),
      // Das RISIKOREGISTER, nicht die CIA-Bewertungen der Assets. Beides hiess
      // bisher "offene hohe Risiken" und meinte Verschiedenes - der Bericht
      // zaehlte Assessments, das MCP-Werkzeug Risiken. Fuer eine Kennzahl, die
      // in einem Managementbericht steht, ist das Risikoregister die richtige
      // Quelle: Ein hohes Restrisiko ist eine bewertete, benannte Aussage,
      // eine hohe CIA-Einstufung nur ein Schutzbedarf.
      // Ohne Zeitfenster - ein Risiko von vor 13 Monaten ist nicht erledigt.
      Risk.findAll({ attributes: ['residual_level', 'status'], raw: true }),
    ]);

    // Monthly bucketing
    const monthly = months.map(m => {
      const inMonth = (dateStr) => {
        const d = new Date(dateStr);
        return d >= m.start && d <= m.end;
      };
      return {
        label: m.label,
        incidents: incidents.filter(i => inMonth(i.created_at)).length,
        risks_new: risks.filter(r => inMonth(r.created_at)).length,
        assets_new: assets.filter(a => inMonth(a.created_at)).length,
        tasks_done: tasksDone.filter(t => inMonth(t.completed_at)).length,
        high_incidents: incidents.filter(i => inMonth(i.created_at) && (i.severity === 'high' || i.severity === 'critical')).length,
      };
    });

    // Risk distribution (from current assessments)
    const riskDist = { critical: 0, high: 0, medium: 0, low: 0 };
    allAssessments.forEach(a => { if (riskDist[a.risk_level] !== undefined) riskDist[a.risk_level]++; });

    // Control status
    const controlStatus = { implemented: 0, planned: 0, not_applicable: 0 };
    controls.forEach(c => { if (controlStatus[c.status] !== undefined) controlStatus[c.status]++; });

    // Task status (current)
    const taskStatus = { open: 0, in_progress: 0, done: 0 };
    allTasks.forEach(t => { if (taskStatus[t.status] !== undefined) taskStatus[t.status]++; });

    // Auto-computed KPIs
    const assessedCount = allAssessments.length;
    const assessmentCoverage = totalAssets > 0 ? Math.round((assessedCount / totalAssets) * 100) : 0;

    const implementedControls = controlStatus.implemented;
    const totalControls = controls.length;
    const controlCoverage = totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0;

    const overdueCount = allReminders.filter(r => r.status === 'overdue').length;

    // Offen heisst: weder akzeptiert noch geschlossen. Ein akzeptiertes Risiko
    // ist eine getroffene Entscheidung und kein offener Punkt.
    const offeneRisiken = allRisks.filter(r => !['accepted', 'closed'].includes(r.status));
    const criticalRisks = offeneRisiken.filter(r => r.residual_level === 'critical').length;
    const highRisks = offeneRisiken.filter(r => r.residual_level === 'high').length;
    const openHighRisks = criticalRisks + highRisks;

    const taskTotal = allTasks.length;
    const taskCompletionRate = taskTotal > 0 ? Math.round((taskStatus.done / taskTotal) * 100) : 0;

    // MTTR: mean days from created_at to resolved incidents in last 90 days
    // (resolvedIncidents was fetched in the parallel batch above)
    let mttr = null;
    if (resolvedIncidents.length > 0) {
      const totalDays = resolvedIncidents.reduce((sum, i) => {
        return sum + Math.max(0, (new Date(i.updated_at) - new Date(i.created_at)) / 86400000);
      }, 0);
      mttr = Math.round((totalDays / resolvedIncidents.length) * 10) / 10;
    }

    // ISMS-Health-Score - eine Berechnung fuer alle Aufrufer,
    // siehe services/healthScore.js (dort steht auch, warum).
    const health = healthScore.berechne({
      totalAssets,
      assessedAssets: assessedCount,
      totalControls,
      implementedControls,
      overdueReviews: overdueCount,
      criticalRisks,
      highRisks,
      totalRisks: allRisks.length,
    });

    // (manual KPIs fetched in the parallel batch above)

    res.json({
      monthly,
      riskDistribution: riskDist,
      controlStatus,
      taskStatus,
      autoKpis: {
        health_score: health.score,
        // Womit die Zahl zustande kam. Eine 0 soll unterscheidbar sein von
        // "alles schlecht" - sie kann auch heissen: noch nichts erfasst.
        health_score_parts: health.parts,
        health_score_basis: health.basis,
        control_coverage: controlCoverage,
        assessment_coverage: assessmentCoverage,
        open_high_risks: openHighRisks,
        overdue_reminders: overdueCount,
        task_completion_rate: taskCompletionRate,
        mttr_days: mttr,
        total_assets: totalAssets,
        open_incidents: openIncidents,
      },
      kpis: kpis.map(k => ({
        id: k.id, title: k.title, target: k.target,
        current_value: k.current_value, status: k.status,
        measurements: (k.measurements || []).reverse(),
      })),
    });
  } catch (e) { serverError(res, e, 'report'); }
});

module.exports = router;
