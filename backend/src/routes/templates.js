const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Template, User } = require('../models');
const { authenticate, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const getSafePath = (filename) => {
  if (!filename) return null;
  const safeFilename = path.basename(filename);
  const fullPath = path.resolve(path.join(UPLOAD_DIR, safeFilename));
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

const router = express.Router();

router.use(authenticate);

// List templates
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.category) {
      where.category = req.query.category;
    }
    const templates = await Template.findAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    res.json(templates);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upload template
router.post('/', requireWriteAccess(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const uploadedPath = getSafePath(req.file.filename);
    if (!checkMagicBytes(uploadedPath, ext)) {
      if (uploadedPath) fs.unlink(uploadedPath, () => {});
      return res.status(400).json({ error: 'Dateiinhalt stimmt nicht mit der Dateiendung überein' });
    }

    const { title, description, category } = req.body;
    if (!title) return res.status(400).json({ error: 'Titel ist erforderlich' });

    const template = await Template.create({
      title,
      description: description || '',
      category: category || 'general',
      filename: req.file.filename,
      original_name: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploaded_by: req.user.id,
    });

    await auditFromReq(req, 'create', 'template', template.id, template.title, {});

    const withUploader = await Template.findByPk(template.id, {
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

// Download template
router.get('/:id/download', async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Nicht gefunden' });

    const filePath = getSafePath(template.filename);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });

    res.download(filePath, template.original_name);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete template
router.delete('/:id', requireWriteAccess(), async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    if (!template) return res.status(404).json({ error: 'Nicht gefunden' });

    const filePath = getSafePath(template.filename);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const title = template.title;
    await template.destroy();
    await auditFromReq(req, 'delete', 'template', req.params.id, title, {});

    res.json({ message: 'Vorlage gelöscht' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
