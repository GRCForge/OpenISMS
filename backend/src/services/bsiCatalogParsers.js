'use strict';

/**
 * Parser fuer Grundschutz-Kataloge. Reine Funktionen, keine Datenbank.
 *
 * Ergebnis aller Parser:
 *   { meta: { title, version, oscalVersion }, modules: [...], requirements: [...] }
 *   module:      { module_id, title, layer, kind, sort_order }
 *   requirement: { module_id, req_id, parent_req_id, title, layer, requirement_level,
 *                  modal_verb, effort_level, target_object_categories, roles,
 *                  text, guidance, withdrawn, sort_order }
 *
 * Formate:
 *   - Kompendium-XML: DocBook 5, wie das BSI das IT-Grundschutz-Kompendium
 *     (Edition 2023) als XML veroeffentlicht. Bausteine sind <section> mit Titel
 *     "ISMS.1 Sicherheitsmanagement", Anforderungen <section> mit Titel
 *     "ISMS.1.A1 Titel (B) [Rolle]"; der Anforderungstext steht in <para>.
 *   - OSCAL catalog (JSON): catalog.groups[] -> groups[] -> controls[] -> controls[].
 *     Im Grundschutz++-Anwenderkatalog des BSI (Stand-der-Technik-Bibliothek,
 *     OSCAL 1.1.3) sind die obersten Gruppen die Praktiken (GC, STM, ...), die
 *     zweite Ebene deren Themen (GC.1 ...), die Controls die Anforderungen.
 *     Absicherungsstufe: prop "sec_level" (normal-SdT | erhöht), Aufwand:
 *     "effort_level", im statement-Part "modal_verb" und
 *     "target_object_categories". Andere OSCAL-Kataloge ohne diese Props werden
 *     generisch gelesen (Stufe bleibt leer).
 *
 * Sicherheit (Eingaben stammen von Uploads oder fremden URLs):
 *   - Groessenlimit vor dem Parsen (MAX_CATALOG_BYTES)
 *   - XML: Ein Dokument mit DOCTYPE wird abgelehnt. Damit gibt es weder externe
 *     Entitaeten (XXE) noch interne Entitaetsdefinitionen (Billion Laughs).
 *     saxes laedt ohnehin nichts nach und kennt nur die fuenf vordefinierten
 *     Entitaeten; die Ablehnung macht das unabhaengig vom Parser ausdruecklich.
 *   - Obergrenzen fuer Anzahl Anforderungen, Verschachtelungstiefe, Feldlaengen.
 */

const { SaxesParser } = require('saxes');

const MAX_CATALOG_BYTES = 25 * 1024 * 1024;
const MAX_REQUIREMENTS = 20000;
const MAX_MODULES = 5000;
const MAX_DEPTH = 12;
const MAX_TEXT = 100_000;

class CatalogParseError extends Error {
  constructor(message) { super(message); this.name = 'CatalogParseError'; this.status = 422; }
}

const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s);
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ── Kompendium-XML (DocBook) ────────────────────────────────────────────────

const RE_REQ = /^([A-Z]{3,4}(?:\.\d+)+\.A\d+)\s+(.*)$/;
const RE_MODULE = /^([A-Z]{3,4}(?:\.\d+)+)\s+(.+)$/;
const LEVEL_BY_LETTER = { B: 'basis', S: 'standard', H: 'erhoehter_schutzbedarf' };

/** Zerlegt "Titel (B) [Rolle, Rolle]" in Titel, Stufe, Rollen. */
function splitKompendiumTitle(rest) {
  let s = squash(rest);
  let roles = null;
  const r = s.match(/\[([^\]]*)\]\s*$/);
  if (r) { roles = squash(r[1]) || null; s = s.slice(0, r.index).trim(); }
  let level = null;
  const l = s.match(/\(([BSH])\)\s*$/);
  if (l) { level = LEVEL_BY_LETTER[l[1]]; s = s.slice(0, l.index).trim(); }
  const withdrawn = /^ENTFALLEN\b/i.test(s);
  return { title: s, level, roles, withdrawn };
}

