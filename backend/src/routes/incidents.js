const express = require('express');
const { Op, fn, col } = require('sequelize');
const { Incident, Asset, User, Risk, Vendor, VvtEntry, Task } = require('../models');
const { authenticate, requireRole, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { notify } = require('../services/notifyService');
const { escapeLike } = require('../utils/sqlUtils');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

const notifyAssignee = async (incident, actorId) => notify({
  userId: incident.assignee_id, actorId, type: 'assignment',
  title: 'Vorfall zugewiesen',
  content: `Ihnen wurde der Sicherheitsvorfall „${incident.ref || incident.title}“ zur Bearbeitung zugewiesen.`,
  link: '/incidents',
});

const includeAll = [
  { model: User, as: 'reporter', attributes: ['id', 'name'] },
  { model: User, as: 'assignee', attributes: ['id', 'name'] },
  { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
  { model: Risk, as: 'risks', attributes: ['id', 'ref', 'title'], through: { attributes: [] } },
  { model: Vendor, as: 'vendors', attributes: ['id', 'name'], through: { attributes: [] } },
  { model: VvtEntry, as: 'vvtEntries', attributes: ['id', 'name'], through: { attributes: [] } },
];

const getAccessWhere = (user) => {
  const base = { deleted: false };
  if (['admin', 'assessor'].includes(user.role)) return base;
  if (user.role === 'it-staff') return { ...base, is_security_incident: true };
  if (user.role === 'dpo') return { ...base, is_gdpr_incident: true };
  return { ...base, is_security_incident: true };
};

// Single source of truth for per-record access — used by read AND write paths so
// a scoped role cannot reach an out-of-scope incident via update.
const canAccessIncident = (user, incident) => {
  const access = getAccessWhere(user);
  if (access.is_security_incident && !incident.is_security_incident) return false;
  if (access.is_gdpr_incident && !incident.is_gdpr_incident) return false;
  return true;
};

router.get('/stats', authenticate, async (req, res) => {
  try {
    const accessWhere = getAccessWhere(req.user);
    const byStatus = await Incident.findAll({ where: accessWhere, attributes: ['status', [fn('COUNT', col('id')), 'count']], group: ['status'], raw: true });
    const bySeverity = await Incident.findAll({ where: accessWhere, attributes: ['severity', [fn('COUNT', col('id')), 'count']], group: ['severity'], raw: true });
    const open = await Incident.count({ where: { ...accessWhere, status: { [Op.notIn]: ['resolved', 'closed'] } } });
    res.json({ total: await Incident.count({ where: accessWhere }), open, byStatus, bySeverity });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, severity, search } = req.query;
    const where = { ...getAccessWhere(req.user) };
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (search) where.title = { [Op.like]: `%${escapeLike(search)}%` };
    const incidents = await Incident.findAll({ where, include: includeAll, order: [['created_at', 'DESC']] });
    res.json(incidents);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const incident = await Incident.findByPk(req.params.id, { include: includeAll });
    if (!incident || incident.deleted) return res.status(404).json({ error: 'Not found' });

    if (!canAccessIncident(req.user, incident)) return res.status(403).json({ error: 'Forbidden' });

    res.json(incident);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const fields = [
  'title', 'description', 'category', 'severity', 'status', 'assignee_id',
  'detected_at', 'occurred_at', 'resolved_at',
  'is_security_incident', 'is_gdpr_incident',
  'nis2_reportable', 'early_warning_at', 'notification_at',
  'impact', 'root_cause', 'corrective_actions',
  'lessons_learned', 'affected_systems', 'data_breach_details', 'external_report_id',
];

const buildFields = (body) => {
  const f = {};
  fields.forEach(k => { 
    if (body[k] !== undefined) {
      f[k] = (body[k] === '' || body[k] === 'Invalid date') ? null : body[k];
    }
  });
  if ((body.status === 'resolved' || body.status === 'closed') && !body.resolved_at) f.resolved_at = new Date();
  return f;
};

const applyLinks = async (incident, body) => {
  if (Array.isArray(body.asset_ids)) await incident.setAssets(body.asset_ids);
  if (Array.isArray(body.risk_ids)) await incident.setRisks(body.risk_ids);
  if (Array.isArray(body.vendor_ids)) await incident.setVendors(body.vendor_ids);
  if (Array.isArray(body.vvt_ids)) await incident.setVvtEntries(body.vvt_ids);
};

router.post('/', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'Titel ist erforderlich' });
    const incident = await Incident.create({ ...buildFields(req.body), reporter_id: req.user.id });
    await applyLinks(incident, req.body);
    
    const auditDetails = {};
    fields.forEach(f => auditDetails[f] = incident[f]);
    await auditFromReq(req, 'create', 'incident', incident.id, incident.title, auditDetails);
    
    if (incident.assignee_id) await notifyAssignee(incident, req.user.id);
    const full = await Incident.findByPk(incident.id, { include: includeAll });
    res.status(201).json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const incident = await Incident.findByPk(req.params.id);
    if (!incident || incident.deleted) return res.status(404).json({ error: 'Not found' });

    // Enforce the same access scope as reads so a scoped role cannot read (via the
    // returned record) or modify an incident outside its category.
    if (!canAccessIncident(req.user, incident)) return res.status(403).json({ error: 'Forbidden' });

    const before = {};
    fields.forEach(f => before[f] = incident[f]);
    const prevAssignee = incident.assignee_id;

    await incident.update(buildFields(req.body));
    await applyLinks(incident, req.body);
    
    if (incident.assignee_id && String(prevAssignee) !== String(incident.assignee_id)) {
      await notifyAssignee(incident, req.user.id);
    }
    
    const after = {};
    fields.forEach(f => after[f] = incident[f]);
    
    await auditFromReq(req, 'update', 'incident', incident.id, incident.title, { before, after });
    const full = await Incident.findByPk(incident.id, { include: includeAll });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const incident = await Incident.findByPk(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Not found' });
    
    const { deletion_reason } = req.body;
    if (!deletion_reason || !deletion_reason.trim()) {
      return res.status(400).json({ error: 'Eine Begründung für das Löschen ist erforderlich.' });
    }

    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'incident', related_id: incident.id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );
    await incident.update({
      deleted: true,
      deletion_reason: deletion_reason.trim(),
      deleted_at: new Date()
    });
    await auditFromReq(req, 'delete', 'incident', incident.id, incident.title, { deletion_reason });
    res.json({ message: 'Incident deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
