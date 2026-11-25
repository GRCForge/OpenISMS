// Group-based access (v3.10.0).
//
// A role is a named set of permission objects (module.action). Roles reach a
// user only through groups: a group carries roles (models/GroupRole.js), a user
// belongs to groups, and the user's access is the union of all roles of all
// their groups. Permissions only ever add up — there is no deny.
//
// Two kinds of role:
//   system role   one of the eight built-in roles. Its permission set is its
//                 column in the global permission matrix (settings key
//                 `permissions`), which is what the matrix editor edits.
//   custom role   models/CustomRole.js, with a permission set of its own or,
//                 without one, the set of its base role.
//
// Every role also has a *base role* — a system role's base role is itself.
// Until phase 2 replaces them with permission objects, a number of rules still
// ask for a role rather than a permission (object visibility, write protection,
// the role lists that decide where the matrix says nothing). Those rules see the
// set of base roles of all the user's roles; `users.role` keeps the most
// privileged of them as a cache for display and queries.

const { QueryTypes } = require('sequelize');

// Most privileged first. Decides which role `users.role` shows.
const BUILTIN_ROLES = ['admin', 'assessor', 'dpo', 'it-staff', 'owner', 'management', 'employee', 'viewer'];
const READ_ONLY_ROLES = new Set(['viewer', 'management', 'employee']);
const NO_ROLE = 'none';

// Display names of the groups the migration creates for the built-in roles.
const ROLE_GROUP_NAMES = {
  admin: 'Administrators',
  assessor: 'Assessors',
  dpo: 'Data Protection',
  'it-staff': 'IT Staff',
  owner: 'Asset Owners',
  management: 'Management',
  employee: 'Employees',
  viewer: 'Viewers',
};

const isBuiltinRole = (r) => BUILTIN_ROLES.includes(r);

// ── Pure helpers ────────────────────────────────────────────────────────────

const baseRoleOf = (grant) => (grant.system_role ? grant.system_role : grant.base_role);

const rolesOfGrants = (grants) => {
  const set = new Set();
  for (const g of grants || []) {
    const r = baseRoleOf(g);
    if (isBuiltinRole(r)) set.add(r);
  }
  return BUILTIN_ROLES.filter((r) => set.has(r));
};

const primaryRole = (roles) => BUILTIN_ROLES.find((r) => (roles || []).includes(r)) || NO_ROLE;

// Read-only unless at least one role may write. No role at all is read-only too.
const isReadOnly = (roles) => !roles || roles.length === 0 || roles.every((r) => READ_ONLY_ROLES.has(r));

// The roles of a user for role-based rules. Requests carry `user.roles`
// (attached by attachAccess); anything else falls back to the cached column.
const rolesOf = (user) => {
  if (!user) return [];
  if (Array.isArray(user.roles)) return user.roles;
  return user.role && user.role !== NO_ROLE ? [user.role] : [];
};

const hasRole = (user, ...roles) => {
  const own = rolesOf(user);
  return roles.flat().some((r) => own.includes(r));
};

// True when the user has no role outside the given set — for restrictions that
// apply to some roles only (e.g. "IT staff and viewers do not see contracts"):
// one role without the restriction lifts it, as permissions only add up.
const onlyRoles = (user, ...roles) => {
  const set = new Set(roles.flat());
  return rolesOf(user).every((r) => set.has(r));
};

// ── Database access ─────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 1000;
const grantCache = new Map(); // userId -> { at, grants, groupIds }

const invalidateAccessCache = () => grantCache.clear();

const db = () => require('../config/database');

// The roles a user receives through their groups, with what is needed to
// evaluate them: base role and, for custom roles, the own permission set.
const loadGrants = async (userId) => {
  const cached = grantCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached;
  const rows = await db().query(
    `SELECT gm.group_id,
            gr.system_role::text AS system_role,
            gr.custom_role_id,
            cr.base_role::text AS base_role,
            cr.permissions
       FROM group_members gm
       LEFT JOIN group_roles gr ON gr.group_id = gm.group_id
       LEFT JOIN custom_roles cr ON cr.id = gr.custom_role_id
      WHERE gm.user_id = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  const groupIds = [...new Set(rows.map((r) => r.group_id))];
  const seen = new Set();
  const grants = [];
  for (const r of rows) {
    if (!r.system_role && !r.custom_role_id) continue; // group without roles
    if (r.custom_role_id && !r.base_role) continue;     // dangling custom role
    const key = r.system_role ? `s:${r.system_role}` : `c:${r.custom_role_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grants.push(r.system_role
      ? { system_role: r.system_role }
      : { custom_role_id: r.custom_role_id, base_role: r.base_role, permissions: r.permissions || null });
  }
  const entry = { at: Date.now(), grants, groupIds };
  grantCache.set(userId, entry);
  return entry;
};

// Attach roles to a user instance for the duration of a request. The
// properties are non-enumerable so they never end up in a JSON response or in
// a model save.
const attachAccess = async (user) => {
  if (!user) return user;
  let grants;
  let groupIds = [];
  if (user.technical) {
    // The MCP_SECRET pseudo-user has no groups; its single role comes from
    // MCP_SECRET_ROLE (mcp/auth.js). The only grant that bypasses groups.
    grants = isBuiltinRole(user.role) ? [{ system_role: user.role }] : [];
  } else {
    ({ grants, groupIds } = await loadGrants(user.id));
  }
  const define = (k, v) => Object.defineProperty(user, k, { value: v, enumerable: false, configurable: true, writable: true });
  define('accessGrants', grants);
  define('roles', rolesOfGrants(grants));
  define('groupIds', groupIds);
  return user;
};

// Recompute the cached users.role from the groups. Without ids: every user.
const syncUserRoles = async (userIds, { transaction } = {}) => {
  const { User } = require('../models');
  const ids = userIds ? [...new Set(userIds.map(Number).filter(Number.isInteger))] : null;
  if (ids && ids.length === 0) return 0;
  const rows = await db().query(
    `SELECT gm.user_id, COALESCE(gr.system_role::text, cr.base_role::text) AS role
       FROM group_members gm
       JOIN group_roles gr ON gr.group_id = gm.group_id
       LEFT JOIN custom_roles cr ON cr.id = gr.custom_role_id
      ${ids ? 'WHERE gm.user_id IN (:ids)' : ''}`,
    { replacements: ids ? { ids } : {}, type: QueryTypes.SELECT, transaction },
  );
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r.role);
  }
  const users = await User.findAll({
    attributes: ['id', 'role'],
    ...(ids ? { where: { id: ids } } : {}),
    transaction,
  });
  let changed = 0;
  for (const u of users) {
    const want = primaryRole(byUser.get(u.id) || []);
    if (u.role !== want) {
      await User.update({ role: want }, { where: { id: u.id }, transaction, hooks: false });
      changed++;
    }
  }
  invalidateAccessCache();
  return changed;
};

