#!/usr/bin/env node
'use strict';

/**
 * Informationsverbund, Zielobjekte und Modellierung - ohne Datenbank.
 *
 *   - Vorschlag des Zielobjekttyps aus dem Asset-Typ
 *   - Bausteinvorschlaege fuer Kompendium und Grundschutz++ (target_object_categories)
 *   - welche Zuordnung erlaubt ist (Systembausteine nur an Zielobjekten)
 *   - jeder Endpunkt in routes/bsi-domains.js traegt requirePermission, jeder
 *     schreibende zusaetzlich requireWriteAccess und manage_domain
 *   - die MCP-Tools sind an dieselben Matrix-Eintraege gebunden und rufen
 *     dieselben Dienstfunktionen wie die Routen
 *   - die Asset-Sichtbarkeit wirkt am Dienst, also an jedem Weg
 *
 * Run: node scripts/test-bsi-domain.js
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'backend', 'src');
const svc = require(path.join(SRC, 'services', 'bsiDomainService'));
const { parseCatalog } = require(path.join(SRC, 'services', 'bsiCatalogParsers'));
const { seedAsParsed } = require(path.join(SRC, 'services', 'bsiCatalogService'));
const { oscalCatalog } = require('./fixtures/bsi-catalog');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

console.log('Zielobjekttyp aus Asset-Typ:');
eq('hardware → it_system', svc.suggestTargetType('hardware'), 'it_system');
eq('application → application', svc.suggestTargetType('application'), 'application');
eq('service → application', svc.suggestTargetType('service'), 'application');
eq('process → business_process', svc.suggestTargetType('process'), 'business_process');
eq('information → kein Vorschlag', svc.suggestTargetType('information'), null);
eq('unbekannt → kein Vorschlag', svc.suggestTargetType('__proto__'), null);
eq('alle Vorschlaege sind gueltige Typen', Object.values(svc.ASSET_TYPE_TO_TARGET).every(t => svc.TARGET_TYPES.includes(t)), true);
eq('sieben Zielobjekttypen', svc.TARGET_TYPES.length, 7);
eq('Absicherungsvarianten', svc.PROTECTION_APPROACHES, ['basis', 'standard', 'kern']);

console.log('\nVorschlaege Kompendium (Seed-Auszug):');
const seed = seedAsParsed();
const ids = (list) => list.map(s => s.module_id);
const domainWide = svc.suggestModules(seed.modules, seed.requirements, null);
eq('Verbund: nur Prozessschichten', [...new Set(domainWide.map(s => s.layer))], ['ISMS', 'ORP', 'CON', 'OPS', 'DER']);
eq('Verbund enthaelt ISMS.1 und DER.4', ['ISMS.1', 'DER.4'].every(id => ids(domainWide).includes(id)), true);
eq('IT-System: SYS-Bausteine', ids(svc.suggestModules(seed.modules, seed.requirements, 'it_system')), ['SYS.1.1', 'SYS.2.1']);
eq('Anwendung: APP-Bausteine', ids(svc.suggestModules(seed.modules, seed.requirements, 'application')), ['APP.1.1', 'APP.3.1']);
eq('Netz: NET-Bausteine', ids(svc.suggestModules(seed.modules, seed.requirements, 'network')), ['NET.1.1', 'NET.1.2', 'NET.3.2']);
eq('Gebaeude: INF.1', ids(svc.suggestModules(seed.modules, seed.requirements, 'building')), ['INF.1']);
eq('Raum: INF.2', ids(svc.suggestModules(seed.modules, seed.requirements, 'room')), ['INF.2']);
eq('Geschaeftsprozess: keine eigenen Bausteine', svc.suggestModules(seed.modules, seed.requirements, 'business_process'), []);

console.log('\nVorschlaege Grundschutz++ (target_object_categories):');
const gs = parseCatalog(Buffer.from(JSON.stringify(oscalCatalog())));
const gsIt = svc.suggestModules(gs.modules, gs.requirements, 'it_system');
eq('IT-System: GC.1 ueber Kategorie "IT-Systeme"', ids(gsIt), ['GC.1']);
eq('Begruendung nennt die Kategorie', gsIt[0]?.reason, 'gspp_category:IT-Systeme');
eq('Netz: GC.1 ueber Kategorie "Netze"', ids(svc.suggestModules(gs.modules, gs.requirements, 'network')), ['GC.1']);
eq('Raum: keine', svc.suggestModules(gs.modules, gs.requirements, 'room'), []);
eq('Verbund: Praktik ohne Kategorie (STM)', ids(svc.suggestModules(gs.modules, gs.requirements, null)), ['STM']);
eq('Kategorien als Komma-Liste', svc.categoriesOf({ target_object_categories: 'A, B' }), ['A', 'B']);
eq('ICS-Systeme ist ics, nicht it_system', [svc.GSPP_CATEGORY_PATTERNS.ics.test('ICS-Systeme'), svc.GSPP_CATEGORY_PATTERNS.it_system.test('ICS-Systeme')], [true, false]);

console.log('\nZulaessige Modellierung:');
eq('SYS ohne Zielobjekt abgelehnt', !!svc.modelingError({ layer: 'SYS', kind: 'baustein' }, false), true);
eq('SYS mit Zielobjekt erlaubt', svc.modelingError({ layer: 'SYS', kind: 'baustein' }, true), null);
eq('ISMS fuer den Verbund erlaubt', svc.modelingError({ layer: 'ISMS', kind: 'baustein' }, false), null);
eq('OPS auch am Zielobjekt erlaubt', svc.modelingError({ layer: 'OPS', kind: 'baustein' }, true), null);
eq('Praktik ueberall erlaubt', svc.modelingError({ layer: 'GC', kind: 'praktik' }, false), null);
eq('unbekanntes Modul abgelehnt', !!svc.modelingError(null, true), true);

console.log('\nIDs:');
eq('"5" → 5', svc.toId('5'), 5);
eq('5 → 5', svc.toId(5), 5);
eq('"5abc" → null', svc.toId('5abc'), null);
eq('"-1" → null', svc.toId('-1'), null);
eq('{} → null', svc.toId({}), null);

// ── Statische Pruefungen: Berechtigung an jedem Weg ─────────────────────────
console.log('\nRouten (routes/bsi-domains.js):');
const routeSrc = fs.readFileSync(path.join(SRC, 'routes', 'bsi-domains.js'), 'utf8');
const endpoints = [...routeSrc.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'([^\n]*)/g)]
  .map(m => ({ method: m[1], path: m[2], tail: m[3] }));
eq('Endpunkte gefunden', endpoints.length >= 12, true);
eq('jeder Endpunkt mit authenticate + requirePermission(bsi_grundschutz)',
  endpoints.filter(e => !/authenticate, requirePermission\('bsi_grundschutz'/.test(e.tail)).map(e => `${e.method} ${e.path}`), []);
const writes = endpoints.filter(e => e.method !== 'get');
// Verbund/Zielobjekte/Modellierung: manage_domain; Check-Status: edit (wie die
// bisherige Liste); Risikoanalyse und Realisierungsplan (3.10.0): risk_analysis.
const isAnalysis = (e) => e.path.includes('/risk-analysis') || e.path.includes('/realization-plan');
const expectedAction = (e) => (e.path.endsWith('/check') ? "'edit'" : isAnalysis(e) ? "'risk_analysis'" : "'manage_domain'");
eq('schreibende Endpunkte: manage_domain, edit fuer den Check, risk_analysis fuer Risikoanalyse/Realisierungsplan',
  writes.filter(e => !e.tail.includes(expectedAction(e))).map(e => `${e.method} ${e.path}`), []);
eq('schreibende Endpunkte: requireWriteAccess', writes.filter(e => !e.tail.includes('requireWriteAccess()')).map(e => `${e.method} ${e.path}`), []);
eq('lesende Endpunkte: view', endpoints.filter(e => e.method === 'get' && !e.tail.includes("'view'")).map(e => e.path), []);
// Verbund/Check: auditFromReq in der Route. Risikoanalyse/Realisierungsplan:
// der Service schreibt das signierte Audit (gleicher Weg fuer REST und MCP).
const analysisSrc = fs.readFileSync(path.join(SRC, 'services', 'bsiRiskAnalysisService.js'), 'utf8');
const routeWrites = writes.filter(e => !isAnalysis(e));
const routeAudits = (routeSrc.match(/auditFromReq\(/g) || []).length
  - (routeSrc.match(/auditFromReq\(req, 'export'/g) || []).length;
eq('jede Aenderung schreibt Audit-Log (Route)', routeAudits, routeWrites.length);
const fnBody = (name) => { const i = analysisSrc.indexOf(`async function ${name}(`); const j = analysisSrc.indexOf('\nasync function ', i + 10); return i < 0 ? '' : analysisSrc.slice(i, j < 0 ? undefined : j); };
eq('jede Aenderung der Risikoanalyse schreibt Audit-Log (Service)',
  ['setTargetDecision', 'setThreatAssessment', 'addAdditionalThreat', 'classifyThreat', 'addRealizationMeasure', 'updateRealizationMeasure', 'removeRealizationMeasure']
    .filter(n => !fnBody(n).includes('auditFromReq(')), []);
eq('jeder Export/Download schreibt Audit-Log', (routeSrc.match(/auditFromReq\(req, 'export'/g) || []).length, endpoints.filter(e => e.method === 'get' && (e.path.endsWith('/export') || e.path.includes('/reports/'))).length);
eq('keine direkte Massenzuweisung aus req.body', /\.(create|update)\(\s*req\.body/.test(routeSrc), false);

const indexSrc = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
eq('hinter requireModule(bsi_grundschutz) eingehaengt',
  indexSrc.includes("app.use('/api/bsi-grundschutz/domains', requireModule('bsi_grundschutz'), require('./routes/bsi-domains'))"), true);
eq('vor dem allgemeinen BSI-Router',
  indexSrc.indexOf("require('./routes/bsi-domains')") < indexSrc.indexOf("require('./routes/bsi-grundschutz')"), true);

console.log('\nMCP-Tools (mcp/server.js):');
const mcpSrc = fs.readFileSync(path.join(SRC, 'mcp', 'server.js'), 'utf8');
const gates = mcpSrc.slice(0, mcpSrc.indexOf('async function gateTool'));
const gate = (name) => {
  const m = gates.match(new RegExp(`'${name}':\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};
for (const [tool, action, write] of [
  ['isms_list_bsi_domains', 'view', false], ['isms_get_bsi_domain', 'view', false], ['isms_suggest_bsi_modeling', 'view', false],
  ['isms_assign_bsi_target_object', 'manage_domain', true], ['isms_model_bsi_module', 'manage_domain', true],
]) {
  const g = gate(tool);
  eq(`${tool}: Matrix ${action}, Modul bsi_grundschutz${write ? ', needsWrite' : ''}`,
    [g.includes(`perm: ['bsi_grundschutz', '${action}']`), g.includes("moduleKey: 'bsi_grundschutz'"), g.includes('needsWrite: true')],
    [true, true, write]);
  eq(`${tool}: registriert`, mcpSrc.includes(`server.tool(\n  '${tool}'`), true);
}
const block = (name) => {
  const start = mcpSrc.indexOf(`server.tool(\n  '${name}'`);
  return mcpSrc.slice(start, mcpSrc.indexOf('\n);\n', start));
};
eq('Zuordnen nutzt den Dienst mit dem MCP-Benutzer', block('isms_assign_bsi_target_object').includes('bsiDomains.addTargetObject(domain_id, { asset_id, target_type, notes }, mcpUser)'), true);
eq('Modellieren nutzt den Dienst mit dem MCP-Benutzer', block('isms_model_bsi_module').includes('bsiDomains.addModeling(domain_id, { module_id, target_object_id, notes }, mcpUser)'), true);
eq('Lesen filtert mit dem MCP-Benutzer', block('isms_get_bsi_domain').includes('listTargetObjects(domain_id, mcpUser)') && block('isms_get_bsi_domain').includes('listModeling(domain_id, mcpUser)'), true);
eq('MCP schreibt Audit-Log', ['isms_assign_bsi_target_object', 'isms_model_bsi_module'].every(n => block(n).includes('logAudit(')), true);

console.log('\nSichtbarkeit am Dienst:');
const svcSrc = fs.readFileSync(path.join(SRC, 'services', 'bsiDomainService.js'), 'utf8');
for (const fn of ['listTargetObjects', 'loadTargetObject', 'addTargetObject', 'listModeling', 'removeModeling']) {
  const start = svcSrc.indexOf(`async function ${fn}(`);
  const body = svcSrc.slice(start, svcSrc.indexOf('\n}\n', start));
  eq(`${fn} prueft die Asset-Sichtbarkeit`, body.includes('await assetFilter(actor)'), true);
}
for (const fn of ['updateTargetObject', 'removeTargetObject', 'suggestModeling', 'addModeling']) {
  const start = svcSrc.indexOf(`async function ${fn}(`);
  const body = svcSrc.slice(start, svcSrc.indexOf('\n}\n', start));
  eq(`${fn} laedt Zielobjekte nur ueber loadTargetObject (Verbund + Sichtbarkeit)`, body.includes('loadTargetObject(domain,') && !body.includes('BsiTargetObject.findByPk'), true);
}

console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
