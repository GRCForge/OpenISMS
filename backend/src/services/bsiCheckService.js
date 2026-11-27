'use strict';

/**
 * IT-Grundschutz-Check je Zielobjekt (BSI-Standard 200-2, Kap. 8.4).
 *
 * Ein Eintrag ist eine Zeile in bsi_requirements mit (domain_id,
 * target_object_id, req_id); target_object_id = null heisst: die Anforderung
 * gilt fuer den ganzen Verbund. Zeilen entstehen erst, wenn jemand einen Status
 * setzt - bis dahin ist eine modellierte Anforderung "offen".
 *
 * Reine Funktionen (Absicherungsfilter, Validierung, Auswertung, A.4-Zeilen)
 * sind ohne Datenbank testbar (scripts/test-bsi-check.js). REST
 * (routes/bsi-domains.js), die bisherige Anforderungsliste
 * (routes/bsi-grundschutz.js) und die MCP-Tools schreiben alle ueber
 * applyEntryValues() bzw. setCheckEntry(): gleiche Pflichtfelder an jedem Weg.
 */

const getModels = () => require('../models');
const domains = require('./bsiDomainService');
const { BSI_STATUSES } = require('./bsiLayers');

// Status des Checks in der Sprache des BSI.
const CHECK_LABELS = Object.freeze({
  implemented: 'ja',
  in_progress: 'teilweise',
  not_implemented: 'nein',
  not_applicable: 'entbehrlich',
  not_started: 'offen',
});

const JUSTIFICATION_REQUIRED = Object.freeze(['not_implemented', 'not_applicable']);
// Priority in the realisation plan (reference document A.6, 3.10.0).
const REALIZATION_PRIORITIES = Object.freeze(['high', 'medium', 'low']);

// Welche Anforderungsstufen eine Absicherungsvariante umfasst.
//
// Kompendium (B/S/H):
//   basis    -> B
//   standard -> B + S
//   kern     -> B + S + H
// Annahme zu "kern": Die Kern-Absicherung (200-2 Kap. 3.3/8) wendet die
// Vorgehensweise der Standard-Absicherung auf die "Kronjuwelen" an. Fuer diese
// ist in aller Regel ein hoher Schutzbedarf anzunehmen, fuer den 200-2
// zusaetzliche Massnahmen verlangt; die H-Anforderungen des Kompendiums sind
// dafuer die Vorschlaege. Kern zeigt deshalb B + S + H. Ob eine H-Anforderung
// im Einzelfall noetig ist, entscheidet der Check (Status "entbehrlich" mit
// Begruendung) bzw. die Risikoanalyse.
//
// Grundschutz++ (normal-SdT / erhoeht) kennt keine Trennung Basis/Standard:
//   basis, standard -> normal-SdT
//   kern            -> normal-SdT + erhoeht
// Anforderungen ohne Stufe (generisches OSCAL) gelten immer.
const LEVELS_BY_APPROACH = Object.freeze({
  basis: Object.freeze(['basis', 'normal_sdt']),
  standard: Object.freeze(['basis', 'standard', 'normal_sdt']),
  kern: Object.freeze(['basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht']),
});

function isRelevant(approach, level) {
  if (level == null) return true;
  const levels = LEVELS_BY_APPROACH[approach] || LEVELS_BY_APPROACH.standard;
  return levels.includes(level);
}

class CheckError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COST = 10_000_000_000;

function parseDate(v, field) {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new CheckError(400, `${field} muss ein Datum im Format JJJJ-MM-TT sein`);
  }
  return v;
}

function parseCost(v, field) {
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+([.,]\d{1,2})?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : NaN);
  if (!Number.isFinite(n) || n < 0 || n > MAX_COST) throw new CheckError(400, `${field} muss ein Betrag in EUR (0 bis ${MAX_COST}) sein`);
  return Math.round(n * 100) / 100;
}

