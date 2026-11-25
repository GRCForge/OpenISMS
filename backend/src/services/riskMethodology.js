'use strict';

/**
 * Risikomethodik (ISO 27005 Kap. 6/7, ISO 31000 6.3.4, ISO 27001 6.1.2 a).
 *
 * Eine Methodik legt fest, WIE bewertet wird:
 *   - Skalen fuer Wahrscheinlichkeit und Auswirkung (je 3 bis 6 Stufen) mit
 *     Bezeichnung (de/en), Kriterium und optionalem Zahlenbereich
 *   - Risikostufen low/medium/high/critical mit Farbe und Schwellen auf dem
 *     Score (Wahrscheinlichkeit x Auswirkung), lueckenlos und ohne Ueberschneidung
 *   - Risikoappetit: je Risikokategorie die hoechste tolerierte Stufe
 *   - Akzeptanzbefugnis: je Stufe die Rollen, die akzeptieren duerfen, und die
 *     laengste Gueltigkeit einer Akzeptanz in Monaten
 *
 * Versionen sind unveraenderlich (models/RiskMethodology.js). Genau eine ist
 * aktiv; jede Aenderung legt eine neue an. Risiken haengen an der Version, nach
 * der sie bewertet wurden, und werden nie still umgerechnet.
 *
 * Die Risikostufen sind bewusst auf die vier bestehenden Schluessel festgelegt:
 * Sie stehen als ENUM in risks.inherent_level/residual_level, in Filtern,
 * Berichten, Dashboards und Automationen. Bezeichnung, Farbe und Schwellen sind
 * frei - die Bedeutung der Schluessel (aufsteigend) bleibt.
 */

const LEVEL_KEYS = ['low', 'medium', 'high', 'critical'];
const ROLES = ['admin', 'assessor', 'owner', 'it-staff', 'dpo', 'management', 'viewer', 'employee'];
const MIN_SIZE = 3;
const MAX_SIZE = 6;
const MAX_MONTHS = 120;
const MAX_APPETITE_CATEGORIES = 50;
const LIMITS = { name: 150, unit: 60, label: 80, description: 500, category: 100, note: 1000 };
// Anker an beiden Enden, feste Laenge: kein Backtracking (CodeQL js/polynomial-redos).
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Standardprofil = exakt die Skala bis v3.5.1 (services/riskScale.js):
// 5x5, Labels wie dort, Schwellen 1-4 / 5-9 / 10-14 / 15-25. Kein Appetit
// (nichts wird markiert), Akzeptanz wie bisher durch admin, assessor und owner
// ohne Hoechstdauer. Eine Installation verhaelt sich nach dem Upgrade also
// genauso wie vorher, bis jemand die Methodik bewusst aendert.
const lvl = (value, label_de, label_en) => ({ value, label_de, label_en, description: null, range_min: null, range_max: null });
const DEFAULT_PROFILE = Object.freeze({
  name: 'Standard 5×5 (ISO 27005)',
  likelihood_unit: null,
  impact_unit: null,
  likelihood_levels: [
    lvl(1, 'Selten', 'Rare'),
    lvl(2, 'Unwahrscheinlich', 'Unlikely'),
    lvl(3, 'Möglich', 'Possible'),
    lvl(4, 'Wahrscheinlich', 'Likely'),
    lvl(5, 'Fast sicher', 'Almost certain'),
  ],
  impact_levels: [
    lvl(1, 'Vernachlässigbar', 'Negligible'),
    lvl(2, 'Gering', 'Minor'),
    lvl(3, 'Spürbar', 'Moderate'),
    lvl(4, 'Kritisch', 'Critical'),
    lvl(5, 'Existenzbedrohend', 'Existential'),
  ],
  risk_levels: [
    { key: 'low', label_de: 'Niedrig', label_en: 'Low', color: '#16a34a', min_score: 1, max_score: 4 },
    { key: 'medium', label_de: 'Mittel', label_en: 'Medium', color: '#eab308', min_score: 5, max_score: 9 },
    { key: 'high', label_de: 'Hoch', label_en: 'High', color: '#f97316', min_score: 10, max_score: 14 },
    { key: 'critical', label_de: 'Kritisch', label_en: 'Critical', color: '#dc2626', min_score: 15, max_score: 25 },
  ],
  appetite: { default_max_level: null, categories: [] },
  acceptance: LEVEL_KEYS.map(level => ({ level, roles: ['admin', 'assessor', 'owner'], max_months: null })),
  // No impact dimensions: impact is a single overall value, as up to 3.6.0.
  impact_dimensions: [],
});

