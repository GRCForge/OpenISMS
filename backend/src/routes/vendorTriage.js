const router = require('express').Router({ mergeParams: true });
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { VendorTriageRun, VendorFinding, Vendor, Document, User } = require('../models');
const { authenticate, isItStaff, isDpo, isAdmin } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { runTriage } = require('../services/vendorTriageService');

// Contract findings/coverage are sensitive — restrict all triage endpoints to the
// same roles allowed to run an analysis.
const requireTriageAccess = (req, res, next) => {
  if (!isItStaff(req) && !isDpo(req) && !isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  next();
};
router.use(authenticate, requireTriageAccess);

// Every identifier that ends up in a Sequelize `where` clause is coerced to a
// positive integer first. Values taken straight from req.params/req.body may be
// objects or arrays (a JSON body can send `{"document_id": {"ne": 0}}`), and
// Sequelize interprets a nested object as an operator expression rather than an
// equality check — that turns a scoped lookup into an attacker-controlled query.
const parsePositiveInt = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// Resolves :vendorId (and :runId where present) once per request; rejects
// anything that is not a plain positive integer with 400.
const parseIds = (req, res) => {
  const vendorId = parsePositiveInt(req.params.vendorId);
  if (vendorId === null) {
    res.status(400).json({ error: 'Invalid vendor id' });
    return null;
  }
  if (req.params.runId === undefined) return { vendorId };
  const runId = parsePositiveInt(req.params.runId);
  if (runId === null) {
    res.status(400).json({ error: 'Invalid run id' });
    return null;
  }
  return { vendorId, runId };
};

// List triage runs for a vendor
router.get('/', async (req, res) => {
  try {
    const ids = parseIds(req, res);
    if (!ids) return;
    const { vendorId } = ids;
    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const runs = await VendorTriageRun.findAll({
      where: { vendor_id: vendorId },
      include: [
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
    });
    res.json(runs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get a single triage run with findings
router.get('/:runId', async (req, res) => {
  try {
    const ids = parseIds(req, res);
    if (!ids) return;
    const { vendorId, runId } = ids;
    const run = await VendorTriageRun.findOne({
      where: { id: runId, vendor_id: vendorId },
      include: [
        { model: VendorFinding, as: 'findings' },
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
      // Order the included findings by their sequential ref (VRM-001, VRM-002, …).
      order: [[{ model: VendorFinding, as: 'findings' }, 'id', 'ASC']],
    });
    if (!run) return res.status(404).json({ error: 'Triage run not found' });
    res.json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start a triage run (async — responds immediately with the run record)
router.post('/', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req) && !isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const ids = parseIds(req, res);
    if (!ids) return;
    const { vendorId } = ids;
    const { document_id, doc_type } = req.body;

    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const documentId = parsePositiveInt(document_id);
    if (documentId === null) return res.status(400).json({ error: 'document_id is required' });

    const doc = await Document.findOne({ where: { id: documentId, vendor_id: vendorId } });
    if (!doc) return res.status(404).json({ error: 'Document not found for this vendor' });

    const { getProfiles } = require('../services/triageProfiles');
    const profiles = await getProfiles();
    // doc_type indexes into the profile map — only accept a string key, so a
    // crafted body cannot reach the lookup with an object or array.
    const resolvedDocType = typeof doc_type === 'string' && Object.hasOwn(profiles, doc_type) ? doc_type : 'other';

    const run = await VendorTriageRun.create({
      vendor_id: vendorId,
      document_id: doc.id,
      doc_type: resolvedDocType,
      status: 'pending',
      triggered_by_id: req.user.id,
    });

    await auditFromReq(req, 'create', 'vendor', vendorId, vendor.name, {
      action: 'triage_started',
      run_id: run.id,
      document: doc.original_name,
    });

    // Run asynchronously — don't await, return immediately
    runTriage(run.id).catch(err => {
      console.error(`[Triage] Run ${run.id} failed:`, err.message);
    });

    res.status(202).json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-run an analysis (e.g. after an error or a config change) — creates a fresh run
// from the same document and doc type.
router.post('/:runId/retry', async (req, res) => {
  try {
    const ids = parseIds(req, res);
    if (!ids) return;
    const { vendorId, runId } = ids;
    const prev = await VendorTriageRun.findOne({ where: { id: runId, vendor_id: vendorId } });
    if (!prev) return res.status(404).json({ error: 'Triage run not found' });
    if (!prev.document_id) return res.status(400).json({ error: 'Original document is no longer available' });
    const doc = await Document.findOne({ where: { id: prev.document_id, vendor_id: vendorId } });
    if (!doc) return res.status(404).json({ error: 'Document not found for this vendor' });

    const run = await VendorTriageRun.create({
      vendor_id: vendorId,
      document_id: prev.document_id,
      doc_type: prev.doc_type,
      status: 'pending',
      triggered_by_id: req.user.id,
    });
    runTriage(run.id).catch(err => console.error(`[Triage] Retry run ${run.id} failed:`, err.message));
    res.status(202).json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a triage run and its findings
router.delete('/:runId', authenticate, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const ids = parseIds(req, res);
    if (!ids) return;
    const { vendorId, runId } = ids;
    const run = await VendorTriageRun.findOne({ where: { id: runId, vendor_id: vendorId } });
    if (!run) return res.status(404).json({ error: 'Not found' });
    await VendorFinding.destroy({ where: { triage_run_id: run.id } });
    await run.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
