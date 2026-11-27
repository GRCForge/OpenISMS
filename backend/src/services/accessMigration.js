// One-time migration to group-based access (v3.10.0).
//
// Before v3.10.0 every user had exactly one role (users.role), optionally
// pinned by a custom role (users.custom_role_id). Since then roles reach a user
// only through groups (services/accessService.js). This migration keeps every
// user's access exactly as it was:
//
//   - one group per role in use: "Administrators", "Assessors", … for the
//     built-in roles, "Role: <name>" for custom roles
//   - every user joins the group of their former role (custom role wins, as
//     before)
//   - SSO claim mappings that named a role now name that role's group
//   - the SSO default role becomes the SSO default group
//
// Existing groups (teams for tasks and @-mentions) are left alone: they carry no
// roles, so membership in them grants nothing. Runs once; the state is kept in
// the settings key `access_model`.

const sequelize = require('../config/database');
const {
  ROLE_GROUP_NAMES, isBuiltinRole, createRoleGroup, syncUserRoles, getAccessModel, setAccessModel,
} = require('./accessService');

const MODEL_VERSION = 1;

const ensureGroupBasedAccess = async ({ log = console } = {}) => {
  const model = await getAccessModel();
  if ((model.version || 0) >= MODEL_VERSION) return { skipped: true };

  const { User, CustomRole, GroupMember, OidcClaimMapping } = require('../models');
  const { getGeneral, setGeneral } = require('./settingsService');

  const roleGroups = { ...(model.roleGroups || {}) };
  const customGroups = {};
  const counts = { groups: 0, memberships: 0, mappings: 0 };

  const t = await sequelize.transaction();
  try {
    const systemGroup = async (role) => {
      if (!roleGroups[role]) {
        const g = await createRoleGroup(ROLE_GROUP_NAMES[role], { system_role: role }, {
          transaction: t,
          description: `Created by the migration to group-based permissions (v3.10.0). Carries the built-in role "${role}".`,
        });
        roleGroups[role] = g.id;
        counts.groups++;
      }
      return roleGroups[role];
    };
    const customGroup = async (cr) => {
      if (!customGroups[cr.id]) {
        const g = await createRoleGroup(`Role: ${cr.name}`, { custom_role_id: cr.id }, {
          transaction: t,
          description: `Created by the migration to group-based permissions (v3.10.0). Carries the custom role "${cr.name}".`,
        });
        customGroups[cr.id] = g.id;
        counts.groups++;
      }
      return customGroups[cr.id];
    };

    const customRoles = new Map((await CustomRole.findAll({ transaction: t })).map((r) => [r.id, r]));
    const users = await User.findAll({ attributes: ['id', 'role', 'custom_role_id'], transaction: t });
    for (const u of users) {
      let groupId = null;
      const cr = u.custom_role_id ? customRoles.get(u.custom_role_id) : null;
      if (cr) groupId = await customGroup(cr);
      else if (isBuiltinRole(u.role)) groupId = await systemGroup(u.role);
      if (!groupId) continue;
      const [, created] = await GroupMember.findOrCreate({
        where: { group_id: groupId, user_id: u.id },
        defaults: { source: 'manual' },
        transaction: t,
      });
      if (created) counts.memberships++;
    }

    const mappings = await OidcClaimMapping.findAll({ where: { group_id: null }, transaction: t });
    for (const m of mappings) {
      let groupId = null;
      const cr = m.custom_role_id ? customRoles.get(m.custom_role_id) : null;
      if (cr) groupId = await customGroup(cr);
      else if (isBuiltinRole(m.role)) groupId = await systemGroup(m.role);
      if (!groupId) continue;
      await m.update({ group_id: groupId }, { transaction: t });
      counts.mappings++;
    }

    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  const general = await getGeneral();
  if (!general.ssoDefaultGroupId && isBuiltinRole(general.ssoDefaultRole)) {
    // Only when SSO can create users at all; otherwise the setting is moot and
    // creating an empty "Viewers" group would only add clutter.
    if (general.ssoAutoProvision || roleGroups[general.ssoDefaultRole]) {
      if (!roleGroups[general.ssoDefaultRole]) {
        const g = await createRoleGroup(ROLE_GROUP_NAMES[general.ssoDefaultRole], { system_role: general.ssoDefaultRole }, {
          description: `Created by the migration to group-based permissions (v3.10.0). Carries the built-in role "${general.ssoDefaultRole}".`,
        });
        roleGroups[general.ssoDefaultRole] = g.id;
        counts.groups++;
      }
      await setGeneral({ ssoDefaultGroupId: roleGroups[general.ssoDefaultRole] });
    }
  }

  await setAccessModel({ ...model, version: MODEL_VERSION, migratedAt: new Date().toISOString(), roleGroups });
  await syncUserRoles();
  log.log(`[Access] Migrated to group-based permissions: ${counts.groups} role group(s), `
    + `${counts.memberships} membership(s), ${counts.mappings} SSO mapping(s).`);
  return counts;
};

module.exports = { ensureGroupBasedAccess, MODEL_VERSION };