// Impact dimensions (ISO 27005:2022 7.2 / 8.3.3, BSI 200-3 damage scenarios).
// The keys are a fixed catalogue; a methodology version decides which of them
// apply and may rename them. The overall impact of a risk is the maximum of the
// rated dimensions (maximum principle, BSI 200-2 8.2.1).
const DIMENSION_CATALOG = Object.freeze([
  { key: 'confidentiality', label_de: 'Vertraulichkeit', label_en: 'Confidentiality' },
  { key: 'integrity', label_de: 'Integrität', label_en: 'Integrity' },
  { key: 'availability', label_de: 'Verfügbarkeit', label_en: 'Availability' },
  { key: 'financial', label_de: 'Finanziell', label_en: 'Financial' },
  { key: 'legal', label_de: 'Rechtlich/regulatorisch', label_en: 'Legal/regulatory' },
  { key: 'reputation', label_de: 'Reputation', label_en: 'Reputation' },
  { key: 'operational', label_de: 'Operativ', label_en: 'Operational' },
]);
const DIMENSION_KEYS = DIMENSION_CATALOG.map(d => d.key);

const CONTENT_FIELDS = ['name', 'likelihood_unit', 'impact_unit', 'likelihood_levels', 'impact_levels', 'risk_levels', 'appetite', 'acceptance', 'impact_dimensions'];

// Versions created before 3.7.0 have no impact_dimensions (NULL) - same as none.
const dimensionsOf = (profile) => (profile && Array.isArray(profile.impact_dimensions) ? profile.impact_dimensions : []);

const httpError = (status, message, extra) => Object.assign(new Error(message), { status }, extra ? { extra } : {});
const rank = (key) => LEVEL_KEYS.indexOf(key);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── Validierung ──────────────────────────────────────────────────────────────
//
// Die Eingabe wird nie als Ganzes uebernommen: Jedes Feld wird aus einer festen
// Liste gelesen und neu aufgebaut. Kein Schluessel aus dem Request landet als
// Objekt-Schluessel im Ergebnis (CodeQL js/remote-property-injection) -
// Kategorien und Stufen stehen deshalb in Arrays, nicht in Objekten.

