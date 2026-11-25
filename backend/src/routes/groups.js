const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const sequelize = require('../config/database');
const { Group, GroupMember, GroupRole, CustomRole, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError, requestError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const {
  isBuiltinRole, assertAdminRemains, syncUserRoles, invalidateAccessCache, AccessError,
} = require('../services/accessService');

router.use(authenticate);

// Groups are teams (task assignment, @-mentions) and, since v3.8.0, the only way
// roles reach users: a group carries roles, its members receive them.
const groupInclude = [
  { model: User, as: 'members', attributes: ['id', 'name', 'email', 'role'], through: { attributes: ['source'] } },
  { model: GroupRole, as: 'groupRoles', attributes: ['id', 'system_role', 'custom_role_id'],
    include: [{ model: CustomRole, as: 'customRole', attributes: ['id', 'name', 'base_role'] }] },
];

const present = (group) => {
  const g = group.toJSON();
  g.roles = (g.groupRoles || []).map((r) => (r.system_role
    ? { system_role: r.system_role }
    : { custom_role_id: r.custom_role_id, name: r.customRole?.name || null, base_role: r.customRole?.base_role || null }));
  delete g.groupRoles;
  g.members = (g.members || []).map((m) => {
    const { GroupMember: link, ...rest } = m;
    return { ...rest, source: link?.source || 'manual' };
  });
  return g;
};

const loadGroup = (id) => Group.findByPk(id, { include: groupInclude });

// Assigning roles to a group, or changing who belongs to a group that carries
// roles, hands out permissions. That needs admin.roles in addition to
// groups.manage — the same permission that guards the role definitions.
const mayManageRoles = async (req) => {
  const { decide } = require('../services/permissionService');
  return decide(req.user, 'admin', 'roles', ['admin']);
};

const groupCarriesRoles = async (groupId) => (await GroupRole.count({ where: { group_id: groupId } })) > 0;

// Validates [{ system_role } | { custom_role_id }] and drops duplicates.
const parseRoles = async (input) => {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) throw new AccessError('roles must be an array');
  const out = [];
  const seen = new Set();
  for (const r of input) {
    if (r && typeof r.system_role === 'string' && isBuiltinRole(r.system_role)) {
      const key = `s:${r.system_role}`;
      if (!seen.has(key)) { seen.add(key); out.push({ system_role: r.system_role }); }
    } else if (r && Number.isInteger(Number(r.custom_role_id)) && Number(r.custom_role_id) > 0) {
      const id = Number(r.custom_role_id);
      if (!(await CustomRole.findByPk(id))) throw new AccessError(`Custom role ${id} not found`, 400);
      const key = `c:${id}`;
      if (!seen.has(key)) { seen.add(key); out.push({ custom_role_id: id }); }
    } else {
      throw new AccessError('Each role needs system_role (a built-in role) or custom_role_id');
    }
  }
  return out;
};

const describeRoles = (roles) => roles.map((r) => (r.system_role ? r.system_role : `custom:${r.custom_role_id}`));

const accessError = (res, e) => {
  if (e instanceof AccessError) return res.status(e.status).json({ error: e.message });
  return null;
};

// List all groups
router.get('/', requirePermission('groups','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const groups = await Group.findAll({ include: groupInclude, order: [['name', 'ASC']] });
    res.json(groups.map(present));
  } catch (e) { serverError(res, e, 'groups'); }
});

// Get single group
router.get('/:id', requirePermission('groups','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const group = await loadGroup(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(present(group));
  } catch (e) { serverError(res, e, 'groups'); }
});

// Create group
router.post('/', requirePermission('groups','manage','admin'), async (req, res) => {
  try {
    const { name, description, color } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
    const roles = await parseRoles(req.body?.roles);
    if (roles?.length && !(await mayManageRoles(req))) return res.status(403).json({ error: 'Assigning roles requires the permission admin.roles' });
    const group = await sequelize.transaction(async (t) => {
      const g = await Group.create({ name: name.trim(), description, color: color || '#3b82f6', created_by_id: req.user.id }, { transaction: t });
      for (const r of roles || []) await GroupRole.create({ group_id: g.id, ...r }, { transaction: t });
      return g;
    });
    invalidateAccessCache();
    await auditFromReq(req, 'create', 'group', group.id, group.name, { description: group.description, roles: describeRoles(roles || []) });
    res.status(201).json(present(await loadGroup(group.id)));
  } catch (e) { if (!accessError(res, e)) requestError(res, e, 'groups'); }
});

