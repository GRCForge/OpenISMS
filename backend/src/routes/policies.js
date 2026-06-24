const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const crypto = require('crypto');
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
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'];
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20 MB

const MAGIC_BYTES = {
  '.pdf':  [0x25, 0x50, 0x44, 0x46],
  '.docx': [0x50, 0x4B, 0x03, 0x04],
  '.xlsx': [0x50, 0x4B, 0x03, 0x04],
  '.doc':  [0xD0, 0xCF, 0x11, 0xE0],
  '.xls':  [0xD0, 0xCF, 0x11, 0xE0],
};

const checkMagicBytes = (filePath, ext) => {
  const expected = MAGIC_BYTES[ext];
  if (!expected) return true;
  try {
    const buf = Buffer.alloc(expected.length);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, expected.length, 0);
    fs.closeSync(fd);
    return Buffer.from(expected).equals(buf);
  } catch {
    return false;
  }
};

const storage = multer.diskStorage({
  destination: 'uploads/policies/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, Date.now() + '-' + safeName + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) return cb(new Error('Nicht erlaubter Dateityp. Erlaubt: PDF, Word, Excel, Text.'));
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) return cb(new Error('Nicht erlaubter MIME-Typ.'));
    cb(null, true);
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
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

// Create policy (Admin, Assessor or DPO)
router.post('/', authenticate, requireRole('admin', 'assessor', 'dpo'), upload.single('file'), async (req, res) => {
  try {
    const { asset_ids, control_ids, file_hash: _h, ...data } = req.body;
    
    // Sanitize dates
    if (data.valid_from === '' || data.valid_from === 'Invalid date') data.valid_from = null;
    if (data.valid_until === '' || data.valid_until === 'Invalid date') data.valid_until = null;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!checkMagicBytes(req.file.path, ext)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Dateiinhalt stimmt nicht mit dem deklarierten Dateityp überein.' });
      }
      data.file_url = req.file.path;
      data.original_filename = req.file.originalname;
      data.file_hash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
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

    const { asset_ids, control_ids, file_hash: _h, ...data } = req.body;

    // Sanitize dates
    if (data.valid_from === '' || data.valid_from === 'Invalid date') data.valid_from = null;
    if (data.valid_until === '' || data.valid_until === 'Invalid date') data.valid_until = null;

    const before = { title: policy.title, version: policy.version, status: policy.status, file_url: policy.file_url };

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!checkMagicBytes(req.file.path, ext)) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Dateiinhalt stimmt nicht mit dem deklarierten Dateityp überein.' });
      }
      // Archive the old file as a version entry — only if the policy already had a file
      // (policy.file_url is null when created without a file; PolicyVersion.file_url is NOT NULL)
      if (policy.file_url) {
        await PolicyVersion.create({
          policy_id: policy.id,
          version: policy.version,
          file_url: policy.file_url,
          original_filename: policy.original_filename,
          file_hash: policy.file_hash,
          created_by: req.user.id,
          notes: `Automatische Archivierung bei Update auf v${data.version || '?'}`
        });
      }

      data.file_url = req.file.path;
      data.original_filename = req.file.originalname;
      data.file_hash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
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

const verifyFileHash = async (filePath, storedHash) => {
  if (!storedHash) return true;
  const computed = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
  return computed === storedHash;
};

// Download old version
router.get('/:id/versions/:versionId/download', authenticate, downloadLimiter, async (req, res) => {
  try {
    const version = await PolicyVersion.findOne({ where: { id: req.params.versionId, policy_id: req.params.id } });
    if (!version) return res.status(404).json({ error: 'Version nicht gefunden' });
    const filePath = safeFilePath(version.file_url);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht vorhanden' });
    if (!await verifyFileHash(filePath, version.file_hash)) {
      console.error(`[Security] Integrity check failed for policy version ${version.id}`);
      return res.status(500).json({ error: 'Dateiintegrität konnte nicht verifiziert werden.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Content-SHA256', version.file_hash || '');
    if (req.query.inline === 'true') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(version.original_filename)}"`);
      return res.sendFile(filePath);
    }
    res.download(filePath, version.original_filename);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

// Download policy file
router.get('/:id/download', authenticate, downloadLimiter, async (req, res) => {
  try {
    const policy = await Policy.findByPk(req.params.id);
    if (!policy || !policy.file_url) return res.status(404).json({ error: 'Datei nicht gefunden' });
    const filePath = safeFilePath(policy.file_url);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht vorhanden' });
    if (!await verifyFileHash(filePath, policy.file_hash)) {
      console.error(`[Security] Integrity check failed for policy ${policy.id}`);
      return res.status(500).json({ error: 'Dateiintegrität konnte nicht verifiziert werden.' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Content-SHA256', policy.file_hash || '');
    if (req.query.inline === 'true') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(policy.original_filename)}"`);
      return res.sendFile(filePath);
    }
    res.download(filePath, policy.original_filename);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
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
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

// Policy acknowledgment endpoints — /acknowledgments/me must be before /:id/... routes
router.get('/acknowledgments/me', authenticate, async (req, res) => {
  try {
    const acks = await PolicyAcknowledgment.findAll({ where: { user_id: req.user.id } });
    res.json(acks);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
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
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.get('/:id/acknowledgments', authenticate, requireRole('admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const acks = await PolicyAcknowledgment.findAll({
      where: { policy_id: req.params.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email'] }],
      order: [['acknowledged_at', 'DESC']],
    });
    res.json(acks);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

module.exports = router;