const validateProfile = (input) => {
  const errors = [];
  const warnings = [];
  const src = isObj(input) ? input : {};
  const err = (field, message) => errors.push({ field, message });

  const text = (value, max, field, required, label) => {
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (required) err(field, `${label} fehlt.`);
      return null;
    }
    if (typeof value !== 'string' && typeof value !== 'number') { err(field, `${label} muss Text sein.`); return null; }
    const s = String(value).trim();
    if (s.length > max) { err(field, `${label} ist länger als ${max} Zeichen.`); return s.slice(0, max); }
    return s;
  };
  const num = (value, field, label) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n)) { err(field, `${label} muss eine Zahl sein.`); return null; }
    return n;
  };
  const int = (value, field, label) => {
    const n = Number(value);
    if (value === undefined || value === null || value === '' || !Number.isInteger(n)) { err(field, `${label} muss eine ganze Zahl sein.`); return null; }
    return n;
  };

  const name = text(src.name, LIMITS.name, 'name', true, 'Name der Methodik');
  const likelihood_unit = text(src.likelihood_unit, LIMITS.unit, 'likelihood_unit', false, 'Einheit der Wahrscheinlichkeit');
  const impact_unit = text(src.impact_unit, LIMITS.unit, 'impact_unit', false, 'Einheit der Auswirkung');

  const axis = (key, label) => {
    const arr = src[key];
    if (!Array.isArray(arr)) { err(key, `${label}: Stufen fehlen.`); return []; }
    if (arr.length < MIN_SIZE || arr.length > MAX_SIZE) err(key, `${label}: ${MIN_SIZE} bis ${MAX_SIZE} Stufen erforderlich (angegeben: ${arr.length}).`);
    return arr.slice(0, MAX_SIZE).map((raw, idx) => {
      const o = isObj(raw) ? raw : {};
      const f = `${key}[${idx}]`;
      const stufe = `${label} Stufe ${idx + 1}`;
      const range_min = num(o.range_min, `${f}.range_min`, `${stufe}: Bereich von`);
      const range_max = num(o.range_max, `${f}.range_max`, `${stufe}: Bereich bis`);
      if (range_min !== null && range_max !== null && range_min > range_max) err(`${f}.range_min`, `${stufe}: Bereich „von“ ist größer als „bis“.`);
      return {
        // Der Wert ist die Position - der Client bestimmt ihn nicht.
        value: idx + 1,
        label_de: text(o.label_de, LIMITS.label, `${f}.label_de`, true, `${stufe}: Bezeichnung (de)`),
        label_en: text(o.label_en, LIMITS.label, `${f}.label_en`, true, `${stufe}: Bezeichnung (en)`),
        description: text(o.description, LIMITS.description, `${f}.description`, false, `${stufe}: Kriterium`),
        range_min,
        range_max,
      };
    });
  };
  const likelihood_levels = axis('likelihood_levels', 'Wahrscheinlichkeit');
  const impact_levels = axis('impact_levels', 'Auswirkung');
  const maxScore = likelihood_levels.length * impact_levels.length;

  // Risikostufen: alle vier Schluessel genau einmal, aufsteigend, lueckenlos.
  const rawLevels = Array.isArray(src.risk_levels) ? src.risk_levels.filter(isObj) : [];
  if (!Array.isArray(src.risk_levels)) err('risk_levels', 'Risikostufen fehlen.');
  const risk_levels = [];
  for (const key of LEVEL_KEYS) {
    const hits = rawLevels.filter(r => r.key === key);
    if (hits.length === 0) { err('risk_levels', `Risikostufe „${key}“ fehlt.`); continue; }
    if (hits.length > 1) err('risk_levels', `Risikostufe „${key}“ ist mehrfach angegeben.`);
    const o = hits[0];
    const f = `risk_levels.${key}`;
    const color = typeof o.color === 'string' ? o.color.trim() : '';
    if (!COLOR_RE.test(color)) err(`${f}.color`, `Risikostufe „${key}“: Farbe als #RRGGBB angeben.`);
    risk_levels.push({
      key,
      label_de: text(o.label_de, LIMITS.label, `${f}.label_de`, true, `Risikostufe „${key}“: Bezeichnung (de)`),
      label_en: text(o.label_en, LIMITS.label, `${f}.label_en`, true, `Risikostufe „${key}“: Bezeichnung (en)`),
      color: COLOR_RE.test(color) ? color.toLowerCase() : '#6b7280',
      min_score: int(o.min_score, `${f}.min_score`, `Risikostufe „${key}“: Schwelle von`),
      max_score: int(o.max_score, `${f}.max_score`, `Risikostufe „${key}“: Schwelle bis`),
    });
  }
  const unknown = rawLevels.filter(r => !LEVEL_KEYS.includes(r.key));
  if (unknown.length) err('risk_levels', `Nur die Risikostufen ${LEVEL_KEYS.join(', ')} sind möglich.`);
  if (risk_levels.length === LEVEL_KEYS.length && risk_levels.every(r => r.min_score !== null && r.max_score !== null) && maxScore > 0) {
    risk_levels.forEach((r, i) => {
      if (r.min_score > r.max_score) err(`risk_levels.${r.key}.min_score`, `Risikostufe „${r.key}“: Schwelle „von“ (${r.min_score}) liegt über „bis“ (${r.max_score}).`);
      if (i === 0 && r.min_score !== 1) err(`risk_levels.${r.key}.min_score`, `Die niedrigste Stufe muss bei Score 1 beginnen (angegeben: ${r.min_score}).`);
      if (i > 0) {
        const prev = risk_levels[i - 1];
        if (r.min_score > prev.max_score + 1) err(`risk_levels.${r.key}.min_score`, `Lücke zwischen „${prev.key}“ (bis ${prev.max_score}) und „${r.key}“ (ab ${r.min_score}).`);
        if (r.min_score <= prev.max_score) err(`risk_levels.${r.key}.min_score`, `Überschneidung zwischen „${prev.key}“ (bis ${prev.max_score}) und „${r.key}“ (ab ${r.min_score}).`);
      }
    });
    const last = risk_levels[risk_levels.length - 1];
    if (last.max_score !== maxScore) err(`risk_levels.${last.key}.max_score`, `Die höchste Stufe muss bis zum höchsten Score ${maxScore} (${likelihood_levels.length}×${impact_levels.length}) reichen (angegeben: ${last.max_score}).`);
    // Nicht jeder Score ist als Produkt erreichbar (bei 5x5 etwa 7, 11, 13).
    // Eine Stufe ohne erreichbaren Score ist zulaessig, aber vermutlich ein Versehen.
    const reachable = new Set();
    for (let l = 1; l <= likelihood_levels.length; l++) for (let i = 1; i <= impact_levels.length; i++) reachable.add(l * i);
    for (const r of risk_levels) {
      let hit = false;
      for (let s = r.min_score; s <= r.max_score && !hit; s++) hit = reachable.has(s);
      if (!hit) warnings.push({ field: `risk_levels.${r.key}`, message: `Risikostufe „${r.key}“ (${r.min_score}–${r.max_score}) enthält keinen erreichbaren Score.` });
    }
  }

  // Risikoappetit
  const ap = isObj(src.appetite) ? src.appetite : {};
  let default_max_level = null;
  if (ap.default_max_level !== undefined && ap.default_max_level !== null && ap.default_max_level !== '') {
    if (LEVEL_KEYS.includes(ap.default_max_level)) default_max_level = ap.default_max_level;
    else err('appetite.default_max_level', 'Appetit (Standard): unbekannte Risikostufe.');
  }
  const categories = [];
  const rawCats = Array.isArray(ap.categories) ? ap.categories : [];
  if (rawCats.length > MAX_APPETITE_CATEGORIES) err('appetite.categories', `Höchstens ${MAX_APPETITE_CATEGORIES} Kategorien.`);
  rawCats.slice(0, MAX_APPETITE_CATEGORIES).forEach((raw, idx) => {
    const o = isObj(raw) ? raw : {};
    const f = `appetite.categories[${idx}]`;
    const category = text(o.category, LIMITS.category, `${f}.category`, true, `Appetit Zeile ${idx + 1}: Kategorie`);
    if (!LEVEL_KEYS.includes(o.max_level)) err(`${f}.max_level`, `Appetit Zeile ${idx + 1}: unbekannte Risikostufe.`);
    if (category && categories.some(c => c.category === category)) err(`${f}.category`, `Appetit: Kategorie „${category}“ ist doppelt.`);
    if (category && LEVEL_KEYS.includes(o.max_level)) categories.push({ category, max_level: o.max_level });
  });

  // Akzeptanzbefugnis
  const rawAcc = Array.isArray(src.acceptance) ? src.acceptance.filter(isObj) : [];
  if (!Array.isArray(src.acceptance)) err('acceptance', 'Akzeptanzbefugnis fehlt.');
  const acceptance = [];
  for (const level of LEVEL_KEYS) {
    const o = rawAcc.find(a => a.level === level);
    const f = `acceptance.${level}`;
    if (!o) { err(f, `Akzeptanzbefugnis für „${level}“ fehlt.`); continue; }
    const rawRoles = Array.isArray(o.roles) ? o.roles : [];
    const bad = rawRoles.filter(r => !ROLES.includes(r));
    if (bad.length) err(`${f}.roles`, `Akzeptanz „${level}“: unbekannte Rolle(n).`);
    // Reihenfolge aus der festen Rollenliste, Dubletten fallen dabei weg.
    const roles = ROLES.filter(r => rawRoles.includes(r));
    if (roles.length === 0) err(`${f}.roles`, `Akzeptanz „${level}“: mindestens eine Rolle angeben.`);
    let max_months = null;
    if (o.max_months !== undefined && o.max_months !== null && o.max_months !== '') {
      const n = Number(o.max_months);
      if (!Number.isInteger(n) || n < 1 || n > MAX_MONTHS) err(`${f}.max_months`, `Akzeptanz „${level}“: Gültigkeit 1 bis ${MAX_MONTHS} Monate oder leer.`);
      else max_months = n;
    }
    acceptance.push({ level, roles, max_months });
  }

  // Impact dimensions: keys only from the fixed catalogue, order of the
  // catalogue, labels default to the catalogue labels.
  const impact_dimensions = [];
  if (src.impact_dimensions !== undefined && src.impact_dimensions !== null) {
    if (!Array.isArray(src.impact_dimensions)) {
      err('impact_dimensions', 'Auswirkungsdimensionen müssen eine Liste sein.');
    } else {
      const rawDims = src.impact_dimensions.filter(isObj);
      if (rawDims.length !== src.impact_dimensions.length) err('impact_dimensions', 'Auswirkungsdimensionen: ungültiger Eintrag.');
      const unknownDims = rawDims.filter(d => !DIMENSION_KEYS.includes(d.key));
      if (unknownDims.length) err('impact_dimensions', `Nur die Dimensionen ${DIMENSION_KEYS.join(', ')} sind möglich.`);
      for (const cat of DIMENSION_CATALOG) {
        const hits = rawDims.filter(d => d.key === cat.key);
        if (hits.length === 0) continue;
        if (hits.length > 1) err('impact_dimensions', `Dimension „${cat.key}“ ist mehrfach angegeben.`);
        const o = hits[0];
        const f = `impact_dimensions.${cat.key}`;
        impact_dimensions.push({
          key: cat.key,
          label_de: text(o.label_de, LIMITS.label, `${f}.label_de`, false, `Dimension „${cat.key}“: Bezeichnung (de)`) || cat.label_de,
          label_en: text(o.label_en, LIMITS.label, `${f}.label_en`, false, `Dimension „${cat.key}“: Bezeichnung (en)`) || cat.label_en,
          description: text(o.description, LIMITS.description, `${f}.description`, false, `Dimension „${cat.key}“: Kriterium`),
        });
      }
    }
  }

  return {
    profile: { name, likelihood_unit, impact_unit, likelihood_levels, impact_levels, risk_levels, appetite: { default_max_level, categories }, acceptance, impact_dimensions },
    errors,
    warnings,
  };
};

