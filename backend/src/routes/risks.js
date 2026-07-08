const express = require('express');
const { Op } = require('sequelize');
const { Risk, Asset, User, Document, Threat, Control, VvtEntry, Incident, Task } = require('../models');
const { authenticate, requireRole, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { notify } = require('../services/notifyService');
const { computeLevel, scaleInfo } = require('../services/riskScale');
const { computeResidual } = require('../services/residual');
const { escapeLike } = require('../utils/sqlUtils');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

const includeAll = [
  { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'acceptedBy', attributes: ['id', 'name'] },
  { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
  { model: Threat, as: 'threats', attributes: ['id', 'code', 'title', 'source'], through: { attributes: [] } },
  { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework', 'status'], through: { attributes: ['effectiveness'] } },
  { model: Document, as: 'acceptanceDocument', attributes: ['id', 'original_name'] },
  { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
  { model: Incident, as: 'incidents', through: { attributes: [] } },
];

// Per-record write authorization, mirroring the read scope in GET /:id: admin and
// assessor may act on any risk; any other role only on risks they own. Prevents a
// generic owner/it-staff/dpo user from modifying or signing off risks they cannot read.
const canWriteRisk = (user, risk) =>
  user.role === 'admin' || user.role === 'assessor' || risk.owner_id === user.id;

// Standardisierte Skala/Matrix (fuer die Heatmap im Frontend)
router.get('/scale', authenticate, (req, res) => res.json(scaleInfo()));

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, treatment, level, search } = req.query;
    const where = {};
    if (status) where.status = status;
    if (treatment) where.treatment = treatment;
    if (level) where.inherent_level = level;
    if (search) where.title = { [Op.like]: `%${escapeLike(search)}%` };
    const risks = await Risk.findAll({ where, include: includeAll, order: [['created_at', 'DESC']] });
    res.json(risks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const risk = await Risk.findByPk(req.params.id, { include: includeAll });
    if (!risk) return res.status(404).json({ error: 'Not found' });
    
    // Authorization: only admin, assessor, risk owner, or risk is assigned to user's role can view
    const isAdmin = req.user.role === 'admin';
    const isAssessor = req.user.role === 'assessor';
    const isOwner = risk.owner_id === req.user.id;
    
    if (!isAdmin && !isAssessor && !isOwner) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(risk);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const buildFields = (body) => {
  const f = {
    title: body.title,
    description: body.description ?? null,
    category: body.category ?? null,
    owner_id: body.owner_id || null,
    likelihood: parseInt(body.likelihood) || 3,
    impact: parseInt(body.impact) || 3,
    treatment: body.treatment || 'mitigate',
    treatment_plan: body.treatment_plan ?? null,
    status: body.status || 'open',
    review_date: (body.review_date === '' || body.review_date === 'Invalid date') ? null : (body.review_date || null),
    acceptance_document_id: body.acceptance_document_id || null,
  };
  f.inherent_level = computeLevel(f.likelihood, f.impact);
  return f;
};

// Verknuepfungen (Assets, Bedrohungen, Controls mit Wirksamkeit) setzen.
// Die Zuordnungen betreffen unterschiedliche Verknüpfungstabellen und sind
// voneinander unabhängig — daher parallel statt sequentiell.
const applyLinks = async (risk, body) => {
  const ops = [];
  if (Array.isArray(body.asset_ids)) ops.push(risk.setAssets(body.asset_ids));
  if (Array.isArray(body.threat_ids)) ops.push(risk.setThreats(body.threat_ids));
  if (Array.isArray(body.vvt_ids)) ops.push(risk.setVvtEntries(body.vvt_ids));
  if (Array.isArray(body.incident_ids)) ops.push(risk.setIncidents(body.incident_ids));
  if (Array.isArray(body.controls)) {
    ops.push((async () => {
      await risk.setControls([]);
      await Promise.all(
        body.controls.filter(c => c && c.id).map(c =>
          risk.addControl(c.id, { through: { effectiveness: parseInt(c.effectiveness) || 3 } })
        )
      );
    })());
  }
  await Promise.all(ops);
};

// Automatische Restrisiko-Berechnung aus umgesetzten Controls
const recomputeResidual = async (risk) => {
  const controls = await risk.getControls({ joinTableAttributes: ['effectiveness'] });
  const links = controls.map(c => ({ effectiveness: c.RiskControl?.effectiveness, status: c.status }));
  await risk.update(computeResidual(risk.likelihood, risk.impact, links));
};

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    const risk = await Risk.create(buildFields(req.body));
    await applyLinks(risk, req.body);
    await recomputeResidual(risk);
    await auditFromReq(req, 'create', 'risk', risk.id, risk.title, { level: risk.inherent_level, treatment: risk.treatment });
    if (risk.owner_id) {
      await notify({
        userId: risk.owner_id, actorId: req.user.id, type: 'assignment',
        title: 'Risiko zugewiesen',
        content: `Sie wurden als Risiko-Owner für „${risk.ref || risk.title}" zugewiesen.`,
        link: '/risks',
      });
    }
    const full = await Risk.findByPk(risk.id, { include: includeAll });
    res.status(201).json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const risk = await Risk.findByPk(req.params.id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    if (!canWriteRisk(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    const fields = [
      'title', 'description', 'category', 'owner_id', 'likelihood', 'impact',
      'inherent_level', 'inherent_score', 'residual_likelihood', 'residual_impact',
      'residual_level', 'residual_score', 'treatment', 'status', 'review_date'
    ];
    const before = {};
    fields.forEach(f => before[f] = risk[f]);
    const prevOwner = risk.owner_id;
    
    await risk.update(buildFields(req.body));
    await applyLinks(risk, req.body);
    await recomputeResidual(risk);
    
    if (risk.owner_id && String(prevOwner) !== String(risk.owner_id)) {
      await notify({
        userId: risk.owner_id, actorId: req.user.id, type: 'assignment',
        title: 'Risiko zugewiesen',
        content: `Sie wurden als Risiko-Owner für „${risk.ref || risk.title}" zugewiesen.`,
        link: '/risks',
      });
    }
    
    const after = {};
    fields.forEach(f => after[f] = risk[f]);
    
    await auditFromReq(req, 'update', 'risk', risk.id, risk.title, { before, after });
    const full = await Risk.findByPk(risk.id, { include: includeAll });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Risk-Owner Sign-off (NIS-2 Management-Haftung): digitale Freigabe mit Zeitstempel
router.patch('/:id/signoff', authenticate, requireRole('admin', 'assessor', 'owner'), async (req, res) => {
  try {
    const risk = await Risk.findByPk(req.params.id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    if (!canWriteRisk(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    await risk.update({
      status: 'accepted',
      accepted_by_id: req.user.id,
      accepted_at: new Date(),
      accepted_until: req.body.valid_until || null,
    });
    await auditFromReq(req, 'acknowledge', 'risk', risk.id, risk.title, { accepted_until: req.body.valid_until || null });
    const full = await Risk.findByPk(risk.id, { include: includeAll });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Sign-off zuruecknehmen
router.patch('/:id/revoke', authenticate, requireRole('admin', 'assessor', 'owner'), async (req, res) => {
  try {
    const risk = await Risk.findByPk(req.params.id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    if (!canWriteRisk(req.user, risk)) return res.status(403).json({ error: 'Forbidden' });
    await risk.update({ status: 'in_treatment', accepted_by_id: null, accepted_at: null, accepted_until: null });
    const full = await Risk.findByPk(risk.id, { include: includeAll });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const risk = await Risk.findByPk(req.params.id);
    if (!risk) return res.status(404).json({ error: 'Not found' });
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'risk', related_id: risk.id, status: { [Op.in]: ['open', 'in_progress'] } } }
    );
    await risk.destroy();
    await auditFromReq(req, 'delete', 'risk', risk.id, risk.title, {});
    res.json({ message: 'Risk deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