function parseKompendiumXml(input) {
  const xml = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  if (Buffer.byteLength(xml) > MAX_CATALOG_BYTES) throw new CatalogParseError('Datei ist zu gross');

  const parser = new SaxesParser({ xmlns: false, position: false });
  const modules = [];
  const requirements = [];
  const moduleIds = new Set();
  const reqIds = new Set();

  // Stapel offener <section>: { title, kind: 'module'|'req'|null, data }
  const sections = [];
  let titleBuf = null;   // sammelt Text eines <title>, solange offen
  let paraBuf = null;    // sammelt Text eines <para> innerhalb einer Anforderung
  let paraDepth = 0;
  let listDepth = 0;
  let currentModule = null;
  let currentReq = null;
  let depth = 0;
  let sawRoot = false;

  parser.on('doctype', () => { throw new CatalogParseError('XML mit DOCTYPE wird nicht angenommen'); });
  parser.on('opentag', (node) => {
    depth++;
    if (depth > 200) throw new CatalogParseError('XML ist zu tief verschachtelt');
    const name = node.name.replace(/^.*:/, '');
    if (!sawRoot) {
      sawRoot = true;
      if (name !== 'book') throw new CatalogParseError('Kein DocBook-Dokument (Wurzelelement ist nicht <book>)');
    }
    if (name === 'section' || name === 'chapter') {
      sections.push({ name, title: null, kind: null });
    } else if (name === 'title' && sections.length && sections[sections.length - 1].title === null) {
      titleBuf = '';
    } else if (name === 'para' && currentReq) {
      if (paraDepth === 0) paraBuf = '';
      paraDepth++;
    } else if ((name === 'itemizedlist' || name === 'orderedlist') && currentReq) {
      listDepth++;
    }
  });
  parser.on('text', (t) => {
    if (titleBuf !== null) titleBuf += t;
    else if (paraBuf !== null) paraBuf += t;
  });
  parser.on('closetag', (node) => {
    depth--;
    const name = node.name.replace(/^.*:/, '');
    if (name === 'title' && titleBuf !== null) {
      const sec = sections[sections.length - 1];
      sec.title = squash(titleBuf);
      titleBuf = null;
      if (sec.name !== 'section') return;
      const req = sec.title.match(RE_REQ);
      if (req && currentModule && req[1].startsWith(currentModule.module_id + '.A')) {
        if (reqIds.has(req[1])) throw new CatalogParseError(`Anforderung ${req[1]} doppelt vorhanden`);
        const parts = splitKompendiumTitle(req[2]);
        sec.kind = 'req';
        currentReq = {
          module_id: currentModule.module_id,
          req_id: req[1],
          parent_req_id: null,
          title: clip(parts.title, 255),
          layer: currentModule.layer,
          requirement_level: parts.level,
          modal_verb: null,
          effort_level: null,
          target_object_categories: null,
          roles: clip(parts.roles, 255),
          paragraphs: [],
          guidance: null,
          withdrawn: parts.withdrawn,
          sort_order: requirements.length,
        };
        reqIds.add(req[1]);
        return;
      }
      const mod = !req && sec.title.match(RE_MODULE);
      if (mod) {
        if (moduleIds.has(mod[1])) throw new CatalogParseError(`Baustein ${mod[1]} doppelt vorhanden`);
        sec.kind = 'module';
        currentModule = {
          module_id: mod[1],
          title: clip(squash(mod[2]), 255),
          layer: mod[1].split('.')[0],
          kind: 'baustein',
          sort_order: modules.length,
        };
        moduleIds.add(mod[1]);
        modules.push(currentModule);
        if (modules.length > MAX_MODULES) throw new CatalogParseError('Zu viele Bausteine');
      }
    } else if (name === 'para' && currentReq && paraDepth > 0) {
      paraDepth--;
      if (paraDepth === 0) {
        const p = squash(paraBuf);
        if (p) currentReq.paragraphs.push(listDepth > 0 ? `• ${p}` : p);
        paraBuf = null;
      }
    } else if ((name === 'itemizedlist' || name === 'orderedlist') && currentReq) {
      listDepth = Math.max(0, listDepth - 1);
    } else if (name === 'section' || name === 'chapter') {
      const sec = sections.pop();
      if (sec && sec.kind === 'req' && currentReq) {
        const { paragraphs, ...rest } = currentReq;
        requirements.push({ ...rest, text: clip(paragraphs.join('\n\n'), MAX_TEXT) || null });
        if (requirements.length > MAX_REQUIREMENTS) throw new CatalogParseError('Zu viele Anforderungen');
        currentReq = null;
        listDepth = 0;
      } else if (sec && sec.kind === 'module') {
        currentModule = null;
      }
    }
  });

  try {
    parser.write(xml).close();
  } catch (e) {
    if (e instanceof CatalogParseError) throw e;
    throw new CatalogParseError(`XML ist nicht wohlgeformt: ${squash(e.message).slice(0, 200)}`);
  }
  if (!requirements.length) throw new CatalogParseError('Keine Anforderungen gefunden (erwartet: Abschnitte "XXX.n.An Titel (B)")');

  // Bausteine ohne Anforderungen (Schicht-Einleitungen o. ae.) weglassen.
  const used = new Set(requirements.map(r => r.module_id));
  return {
    meta: { title: 'IT-Grundschutz-Kompendium', version: null, oscalVersion: null },
    modules: modules.filter(m => used.has(m.module_id)).map((m, i) => ({ ...m, sort_order: i })),
    requirements,
  };
}

