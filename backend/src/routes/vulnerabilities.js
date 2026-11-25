const express = require('express');
const { Vulnerability } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError, requestError } = require('../utils/httpError');
const vulns = require('../services/vulnerabilityService');

// Vulnerability register (ISO 27005:2022 8.2.4). Rules live in
// services/vulnerabilityService.js - the MCP tools use the same functions.
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

const parseId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const str = (v) => (typeof v === 'string' ? v : undefined);

router.get('/', authenticate, requirePermission('vulnerabilities', 'view', 'admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management'), async (req, res) => {
  try {
    res.json(await vulns.listVulnerabilities({
      status: str(req.query.status), source: str(req.query.source), severity: str(req.query.severity),
      asset_id: str(req.query.asset_id), search: str(req.query.search),
    }));
  } catch (e) { requestError(res, e, 'vulnerabilities'); }
});

// CVE data of an asset with the vulnerability each CVE is registered as -
// the selection list for taking CVEs over. Before '/:id'.
router.get('/asset-cves/:assetId', authenticate, requirePermission('vulnerabilities', 'manage', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parseId(req.params.assetId);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const out = await vulns.assetCves(id);
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  } catch (e) { serverError(res, e, 'vulnerabilities'); }
});

// Take over selected CVEs of an asset (by click, never automatically).
router.post('/from-asset-cves', authenticate, requirePermission('vulnerabilities', 'manage', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    res.status(201).json(await vulns.importAssetCves(req.body?.asset_id, req.body?.cve_ids, req.user, req));
  } catch (e) { requestError(res, e, 'vulnerabilities'); }
});

router.get('/:id', authenticate, requirePermission('vulnerabilities', 'view', 'admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const out = await vulns.getVulnerability(id, req.user);
    if (!out) return res.status(404).json({ error: 'Not found' });
    res.json(out);
  } catch (e) { serverError(res, e, 'vulnerabilities'); }
});

router.post('/', authenticate, requirePermission('vulnerabilities', 'manage', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    res.status(201).json(await vulns.createVulnerability(req.body || {}, req.user, req));
  } catch (e) { requestError(res, e, 'vulnerabilities'); }
});

router.put('/:id', authenticate, requirePermission('vulnerabilities', 'manage', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const v = await Vulnerability.findByPk(id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    res.json(await vulns.updateVulnerability(v, req.body || {}, req));
  } catch (e) { requestError(res, e, 'vulnerabilities'); }
});

router.delete('/:id', authenticate, requirePermission('vulnerabilities', 'delete', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungültige Kennung.' });
    const v = await Vulnerability.findByPk(id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    await vulns.deleteVulnerability(v, req);
    res.json({ message: 'Vulnerability deleted' });
  } catch (e) { requestError(res, e, 'vulnerabilities'); }
});

module.exports = router;
