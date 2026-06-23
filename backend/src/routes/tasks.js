const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Task, User, Group, GroupMember, Notification, Asset, Risk, Incident, Training, AiSystem, SubjectRequest } = require('../models');
const { authenticate, requireWriteAccess, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { Op } = require('sequelize');

// Maps each related_type to the model and the condition that means "record still exists/active".
// Used by the orphan-cleanup endpoints.
const ORPHAN_CHECKS = {
  asset:          { model: Asset,          where: { status: 'active' } },
  risk:           { model: Risk,           where: {} },
  incident:       { model: Incident,       where: { deleted: { [Op.ne]: true } } },
  training:       { model: Training,       where: {} },
  ai_system:      { model: AiSystem,       where: {} },
  subject_request:{ model: SubjectRequest, where: {} },
};

router.use(authenticate);

const taskInclude = [
  { model: User, as: 'assignee', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'createdBy', attributes: ['id', 'name'] },
  { model: User, as: 'completedBy', attributes: ['id', 'name'] },
  { model: Group, as: 'assignedGroup', attributes: ['id', 'name', 'color'],
    include: [{ model: User, as: 'members', attributes: ['id', 'name', 'email'], through: { attributes: [] } }] },
];

// Notify all group members except the actor
async function notifyGroupMembers(groupId, excludeUserId, actorId, title, content, link) {
  const members = await GroupMember.findAll({ where: { group_id: groupId } });
  const inserts = members
    .filter(m => m.user_id !== excludeUserId)
    .map(m => ({ user_id: m.user_id, actor_id: actorId, type: 'assignment', title, content, link, read: false }));
  if (inserts.length > 0) await Notification.bulkCreate(inserts);
}

// Returns the set of asset IDs that are inactive or decommissioned, for task filtering.
async function getInactiveAssetIds() {
  const inactiveAssets = await Asset.findAll({
    where: { status: { [Op.in]: ['inactive', 'decommissioned'] } },
    attributes: ['id'],
    raw: true,
  });
  return new Set(inactiveAssets.map(a => a.id));
}

// List tasks with optional filters
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.priority) where.priority = req.query.priority;
    if (req.query.assigned_to_id) where.assigned_to_id = req.query.assigned_to_id;
    if (req.query.assigned_to_group_id) where.assigned_to_group_id = req.query.assigned_to_group_id;
    if (req.query.related_type) where.related_type = req.query.related_type;
    if (req.query.related_id) where.related_id = req.query.related_id;
    if (req.query.overdue === 'true') {
      where.due_date = { [Op.lt]: new Date().toISOString().slice(0, 10) };
      where.status = { [Op.notIn]: ['done', 'cancelled'] };
    } else if (req.query.all !== 'true') {
      const limit = new Date();
      limit.setDate(limit.getDate() + 28);
      const limitStr = limit.toISOString().slice(0, 10);
      where[Op.or] = [{ due_date: { [Op.lte]: limitStr } }, { due_date: null }];
    }
    let tasks = await Task.findAll({ where, include: taskInclude, order: [['due_date', 'ASC'], ['priority', 'DESC']] });

    // Exclude tasks linked to inactive or decommissioned assets
    const inactiveAssetIds = await getInactiveAssetIds();
    if (inactiveAssetIds.size > 0) {
      tasks = tasks.filter(t => !(t.related_type === 'asset' && inactiveAssetIds.has(t.related_id)));
    }

    res.json(tasks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// My tasks — includes tasks directly assigned AND group tasks for user's groups
router.get('/my', authenticate, async (req, res) => {
  try {
    // Get the groups this user belongs to
    const memberOf = await GroupMember.findAll({ where: { user_id: req.user.id } });
    const groupIds = memberOf.map(m => m.group_id);

    const orConditions = [{ assigned_to_id: req.user.id }];
    if (groupIds.length > 0) orConditions.push({ assigned_to_group_id: { [Op.in]: groupIds } });

    let tasks = await Task.findAll({
      where: { [Op.or]: orConditions, status: { [Op.notIn]: ['done', 'cancelled'] } },
      include: taskInclude,
      order: [['due_date', 'ASC']],
    });

    // Exclude tasks linked to inactive or decommissioned assets
    const inactiveAssetIds = await getInactiveAssetIds();
    if (inactiveAssetIds.size > 0) {
      tasks = tasks.filter(t => !(t.related_type === 'asset' && inactiveAssetIds.has(t.related_id)));
    }

    res.json(tasks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    // Exclude tasks linked to inactive or decommissioned assets from stats
    const inactiveAssetIds = await getInactiveAssetIds();
    // NOT (related_type = 'asset' AND related_id IN (...)) = related_type != 'asset' OR related_id NOT IN (...)
    const activeAssetFilter = inactiveAssetIds.size > 0 ? {
      [Op.or]: [
        { related_type: { [Op.ne]: 'asset' } },
        { related_type: null },
        { related_id: { [Op.notIn]: [...inactiveAssetIds] } },
      ]
    } : {};

    const [open, in_progress, done, overdue] = await Promise.all([
      Task.count({ where: { status: 'open', ...activeAssetFilter } }),
      Task.count({ where: { status: 'in_progress', ...activeAssetFilter } }),
      Task.count({ where: { status: 'done', ...activeAssetFilter } }),
      Task.count({ where: { status: { [Op.notIn]: ['done', 'cancelled'] }, due_date: { [Op.lt]: new Date().toISOString().slice(0, 10) }, ...activeAssetFilter } }),
    ]);
    res.json({ open, in_progress, done, overdue });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Count orphaned tasks (admin only) — safe preview before purge
router.get('/orphaned-count', authenticate, requireRole('admin'), async (req, res) => {
  try {
    let total = 0;
    for (const [relType, { model, where }] of Object.entries(ORPHAN_CHECKS)) {
      const activeTasks = await Task.findAll({
        where: { related_type: relType, status: { [Op.notIn]: ['done', 'cancelled'] } },
        attributes: ['id', 'related_id'],
        raw: true,
      });
      if (!activeTasks.length) continue;
      const ids = [...new Set(activeTasks.map(t => t.related_id))];
      const existing = await model.findAll({ where: { id: { [Op.in]: ids }, ...where }, attributes: ['id'], raw: true });
      const existingSet = new Set(existing.map(r => r.id));
      total += activeTasks.filter(t => !existingSet.has(t.related_id)).length;
    }
    res.json({ count: total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Purge orphaned tasks (admin only) — deletes tasks whose related object no longer exists
router.delete('/orphaned', authenticate, requireRole('admin'), async (req, res) => {
  try {
    let purged = 0;
    for (const [relType, { model, where }] of Object.entries(ORPHAN_CHECKS)) {
      const activeTasks = await Task.findAll({
        where: { related_type: relType, status: { [Op.notIn]: ['done', 'cancelled'] } },
        attributes: ['id', 'related_id'],
        raw: true,
      });
      if (!activeTasks.length) continue;
      const ids = [...new Set(activeTasks.map(t => t.related_id))];
      const existing = await model.findAll({ where: { id: { [Op.in]: ids }, ...where }, attributes: ['id'], raw: true });
      const existingSet = new Set(existing.map(r => r.id));
      const orphanIds = activeTasks.filter(t => !existingSet.has(t.related_id)).map(t => t.id);
      if (orphanIds.length) {
        await Task.destroy({ where: { id: { [Op.in]: orphanIds } } });
        purged += orphanIds.length;
      }
    }
    await auditFromReq(req, 'delete', 'task', null, 'Purge verwaister Aufgaben', { purged });
    res.json({ purged });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single task (verify user has access)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id, { include: taskInclude });
    if (!task) return res.status(404).json({ error: 'Not found' });
    
    // Authorization: user can see task if assigned to them, their group, their role, or they are admin/assessor
    const isAssigned = task.assigned_to_id === req.user.id;
    const isGroupMember = task.assigned_to_group_id && task.assignedGroup?.members?.some(m => m.id === req.user.id);
    const isRoleMatch = task.assigned_role && task.assigned_role === req.user.role;
    const isPrivileged = ['admin', 'assessor'].includes(req.user.role);
    
    if (!isAssigned && !isGroupMember && !isRoleMatch && !isPrivileged) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(task);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create task
router.post('/', requireWriteAccess(), async (req, res) => {
  try {
    const payload = { ...req.body, created_by_id: req.user.id };
    // Mutually exclusive: group assignment clears user assignment and vice versa
    if (payload.assigned_to_group_id) payload.assigned_to_id = null;
    else if (payload.assigned_to_id) payload.assigned_to_group_id = null;

    const task = await Task.create(payload);

    // Notify all group members when assigned to a group
    if (task.assigned_to_group_id) {
      const group = await Group.findByPk(task.assigned_to_group_id);
      await notifyGroupMembers(
        task.assigned_to_group_id, req.user.id, req.user.id,
        `Neue Gruppenaufgabe: ${task.title}`,
        `${req.user.name} hat der Gruppe "${group?.name}" eine neue Aufgabe zugewiesen.`,
        `/tasks`
      );
    }

    await auditFromReq(req, 'create', 'task', task.id, task.title, {
      description: task.description, status: task.status, priority: task.priority,
      due_date: task.due_date, assigned_to_id: task.assigned_to_id,
      assigned_to_group_id: task.assigned_to_group_id, assigned_role: task.assigned_role,
      related_type: task.related_type, related_id: task.related_id, tags: task.tags,
    });
    const full = await Task.findByPk(task.id, { include: taskInclude });
    res.status(201).json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update task
router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });

    const fields = [
      'title', 'description', 'status', 'priority', 'due_date',
      'assigned_to_id', 'assigned_to_group_id', 'assigned_role', 'related_type', 'related_id', 'tags',
    ];
    const before = {};
    fields.forEach(f => { before[f] = task[f]; });

    const updates = { ...req.body };

    // Group task completion: first member to mark done completes it for all
    const isCompletingNow = updates.status === 'done' && task.status !== 'done';
    if (isCompletingNow) {
      updates.completed_at = new Date();
      updates.completed_by_id = req.user.id;

      // Notify other group members that the task is done
      if (task.assigned_to_group_id) {
        const group = await Group.findByPk(task.assigned_to_group_id);
        await notifyGroupMembers(
          task.assigned_to_group_id, req.user.id, req.user.id,
          `Gruppenaufgabe erledigt: ${task.title}`,
          `${req.user.name} hat die Aufgabe "${task.title}" der Gruppe "${group?.name}" als erledigt markiert.`,
          `/tasks`
        );
      }
    }

    // Mutually exclusive assignment
    if (updates.assigned_to_group_id) updates.assigned_to_id = null;
    else if (updates.assigned_to_id != null && updates.assigned_to_group_id === undefined) {
      // Keep existing group unless explicitly clearing
    }

    // Notify new group members if group assignment changed
    if (updates.assigned_to_group_id && updates.assigned_to_group_id !== task.assigned_to_group_id) {
      const group = await Group.findByPk(updates.assigned_to_group_id);
      await notifyGroupMembers(
        updates.assigned_to_group_id, req.user.id, req.user.id,
        `Aufgabe zugewiesen: ${task.title}`,
        `${req.user.name} hat der Gruppe "${group?.name}" die Aufgabe "${task.title}" zugewiesen.`,
        `/tasks`
      );
    }

    await task.update(updates);

    const after = {};
    fields.forEach(f => { after[f] = task[f]; });
    await auditFromReq(req, 'update', 'task', task.id, task.title, { before, after });
    const full = await Task.findByPk(task.id, { include: taskInclude });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});



// Delete task
router.delete('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const task = await Task.findByPk(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    const title = task.title;
    await task.destroy();
    await auditFromReq(req, 'delete', 'task', req.params.id, title, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
