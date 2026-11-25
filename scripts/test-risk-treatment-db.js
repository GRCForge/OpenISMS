#!/usr/bin/env node
'use strict';

/**
 * Integration test against a THROWAWAY Postgres database: risk treatment and
 * acceptance workflow (3.8.0).
 *
 *   1. Several treatment options per risk; the main option stays valid.
 *   2. Treatment items: allowlist, validation, record rights, audit log,
 *      progress and costs, hint "all implemented but above appetite".
 *   3. Task from an item; status in step both ways (REST-like instance
 *      update, bulk update, reopen), audit-logged.
 *   4. Overview with visibility rules; overdue reminder once a day.
 *   5. Acceptance: request -> approve (four-eyes, authority, level unchanged),
 *      reject, withdraw, owner confirmation, sign-off only via request,
 *      lapse/revoke end the request, pre-3.8.0 acceptances stay valid.
 *
 * Runs only with RISK_TREATMENT_TEST_DB=1 and DB_* pointing at an empty test
 * database - schema public is dropped:
 *
 *   RISK_TREATMENT_TEST_DB=1 DB_HOST=/tmp DB_PORT=55433 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x node scripts/test-risk-treatment-db.js
 */

if (process.env.RISK_TREATMENT_TEST_DB !== '1') {
  console.log('Skipped (set RISK_TREATMENT_TEST_DB=1 and DB_* for a throwaway database).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');

let failures = 0;
const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
};
const eq = (label, actual, expected) => {
  const ok = stable(actual) === stable(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await (typeof p === 'function' ? p() : p); return 'ok'; } catch (e) { if (process.env.DEBUG_TEST) console.log('   ', e.message); return e.status || e.name; } };
