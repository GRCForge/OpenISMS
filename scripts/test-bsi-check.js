#!/usr/bin/env node
'use strict';

/**
 * IT-Grundschutz-Check - ohne Datenbank.
 *
 *   - Absicherungsvariante filtert die Anforderungsstufen (basis/standard/kern)
 *   - Status "nein" ist ein eigener Wert (not_implemented), keine Naeherung
 *   - Begruendungspflicht bei nein/entbehrlich, Datums- und Betragspruefung,
 *     nur erlaubte Felder
 *   - Erfuellungsgrad und Kostensummen je Baustein und Zielobjekt
 *   - A.4-Export: Spaltenfolge, Formel-Neutralisierung, Kosten als Zahl
 *   - jeder Schreibweg (REST-Check, bisherige Liste, beide MCP-Tools) nutzt
 *     dieselbe Validierung; Lesen/Auswertung/Export dieselbe Funktion
 *
 * Run: node scripts/test-bsi-check.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'backend', 'src');
const check = require(path.join(SRC, 'services', 'bsiCheckService'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const err = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.status || e.message; } };

console.log('Absicherungsvariante:');
const lv = (a) => ['basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht', null].filter(l => check.isRelevant(a, l));
eq('basis: B (GS++: normal-SdT), ohne Stufe immer', lv('basis'), ['basis', 'normal_sdt', null]);
eq('standard: B+S (GS++: normal-SdT)', lv('standard'), ['basis', 'standard', 'normal_sdt', null]);
eq('kern: B+S+H (GS++: normal-SdT+erhoeht)', lv('kern'), ['basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht', null]);

console.log('\nStatus und Pflichtfelder:');
eq('Check-Bezeichnungen', check.CHECK_LABELS, { implemented: 'ja', in_progress: 'teilweise', not_implemented: 'nein', not_applicable: 'entbehrlich', not_started: 'offen' });
eq('nein ohne Begruendung → 400', err(() => check.validateEntryInput({ implementation_status: 'not_implemented' }, null)), 400);
eq('entbehrlich ohne Begruendung → 400', err(() => check.validateEntryInput({ implementation_status: 'not_applicable', justification: '  ' }, null)), 400);
eq('nein mit Begruendung ok', check.validateEntryInput({ implementation_status: 'not_implemented', justification: 'Risiko uebernommen' }, null),
  { implementation_status: 'not_implemented', justification: 'Risiko uebernommen' });
eq('Begruendung schon gespeichert → Status allein ok', check.validateEntryInput({ implementation_status: 'not_applicable' }, { implementation_status: 'in_progress', justification: 'vorhanden' }),
  { implementation_status: 'not_applicable' });
eq('Begruendung bei entbehrlich leeren → 400', err(() => check.validateEntryInput({ justification: '' }, { implementation_status: 'not_applicable', justification: 'x' })), 400);
eq('Bestand ohne Begruendung: Notiz aendern bleibt moeglich', check.validateEntryInput({ notes: 'n' }, { implementation_status: 'not_applicable', justification: null }), { notes: 'n' });
eq('unbekannter Status → 400', err(() => check.validateEntryInput({ implementation_status: 'nein' }, null)), 400);
eq('Datum geprueft', err(() => check.validateEntryInput({ due_date: '31.12.2026' }, null)), 400);
eq('Datum ok', check.validateEntryInput({ due_date: '2026-12-31' }, null), { due_date: '2026-12-31' });
eq('Kosten: Komma, zwei Stellen', check.validateEntryInput({ cost_once: '1200,50', cost_recurring: 300 }, null), { cost_once: 1200.5, cost_recurring: 300 });
eq('Kosten negativ → 400', err(() => check.validateEntryInput({ cost_once: -1 }, null)), 400);
eq('Kosten Text → 400', err(() => check.validateEntryInput({ cost_once: '=1+1' }, null)), 400);
eq('Verantwortlicher ID geprueft', err(() => check.validateEntryInput({ responsible_id: 'abc' }, null)), 400);
eq('nur erlaubte Felder (domain_id, target_object_id, req_id, catalog_id, id fallen weg)',
  Object.keys(check.validateEntryInput({ domain_id: 9, target_object_id: 9, req_id: 'X', catalog_id: 9, id: 9, retired: true, notes: 'a' }, null)), ['notes']);

console.log('\nAuswertung:');
const E = (t, m, s, c1, c2) => ({ target_object_id: t, target_name: t ? `T${t}` : null, target_type: t ? 'it_system' : null, module_id: m, module_title: m, implementation_status: s, cost_once: c1, cost_recurring: c2 });
const sum = check.summarize([
  E(1, 'SYS.1.1', 'implemented', 100, 10), E(1, 'SYS.1.1', 'in_progress', 50.5, null), E(1, 'SYS.1.1', 'not_applicable', null, null),
  E(1, 'SYS.1.1', 'not_implemented', null, null), E(null, 'ISMS.1', 'not_started', 0, 0), E(null, 'ISMS.1', 'implemented', null, 20),
]);
const sys = sum.by_module.find(b => b.module_id === 'SYS.1.1');
eq('SYS.1.1: (1 + 0,5) / (4 - 1) = 50 %', sys.fulfillment, 50);
eq('SYS.1.1: Zaehler', [sys.total, sys.implemented, sys.in_progress, sys.not_applicable, sys.not_implemented], [4, 1, 1, 1, 1]);
eq('SYS.1.1: Kosten', [sys.cost_once, sys.cost_recurring], [150.5, 10]);
eq('Verbundebene als eigenes Ziel', sum.by_target.map(b => [b.target_object_id, b.total, b.fulfillment]), [[1, 4, 50], [null, 2, 50]]);
eq('gesamt', [sum.total.total, sum.total.fulfillment, sum.total.cost_once, sum.total.cost_recurring], [6, 50, 150.5, 30]);
eq('nur entbehrlich → kein Erfuellungsgrad', check.summarize([E(1, 'X', 'not_applicable')]).total.fulfillment, null);

console.log('\nExport A.4:');
eq('neutralisiert =, +, -, @', ['=HYPERLINK("x")', '+1+2', '-cmd', '@SUM(A1)'].map(check.neutralize), ["'=HYPERLINK(\"x\")", "'+1+2", "'-cmd", "'@SUM(A1)"]);
eq('Zahlen bleiben', ['-5', '+3,5', '12'].map(check.neutralize), ['-5', '+3,5', '12']);
const a4 = check.buildA4Rows({
  domain: { name: '=Verbund' },
  entries: [{
    target_object_id: null, module_id: 'ISMS.1', module_title: 'Sicherheitsmanagement', req_id: 'ISMS.1.A1', title: '=cmd|calc',
    requirement_level: 'basis', implementation_status: 'not_implemented', justification: '@evil', responsible: { name: 'Max' }, responsible_group: { name: 'ISB' },
    due_date: '2026-12-31', cost_once: 1000, cost_recurring: null, documents: [{ original_name: '+doc.pdf' }], controls: [{ code: 'C-1', title: 'Leitlinie' }], notes: null, last_review_date: null,
  }],
});
eq('Spaltenzahl = Kopf', a4.rows[0].length, a4.columns.length);
eq('Spaltenfolge beginnt wie A.4', a4.columns.slice(0, 8), ['Zielobjekt', 'Zielobjekttyp', 'Baustein', 'Baustein-Titel', 'Anforderung', 'Titel', 'Stufe', 'Umsetzung']);
const col = (name) => a4.rows[0][a4.columns.indexOf(name)];
eq('Verbundzeile, Name neutralisiert im Text', col('Zielobjekt'), 'Informationsverbund: =Verbund');
eq('Titel neutralisiert', col('Titel'), "'=cmd|calc");
eq('Begruendung neutralisiert', col('Begründung'), "'@evil");
eq('Status als BSI-Wort', col('Umsetzung'), 'nein');
eq('Stufe B', col('Stufe'), 'B');
eq('Verantwortlich Person / Gruppe', col('Verantwortlich'), 'Max / ISB');
eq('Kosten als Zahl, leer als null', [col('Kosten einmalig (EUR)'), col('Kosten laufend (EUR/Jahr)')], [1000, null]);
eq('Nachweis neutralisiert', col('Nachweise'), "'+doc.pdf");

// ── Statische Pruefungen: ein Weg zur Validierung, ein Weg zum Lesen ────────
console.log('\nSchreib- und Lesewege:');
const routes = fs.readFileSync(path.join(SRC, 'routes', 'bsi-domains.js'), 'utf8');
const line = (re) => (routes.match(re) || [''])[0];
const putCheck = line(/router\.put\('\/:id\/check'[^\n]*/);
eq('PUT /:id/check: bsi_grundschutz.edit + requireWriteAccess', [putCheck.includes("requirePermission('bsi_grundschutz','edit'"), putCheck.includes('requireWriteAccess()')], [true, true]);
for (const p of ['/:id/check', '/:id/check/summary', '/:id/check/export', '/:id/check/documents']) {
  eq(`GET ${p}: bsi_grundschutz.view`, line(new RegExp(`router\\.get\\('${p.replace(/\//g, '\\/')}'[^\\n]*`)).includes("requirePermission('bsi_grundschutz','view'"), true);
}
const routeBody = (p) => { const i = routes.indexOf(`router.get('${p}'`); return routes.slice(i, routes.indexOf('\n});', i)); };
eq('Liste, Auswertung und Export lesen ueber getCheck mit req.user',
  ['/:id/check', '/:id/check/summary', '/:id/check/export'].every(p => routeBody(p).includes('check.getCheck(req.params.id, req.user')), true);