// ── OSCAL catalog (JSON) ────────────────────────────────────────────────────

const propOf = (obj, name) => (Array.isArray(obj?.props) ? obj.props.find(p => p && p.name === name) : undefined);
const GSPP_LEVELS = { 'normal-sdt': 'normal_sdt', 'erhöht': 'erhoeht', 'erhoeht': 'erhoeht' };

/** Ersetzt OSCAL-Parameter-Platzhalter {{ insert: param, id }} durch Wert oder Label. */
function renderProse(prose, params) {
  if (typeof prose !== 'string') return '';
  return prose.replace(/\{\{\s*insert:\s*param,\s*([^\s}]+)\s*\}\}/g, (_, id) => {
    const p = params.get(id);
    if (!p) return `[${id}]`;
    if (Array.isArray(p.values) && p.values.length) return p.values.join(', ');
    return p.label ? `[${p.label}]` : `[${id}]`;
  });
}

function collectProse(parts, names, params, out = []) {
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== 'object') continue;
    if (names.includes(part.name) && part.prose) out.push(squash(renderProse(part.prose, params)));
    if (part.parts) collectProse(part.parts, ['item', ...names], params, out);
  }
  return out;
}

function parseOscalCatalog(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) throw new CatalogParseError('Datei ist zu gross');
  let doc;
  try { doc = JSON.parse(text); } catch { throw new CatalogParseError('Keine gueltige JSON-Datei'); }
  const catalog = doc && typeof doc === 'object' ? doc.catalog : null;
  if (!catalog || typeof catalog !== 'object') {
    throw new CatalogParseError('Kein OSCAL-Katalog (erwartet: Objekt "catalog"; Profile und Mapping-Collections werden nicht unterstuetzt)');
  }

  const modules = [];
  const requirements = [];
  const moduleIds = new Set();
  const reqIds = new Set();

  const addControl = (ctl, mod, parentId, depth) => {
    if (depth > MAX_DEPTH) throw new CatalogParseError('Controls sind zu tief verschachtelt');
    if (!ctl || typeof ctl !== 'object' || typeof ctl.id !== 'string' || !ctl.id) return;
    const reqId = clip(ctl.id, 40);
    if (reqIds.has(reqId)) throw new CatalogParseError(`Control ${reqId} doppelt vorhanden`);
    reqIds.add(reqId);
    const params = new Map((Array.isArray(ctl.params) ? ctl.params : []).filter(p => p && p.id).map(p => [p.id, p]));
    const statement = (Array.isArray(ctl.parts) ? ctl.parts : []).find(p => p && p.name === 'statement');
    const secLevel = propOf(ctl, 'sec_level');
    const effort = propOf(ctl, 'effort_level');
    const modal = propOf(statement, 'modal_verb');
    const targets = propOf(statement, 'target_object_categories');
    const status = propOf(ctl, 'status');
    const label = propOf(ctl, 'label');
    const effortNum = effort ? Number.parseInt(effort.value, 10) : NaN;
    const statementText = collectProse(ctl.parts, ['statement'], params).join('\n\n');
    const guidanceText = collectProse(ctl.parts, ['guidance'], params).join('\n\n');
    requirements.push({
      module_id: mod.module_id,
      req_id: reqId,
      parent_req_id: parentId,
      title: clip(squash(ctl.title || label?.value || reqId), 255),
      layer: mod.layer,
      requirement_level: secLevel ? (GSPP_LEVELS[String(secLevel.value).toLowerCase()] || null) : null,
      modal_verb: modal ? clip(String(modal.value), 20) : null,
      effort_level: Number.isInteger(effortNum) ? effortNum : null,
      target_object_categories: targets
        ? String(targets.value).split(',').map(squash).filter(Boolean).slice(0, 50)
        : null,
      roles: null,
      text: clip(statementText, MAX_TEXT) || null,
      guidance: clip(guidanceText, MAX_TEXT) || null,
      withdrawn: !!(status && /withdrawn/i.test(String(status.value))),
      sort_order: requirements.length,
    });
    if (requirements.length > MAX_REQUIREMENTS) throw new CatalogParseError('Zu viele Anforderungen');
    for (const child of Array.isArray(ctl.controls) ? ctl.controls : []) addControl(child, mod, reqId, depth + 1);
  };

  const addModule = (id, title, layer, kind) => {
    const moduleId = clip(id, 40);
    if (moduleIds.has(moduleId)) return modules.find(m => m.module_id === moduleId);
    const mod = { module_id: moduleId, title: clip(squash(title) || moduleId, 255), layer: clip(layer, 20), kind, sort_order: modules.length };
    moduleIds.add(moduleId);
    modules.push(mod);
    if (modules.length > MAX_MODULES) throw new CatalogParseError('Zu viele Gruppen');
    return mod;
  };

  // Gruppen: Die oberste Ebene bestimmt die Schicht/Praktik. Controls einer
  // Gruppe landen im Modul der Gruppe, in der sie direkt stehen; tiefer
  // verschachtelte Gruppen werden zu eigenen Modulen mit derselben Schicht.
  const walkGroup = (group, layer, path, depth) => {
    if (depth > MAX_DEPTH) throw new CatalogParseError('Gruppen sind zu tief verschachtelt');
    if (!group || typeof group !== 'object') return;
    const gid = typeof group.id === 'string' && group.id ? group.id : `${layer}.${path.length}`;
    const title = depth === 0 ? group.title : [...path, group.title].filter(Boolean).join(' › ');
    const ctls = Array.isArray(group.controls) ? group.controls : [];
    if (ctls.length) {
      const mod = addModule(gid, title, layer, 'praktik');
      for (const c of ctls) addControl(c, mod, null, 0);
    }
    for (const sub of Array.isArray(group.groups) ? group.groups : []) {
      walkGroup(sub, layer, depth === 0 ? [group.title] : [...path, group.title], depth + 1);
    }
  };

  for (const g of Array.isArray(catalog.groups) ? catalog.groups : []) {
    const layer = typeof g?.id === 'string' && g.id ? g.id : 'OSCAL';
    walkGroup(g, layer, [], 0);
  }
  // Controls direkt am Katalog (ohne Gruppe)
  const top = Array.isArray(catalog.controls) ? catalog.controls : [];
  if (top.length) {
    const mod = addModule('_', catalog.metadata?.title || 'Katalog', 'OSCAL', 'praktik');
    for (const c of top) addControl(c, mod, null, 0);
  }

  if (!requirements.length) throw new CatalogParseError('Der OSCAL-Katalog enthaelt keine Controls');
  const md = catalog.metadata || {};
  return {
    meta: {
      title: clip(squash(md.title), 255) || 'OSCAL-Katalog',
      version: clip(squash(md.version), 120) || null,
      oscalVersion: clip(squash(md['oscal-version']), 20) || null,
    },
    modules,
    requirements,
  };
}

