'use strict';

/**
 * Structured risk treatment plan (3.8.0) - ISO/IEC 27001:2022 6.1.3 c-e and
 * 8.3, ISO/IEC 27005:2022 clause 9. One path for REST and MCP (entry points in
 * services/riskService.js).
 *
 *   - items per risk: option, responsible user OR group, due date, status
 *     (discarded only with a reason), costs one-off/recurring in EUR, link to
 *     an existing control and/or task
 *   - fields only from a fixed list (utils/massAssignment.js); record rights
 *     like editing the risk (canWriteRisk)
 *   - a task can be created from an item; the status stays in step in both
 *     directions (task done -> item implemented, item implemented -> task
 *     done, item discarded -> open task cancelled), always audit-logged
 *   - the free-text risks.treatment_plan is not touched
 */

const { Op } = require('sequelize');
const { pick } = require('../utils/massAssignment');
const { auditFromReq } = require('./auditService');
const { notify } = require('./notifyService');
const rm = require('./riskMethodology');
const { hasRole } = require('./accessService');

const { httpError } = rm;
const models = () => require('../models');
const riskSvc = () => require('./riskService');

const OPTIONS = ['mitigate', 'transfer', 'avoid', 'accept'];
const ITEM_STATUSES = ['planned', 'in_progress', 'implemented', 'discarded'];
const ITEM_FIELDS = ['title', 'description', 'treatment_option', 'responsible_user_id', 'responsible_group_id', 'due_date', 'status', 'status_reason',
  'cost_once', 'cost_recurring', 'control_id', 'task_id', 'sort_order'];
const SNAPSHOT = ['title', 'description', 'treatment_option', 'responsible_user_id', 'responsible_group_id', 'due_date', 'status', 'status_reason',
  'cost_once', 'cost_recurring', 'control_id', 'task_id', 'completed_at'];
const TEXT_MAX = 4000;
const TITLE_MAX = 255;
const MAX_ITEMS = 200;
const COST_MAX = 1e12;
const TASK_CREATE_ROLES = ['admin', 'owner', 'assessor', 'it-staff', 'dpo'];
const PRIVILEGED_PLAN = ['admin', 'assessor', 'management'];

const posId = (v, label) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw httpError(400, `${label}: ungültige Kennung.`);
  return n;
};
const text = (label, max = TEXT_MAX) => (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw httpError(400, `${label} muss Text sein.`);
  const s = v.trim();
  if (s.length > max) throw httpError(400, `${label} ist länger als ${max} Zeichen.`);
  return s || null;
};
// EUR amount with at most two decimals, >= 0. Numbers are rounded to cents;
// strings must already have that form (no locale parsing, no regex on long input).
const cost = (label) => (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  let n;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.length <= 20 && /^\d+(\.\d{1,2})?$/.test(v.trim())) n = Number(v.trim());
  else throw httpError(400, `${label}: Betrag in EUR erwartet (z. B. 1500.00).`);
  if (!Number.isFinite(n) || n < 0 || n >= COST_MAX) throw httpError(400, `${label}: Betrag zwischen 0 und ${COST_MAX} EUR erwartet.`);
  return (Math.round(n * 100) / 100).toFixed(2);
};

const plainCost = (v) => (v === null || v === undefined ? null : Number(v));
const snapshot = (item) => Object.fromEntries(SNAPSHOT.map(f => {
  const v = item[f] ?? null;
  return [f, f.startsWith('cost_') ? plainCost(v) : v];
}));
const nameOf = (risk, item) => `${risk.ref || `R-${risk.id}`}: ${item.title}`.slice(0, 255);