// ── Berechnung ───────────────────────────────────────────────────────────────

const sizes = (p) => ({ likelihood: p.likelihood_levels.length, impact: p.impact_levels.length });

// Score = Wahrscheinlichkeit x Auswirkung -> erste Stufe, deren Obergrenze den
// Score enthaelt. Ueber der hoechsten Grenze bleibt es die hoechste Stufe (wie
// bisher "alles ab 15 ist critical").
const computeLevel = (likelihood, impact, profile = DEFAULT_PROFILE) => {
  const s = (Number(likelihood) || 0) * (Number(impact) || 0);
  if (s <= 0) return null;
  const levels = profile.risk_levels;
  for (const r of levels) if (s <= r.max_score) return r.key;
  return levels[levels.length - 1].key;
};

const levelMeta = (profile, key) => profile.risk_levels.find(r => r.key === key) || null;

const buildMatrix = (profile) => {
  const { likelihood: L, impact: I } = sizes(profile);
  const rows = [];
  for (let l = L; l >= 1; l--) {
    const row = [];
    for (let i = 1; i <= I; i++) row.push({ likelihood: l, impact: i, score: l * i, level: computeLevel(l, i, profile) });
    rows.push(row);
  }
  return rows;
};

const plain = (row) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : row);

// Antwort fuer /api/risks/scale. Die Felder size/likelihood/impact/thresholds/
// matrix gab es schon bis 3.5.1 und bleiben fuer bestehende Clients erhalten.
const scaleInfo = (profileRow = DEFAULT_PROFILE) => {
  const p = plain(profileRow);
  const { likelihood: L, impact: I } = sizes(p);
  return {
    id: p.id ?? null,
    version: p.version ?? null,
    name: p.name,
    status: p.status ?? 'active',
    change_note: p.change_note ?? null,
    activated_at: p.activated_at ?? null,
    created_at: p.created_at ?? null,
    created_by: p.createdBy ? { id: p.createdBy.id, name: p.createdBy.name } : null,
    size: Math.max(L, I),
    likelihood_size: L,
    impact_size: I,
    max_score: L * I,
    likelihood: [null, ...p.likelihood_levels.map(x => x.label_de)],
    impact: [null, ...p.impact_levels.map(x => x.label_de)],
    likelihood_unit: p.likelihood_unit ?? null,
    impact_unit: p.impact_unit ?? null,
    likelihood_levels: p.likelihood_levels,
    impact_levels: p.impact_levels,
    risk_levels: p.risk_levels,
    thresholds: Object.fromEntries(p.risk_levels.map(r => [r.key, `${r.min_score}–${r.max_score}`])),
    matrix: buildMatrix(p),
    appetite: p.appetite,
    acceptance: p.acceptance,
    impact_dimensions: dimensionsOf(p),
  };
};

