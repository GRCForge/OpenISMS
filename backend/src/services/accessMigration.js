
// One-time migration to group-based access (v3.10.0).
//
// Before v3.10.0 every user had exactly one role (users.role), optionally
// pinned by a custom role (users.custom_role_id). Since then roles reach a user
// only through groups (services/accessService.js). This migration keeps every
// user's access as it was:
//
//   - one group per role in use: "Administrators", "Assessors", … for the
//     built-in roles, "Role: <name>" for custom roles
//   - every user joins the group of their former role (custom role wins, as
//     before)
//   - SSO claim mappings that named a role now name that role's group
//   - the SSO default role becomes the SSO default group
//
// Existing groups (teams for tasks and @-mentions) are left alone: they carry no
// roles, so membership in them grants nothing.
//
// Safety properties (checked by scripts/test-group-access-db.js and
// scripts/test-access-equivalence-db.js):
//   - atomic: memberships, mappings, the SSO default group and the state key
//     `access_model` are written in ONE transaction - a failed start leaves the
//     database as it was and the next start retries from scratch
//   - idempotent: role groups are looked up by the role they carry before one
//     is created, memberships use findOrCreate; a second run changes nothing
//   - one runner: a transaction-scoped advisory lock serialises concurrent
//     starts (several replicas); the second one sees the finished state
//   - no lockout: a user whose users.role differs from the base role of their
//     custom role (only possible through direct database edits before v3.10.0:
//     the application kept both equal) keeps both - the custom role's group
//     and the group of the former users.role - so no former right is lost; such
//     users are logged and listed in `access_model.inconsistentUsers`.

const sequelize = require('../config/database');
const { ROLE_GROUP_NAMES, isBuiltinRole, createRoleGroup, syncUserRoles, getAccessModel } = require('./accessService');

const MODEL_VERSION = 1;
// Key for pg_advisory_xact_lock ("OISM" + 0x0310 = v3.10.0 access migration).
const LOCK_KEY = 0x4f49534d0310;
// Defaults of the settings key `general` (services/settingsService.js) for
// the two fields read here; the raw row is read inside the transaction.
const GENERAL_DEFAULTS = { ssoAutoProvision: true, ssoDefaultRole: 'viewer' };

const parseSetting = (row) => {
  if (!row || !row.value) return {};
  if (typeof row.value === 'string') {
    try { const p = JSON.parse(row.value); return typeof p === 'string' ? JSON.parse(p) : p; } catch { return {}; }
  }
  return row.value;
};

