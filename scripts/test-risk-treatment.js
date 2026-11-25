#!/usr/bin/env node
'use strict';

/**
 * Risk treatment and acceptance workflow (3.8.0) without a database (models
 * mocked):
 *
 *   1. Treatment options: fixed list, catalogue order, main option included.
 *   2. Treatment items: allowlist, validation (costs, ids, dates, discarded
 *      needs a reason, person OR group), completed_at managed by the server.
 *   3. Progress: share of implemented items, overdue, costs, hint when all
 *      items are implemented but the risk is above appetite.
 *   4. Routes: overview routes before '/:id', every new route guarded.
 *   5. MCP: every new tool gated with the same matrix entry as its route;
 *      matrix entry risks.request_acceptance.
 *
 * Run: node scripts/test-risk-treatment.js
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'backend', 'src');

Module._cache[require.resolve(path.join(SRC, 'models'))] = { id: 'models', loaded: true, exports: { User: {}, RiskMethodology: {} } };
for (const svc of ['auditService', 'notifyService']) {
  Module._cache[require.resolve(path.join(SRC, 'services', svc))] = { id: svc, loaded: true, exports: { auditFromReq: async () => {}, notify: async () => {} } };
}

const riskService = require(path.join(SRC, 'services', 'riskService'));
const treat = require(path.join(SRC, 'services', 'riskTreatmentService'));
const acc = require(path.join(SRC, 'services', 'riskAcceptanceService'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const throwsStatus = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.status || e.message; } };

console.log('Treatment options');
eq('normalised to catalogue order, duplicates dropped', riskService.normalizeOptions(['transfer', 'mitigate', 'transfer']), ['mitigate', 'transfer']);
eq('unknown option → 400', throwsStatus(() => riskService.normalizeOptions(['mitigate', '__proto__'])), 400);
eq('not a list → 400', throwsStatus(() => riskService.normalizeOptions('mitigate')), 400);
eq('empty/null → null', [riskService.normalizeOptions([]), riskService.normalizeOptions(null)], [null, null]);
eq('optionsOf: legacy NULL = main option', riskService.optionsOf({ treatment: 'avoid', treatment_options: null }), ['avoid']);
eq('optionsOf: main option always included', riskService.optionsOf({ treatment: 'accept', treatment_options: ['transfer'] }), ['accept', 'transfer']);
const f1 = { treatment: 'transfer' };
riskService.applyOptions(f1, { treatment: 'mitigate', treatment_options: null });
eq('applyOptions: NULL stays NULL when the list was not sent', Object.prototype.hasOwnProperty.call(f1, 'treatment_options'), false);
const f2 = { treatment: 'avoid' };
riskService.applyOptions(f2, { treatment: 'mitigate', treatment_options: ['mitigate', 'transfer'] });
eq('applyOptions: new main option added to an existing list', f2.treatment_options, ['mitigate', 'transfer', 'avoid']);
eq('buildFields: treatment_options only when sent (full PUT)', Object.prototype.hasOwnProperty.call(riskService.buildFields({ title: 't' }), 'treatment_options'), false);
eq('buildFields: acceptance_request_id / accepted_* not writable', riskService.buildFields({ title: 't', acceptance_request_id: 5, accepted_by_id: 1, accepted_until: '2030-01-01' }, { partial: true }), { title: 't' });

console.log('\nTreatment items: fields');
const f = treat.buildItemFields({ title: '  Encrypt  ', id: 9, risk_id: 3, created_by_id: 1, completed_at: '2020-01-01', cost_once: 10.005, cost_recurring: '200.5', due_date: '2026-12-31', responsible_user_id: '4' });
eq('allowlist, trimmed title, defaults, costs as cents, ids as numbers', f, { title: 'Encrypt', treatment_option: 'mitigate', status: 'planned', due_date: '2026-12-31', cost_once: '10.01', cost_recurring: '200.50', responsible_user_id: 4, responsible_group_id: null, completed_at: null });
eq('missing title on create → 400', throwsStatus(() => treat.buildItemFields({})), 400);
eq('title longer than 255 → 400', throwsStatus(() => treat.buildItemFields({ title: 'x'.repeat(256) })), 400);
eq('person and group → 400', throwsStatus(() => treat.buildItemFields({ title: 't', responsible_user_id: 1, responsible_group_id: 2 })), 400);
eq('group clears person', ((x) => [x.responsible_group_id, x.responsible_user_id])(treat.buildItemFields({ title: 't', responsible_group_id: 2 })), [2, null]);
eq('id as array → 400', throwsStatus(() => treat.buildItemFields({ title: 't', control_id: [5] })), 400);
eq('id 0 / negative / fraction → 400', ['0', -1, 1.5].map(v => throwsStatus(() => treat.buildItemFields({ title: 't', task_id: v }))), [400, 400, 400]);
eq('costs: negative, three decimals, comma, huge, text → 400', [-1, '1.234', '1,5', 1e13, 'abc', { a: 1 }].map(v => throwsStatus(() => treat.buildItemFields({ title: 't', cost_once: v }))), [400, 400, 400, 400, 400, 400]);
eq('cost string of hostile length is rejected fast', ((t) => [throwsStatus(() => treat.buildItemFields({ title: 't', cost_once: '9'.repeat(100000) + 'x' })), Date.now() - t < 200])(Date.now()), [400, true]);
eq('discarded without reason → 400', throwsStatus(() => treat.buildItemFields({ title: 't', status: 'discarded' })), 400);
eq('discarded with existing reason ok on update', throwsStatus(() => treat.buildItemFields({ status: 'discarded' }, { existing: { status: 'planned', status_reason: 'old' } })), 'ok');
eq('invalid status / option → 400', [throwsStatus(() => treat.buildItemFields({ title: 't', status: 'done' })), throwsStatus(() => treat.buildItemFields({ title: 't', treatment_option: 'ignore' }))], [400, 400]);
eq('invalid date → 400', throwsStatus(() => treat.buildItemFields({ title: 't', due_date: '31.12.2026' })), 400);
const upd = treat.buildItemFields({ status: 'implemented' }, { existing: { status: 'in_progress' } });
eq('update: only sent fields; implemented sets completed_at', [Object.keys(upd).sort(), upd.completed_at instanceof Date], [['completed_at', 'status'], true]);
eq('leaving implemented clears completed_at', treat.buildItemFields({ status: 'in_progress' }, { existing: { status: 'implemented' } }).completed_at, null);
eq('same status: completed_at untouched', Object.prototype.hasOwnProperty.call(treat.buildItemFields({ status: 'implemented' }, { existing: { status: 'implemented' } }), 'completed_at'), false);

console.log('\nProgress');
const today = new Date().toISOString().slice(0, 10);
const items = [
  { status: 'implemented', cost_once: '100.10', cost_recurring: null },
  { status: 'planned', due_date: '2000-01-01', cost_once: '0.20', cost_recurring: '50' },
  { status: 'discarded', cost_once: '999' },
  { status: 'in_progress', due_date: today },
];
eq('counts, overdue (due today is not overdue), percent without discarded, no costs in list mode',
  riskService.treatmentProgress(items, true),
  { total: 4, planned: 1, in_progress: 1, implemented: 1, discarded: 1, overdue: 1, percent: 33, all_implemented: false, complete_above_appetite: false });
eq('detail: cost totals without discarded, exact to the cent', ((p) => [p.cost_once_total, p.cost_recurring_total])(riskService.treatmentProgress(items, false, { detail: true })), [100.3, 50]);
eq('all implemented + appetite exceeded → hint', ((p) => [p.percent, p.all_implemented, p.complete_above_appetite])(riskService.treatmentProgress([{ status: 'implemented' }, { status: 'discarded' }], true)), [100, true, true]);
eq('all implemented, within appetite → no hint', riskService.treatmentProgress([{ status: 'implemented' }], false).complete_above_appetite, false);
eq('no items → percent null, no hint', ((p) => [p.percent, p.all_implemented])(riskService.treatmentProgress([], true)), [null, false]);
eq('only discarded → percent null', riskService.treatmentProgress([{ status: 'discarded' }], true).percent, null);
eq('acceptance request statuses', acc.STATUSES, ['pending', 'approved', 'rejected', 'withdrawn']);

console.log('\nRoutes');
const routes = fs.readFileSync(path.join(SRC, 'routes', 'risks.js'), 'utf8');
const pos = (s) => routes.indexOf(s);
eq("'/treatment-plan' and '/acceptance-requests' registered before '/:id'", [pos("router.get('/treatment-plan'") > 0, pos("router.get('/treatment-plan'") < pos("router.get('/:id',"), pos("router.get('/acceptance-requests'") < pos("router.get('/:id',")], [true, true, true]);
const expectRoutes = [
  ["router.get('/treatment-plan'", "'risks', 'view'"],
  ["router.get('/acceptance-requests'", "'risks', 'view'"],
  ["router.get('/:id/treatment-items'", "'risks', 'view'"],
  ["router.post('/:id/treatment-items'", "'risks', 'edit'"],
  ["router.put('/:id/treatment-items/:itemId'", "'risks', 'edit'"],
  ["router.post('/:id/treatment-items/:itemId/task'", "'risks', 'edit'"],
  ["router.get('/:id/acceptance-requests'", "'risks', 'view'"],
  ["router.post('/:id/acceptance-requests'", "'risks', 'request_acceptance'"],
  ["router.post('/:id/acceptance-requests/:requestId/approve'", "'risks', 'sign_off'"],
  ["router.post('/:id/acceptance-requests/:requestId/reject'", "'risks', 'sign_off'"],
  ["router.post('/:id/acceptance-requests/:requestId/withdraw'", "'risks', 'request_acceptance'"],
  ["router.post('/:id/acceptance-requests/:requestId/confirm-owner'", "'risks', 'view'"],
];
for (const [route, perm] of expectRoutes) {
  const line = routes.split('\n').find(l => l.startsWith(route + ','));
  eq(`${route.replace('router.', '')} → authenticate + ${perm}`, !!line && line.includes('authenticate') && line.includes(`requirePermission(${perm}`), true);
}

console.log('\nMCP gates and matrix');
const mcp = fs.readFileSync(path.join(SRC, 'mcp', 'server.js'), 'utf8');
const gates = {
  isms_list_risk_treatment_items: "perm: ['risks', 'view']",
  isms_create_risk_treatment_item: "perm: ['risks', 'edit']",
  isms_update_risk_treatment_item: "perm: ['risks', 'edit']",
  isms_create_task_from_treatment_item: "perm: ['risks', 'edit']",
  isms_get_risk_treatment_plan: "perm: ['risks', 'view']",
  isms_list_risk_acceptance_requests: "perm: ['risks', 'view']",
  isms_request_risk_acceptance: "perm: ['risks', 'request_acceptance']",
  isms_withdraw_risk_acceptance: "perm: ['risks', 'request_acceptance']",
  isms_approve_risk_acceptance: "perm: ['risks', 'sign_off']",
  isms_reject_risk_acceptance: "perm: ['risks', 'sign_off']",
  isms_confirm_risk_acceptance_as_owner: "perm: ['risks', 'view']",
};
for (const [tool, perm] of Object.entries(gates)) {
  const line = mcp.split('\n').find(l => l.includes(`'${tool}': {`));
  eq(`${tool} gated with ${perm.replace('perm: ', '')}`, !!line && line.includes(perm), true);
  eq(`${tool} registered`, mcp.includes(`server.tool(\n  '${tool}'`), true);
}
const writeTools = ['isms_create_risk_treatment_item', 'isms_update_risk_treatment_item', 'isms_create_task_from_treatment_item', 'isms_request_risk_acceptance', 'isms_withdraw_risk_acceptance'];
eq('writing tools need write access', writeTools.every(t => mcp.split('\n').find(l => l.includes(`'${t}': {`)).includes('needsWrite: true')), true);
const settings = fs.readFileSync(path.join(SRC, 'services', 'settingsService.js'), 'utf8');
const reqRoles = /request_acceptance: \[([^\]]*)\]/.exec(settings);
eq('matrix: risks.request_acceptance = edit roles, not viewer/employee/management', reqRoles && reqRoles[1].split(',').map(s => s.trim().replace(/'/g, '')), ['admin', 'assessor', 'it-staff', 'dpo', 'owner']);
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const count = (mcp.match(/^server\.tool\(\n {2}'/gm) || []).length;
eq('README tool count matches the registered tools', readme.includes(`MCP-${count}%20tools`), true);

console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