// Stabile Serialisierung, um "keine Aenderung" zu erkennen (JSONB sortiert Schluessel um).
const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
};
const contentOf = (p, f) => (f === 'impact_dimensions' ? dimensionsOf(p) : (p[f] ?? null));
const sameContent = (a, b) => CONTENT_FIELDS.every(f => stable(contentOf(a, f)) === stable(contentOf(b, f)));

// ── Datenbank ────────────────────────────────────────────────────────────────

const models = () => require('../models');

// Versionen sind unveraenderlich, ihr Cache gilt also unbegrenzt. Nur der Zeiger
// auf die aktive Version altert (30 s, wie die Berechtigungsmatrix) - fuer den
// Fall mehrerer Instanzen; in derselben Instanz wird er beim Speichern geleert.
const byId = new Map();
let activeId = null;
let activeAt = 0;
let baselineId = null;
const ACTIVE_TTL_MS = 30 * 1000;

const invalidate = () => { activeId = null; activeAt = 0; baselineId = null; };
const remember = (row) => { const p = plain(row); if (p && p.id) byId.set(p.id, p); return p; };

const getProfile = async (id, { transaction } = {}) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  if (byId.has(n)) return byId.get(n);
  const row = await models().RiskMethodology.findByPk(n, { transaction, include: [{ model: models().User, as: 'createdBy', attributes: ['id', 'name'] }] });
  return row ? remember(row) : null;
};

const getActiveProfile = async ({ transaction, fresh } = {}) => {
  if (!fresh && !transaction && activeId && Date.now() - activeAt < ACTIVE_TTL_MS && byId.has(activeId)) return byId.get(activeId);
  const row = await models().RiskMethodology.findOne({ where: { status: 'active' }, transaction, include: [{ model: models().User, as: 'createdBy', attributes: ['id', 'name'] }] });
  if (!row) return null;
  const p = remember(row);
  if (!transaction) { activeId = p.id; activeAt = Date.now(); }
  return p;
};

// Erste Version = Standardprofil aus der Migration. Risiken ohne Version
// stammen aus der Zeit davor (oder aus einer Sicherung von davor) und sind nach
// genau dieser Skala bewertet.
const getBaselineProfile = async ({ transaction } = {}) => {
  if (baselineId && byId.has(baselineId)) return byId.get(baselineId);
  const row = await models().RiskMethodology.findOne({ order: [['version', 'ASC']], transaction });
  if (!row) return null;
  const p = remember(row);
  baselineId = p.id;
  return p;
};

const profileForRisk = async (risk, opts) => {
  const id = risk.methodology_id;
  const p = id ? await getProfile(id, opts) : await getBaselineProfile(opts);
  return p || DEFAULT_PROFILE;
};

