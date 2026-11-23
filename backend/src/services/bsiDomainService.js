'use strict';

/**
 * Informationsverbund, Zielobjekte und Modellierung (BSI-Standard 200-2,
 * Kap. 8.1 Strukturanalyse und Kap. 8.3 Modellierung).
 *
 * Reine Logik (Typvorschlaege, Bausteinvorschlaege, Pruefung einer
 * Modellierung) ist ohne Datenbank testbar (scripts/test-bsi-domain.js); die
 * Funktionen mit Datenbankzugriff laden die Modelle erst beim Aufruf.
 */

const getModels = () => require('../models');

const TARGET_TYPES = Object.freeze(['business_process', 'application', 'it_system', 'ics', 'room', 'building', 'network']);
const PROTECTION_APPROACHES = Object.freeze(['basis', 'standard', 'kern']);

// Prozessbausteine des Kompendiums: Sie gelten fuer den ganzen Verbund und
// werden nicht einzelnen Zielobjekten zugeordnet (200-2 Kap. 8.3.1).
const PROCESS_LAYERS = Object.freeze(['ISMS', 'ORP', 'CON', 'OPS', 'DER']);

const DEFAULT_DOMAIN_NAME = 'Standard-Informationsverbund';

// Vorschlag des Zielobjekttyps aus dem Asset-Typ des Assetregisters. Nur ein
// Vorschlag: Uebernommen wird er erst, wenn jemand das Zielobjekt anlegt, und
// er laesst sich dort aendern. Informationen/Daten und Personal sind in 200-2
// keine eigenen Zielobjekte (sie haengen an Geschaeftsprozessen) - dafuer gibt
// es keinen Vorschlag, der Typ muss gewaehlt werden.
const ASSET_TYPE_TO_TARGET = Object.freeze({
  hardware: 'it_system',
  software: 'application',
  application: 'application',
  ai_application: 'application',
  ai_agent: 'application',
  service: 'application',
  process: 'business_process',
});

function suggestTargetType(assetType) {
  // hasOwn: sonst liefert z. B. "__proto__" das Prototyp-Objekt statt null.
  return typeof assetType === 'string' && Object.prototype.hasOwnProperty.call(ASSET_TYPE_TO_TARGET, assetType)
    ? ASSET_TYPE_TO_TARGET[assetType] : null;
}

// Kompendium: welche Bausteine zu welchem Zielobjekttyp passen. Geprueft wird
// die Kennung (module_id), damit auch Bausteine eines neueren Kompendiums
// erfasst werden, die der mitgelieferte Auszug nicht kennt.
//   INF.1 (Allgemeines Gebaeude) und INF.12 (Verkabelung) gehoeren zum Gebaeude,
//   die uebrigen INF-Bausteine (Serverraum, Buero, Besprechungsraum, ...) zu Raeumen.
const BUILDING_MODULES = new Set(['INF.1', 'INF.12']);

function kompendiumMatches(targetType, mod) {
  const layer = mod.layer;
  switch (targetType) {
    case 'application': return layer === 'APP';
    case 'it_system': return layer === 'SYS';
    case 'ics': return layer === 'IND';
    case 'network': return layer === 'NET';
    case 'building': return layer === 'INF' && BUILDING_MODULES.has(mod.module_id);
    case 'room': return layer === 'INF' && !BUILDING_MODULES.has(mod.module_id);
    // Geschaeftsprozesse: Das Kompendium hat keine eigenen Bausteine fuer
    // einzelne Prozesse, die Prozessbausteine gelten fuer den Verbund.
    default: return false;
  }
}

// Grundschutz++: statement.target_object_categories, z. B. "IT-Systeme",
// "Netze". Die Bezeichnungen sind nicht normiert; verglichen wird deshalb ueber
// Wortstaemme statt exakter Gleichheit.
const GSPP_CATEGORY_PATTERNS = Object.freeze({
  business_process: /prozess/i,
  application: /anwendung|applikation|software|dienst/i,
  it_system: /it-system|server|client|endger[aä]t|^systeme?$/i,
  ics: /\bics\b|industri|steuerung|\bot\b|operational technology/i,
  room: /raum|r[aä]ume/i,
  building: /geb[aä]ude|liegenschaft/i,
  network: /netz|kommunikation|verbindung/i,
});

