#!/usr/bin/env node
'use strict';

/**
 * Deeper risk assessment (3.7.0) without a database (models mocked):
 *
 *   1. Methodology: impact dimensions only from the fixed catalogue, catalogue
 *      order, labels defaulted; old versions (NULL) equal "none" and saving the
 *      default profile unchanged is still "no change".
 *   2. Hook helper normalizeDimensions: only enabled dimensions, scale range,
 *      result built from the catalogue (no input keys copied).
 *   3. riskService: allowlist (override fields not writable via PUT), new
 *      fields only when sent, rationale required whenever values change.
 *   4. Category key derivation, CVE parsing of asset data.
 *   5. MCP: every new tool is gated with the same matrix entry as its route.
 *
 * Run: node scripts/test-risk-assessment.js
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'backend', 'src');

Module._cache[require.resolve(path.join(SRC, 'models'))] = { id: 'models', loaded: true, exports: { User: {}, RiskMethodology: {} } };
for (const svc of ['auditService', 'notifyService']) {
  Module._cache[require.resolve(path.join(SRC, 'services', svc))] = { id: svc, loaded: true, exports: { auditFromReq: async () => {}, notify: async () => {} } };
}

const rm = require(path.join(SRC, 'services', 'riskMethodology'));
const riskService = require(path.join(SRC, 'services', 'riskService'));
const cats = require(path.join(SRC, 'services', 'riskCategoryService'));
const vulns = require(path.join(SRC, 'services', 'vulnerabilityService'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const throwsStatus = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.status || e.message; } };
const clone = (o) => JSON.parse(JSON.stringify(o));

console.log('Methodology: impact dimensions');
const base = clone(rm.DEFAULT_PROFILE);
eq('default profile has no dimensions', base.impact_dimensions, []);
const v = rm.validateProfile({ ...base, impact_dimensions: [{ key: 'financial', label_de: 'Geld' }, { key: 'confidentiality' }] });
eq('valid: catalogue order, labels defaulted or kept', [v.errors.length, v.profile.impact_dimensions.map(d => [d.key, d.label_de, d.label_en])], [0, [['confidentiality', 'Vertraulichkeit', 'Confidentiality'], ['financial', 'Geld', 'Financial']]]);
eq('unknown key rejected', rm.validateProfile({ ...base, impact_dimensions: [{ key: '__proto__' }] }).errors.some(e => e.field === 'impact_dimensions'), true);
eq('duplicate key rejected', rm.validateProfile({ ...base, impact_dimensions: [{ key: 'integrity' }, { key: 'integrity' }] }).errors.length > 0, true);
eq('not a list rejected', rm.validateProfile({ ...base, impact_dimensions: { key: 'integrity' } }).errors.length > 0, true);
eq('label longer than 80 rejected', rm.validateProfile({ ...base, impact_dimensions: [{ key: 'integrity', label_de: 'x'.repeat(81) }] }).errors.length > 0, true);
eq('omitted → none', rm.validateProfile({ ...base, impact_dimensions: undefined }).profile.impact_dimensions, []);
const oldVersion = { ...clone(rm.DEFAULT_PROFILE), impact_dimensions: null };
eq('version stored before 3.7.0 (NULL) = default profile → "no change"', rm.sameContent(oldVersion, rm.validateProfile(base).profile), true);
eq('adding a dimension is a change (new version)', rm.sameContent(oldVersion, v.profile), false);
eq('scale info exposes dimensions ([] for NULL)', rm.scaleInfo(oldVersion).impact_dimensions, []);

console.log('\nHook: normalizeDimensions');
const prof = { ...v.profile, version: 7 };
eq('null/empty → null', [rm.normalizeDimensions(null, prof, 5), rm.normalizeDimensions({ confidentiality: null }, prof, 5)], [null, null]);
eq('values kept, catalogue order', rm.normalizeDimensions({ financial: 2, confidentiality: '4' }, prof, 5), { confidentiality: 4, financial: 2 });
eq('disabled dimension → 400', throwsStatus(() => rm.normalizeDimensions({ legal: 2 }, prof, 5)), 400);
eq('foreign key → 400', throwsStatus(() => rm.normalizeDimensions({ constructor: 1 }, prof, 5)), 400);
eq('beyond the scale → 400', throwsStatus(() => rm.normalizeDimensions({ financial: 6 }, prof, 5)), 400);
eq('fraction → 400', throwsStatus(() => rm.normalizeDimensions({ financial: 2.5 }, prof, 5)), 400);
eq('array → 400', throwsStatus(() => rm.normalizeDimensions([1, 2], prof, 5)), 400);

console.log('\nriskService: fields and rationale');
const f = riskService.buildFields({ title: 't', residual_override: true, residual_likelihood: 1, residual_override_reason: 'x', target_level: 'low', methodology_id: 9, impact_dimensions: { financial: '3' }, likelihood_rationale: '  why  ' }, { partial: true });
eq('override/level/version fields not writable via PUT; rationale trimmed', f, { title: 't', impact_dimensions: { financial: 3 }, likelihood_rationale: 'why' });
const full = riskService.buildFields({ title: 't' }, { partial: false });
eq('full PUT: new fields untouched when not sent', ['impact_dimensions', 'likelihood_rationale', 'impact_rationale', 'target_likelihood', 'target_impact'].map(k => Object.prototype.hasOwnProperty.call(full, k)), [false, false, false, false, false]);
eq('dimension with foreign key → 400', throwsStatus(() => riskService.buildFields({ impact_dimensions: { __proto__x: 1 } }, { partial: true })), 400);
eq('rationale longer than 4000 → 400', throwsStatus(() => riskService.buildFields({ impact_rationale: 'x'.repeat(4001) }, { partial: true })), 400);
const ex = { likelihood: 3, impact: 4, impact_dimensions: { confidentiality: 4, financial: 2 } };
const rr = (body) => throwsStatus(() => riskService.requireRationale(ex, riskService.buildFields(body, { partial: true }), body));
eq('no value change → no rationale needed', rr({ title: 'x', likelihood: 3 }), 'ok');
eq('likelihood change without rationale → 400', rr({ likelihood: 2 }), 400);
eq('likelihood change with rationale → ok', rr({ likelihood: 2, likelihood_rationale: 'r' }), 'ok');
eq('dimension change with same maximum still needs impact rationale', rr({ impact_dimensions: { confidentiality: 4, financial: 3 } }), 400);
eq('same dimensions in other key order → no change', rr({ impact_dimensions: { financial: 2, confidentiality: 4 } }), 'ok');
eq('dropping dimensions with impact = old maximum still a change', rr({ impact_dimensions: null, impact: 4 }), 400);
eq('create: both rationales required', throwsStatus(() => riskService.requireRationale(null, { likelihood: 1, impact: 1, likelihood_rationale: 'a' }, { likelihood_rationale: 'a' })), 400);
eq('reassess: both required even with equal values', throwsStatus(() => riskService.requireRationale(ex, { likelihood: 3, impact: 4 }, {}, { reassess: true })), 400);

console.log('\nCategories and CVE data');
eq('slug: umlauts, separators, no leading/trailing underscore', [cats.slug('Physische Sicherheit'), cats.slug('__Größe -- Ort__'), cats.slug('!!!')], ['physische_sicherheit', 'groesse_ort', '']);
eq('slug of a long hostile input is bounded and fast', ((t) => [cats.slug('_'.repeat(100000) + 'a').length <= 50, Date.now() - t < 500])(Date.now()), [true, true]);
eq('key pattern', ['ok_1', 'Bad', 'a-b', 'x'.repeat(51)].map(k => cats.KEY_RE.test(k)), [true, false, false, false]);
eq('seed: former form values + Bedrohungslage', cats.SEED.map(s => s.key), ['it_security', 'privacy', 'compliance', 'operational', 'financial', 'reputation', 'ai_risk', 'supply_chain', 'other', 'Bedrohungslage']);
eq('CVE entries: valid ids only, upper case, deduplicated, severity/score bounded',
  vulns.cveEntries({ cve_ids: [{ id: 'cve-2026-0001', severity: 'HIGH', score: 7.25 }, 'CVE-2026-0001', { id: 'x' }, { id: 'CVE-2026-0002', severity: 'weird', score: 99 }] }).map(e => [e.cve_id, e.severity, e.cvss_score]),
  [['CVE-2026-0001', 'high', 7.3], ['CVE-2026-0002', null, null]]);
eq('CVE entries from a JSON string and garbage', [vulns.cveEntries({ cve_ids: '[{"id":"CVE-2026-0003"}]' }).length, vulns.cveEntries({ cve_ids: '{bad' }).length, vulns.cveEntries({ cve_ids: null }).length], [1, 0, 0]);

console.log('\nMCP gates');
const mcp = fs.readFileSync(path.join(SRC, 'mcp', 'server.js'), 'utf8');
const gates = {
  isms_override_risk_residual: "perm: ['risks', 'override_residual']",
  isms_list_risk_categories: "perm: ['risks', 'view']",
  isms_create_risk_category: "perm: ['risks', 'manage_methodology']",
  isms_update_risk_category: "perm: ['risks', 'manage_methodology']",
  isms_list_vulnerabilities: "perm: ['vulnerabilities', 'view']",
  isms_create_vulnerability: "perm: ['vulnerabilities', 'manage']",
  isms_update_vulnerability: "perm: ['vulnerabilities', 'manage']",
  isms_delete_vulnerability: "perm: ['vulnerabilities', 'delete']",
  isms_import_asset_cves_as_vulnerabilities: "perm: ['vulnerabilities', 'manage']",
};
for (const [tool, perm] of Object.entries(gates)) {
  const line = mcp.split('\n').find(l => l.includes(`'${tool}': {`));
  eq(`${tool} gated with ${perm.replace('perm: ', '')}`, !!line && line.includes(perm), true);
  eq(`${tool} registered`, mcp.includes(`server.tool(\n  '${tool}'`), true);
}
const settings = fs.readFileSync(path.join(SRC, 'services', 'settingsService.js'), 'utf8');
eq('matrix: vulnerabilities not readable by viewer/employee', /vulnerabilities: \{ view: \[([^\]]*)\]/.exec(settings)[1].split(',').some(r => /viewer|employee/.test(r)), false);

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
