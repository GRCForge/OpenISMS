#!/usr/bin/env node
'use strict';

/**
 * BSI 200-3 risk analysis, realisation plan and reports (3.10.0) without a
 * database (models mocked):
 *
 *   1. Protection need from the CIA assessment (1-3 normal, 4 high,
 *      5 very high, maximum principle); selection reasons; manual decision.
 *   2. Priorities (suggested from requirement level / risk level), plan
 *      items (only nein/teilweise), summary, sort order, A.6 export rows
 *      formula-neutralised; elementary threats in numeric order.
 *   3. Report rendering: DOCX is a valid OOXML package whose text is escaped
 *      data (no markup injection), PDF parses and carries the text; control
 *      characters removed; remote resources refused (no SSRF through pdfmake);
 *      safe file names; heat map counts.
 *   4. Routes guarded and audited, MCP gates and tools registered, README /
 *      docs tool count, permission matrix entry.
 *
 * Run: node scripts/test-bsi-risk-analysis.js
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'backend', 'src');
const NM = path.join(SRC, '..', 'node_modules');

Module._cache[require.resolve(path.join(SRC, 'models'))] = { id: 'models', loaded: true, exports: { User: {}, RiskMethodology: {} } };
for (const svc of ['auditService', 'notifyService']) {
  Module._cache[require.resolve(path.join(SRC, 'services', svc))] = { id: svc, loaded: true, exports: { auditFromReq: async () => {}, notify: async () => {} } };
}

const ra = require(path.join(SRC, 'services', 'bsiRiskAnalysisService'));
const render = require(path.join(SRC, 'services', 'reportRender'));
const reports = require(path.join(SRC, 'services', 'reportService'));
const rm = require(path.join(SRC, 'services', 'riskMethodology'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};

(async () => {
  console.log('Protection need and selection:');
  eq('1..5 -> normal/normal/normal/high/very_high; invalid -> null', [1, 2, 3, 4, 5, 0, 6, 'x', null].map(ra.protectionCategory), ['normal', 'normal', 'normal', 'high', 'very_high', null, null, null, null]);
  const need = ra.protectionNeed({ id: 7, confidentiality: 2, integrity: 4, availability: 3, assessed_at: '2026-01-01' });
  eq('maximum principle: overall = highest category', [need.confidentiality, need.integrity, need.availability, need.overall, need.values.integrity], ['normal', 'high', 'normal', 'high', 4]);
  eq('no assessment -> null', ra.protectionNeed(null), null);
  eq('reasons: high need + no module + scenario', ra.selectionReasons({ protection: { overall: 'very_high' }, modelingCount: 0, scenarioNotCovered: true }), ['high_protection_need', 'no_module', 'scenario_not_covered']);
  eq('reasons: normal need, modelled, covered -> none', ra.selectionReasons({ protection: { overall: 'normal' }, modelingCount: 2, scenarioNotCovered: false }), []);
  eq('reasons: no assessment is not a reason by itself', ra.selectionReasons({ protection: null, modelingCount: 1, scenarioNotCovered: false }), []);
  eq('decision: auto follows reasons, include/exclude win', [ra.isIncluded('auto', ['no_module']), ra.isIncluded('auto', []), ra.isIncluded('include', []), ra.isIncluded('exclude', ['high_protection_need'])], [true, false, true, false]);

  console.log('Priorities, plan, threats:');
  eq('requirement priority from level', ['basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht', null].map(ra.suggestRequirementPriority), ['high', 'medium', 'low', 'high', 'low', 'medium']);
  eq('measure priority from risk level', ['critical', 'high', 'medium', 'low', null].map(ra.suggestMeasurePriority), ['high', 'high', 'medium', 'low', 'medium']);
  const check = {
    domain: { id: 1, name: 'Verbund' },
    entries: [
      { target_object_id: 3, target_name: 'Server', req_id: 'SYS.1.1.A1', title: 'a', requirement_level: 'basis', implementation_status: 'not_implemented', justification: '=HYPERLINK("x")', due_date: '2027-01-01', cost_once: 10.5 },
      { target_object_id: 3, target_name: 'Server', req_id: 'SYS.1.1.A2', title: 'b', requirement_level: 'standard', implementation_status: 'in_progress', realization_priority: 'high', due_date: '2026-12-01', cost_once: 1 },
      { target_object_id: null, target_name: null, req_id: 'ISMS.1.A1', title: 'c', requirement_level: 'basis', implementation_status: 'implemented' },
      { target_object_id: null, target_name: null, req_id: 'ISMS.1.A2', title: 'd', requirement_level: 'standard', implementation_status: 'not_started' },
      { target_object_id: null, target_name: null, req_id: 'ISMS.1.A3', title: 'e', requirement_level: 'basis', implementation_status: 'not_applicable' },
    ],
  };
  const items = ra.requirementPlanItems(check);
  eq('plan: only nein / teilweise', items.map(i => i.ref), ['SYS.1.1.A1', 'SYS.1.1.A2']);
  eq('plan: set priority wins, otherwise suggested', items.map(i => [i.priority, i.priority_source]), [['high', 'suggested'], ['high', 'set']]);
  const sorted = ra.sortPlanItems(items);
  eq('sort: priority, then due date', sorted.map(i => i.ref), ['SYS.1.1.A2', 'SYS.1.1.A1']);
  const sum = ra.summarizePlan(sorted, { not_checked_requirements: 1 });
  eq('summary: counts and cost totals in cents', [sum.items, sum.requirements, sum.by_priority.high, sum.cost_once_total, sum.without_responsible, sum.not_checked_requirements], [2, 2, 2, 11.5, 2, 1]);
  const a6 = ra.buildA6Rows({ domain: check.domain, items: sorted });
  eq('A.6 export: columns, formula neutralised, costs as numbers', [a6.columns.length, a6.rows[1][12], typeof a6.rows[1][10], a6.rows[0][0]], [13, '\'=HYPERLINK("x")', 'number', 'hoch']);
  const threats = [{ code: 'G 0.10', title: 'x' }, { code: 'G 0.2', title: 'y' }, { code: null, title: 'custom' }, { code: 'G 0.47', title: 'z' }];
  eq('elementary threats in numeric order, others last', [...threats].sort(ra.threatOrder).map(t => t.code), ['G 0.2', 'G 0.10', 'G 0.47', null]);
  eq('catalogue threat mapping is reported as unavailable', ra.CATALOG_THREAT_MAPPING.available, false);

  console.log('Report rendering:');
  eq('clean: control characters removed, length capped', [render.clean('a\u0000b\u0007c\u000Bd\te'), render.clean('x'.repeat(5000)).length, render.clean(null), render.clean(12)], ['abcd\te', 4000, '', '12']);
  eq('colour: only #rrggbb, otherwise fallback', [render.color('#DC2626'), render.color('red;fill:url(x)'), render.color(null)], ['#DC2626', '#e5e7eb', '#e5e7eb']);
  const fname = render.safeFilename('bsi-a1', '../../etc/Größe "Verbund"\r\nX', 'pdf');
  eq('file name: only [a-z0-9-], fixed extension', [/^bsi-a1-etc-grosse-verbund-x-\d{8}\.pdf$/.test(fname), render.safeFilename('x', '', 'exe').endsWith('.docx')], [true, true]);
  const scale = rm.scaleInfo(rm.DEFAULT_PROFILE);
  const hm = reports.heatmap(scale, [{ l: 5, i: 5 }, { l: 5, i: 5 }, { l: 1, i: 2 }, { l: 9, i: 9 }, { l: null, i: 1 }], r => ({ likelihood: r.l, impact: r.i }), 'Brutto');
  eq('heat map: counts per cell, out-of-scale values skipped, top row = highest likelihood', [hm.counted, hm.block.cells[0][4].count, hm.block.cells[4][1].count, hm.block.cells[0][4].color], [3, 2, 1, '#dc2626']);

  const evil = '<w:p><w:r><w:t>INJECTED</w:t></w:r></w:p>]]>&{{7*7}}';
  const doc = {
    title: 'Testbericht', subtitle: 'Prüfung', organization: 'Muster GmbH', app_name: 'OpenISMS', generated_at: new Date().toISOString(), generated_by: 'Tester',
    sections: [
      { heading: '1. Text', blocks: [{ type: 'p', text: evil }, { type: 'note', text: 'Hinweis' }, { type: 'nodata', text: 'Keine Daten erfasst.' }, { type: 'list', items: ['eins', 'zwei'] }, { type: 'kv', rows: [['Schlüssel', 'Wert']] }] },
      { heading: '2. Tabelle', blocks: [{ type: 'h', text: 'Unter' }, { type: 'table', columns: ['A', 'B'], rows: [['=cmd|calc', 'G 0.1 Feuer'], [1, null]] }, { type: 'table', columns: ['X'], rows: [] }] },
      { heading: '3. Heatmap', blocks: [hm.block] },
    ],
  };
  const AdmZip = require(path.join(NM, 'adm-zip'));
  const docx = await render.renderDocx(doc);
  const zip = new AdmZip(docx);
  const xml = zip.readAsText('word/document.xml');
  eq('DOCX: OOXML package with document.xml', [docx.slice(0, 2).toString(), !!zip.getEntry('[Content_Types].xml'), xml.length > 0], ['PK', true, true]);
  eq('DOCX: injected markup is escaped text, not XML', [xml.includes('&lt;w:p&gt;&lt;w:r&gt;&lt;w:t&gt;INJECTED'), /<w:t[^>]*>INJECTED<\/w:t>/.test(xml)], [true, false]);
  eq('DOCX: content and "Keine Daten" present', [xml.includes('G 0.1 Feuer'), xml.includes('Keine Daten erfasst.'), xml.includes('Muster GmbH')], [true, true, true]);
  const pdf = await render.renderPdf({ ...doc, landscape: true });
  const { PDFParse } = require(path.join(NM, 'pdf-parse'));
  const parser = new PDFParse({ data: pdf });
  const parsed = await parser.getText();
  await parser.destroy();
  eq('PDF: header and text extractable', [pdf.slice(0, 5).toString(), parsed.text.includes('G 0.1 Feuer'), parsed.text.includes('INJECTED'), parsed.text.includes('Keine Daten erfasst.')], ['%PDF-', true, true, true]);
  const def = render.pdfDefinition(doc);
  eq('PDF definition carries no image or link from data', JSON.stringify(def.content).includes('"image"') || JSON.stringify(def.content).includes('"link"'), false);
  const pm = require(path.join(NM, 'pdfmake'));
  let blocked = null;
  try { await pm.createPdf({ content: [{ image: 'http://127.0.0.1:9/x.png' }] }).getBuffer(); blocked = false; } catch (e) { blocked = true; }
  eq('pdfmake: remote image URL refused by the access policy', blocked, true);
  let localBlocked = null;
  try { await pm.createPdf({ content: [{ image: '/etc/hostname' }] }).getBuffer(); localBlocked = false; } catch (e) { localBlocked = true; }
  eq('pdfmake: local file outside the fonts refused', localBlocked, true);
  let badFormat = null;
  try { await render.render(doc, 'html'); } catch (e) { badFormat = e.status; }
  eq('render: unknown format -> 400', badFormat, 400);
  const cat = reports.reportCatalog([{ id: 4, name: 'V' }]);
  eq('report catalogue: paths only, no content', [cat.risk_reports.map(r => r.path), cat.bsi_reference_documents[0].documents.map(d => d.key)], [['/api/risks/reports/risk-report', '/api/risks/reports/treatment-plan'], ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'all']]);

  console.log('Routes, MCP, documentation:');
  const routes = fs.readFileSync(path.join(SRC, 'routes', 'bsi-domains.js'), 'utf8');
  const riskRoutes = fs.readFileSync(path.join(SRC, 'routes', 'risks.js'), 'utf8');
  const lines = routes.split('\n').filter(l => /router\.(get|put|post|delete)\('\/:id\/(risk-analysis|realization-plan|reports)/.test(l));
  eq('every new BSI route is authenticated and permission-guarded', [lines.length, lines.every(l => l.includes('authenticate') && l.includes('requirePermission('))], [12, true]);
  eq('BSI writes need risk_analysis and write access', lines.filter(l => /router\.(put|post|delete)/.test(l)).every(l => l.includes("'risk_analysis'") && l.includes('requireWriteAccess()')), true);
  eq('downloads audit-logged (BSI reports, A.6 export, risk reports)', [/auditFromReq\(req, 'export', 'bsi_report'/.test(routes), /auditFromReq\(req, 'export', 'bsi_realization_plan'/.test(routes), /auditFromReq\(req, 'export', def\.entity/.test(riskRoutes)], [true, true, true]);
  eq('risk report route before /:id', riskRoutes.indexOf("router.get('/reports/:report'") < riskRoutes.indexOf("router.get('/:id'"), true);
  const settings = fs.readFileSync(path.join(SRC, 'services', 'settingsService.js'), 'utf8');
  eq('permission bsi_grundschutz.risk_analysis in the matrix (admin, assessor)', /risk_analysis: \['admin','assessor'\]/.test(settings), true);
  const mcp = fs.readFileSync(path.join(SRC, 'mcp', 'server.js'), 'utf8');
  for (const tool of ['isms_get_bsi_risk_analysis', 'isms_set_bsi_risk_analysis_target', 'isms_assess_bsi_threat', 'isms_classify_bsi_threat', 'isms_get_bsi_realization_plan', 'isms_list_reports']) {
    eq(`${tool} gated and registered`, [mcp.includes(`'${tool}': { perm:`), mcp.includes(`server.tool(\n  '${tool}'`)], [true, true]);
  }
  const svcSrc = fs.readFileSync(path.join(SRC, 'services', 'bsiRiskAnalysisService.js'), 'utf8');
  eq('service writes signed audit entries (auditFromReq), never logAudit', [svcSrc.includes('auditFromReq('), svcSrc.includes('logAudit(')], [true, false]);
  const count = (mcp.match(/^server\.tool\(/gm) || []).length;
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const mcpDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'MCP.md'), 'utf8');
  eq('README and docs/MCP.md tool count match the registered tools', [readme.includes(`MCP-${count}%20tools`), mcpDoc.includes(`## 11. Tool reference (${count} tools)`)], [true, true]);

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