function categoriesOf(req) {
  const c = req.target_object_categories;
  if (Array.isArray(c)) return c.filter(x => typeof x === 'string');
  if (typeof c === 'string') return c.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function gsppMatches(targetType, categories) {
  const re = GSPP_CATEGORY_PATTERNS[targetType];
  if (!re) return false;
  return categories.some(c => re.test(c));
}

/**
 * Vorschlaege fuer ein Zielobjekt (targetType) oder den ganzen Verbund (null).
 *
 * @param {object[]} modules       Zeilen aus bsi_catalog_modules
 * @param {object[]} requirements  Zeilen aus bsi_catalog_requirements (mind. module_id, target_object_categories)
 * @param {string|null} targetType
 * @returns {{module_id:string, title:string, layer:string, kind:string, reason:string}[]}
 */
function suggestModules(modules, requirements, targetType) {
  const catsByModule = new Map();
  for (const r of requirements || []) {
    const cats = categoriesOf(r);
    if (!catsByModule.has(r.module_id)) catsByModule.set(r.module_id, new Set());
    for (const c of cats) catsByModule.get(r.module_id).add(c);
  }
  const out = [];
  for (const m of modules || []) {
    let reason = null;
    if (m.kind === 'praktik') {
      const cats = [...(catsByModule.get(m.module_id) || [])];
      if (targetType == null) {
        // Praktiken ohne Zielobjektkategorie richten sich an die Institution.
        if (cats.length === 0) reason = 'gspp_no_category';
      } else if (gsppMatches(targetType, cats)) {
        reason = `gspp_category:${cats.filter(c => GSPP_CATEGORY_PATTERNS[targetType].test(c)).join(', ')}`;
      }
    } else if (targetType == null) {
      if (PROCESS_LAYERS.includes(m.layer)) reason = 'process_layer';
    } else if (kompendiumMatches(targetType, m)) {
      reason = `layer:${m.layer}`;
    }
    if (reason) out.push({ module_id: m.module_id, title: m.title, layer: m.layer, kind: m.kind, reason });
  }
  return out;
}

/**
 * Darf das Modul so zugeordnet werden? Bausteine der Systemschichten
 * (APP, SYS, IND, NET, INF) brauchen ein Zielobjekt; Prozessbausteine gelten
 * fuer den Verbund, duerfen aber auch einem Zielobjekt zugeordnet werden
 * (z. B. OPS.2.3 fuer einen ausgelagerten Dienst). Praktiken des
 * Grundschutz++ sind an keine Schicht gebunden.
 * @returns {string|null} Fehlermeldung oder null
 */
function modelingError(mod, hasTarget) {
  if (!mod) return 'Modul ist im Katalog des Verbunds nicht enthalten';
  if (mod.kind === 'praktik') return null;
  if (!hasTarget && !PROCESS_LAYERS.includes(mod.layer)) {
    return `Bausteine der Schicht ${mod.layer} werden einem Zielobjekt zugeordnet, nicht dem ganzen Verbund`;
  }
  return null;
}

// ── Datenbank ────────────────────────────────────────────────────────────────

async function activeCatalog(transaction) {
  const { BsiCatalog } = getModels();
  return BsiCatalog.findOne({ where: { status: 'active' }, transaction });
}

async function getDefaultDomain(transaction) {
  const { BsiInformationDomain } = getModels();
  return BsiInformationDomain.findOne({ where: { is_default: true }, order: [['id', 'ASC']], transaction });
}

/**
 * Startmigration (idempotent): Legt den Standard-Informationsverbund an, wenn
 * es noch keinen Verbund gibt, und ordnet ihm alle BSI-Anforderungen ohne
 * Verbund zu. Status, Verantwortlicher, Notizen und Pruefdatum bleiben
 * unberuehrt - es wird ausschliesslich domain_id gesetzt.
 *
 * Absicherungsvariante des Standard-Verbunds: "standard" (die von 200-2 als
 * Regelfall beschriebene Vorgehensweise). Sie laesst sich danach aendern.
 *
 * @returns {{domain:object|null, created:boolean, attached:number}}
 */
async function ensureDefaultDomain() {
  const { sequelize, BsiInformationDomain, BsiRequirement } = getModels();
  return sequelize.transaction(async (transaction) => {
    let domain = await getDefaultDomain(transaction);
    let created = false;
    if (!domain) {
      // Gibt es schon Verbuende, aber keinen markierten, wird der aelteste
      // zum Standard - so bekommt der Bestand trotzdem einen Eigentuemer.
      domain = await BsiInformationDomain.findOne({ order: [['id', 'ASC']], transaction });
      if (domain) {
        await domain.update({ is_default: true }, { transaction });
      } else {
        const active = await activeCatalog(transaction);
        domain = await BsiInformationDomain.create({
          name: DEFAULT_DOMAIN_NAME,
          description: 'Bei der Einfuehrung der Informationsverbuende angelegt; enthaelt den bis dahin erfassten Umsetzungsstand.',
          protection_approach: 'standard',
          catalog_id: active ? active.id : null,
          is_default: true,
        }, { transaction });
        created = true;
      }
    }
    const [attached] = await BsiRequirement.update(
      { domain_id: domain.id },
      { where: { domain_id: null }, transaction, silent: true }
    );
    return { domain, created, attached };
  });
}

/**
 * WHERE-Teil fuer die bisherige Anforderungsliste (GET /api/bsi-grundschutz,
 * isms_list_bsi_requirements): der Umsetzungsstand des Standard-Verbunds.
 * Zeilen ohne Verbund zaehlen dazu, bis die Startmigration sie zugeordnet hat.
 */
async function baselineWhere() {
  const { Op } = require('sequelize');
  const def = await getDefaultDomain();
  return {
    domain_id: def ? { [Op.or]: [{ [Op.is]: null }, { [Op.eq]: def.id }] } : { [Op.is]: null },
    // Eintraege des Grundschutz-Checks an Zielobjekten gehoeren nicht dazu.
    target_object_id: { [Op.is]: null },
  };
}

/** Alle Verbuende auf den (neu) aktiven Katalog umstellen. */
async function followActiveCatalog(catalogId, transaction) {
  const { BsiInformationDomain } = getModels();
  await BsiInformationDomain.update({ catalog_id: catalogId }, { where: {}, transaction });
}

// ── Arbeitsfunktionen fuer REST und MCP ─────────────────────────────────────
//
// REST-Routen (routes/bsi-domains.js) und MCP-Tools (mcp/server.js) rufen
// dieselben Funktionen auf: gleiche Validierung, gleiche Sichtbarkeitsregeln.
// Die Berechtigung (Matrix bsi_grundschutz.view / manage_domain) prueft der
// jeweilige Einstieg; hier wird geprueft, was am Datensatz haengt:
//   - Ein Zielobjekt ist ein Asset. Wer ein Asset nicht sehen darf
//     (GET /api/assets/:id -> 403), sieht es auch als Zielobjekt nicht und
//     kann es nicht zuordnen - an jedem Weg: Liste, Modellierung, Vorschlaege.
//   - Fremdschluessel werden gegen den Verbund geprueft: Ein Zielobjekt eines
//     anderen Verbunds laesst sich nicht modellieren.
//   - Uebernommen werden nur die erlaubten Felder.

class DomainError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const toId = (v) => {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(v).trim() ? n : null;
};
const text = (v, max) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new DomainError(400, 'Ungueltiger Textwert');
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

// Sichtbarkeit wie im Assetregister (middleware/auth.js canViewAsset). actor ist
// req.user bzw. der MCP-Benutzer.
function assetVisible(actor, asset) {
  const { canViewAsset } = require('../middleware/auth');
  return canViewAsset({ user: actor || {} }, asset);
}
// Dazu die Matrix: Ist assets.view fuer den Benutzer ausdruecklich entzogen,
// ist kein Asset sichtbar - auch nicht als Zielobjekt.
async function assetFilter(actor) {
  const { can } = require('./permissionService');
  const verdict = await can(actor, 'assets', 'view');
  if (verdict === false) return () => false;
  return (asset) => !!asset && assetVisible(actor, asset);
}
function seesAllAssets(actor) {
  const { canViewAllAssets } = require('../middleware/auth');
  return canViewAllAssets({ user: actor || {} });
}

const ASSET_ATTRS = ['id', 'name', 'type', 'status', 'classification', 'owner_id', 'assessor_id'];
const briefAsset = (a) => a && { id: a.id, name: a.name, type: a.type, status: a.status, classification: a.classification };

async function loadDomain(id, transaction) {
  const { BsiInformationDomain } = getModels();
  const domainId = toId(id);
  const domain = domainId && await BsiInformationDomain.findByPk(domainId, { transaction });
  if (!domain) throw new DomainError(404, 'Informationsverbund nicht gefunden');
  return domain;
}

async function listDomains() {
  const { BsiInformationDomain, BsiTargetObject, BsiModeling, BsiCatalog } = getModels();
  const items = await BsiInformationDomain.findAll({
    include: [{ model: BsiCatalog, as: 'catalog', attributes: ['id', 'name', 'edition', 'format', 'status'] }],
    order: [['is_default', 'DESC'], ['name', 'ASC']],
  });
  const [targets, models] = await Promise.all([
    BsiTargetObject.count({ group: ['domain_id'] }),
    BsiModeling.count({ group: ['domain_id'] }),
  ]);
  const tc = new Map(targets.map(r => [r.domain_id, Number(r.count)]));
  const mc = new Map(models.map(r => [r.domain_id, Number(r.count)]));
  return items.map(d => ({ ...d.toJSON(), target_object_count: tc.get(d.id) || 0, modeling_count: mc.get(d.id) || 0 }));
}

async function getDomain(id) {
  const { BsiCatalog } = getModels();
  const domain = await loadDomain(id);
  const catalog = domain.catalog_id ? await BsiCatalog.findByPk(domain.catalog_id, { attributes: ['id', 'name', 'edition', 'format', 'status'] }) : null;
  return { ...domain.toJSON(), catalog };
}

const DOMAIN_FIELDS = ['name', 'description', 'scope', 'protection_approach'];

function domainValues(body, { creating }) {
  const out = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const k of DOMAIN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    if (k === 'protection_approach') {
      if (!PROTECTION_APPROACHES.includes(src[k])) throw new DomainError(400, `Absicherungsvariante muss eine von ${PROTECTION_APPROACHES.join(', ')} sein`);
      out[k] = src[k];
    } else {
      out[k] = text(src[k], k === 'name' ? 255 : 10000);
    }
  }
  if ((creating || 'name' in out) && !out.name) throw new DomainError(400, 'Name ist erforderlich');
  return out;
}

