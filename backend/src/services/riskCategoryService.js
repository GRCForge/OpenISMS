'use strict';

/**
 * Risk category taxonomy (models/RiskCategory.js).
 *
 * Until 3.6.0 risks.category was free text; the form offered nine fixed values,
 * the threat-intel handover wrote "Bedrohungslage", and imports or the MCP path
 * could write anything. Since 3.7.0 the categories are a maintained list:
 *
 *   - startup migration (idempotent): on the first run the nine former form
 *     values and "Bedrohungslage" become entries; on every run any value found
 *     in risks.category or in the appetite of a methodology version that has no
 *     entry yet becomes one (origin "migration"). Risks are not touched.
 *   - the key never changes - risks and immutable methodology versions store it;
 *     labels (de/en/es), description, order and active flag are editable
 *   - new risks (form, MCP) may only use active entries; a risk keeps an
 *     inactive category as long as it is not changed
 *   - an entry is only removed when no risk and no methodology version uses it
 */

const { Op } = require('sequelize');
const { httpError } = require('./riskMethodology');

const models = () => require('../models');

const LIMITS = { key: 100, label: 100, description: 1000 };
// Keys of new entries: lowercase letters, digits, underscore. Anchored, one
// character class with a bounded quantifier - linear (CodeQL js/polynomial-redos).
const KEY_RE = /^[a-z0-9_]{1,50}$/;

// Former form values (frontend risks.json "categories") plus the category the
// threat-intel handover writes. Same keys as before - existing risks keep theirs.
const THREAT_LANDSCAPE_KEY = 'Bedrohungslage';
const SEED = Object.freeze([
  { key: 'it_security', label_de: 'IT-Sicherheit', label_en: 'IT Security', label_es: 'Seguridad informática' },
  { key: 'privacy', label_de: 'Datenschutz', label_en: 'Privacy', label_es: 'Privacidad' },
  { key: 'compliance', label_de: 'Compliance', label_en: 'Compliance', label_es: 'Cumplimiento' },
  { key: 'operational', label_de: 'Operativ', label_en: 'Operational', label_es: 'Operativo' },
  { key: 'financial', label_de: 'Finanziell', label_en: 'Financial', label_es: 'Financiero' },
  { key: 'reputation', label_de: 'Reputation', label_en: 'Reputation', label_es: 'Reputación' },
  { key: 'ai_risk', label_de: 'KI-Risiko (AI Act)', label_en: 'AI Risk (AI Act)', label_es: 'Riesgo de IA (AI Act)' },
  { key: 'supply_chain', label_de: 'Lieferkette / Dienstleister', label_en: 'Supply Chain / Vendor', label_es: 'Cadena de suministro / proveedor' },
  { key: 'other', label_de: 'Sonstige', label_en: 'Other', label_es: 'Otros' },
  { key: THREAT_LANDSCAPE_KEY, label_de: 'Bedrohungslage', label_en: 'Threat landscape', label_es: 'Panorama de amenazas' },
]);

const plain = (row) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : row);

const text = (value, max, label, { required = false } = {}) => {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (required) throw httpError(400, `${label} fehlt.`);
    return null;
  }
  if (typeof value !== 'string') throw httpError(400, `${label} muss Text sein.`);
  const s = value.trim();
  if (s.length > max) throw httpError(400, `${label} ist länger als ${max} Zeichen.`);
  return s;
};