// Update group; `roles` (optional) replaces the roles the group carries.
router.put('/:id', requirePermission('groups','manage','admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id, { include: [{ model: GroupRole, as: 'groupRoles' }] });
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    const { name, description, color } = req.body || {};
    const roles = await parseRoles(req.body?.roles);
    const beforeRoles = describeRoles(group.groupRoles.map((r) => r.toJSON()));
    const rolesChanged = roles !== undefined && JSON.stringify([...describeRoles(roles)].sort()) !== JSON.stringify([...beforeRoles].sort());
    if (rolesChanged && !(await mayManageRoles(req))) return res.status(403).json({ error: 'Assigning roles requires the permission admin.roles' });

    await sequelize.transaction(async (t) => {
      await group.update({ name: name?.trim() || group.name, description, color }, { transaction: t });
      if (rolesChanged) {
        await GroupRole.destroy({ where: { group_id: group.id }, transaction: t });
        for (const r of roles) await GroupRole.create({ group_id: group.id, ...r }, { transaction: t });
        await assertAdminRemains(t);
      }
    });
    if (rolesChanged) {
      const members = await GroupMember.findAll({ where: { group_id: group.id }, attributes: ['user_id'] });
      await syncUserRoles(members.map((m) => m.user_id));
    }
    await auditFromReq(req, 'update', 'group', group.id, group.name,
      rolesChanged ? { roles_before: beforeRoles, roles_after: describeRoles(roles) } : {});
    res.json(present(await loadGroup(group.id)));
  } catch (e) { if (!accessError(res, e)) requestError(res, e, 'groups'); }
});

// Delete group
router.delete('/:id', requirePermission('groups','manage','admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    if (await groupCarriesRoles(group.id) && !(await mayManageRoles(req))) {
      return res.status(403).json({ error: 'Deleting a group that carries roles requires the permission admin.roles' });
    }
    const name = group.name;
    const members = await GroupMember.findAll({ where: { group_id: group.id }, attributes: ['user_id'] });
    await sequelize.transaction(async (t) => {
      await GroupRole.destroy({ where: { group_id: group.id }, transaction: t });
      await GroupMember.destroy({ where: { group_id: group.id }, transaction: t });
      await group.destroy({ transaction: t });
      await assertAdminRemains(t);
    });
    await syncUserRoles(members.map((m) => m.user_id));
    await auditFromReq(req, 'delete', 'group', req.params.id, name, { members: members.length });
    res.json({ ok: true });
  } catch (e) { if (!accessError(res, e)) serverError(res, e, 'groups'); }
});

// Add member to group
router.post('/:id/members', requirePermission('groups','manage','admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    const { user_id } = req.body || {};
    const user = await User.findByPk(user_id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (await groupCarriesRoles(group.id) && !(await mayManageRoles(req))) {
      return res.status(403).json({ error: 'This group carries roles; changing its members requires the permission admin.roles' });
    }
    const [, created] = await GroupMember.findOrCreate({ where: { group_id: group.id, user_id: user.id }, defaults: { source: 'manual' } });
    if (!created) return res.status(409).json({ error: 'Bereits Mitglied' });
    await syncUserRoles([user.id]);
    await auditFromReq(req, 'update', 'group', group.id, group.name, { action: 'add_member', user_id: user.id, user_name: user.name });
    res.status(201).json(present(await loadGroup(group.id)));
  } catch (e) { requestError(res, e, 'groups'); }
});

// Remove member from group
router.delete('/:id/members/:userId', requirePermission('groups','manage','admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    if (await groupCarriesRoles(group.id) && !(await mayManageRoles(req))) {
      return res.status(403).json({ error: 'This group carries roles; changing its members requires the permission admin.roles' });
    }
    const userId = Number(req.params.userId);
    const deleted = await sequelize.transaction(async (t) => {
      const n = await GroupMember.destroy({ where: { group_id: group.id, user_id: userId }, transaction: t });
      if (n) await assertAdminRemains(t);
      return n;
    });
    if (!deleted) return res.status(404).json({ error: 'Mitglied nicht gefunden' });
    await syncUserRoles([userId]);
    await auditFromReq(req, 'update', 'group', group.id, group.name, { action: 'remove_member', user_id: userId });
    res.json(present(await loadGroup(group.id)));
  } catch (e) { if (!accessError(res, e)) serverError(res, e, 'groups'); }
});

module.exports = router;