async function createDomain(body, actor) {
  const { BsiInformationDomain } = getModels();
  const values = domainValues(body, { creating: true });
  const active = await activeCatalog();
  return BsiInformationDomain.create({
    protection_approach: 'standard',
    ...values,
    catalog_id: active ? active.id : null,
    is_default: false,
    created_by_id: actor?.id || null,
  });
}

/** @returns {{domain:object, before:object, changes:object}} */
async function updateDomain(id, body) {
  const domain = await loadDomain(id);
  const values = domainValues(body, { creating: false });
  const before = {};
  const changes = {};
  // Schluessel aus der festen Feldliste, nicht aus der Eingabe (CodeQL js/remote-property-injection).
  for (const k of DOMAIN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(values, k)) continue;
    const v = values[k];
    if (domain[k] !== v) { before[k] = domain[k]; changes[k] = v; }
  }
  if (Object.keys(changes).length) await domain.update(changes);
  return { domain, before, changes };
}

async function listTargetObjects(domainId, actor) {
  const visible = await assetFilter(actor);
  const { BsiTargetObject, Asset, BsiModeling } = getModels();
  const domain = await loadDomain(domainId);
  const rows = await BsiTargetObject.findAll({
    where: { domain_id: domain.id },
    include: [{ model: Asset, as: 'asset', attributes: ASSET_ATTRS }],
    order: [['target_type', 'ASC'], ['id', 'ASC']],
  });
  const shown = rows.filter(r => r.asset && visible(r.asset));
  const counts = await BsiModeling.count({ where: { domain_id: domain.id }, group: ['target_object_id'] });
  const mc = new Map(counts.map(r => [r.target_object_id, Number(r.count)]));
  return shown.map(r => ({
    id: r.id, domain_id: r.domain_id, asset_id: r.asset_id, target_type: r.target_type, notes: r.notes,
    created_at: r.created_at, updated_at: r.updated_at,
    asset: briefAsset(r.asset),
    suggested_target_type: suggestTargetType(r.asset.type),
    modeling_count: mc.get(r.id) || 0,
  }));
}