function parseText(v, field, max = 10000) {
  if (v === null) return null;
  if (typeof v !== 'string') throw new CheckError(400, `${field} muss Text sein`);
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function parseIdOrNull(v, field) {
  if (v === null || v === '') return null;
  const id = domains.toId(v);
  if (!id) throw new CheckError(400, `${field} ist ungueltig`);
  return id;
}

/**
 * Prueft die Eingabe gegen den aktuellen Stand und liefert die zu
 * schreibenden Werte. Nur die erlaubten Felder werden uebernommen.
 *
 * Begruendungspflicht: Ist der Status nach der Aenderung "nein" oder
 * "entbehrlich", muss eine Begruendung vorhanden sein - neu mitgeschickt oder
 * bereits gespeichert. Bestandszeilen, die vor 3.5 ohne Begruendung auf
 * not_applicable gesetzt wurden, bleiben lesbar; sobald jemand den Status oder
 * die Begruendung anfasst, gilt die Pflicht.
 *
 * @param {object} body
 * @param {object|null} current  bestehende Zeile (oder null)
 * @returns {object} values
 */
function validateEntryInput(body, current) {
  const src = body && typeof body === 'object' ? body : {};
  const values = {};
  if (hasOwn(src, 'implementation_status')) {
    if (!BSI_STATUSES.includes(src.implementation_status)) {
      throw new CheckError(400, `implementation_status muss einer von ${BSI_STATUSES.join(', ')} sein`);
    }
    values.implementation_status = src.implementation_status;
  }
  if (hasOwn(src, 'justification')) values.justification = parseText(src.justification, 'Begruendung');
  if (hasOwn(src, 'notes')) values.notes = parseText(src.notes, 'Notizen');
  if (hasOwn(src, 'responsible_id')) values.responsible_id = parseIdOrNull(src.responsible_id, 'responsible_id');
  if (hasOwn(src, 'responsible_group_id')) values.responsible_group_id = parseIdOrNull(src.responsible_group_id, 'responsible_group_id');
  if (hasOwn(src, 'due_date')) values.due_date = parseDate(src.due_date, 'Umsetzungstermin');
  if (hasOwn(src, 'last_review_date')) values.last_review_date = parseDate(src.last_review_date, 'Pruefdatum');
  if (hasOwn(src, 'cost_once')) values.cost_once = parseCost(src.cost_once, 'Kosten einmalig');
  if (hasOwn(src, 'cost_recurring')) values.cost_recurring = parseCost(src.cost_recurring, 'Kosten laufend');
  if (hasOwn(src, 'realization_priority')) {
    const p = src.realization_priority;
    if (p !== null && p !== '' && !REALIZATION_PRIORITIES.includes(p)) {
      throw new CheckError(400, `realization_priority muss einer von ${REALIZATION_PRIORITIES.join(', ')} sein`);
    }
    values.realization_priority = p === '' ? null : p;
  }

  const status = hasOwn(values, 'implementation_status') ? values.implementation_status : (current?.implementation_status || 'not_started');
  const justification = hasOwn(values, 'justification') ? values.justification : (current?.justification || null);
  const touched = hasOwn(values, 'implementation_status') || hasOwn(values, 'justification');
  if (touched && JUSTIFICATION_REQUIRED.includes(status) && !justification) {
    throw new CheckError(400, `Fuer den Status "${CHECK_LABELS[status]}" ist eine Begruendung erforderlich`);
  }
  return values;
}

/** Referenzen pruefen: Benutzer aktiv vorhanden, Gruppe vorhanden. */
async function checkReferences(values, transaction) {
  if (values.responsible_id == null && values.responsible_group_id == null) return;
  const { User, Group } = getModels();
  if (values.responsible_id != null) {
    const u = await User.findOne({ where: { id: values.responsible_id, active: true }, attributes: ['id'], transaction });
    if (!u) throw new CheckError(400, 'Verantwortlicher Benutzer nicht gefunden');
  }
  if (values.responsible_group_id != null) {
    const g = await Group.findByPk(values.responsible_group_id, { attributes: ['id'], transaction });
    if (!g) throw new CheckError(400, 'Verantwortliche Gruppe nicht gefunden');
  }
}

/** Nur geaenderte Werte schreiben; liefert { before, changes } fuer das Audit-Log. */
const ENTRY_FIELDS = Object.freeze([
  'implementation_status', 'justification', 'notes', 'responsible_id', 'responsible_group_id',
  'due_date', 'last_review_date', 'cost_once', 'cost_recurring', 'realization_priority',
]);

async function applyEntryValues(row, values, transaction) {
  const before = {};
  const changes = {};
  // Schluessel aus der festen Feldliste, nicht aus der Eingabe (CodeQL js/remote-property-injection).
  for (const k of ENTRY_FIELDS) {
    if (!hasOwn(values, k)) continue;
    const v = values[k];
    const cur = row[k] == null ? null : (['cost_once', 'cost_recurring'].includes(k) ? Number(row[k]) : row[k]);
    if (cur !== v) { before[k] = cur; changes[k] = v; }
  }
  if (Object.keys(changes).length) await row.update(changes, { transaction });
  return { before, changes };
}

// ── Auswertung ───────────────────────────────────────────────────────────────

const emptyBucket = () => ({
  total: 0, implemented: 0, in_progress: 0, not_implemented: 0, not_applicable: 0, not_started: 0,
  cost_once: 0, cost_recurring: 0, fulfillment: null,
});

/**
 * Erfuellungsgrad: (ja + 0,5 x teilweise) / (alle - entbehrlich).
 * Entbehrliche Anforderungen zaehlen nicht mit; "nein" und "offen" zaehlen
 * als nicht erfuellt. Ohne relevante Anforderung: null.
 */
function finishBucket(b) {
  const relevant = b.total - b.not_applicable;
  b.fulfillment = relevant > 0 ? Math.round(((b.implemented + 0.5 * b.in_progress) / relevant) * 1000) / 10 : null;
  b.cost_once = Math.round(b.cost_once * 100) / 100;
  b.cost_recurring = Math.round(b.cost_recurring * 100) / 100;
  return b;
}

/**
 * @param {object[]} entries  Eintraege aus getCheck().entries
 * @returns {{ total, by_module: object[], by_target: object[] }}
 */
function summarize(entries) {
  const total = emptyBucket();
  const byModule = new Map();
  const byTarget = new Map();
  for (const e of entries) {
    const mk = e.module_id;
    const tk = e.target_object_id == null ? 'domain' : String(e.target_object_id);
    if (!byModule.has(mk)) byModule.set(mk, { module_id: e.module_id, module_title: e.module_title, ...emptyBucket() });
    if (!byTarget.has(tk)) byTarget.set(tk, { target_object_id: e.target_object_id, target_name: e.target_name, target_type: e.target_type, ...emptyBucket() });
    for (const b of [total, byModule.get(mk), byTarget.get(tk)]) {
      b.total++;
      b[e.implementation_status] = (b[e.implementation_status] || 0) + 1;
      b.cost_once += Number(e.cost_once || 0);
      b.cost_recurring += Number(e.cost_recurring || 0);
    }
  }
  return {
    total: finishBucket(total),
    by_module: [...byModule.values()].map(finishBucket),
    by_target: [...byTarget.values()].map(finishBucket),
  };
}

// ── Referenzdokument A.4 ─────────────────────────────────────────────────────

// Formel-Injection (CWE-1236): Zellen, die mit = + - @ Tab oder CR beginnen,
// bekommen ein fuehrendes Apostroph; reine Zahlen bleiben. Gleiche Regel wie
// frontend/src/lib/csv.ts neutralizeFormula.
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^[+-]?\d+([.,]\d+)?$/;
function neutralize(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return FORMULA_START.test(s) && !NUMERIC.test(s) ? `'${s}` : s;
}

// Spalten in der Reihenfolge des Referenzdokuments A.4 "IT-Grundschutz-Check"
// (Zielobjekt, Baustein, Anforderung, Umsetzungsstatus, Begruendung,
// Verantwortlich, Umsetzung bis, Kosten), ergaenzt um Nachweise und Massnahmen.
const A4_COLUMNS = Object.freeze([
  'Zielobjekt', 'Zielobjekttyp', 'Baustein', 'Baustein-Titel', 'Anforderung', 'Titel', 'Stufe',
  'Umsetzung', 'Begründung', 'Verantwortlich', 'Umsetzung bis', 'Kosten einmalig (EUR)', 'Kosten laufend (EUR/Jahr)',
  'Nachweise', 'Maßnahmen', 'Bemerkungen', 'Letzte Prüfung',
]);

const LEVEL_SHORT = Object.freeze({ basis: 'B', standard: 'S', erhoehter_schutzbedarf: 'H', normal_sdt: 'normal-SdT', erhoeht: 'erhöht' });
const TARGET_LABELS = Object.freeze({
  business_process: 'Geschäftsprozess', application: 'Anwendung', it_system: 'IT-System', ics: 'ICS-System',
  room: 'Raum', building: 'Gebäude', network: 'Netz/Kommunikationsverbindung',
});

/** Zeilen fuer den Excel-Export; Strings formel-neutralisiert, Kosten als Zahl. */
function buildA4Rows(check) {
  const rows = [];
  for (const e of check.entries) {
    const responsible = [e.responsible?.name, e.responsible_group?.name].filter(Boolean).join(' / ');
    rows.push([
      neutralize(e.target_object_id == null ? `Informationsverbund: ${check.domain.name}` : e.target_name),
      neutralize(e.target_object_id == null ? 'Informationsverbund' : (TARGET_LABELS[e.target_type] || e.target_type)),
      neutralize(e.module_id), neutralize(e.module_title), neutralize(e.req_id), neutralize(e.title),
      neutralize(LEVEL_SHORT[e.requirement_level] || ''),
      neutralize(CHECK_LABELS[e.implementation_status]),
      neutralize(e.justification), neutralize(responsible), neutralize(e.due_date),
      e.cost_once == null ? null : Number(e.cost_once),
      e.cost_recurring == null ? null : Number(e.cost_recurring),
      neutralize((e.documents || []).map(d => d.original_name).join(', ')),
      neutralize((e.controls || []).map(c => `${c.code} ${c.title}`).join(', ')),
      neutralize(e.notes), neutralize(e.last_review_date),
    ]);
  }
  return { columns: A4_COLUMNS, rows };
}

// ── Datenbank ────────────────────────────────────────────────────────────────

const CONTROL_VIEW_FALLBACK = ['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee'];
const CONTROL_EDIT_FALLBACK = ['admin', 'assessor', 'it-staff'];

async function allowed(actor, module, action, fallback) {
  const { can } = require('./permissionService');
  const v = await can(actor, module, action);
  return v === true || (v !== false && fallback.includes(actor?.role));
}

/** Filter fuer Nachweis-Dokumente: Modulrecht documents.view und Sichtbarkeit des Elternobjekts. */
async function documentFilter(actor) {
  if (!(await allowed(actor, 'documents', 'view', CONTROL_VIEW_FALLBACK))) return async () => false;
  const { canAccessDocumentParent } = require('../routes/documents');
  const req = { user: actor || {} };
  return async (doc) => !!doc && canAccessDocumentParent(req, doc);
}

/**
 * Modellierte Anforderungen eines Verbunds mit ihrem Checkstand.
 * @param {number|string} domainId
 * @param {object} actor
 * @param {{targetObjectId?: number|string|null}} [opts]  nur ein Zielobjekt ('domain' = nur Verbundebene)
 */
async function getCheck(domainId, actor, opts = {}) {
  const { BsiModeling, BsiTargetObject, Asset, BsiCatalogRequirement, BsiCatalogModule, BsiRequirement, User, Group, Document, ControlRequirement, Control } = getModels();
  const { Op } = require('sequelize');
  const domain = await domains.loadDomain(domainId);
  const visible = await domains.assetFilter(actor);

  const modelingRows = await BsiModeling.findAll({
    where: { domain_id: domain.id },
    include: [{ model: BsiTargetObject, as: 'targetObject', include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'type', 'owner_id', 'assessor_id'] }] }],
    order: [['id', 'ASC']],
  });
  let mods = modelingRows.filter(m => !m.target_object_id || (m.targetObject?.asset && visible(m.targetObject.asset)));
  if (opts.targetObjectId === 'domain') mods = mods.filter(m => m.target_object_id == null);
  else if (opts.targetObjectId != null && opts.targetObjectId !== '') {
    const t = await domains.loadTargetObject(domain, opts.targetObjectId, actor);
    mods = mods.filter(m => m.target_object_id === t.id);
  }

  const moduleIds = [...new Set(mods.map(m => m.module_id))];
  const [catReqs, catMods] = domain.catalog_id && moduleIds.length
    ? await Promise.all([
      BsiCatalogRequirement.findAll({
        where: { catalog_id: domain.catalog_id, module_id: moduleIds, withdrawn: false },
        attributes: ['module_id', 'req_id', 'title', 'requirement_level', 'sort_order'],
        order: [['sort_order', 'ASC']], raw: true,
      }),
      BsiCatalogModule.findAll({ where: { catalog_id: domain.catalog_id, module_id: moduleIds }, attributes: ['module_id', 'title', 'layer'], raw: true }),
    ])
    : [[], []];
  const modTitle = new Map(catMods.map(m => [m.module_id, m.title]));
  const reqsByModule = new Map();
  for (const r of catReqs) {
    if (!isRelevant(domain.protection_approach, r.requirement_level)) continue;
    if (!reqsByModule.has(r.module_id)) reqsByModule.set(r.module_id, []);
    reqsByModule.get(r.module_id).push(r);
  }

  const rows = await BsiRequirement.findAll({
    where: { domain_id: domain.id },
    include: [
      { model: User, as: 'responsible', attributes: ['id', 'name'] },
      { model: Group, as: 'responsibleGroup', attributes: ['id', 'name'] },
      { model: Document, as: 'evidence', attributes: ['id', 'original_name', 'asset_id', 'vendor_id', 'incident_id', 'category'], through: { attributes: [] } },
    ],
  });
  const key = (t, req) => `${t ?? 'domain'}|${req}`;
  const rowByKey = new Map(rows.map(r => [key(r.target_object_id, r.req_id), r]));

  // Massnahmen (controls) je Zeile, nur mit controls.view.
  const seeControls = await allowed(actor, 'controls', 'view', CONTROL_VIEW_FALLBACK);
  const controlsByRow = new Map();
  if (seeControls && rows.length) {
    const links = await ControlRequirement.findAll({
      where: { framework: 'bsi', requirement_id: { [Op.in]: rows.map(r => r.id) } },
      include: [{ model: Control, as: 'control', attributes: ['id', 'code', 'title', 'status'] }],
    });
    for (const l of links) {
      if (!l.control) continue;
      if (!controlsByRow.has(l.requirement_id)) controlsByRow.set(l.requirement_id, []);
      controlsByRow.get(l.requirement_id).push({ id: l.control.id, code: l.control.code, title: l.control.title, status: l.control.status, coverage: l.coverage });
    }
  }
  const docOk = await documentFilter(actor);

  const entries = [];
  const shownRowIds = new Set();
  for (const m of mods) {
    const target = m.targetObject;
    for (const r of reqsByModule.get(m.module_id) || []) {
      const row = rowByKey.get(key(m.target_object_id, r.req_id)) || null;
      if (row) shownRowIds.add(row.id);
      const docs = [];
      for (const d of row?.evidence || []) if (await docOk(d)) docs.push({ id: d.id, original_name: d.original_name, asset_id: d.asset_id, category: d.category });
      entries.push({
        entry_id: row ? row.id : null,
        target_object_id: m.target_object_id,
        target_name: target?.asset?.name || null,
        target_type: target?.target_type || null,
        module_id: m.module_id,
        module_title: modTitle.get(m.module_id) || null,
        req_id: r.req_id,
        title: r.title,
        requirement_level: r.requirement_level,
        implementation_status: row ? row.implementation_status : 'not_started',
        check_label: CHECK_LABELS[row ? row.implementation_status : 'not_started'],
        justification: row?.justification ?? null,
        responsible: row?.responsible ? { id: row.responsible.id, name: row.responsible.name } : null,
        responsible_group: row?.responsibleGroup ? { id: row.responsibleGroup.id, name: row.responsibleGroup.name } : null,
        due_date: row?.due_date ?? null,
        cost_once: row?.cost_once == null ? null : Number(row.cost_once),
        cost_recurring: row?.cost_recurring == null ? null : Number(row.cost_recurring),
        realization_priority: row?.realization_priority ?? null,
        notes: row?.notes ?? null,
        last_review_date: row?.last_review_date ?? null,
        documents: docs,
        controls: row ? (controlsByRow.get(row.id) || []) : [],
      });
    }
  }

  // Erfasster Stand ausserhalb der aktuellen Modellierung bzw. Absicherung:
  // wird nicht verworfen, sondern hier sichtbar gemacht.
  // Sichtbarkeit wie ueberall: ueber das Asset des Zielobjekts.
  let unmodeled = [];
  if (opts.targetObjectId == null || opts.targetObjectId === '') {
    const tos = await BsiTargetObject.findAll({ where: { domain_id: domain.id }, include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'owner_id', 'assessor_id'] }] });
    const visibleTargets = new Map(tos.filter(t => t.asset && visible(t.asset)).map(t => [t.id, t.asset.name]));
    unmodeled = rows
      .filter(r => !shownRowIds.has(r.id)
        && (r.implementation_status !== 'not_started' || r.justification || r.notes)
        && (r.target_object_id == null || visibleTargets.has(r.target_object_id)))
      .map(r => ({
        entry_id: r.id, target_object_id: r.target_object_id, target_name: r.target_object_id ? visibleTargets.get(r.target_object_id) : null,
        req_id: r.req_id, title: r.title, implementation_status: r.implementation_status, retired: r.retired,
      }));
  }

  // Additional requirements from the risk analysis (BSI-Standard 200-3 ch. 7,
  // 3.10.0): the measures of the risks classified for a target object, also
  // for target objects without a modelled module. Same visibility as above
  // for the target object; the measures follow the treatment plan rules.
  let additional = [];
  if (opts.withMeasures !== false && opts.targetObjectId !== 'domain') {
    const single = opts.targetObjectId != null && opts.targetObjectId !== '' ? domains.toId(opts.targetObjectId) : null;
    const tos = await BsiTargetObject.findAll({
      where: { domain_id: domain.id, ...(single ? { id: single } : {}) },
      include: [{ model: Asset, as: 'asset', attributes: ['id', 'name', 'owner_id', 'assessor_id'] }],
      order: [['id', 'ASC']],
    });
    const vis = tos.filter(t => t.asset && visible(t.asset));
    const byTarget = await require('./bsiRiskAnalysisService').measuresByTarget(domain.id, actor, new Set(vis.map(t => t.id)));
    additional = vis.filter(t => byTarget.has(t.id)).map(t => ({
      target_object_id: t.id, target_name: t.asset.name, target_type: t.target_type, measures: byTarget.get(t.id),
    }));
  }

  return {
    domain: { id: domain.id, name: domain.name, protection_approach: domain.protection_approach, catalog_id: domain.catalog_id, is_default: domain.is_default },
    levels: LEVELS_BY_APPROACH[domain.protection_approach],
    entries,
    unmodeled,
    additional_requirements: additional,
  };
}

