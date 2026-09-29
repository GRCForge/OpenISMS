const { Setting } = require('../models');

// Modul-Status wird pro Request gebraucht — kurzer In-Memory-Cache,
// damit nicht jeder API-Call die settings-Tabelle trifft.
const CACHE_TTL_MS = 30 * 1000;
let cache = null;
let cacheAt = 0;

// threat_intel ist standardmaessig an: Die Beobachtung der Bedrohungslage ist
// keine Sonderdisziplin eines einzelnen Regelwerks, sondern steht sowohl in
// NIS-2 Art. 21(2)(a) als auch in ISO 27001:2022 A.5.7 — ein ISMS ohne sie ist
// unvollstaendig, gleich nach welchem Standard es gefuehrt wird. Nach aussen
// telefoniert deshalb trotzdem nichts: Der Feed-Abruf haengt an auto_fetch, das
// je Quelle einzeln eingeschaltet wird.
const DEFAULTS = { dsgvo: true, tisax: false, dora: false, ai_act: false, bcm: false, pentest: false, discovery: true, iso27001: false, bsi_grundschutz: false, nis2: false, c5: false, mcp: true, threat_intel: true };

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