async function loadTargetObject(domain, id, actor, transaction) {
  const visible = await assetFilter(actor);
  const { BsiTargetObject, Asset } = getModels();
  const toIdNum = toId(id);
  const row = toIdNum && await BsiTargetObject.findOne({
    where: { id: toIdNum, domain_id: domain.id },
    include: [{ model: Asset, as: 'asset', attributes: ASSET_ATTRS }],
    transaction,
  });
  // Nicht vorhanden, anderer Verbund oder Asset nicht sichtbar: dieselbe Antwort.
  if (!row || !row.asset || !visible(row.asset)) throw new DomainError(404, 'Zielobjekt nicht gefunden');
  return row;
}

async function addTargetObject(domainId, body, actor) {
  const visible = await assetFilter(actor);
  const { sequelize, BsiTargetObject, Asset } = getModels();
  const src = body && typeof body === 'object' ? body : {};
  const assetId = toId(src.asset_id);
  if (!assetId) throw new DomainError(400, 'asset_id fehlt oder ist ungueltig');
  return sequelize.transaction(async (transaction) => {
    const domain = await loadDomain(domainId, transaction);
    const asset = await Asset.findByPk(assetId, { attributes: ASSET_ATTRS, transaction });
    if (!asset || !visible(asset)) throw new DomainError(404, 'Asset nicht gefunden');
    let targetType = src.target_type;
    if (targetType === undefined || targetType === null || targetType === '') targetType = suggestTargetType(asset.type);
    if (!TARGET_TYPES.includes(targetType)) {
      throw new DomainError(400, targetType == null
        ? `Fuer den Asset-Typ "${asset.type}" gibt es keinen Vorschlag; target_type angeben (${TARGET_TYPES.join(', ')})`
        : `target_type muss einer von ${TARGET_TYPES.join(', ')} sein`);
    }
    const dup = await BsiTargetObject.findOne({ where: { domain_id: domain.id, asset_id: asset.id }, transaction });
    if (dup) throw new DomainError(409, 'Das Asset ist in diesem Verbund bereits Zielobjekt');
    const row = await BsiTargetObject.create({
      domain_id: domain.id, asset_id: asset.id, target_type: targetType,
      notes: text(src.notes, 10000) ?? null, created_by_id: actor?.id || null,
    }, { transaction });
    return { domain, targetObject: row, asset: briefAsset(asset) };
  });
}

