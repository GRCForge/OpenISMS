const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const rateLimit = require('express-rate-limit');
const { Document, User } = require('../models');
const { authenticate, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

// Rate limiting for document download endpoint to mitigate DoS (CWE-770)
const downloadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // Limit each IP to 60 downloads per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Download-Anfragen. Bitte warten Sie 5 Minuten.' }
});

// Rate limiting for document deletion endpoint to mitigate DoS (CWE-770)
const deleteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // Limit each IP to 30 deletions per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Lösch-Anfragen. Bitte warten Sie 5 Minuten.' }
});

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const getSafePath = (filename) => {
  if (!filename) return null;
  // Ensure we are only looking at the base name to prevent relative path injections
  const safeFilename = path.basename(filename);
  const fullPath = path.resolve(path.join(UPLOAD_DIR, safeFilename));
  // Double check that the resolved path is still within UPLOAD_DIR
  if (!fullPath.startsWith(UPLOAD_DIR + path.sep) && fullPath !== UPLOAD_DIR) return null;
  return fullPath;
};

const ALLOWED_EXT = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.png', '.jpg', '.jpeg', '.zip'];

const MAGIC_BYTES = {
  '.pdf':  [0x25, 0x50, 0x44, 0x46],
  '.zip':  [0x50, 0x4B, 0x03, 0x04],
  '.docx': [0x50, 0x4B, 0x03, 0x04],
  '.xlsx': [0x50, 0x4B, 0x03, 0x04],
  '.pptx': [0x50, 0x4B, 0x03, 0x04],
  '.doc':  [0xD0, 0xCF, 0x11, 0xE0],
  '.xls':  [0xD0, 0xCF, 0x11, 0xE0],
  '.ppt':  [0xD0, 0xCF, 0x11, 0xE0],
  '.png':  [0x89, 0x50, 0x4E, 0x47],
  '.jpg':  [0xFF, 0xD8, 0xFF],
  '.jpeg': [0xFF, 0xD8, 0xFF],
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
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const secureRandom = crypto.randomBytes(16).toString('hex');
    cb(null, `${Date.now()}-${secureRandom}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new Error(`Dateityp nicht erlaubt. Erlaubt: ${ALLOWED_EXT.join(', ')}`));
  },
});

const router = express.Router({ mergeParams: true });

router.get('/', authenticate, async (req, res) => {
  try {
    const isRestricted = req.user.role === 'it-staff' || req.user.role === 'viewer';
    const where = {};
    if (req.params.assetId) {
      where.asset_id = req.params.assetId;
    } else if (req.params.vendorId) {
      where.vendor_id = req.params.vendorId;
    } else if (req.params.incidentId) {
      where.incident_id = req.params.incidentId;
    } else {
      return res.status(400).json({ error: 'Asset ID, Vendor ID oder Incident ID erforderlich' });
    }

    if (isRestricted) {
      where.category = { [Op.ne]: 'contract' };
    }

    const docs = await Document.findAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    res.json(docs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireWriteAccess(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const uploadedPath = getSafePath(req.file.filename);
    if (!checkMagicBytes(uploadedPath, ext)) {
      if (uploadedPath) fs.unlink(uploadedPath, () => {});
      return res.status(400).json({ error: 'Dateiinhalt stimmt nicht mit der Dateiendung überein' });
    }

    const docData = {
      uploaded_by: req.user.id,
      filename: req.file.filename,
      original_name: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      category: req.body.category || 'other',
      description: req.body.description || '',
    };

    let auditEntity = '';
    let auditId = null;

    if (req.params.assetId) {
      docData.asset_id = req.params.assetId;
      auditEntity = 'asset';
      auditId = req.params.assetId;
    } else if (req.params.vendorId) {
      docData.vendor_id = req.params.vendorId;
      auditEntity = 'vendor';
      auditId = req.params.vendorId;
    } else if (req.params.incidentId) {
      docData.incident_id = req.params.incidentId;
      auditEntity = 'incident';
      auditId = req.params.incidentId;
    } else {
      return res.status(400).json({ error: 'Asset ID, Vendor ID oder Incident ID erforderlich' });
    }

    const doc = await Document.create(docData);
    await auditFromReq(req, 'create', auditEntity, auditId, req.file.originalname, {
      document_id: doc.id, category: doc.category, size: doc.size,
    });
    
    const withUploader = await Document.findByPk(doc.id, {
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
    });
    res.status(201).json(withUploader);
  } catch (e) {
    if (req.file) {
      const safe = getSafePath(req.file.filename);
      if (safe) fs.unlink(safe, () => {});
    }
    res.status(400).json({ error: e.message });
  }
});

router.get('/:docId/download', authenticate, downloadLimiter, async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });

    if (req.params.assetId && doc.asset_id !== parseInt(req.params.assetId)) {
      return res.status(403).json({ error: 'Verboten' });
    }
    if (req.params.vendorId && doc.vendor_id !== parseInt(req.params.vendorId)) {
      return res.status(403).json({ error: 'Verboten' });
    }
    if (req.params.incidentId && doc.incident_id !== parseInt(req.params.incidentId)) {
      return res.status(403).json({ error: 'Verboten' });
    }

    const filePath = getSafePath(doc.filename);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

    // nosniff verhindert, dass der Browser den vom Upload übernommenen
    // (client-gesetzten) MIME-Typ überschreibt und z.B. eine als PDF
    // deklarierte Datei als HTML/JS interpretiert -> Stored-XSS-Schutz.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.query.inline === 'true') {
      res.setHeader('Content-Type', doc.mimetype || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_name)}"`);
      return res.sendFile(filePath);
    }

    res.download(filePath, doc.original_name);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:docId', authenticate, requireWriteAccess(), deleteLimiter, async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });

    if (req.params.assetId && doc.asset_id !== parseInt(req.params.assetId)) {
      return res.status(403).json({ error: 'Verboten' });
    }
    if (req.params.vendorId && doc.vendor_id !== parseInt(req.params.vendorId)) {
      return res.status(403).json({ error: 'Verboten' });
    }
    if (req.params.incidentId && doc.incident_id !== parseInt(req.params.incidentId)) {
      return res.status(403).json({ error: 'Verboten' });
    }

    const filePath = getSafePath(doc.filename);
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await doc.destroy();
    res.json({ message: 'Dokument gelöscht' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