const daysFromToday = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const rm = require(path.join(SRC, 'services', 'riskMethodology'));
  const svc = require(path.join(SRC, 'services', 'riskService'));
  const cats = require(path.join(SRC, 'services', 'riskCategoryService'));
  const treat = require(path.join(SRC, 'services', 'riskTreatmentService'));
  const acc = require(path.join(SRC, 'services', 'riskAcceptanceService'));

  await m.sequelize.sync({ alter: { drop: false } });
  await rm.ensureDefaultProfile();
  await cats.ensureCategories();
  await acc.ensureIndexes();
  const mkUser = (name, role) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role });
  const admin = await mkUser('admin', 'admin');
  const assessor = await mkUser('assessor', 'assessor');
  const owner = await mkUser('owner', 'owner');
  const other = await mkUser('other', 'owner');
  const it = await mkUser('it', 'it-staff');
  const mgmt = await mkUser('mgmt', 'management');
  const viewer = await mkUser('viewer', 'viewer');
  const req = (u) => ({ user: u });
  const lastAudit = async (type, id) => m.AuditLog.findOne({ where: { entity_type: type, entity_id: id }, order: [['id', 'DESC']] });
  const R = { likelihood_rationale: 'Observed twice.', impact_rationale: 'Customer data.' };
  const upd = (risk, body, u = admin) => svc.updateRisk(risk, body, u, req(u), { partial: true });
  const reload = (id) => m.Risk.findByPk(id);

  // Methodology v2: appetite for privacy = low; acceptance: medium by
  // assessor/management/admin, high only by management, max 12 months.
  const base = JSON.parse(JSON.stringify(rm.DEFAULT_PROFILE));
  base.appetite = { default_max_level: null, categories: [{ category: 'privacy', max_level: 'low' }] };
  base.acceptance = base.acceptance.map(a => (
    a.level === 'low' ? { ...a, roles: ['admin', 'assessor', 'owner', 'management'], max_months: 24 }
      : a.level === 'medium' ? { ...a, roles: ['admin', 'assessor', 'management'], max_months: 12 }
        : a.level === 'high' ? { ...a, roles: ['management'], max_months: 6 }
          : { ...a, roles: ['management'], max_months: 3 }));
  await rm.saveNewVersion(base, admin, { changeNote: 'test' });

  console.log('Treatment options:');
  const r1 = await svc.createRisk({ title: 'Data leak', category: 'privacy', owner_id: owner.id, likelihood: 3, impact: 3, treatment: 'mitigate', treatment_options: ['transfer', 'mitigate'], treatment_plan: 'Free text plan', ...R }, admin, req(admin));
  eq('create: options in catalogue order, main option included', [r1.treatment, r1.treatment_options], ['mitigate', ['mitigate', 'transfer']]);
  const r0 = await svc.createRisk({ title: 'No options', owner_id: owner.id, likelihood: 1, impact: 1, ...R }, admin, req(admin));
  eq('without treatment_options: column stays NULL, response = main option', [(await reload(r0.id)).treatment_options, r0.treatment_options], [null, ['mitigate']]);
  eq('unknown option → 400', await status(svc.createRisk({ title: 'x', likelihood: 1, impact: 1, treatment_options: ['ignore'], ...R }, admin, req(admin))), 400);
  eq('options not a list → 400', await status(svc.createRisk({ title: 'x', likelihood: 1, impact: 1, treatment_options: 'transfer', ...R }, admin, req(admin))), 400);
  const r1b = await upd(await reload(r1.id), { treatment: 'avoid' });
  eq('main option changed: added to the list, others kept', [r1b.treatment, r1b.treatment_options], ['avoid', ['mitigate', 'transfer', 'avoid']]);
  const r1c = await upd(await reload(r1.id), { treatment: 'mitigate', treatment_options: ['transfer'] });
  eq('list replaced: main option always included', r1c.treatment_options, ['mitigate', 'transfer']);
  eq('free-text treatment plan untouched', r1c.treatment_plan, 'Free text plan');

  console.log('\nTreatment items:');
  const grp = await m.Group.create({ name: 'IT ops' });
  await m.GroupMember.create({ group_id: grp.id, user_id: it.id });
  const ctrl = await m.Control.create({ framework: 'custom', code: 'C-9', title: 'Encryption', status: 'planned' });
  const risk1 = await reload(r1.id);
  eq('create without title → 400', await status(treat.createItem(risk1, { description: 'x' }, admin, req(admin))), 400);
  eq('person AND group → 400', await status(treat.createItem(risk1, { title: 'x', responsible_user_id: it.id, responsible_group_id: grp.id }, admin, req(admin))), 400);
  eq('unknown control → 400', await status(treat.createItem(risk1, { title: 'x', control_id: 999999 }, admin, req(admin))), 400);
  eq('unknown option → 400', await status(treat.createItem(risk1, { title: 'x', treatment_option: 'pray' }, admin, req(admin))), 400);
  eq('discarded without reason → 400', await status(treat.createItem(risk1, { title: 'x', status: 'discarded' }, admin, req(admin))), 400);
  eq('cost with three decimals → 400', await status(treat.createItem(risk1, { title: 'x', cost_once: '10.123' }, admin, req(admin))), 400);
  eq('negative cost → 400', await status(treat.createItem(risk1, { title: 'x', cost_once: -1 }, admin, req(admin))), 400);
  eq('cost as hostile string → 400', await status(treat.createItem(risk1, { title: 'x', cost_once: '1'.repeat(5000) + 'x' }, admin, req(admin))), 400);
  eq('invalid due date → 400', await status(treat.createItem(risk1, { title: 'x', due_date: '2026-02-30' }, admin, req(admin))), 400);
  eq('other owner (no record rights) → 403', await status(treat.createItem(risk1, { title: 'x' }, other, req(other))), 403);
  const i1 = await treat.createItem(risk1, { title: 'Encrypt CRM database', description: 'AES-256 at rest', treatment_option: 'mitigate', responsible_user_id: it.id, due_date: daysFromToday(-3), cost_once: 1500.5, cost_recurring: '200', control_id: ctrl.id, id: 999, risk_id: r0.id, created_by_id: viewer.id, completed_at: '2020-01-01' }, owner, req(owner));
  eq('created: allowlist (id/risk_id/created_by/completed_at not settable), costs, control', [i1.id !== 999, i1.risk_id, i1.created_by_id, i1.completed_at, i1.cost_once, i1.cost_recurring, i1.control?.code, i1.status], [true, r1.id, owner.id, null, '1500.50', '200.00', 'C-9', 'planned']);
  const i1log = await lastAudit('risk_treatment_item', i1.id);
  eq('create audit-logged and signed', [i1log.action, i1log.details.risk_id, i1log.details.cost_once, !!i1log.integrity_hash], ['create', r1.id, 1500.5, true]);
  eq('responsible person notified', await m.Notification.count({ where: { user_id: it.id, title: 'Maßnahme zur Risikobehandlung zugewiesen' } }), 1);
  const i2 = await treat.createItem(risk1, { title: 'Cyber insurance', treatment_option: 'transfer', responsible_group_id: grp.id, cost_recurring: 3000 }, admin, req(admin));
  const i3 = await treat.createItem(risk1, { title: 'Old idea', status: 'discarded', status_reason: 'Too expensive', cost_once: 99999 }, admin, req(admin));
  eq('group responsibility, discarded with reason', [i2.responsibleGroup?.name, i3.status, i3.status_reason], ['IT ops', 'discarded', 'Too expensive']);

  let detail = await svc.loadFull(r1.id);
  eq('detail: items in order, progress, costs without the discarded item', [detail.treatmentItems.map(i => i.id), detail.treatment_progress], [[i1.id, i2.id, i3.id], {
    total: 3, planned: 2, in_progress: 0, implemented: 0, discarded: 1, overdue: 1, percent: 0, all_implemented: false, complete_above_appetite: false, cost_once_total: 1500.5, cost_recurring_total: 3200,
  }]);
  const list = await svc.decorate(await m.Risk.findAll({ where: { id: r1.id }, include: svc.includeAll() }));
  eq('register list: progress without costs, no items, no requests', [list[0].treatment_progress.cost_once_total, list[0].treatmentItems, list[0].acceptanceRequests, list[0].treatment_progress.percent], [undefined, undefined, undefined, 0]);

  const itemRow = (id) => m.RiskTreatmentItem.findByPk(id);
  eq('update by other owner → 403', await status(treat.updateItem(risk1, await itemRow(i1.id), { title: 'x' }, other, req(other))), 403);
  eq('item of another risk → 404', await status(treat.updateItem(await reload(r0.id), await itemRow(i1.id), { title: 'x' }, admin, req(admin))), 404);
  const u1 = await treat.updateItem(risk1, await itemRow(i1.id), { status: 'in_progress', risk_id: r0.id, completed_at: '2020-01-01' }, owner, req(owner));
  eq('status change; risk_id/completed_at not writable', [u1.status, u1.risk_id, u1.completed_at], ['in_progress', r1.id, null]);
  const u1log = await lastAudit('risk_treatment_item', i1.id);
  eq('update audit: only changed fields before/after', [u1log.details.before, u1log.details.after], [{ status: 'planned' }, { status: 'in_progress' }]);
  eq('discarding without reason → 400', await status(treat.updateItem(risk1, await itemRow(i2.id), { status: 'discarded' }, admin, req(admin))), 400);
  const sw = await treat.updateItem(risk1, await itemRow(i2.id), { responsible_user_id: owner.id }, admin, req(admin));
  eq('switching to a person clears the group', [sw.responsible_user_id, sw.responsible_group_id], [owner.id, null]);
  await treat.updateItem(risk1, await itemRow(i2.id), { responsible_group_id: grp.id }, admin, req(admin));

  console.log('\nTask from an item and status sync:');
  eq('viewer cannot create a task (record rights) → 403', await status(treat.createTaskForItem(risk1, await itemRow(i1.id), viewer, req(viewer))), 403);
  eq('discarded item → 409', await status(treat.createTaskForItem(risk1, await itemRow(i3.id), admin, req(admin))), 409);
  const withTask = await treat.createTaskForItem(risk1, await itemRow(i1.id), owner, req(owner));
  const task = await m.Task.findByPk(withTask.task_id);
  eq('task: title with ref, assignee, due date, related risk, priority from level, in_progress kept', [task.title, task.assigned_to_id, task.due_date, task.related_type, task.related_id, task.priority, task.status, task.created_by_id], [`${r1.ref}: Encrypt CRM database`, it.id, daysFromToday(-3), 'risk', r1.id, 'medium', 'in_progress', owner.id]);
  eq('assignee notified about the task', await m.Notification.count({ where: { user_id: it.id, title: 'Neue Aufgabe' } }), 1);
  eq('second task while one is open → 409', await status(treat.createTaskForItem(risk1, await itemRow(i1.id), owner, req(owner))), 409);
  eq('task creation audit-logged on item and task', [(await lastAudit('risk_treatment_item', i1.id)).details.action, (await lastAudit('task', task.id)).details.treatment_item_id], ['task_created', i1.id]);
  const gTask = await treat.createTaskForItem(risk1, await itemRow(i2.id), admin, req(admin), { priority: 'low' });
  const gTaskRow = await m.Task.findByPk(gTask.task_id);
  eq('group item: task assigned to the group, priority as given', [gTaskRow.assigned_to_group_id, gTaskRow.assigned_to_id, gTaskRow.priority], [grp.id, null, 'low']);

  // Task done via instance update (as routes/tasks.js PUT does).
  await task.update({ status: 'done', completed_at: new Date(), completed_by_id: it.id });
  let it1 = await itemRow(i1.id);
  eq('task done → item implemented, completed_at set', [it1.status, !!it1.completed_at], ['implemented', true]);
  const syncLog = await lastAudit('risk_treatment_item', i1.id);
  eq('sync audit-logged with the completing user', [syncLog.details.action, syncLog.details.task_id, syncLog.actor_id, syncLog.details.after.status], ['status_from_task', task.id, it.id, 'implemented']);
  await task.update({ status: 'open', completed_at: null });
  it1 = await itemRow(i1.id);
  eq('task reopened → item back to in_progress, completed_at cleared', [it1.status, it1.completed_at], ['in_progress', null]);
  // Bulk update (as reminders.js / MCP do).
  await m.Task.update({ status: 'done', completed_at: new Date(), completed_by_id: admin.id }, { where: { id: task.id } });
  eq('bulk task update done → item implemented', (await itemRow(i1.id)).status, 'implemented');
  // Item implemented manually → linked task done.
  await treat.updateItem(risk1, await itemRow(i2.id), { status: 'implemented' }, admin, req(admin));
  eq('item implemented → open task done (by the editor), logged', [(await m.Task.findByPk(gTaskRow.id)).status, (await m.Task.findByPk(gTaskRow.id)).completed_by_id, (await lastAudit('task', gTaskRow.id)).details.action], ['done', admin.id, 'status_from_treatment_item']);
  // Discarded item cancels an open task.
  const i4 = await treat.createItem(risk1, { title: 'Temp measure', responsible_user_id: it.id }, admin, req(admin));
  const t4 = await treat.createTaskForItem(risk1, await itemRow(i4.id), admin, req(admin));
  await treat.updateItem(risk1, await itemRow(i4.id), { status: 'discarded', status_reason: 'Replaced by C-9' }, admin, req(admin));
  eq('item discarded → open task cancelled', (await m.Task.findByPk(t4.task_id)).status, 'cancelled');
  const cancelled = await m.Task.findByPk(t4.task_id);
  await cancelled.update({ status: 'done' });
  eq('task done on a discarded item: item stays discarded', (await itemRow(i4.id)).status, 'discarded');

  detail = await svc.loadFull(r1.id);
  eq('all active items implemented, net risk above appetite (privacy: low) → hint', [detail.treatment_progress.percent, detail.treatment_progress.all_implemented, detail.appetite_exceeded, detail.treatment_progress.complete_above_appetite], [100, true, true, true]);

  console.log('\nOverview and reminders:');
  const risk2 = await svc.createRisk({ title: 'Other owner risk', owner_id: other.id, likelihood: 2, impact: 2, ...R }, admin, req(admin));
  const j1 = await treat.createItem(await reload(risk2.id), { title: 'Other measure', responsible_user_id: viewer.id, due_date: daysFromToday(-1) }, admin, req(admin));
  const plan = await treat.listPlan(admin, {});
  eq('admin: all items, summary, risks without plan (open/in treatment)', [plan.items.length, plan.summary.items, plan.summary.overdue, plan.risks_without_plan.map(r => r.id).sort()], [5, 5, 1, [r0.id]]);
  eq('overview row carries risk, level, appetite, responsible and overdue', ((row) => [row.risk.ref, row.risk.appetite_exceeded, row.responsibleUser?.name, row.overdue, row.cost_once])(plan.items.find(x => x.id === j1.id)), [risk2.ref, false, 'viewer', true, null]);
  eq('costs in the summary without discarded items', [plan.summary.cost_once_total, plan.summary.cost_recurring_total], [1500.5, 3200]);
  eq('management sees everything', (await treat.listPlan(mgmt, {})).items.length, 5);
  const pOwner = await treat.listPlan(owner, {});
  eq('owner: only the own risk (incl. risks without plan of their own)', [pOwner.items.every(i => i.risk.id === r1.id), pOwner.items.length, pOwner.risks_without_plan.map(r => r.id)], [true, 4, [r0.id]]);
  eq('viewer: only the item they are responsible for', (await treat.listPlan(viewer, {})).items.map(i => i.id), [j1.id]);
  eq('it-staff: items of their group and their own', (await treat.listPlan(it, {})).items.map(i => i.id).sort((a, b) => a - b), [i1.id, i2.id, i4.id].sort((a, b) => a - b));
  eq('filter overdue', (await treat.listPlan(admin, { overdue: 'true' })).items.map(i => i.id), [j1.id]);
  eq('filter status, invalid status → 400', [(await treat.listPlan(admin, { status: 'discarded' })).items.length, await status(treat.listPlan(admin, { status: 'nope' }))], [2, 400]);
  const rem1 = await treat.checkOverdueItems();
  const rem2 = await treat.checkOverdueItems();
  eq('overdue reminder: once a day per user', [rem1.notified, rem2.notified, await m.Notification.count({ where: { user_id: viewer.id, title: 'Maßnahme zur Risikobehandlung überfällig' } })], [1, 0, 1]);

  console.log('\nAcceptance workflow:');
  // r3: medium (3x3 with no controls) in category it_security (no appetite).
  const r3 = await svc.createRisk({ title: 'Legacy VPN', category: 'it_security', owner_id: owner.id, likelihood: 3, impact: 3, ...R }, admin, req(admin));
  const risk3 = await reload(r3.id);
  eq('direct sign-off without request → 409', await status(svc.signoffRisk(risk3, assessor, null, req(assessor))), 409);
  eq('status accepted via PUT still refused → 400', await status(upd(risk3, { status: 'accepted' })), 400);
  eq('request without justification → 400', await status(acc.requestAcceptance(risk3, { requested_until: daysFromToday(30) }, owner, req(owner))), 400);
  eq('request with date in the past → 400', await status(acc.requestAcceptance(risk3, { justification: 'x', requested_until: daysFromToday(-1) }, owner, req(owner))), 400);
  eq('request beyond max months (12) → 400', await status(acc.requestAcceptance(risk3, { justification: 'x', requested_until: daysFromToday(800) }, owner, req(owner))), 400);
  eq('request by other owner (no record rights) → 403', await status(acc.requestAcceptance(risk3, { justification: 'x' }, other, req(other))), 403);
  eq('confirm_as_owner by a non-owner → 400', await status(acc.requestAcceptance(risk3, { justification: 'x', confirm_as_owner: true }, admin, req(admin))), 400);
  let d3 = await acc.requestAcceptance(risk3, { justification: 'Replacement in Q3, compensating MFA.', residual_risk_description: 'Exposure until migration.', requested_until: daysFromToday(90), status: 'approved', decided_by_id: admin.id }, owner, req(owner));
  const rq1 = d3.acceptanceRequests[0];
  eq('request stored: pending, snapshot level/values, requester, allowlist', [rq1.status, rq1.residual_level, rq1.residual_likelihood, rq1.residual_impact, rq1.requestedBy?.id, rq1.decided_by_id, d3.acceptance_pending_request_id, d3.status], ['pending', 'medium', 3, 3, owner.id, null, rq1.id, 'open']);
  eq('request audit-logged', [(await lastAudit('risk_acceptance_request', rq1.id)).action, (await lastAudit('risk_acceptance_request', rq1.id)).details.residual_level], ['create', 'medium']);
  eq('approvers (assessor, management, admin) notified', await m.Notification.count({ where: { title: 'Akzeptanzantrag zur Freigabe' } }), 3);
  eq('owner = requester: no owner-confirmation notification', await m.Notification.count({ where: { title: 'Akzeptanz des Restrisikos bestätigen' } }), 0);
  eq('second pending request → 409', await status(acc.requestAcceptance(await reload(r3.id), { justification: 'again' }, admin, req(admin))), 409);
  eq('partial unique index holds against a direct insert', await status(m.RiskAcceptanceRequest.create({ risk_id: r3.id, justification: 'race', requested_by_id: admin.id, requested_at: new Date() })), 'SequelizeUniqueConstraintError');
  const rqRow = () => m.RiskAcceptanceRequest.findByPk(rq1.id);
  eq('owner (no authority for medium) cannot approve → 403', await status(acc.approveRequest(await reload(r3.id), await rqRow(), owner, {}, req(owner))), 403);
  eq('it-staff (no sign-off record rights) cannot approve → 403', await status(acc.approveRequest(await reload(r3.id), await rqRow(), it, {}, req(it))), 403);
  eq('approval beyond max months → 400', await status(acc.approveRequest(await reload(r3.id), await rqRow(), assessor, { valid_until: daysFromToday(800) }, req(assessor))), 400);
  eq('reject without reason → 400', await status(acc.rejectRequest(await reload(r3.id), await rqRow(), assessor, {}, req(assessor))), 400);
  eq('confirm by non-owner → 403', await status(acc.confirmAsOwner(await reload(r3.id), await rqRow(), assessor, req(assessor))), 403);
  d3 = await acc.confirmAsOwner(await reload(r3.id), await rqRow(), owner, req(owner));
  eq('owner confirms residual risk on the pending request', [d3.acceptanceRequests[0].owner_confirmed, d3.acceptanceRequests[0].ownerConfirmedBy?.id], [true, owner.id]);
  eq('confirm twice → 409', await status(acc.confirmAsOwner(await reload(r3.id), await rqRow(), owner, req(owner))), 409);
  d3 = await acc.approveRequest(await reload(r3.id), await rqRow(), assessor, { note: 'ok until migration' }, req(assessor));
  eq('approved by assessor: risk accepted until requested date, linked request', [d3.status, d3.accepted_by_id, d3.accepted_until, d3.acceptance_request_id, d3.acceptanceRequests[0].status, d3.acceptanceRequests[0].approved_until, d3.acceptance_pending_request_id], ['accepted', assessor.id, daysFromToday(90), rq1.id, 'approved', daysFromToday(90), null]);
  const ackLog = await m.AuditLog.findOne({ where: { entity_type: 'risk', entity_id: r3.id, action: 'acknowledge' }, order: [['id', 'DESC']] });
  eq('acknowledge audit carries request, requester and owner flag', [ackLog.details.acceptance_request_id, ackLog.details.requested_by_id, ackLog.details.owner_confirmed, ackLog.details.level], [rq1.id, owner.id, true, 'medium']);
  eq('approving again → 409', await status(acc.approveRequest(await reload(r3.id), await rqRow(), admin, {}, req(admin))), 409);

  // Four-eyes: the requester cannot approve, even as admin.
  const r4 = await svc.createRisk({ title: 'Shadow IT', owner_id: owner.id, likelihood: 3, impact: 3, ...R }, admin, req(admin));
  await acc.requestAcceptance(await reload(r4.id), { justification: 'Low usage.' }, admin, req(admin));
  const rq4 = await acc.pendingRequest(r4.id);
  eq('requester (admin) cannot approve own request → 403', await status(acc.approveRequest(await reload(r4.id), rq4, admin, {}, req(admin))), 403);
  eq('requester cannot reject own request → 403', await status(acc.rejectRequest(await reload(r4.id), rq4, admin, { reason: 'x' }, req(admin))), 403);
  eq('owner notified to confirm (owner is not the requester)', await m.Notification.count({ where: { user_id: owner.id, title: 'Akzeptanz des Restrisikos bestätigen' } }), 1);
  // Level changed since the request → no approval.
  await upd(await reload(r4.id), { likelihood: 4, likelihood_rationale: 'More users.' });
  eq('level changed since request → 409', await status(acc.approveRequest(await reload(r4.id), await acc.pendingRequest(r4.id), mgmt, {}, req(mgmt))), 409);
  eq('withdraw by someone else → 403', await status(acc.withdrawRequest(await reload(r4.id), await acc.pendingRequest(r4.id), owner, {}, req(owner))), 403);
  const w4 = await acc.withdrawRequest(await reload(r4.id), await acc.pendingRequest(r4.id), admin, { note: 'level changed' }, req(admin));
  eq('withdrawn; new request possible', [w4.acceptanceRequests[0].status, await status(acc.requestAcceptance(await reload(r4.id), { justification: 'Re-request at high.' }, owner, req(owner)))], ['withdrawn', 'ok']);
  const rq4b = await acc.pendingRequest(r4.id);
  eq('high level: assessor has no authority → 403', await status(acc.approveRequest(await reload(r4.id), rq4b, assessor, {}, req(assessor))), 403);
  eq('reject by assessor without authority for high → 403', await status(acc.rejectRequest(await reload(r4.id), rq4b, assessor, { reason: 'no' }, req(assessor))), 403);
  const rej = await acc.rejectRequest(await reload(r4.id), rq4b, mgmt, { reason: 'Mitigate instead.' }, req(mgmt));
  eq('management rejects with reason; risk not accepted; logged', [rej.acceptanceRequests[0].status, rej.acceptanceRequests[0].decision_reason, rej.status, (await lastAudit('risk_acceptance_request', rq4b.id)).details.action], ['rejected', 'Mitigate instead.', 'open', 'rejected']);
  // Sign-off route semantics: approves the pending request.
  await acc.requestAcceptance(await reload(r4.id), { justification: 'Third try.', requested_until: daysFromToday(30) }, owner, req(owner));
  const so = await svc.signoffRisk(await reload(r4.id), mgmt, null, req(mgmt));
  eq('sign-off approves the pending request (requested date kept)', [so.status, so.accepted_by_id, so.accepted_until, so.acceptanceRequests[0].status], ['accepted', mgmt.id, daysFromToday(30), 'approved']);

  // Renewal: a new approval supersedes the current one.
  await acc.requestAcceptance(await reload(r3.id), { justification: 'Renewal.', requested_until: daysFromToday(120) }, owner, req(owner));
  const ren = await acc.approveRequest(await reload(r3.id), await acc.pendingRequest(r3.id), mgmt, {}, req(mgmt));
  eq('renewal: new request linked, previous one ended as superseded', [ren.acceptance_request_id !== rq1.id, (await rqRow()).end_reason, !!(await rqRow()).ended_at], [true, 'superseded', true]);
  const renId = ren.acceptance_request_id;
  // Lapse: level rises → acceptance ends, request records it.
  await upd(await reload(r3.id), { impact: 5, impact_rationale: 'Regulator involved.' });
  const lapsedRisk = await reload(r3.id);
  eq('level rises → acceptance lapses, request ended (lapsed)', [lapsedRisk.status, lapsedRisk.acceptance_request_id, (await m.RiskAcceptanceRequest.findByPk(renId)).end_reason], ['in_treatment', null, 'lapsed']);
  // Revoke ends the request too.
  const rv = await svc.revokeRisk(await reload(r4.id), mgmt, req(mgmt));
  eq('revoke: risk back to in_treatment, request ended (revoked)', [rv.status, (await m.RiskAcceptanceRequest.findOne({ where: { risk_id: r4.id, status: 'approved' } })).end_reason], ['in_treatment', 'revoked']);

  // Pre-3.8.0 acceptance (no request) stays valid and readable.
  const r5 = await svc.createRisk({ title: 'Old acceptance', owner_id: owner.id, likelihood: 1, impact: 2, ...R }, admin, req(admin));
  await sequelize.query(`UPDATE risks SET status = 'accepted', accepted_by_id = ${admin.id}, accepted_at = now(), accepted_until = '${daysFromToday(200)}' WHERE id = ${r5.id}`);
  const old = await svc.loadFull(r5.id);
  eq('pre-3.8.0 acceptance stays: accepted, no request, no pending', [old.status, old.accepted_by_id, old.acceptance_request_id, old.acceptanceRequests.length], ['accepted', admin.id, null, 0]);
  eq('editing it (title) keeps the acceptance', (await upd(await reload(r5.id), { title: 'Old acceptance (renamed)' })).status, 'accepted');

  console.log('\nAcceptance request lists:');
  const all = await acc.listRequests(admin, {});
  eq('admin sees all requests', all.length, await m.RiskAcceptanceRequest.count());
  eq('other owner sees none (no rights on those risks, no own requests)', (await acc.listRequests(other, {})).length, 0);
  eq('it-staff sees none', (await acc.listRequests(it, {})).length, 0);
  eq('filter status pending/invalid', [(await acc.listRequests(admin, { status: 'pending' })).length, await status(acc.listRequests(admin, { status: 'x' }))], [0, 400]);
  eq('risk deleted → items and requests deleted with it', await (async () => {
    await (await reload(r4.id)).destroy();
    return [await m.RiskAcceptanceRequest.count({ where: { risk_id: r4.id } }), await m.RiskTreatmentItem.count({ where: { risk_id: r4.id } })];
  })(), [0, 0]);
  eq('task deleted → item keeps going, task link cleared', await (async () => {
    await (await m.Task.findByPk(t4.task_id)).destroy();
    return (await itemRow(i4.id)).task_id;
  })(), null);

  await m.sequelize.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