eq('PUT schreibt ueber setCheckEntry und Audit-Log', (() => { const i = routes.indexOf("router.put('/:id/check'"); const b = routes.slice(i, routes.indexOf('\n});', i)); return b.includes('check.setCheckEntry(req.params.id, req.body, req.user)') && b.includes('auditFromReq('); })(), true);

const legacy = fs.readFileSync(path.join(SRC, 'routes', 'bsi-grundschutz.js'), 'utf8');
eq('bisherige Liste: PUT validiert ueber validateEntryInput', legacy.includes('check.validateEntryInput(pick(req.body, LEGACY_FIELDS), item)'), true);
eq('bisherige Liste: PUT/DELETE nur am Standard-Verbund', (legacy.match(/findBaselineRow\(req\.params\.id\)/g) || []).length, 2);

const mcp = fs.readFileSync(path.join(SRC, 'mcp', 'server.js'), 'utf8');
const gates = mcp.slice(0, mcp.indexOf('async function gateTool'));
const gate = (n) => (gates.match(new RegExp(`'${n}':\\s*\\{([^}]*)\\}`)) || ['', ''])[1];
eq('isms_get_bsi_check: view + Modul', [gate('isms_get_bsi_check').includes("perm: ['bsi_grundschutz', 'view']"), gate('isms_get_bsi_check').includes("moduleKey: 'bsi_grundschutz'")], [true, true]);
eq('isms_set_bsi_check_status: edit + Modul + needsWrite + Rollen wie REST',
  ["perm: ['bsi_grundschutz', 'edit']", "moduleKey: 'bsi_grundschutz'", 'needsWrite: true', "requiredRoles: ['admin', 'assessor', 'it-staff']"].map(x => gate('isms_set_bsi_check_status').includes(x)), [true, true, true, true]);