/**
 * Startmigration (idempotent): Standardprofil als Version 1 anlegen, wenn es
 * noch keine Methodik gibt, und Risiken ohne Version ihr zuordnen. Es wird nur
 * methodology_id gesetzt - ohne Hooks und ohne updated_at, Werte und Stufen
 * bleiben exakt, wie sie sind.
 */
const ensureDefaultProfile = async () => {
  const { RiskMethodology, Risk, sequelize } = models();
  // Genau eine aktive Version - auch an der Anwendung vorbei.
  await sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_methodologies_active ON risk_methodologies (status) WHERE status = 'active'");
  let created = false;
  let reactivated = false;
  let active = await RiskMethodology.findOne({ where: { status: 'active' } });
  if (!active) {
    const newest = await RiskMethodology.findOne({ order: [['version', 'DESC']] });
    if (newest) {
      // Darf nicht vorkommen (der Index verhindert zwei, nicht keine). Die
      // juengste Version wieder aktiv setzen statt ein zweites Standardprofil anzulegen.
      await newest.update({ status: 'active', superseded_at: null });
      active = newest;
      reactivated = true;
    } else {
      active = await RiskMethodology.create({
        ...JSON.parse(JSON.stringify(DEFAULT_PROFILE)),
        version: 1,
        status: 'active',
        activated_at: new Date(),
        change_note: 'Standardprofil: 5×5-Skala bis OpenISMS 3.5.1, automatisch angelegt.',
      });
      created = true;
    }
  }
  invalidate();
  const baseline = await getBaselineProfile();
  const [attached] = await Risk.update(
    { methodology_id: baseline.id },
    { where: { methodology_id: null }, hooks: false, silent: true, validate: false },
  );
  return { created, reactivated, attached, active: remember(active), baseline };
};

// Appetite rows must name an existing entry of the risk category taxonomy
// (services/riskCategoryService.js). Inactive entries are allowed: a category
// that is no longer assigned to new risks may still carry existing ones.
const appetiteCategoryErrors = async (profile) => {
  const cats = (profile?.appetite?.categories || []).map(c => c.category);
  if (!cats.length) return [];
  const known = new Set((await models().RiskCategory.findAll({ attributes: ['key'], raw: true })).map(r => r.key));
  return cats
    .map((c, idx) => (known.has(c) ? null : { field: `appetite.categories[${idx}].category`, message: `Appetit: Kategorie „${c}“ ist nicht in der Liste der Risikokategorien.` }))
    .filter(Boolean);
};

/**
 * Neue Version speichern und aktivieren. Die bisherige bleibt lesbar
 * (status superseded); Risiken bleiben an ihr, bis sie neu bewertet werden.
 */
const saveNewVersion = async (input, user, { changeNote } = {}) => {
  const { RiskMethodology, sequelize } = models();
  const { profile, errors, warnings } = validateProfile(input);
  // Risk appetite hangs on entries of the risk category taxonomy.
  errors.push(...await appetiteCategoryErrors(profile));
  if (errors.length) throw httpError(400, errors[0].message, { errors, warnings });
  let note = null;
  if (changeNote !== undefined && changeNote !== null && String(changeNote).trim() !== '') {
    note = String(changeNote).trim();
    if (note.length > LIMITS.note) throw httpError(400, `Änderungsnotiz ist länger als ${LIMITS.note} Zeichen.`);
  }
  const result = await sequelize.transaction(async (transaction) => {
    const current = await RiskMethodology.findOne({ where: { status: 'active' }, transaction, lock: transaction.LOCK.UPDATE });
    if (current && sameContent(plain(current), profile)) throw httpError(400, 'Keine Änderung gegenüber der aktiven Version.');
    const max = (await RiskMethodology.max('version', { transaction })) || 0;
    const now = new Date();
    if (current) await current.update({ status: 'superseded', superseded_at: now }, { transaction });
    const row = await RiskMethodology.create({
      ...profile,
      version: max + 1,
      status: 'active',
      activated_at: now,
      change_note: note,
      created_by_id: user?.id ?? null,
    }, { transaction });
    return { profile: plain(row), previous: current ? plain(current) : null };
  });
  invalidate();
  byId.delete(result.profile.id);
  if (result.previous) byId.delete(result.previous.id);
  const fresh = await getProfile(result.profile.id);
  return { profile: fresh, previous: result.previous, warnings };
};

const listVersions = async () => {
  const { RiskMethodology, Risk, User, sequelize } = models();
  const rows = await RiskMethodology.findAll({
    order: [['version', 'DESC']],
    include: [{ model: User, as: 'createdBy', attributes: ['id', 'name'] }],
  });
  const counts = await Risk.findAll({
    attributes: ['methodology_id', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    group: ['methodology_id'],
    raw: true,
  });
  const byVersion = new Map(counts.map(c => [c.methodology_id, Number(c.n)]));
  return rows.map(r => {
    const p = plain(r);
    return {
      id: p.id, version: p.version, name: p.name, status: p.status,
      likelihood_size: p.likelihood_levels.length, impact_size: p.impact_levels.length,
      change_note: p.change_note, created_at: p.created_at, activated_at: p.activated_at, superseded_at: p.superseded_at,
      created_by: p.createdBy ? { id: p.createdBy.id, name: p.createdBy.name } : null,
      risk_count: byVersion.get(p.id) || 0,
    };
  });
};

// ── Risiken ──────────────────────────────────────────────────────────────────

const checkRange = (value, size, label, version) => {
  if (value === null || value === undefined) return;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > size) {
    throw httpError(400, `${label} muss zwischen 1 und ${size} liegen (Risikomethodik Version ${version ?? '–'}).`);
  }
};