async function updateTargetObject(domainId, id, body, actor) {
  const domain = await loadDomain(domainId);
  const row = await loadTargetObject(domain, id, actor);
  const src = body && typeof body === 'object' ? body : {};
  const changes = {};
  const before = {};
  if (Object.prototype.hasOwnProperty.call(src, 'target_type')) {
    if (!TARGET_TYPES.includes(src.target_type)) throw new DomainError(400, `target_type muss einer von ${TARGET_TYPES.join(', ')} sein`);
    if (src.target_type !== row.target_type) { before.target_type = row.target_type; changes.target_type = src.target_type; }
  }
  if (Object.prototype.hasOwnProperty.call(src, 'notes')) {
    const n = text(src.notes, 10000);
    if (n !== row.notes) { before.notes = row.notes; changes.notes = n; }
  }
  if (Object.keys(changes).length) await row.update(changes);
  return { domain, targetObject: row, asset: briefAsset(row.asset), before, changes };
}

/**
 * Zielobjekt aus dem Verbund nehmen. Nur ohne Modellierung: Die Modellierung
 * traegt den Pruefbezug, sie wird nicht stillschweigend mit entfernt. Das
 * Asset selbst bleibt unberuehrt.
 */
async function removeTargetObject(domainId, id, actor) {
  const { sequelize, BsiModeling, BsiRequirement } = getModels();
  return sequelize.transaction(async (transaction) => {
    const domain = await loadDomain(domainId, transaction);
    const row = await loadTargetObject(domain, id, actor, transaction);
    const modeled = await BsiModeling.count({ where: { target_object_id: row.id }, transaction });
    if (modeled > 0) throw new DomainError(409, `Dem Zielobjekt sind noch ${modeled} Baustein(e) zugeordnet; zuerst die Modellierung entfernen`);
    // Checkdaten (Status, Begruendung, Nachweise) werden nie implizit verworfen.
    const checked = await BsiRequirement.count({ where: { target_object_id: row.id }, transaction });
    if (checked > 0) throw new DomainError(409, `Zum Zielobjekt sind ${checked} Eintraege des IT-Grundschutz-Checks erfasst; es bleibt im Verbund`);
    const snapshot = { asset_id: row.asset_id, target_type: row.target_type, notes: row.notes };
    await row.destroy({ transaction });
    return { domain, snapshot, asset: briefAsset(row.asset), id: row.id };
  });
}