const block = (n) => { const i = mcp.indexOf(`server.tool(\n  '${n}'`); return mcp.slice(i, mcp.indexOf('\n);\n', i)); };
eq('MCP setzt ueber setCheckEntry mit dem MCP-Benutzer', block('isms_set_bsi_check_status').includes('bsiCheck.setCheckEntry(domain_id, body, mcpUser)'), true);
eq('MCP liest ueber getCheck mit dem MCP-Benutzer', block('isms_get_bsi_check').includes('bsiCheck.getCheck(domain_id, mcpUser'), true);
eq('MCP isms_update_bsi_requirement validiert wie REST', block('isms_update_bsi_requirement').includes('bsiCheck.validateEntryInput(updates, item)'), true);
eq('MCP schreibt Audit-Log', ['isms_set_bsi_check_status', 'isms_update_bsi_requirement'].every(n => block(n).includes('logAudit(')), true);

const svc = fs.readFileSync(path.join(SRC, 'services', 'bsiCheckService.js'), 'utf8');
const fnBody = (fn) => { const i = svc.indexOf(`async function ${fn}(`); return svc.slice(i, svc.indexOf('\n}\n', i)); };
eq('getCheck filtert Assets und Dokumente', ['domains.assetFilter(actor)', 'documentFilter(actor)'].every(x => fnBody('getCheck').includes(x)), true);
eq('setCheckEntry prueft Zielobjekt ueber loadTargetObject (Verbund + Sichtbarkeit)', fnBody('setCheckEntry').includes('domains.loadTargetObject(domain, src.target_object_id, actor, transaction)'), true);
eq('setCheckEntry verlangt Modellierung', fnBody('setCheckEntry').includes('BsiModeling.findOne'), true);
eq('setCheckEntry prueft Dokumente und controls.edit', ['documentFilter(actor)', "allowed(actor, 'controls', 'edit'"].every(x => fnBody('setCheckEntry').includes(x)), true);

console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