/** Fields from the body; on create with defaults, on update only what was sent. */
const buildItemFields = (body, { existing = null } = {}) => {
  const src = pick(body || {}, ITEM_FIELDS);
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  const f = {};
  if (has('title') || !existing) {
    const t = text('Titel', TITLE_MAX)(src.title ?? null);
    if (!t) throw httpError(400, 'Titel der Maßnahme ist erforderlich.');
    f.title = t;
  }
  if (has('description')) f.description = text('Beschreibung')(src.description);
  if (has('treatment_option') || !existing) {
    const o = src.treatment_option ?? 'mitigate';
    if (typeof o !== 'string' || !OPTIONS.includes(o)) throw httpError(400, `Ungültige Behandlungsoption. Möglich: ${OPTIONS.join(', ')}.`);
    f.treatment_option = o;
  }
  if (has('status') || !existing) {
    const s = src.status ?? 'planned';
    if (typeof s !== 'string' || !ITEM_STATUSES.includes(s)) throw httpError(400, `Ungültiger Status. Möglich: ${ITEM_STATUSES.join(', ')}.`);
    f.status = s;
  }
  if (has('status_reason')) f.status_reason = text('Begründung')(src.status_reason);
  if (has('due_date')) f.due_date = rm.normalizeDate(src.due_date);
  if (has('cost_once')) f.cost_once = cost('Kosten einmalig')(src.cost_once);
  if (has('cost_recurring')) f.cost_recurring = cost('Kosten laufend')(src.cost_recurring);
  if (has('responsible_user_id')) f.responsible_user_id = posId(src.responsible_user_id, 'Verantwortliche Person');
  if (has('responsible_group_id')) f.responsible_group_id = posId(src.responsible_group_id, 'Verantwortliche Gruppe');
  if (has('control_id')) f.control_id = posId(src.control_id, 'Control');
  if (has('task_id')) f.task_id = posId(src.task_id, 'Aufgabe');
  if (has('sort_order')) {
    const n = Number(src.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw httpError(400, 'Ungültige Reihenfolge.');
    f.sort_order = n;
  }
  // Responsible: a person OR a group.
  if (f.responsible_user_id && f.responsible_group_id) throw httpError(400, 'Verantwortlich ist eine Person oder eine Gruppe, nicht beides.');
  if (f.responsible_user_id) f.responsible_group_id = null;
  else if (f.responsible_group_id) f.responsible_user_id = null;

  const status = f.status !== undefined ? f.status : existing?.status;
  const reason = f.status_reason !== undefined ? f.status_reason : existing?.status_reason;
  if (status === 'discarded' && !reason) throw httpError(400, 'Für eine verworfene Maßnahme ist eine Begründung erforderlich (status_reason).');
  if (f.status !== undefined && f.status !== existing?.status) {
    f.completed_at = f.status === 'implemented' ? new Date() : null;
  }
  return f;
};

// Referenced records must exist (no dangling ids from the client).
const checkRefs = async (f) => {
  const { User, Group, Control, Task } = models();
  const checks = [
    ['responsible_user_id', User, 'Unbekannte Person.'],
    ['responsible_group_id', Group, 'Unbekannte Gruppe.'],
    ['control_id', Control, 'Unbekanntes Control.'],
    ['task_id', Task, 'Unbekannte Aufgabe.'],
  ];
  for (const [k, model, msg] of checks) {
    if (f[k] && !(await model.count({ where: { id: f[k] } }))) throw httpError(400, msg);
  }
};

const itemInclude = () => {
  const { User, Group, Control, Task } = models();
  return [
    { model: User, as: 'responsibleUser', attributes: ['id', 'name'] },
    { model: Group, as: 'responsibleGroup', attributes: ['id', 'name'] },
    { model: Control, as: 'control', attributes: ['id', 'code', 'title', 'status'] },
    { model: Task, as: 'task', attributes: ['id', 'title', 'status', 'due_date', 'completed_at'] },
  ];
};

const loadItem = async (id) => models().RiskTreatmentItem.findByPk(id, { include: itemInclude() });

const notifyResponsible = async (item, risk, actor, { title, content }) => {
  const { GroupMember } = models();
  const ids = item.responsible_user_id
    ? [item.responsible_user_id]
    : item.responsible_group_id ? (await GroupMember.findAll({ where: { group_id: item.responsible_group_id }, attributes: ['user_id'] })).map(m => m.user_id) : [];
  for (const id of [...new Set(ids)]) {
    await notify({ userId: id, actorId: actor?.id ?? null, type: 'assignment', title, content, link: '/risks/treatment-plan' });
  }
};

// Keep a linked task in step with a manual item status change.
const syncTaskFromItem = async (item, risk, user, auditReq) => {
  if (!item.task_id) return null;
  const { Task } = models();
  const task = await Task.findByPk(item.task_id);
  if (!task) return null;
  let to = null;
  if (item.status === 'implemented' && task.status !== 'done') to = 'done';
  else if (item.status === 'discarded' && ['open', 'in_progress'].includes(task.status)) to = 'cancelled';
  if (!to) return null;
  const before = task.status;
  await task.update(to === 'done' ? { status: 'done', completed_at: new Date(), completed_by_id: user?.id ?? null } : { status: 'cancelled' });
  await auditFromReq(auditReq, 'update', 'task', task.id, task.title, {
    action: 'status_from_treatment_item', treatment_item_id: item.id, risk_id: risk.id, before: { status: before }, after: { status: to },
  });
  return to;
};

const listItems = async (risk, user) => {
  if (!riskSvc().canViewRisk(user, risk)) throw httpError(403, 'Forbidden');
  const rows = await models().RiskTreatmentItem.findAll({ where: { risk_id: risk.id }, include: itemInclude(), order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  return rows.map(r => r.toJSON());
};

const createItem = async (risk, body, user, auditReq) => {
  if (!riskSvc().canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  const { RiskTreatmentItem } = models();
  const count = await RiskTreatmentItem.count({ where: { risk_id: risk.id } });
  if (count >= MAX_ITEMS) throw httpError(400, `Höchstens ${MAX_ITEMS} Maßnahmen je Risiko.`);
  const f = buildItemFields(body);
  await checkRefs(f);
  const item = await RiskTreatmentItem.create({ ...f, risk_id: risk.id, sort_order: f.sort_order ?? count, created_by_id: user?.id ?? null });
  await auditFromReq(auditReq, 'create', 'risk_treatment_item', item.id, nameOf(risk, item), { risk_id: risk.id, ...snapshot(item) });
  const synced = await syncTaskFromItem(item, risk, user, auditReq);
  if (item.responsible_user_id || item.responsible_group_id) {
    await notifyResponsible(item, risk, user, { title: 'Maßnahme zur Risikobehandlung zugewiesen', content: `Sie sind verantwortlich für „${item.title}" (${risk.ref || risk.title}).` });
  }
  const out = (await loadItem(item.id)).toJSON();
  return synced ? { ...out, task_synced: synced } : out;
};

const updateItem = async (risk, item, body, user, auditReq) => {
  if (!riskSvc().canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  if (!item || item.risk_id !== risk.id) throw httpError(404, 'Not found');
  const before = snapshot(item);
  const f = buildItemFields(body, { existing: item });
  await checkRefs(f);
  const prevResp = [item.responsible_user_id, item.responsible_group_id].join(':');
  await item.update(f);
  const after = snapshot(item);
  const changed = Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  if (changed.length) {
    await auditFromReq(auditReq, 'update', 'risk_treatment_item', item.id, nameOf(risk, item), {
      risk_id: risk.id, before: Object.fromEntries(changed.map(k => [k, before[k]])), after: Object.fromEntries(changed.map(k => [k, after[k]])),
    });
  }
  const synced = before.status !== item.status ? await syncTaskFromItem(item, risk, user, auditReq) : null;
  if ([item.responsible_user_id, item.responsible_group_id].join(':') !== prevResp && (item.responsible_user_id || item.responsible_group_id)) {
    await notifyResponsible(item, risk, user, { title: 'Maßnahme zur Risikobehandlung zugewiesen', content: `Sie sind verantwortlich für „${item.title}" (${risk.ref || risk.title}).` });
  }
  const out = (await loadItem(item.id)).toJSON();
  return synced ? { ...out, task_synced: synced } : out;
};

// Same rule as POST /api/tasks: the matrix decides, its default otherwise.
const canCreateTask = async (user) => {
  const { decide } = require('./permissionService');
  return decide(user, 'tasks', 'create', TASK_CREATE_ROLES);
};

/**
 * Create a task from an item (existing task model: assignment, due date,
 * notification). The task is linked back to the risk (related_type 'risk').
 */
const createTaskForItem = async (risk, item, user, auditReq, { priority } = {}) => {
  if (!riskSvc().canWriteRisk(user, risk)) throw httpError(403, 'Forbidden');
  if (!item || item.risk_id !== risk.id) throw httpError(404, 'Not found');
  if (!(await canCreateTask(user))) throw httpError(403, 'Die Berechtigung tasks.create fehlt.');
  if (['implemented', 'discarded'].includes(item.status)) throw httpError(409, 'Für eine umgesetzte oder verworfene Maßnahme wird keine Aufgabe mehr erzeugt.');
  const { Task, GroupMember } = models();
  if (item.task_id) {
    const existing = await Task.findByPk(item.task_id);
    if (existing && existing.status !== 'cancelled') throw httpError(409, 'Die Maßnahme ist bereits mit einer offenen Aufgabe verknüpft.');
  }
  const level = await riskSvc().levelOf(risk);
  const PRIORITIES = ['low', 'medium', 'high', 'critical'];
  const prio = typeof priority === 'string' && PRIORITIES.includes(priority) ? priority : (PRIORITIES.includes(level) ? level : 'medium');
  const task = await Task.create({
    title: nameOf(risk, item),
    description: item.description || null,
    status: item.status === 'in_progress' ? 'in_progress' : 'open',
    priority: prio,
    due_date: item.due_date || null,
    assigned_to_id: item.responsible_group_id ? null : (item.responsible_user_id || null),
    assigned_to_group_id: item.responsible_group_id || null,
    related_type: 'risk',
    related_id: risk.id,
    tags: ['risk_treatment'],
    created_by_id: user?.id ?? null,
  });
  await item.update({ task_id: task.id });
  await auditFromReq(auditReq, 'create', 'task', task.id, task.title, {
    status: task.status, priority: task.priority, due_date: task.due_date, assigned_to_id: task.assigned_to_id,
    assigned_to_group_id: task.assigned_to_group_id, related_type: 'risk', related_id: risk.id, treatment_item_id: item.id,
  });
  await auditFromReq(auditReq, 'update', 'risk_treatment_item', item.id, nameOf(risk, item), { action: 'task_created', risk_id: risk.id, task_id: task.id });
  const content = `Aufgabe zur Risikobehandlung: „${item.title}" (${risk.ref || risk.title})${task.due_date ? `, fällig am ${task.due_date}` : ''}.`;
  if (task.assigned_to_id) {
    await notify({ userId: task.assigned_to_id, actorId: user?.id ?? null, type: 'assignment', title: 'Neue Aufgabe', content, link: '/tasks' });
  } else if (task.assigned_to_group_id) {
    const members = await GroupMember.findAll({ where: { group_id: task.assigned_to_group_id }, attributes: ['user_id'] });
    for (const m of members) await notify({ userId: m.user_id, actorId: user?.id ?? null, type: 'assignment', title: 'Neue Gruppenaufgabe', content, link: '/tasks' });
  }
  return (await loadItem(item.id)).toJSON();
};

// ── Task -> item ────────────────────────────────────────────────────────────

const actorReq = async (userId) => {
  if (!userId) return { user: null, ip: null };
  const u = await models().User.findByPk(userId, { attributes: ['id', 'name', 'role'] });
  return { user: u ? { id: u.id, name: u.name, role: u.role } : null, ip: null };
};

const applyTaskStatus = async (item, task, previousStatus) => {
  const { Risk } = models();
  let to = null;
  if (task.status === 'done' && item.status !== 'implemented' && item.status !== 'discarded') to = 'implemented';
  else if (previousStatus === 'done' && ['open', 'in_progress'].includes(task.status) && item.status === 'implemented') to = 'in_progress';
  if (!to) return false;
  const before = item.status;
  await item.update({ status: to, completed_at: to === 'implemented' ? (task.completed_at || new Date()) : null });
  const risk = await Risk.findByPk(item.risk_id, { attributes: ['id', 'ref', 'title'] });
  await auditFromReq(await actorReq(task.completed_by_id), 'update', 'risk_treatment_item', item.id, risk ? nameOf(risk, item) : item.title, {
    action: 'status_from_task', risk_id: item.risk_id, task_id: task.id, task_status: task.status, before: { status: before }, after: { status: to },
  });
  return true;
};

// Hook errors are logged, never thrown: the task update itself has happened.
const onTaskUpdated = async (task, options = {}) => {
  try {
    const fields = Array.isArray(options.fields) ? options.fields : null;
    if (fields && !fields.includes('status')) return;
    const previous = typeof task.previous === 'function' ? task.previous('status') : undefined;
    if (previous === task.status) return;
    const items = await models().RiskTreatmentItem.findAll({ where: { task_id: task.id } });
    for (const item of items) await applyTaskStatus(item, task, previous);
  } catch (e) {
    console.error('[RiskTreatment] Task sync failed:', String(e.message).replace(/[\r\n]+/g, ' '));
  }
};

const onTasksBulkUpdated = async (options = {}) => {
  try {
    if (!options.attributes || options.attributes.status !== 'done' || !options.where) return;
    const { Task, RiskTreatmentItem } = models();
    const tasks = await Task.findAll({ where: options.where, attributes: ['id', 'status', 'completed_at', 'completed_by_id'] });
    const done = tasks.filter(t => t.status === 'done');
    if (!done.length) return;
    const items = await RiskTreatmentItem.findAll({ where: { task_id: done.map(t => t.id) } });
    for (const item of items) await applyTaskStatus(item, done.find(t => t.id === item.task_id), null);
  } catch (e) {
    console.error('[RiskTreatment] Task sync (bulk) failed:', String(e.message).replace(/[\r\n]+/g, ' '));
  }
};

// ── Overview (ISO 27001 6.1.3 e evidence) ───────────────────────────────────

const PLAN_STATUSES = ITEM_STATUSES;

/**
 * All items across risks with responsible, due date, status, costs and the
 * risk they belong to, plus risks without an active item. Visible: admin,
 * assessor and management everything; others the risks they own and the items
 * they (or one of their groups) are responsible for.
 */
const listPlan = async (user, query = {}) => {
  const { RiskTreatmentItem, Risk, User, GroupMember } = models();
  if (!user?.id) throw httpError(403, 'Forbidden');
  const where = {};
  if (query.status !== undefined && query.status !== '') {
    if (!PLAN_STATUSES.includes(query.status)) throw httpError(400, `Ungültiger Status. Möglich: ${PLAN_STATUSES.join(', ')}.`);
    where.status = query.status;
  }
  if (query.risk_id !== undefined && query.risk_id !== '') where.risk_id = posId(query.risk_id, 'Risiko');
  if (query.responsible_user_id !== undefined && query.responsible_user_id !== '') where.responsible_user_id = posId(query.responsible_user_id, 'Person');
  const overdueOnly = query.overdue === true || query.overdue === 'true';
  const today = rm.todayStr();
  if (overdueOnly) {
    where.status = where.status ? where.status : { [Op.in]: ['planned', 'in_progress'] };
    where.due_date = { [Op.lt]: today };
  }
  const privileged = hasRole(user, PRIVILEGED_PLAN);
  const groupIds = privileged ? [] : (await GroupMember.findAll({ where: { user_id: user.id }, attributes: ['group_id'] })).map(g => g.group_id);
  const rows = await RiskTreatmentItem.findAll({
    where,
    include: [...itemInclude(), { model: Risk, as: 'risk', attributes: ['id', 'ref', 'title', 'status', 'owner_id', 'category', 'treatment', 'treatment_options', 'likelihood', 'impact', 'residual_likelihood', 'residual_impact', 'residual_level', 'inherent_level', 'methodology_id'], include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }] }],
    order: [['due_date', 'ASC NULLS LAST'], ['risk_id', 'ASC'], ['sort_order', 'ASC'], ['id', 'ASC']],
  });
  const visible = rows.filter(r => r.risk && (privileged || r.risk.owner_id === user.id || r.responsible_user_id === user.id || (r.responsible_group_id && groupIds.includes(r.responsible_group_id))));

  const riskRows = new Map();
  for (const r of visible) riskRows.set(r.risk.id, r.risk);
  const decorated = new Map((await rm.decorateRisks([...riskRows.values()])).map(d => [d.id, d]));
  const svc = riskSvc();
  const items = visible.map(r => {
    const j = r.toJSON();
    const d = decorated.get(r.risk.id) || {};
    const overdue = !['implemented', 'discarded'].includes(j.status) && !!j.due_date && String(j.due_date).slice(0, 10) < today;
    return {
      ...j,
      cost_once: plainCost(j.cost_once),
      cost_recurring: plainCost(j.cost_recurring),
      overdue,
      risk: {
        id: j.risk.id, ref: j.risk.ref, title: j.risk.title, status: j.risk.status, category: j.risk.category,
        owner: j.risk.owner || null, treatment: j.risk.treatment, treatment_options: svc.optionsOf(j.risk),
        effective_level: d.effective_level ?? null, appetite_max_level: d.appetite_max_level ?? null, appetite_exceeded: !!d.appetite_exceeded,
      },
    };
  });

  // Risks without an active item (not closed, not accepted) - only without
  // item filters, and only the risks the user may see in full.
  let withoutPlan = [];
  if (!where.status && !where.risk_id && !where.responsible_user_id && !overdueOnly) {
    const riskWhere = { status: { [Op.in]: ['open', 'in_treatment'] } };
    if (!privileged) riskWhere.owner_id = user.id;
    const candidates = await Risk.findAll({ where: riskWhere, include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }], order: [['id', 'ASC']] });
    const withActive = new Set((await RiskTreatmentItem.findAll({ where: { risk_id: candidates.map(c => c.id), status: { [Op.ne]: 'discarded' } }, attributes: ['risk_id'], raw: true })).map(x => x.risk_id));
    withoutPlan = (await rm.decorateRisks(candidates.filter(c => !withActive.has(c.id)))).map(d => ({
      id: d.id, ref: d.ref, title: d.title, status: d.status, owner: d.owner || null, treatment: d.treatment,
      effective_level: d.effective_level, appetite_exceeded: d.appetite_exceeded,
    }));
  }

  const active = items.filter(i => i.status !== 'discarded');
  const sum = (k) => Math.round(active.reduce((s, i) => s + Math.round((i[k] || 0) * 100), 0)) / 100;
  const summary = {
    items: items.length,
    risks: riskRows.size,
    planned: items.filter(i => i.status === 'planned').length,
    in_progress: items.filter(i => i.status === 'in_progress').length,
    implemented: items.filter(i => i.status === 'implemented').length,
    discarded: items.filter(i => i.status === 'discarded').length,
    overdue: items.filter(i => i.overdue).length,
    cost_once_total: sum('cost_once'),
    cost_recurring_total: sum('cost_recurring'),
    risks_without_plan: withoutPlan.length,
  };
  return { generated_at: new Date().toISOString(), summary, items, risks_without_plan: withoutPlan };
};

// ── Reminder: overdue items (daily, services/reminderService.js) ────────────

const checkOverdueItems = async () => {
  const { RiskTreatmentItem, Risk, Notification } = models();
  const today = rm.todayStr();
  const items = await RiskTreatmentItem.findAll({
    where: { status: { [Op.in]: ['planned', 'in_progress'] }, due_date: { [Op.lt]: today } },
    include: [{ model: Risk, as: 'risk', attributes: ['id', 'ref', 'title'] }],
    limit: 1000,
  });
  let sent = 0;
  for (const item of items) {
    const title = 'Maßnahme zur Risikobehandlung überfällig';
    const content = `„${item.title}" (${item.risk?.ref || item.risk?.title || ''}) war fällig am ${item.due_date}.`;
    const { GroupMember } = models();
    const ids = item.responsible_user_id
      ? [item.responsible_user_id]
      : item.responsible_group_id ? (await GroupMember.findAll({ where: { group_id: item.responsible_group_id }, attributes: ['user_id'] })).map(m => m.user_id) : [];
    for (const userId of [...new Set(ids)]) {
      const exists = await Notification.findOne({ where: { user_id: userId, type: 'reminder', title, content, created_at: { [Op.gte]: new Date(today) } } });
      if (exists) continue;
      await notify({ userId, actorId: null, type: 'reminder', title, content, link: '/risks/treatment-plan' });
      sent++;
    }
  }
  return { overdue: items.length, notified: sent };
};

module.exports = {
  OPTIONS, ITEM_STATUSES, ITEM_FIELDS, buildItemFields, listItems, createItem, updateItem, createTaskForItem,
  onTaskUpdated, onTasksBulkUpdated, listPlan, checkOverdueItems, treatmentCost: cost,
};
