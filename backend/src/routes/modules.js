const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { authenticate, requireRole } = require('../middleware/auth');
const { invalidateModulesCache, MODULE_DEFAULTS } = require('../middleware/modules');
const { setSetting, getSetting } = require('../services/settingsService');
const { auditFromReq } = require('../services/auditService');

const ALLOWED_KEYS = Object.keys(MODULE_DEFAULTS);

router.get('/', authenticate, async (req, res) => {
  try {
    const raw = await getSetting('modules');
    const stored = raw ? JSON.parse(raw) : {};
    res.json({ ...MODULE_DEFAULTS, ...stored });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const value = {};
    for (const k of ALLOWED_KEYS) value[k] = !!req.body[k];
    await setSetting('modules', value);
    invalidateModulesCache();
    await auditFromReq(req, 'update', 'settings', null, 'modules', { modules: value });
    res.json(value);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
