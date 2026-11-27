// Group memberships granted by SSO (v3.10.0).
//
// On every SSO login the claim mappings decide which groups the IdP grants.
// The user joins each of them (source 'sso'). Without a matching mapping the
// user joins the SSO default group, if one is set.
//
// With strict sync the IdP is authoritative for what it granted: memberships
// with source 'sso' that no mapping grants any more are removed. Memberships an
// administrator added by hand are never touched, and the last administrator is
// never removed.

const sequelize = require('../config/database');
const { assertAdminRemains, syncUserRoles, invalidateAccessCache, AccessError } = require('./accessService');

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {number[]} p.grantedGroupIds   groups granted by matching mappings
 * @param {object} p.general             general settings (ssoDefaultGroupId, ssoStrictRoleSync)
 * @param {boolean} p.mappingsConfigured whether any mapping exists at all
 * @returns {Promise<{added:number[], removed:number[], skippedRemoval?:string}>}
 */
const applySsoGroups = async ({ userId, grantedGroupIds, general, mappingsConfigured }) => {
  const { GroupMember, Group } = require('../models');
  const granted = new Set((grantedGroupIds || []).filter(Boolean));
  if (granted.size === 0 && general.ssoDefaultGroupId) granted.add(Number(general.ssoDefaultGroupId));

  // Only groups that still exist.
  const existing = granted.size ? await Group.findAll({ where: { id: [...granted] }, attributes: ['id'] }) : [];
  const target = new Set(existing.map((g) => g.id));

  const current = await GroupMember.findAll({ where: { user_id: userId } });
  const memberOf = new Set(current.map((m) => m.group_id));

  const added = [];
  for (const gid of target) {
    if (!memberOf.has(gid)) {
      await GroupMember.create({ group_id: gid, user_id: userId, source: 'sso' });
      added.push(gid);
    }
  }

  const removed = [];
  let skippedRemoval;
  if (general.ssoStrictRoleSync && mappingsConfigured) {
    const stale = current.filter((m) => m.source === 'sso' && !target.has(m.group_id));
    if (stale.length) {
      const t = await sequelize.transaction();
      try {
        for (const m of stale) await m.destroy({ transaction: t });
        await assertAdminRemains(t);
        await t.commit();
        removed.push(...stale.map((m) => m.group_id));
      } catch (e) {
        await t.rollback();
        if (!(e instanceof AccessError)) throw e;
        skippedRemoval = 'last active administrator';
      }
    }
  }

  if (added.length || removed.length) await syncUserRoles([userId]);
  else invalidateAccessCache();
  return { added, removed, ...(skippedRemoval ? { skippedRemoval } : {}) };
};

// Settings input -> patch for the SSO default group. ssoDefaultRole (the
// setting before v3.10.0) is still accepted from API and MCP clients and means
// the group carrying that role, created on demand.
const ssoDefaultGroupPatch = async ({ ssoDefaultGroupId, ssoDefaultRole } = {}) => {
  const { Group } = require('../models');
  const { groupForSystemRole, isBuiltinRole } = require('./accessService');
  if (ssoDefaultGroupId !== undefined) {
    if (ssoDefaultGroupId === null || ssoDefaultGroupId === '') return { ssoDefaultGroupId: null };
    const g = await Group.findByPk(parseInt(ssoDefaultGroupId, 10));
    if (!g) throw new AccessError('ssoDefaultGroupId: group not found');
    return { ssoDefaultGroupId: g.id };
  }
  if (ssoDefaultRole !== undefined) {
    if (!isBuiltinRole(ssoDefaultRole)) throw new AccessError('ssoDefaultRole: unknown role');
    const g = await groupForSystemRole(ssoDefaultRole);
    return { ssoDefaultGroupId: g.id, ssoDefaultRole };
  }
  return {};
};

module.exports = { applySsoGroups, ssoDefaultGroupPatch };