// Key from a label: lowercase, every run of other characters becomes one
// underscore, no underscore at either end. Character loop instead of a
// trimming regex on user input.
const slug = (label) => {
  const lower = String(label || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  let out = '';
  let pendingSep = false;
  for (const ch of lower) {
    const ok = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (ok) {
      if (pendingSep && out.length) out += '_';
      out += ch;
      pendingSep = false;
    } else {
      pendingSep = true;
    }
    if (out.length >= 50) break;
  }
  return out.slice(0, 50);
};

/**
 * Startup migration (idempotent). Returns counts for the startup log.
 */
const ensureCategories = async () => {
  const { RiskCategory, Risk, RiskMethodology, sequelize } = models();
  let seeded = 0;
  let migrated = 0;
  await sequelize.transaction(async (transaction) => {
    const count = await RiskCategory.count({ transaction });
    if (count === 0) {
      for (const [idx, s] of SEED.entries()) {
        await RiskCategory.create({ ...s, sort_order: (idx + 1) * 10, origin: 'seed' }, { transaction });
        seeded++;
      }
    }
    const known = new Set((await RiskCategory.findAll({ attributes: ['key'], raw: true, transaction })).map(r => r.key));
    const used = new Set();
    const rows = await Risk.findAll({ attributes: [[sequelize.fn('DISTINCT', sequelize.col('category')), 'category']], where: { category: { [Op.ne]: null } }, raw: true, transaction });
    rows.forEach(r => { if (typeof r.category === 'string' && r.category.trim() !== '') used.add(r.category); });
    const versions = await RiskMethodology.findAll({ attributes: ['appetite'], raw: true, transaction });
    versions.forEach(v => (v.appetite?.categories || []).forEach(c => { if (typeof c?.category === 'string' && c.category.trim() !== '') used.add(c.category); }));
    let sort = ((await RiskCategory.max('sort_order', { transaction })) || 0);
    for (const key of [...used].sort()) {
      if (known.has(key)) continue;
      const seed = SEED.find(s => s.key === key);
      const label = key.slice(0, LIMITS.label);
      sort += 10;
      await RiskCategory.create({
        key: key.slice(0, LIMITS.key),
        label_de: seed?.label_de || label,
        label_en: seed?.label_en || label,
        label_es: seed?.label_es || null,
        description: seed ? null : 'Aus dem bisherigen Freitextfeld übernommen.',
        sort_order: sort,
        origin: 'migration',
      }, { transaction });
      known.add(key);
      migrated++;
    }
  });
  return { seeded, migrated };
};

const list = async ({ includeInactive = true } = {}) => {
  const { RiskCategory, Risk, sequelize } = models();
  const where = includeInactive ? {} : { active: true };
  const rows = await RiskCategory.findAll({ where, order: [['sort_order', 'ASC'], ['key', 'ASC']] });
  const counts = await Risk.findAll({ attributes: ['category', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['category'], raw: true });
  const byKey = new Map(counts.map(c => [c.category, Number(c.n)]));
  return rows.map(r => ({ ...plain(r), risk_count: byKey.get(r.key) || 0 }));
};

const getByKey = async (key, opts = {}) => (typeof key === 'string' && key ? models().RiskCategory.findOne({ where: { key }, ...opts }) : null);

/**
 * Category of a risk write (form, MCP). null/'' clears it. A new or changed
 * value must be an active entry; an unchanged value may be inactive.
 */
const checkForRisk = async (value, existingValue) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw httpError(400, 'Ungültige Risikokategorie.');
  const entry = await getByKey(value);
  if (!entry) throw httpError(400, `Unbekannte Risikokategorie „${value.slice(0, 100)}“. Erlaubt sind die Einträge der Liste der Risikokategorien.`);
  if (!entry.active && value !== existingValue) throw httpError(400, `Die Risikokategorie „${entry.label_de}“ ist deaktiviert.`);
  return entry.key;
};

/**
 * Category from an import row: key or label (de/en/es, case-insensitive).
 * Unknown values are an error for that row - nothing is created implicitly.
 */
const resolveImportValue = async (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const s = String(value).trim();
  const rows = await models().RiskCategory.findAll({ where: { active: true } });
  const lower = s.toLowerCase();
  const hit = rows.find(r => r.key === s)
    || rows.find(r => [r.key, r.label_de, r.label_en, r.label_es].some(x => typeof x === 'string' && x.toLowerCase() === lower));
  if (!hit) throw new Error(`Unbekannte Risikokategorie "${s.slice(0, 100)}".`);
  return hit.key;
};

// Entry the threat-intel handover uses; recreated if someone removed it.
const ensureThreatLandscape = async () => {
  const { RiskCategory } = models();
  const seed = SEED.find(s => s.key === THREAT_LANDSCAPE_KEY);
  const [row] = await RiskCategory.findOrCreate({ where: { key: THREAT_LANDSCAPE_KEY }, defaults: { ...seed, sort_order: 1000, origin: 'seed' } });
  if (!row.active) await row.update({ active: true });
  return row.key;
};

const fields = (body, { partial }) => {
  const src = body && typeof body === 'object' ? body : {};
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  const out = {};
  if (!partial || has('label_de')) out.label_de = text(src.label_de, LIMITS.label, 'Bezeichnung (de)', { required: true });
  if (!partial || has('label_en')) out.label_en = text(src.label_en, LIMITS.label, 'Bezeichnung (en)', { required: true });
  if (!partial || has('label_es')) out.label_es = text(src.label_es, LIMITS.label, 'Bezeichnung (es)');
  if (!partial || has('description')) out.description = text(src.description, LIMITS.description, 'Beschreibung');
  if (has('active')) {
    if (typeof src.active !== 'boolean') throw httpError(400, 'active muss true oder false sein.');
    out.active = src.active;
  }
  if (has('sort_order')) {
    const n = Number(src.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, 'Reihenfolge: ganze Zahl 0 bis 100000.');
    out.sort_order = n;
  }
  return out;
};

const create = async (body) => {
  const { RiskCategory } = models();
  const f = fields(body, { partial: false });
  let key = body?.key === undefined || body?.key === null || body?.key === '' ? slug(f.label_en || f.label_de) : body.key;
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw httpError(400, 'Schlüssel: 1 bis 50 Zeichen a-z, 0-9 und _.');
  if (await getByKey(key)) throw httpError(409, `Der Schlüssel „${key}“ ist bereits vergeben.`);
  if (f.sort_order === undefined) f.sort_order = ((await RiskCategory.max('sort_order')) || 0) + 10;
  const row = await RiskCategory.create({ ...f, key, active: f.active ?? true, origin: 'manual' });
  return plain(row);
};

const update = async (row, body) => {
  if (body && Object.prototype.hasOwnProperty.call(body, 'key') && body.key !== row.key) {
    throw httpError(400, 'Der Schlüssel einer Risikokategorie ist unveränderlich (Risiken und Methodik-Versionen verweisen darauf). Nur die Bezeichnungen ändern.');
  }
  const before = plain(row);
  const f = fields(body, { partial: true });
  await row.update(f);
  return { before, after: plain(row) };
};

// Removal only when nothing refers to the key; otherwise deactivate.
const usage = async (key) => {
  const { Risk, RiskMethodology } = models();
  const risks = await Risk.count({ where: { category: key } });
  const versions = (await RiskMethodology.findAll({ attributes: ['version', 'appetite'], raw: true }))
    .filter(v => (v.appetite?.categories || []).some(c => c?.category === key))
    .map(v => v.version);
  return { risks, methodology_versions: versions };
};

const remove = async (row) => {
  const u = await usage(row.key);
  if (u.risks > 0 || u.methodology_versions.length > 0) {
    throw httpError(409, `Die Risikokategorie wird noch verwendet (${u.risks} Risiko/Risiken, Methodik-Version(en): ${u.methodology_versions.join(', ') || '–'}). Stattdessen deaktivieren.`);
  }
  const before = plain(row);
  await row.destroy();
  return before;
};

module.exports = {
  SEED, KEY_RE, THREAT_LANDSCAPE_KEY, slug,
  ensureCategories, list, getByKey, checkForRisk, resolveImportValue, ensureThreatLandscape, create, update, usage, remove,
};
