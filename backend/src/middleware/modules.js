const { Setting } = require('../models');

// Modul-Status wird pro Request gebraucht — kurzer In-Memory-Cache,
// damit nicht jeder API-Call die settings-Tabelle trifft.
const CACHE_TTL_MS = 30 * 1000;
let cache = null;
let cacheAt = 0;

const DEFAULTS = { dsgvo: true, tisax: false, dora: false, ai_act: false, bcm: false, pentest: false, discovery: true, iso27001: false, bsi_grundschutz: false, nis2: false, c5: false, mcp: true };

const getModules = async () => {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  const row = await Setting.findByPk('modules');
  let val = {};
  if (row && row.value) {
    if (typeof row.value === 'string') {
      try {
        val = JSON.parse(row.value);
        if (typeof val === 'string') val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    } else {
      val = row.value;
    }
  }
  cache = { ...DEFAULTS, ...val };
  cacheAt = now;
  return cache;
};

const invalidateModulesCache = () => { cache = null; };

const requireModule = (key) => async (req, res, next) => {
  try {
    const modules = await getModules();
    if (!modules[key]) return res.status(403).json({ error: `Modul '${key}' ist nicht aktiviert.` });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports = { requireModule, getModules, invalidateModulesCache, MODULE_DEFAULTS: DEFAULTS };