/**
 * beforeSave-Hook fuer Risk (models/index.js): Version zuordnen, Werte gegen
 * die Skala dieser Version pruefen, Stufen nach ihren Schwellen berechnen.
 */
const applyToRisk = async (risk, options = {}) => {
  const opts = { transaction: options.transaction };
  let profile = null;
  if (!risk.methodology_id) {
    // Neu angelegt: aktive Version. Bestand ohne Version: Standardprofil (s. o.).
    profile = risk.isNewRecord ? await getActiveProfile(opts) : await getBaselineProfile(opts);
    if (profile) risk.methodology_id = profile.id;
  } else {
    profile = await getProfile(risk.methodology_id, opts);
    if (!profile) throw httpError(400, 'Unbekannte Version der Risikomethodik.');
  }
  const p = profile || DEFAULT_PROFILE;
  const { likelihood: L, impact: I } = sizes(p);
  checkRange(risk.likelihood, L, 'Wahrscheinlichkeit', p.version);

  // Impact dimensions: only those the risk's version enables, each on the
  // impact scale. With at least one rated dimension the overall impact is
  // their maximum; without any, impact stays the single overall value.
  const dims = normalizeDimensions(risk.impact_dimensions, p, I);
  risk.impact_dimensions = dims;
  if (dims) risk.impact = Math.max(...Object.values(dims));

  checkRange(risk.impact, I, 'Auswirkung', p.version);
  checkRange(risk.residual_likelihood, L, 'Netto-Wahrscheinlichkeit', p.version);
  checkRange(risk.residual_impact, I, 'Netto-Auswirkung', p.version);
  checkRange(risk.target_likelihood, L, 'Ziel-Wahrscheinlichkeit', p.version);
  checkRange(risk.target_impact, I, 'Ziel-Auswirkung', p.version);
  if ((risk.target_likelihood == null) !== (risk.target_impact == null)) {
    throw httpError(400, 'Zielrisiko: Wahrscheinlichkeit und Auswirkung gemeinsam angeben oder beide leer lassen.');
  }
  if (risk.residual_override && (risk.residual_likelihood == null || risk.residual_impact == null)) {
    throw httpError(400, 'Überschriebenes Netto-Risiko braucht Wahrscheinlichkeit und Auswirkung.');
  }
  risk.inherent_level = computeLevel(risk.likelihood, risk.impact, p);
  if (risk.residual_likelihood != null && risk.residual_impact != null) {
    risk.residual_level = computeLevel(risk.residual_likelihood, risk.residual_impact, p);
  }
  risk.target_level = risk.target_likelihood != null && risk.target_impact != null
    ? computeLevel(risk.target_likelihood, risk.target_impact, p)
    : null;
};

/**
 * Impact dimension values of a risk against its methodology version. Returns
 * a fresh object built from the fixed catalogue (never from the input's keys),
 * or null when no dimension is rated.
 */
const normalizeDimensions = (raw, profile, impactSize) => {
  if (raw === null || raw === undefined) return null;
  if (!isObj(raw)) throw httpError(400, 'Auswirkungsdimensionen: Objekt { dimension: Wert } erwartet.');
  const enabled = dimensionsOf(profile).map(d => d.key);
  const foreign = Object.keys(raw).filter(k => !DIMENSION_KEYS.includes(k));
  if (foreign.length) throw httpError(400, `Unbekannte Auswirkungsdimension. Möglich: ${DIMENSION_KEYS.join(', ')}.`);
  const out = {};
  let rated = 0;
  for (const key of DIMENSION_KEYS) {
    const v = raw[key];
    if (v === null || v === undefined || v === '') continue;
    if (!enabled.includes(key)) {
      throw httpError(400, `Die Dimension „${key}“ ist in der Risikomethodik Version ${profile.version ?? '–'} nicht vorgesehen.`);
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > impactSize) {
      throw httpError(400, `Auswirkung „${key}“ muss zwischen 1 und ${impactSize} liegen (Risikomethodik Version ${profile.version ?? '–'}).`);
    }
    out[key] = n;
    rated++;
  }
  return rated ? out : null;
};