/**
 * Status eines Eintrags setzen (anlegen, falls es noch keine Zeile gibt).
 * body: { target_object_id|null, req_id, implementation_status, justification,
 *         responsible_id, responsible_group_id, due_date, cost_once,
 *         cost_recurring, notes, last_review_date, document_ids?, control_ids? }
 */
async function setCheckEntry(domainId, body, actor) {
  const { sequelize, BsiModeling, BsiCatalogRequirement, BsiCatalogModule, BsiRequirement, BsiRequirementDocument, Document, ControlRequirement, Control } = getModels();
  const src = body && typeof body === 'object' ? body : {};
  const reqId = typeof src.req_id === 'string' ? src.req_id.trim().slice(0, 40) : '';
  if (!reqId) throw new CheckError(400, 'req_id fehlt');
  const docIds = hasOwn(src, 'document_ids') ? idList(src.document_ids, 'document_ids') : null;
  const controlIds = hasOwn(src, 'control_ids') ? idList(src.control_ids, 'control_ids') : null;

  return sequelize.transaction(async (transaction) => {
    const domain = await domains.loadDomain(domainId, transaction);
    if (!domain.catalog_id) throw new CheckError(409, 'Der Verbund hat keinen aktiven Katalog');
    let target = null;
    if (src.target_object_id !== undefined && src.target_object_id !== null && src.target_object_id !== '') {
      // prueft Verbund und Sichtbarkeit des Assets
      target = await domains.loadTargetObject(domain, src.target_object_id, actor, transaction);
    }
    const catReq = await BsiCatalogRequirement.findOne({ where: { catalog_id: domain.catalog_id, req_id: reqId }, raw: true, transaction });
    if (!catReq || catReq.withdrawn) throw new CheckError(404, 'Anforderung ist im Katalog des Verbunds nicht enthalten');
    const modeled = await BsiModeling.findOne({ where: { domain_id: domain.id, target_object_id: target ? target.id : null, module_id: catReq.module_id }, transaction });
    if (!modeled) throw new CheckError(409, `Baustein ${catReq.module_id} ist ${target ? 'diesem Zielobjekt' : 'dem Verbund'} nicht zugeordnet`);

    let row = await BsiRequirement.findOne({
      where: { domain_id: domain.id, target_object_id: target ? target.id : null, req_id: reqId },
      transaction, lock: transaction.LOCK.UPDATE,
    });
    const values = validateEntryInput(src, row);
    await checkReferences(values, transaction);
    let created = false;
    if (!row) {
      const mod = await BsiCatalogModule.findOne({ where: { catalog_id: domain.catalog_id, module_id: catReq.module_id }, raw: true, transaction });
      row = await BsiRequirement.create({
        domain_id: domain.id, target_object_id: target ? target.id : null, catalog_id: domain.catalog_id,
        req_id: reqId.slice(0, 30), baustein_id: catReq.module_id.slice(0, 20),
        baustein_name: (mod?.title || catReq.module_id).slice(0, 255), layer: catReq.layer,
        title: catReq.title, requirement_level: catReq.requirement_level, implementation_status: 'not_started',
      }, { transaction });
      created = true;
    }
    const { before, changes } = await applyEntryValues(row, values, transaction);

    // Nachweise: Liste ersetzt die bisherige. Pruefen, dass jedes neue Dokument
    // existiert und sichtbar ist; entfernt wird nur, was nicht mehr in der Liste
    // steht - und nur, was der Aufrufer sehen darf (fremde Nachweise bleiben).
    const docsAdded = [];
    const docsRemoved = [];
    if (docIds) {
      const docOk = await documentFilter(actor);
      const existing = await BsiRequirementDocument.findAll({ where: { requirement_id: row.id }, transaction });
      const have = new Set(existing.map(l => l.document_id));
      for (const id of docIds) {
        if (have.has(id)) continue;
        const doc = await Document.findByPk(id, { attributes: ['id', 'original_name', 'asset_id', 'vendor_id', 'incident_id'], transaction });
        if (!doc || !(await docOk(doc))) throw new CheckError(404, `Dokument ${id} nicht gefunden`);
        await BsiRequirementDocument.create({ requirement_id: row.id, document_id: id, created_by_id: actor?.id || null }, { transaction });
        docsAdded.push(id);
      }
      for (const l of existing) {
        if (docIds.includes(l.document_id)) continue;
        const doc = await Document.findByPk(l.document_id, { attributes: ['id', 'asset_id', 'vendor_id', 'incident_id'], transaction });
        if (doc && !(await docOk(doc))) continue;
        await l.destroy({ transaction });
        docsRemoved.push(l.document_id);
      }
    }

    // Massnahmen: Zuordnung ueber control_requirements (framework 'bsi'), wie
    // im Massnahmenkatalog. Aendern nur mit controls.edit.
    const controlsAdded = [];
    const controlsRemoved = [];
    if (controlIds) {
      const existing = await ControlRequirement.findAll({ where: { framework: 'bsi', requirement_id: row.id }, transaction });
      const have = new Set(existing.map(l => l.control_id));
      const toAdd = controlIds.filter(id => !have.has(id));
      const toRemove = existing.filter(l => !controlIds.includes(l.control_id));
      if ((toAdd.length || toRemove.length) && !(await allowed(actor, 'controls', 'edit', CONTROL_EDIT_FALLBACK))) {
        throw new CheckError(403, 'Massnahmen zuordnen erfordert die Berechtigung controls.edit');
      }
      for (const id of toAdd) {
        const c = await Control.findByPk(id, { attributes: ['id'], transaction });
        if (!c) throw new CheckError(404, `Massnahme ${id} nicht gefunden`);
        await ControlRequirement.create({ control_id: id, framework: 'bsi', requirement_id: row.id, coverage: 'full', created_by_id: actor?.id || null }, { transaction });
        controlsAdded.push(id);
      }
      for (const l of toRemove) { await l.destroy({ transaction }); controlsRemoved.push(l.control_id); }
    }

    return {
      domain, row, created, before, changes, target: target ? { id: target.id, asset_id: target.asset_id, name: target.asset?.name } : null,
      docsAdded, docsRemoved, controlsAdded, controlsRemoved,
    };
  });
}

