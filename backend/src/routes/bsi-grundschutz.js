const path = require('path');
const multer = require('multer');
const router = require('express').Router();
const { apiLimiter, heavyLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { BsiRequirement, BsiCatalog, BsiCatalogModule, BsiCatalogRequirement, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { fetchPublicText } = require('../utils/safeFetch');
const { MAX_CATALOG_BYTES, CatalogParseError, parseCatalog } = require('../services/bsiCatalogParsers');
const catalogs = require('../services/bsiCatalogService');

const FORMATS = ['auto', 'kompendium_xml', 'oscal_catalog'];
const ALLOWED_EXT = ['.xml', '.json'];

// Kataloge kommen als Datei (XML/JSON) in den Speicher, nicht auf die Platte:
// Sie werden geparst und als Zeilen gespeichert, die Datei selbst wird nicht
// aufbewahrt (nur ihr SHA-256 zur Nachvollziehbarkeit).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CATALOG_BYTES, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXT.includes(ext)) cb(null, true);
    else cb(new CatalogParseError(`Dateityp nicht erlaubt. Erlaubt: ${ALLOWED_EXT.join(', ')}`));
  },
});
const uploadSingle = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (!err) return next();
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Datei ist zu gross' : (err instanceof CatalogParseError ? err.message : 'Upload fehlgeschlagen');
  res.status(400).json({ error: msg });
});

const idParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