const ensureGroupBasedAccess = async ({ log = console } = {}) => {
  // Cheap check outside the lock: the common case on every start.
  if (((await getAccessModel()).version || 0) >= MODEL_VERSION) return { skipped: true };

  const { User, CustomRole, Group, GroupRole, GroupMember, OidcClaimMapping, Setting } = require('../models');
  const counts = { groups: 0, memberships: 0, mappings: 0, inconsistent: 0 };
  const inconsistent = [];

  const t = await sequelize.transaction();
  try {
    await sequelize.query('SELECT pg_advisory_xact_lock(:k)', { replacements: { k: LOCK_KEY }, transaction: t });
    const modelRow = await Setting.findByPk('access_model', { transaction: t });
    const model = parseSetting(modelRow);
    if ((model.version || 0) >= MODEL_VERSION) {
      await t.commit();
      return { skipped: true };
    }

    const roleGroups = { ...(model.roleGroups || {}) };
    const customGroups = {};
    const description = (kind, name) => `Created by the migration to group-based permissions (v3.10.0). Carries the ${kind} "${name}".`;

    // A group that already carries the role (from an interrupted earlier run or
    // created by hand) is reused - never a second one.
    const existingGroup = async (where) => {
      const link = await GroupRole.findOne({ where, order: [['id', 'ASC']], transaction: t });
      return link ? Group.findByPk(link.group_id, { transaction: t }) : null;
    };
    const systemGroup = async (role) => {
      if (roleGroups[role] && await Group.findByPk(roleGroups[role], { transaction: t })) return roleGroups[role];
      let g = await existingGroup({ system_role: role });
      if (!g) {
        g = await createRoleGroup(ROLE_GROUP_NAMES[role], { system_role: role }, { transaction: t, description: description('built-in role', role) });
        counts.groups++;
      }
      roleGroups[role] = g.id;
      return g.id;
    };
    const customGroup = async (cr) => {
      if (customGroups[cr.id]) return customGroups[cr.id];
      let g = await existingGroup({ custom_role_id: cr.id });
      if (!g) {
        g = await createRoleGroup(`Role: ${cr.name}`, { custom_role_id: cr.id }, { transaction: t, description: description('custom role', cr.name) });
        counts.groups++;
      }
      customGroups[cr.id] = g.id;
      return g.id;
    };
    const join = async (groupId, userId) => {
      const [, created] = await GroupMember.findOrCreate({
        where: { group_id: groupId, user_id: userId },
        defaults: { source: 'manual' },
        transaction: t,
      });
      if (created) counts.memberships++;
    };

    const customRoles = new Map((await CustomRole.findAll({ transaction: t })).map((r) => [r.id, r]));
    const users = await User.findAll({ attributes: ['id', 'role', 'custom_role_id'], order: [['id', 'ASC']], transaction: t });
    for (const u of users) {
      const cr = u.custom_role_id ? customRoles.get(u.custom_role_id) : null;
      if (cr) {
        await join(await customGroup(cr), u.id);
        // Before v3.10.0 the role-based rules (write protection, visibility,
        // fallback roles) asked users.role, which the application kept equal
        // to the custom role's base role. Where the data says otherwise, the
        // former users.role is kept as well, so nothing is lost.
        if (isBuiltinRole(u.role) && u.role !== cr.base_role) {
          await join(await systemGroup(u.role), u.id);
          inconsistent.push({ id: u.id, role: u.role, custom_role_id: cr.id, base_role: cr.base_role });
        }
      } else if (isBuiltinRole(u.role)) {
        await join(await systemGroup(u.role), u.id);
      }
    }
    counts.inconsistent = inconsistent.length;

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

    // SSO default role -> SSO default group. Only when SSO can create users at
    // all (or the group exists anyway); otherwise the setting is moot and an
    // empty "Viewers" group would only add clutter.
    const generalRow = await Setting.findByPk('general', { transaction: t });
    const general = parseSetting(generalRow);
    const ssoDefaultRole = general.ssoDefaultRole ?? GENERAL_DEFAULTS.ssoDefaultRole;
    const ssoAutoProvision = general.ssoAutoProvision ?? GENERAL_DEFAULTS.ssoAutoProvision;
    if (!general.ssoDefaultGroupId && isBuiltinRole(ssoDefaultRole) && (ssoAutoProvision || roleGroups[ssoDefaultRole])) {
      const value = { ...general, ssoDefaultGroupId: await systemGroup(ssoDefaultRole) };
      if (generalRow) { generalRow.value = value; generalRow.changed('value', true); await generalRow.save({ transaction: t }); }
      else await Setting.create({ key: 'general', value }, { transaction: t });
    }

    const newModel = {
      ...model,
      version: MODEL_VERSION,
      migratedAt: new Date().toISOString(),
      roleGroups,
      ...(inconsistent.length ? { inconsistentUsers: inconsistent } : {}),
    };
    if (modelRow) { modelRow.value = newModel; modelRow.changed('value', true); await modelRow.save({ transaction: t }); }
    else await Setting.create({ key: 'access_model', value: newModel }, { transaction: t });

    await syncUserRoles(undefined, { transaction: t });
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
  require('./accessService').invalidateAccessCache();

  for (const u of inconsistent) {
    (log.warn || log.log).call(log, `[Access] User #${u.id}: users.role "${u.role}" differed from the base role "${u.base_role}" of custom role #${u.custom_role_id}; `
      + 'both roles were kept. Review the user\'s groups.');
  }
  log.log(`[Access] Migrated to group-based permissions: ${counts.groups} role group(s), `
    + `${counts.memberships} membership(s), ${counts.mappings} SSO mapping(s)`
    + `${counts.inconsistent ? `, ${counts.inconsistent} user(s) with inconsistent role data kept both roles` : ''}.`);
  return counts;
};

module.exports = { ensureGroupBasedAccess, MODEL_VERSION, LOCK_KEY };