async function catalogData(catalogId, { withRequirements = false } = {}) {
  const { BsiCatalogModule, BsiCatalogRequirement } = getModels();
  if (!catalogId) return { modules: [], requirements: [] };
  const modules = await BsiCatalogModule.findAll({ where: { catalog_id: catalogId }, order: [['sort_order', 'ASC']], raw: true });
  const requirements = withRequirements
    ? await BsiCatalogRequirement.findAll({
      where: { catalog_id: catalogId, withdrawn: false },
      attributes: ['module_id', 'req_id', 'requirement_level', 'target_object_categories'],
      raw: true,
    })
    : [];
  return { modules, requirements };
}

async function listModeling(domainId, actor) {
  const visible = await assetFilter(actor);
  const { BsiModeling, BsiTargetObject, Asset } = getModels();
  const domain = await loadDomain(domainId);
  const rows = await BsiModeling.findAll({
    where: { domain_id: domain.id },
    include: [{ model: BsiTargetObject, as: 'targetObject', include: [{ model: Asset, as: 'asset', attributes: ASSET_ATTRS }] }],
    order: [['module_id', 'ASC'], ['id', 'ASC']],
  });
  const { modules } = await catalogData(domain.catalog_id);
  const byId = new Map(modules.map(m => [m.module_id, m]));
  return rows
    .filter(r => !r.target_object_id || (r.targetObject?.asset && visible(r.targetObject.asset)))
    .map(r => {
      const m = byId.get(r.module_id);
      return {
        id: r.id, domain_id: r.domain_id, target_object_id: r.target_object_id, catalog_id: r.catalog_id,
        module_id: r.module_id, notes: r.notes, created_at: r.created_at,
        module: m ? { title: m.title, layer: m.layer, kind: m.kind } : null,
        // Nach einem Katalogwechsel kann der Baustein im aktiven Katalog fehlen.
        in_active_catalog: !!m,
        target_object: r.targetObject ? { id: r.targetObject.id, target_type: r.targetObject.target_type, asset: briefAsset(r.targetObject.asset) } : null,
      };
    });
}

/** Vorschlaege fuer ein Zielobjekt bzw. (targetObjectId leer) den Verbund, ohne bereits Modelliertes. */
async function suggestModeling(domainId, targetObjectId, actor) {
  const { BsiModeling } = getModels();
  const domain = await loadDomain(domainId);
  let target = null;
  if (targetObjectId !== undefined && targetObjectId !== null && targetObjectId !== '') {
    target = await loadTargetObject(domain, targetObjectId, actor);
  }
  const { modules, requirements } = await catalogData(domain.catalog_id, { withRequirements: true });
  const done = new Set((await BsiModeling.findAll({
    where: { domain_id: domain.id, target_object_id: target ? target.id : null }, attributes: ['module_id'], raw: true,
  })).map(r => r.module_id));
  const suggestions = suggestModules(modules, requirements, target ? target.target_type : null)
    .filter(s => !done.has(s.module_id));
  return { domain_id: domain.id, target_object_id: target ? target.id : null, target_type: target ? target.target_type : null, catalog_id: domain.catalog_id, suggestions };
}