// Stufe, an der Appetit und Akzeptanz gemessen werden: Netto vor Brutto.
// Aus den Werten berechnet, nicht aus der gespeicherten Spalte - so zaehlt
// immer die Schwelle der Version, nach der das Risiko bewertet ist.
const effectiveLevel = (risk, profile) => {
  if (risk.residual_likelihood != null && risk.residual_impact != null) return computeLevel(risk.residual_likelihood, risk.residual_impact, profile);
  if (risk.likelihood != null && risk.impact != null) return computeLevel(risk.likelihood, risk.impact, profile);
  return risk.residual_level || risk.inherent_level || null;
};

const appetiteLimit = (category, profile) => {
  const ap = profile?.appetite || {};
  const hit = (ap.categories || []).find(c => c.category === category);
  return hit ? hit.max_level : (ap.default_max_level || null);
};

// Bewertungsfelder fuer Antworten (REST und MCP). Appetit und Akzeptanzregeln
// kommen aus der AKTIVEN Methodik (geltende Risikokriterien), die Stufe aus der
// Version des Risikos.
const assess = (risk, own, active) => {
  const eff = effectiveLevel(risk, own);
  const limit = appetiteLimit(risk.category, active || own);
  const needs = !!(active && own && own.id && own.id !== active.id);
  return {
    methodology_version: own?.version ?? null,
    needs_reassessment: needs,
    matrix_changed: needs ? (own.likelihood_levels.length !== active.likelihood_levels.length || own.impact_levels.length !== active.impact_levels.length) : false,
    effective_level: eff,
    appetite_max_level: limit,
    appetite_exceeded: !!(limit && eff && rank(eff) > rank(limit)),
  };
};

const decorateRisks = async (risks) => {
  const active = await getActiveProfile();
  const out = [];
  for (const r of risks) {
    const json = typeof r.toJSON === 'function' ? r.toJSON() : { ...r };
    const own = await profileForRisk(json);
    out.push({ ...json, ...assess(json, own, active) });
  }
  return out;
};
const decorateRisk = async (risk) => (await decorateRisks([risk]))[0];

// Datum ohne Uhrzeit, UTC. Monatsende wird gekappt (31.01. + 1 Monat = 28./29.02.).
const todayStr = () => new Date().toISOString().slice(0, 10);
const addMonths = (dateStr, months) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
};
const normalizeDate = (v) => {
  if (v === undefined || v === null || v === '' || v === 'Invalid date') return null;
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw httpError(400, 'Ungültiges Datum (JJJJ-MM-TT).');
  }
  return s;
};

const levelLabel = (profile, key) => levelMeta(profile, key)?.label_de || key;

/**
 * Akzeptanzregel der aktiven Methodik pruefen. Liefert das Gueltigkeitsdatum,
 * das gespeichert wird (bei einer Hoechstdauer ohne Angabe: das spaeteste
 * zulaessige Datum).
 */
const checkAcceptance = async (risk, user, validUntil) => {
  const active = await getActiveProfile();
  const own = await profileForRisk(risk);
  const rules = active || own;
  if (active && own.id && own.id !== active.id) {
    throw httpError(409, `Das Risiko ist nach Version ${own.version} der Risikomethodik bewertet, aktiv ist Version ${active.version}. Vor der Akzeptanz neu bewerten.`);
  }
  const level = effectiveLevel(risk, own);
  if (!level) throw httpError(400, 'Das Risiko ist nicht bewertet.');
  const rule = (rules.acceptance || []).find(a => a.level === level);
  if (!rule || !rule.roles.includes(user?.role)) {
    throw httpError(403, `Risiken der Stufe „${levelLabel(rules, level)}“ dürfen nur folgende Rollen akzeptieren: ${(rule?.roles || []).join(', ') || '–'}.`);
  }
  const today = todayStr();
  let until = normalizeDate(validUntil);
  if (until && until < today) throw httpError(400, 'Das Gültigkeitsdatum liegt in der Vergangenheit.');
  if (rule.max_months) {
    const latest = addMonths(today, rule.max_months);
    if (!until) until = latest;
    else if (until > latest) throw httpError(400, `Für die Stufe „${levelLabel(rules, level)}“ ist eine Akzeptanz höchstens ${rule.max_months} Monate gültig (bis ${latest}).`);
  }
  return { level, rule, accepted_until: until, methodology_version: own.version ?? null };
};

module.exports = {
  LEVEL_KEYS, ROLES, MIN_SIZE, MAX_SIZE, DEFAULT_PROFILE, DIMENSION_CATALOG, DIMENSION_KEYS, dimensionsOf, normalizeDimensions, appetiteCategoryErrors,
  validateProfile, computeLevel, buildMatrix, scaleInfo, sameContent, rank,
  getProfile, getActiveProfile, getBaselineProfile, profileForRisk, ensureDefaultProfile, saveNewVersion, listVersions, invalidate,
  applyToRisk, effectiveLevel, appetiteLimit, assess, decorateRisks, decorateRisk, checkAcceptance, addMonths, normalizeDate, todayStr,
  httpError,
};