router.get('/', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    // Abgeloeste Anforderungen (nicht mehr im aktiven Katalog) nur auf Wunsch.
    const where = req.query.include_retired === '1' ? {} : { retired: false };
    const items = await BsiRequirement.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['layer', 'ASC'], ['baustein_id', 'ASC'], ['req_id', 'ASC']],
    });
    res.json(items);
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.post('/seed', authenticate, requirePermission('bsi_grundschutz','seed','admin','assessor'), async (req, res) => {
  try {
    const count = await BsiRequirement.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    // Der mitgelieferte Auszug ist ein Katalog wie jeder andere: anlegen (falls
    // die Startmigration es nicht schon getan hat) und aktivieren.
    await catalogs.ensureSeedCatalog();
    const seed = await BsiCatalog.findOne({ where: { format: 'seed' }, order: [['id', 'ASC']] });
    if (!seed) return res.status(409).json({ error: 'Es existiert bereits ein importierter Katalog. Bitte unter "Kataloge" aktivieren.' });
    const stats = seed.status === 'active' ? { created: 0 } : await catalogs.activateCatalog(seed.id, req.user.id);
    await auditFromReq(req, 'seed', 'bsi_requirement', null, 'BSI-Katalog', { catalog_id: seed.id, ...stats });
    res.status(201).json({ ok: true, count: stats.created, catalog_id: seed.id });
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

// ── Kataloge ─────────────────────────────────────────────────────────────────

router.get('/catalogs', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const items = await BsiCatalog.findAll({
      include: [
        { model: User, as: 'importedBy', attributes: ['id', 'name'] },
        { model: User, as: 'activatedBy', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
    });
    res.json(items);
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.get('/catalogs/:id', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const id = idParam(req.params.id);
    const catalog = id && await BsiCatalog.findByPk(id, {
      include: [{ model: BsiCatalogModule, as: 'modules' }],
      order: [[{ model: BsiCatalogModule, as: 'modules' }, 'sort_order', 'ASC']],
    });
    if (!catalog) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(catalog);
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.get('/catalogs/:id/requirements', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const id = idParam(req.params.id);
    if (!id) return res.status(404).json({ error: 'Nicht gefunden' });
    const where = { catalog_id: id };
    if (typeof req.query.module_id === 'string' && req.query.module_id) where.module_id = req.query.module_id.slice(0, 40);
    // Ohne Modulfilter ohne Volltext: ein ganzer Katalog sind sonst mehrere MB.
    const attributes = where.module_id ? undefined : { exclude: ['text', 'guidance'] };
    const items = await BsiCatalogRequirement.findAll({ where, attributes, order: [['sort_order', 'ASC']] });
    res.json(items);
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.get('/catalogs/:id/diff', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const id = idParam(req.params.id);
    const catalog = id && await BsiCatalog.findByPk(id);
    if (!catalog) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(await catalogs.diffAgainstActive(id));
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

async function importParsed(req, res, buffer, source, extra) {
  const format = FORMATS.includes(req.body?.format) ? req.body.format : 'auto';
  let parsed;
  try {
    parsed = parseCatalog(buffer, format);
  } catch (e) {
    if (e instanceof CatalogParseError) return res.status(422).json({ error: e.message });
    throw e;
  }
  const catalog = await catalogs.storeCatalog(parsed, {
    name: cleanText(req.body?.name, 255),
    edition: cleanText(req.body?.edition, 120),
    source,
    buffer,
    userId: req.user.id,
    ...extra,
  });
  await auditFromReq(req, 'import', 'bsi_catalog', catalog.id, catalog.name, {
    format: catalog.format, source, source_url: catalog.source_url, source_filename: catalog.source_filename,
    sha256: catalog.source_sha256, modules: catalog.module_count, requirements: catalog.requirement_count,
  });
  const diff = await catalogs.diffAgainstActive(catalog.id);
  res.status(201).json({ catalog, diff });
}

router.post('/catalogs/import', heavyLimiter, authenticate, requirePermission('bsi_grundschutz','manage_catalog','admin','assessor'), uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen (Feld "file")' });
    await importParsed(req, res, req.file.buffer, 'upload', { source_filename: path.basename(req.file.originalname).slice(0, 255) });
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.post('/catalogs/import-url', heavyLimiter, authenticate, requirePermission('bsi_grundschutz','manage_catalog','admin','assessor'), async (req, res) => {
  try {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url || url.length > 2048) return res.status(400).json({ error: 'URL fehlt oder ist zu lang' });
    let fetched;
    try {
      // SSRF-Schutz: nur oeffentliche Ziele, keine Weiterleitungen, Groessen- und Zeitlimit.
      fetched = await fetchPublicText(url, {
        maxBytes: MAX_CATALOG_BYTES, timeoutMs: 60_000,
        accept: 'application/json, application/xml, text/xml, */*', userAgent: 'OpenISMS-Catalog-Import/1.0',
      });
    } catch (e) {
      return res.status(422).json({ error: `Abruf fehlgeschlagen: ${String(e.message).slice(0, 200)}` });
    }
    await importParsed(req, res, Buffer.from(fetched.text, 'utf8'), 'url', { source_url: url });
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.post('/catalogs/:id/activate', authenticate, requirePermission('bsi_grundschutz','manage_catalog','admin','assessor'), async (req, res) => {
  try {
    const id = idParam(req.params.id);
    const catalog = id && await BsiCatalog.findByPk(id);
    if (!catalog) return res.status(404).json({ error: 'Nicht gefunden' });
    let stats;
    try {
      stats = await catalogs.activateCatalog(id, req.user.id);
    } catch (e) {
      if (e.status === 409 || e.status === 404) return res.status(e.status).json({ error: e.message });
      throw e;
    }
    await auditFromReq(req, 'activate', 'bsi_catalog', catalog.id, catalog.name, stats);
    res.json({ ok: true, ...stats });
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

// Nur Vorschau-Kataloge lassen sich verwerfen. Aktive und archivierte bleiben,
// sie sind Bezugspunkt des Umsetzungsstands bzw. frueherer Vergleiche.
router.delete('/catalogs/:id', authenticate, requirePermission('bsi_grundschutz','manage_catalog','admin','assessor'), async (req, res) => {
  try {
    const id = idParam(req.params.id);
    const catalog = id && await BsiCatalog.findByPk(id);
    if (!catalog) return res.status(404).json({ error: 'Nicht gefunden' });
    if (catalog.status !== 'preview') return res.status(409).json({ error: 'Nur Kataloge in der Vorschau koennen verworfen werden' });
    await auditFromReq(req, 'delete', 'bsi_catalog', catalog.id, catalog.name, { format: catalog.format, requirements: catalog.requirement_count });
    await catalog.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

// ── Anforderungen (Umsetzungsstand) ──────────────────────────────────────────

router.put('/:id', authenticate, requirePermission('bsi_grundschutz','edit','admin','assessor','it-staff'), async (req, res) => {
  try {
    const item = await BsiRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { implementation_status, responsible_id, notes, last_review_date } = req.body;
    await item.update({ implementation_status, responsible_id, notes, last_review_date });
    await auditFromReq(req, 'update', 'bsi_requirement', item.id, item.req_id, {});
    res.json(item);
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

router.delete('/:id', authenticate, requirePermission('bsi_grundschutz','delete','admin','assessor'), async (req, res) => {
  try {
    const item = await BsiRequirement.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'bsi_requirement', item.id, item.req_id, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'bsi-grundschutz'); }
});

module.exports = router;
