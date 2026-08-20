const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { authenticate, requirePermission } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { getProfiles, saveProfiles } = require('../services/triageProfiles');

// Read the analysis profiles (criteria catalog + reference baseline per doc type).
// Available to the roles that may run a triage so the run form can list them and
// admins can edit them.
router.get('/', authenticate, requirePermission('triage_profiles','view','admin','assessor','it-staff','dpo'), async (req, res) => {
  try {
    res.json(await getProfiles());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save profile overrides (admin only).
router.put('/', authenticate, requirePermission('triage_profiles','edit','admin'), async (req, res) => {
  try {
    const saved = await saveProfiles(req.body || {});
    await auditFromReq(req, 'update', 'settings', null, 'Vertragsanalyse-Profile', {
      profiles: Object.keys(saved),
    });
    res.json(saved);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