function idList(v, field) {
  if (!Array.isArray(v) || v.length > 200) throw new CheckError(400, `${field} muss eine Liste von IDs sein (hoechstens 200)`);
  const out = [];
  for (const x of v) {
    const id = domains.toId(x);
    if (!id) throw new CheckError(400, `${field} enthaelt eine ungueltige ID`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Dokumente, die als Nachweis verknuepft werden koennen: die der Assets der Zielobjekte (sichtbare). */
async function linkableDocuments(domainId, targetObjectId, actor) {
  const { BsiTargetObject, Asset, Document } = getModels();
  const domain = await domains.loadDomain(domainId);
  let assetIds;
  if (targetObjectId != null && targetObjectId !== '') {
    const t = await domains.loadTargetObject(domain, targetObjectId, actor);
    assetIds = [t.asset_id];
  } else {
    const visible = await domains.assetFilter(actor);
    const tos = await BsiTargetObject.findAll({ where: { domain_id: domain.id }, include: [{ model: Asset, as: 'asset', attributes: ['id', 'owner_id', 'assessor_id'] }] });
    assetIds = tos.filter(t => t.asset && visible(t.asset)).map(t => t.asset_id);
  }
  if (!assetIds.length) return [];
  const docOk = await documentFilter(actor);
  const docs = await Document.findAll({ where: { asset_id: assetIds }, attributes: ['id', 'original_name', 'asset_id', 'vendor_id', 'incident_id', 'category', 'created_at'], order: [['created_at', 'DESC']], limit: 500 });
  const out = [];
  for (const d of docs) if (await docOk(d)) out.push({ id: d.id, original_name: d.original_name, asset_id: d.asset_id, category: d.category });
  return out;
}

module.exports = {
  CheckError,
  CHECK_LABELS,
  JUSTIFICATION_REQUIRED,
  REALIZATION_PRIORITIES,
  LEVELS_BY_APPROACH,
  A4_COLUMNS,
  isRelevant,
  validateEntryInput,
  checkReferences,
  applyEntryValues,
  summarize,
  neutralize,
  buildA4Rows,
  getCheck,
  setCheckEntry,
  linkableDocuments,
};
