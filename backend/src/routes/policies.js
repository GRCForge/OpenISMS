const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');
const { Policy, PolicyVersion, Asset, Reminder, Notification, User, Control, PolicyAcknowledgment } = require('../models');
const { authenticate, requireRole, isAssessor, isItStaff } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

// Rate limiting for policy downloads to mitigate DoS (CWE-770)
const downloadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // Limit each IP to 60 downloads per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Download-Anfragen. Bitte warten Sie 5 Minuten.' }
});

const POLICIES_DIR = path.resolve('uploads/policies');
const ALLOWED_MIME_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20 MB

const storage = multer.diskStorage({
  destination: 'uploads/policies/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Nicht erlaubter Dateityp. Erlaubt: PDF, Word, Excel, Text.'));
  },
});

if (!fs.existsSync(POLICIES_DIR)) fs.mkdirSync(POLICIES_DIR, { recursive: true });

// List all policies
router.get('/', authenticate, async (req, res) => {
  try {
    const isRestricted = req.user.role === 'it-staff' || req.user.role === 'viewer';
    const where = {};
    if (isRestricted) {
      where.category = { [Op.ne]: 'contract' };
    }

    const policies = await Policy.findAll({
      where,
      include: [
        { model: Asset, as: 'assets', attributes: ['id', 'name'] },
        { model: Control, as: 'controls', attributes: ['id', 'code', 'title'] },
        { model: PolicyVersion, as: 'history', attributes: ['id', 'version', 'created_at'] }
      ],
      order: [['title', 'ASC']]
    });
    res.json(policies);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create policy (Admin, Assessor or DPO)
router.post('/', authenticate, requireRole('admin', 'assessor', 'dpo'), upload.single('file'), async (req, res) => {
  try {
    const { asset_ids, control_ids, ...data } = req.body;
    
    // Sanitize dates
    if (data.valid_from === '' || data.valid_from === 'Invalid date') data.valid_from = null;
    if (data.valid_until === '' || data.valid_until === 'Invalid date') data.valid_until = null;

    if (req.file) {
      data.file_url = req.file.path;
      data.original_filename = req.file.originalname;
    }
    const policy = await Policy.create(data);
    
    if (asset_ids) {
      const ids = Array.isArray(asset_ids) ? asset_ids : JSON.parse(asset_ids);
      await policy.setAssets(ids);
    }
    if (control_ids) {
      const ids = Array.isArray(control_ids) ? control_ids : JSON.parse(control_ids);
      await policy.setControls(ids);
    }
    
    await auditFromReq(req, 'create', 'document', policy.id, policy.title, { version: policy.version });
    res.status(201).json(policy);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update policy (PUT) - Supports version updates and file replacement
router.put('/:id', authenticate, requireRole('admin', 'assessor', 'dpo'), upload.single('file'), async (req, res) => {
  try {
    const policy = await Policy.findByPk(req.params.id);
    if (!policy) return res.status(404).json({ error: 'Dokument nicht gefunden' });

    const { asset_ids, control_ids, ...data } = req.body;
    
    // Sanitize dates
    if (data.valid_from === '' || data.valid_from === 'Invalid date') data.valid_from = null;
    if (data.valid_until === '' || data.valid_until === 'Invalid date') data.valid_until = null;

    const before = { title: policy.title, version: policy.version, status: policy.status, file_url: policy.file_url };

    if (req.file) {
      // Archive the old file as a version entry — only if the policy already had a file
      // (policy.file_url is null when created without a file; PolicyVersion.file_url is NOT NULL)
      if (policy.file_url) {
        await PolicyVersion.create({
          policy_id: policy.id,
          version: policy.version,
          file_url: policy.file_url,
          original_filename: policy.original_filename,
          created_by: req.user.id,
          notes: `Automatische Archivierung bei Update auf v${data.version || '?'}`
        });
      }

      data.file_url = req.file.path;
      data.original_filename = req.file.originalname;
    }

    await policy.update(data);
    
    if (asset_ids) {
      const ids = Array.isArray(asset_ids) ? asset_ids : JSON.parse(asset_ids);
      await policy.setAssets(ids);

      // Workflow: If a contract or DPA is updated with a new file, trigger an assessment review
      if (req.file && (policy.category === 'contract' || policy.category === 'dpa')) {
        const assets = await Asset.findAll({ where: { id: ids } });
        const in7Days = new Date();
        in7Days.setDate(in7Days.getDate() + 7);
        const dueDateStr = in7Days.toISOString().split('T')[0];

        // Collect all payloads first, then bulk-insert in two queries
        const reminderPayloads = [];
        const notifPayloads = [];

        for (const asset of assets) {
          reminderPayloads.push({
            asset_id: asset.id,
            due_date: dueDateStr,
            status: 'pending',
            notes: `System-Erinnerung: Das verknüpfte Dokument "${policy.title}" wurde aktualisiert. Bitte prüfen Sie die Risikobewertung / Schutzbedarfsfeststellung des Assets.`
          });

          const notifyUsers = new Set([asset.owner_id, asset.assessor_id].filter(Boolean));
          for (const uid of notifyUsers) {
            notifPayloads.push({
              user_id: uid,
              actor_id: req.user.id,
              type: 'system',
              title: 'Dokument aktualisiert (Review erforderlich)',
              content: `Das verknüpfte Dokument "${policy.title}" wurde von ${req.user.name} aktualisiert. Eine Neubewertung von "${asset.name}" wird empfohlen.`,
              link: `/assets/${asset.id}`
            });
          }
        }

        if (reminderPayloads.length > 0) await Reminder.bulkCreate(reminderPayloads);
        if (notifPayloads.length > 0) await Notification.bulkCreate(notifPayloads);
      }
    }

    if (control_ids) {
      const ids = Array.isArray(control_ids) ? control_ids : JSON.parse(control_ids);
      await policy.setControls(ids);
    }

    await auditFromReq(req, 'update', 'document', policy.id, policy.title, { before, after: { title: policy.title, version: policy.version, status: policy.status } });
    res.json(policy);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const safeFilePath = (fileUrl) => {
  if (!fileUrl) return null;
  const resolved = path.resolve(fileUrl);
  const rootDir = path.resolve(POLICIES_DIR);
  const uploadsDir = path.resolve('uploads');
  
  if (resolved.startsWith(rootDir + path.sep)) return resolved;
  if (resolved.startsWith(uploadsDir + path.sep)) return resolved;
  return null;
};

// Download old version
router.get('/:id/versions/:versionId/download', authenticate, downloadLimiter, async (req, res) => {
  try {
    const version = await PolicyVersion.findOne({ where: { id: req.params.versionId, policy_id: req.params.id } });
    if (!version) return res.status(404).json({ error: 'Version nicht gefunden' });
    const filePath = safeFilePath(version.file_url);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht vorhanden' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.query.inline === 'true') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(version.original_filename)}"`);
      return res.sendFile(filePath);
    }
    res.download(filePath, version.original_filename);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Download policy file
router.get('/:id/download', authenticate, downloadLimiter, async (req, res) => {
  try {
    const policy = await Policy.findByPk(req.params.id);
    if (!policy || !policy.file_url) return res.status(404).json({ error: 'Datei nicht gefunden' });
    const filePath = safeFilePath(policy.file_url);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht vorhanden' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.query.inline === 'true') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(policy.original_filename)}"`);
      return res.sendFile(filePath);
    }
    res.download(filePath, policy.original_filename);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete policy
router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const policy = await Policy.findByPk(req.params.id);
    if (!policy) return res.status(404).json({ error: 'Not found' });
    
    const filePath = safeFilePath(policy.file_url);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    
    // Also delete old versions
    const versions = await PolicyVersion.findAll({ where: { policy_id: policy.id } });
    versions.forEach(v => {
      const vPath = safeFilePath(v.file_url);
      if (vPath && fs.existsSync(vPath)) fs.unlinkSync(vPath);
    });
    await PolicyVersion.destroy({ where: { policy_id: policy.id } });
    
    await policy.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Policy acknowledgment endpoints — /acknowledgments/me must be before /:id/... routes
router.get('/acknowledgments/me', authenticate, async (req, res) => {
  try {
    const acks = await PolicyAcknowledgment.findAll({ where: { user_id: req.user.id } });
    res.json(acks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/acknowledge', authenticate, async (req, res) => {
  try {
    const policy = await Policy.findByPk(req.params.id);
    if (!policy) return res.status(404).json({ error: 'Richtlinie nicht gefunden' });
    const existing = await PolicyAcknowledgment.findOne({ where: { policy_id: req.params.id, user_id: req.user.id } });
    if (existing) {
      await existing.update({ acknowledged_at: new Date() });
      return res.json(existing);
    }
    const ack = await PolicyAcknowledgment.create({ policy_id: req.params.id, user_id: req.user.id, acknowledged_at: new Date() });
    await auditFromReq(req, 'acknowledge', 'policy', Number(req.params.id), policy.title, {});
    res.status(201).json(ack);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/acknowledgments', authenticate, requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const acks = await PolicyAcknowledgment.findAll({
      where: { policy_id: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['acknowledged_at', 'DESC']],
    });
    res.json(acks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
