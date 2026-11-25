#!/usr/bin/env node
'use strict';

/**
 * Risk monitoring (3.9.0) without a database (models mocked):
 *
 *   1. Periodic review: next review from cycle and last review, earlier
 *      review_date wins, closed risks are not due, default cycles.
 *   2. Acceptance expiry flags (30 days, expired).
 *   3. KRI values and breach direction; CVE comparison.
 *   4. History: trigger of a coalesced operation, changed fields.
 *   5. Methodology: review_cycles validated, part of the version content.
 *   6. Routes before '/:id', every new route guarded; MCP gates and tools;
 *      README tool count; jobs once per day across instances (withJobSlot).
 *
 * Run: node scripts/test-risk-monitoring.js
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
const mon = require(path.join(SRC, 'services', 'riskMonitoringService'));
const hist = require(path.join(SRC, 'services', 'riskHistoryService'));
const jobLock = require(path.join(SRC, 'utils', 'jobLock'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const P = rm.DEFAULT_PROFILE;

console.log('Periodic review');
const base = { status: 'open', likelihood: 3, impact: 3, residual_likelihood: null, residual_impact: null };
eq('default cycles: low 24, medium 12, high 6, critical 3', rm.reviewCyclesOf(null).map(c => [c.level, c.months]), [['low', 24], ['medium', 12], ['high', 6], ['critical', 3]]);
let i = mon.reviewInfo({ ...base, last_reviewed_at: `${day(-30)}T10:00:00Z` }, P, P);
eq('medium, reviewed 30 days ago: cycle 12, not overdue', [i.review_cycle_months, i.review_overdue, i.next_review_source], [12, false, 'cycle']);
i = mon.reviewInfo({ ...base, likelihood: 5, impact: 5, last_reviewed_at: `${day(-100)}T10:00:00Z` }, P, P);
eq('critical, reviewed 100 days ago: cycle 3 → overdue', [i.review_cycle_months, i.review_overdue], [3, true]);
i = mon.reviewInfo({ ...base, last_reviewed_at: `${day(-30)}T10:00:00Z`, review_date: day(-1) }, P, P);
eq('earlier manual review_date wins', [i.next_review_due, i.next_review_source, i.review_overdue], [day(-1), 'review_date', true]);
i = mon.reviewInfo({ ...base, last_reviewed_at: `${day(-30)}T10:00:00Z`, review_date: day(900) }, P, P);
eq('later review_date does not extend the cycle', i.next_review_source, 'cycle');
i = mon.reviewInfo({ ...base, status: 'closed', last_reviewed_at: `${day(-999)}T10:00:00Z` }, P, P);
eq('closed risk: no review due', [i.next_review_due, i.review_overdue], [null, false]);
i = mon.reviewInfo({ ...base, residual_likelihood: 1, residual_impact: 1, last_reviewed_at: `${day(-400)}T10:00:00Z` }, P, P);
eq('net level counts (low, 24 months)', [i.review_cycle_months, i.review_overdue], [24, false]);
const noCycle = { ...P, review_cycles: [{ level: 'medium', months: null }] };
i = mon.reviewInfo({ ...base, last_reviewed_at: `${day(-999)}T10:00:00Z` }, P, noCycle);
eq('cycle of the ACTIVE methodology; no cycle → not due', [i.review_cycle_months, i.review_overdue], [null, false]);
eq('no last review: falls back to updated_at', mon.reviewInfo({ ...base, updated_at: `${day(-400)}T10:00:00Z` }, P, P).review_overdue, true);

console.log('\nAcceptance expiry');
eq('accepted, 10 days left → expiring', mon.acceptanceInfo({ status: 'accepted', accepted_until: day(10) }), { acceptance_expiring: true, acceptance_expired: false, acceptance_days_left: 10 });
eq('expires today → expiring, not expired', ((x) => [x.acceptance_expiring, x.acceptance_expired])(mon.acceptanceInfo({ status: 'accepted', accepted_until: day(0) })), [true, false]);
eq('yesterday → expired', mon.acceptanceInfo({ status: 'accepted', accepted_until: day(-1) }).acceptance_expired, true);
eq('31 days → neither', ((x) => [x.acceptance_expiring, x.acceptance_expired])(mon.acceptanceInfo({ status: 'accepted', accepted_until: day(31) })), [false, false]);
eq('not accepted → neither', mon.acceptanceInfo({ status: 'open', accepted_until: day(1) }).acceptance_expiring, false);

console.log('\nKRI values, CVEs');
eq('parseValue: comma, percent, negative; rejects exponent, long, text', ['12,5', '80 %', '-3', '1e9', '1'.repeat(40), 'abc', null, 4].map(mon.parseValue), [12.5, 80, -3, null, null, null, null, 4]);
eq('parseValue on hostile input is fast', ((t) => [mon.parseValue('9'.repeat(100000) + 'x'), Date.now() - t < 100])(Date.now()), [null, true]);
eq('isBreach above/below, equal is no breach', [mon.isBreach(11, 10, 'above'), mon.isBreach(10, 10, 'above'), mon.isBreach(9, 10, 'below'), mon.isBreach(null, 10, 'above')], [true, false, true, false]);
eq('new critical/high CVEs only', mon.newSevereCves([{ id: 'CVE-1', severity: 'high' }], [{ id: 'CVE-1', severity: 'high' }, { id: 'CVE-2', severity: 'critical' }, { id: 'CVE-3', severity: 'medium' }]), ['CVE-2']);
eq('severity raised on a known CVE is not new', mon.newSevereCves([{ id: 'CVE-1', severity: 'low' }], [{ id: 'CVE-1', severity: 'critical' }]), []);
eq('malformed lists tolerated', mon.newSevereCves(null, [{ severity: 'critical' }, 'x', { id: 'CVE-9', severity: 'high' }]), ['CVE-9']);
eq('KRI fields: allowlist, number, default direction', mon.buildKriFields({ kpi_id: '3', threshold: '7,5', risk_id: 9, breached: true }), { kpi_id: 3, threshold: 7.5, direction: 'above' });
const kriErr = (b, o) => { try { mon.buildKriFields(b, o); return 'ok'; } catch (e) { return e.status; } };
eq('KRI fields: invalid kpi, threshold, direction, KPI change → 400', [kriErr({ threshold: 1 }), kriErr({ kpi_id: 1, threshold: 'x' }), kriErr({ kpi_id: 1, threshold: 1, direction: 'up' }), kriErr({ kpi_id: 2 }, { existing: { kpi_id: 1 } })], [400, 400, 400, 400]);
eq('trigger types', mon.TRIGGER_TYPES, ['incident', 'audit_finding', 'threat_advisory', 'cve', 'kri', 'review_overdue']);

console.log('\nHistory');
eq('assessment that only moved the net risk → residual_recalculated', hist.resolveTrigger('assessment', ['residual_likelihood', 'residual_level'], false), 'residual_recalculated');
eq('assessment with gross change stays assessment', hist.resolveTrigger('assessment', ['likelihood', 'residual_likelihood'], false), 'assessment');
eq('created wins, unknown → system', [hist.resolveTrigger('assessment', [], true), hist.resolveTrigger(undefined, ['impact'], false)], ['created', 'system']);
const s1 = hist.stateOf((k) => ({ likelihood: '3', impact: 2, impact_dimensions: {} }[k]));
const s2 = hist.stateOf((k) => ({ likelihood: 3, impact: 2, impact_dimensions: null }[k]));
eq('state normalised: "3" = 3, {} = null → no change', hist.changedFields(s1, s2), []);
eq('changed fields listed', hist.changedFields(s2, { ...s2, impact: 4, inherent_level: 'high' }), ['impact', 'inherent_level']);
eq('review triggers', hist.REVIEW_TRIGGERS, ['created', 'assessment', 'reassessment', 'residual_override', 'review']);
const RAH = require(path.join(SRC, 'models', 'RiskAssessmentHistory.js'));
eq('history triggers in the model', RAH.TRIGGERS, ['baseline_at_upgrade', 'created', 'assessment', 'reassessment', 'carry_over', 'residual_override', 'residual_recalculated', 'review', 'system']);
const day2 = (v) => { try { hist.parseDay(v, 'x'); return 'ok'; } catch (e) { return e.status; } };
eq('trend dates validated', ['2026-11-25', '2026-02-30', '25.11.2026', "2026-01-01' --", null].map(day2), ['ok', 400, 400, 400, 400]);

console.log('\nMethodology');
const v = (rc) => rm.validateProfile({ ...JSON.parse(JSON.stringify(P)), review_cycles: rc });
eq('valid cycles kept in level order, empty = none', v([{ level: 'critical', months: 1 }, { level: 'low', months: '' }]).profile.review_cycles, [{ level: 'low', months: null }, { level: 'medium', months: null }, { level: 'high', months: null }, { level: 'critical', months: 1 }]);
eq('0, 121, fraction, unknown level, duplicate, not a list → errors', [v([{ level: 'low', months: 0 }]), v([{ level: 'low', months: 121 }]), v([{ level: 'low', months: 1.5 }]), v([{ level: '__proto__', months: 3 }]), v([{ level: 'low', months: 3 }, { level: 'low', months: 4 }]), v('3')].map(r => r.errors.length > 0), [true, true, true, true, true, true]);
eq('review cycles are part of the version content', rm.sameContent(P, { ...P, review_cycles: [{ level: 'low', months: 1 }] }), false);
eq('NULL cycles (pre-3.9.0 version) = default content', rm.sameContent({ ...P, review_cycles: null }, P), true);
eq('scale info carries review cycles', rm.scaleInfo(P).review_cycles.length, 4);

console.log('\nRoutes');
const routes = fs.readFileSync(path.join(SRC, 'routes', 'risks.js'), 'utf8');
const pos = (s) => routes.indexOf(s);
for (const r of ["router.get('/monitoring/summary'", "router.get('/monitoring/trend'", "router.get('/review-flags'"]) {
  eq(`${r.replace('router.', '')} before '/:id'`, pos(r) > 0 && pos(r) < pos("router.get('/:id',"), true);
}
const expectRoutes = [
  ["router.get('/monitoring/summary'", "'risks', 'view'"],
  ["router.get('/monitoring/trend'", "'risks', 'view'"],
  ["router.get('/review-flags'", "'risks', 'view'"],
  ["router.get('/:id/history'", "'risks', 'view'"],
  ["router.get('/:id/review-flags'", "'risks', 'view'"],
  ["router.post('/:id/review'", "'risks', 'edit'"],
  ["router.get('/:id/kris'", "'risks', 'view'"],
  ["router.post('/:id/kris'", "'risks', 'edit'"],
  ["router.put('/:id/kris/:kriId'", "'risks', 'edit'"],
  ["router.delete('/:id/kris/:kriId'", "'risks', 'edit'"],
];
for (const [route, perm] of expectRoutes) {
  const line = routes.split('\n').find(l => l.startsWith(route + ','));
  eq(`${route.replace('router.', '')} → authenticate + ${perm}`, !!line && line.includes('authenticate') && line.includes(`requirePermission(${perm}`), true);
}
const spec = JSON.parse(fs.readFileSync(path.join(SRC, 'openapi.json'), 'utf8'));
eq('OpenAPI describes the new endpoints', ['/risks/monitoring/summary', '/risks/monitoring/trend', '/risks/review-flags', '/risks/{id}/history', '/risks/{id}/review-flags', '/risks/{id}/review', '/risks/{id}/kris', '/risks/{id}/kris/{kriId}'].every(p => !!spec.paths[p]), true);

console.log('\nTriggers wired on every write path');
const src = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
eq('incidents: REST create/update', (src('routes/incidents.js').match(/monitoring\.onIncident\(/g) || []).length, 2);
eq('incidents: MCP create/update', (src('mcp/server.js').match(/\.onIncident\(/g) || []).length, 2);
eq('audit findings: REST create/update', (src('routes/compliance.js').match(/monitoring\.onAuditFinding\(/g) || []).length, 2);
eq('audit findings: MCP create/update', (src('mcp/server.js').match(/\.onAuditFinding\(/g) || []).length, 2);
eq('threat advisories: REST assess + asset link, MCP assess', [(src('routes/threatIntel.js').match(/\.onThreatAdvisory\(/g) || []).length, (src('mcp/server.js').match(/\.onThreatAdvisory\(/g) || []).length], [2, 1]);
const idx = src('models/index.js');
eq('model hooks: risk history, KPI measurement, asset CVEs, task sync', ['onRiskCreated', 'onRiskUpdated', 'onKpiMeasurement', 'onAssetUpdated', "riskReviewFlagSync"].every(s => idx.includes(s)), true);

console.log('\nMCP');
const mcp = src('mcp/server.js');
const gates = {
  isms_get_risk_history: "perm: ['risks', 'view']",
  isms_get_risk_trend: "perm: ['risks', 'view']",
  isms_get_risk_monitoring_summary: "perm: ['risks', 'view']",
  isms_list_risk_review_flags: "perm: ['risks', 'view']",
  isms_review_risk: "perm: ['risks', 'edit']",
  isms_list_risk_kris: "perm: ['risks', 'view']",
  isms_link_risk_kri: "perm: ['risks', 'edit']",
  isms_update_risk_kri: "perm: ['risks', 'edit']",
  isms_unlink_risk_kri: "perm: ['risks', 'edit']",
};
for (const [tool, perm] of Object.entries(gates)) {
  const line = mcp.split('\n').find(l => l.includes(`'${tool}': {`));
  eq(`${tool} gated with ${perm.replace('perm: ', '')}`, !!line && line.includes(perm), true);
  eq(`${tool} registered`, mcp.includes(`server.tool(\n  '${tool}'`), true);
}
eq('writing tools need write access', ['isms_review_risk', 'isms_link_risk_kri', 'isms_update_risk_kri', 'isms_unlink_risk_kri'].every(t => mcp.split('\n').find(l => l.includes(`'${t}': {`)).includes('needsWrite: true')), true);
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const mcpDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'MCP.md'), 'utf8');
const count = (mcp.match(/^server\.tool\(\n {2}'/gm) || []).length;
eq('README and docs/MCP.md tool count match the registered tools', [readme.includes(`MCP-${count}%20tools`), mcpDoc.includes(`## 11. Tool reference (${count} tools)`)], [true, true]);
eq('every new tool documented in docs/MCP.md', Object.keys(gates).every(t => mcpDoc.includes(`| \`${t}\` |`)), true);

console.log('\nJobs');
eq('withJobSlot and dailySlot exported', [typeof jobLock.withJobSlot, jobLock.dailySlot(new Date('2026-11-25T23:30:00Z'))], ['function', '2026-11-25']);
const index = src('index.js');
eq('daily monitoring job runs through withJobSlot', /withJobSlot\('risk-monitoring', dailySlot\(\)/.test(index), true);
eq('risk acceptance expiry runs through withJobSlot', /withJobSlot\('risk-acceptance-expiry', dailySlot\(\)/.test(src('services/reminderService.js')), true);
eq('startup migration: baseline and flag index', index.includes('ensureBaseline()') && index.includes("riskMonitoringService').ensureIndexes()"), true);

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
