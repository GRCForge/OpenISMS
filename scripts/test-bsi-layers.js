#!/usr/bin/env node
'use strict';

/**
 * Schichtkuerzel und Umsetzungsstatus der BSI-Grundschutz-MCP-Tools.
 *
 * Prueft die Normalisierung (ORG -> ORP, Altwerte ja/teilweise/nein/entbehrlich)
 * und fuehrt die echten Tool-Definitionen aus backend/src/mcp/server.js aus:
 * Schema-Validierung mit zod und den Handler mit einem gemockten Modell, das
 * die WHERE-Klausel festhaelt. Keine Datenbank noetig.
 *
 * Run: node scripts/test-bsi-layers.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'backend', 'src');
const { z } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'zod'));
const { Op } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sequelize'));
const bsi = require(path.join(SRC, 'services', 'bsiLayers'));
const catalog = require(path.join(SRC, 'services', 'bsiCatalog'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

console.log('Schichten des Kompendiums:');
eq('zehn Schichten in Kompendium-Reihenfolge', bsi.BSI_LAYERS, ['ISMS', 'ORP', 'CON', 'OPS', 'DER', 'APP', 'SYS', 'IND', 'NET', 'INF']);
eq('ORG ist keine Schicht', bsi.BSI_LAYERS.includes('ORG'), false);
eq('jede Schicht des Seed-Katalogs ist bekannt', catalog.filter(c => !bsi.BSI_LAYERS.includes(c.layer)).map(c => c.req_id), []);

console.log('\nnormalizeBsiLayer:');
eq('ORP bleibt ORP', bsi.normalizeBsiLayer('ORP'), 'ORP');
eq('ORG wird ORP (Alias)', bsi.normalizeBsiLayer('ORG'), 'ORP');
eq('Kleinschreibung', bsi.normalizeBsiLayer(' sys '), 'SYS');
eq('IND bekannt', bsi.normalizeBsiLayer('IND'), 'IND');
eq('unbekanntes Kuerzel', bsi.normalizeBsiLayer('XYZ'), null);
eq('kein String', bsi.normalizeBsiLayer(undefined), null);

console.log('\nnormalizeBsiStatus:');
eq('ja → implemented', bsi.normalizeBsiStatus('ja'), 'implemented');
eq('teilweise → in_progress', bsi.normalizeBsiStatus('teilweise'), 'in_progress');
eq('nein → not_started', bsi.normalizeBsiStatus('nein'), 'not_started');
eq('entbehrlich → not_applicable', bsi.normalizeBsiStatus('entbehrlich'), 'not_applicable');
eq('Modellwert bleibt', bsi.normalizeBsiStatus('implemented'), 'implemented');
eq('unbekannt', bsi.normalizeBsiStatus('vielleicht'), null);

// ── Echte Tool-Definitionen ausfuehren ───────────────────────────────────────
// Die Tools liegen modulprivat in server.js; den Block herausloesen statt ihn
// nur fuer den Test zu exportieren (wie scripts/test-mcp-gate.js).
const source = fs.readFileSync(path.join(SRC, 'mcp', 'server.js'), 'utf8');
function loadTool(name) {
  const start = source.indexOf(`server.tool(\n  '${name}'`);
  const end = source.indexOf('\n);\n', start);
  if (start < 0 || end < 0) throw new Error(`${name} nicht gefunden`);
  const tools = {};
  const fakeServer = { tool: (n, d, schema, cb) => { tools[n] = { description: d, schema, cb }; } };
  new Function('server', 'z', 'Op', 'getModels', 'logAudit',
    'BSI_LAYERS', 'BSI_LAYER_ALIASES', 'normalizeBsiLayer', 'BSI_STATUSES', 'BSI_STATUS_ALIASES', 'normalizeBsiStatus', 'bsiDomains',
    source.slice(start, end + 3))(
    fakeServer, z, Op, () => models, async () => {},
    bsi.BSI_LAYERS, bsi.LAYER_ALIASES, bsi.normalizeBsiLayer, bsi.BSI_STATUSES, bsi.STATUS_ALIASES, bsi.normalizeBsiStatus,
    // Standard-Verbund ohne Datenbank: Filter auf domain_id = 1.
    { baselineWhere: async () => ({ domain_id: 1 }) });
  return tools[name];
}

let lastWhere = null;
let lastUpdate = null;
const models = {
  User: {},
  BsiRequirement: {
    findAll: async ({ where }) => { lastWhere = where; return []; },
    findByPk: async (id) => ({ id, req_id: 'ORP.1.A1', update: async (u) => { lastUpdate = u; } }),
  },
};

(async () => {
  const list = loadTool('isms_list_bsi_requirements');
  const shape = z.object(list.schema);

  console.log('\nisms_list_bsi_requirements — Beschreibung:');
  const layerDesc = list.schema.layer.description || '';
  eq('nennt ORP', layerDesc.includes('ORP'), true);
  eq('nennt IND und NET', layerDesc.includes('IND') && layerDesc.includes('NET'), true);
  eq('nennt ORG nur als Alias', /ORG"? is accepted as an alias/.test(layerDesc), true);

  console.log('\nisms_list_bsi_requirements — Validierung und Filter:');
  eq('layer=ORP gueltig', shape.safeParse({ layer: 'ORP' }).success, true);
  eq('layer=ORG gueltig (Alias)', shape.safeParse({ layer: 'ORG' }).success, true);
  eq('layer=XYZ abgelehnt', shape.safeParse({ layer: 'XYZ' }).success, false);

  await list.cb(shape.parse({ layer: 'ORG' }), {});
  eq('ORG filtert auf ORP', lastWhere.layer, 'ORP');
  await list.cb(shape.parse({ layer: 'NET', status: 'ja' }), {});
  eq('NET bleibt NET', lastWhere.layer, 'NET');
  eq('status=ja filtert auf implemented', lastWhere.implementation_status, 'implemented');
  await list.cb(shape.parse({}), {});
  eq('ohne Filter keine Bedingung', [lastWhere.layer, lastWhere.implementation_status], [undefined, undefined]);
  eq('nur der Standard-Verbund, nur aktive', [lastWhere.domain_id, lastWhere.retired], [1, false]);

  console.log('\nisms_update_bsi_requirement — Status:');
  const upd = loadTool('isms_update_bsi_requirement');
  const updShape = z.object(upd.schema);
  await upd.cb(updShape.parse({ id: 1, implementation_status: 'teilweise' }), {});
  eq('teilweise wird als in_progress gespeichert', lastUpdate.implementation_status, 'in_progress');
  await upd.cb(updShape.parse({ id: 1, implementation_status: 'not_applicable' }), {});
  eq('Modellwert wird unveraendert gespeichert', lastUpdate.implementation_status, 'not_applicable');
  await upd.cb(updShape.parse({ id: 1, notes: 'x' }), {});
  eq('ohne Status kein Status im Update', 'implementation_status' in lastUpdate, false);
  eq('unbekannter Status abgelehnt', updShape.safeParse({ id: 1, implementation_status: 'vielleicht' }).success, false);

  console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