async function addModeling(domainId, body, actor) {
  const { sequelize, BsiModeling, BsiCatalogModule } = getModels();
  const src = body && typeof body === 'object' ? body : {};
  const moduleId = typeof src.module_id === 'string' ? src.module_id.trim().slice(0, 40) : '';
  if (!moduleId) throw new DomainError(400, 'module_id fehlt');
  return sequelize.transaction(async (transaction) => {
    const domain = await loadDomain(domainId, transaction);
    if (!domain.catalog_id) throw new DomainError(409, 'Der Verbund hat keinen aktiven Katalog; zuerst einen Katalog aktivieren');
    let target = null;
    if (src.target_object_id !== undefined && src.target_object_id !== null && src.target_object_id !== '') {
      // loadTargetObject prueft den Verbund mit: Zielobjekte fremder Verbuende -> 404.
      target = await loadTargetObject(domain, src.target_object_id, actor, transaction);
    }
    const mod = await BsiCatalogModule.findOne({ where: { catalog_id: domain.catalog_id, module_id: moduleId }, raw: true, transaction });
    const err = modelingError(mod, !!target);
    if (err) throw new DomainError(mod ? 400 : 404, err);
    const dup = await BsiModeling.findOne({ where: { domain_id: domain.id, target_object_id: target ? target.id : null, module_id: moduleId }, transaction });
    if (dup) throw new DomainError(409, 'Dieser Baustein ist hier bereits modelliert');
    const row = await BsiModeling.create({
      domain_id: domain.id, target_object_id: target ? target.id : null, catalog_id: domain.catalog_id,
      module_id: moduleId, notes: text(src.notes, 10000) ?? null, created_by_id: actor?.id || null,
    }, { transaction });
    return { domain, modeling: row, module: { module_id: mod.module_id, title: mod.title, layer: mod.layer, kind: mod.kind }, target: target ? { id: target.id, asset: briefAsset(target.asset) } : null };
  });
}

/**
 * Modellierung entfernen. Der Umsetzungsstand der Anforderungen bleibt
 * erhalten (er haengt nicht an der Modellierungszeile); er wird nur nicht
 * mehr als Teil des Grundschutz-Checks angezeigt.
 */
async function removeModeling(domainId, id, actor) {
  const visible = await assetFilter(actor);
  const { sequelize, BsiModeling, BsiTargetObject, Asset } = getModels();
  return sequelize.transaction(async (transaction) => {
    const domain = await loadDomain(domainId, transaction);
    const mid = toId(id);
    const row = mid && await BsiModeling.findOne({
      where: { id: mid, domain_id: domain.id },
      include: [{ model: BsiTargetObject, as: 'targetObject', include: [{ model: Asset, as: 'asset', attributes: ASSET_ATTRS }] }],
      transaction,
    });
    if (!row || (row.target_object_id && !(row.targetObject?.asset && visible(row.targetObject.asset)))) {
      throw new DomainError(404, 'Modellierung nicht gefunden');
    }
    const snapshot = { target_object_id: row.target_object_id, module_id: row.module_id, catalog_id: row.catalog_id, notes: row.notes };
    await row.destroy({ transaction });
    return { domain, snapshot, id: row.id };
  });
}

module.exports = {
  DomainError,
  toId,
  assetVisible,
  assetFilter,
  seesAllAssets,
  listDomains,
  getDomain,
  createDomain,
  updateDomain,
  listTargetObjects,
  addTargetObject,
  updateTargetObject,
  removeTargetObject,
  listModeling,
  suggestModeling,
  addModeling,
  removeModeling,
  loadDomain,
  loadTargetObject,
  catalogData,
  TARGET_TYPES,
  PROTECTION_APPROACHES,
  PROCESS_LAYERS,
  DEFAULT_DOMAIN_NAME,
  ASSET_TYPE_TO_TARGET,
  GSPP_CATEGORY_PATTERNS,
  suggestTargetType,
  suggestModules,
  modelingError,
  categoriesOf,
  activeCatalog,
  getDefaultDomain,
  ensureDefaultDomain,
  baselineWhere,
  followActiveCatalog,
};