// Ids of the users who have a role through their groups (default: active only).
const findUserIdsWithRole = async (role, { activeOnly = true, transaction } = {}) => {
  const rows = await db().query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       JOIN group_roles gr ON gr.group_id = gm.group_id
       LEFT JOIN custom_roles cr ON cr.id = gr.custom_role_id
      WHERE (gr.system_role::text = :role OR cr.base_role::text = :role)
        ${activeOnly ? 'AND u.active = true' : ''}`,
    { replacements: { role }, type: QueryTypes.SELECT, transaction },
  );
  return rows.map((r) => r.id);
};

const findUsersWithRole = async (role, { attributes, activeOnly = true } = {}) => {
  const { User } = require('../models');
  const ids = await findUserIdsWithRole(role, { activeOnly });
  if (ids.length === 0) return [];
  return User.findAll({ where: { id: ids }, ...(attributes ? { attributes } : {}) });
};

// Settings key `access_model`: migration state and the groups standing for the
// built-in roles. getSetting returns objects serialised, hence the parse.
const getAccessModel = async () => {
  const { getSetting } = require('./settingsService');
  const raw = await getSetting('access_model');
  if (!raw) return {};
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
};
const setAccessModel = async (value) => {
  const { setSetting } = require('./settingsService');
  await setSetting('access_model', value);
};

class AccessError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

// Every change that can take away the administrator role runs inside a
// transaction and calls this before committing. An installation must never end
// up without an active administrator — nobody could repair it from the UI.
const assertAdminRemains = async (transaction) => {
  const admins = await findUserIdsWithRole('admin', { transaction });
  if (admins.length === 0) {
    throw new AccessError('This change would leave the installation without an active administrator.', 409);
  }
};

// The group that stands for a built-in role: the one the migration created, or
// any group that carries exactly this role. Created on demand when asked to.
const groupForSystemRole = async (role, { create = true, transaction } = {}) => {
  if (!isBuiltinRole(role)) return null;
  const { Group, GroupRole } = require('../models');
  const model = await getAccessModel();
  const known = model.roleGroups?.[role];
  if (known) {
    const g = await Group.findByPk(known, { transaction });
    if (g) return g;
  }
  const link = await GroupRole.findOne({ where: { system_role: role }, order: [['id', 'ASC']], transaction });
  if (link) {
    const g = await Group.findByPk(link.group_id, { transaction });
    if (g) return g;
  }
  if (!create) return null;
  const g = await createRoleGroup(ROLE_GROUP_NAMES[role], { system_role: role }, { transaction,
    description: `Carries the built-in role "${role}".` });
  await setAccessModel({ ...model, roleGroups: { ...(model.roleGroups || {}), [role]: g.id } });
  return g;
};

const groupForCustomRole = async (customRole, { create = true, transaction } = {}) => {
  const { Group, GroupRole } = require('../models');
  const link = await GroupRole.findOne({ where: { custom_role_id: customRole.id }, order: [['id', 'ASC']], transaction });
  if (link) {
    const g = await Group.findByPk(link.group_id, { transaction });
    if (g) return g;
  }
  if (!create) return null;
  return createRoleGroup(`Role: ${customRole.name}`, { custom_role_id: customRole.id }, { transaction,
    description: `Carries the custom role "${customRole.name}".` });
};

// Creates a group carrying one role, picking a free name.
const createRoleGroup = async (baseName, roleRef, { transaction, description } = {}) => {
  const { Group, GroupRole } = require('../models');
  let name = baseName.slice(0, 90);
  for (let i = 2; await Group.findOne({ where: { name }, transaction }); i++) name = `${baseName.slice(0, 85)} (${i})`;
  const g = await Group.create({ name, description, color: '#6366f1' }, { transaction });
  await GroupRole.create({ group_id: g.id, ...roleRef }, { transaction });
  return g;
};

module.exports = {
  BUILTIN_ROLES, READ_ONLY_ROLES, NO_ROLE, ROLE_GROUP_NAMES,
  isBuiltinRole, baseRoleOf, rolesOfGrants, primaryRole, isReadOnly, rolesOf, hasRole, onlyRoles,
  loadGrants, attachAccess, invalidateAccessCache, syncUserRoles,
  findUserIdsWithRole, findUsersWithRole, assertAdminRemains, AccessError,
  groupForSystemRole, groupForCustomRole, createRoleGroup, getAccessModel, setAccessModel,
};
