const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { invalidateModulesCache, MODULE_DEFAULTS } = require('../middleware/modules');
const { setSetting, getSetting } = require('../services/settingsService');
const { auditFromReq } = require('../services/auditService');

const ALLOWED_KEYS = Object.keys(MODULE_DEFAULTS);

router.get('/', authenticate, requirePermission('modules','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const raw = await getSetting('modules');
    const stored = raw ? JSON.parse(raw) : {};
    res.json({ ...MODULE_DEFAULTS, ...stored });
  } catch (e) { serverError(res, e, 'modules'); }
});

router.put('/', authenticate, requirePermission('modules','edit','admin'), async (req, res) => {
  try {
    const value = {};
    for (const k of ALLOWED_KEYS) value[k] = !!req.body[k];
    await setSetting('modules', value);
    invalidateModulesCache();
    await auditFromReq(req, 'update', 'settings', null, 'modules', { modules: value });
    res.json(value);
  } catch (e) { serverError(res, e, 'modules'); }
});

module.exports = router;