/** Erkennt das Format am Inhalt: '<' -> Kompendium-XML, '{' -> OSCAL-JSON. */
function detectFormat(buf) {
  const head = (Buffer.isBuffer(buf) ? buf.subarray(0, 512).toString('utf8') : String(buf).slice(0, 512))
    .replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) return 'kompendium_xml';
  if (head.startsWith('{')) return 'oscal_catalog';
  return null;
}

function parseCatalog(buf, format) {
  const fmt = format && format !== 'auto' ? format : detectFormat(buf);
  if (fmt === 'kompendium_xml') return { format: fmt, ...parseKompendiumXml(buf) };
  if (fmt === 'oscal_catalog') return { format: fmt, ...parseOscalCatalog(buf) };
  throw new CatalogParseError('Format nicht erkannt (erwartet: Kompendium-XML oder OSCAL-JSON)');
}

// ── Vergleich ────────────────────────────────────────────────────────────────

const DIFF_FIELDS = ['title', 'module_id', 'layer', 'requirement_level', 'text', 'withdrawn'];

/**
 * Vergleicht zwei Anforderungslisten ueber req_id.
 * @returns {{added: object[], changed: {req_id, fields: string[], before, after}[], removed: object[], unchanged: number}}
 */
function diffRequirements(before, after) {
  const norm = (v) => (v === undefined || v === '' ? null : v);
  const old = new Map((before || []).map(r => [r.req_id, r]));
  const added = [];
  const changed = [];
  let unchanged = 0;
  for (const r of after || []) {
    const o = old.get(r.req_id);
    if (!o) { added.push(r); continue; }
    old.delete(r.req_id);
    const fields = DIFF_FIELDS.filter(f => norm(o[f]) !== norm(r[f]));
    if (fields.length) changed.push({ req_id: r.req_id, fields, before: o, after: r });
    else unchanged++;
  }
  return { added, changed, removed: [...old.values()], unchanged };
}

module.exports = {
  MAX_CATALOG_BYTES,
  CatalogParseError,
  splitKompendiumTitle,
  parseKompendiumXml,
  parseOscalCatalog,
  renderProse,
  detectFormat,
  parseCatalog,
  diffRequirements,
};
