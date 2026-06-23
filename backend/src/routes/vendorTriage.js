const router = require('express').Router({ mergeParams: true });
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { VendorTriageRun, VendorFinding, Vendor, Document, User } = require('../models');
const { authenticate, isItStaff, isDpo, isAdmin } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { runTriage } = require('../services/vendorTriageService');

// List triage runs for a vendor
router.get('/', authenticate, async (req, res) => {
  try {
    const { vendorId } = req.params;
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
router.get('/:runId', authenticate, async (req, res) => {
  try {
    const { vendorId, runId } = req.params;
    const run = await VendorTriageRun.findOne({
      where: { id: runId, vendor_id: vendorId },
      include: [
        { model: VendorFinding, as: 'findings', order: [['severity', 'ASC']] },
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
    });
    if (!run) return res.status(404).json({ error: 'Triage run not found' });
    res.json(run);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Start a triage run (async — responds immediately with the run record)
router.post('/', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req) && !isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { vendorId } = req.params;
    const { document_id, doc_type } = req.body;

    const vendor = await Vendor.findByPk(vendorId);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    if (!document_id) return res.status(400).json({ error: 'document_id is required' });

    const doc = await Document.findOne({ where: { id: document_id, vendor_id: vendorId } });
    if (!doc) return res.status(404).json({ error: 'Document not found for this vendor' });

    const validDocTypes = ['avv', 'tom', 'soc2', 'other'];
    const resolvedDocType = validDocTypes.includes(doc_type) ? doc_type : 'other';

    const run = await VendorTriageRun.create({
      vendor_id: vendorId,
      document_id: doc.id,
      doc_type: resolvedDocType,
      status: 'pending',
      triggered_by_id: req.user.id,
    });

    await auditFromReq(req, 'create', 'vendor', parseInt(vendorId), vendor.name, {
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

// Delete a triage run and its findings
router.delete('/:runId', authenticate, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { vendorId, runId } = req.params;
    const run = await VendorTriageRun.findOne({ where: { id: runId, vendor_id: vendorId } });
    if (!run) return res.status(404).json({ error: 'Not found' });
    await VendorFinding.destroy({ where: { triage_run_id: run.id } });
    await run.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
