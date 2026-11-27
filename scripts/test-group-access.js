#!/usr/bin/env node
'use strict';

/**
 * Group-based access (v3.10.0): roles reach users only through groups, and the
 * roles of all groups add up (allow-only).
 *
 * Pure functions and services with mocked database and models — no DB, no
 * network:
 *
 *  - accessService helpers: base roles, most privileged role, read-only rule,
 *    hasRole / onlyRoles on multi-role users, the 'none' cache value
 *  - attachAccess: grants from the group query, deduplicated, groups without
 *    roles and dangling custom roles skipped, non-enumerable, technical user
 *  - permissionService.decide: union across roles, custom role false does not
 *    veto another role's true, fallback only where a role's set is silent,
 *    no role -> denied
 *  - resolvePermissions / can: merged view
 *  - assertAdminRemains: 409 when no active administrator would remain
 *  - ssoGroupSync.applySsoGroups: default group, 'sso' memberships, strict
 *    sync removes only stale 'sso' memberships, never the last administrator
 *
 * Run: node scripts/test-group-access.js
 */

const path = require('path');
const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'backend', 'src');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-group-access-only';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Global matrix: module.action -> roles allowed.
const MATRIX = {
  incidents: { view: ['admin', 'assessor', 'dpo'], edit: ['admin', 'assessor'] },
  vendors: { view: ['admin', 'assessor', 'dpo', 'viewer'] },
  admin: { roles: ['admin'] },
};

// In-memory group data for the raw SQL in accessService.
const state = {
  groupMembers: [],   // { group_id, user_id, source }
  groupRoles: [],     // { group_id, system_role?, custom_role_id? }
  customRoles: [],    // { id, base_role, permissions }
  users: [],          // { id, role, active }
  groups: [],         // { id, name }
  queries: 0,
};

const grantRowsFor = (userId) => {
  const rows = [];
  for (const gm of state.groupMembers.filter((m) => m.user_id === userId)) {
    const roles = state.groupRoles.filter((r) => r.group_id === gm.group_id);
    if (roles.length === 0) rows.push({ group_id: gm.group_id, system_role: null, custom_role_id: null, base_role: null, permissions: null });
    for (const r of roles) {
      const cr = r.custom_role_id ? state.customRoles.find((c) => c.id === r.custom_role_id) : null;
      rows.push({ group_id: gm.group_id, system_role: r.system_role || null, custom_role_id: r.custom_role_id || null,
        base_role: cr ? cr.base_role : null, permissions: cr ? cr.permissions : null });
    }
  }
  return rows;
};

const roleRowsOf = (role) => {
  const ids = new Set();
  for (const gm of state.groupMembers) {
    const user = state.users.find((u) => u.id === gm.user_id);
    if (!user || !user.active) continue;
    for (const r of state.groupRoles.filter((x) => x.group_id === gm.group_id)) {
      const cr = r.custom_role_id ? state.customRoles.find((c) => c.id === r.custom_role_id) : null;
      if (r.system_role === role || cr?.base_role === role) ids.add(user.id);
    }
  }
  return [...ids].map((id) => ({ id }));
};

const userRoleRows = (ids) => {
  const out = [];
  for (const gm of state.groupMembers) {
    if (ids && !ids.includes(gm.user_id)) continue;
    for (const r of state.groupRoles.filter((x) => x.group_id === gm.group_id)) {
      const cr = r.custom_role_id ? state.customRoles.find((c) => c.id === r.custom_role_id) : null;
      out.push({ user_id: gm.user_id, role: r.system_role || cr?.base_role || null });
    }
  }
  return out;
};

const fakeDb = {
  query: async (sql, opts = {}) => {
    state.queries++;
    const r = opts.replacements || {};
    if (sql.includes('WHERE gm.user_id = :userId')) return grantRowsFor(r.userId);
    if (sql.includes('SELECT DISTINCT u.id')) return roleRowsOf(r.role);
    if (sql.includes('SELECT gm.user_id, COALESCE')) return userRoleRows(r.ids || null);
    throw new Error('unexpected query: ' + sql.slice(0, 60));
  },
  transaction: async () => {
    // Snapshot-based transaction: rollback restores group memberships.
    const snapshot = state.groupMembers.map((m) => ({ ...m }));
    return {
      commit: async () => {},
      rollback: async () => { state.groupMembers = snapshot; },
    };
  },
};

let memberSeq = 1000;
const memberInstance = (m) => ({
  ...m,
  destroy: async () => { state.groupMembers = state.groupMembers.filter((x) => x !== m); },
});
const models = {
  User: {
    findAll: async ({ where } = {}) => state.users
      .filter((u) => !where?.id || (Array.isArray(where.id) ? where.id : [where.id]).includes(u.id))
      .map((u) => ({ ...u })),
    update: async (vals, { where }) => {
      for (const u of state.users) if (u.id === where.id) Object.assign(u, vals);
      return [1];
    },
  },
  Group: {
    findAll: async ({ where }) => state.groups.filter((g) => where.id.includes(g.id)).map((g) => ({ ...g })),
  },
  GroupMember: {
    findAll: async ({ where }) => state.groupMembers.filter((m) => m.user_id === where.user_id).map(memberInstance),
    create: async (vals) => { const m = { id: memberSeq++, ...vals }; state.groupMembers.push(m); return m; },
  },
};

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent && parent.filename && parent.filename.startsWith(SRC)) {
    if (request === '../config/database') return fakeDb;
    if (request === '../models') return models;
    if (request === './settingsService') {
      return { getPermissions: async () => MATRIX, getSetting: async () => null, setSetting: async () => {} };
    }
  }
  return origLoad.call(this, request, parent, ...rest);
};

const access = require(path.join(SRC, 'services', 'accessService.js'));
const perms = require(path.join(SRC, 'services', 'permissionService.js'));
const { applySsoGroups } = require(path.join(SRC, 'services', 'ssoGroupSync.js'));

const reset = () => {
  state.groupMembers = []; state.groupRoles = []; state.customRoles = []; state.users = []; state.groups = [];
  perms.invalidatePermissionCache();
};

// Helper: a user object as authenticate() would see it.
const userWith = async (id) => access.attachAccess({ id, role: 'none' });

// ─── Pure helpers ────────────────────────────────────────────────────────────

test('rolesOfGrants: base roles in privilege order, unknown dropped', () => {
  const roles = access.rolesOfGrants([
    { system_role: 'viewer' },
    { custom_role_id: 7, base_role: 'dpo' },
    { system_role: 'assessor' },
    { custom_role_id: 8, base_role: 'bogus' },
  ]);
  assert.deepEqual(roles, ['assessor', 'dpo', 'viewer']);
});

test('primaryRole: most privileged, none without roles', () => {
  assert.equal(access.primaryRole(['viewer', 'it-staff']), 'it-staff');
  assert.equal(access.primaryRole(['employee', 'admin']), 'admin');
  assert.equal(access.primaryRole([]), 'none');
  assert.equal(access.primaryRole(undefined), 'none');
});

test('isReadOnly: only when every role is read-only, or there is none', () => {
  assert.equal(access.isReadOnly(['viewer']), true);
  assert.equal(access.isReadOnly(['viewer', 'management', 'employee']), true);
  assert.equal(access.isReadOnly(['viewer', 'owner']), false);
  assert.equal(access.isReadOnly([]), true);
  assert.equal(access.isReadOnly(undefined), true);
});

test('hasRole / onlyRoles on a multi-role user', () => {
  const u = { roles: ['it-staff', 'viewer'] };
  assert.equal(access.hasRole(u, 'viewer'), true);
  assert.equal(access.hasRole(u, 'admin', 'dpo'), false);
  assert.equal(access.hasRole(u, ['admin', 'it-staff']), true);
  // Restriction for it-staff/viewer applies: no role outside the set.
  assert.equal(access.onlyRoles(u, 'it-staff', 'viewer'), true);
  // One additional role lifts it.
  assert.equal(access.onlyRoles({ roles: ['it-staff', 'dpo'] }, 'it-staff', 'viewer'), false);
});

test('rolesOf: falls back to the cached column, none means no role', () => {
  assert.deepEqual(access.rolesOf({ role: 'dpo' }), ['dpo']);
  assert.deepEqual(access.rolesOf({ role: 'none' }), []);
  assert.deepEqual(access.rolesOf(null), []);
  assert.deepEqual(access.rolesOf({ role: 'admin', roles: [] }), [], 'attached roles win over the cache');
});

// ─── attachAccess ────────────────────────────────────────────────────────────

test('attachAccess: union of all groups, deduplicated, non-enumerable', async () => {
  reset();
  state.customRoles = [{ id: 1, base_role: 'viewer', permissions: { incidents: { view: true } } }];
  state.groupRoles = [
    { group_id: 10, system_role: 'viewer' },
    { group_id: 11, system_role: 'viewer' },        // same role twice
    { group_id: 11, custom_role_id: 1 },
    { group_id: 12, custom_role_id: 99 },           // dangling custom role
  ];
  state.groupMembers = [10, 11, 12, 13].map((g) => ({ group_id: g, user_id: 5, source: 'manual' })); // 13: team only
  const u = await userWith(5);
  assert.deepEqual(u.roles, ['viewer']);
  assert.equal(u.accessGrants.length, 2);
  assert.deepEqual(u.groupIds.sort(), [10, 11, 12, 13]);
  assert.equal(JSON.stringify(u).includes('accessGrants'), false, 'never serialised');
  assert.equal(Object.keys(u).includes('roles'), false);
});

test('attachAccess: technical MCP_SECRET user gets its role without groups', async () => {
  reset();
  const u = await access.attachAccess({ id: 0, role: 'assessor', technical: true });
  assert.deepEqual(u.roles, ['assessor']);
  const none = await access.attachAccess({ id: 0, role: 'none', technical: true });
  assert.deepEqual(none.roles, []);
});

test('attachAccess: grants are cached until invalidated', async () => {
  reset();
  state.groupRoles = [{ group_id: 1, system_role: 'owner' }];
  state.groupMembers = [{ group_id: 1, user_id: 9, source: 'manual' }];
  await userWith(9);
  const before = state.queries;
  await userWith(9);
  assert.equal(state.queries, before, 'second lookup served from cache');
  access.invalidateAccessCache();
  await userWith(9);
  assert.equal(state.queries, before + 1);
});

// ─── decide: allow-only union ───────────────────────────────────────────────

test('decide: a role that allows wins, regardless of others', async () => {
  reset();
  state.groupRoles = [{ group_id: 1, system_role: 'viewer' }, { group_id: 2, system_role: 'assessor' }];
  state.groupMembers = [{ group_id: 1, user_id: 1 }, { group_id: 2, user_id: 1 }];
  const u = await userWith(1);
  assert.equal(await perms.decide(u, 'incidents', 'edit', []), true);
  assert.equal(await perms.decide(u, 'admin', 'roles', ['admin']), false);
});

test('decide: custom role false does not veto another role', async () => {
  reset();
  state.customRoles = [{ id: 3, base_role: 'viewer', permissions: { incidents: { view: false } } }];
  state.groupRoles = [{ group_id: 1, custom_role_id: 3 }, { group_id: 2, system_role: 'dpo' }];
  state.groupMembers = [{ group_id: 1, user_id: 2 }, { group_id: 2, user_id: 2 }];
  const u = await userWith(2);
  assert.equal(await perms.decide(u, 'incidents', 'view', []), true, 'DPO allows');

  // Alone, the custom role denies.
  state.groupMembers = [{ group_id: 1, user_id: 3 }];
  access.invalidateAccessCache();
  const alone = await userWith(3);
  assert.equal(await perms.decide(alone, 'incidents', 'view', ['viewer']), false, 'explicit false beats fallback');
});

test('decide: fallback roles apply only where the role\'s set is silent', async () => {
  reset();
  state.customRoles = [{ id: 4, base_role: 'it-staff', permissions: { vendors: { view: true } } }];
  state.groupRoles = [{ group_id: 1, custom_role_id: 4 }];
  state.groupMembers = [{ group_id: 1, user_id: 4 }];
  const u = await userWith(4);
  assert.equal(await perms.decide(u, 'newmodule', 'view', ['it-staff']), true, 'silent set + base role in fallback');
  assert.equal(await perms.decide(u, 'newmodule', 'view', ['admin']), false);
});

test('decide: user without roles is denied everything', async () => {
  reset();
  state.groupMembers = [{ group_id: 1, user_id: 6 }]; // team without roles
  const u = await userWith(6);
  assert.deepEqual(u.roles, []);
  assert.equal(await perms.decide(u, 'vendors', 'view', access.BUILTIN_ROLES), false);
});

test('resolvePermissions: merged, true wins', async () => {
  reset();
  state.customRoles = [{ id: 5, base_role: 'viewer', permissions: { incidents: { view: false, edit: false } } }];
  state.groupRoles = [{ group_id: 1, custom_role_id: 5 }, { group_id: 2, system_role: 'dpo' }];
  state.groupMembers = [{ group_id: 1, user_id: 7 }, { group_id: 2, user_id: 7 }];
  const u = await userWith(7);
  const m = await perms.resolvePermissions(u);
  assert.equal(m.incidents.view, true);
  assert.equal(m.incidents.edit, false);
  assert.equal(await perms.can(u, 'incidents', 'view'), true);
  assert.equal(await perms.can(u, 'incidents', 'edit'), false);
});

// ─── assertAdminRemains ─────────────────────────────────────────────────────

test('assertAdminRemains: passes with an active admin, 409 without', async () => {
  reset();
  state.users = [{ id: 1, role: 'admin', active: true }];
  state.groupRoles = [{ group_id: 1, system_role: 'admin' }];
  state.groupMembers = [{ group_id: 1, user_id: 1 }];
  await access.assertAdminRemains();
  state.users[0].active = false;
  await assert.rejects(access.assertAdminRemains(), (e) => e instanceof access.AccessError && e.status === 409);
});

test('syncUserRoles: cache column follows the groups', async () => {
  reset();
  state.users = [{ id: 1, role: 'viewer', active: true }, { id: 2, role: 'admin', active: true }];
  state.groupRoles = [{ group_id: 1, system_role: 'owner' }, { group_id: 2, system_role: 'employee' }];
  state.groupMembers = [{ group_id: 1, user_id: 1 }, { group_id: 2, user_id: 1 }];
  const changed = await access.syncUserRoles();
  assert.equal(changed, 2);
  assert.equal(state.users[0].role, 'owner');
  assert.equal(state.users[1].role, 'none', 'no group, no role');
});

// ─── SSO group sync ─────────────────────────────────────────────────────────

const ssoSetup = () => {
  reset();
  state.groups = [{ id: 1, name: 'Admins' }, { id: 2, name: 'Auditors' }, { id: 3, name: 'Default' }, { id: 4, name: 'Manual team' }];
  state.groupRoles = [{ group_id: 1, system_role: 'admin' }, { group_id: 2, system_role: 'assessor' }, { group_id: 3, system_role: 'viewer' }];
  state.users = [{ id: 1, role: 'none', active: true }, { id: 2, role: 'admin', active: true }];
};

test('applySsoGroups: default group when no mapping matches', async () => {
  ssoSetup();
  const r = await applySsoGroups({ userId: 1, grantedGroupIds: [], general: { ssoDefaultGroupId: 3 }, mappingsConfigured: true });
  assert.deepEqual(r.added, [3]);
  assert.equal(state.groupMembers.find((m) => m.user_id === 1).source, 'sso');
  assert.equal(state.users[0].role, 'viewer');
});

test('applySsoGroups: no default group -> no membership, no role', async () => {
  ssoSetup();
  const r = await applySsoGroups({ userId: 1, grantedGroupIds: [], general: { ssoDefaultGroupId: null }, mappingsConfigured: false });
  assert.deepEqual(r.added, []);
  assert.equal(state.groupMembers.length, 0);
});

test('applySsoGroups: several mappings combine, deleted groups ignored', async () => {
  ssoSetup();
  const r = await applySsoGroups({ userId: 1, grantedGroupIds: [2, 3, 77], general: { ssoDefaultGroupId: 1 }, mappingsConfigured: true });
  assert.deepEqual(r.added.sort(), [2, 3]);
  assert.equal(state.users[0].role, 'assessor');
  assert.equal(state.groupMembers.some((m) => m.group_id === 1), false, 'default not added when a mapping matched');
});

test('applySsoGroups: strict sync removes stale sso memberships only', async () => {
  ssoSetup();
  state.groupMembers = [
    { group_id: 2, user_id: 1, source: 'sso' },
    { group_id: 4, user_id: 1, source: 'manual' },
    { group_id: 1, user_id: 2, source: 'manual' }, // another administrator exists
  ];
  const r = await applySsoGroups({ userId: 1, grantedGroupIds: [3], general: { ssoStrictRoleSync: true }, mappingsConfigured: true });
  assert.deepEqual(r.removed, [2]);
  assert.deepEqual(state.groupMembers.filter((m) => m.user_id === 1).map((m) => m.group_id).sort(), [3, 4]);
});

test('applySsoGroups: non-strict keeps stale sso memberships', async () => {
  ssoSetup();
  state.groupMembers = [{ group_id: 2, user_id: 1, source: 'sso' }];
  const r = await applySsoGroups({ userId: 1, grantedGroupIds: [3], general: { ssoStrictRoleSync: false }, mappingsConfigured: true });
  assert.deepEqual(r.removed, []);
  assert.equal(state.groupMembers.some((m) => m.group_id === 2), true);
});

test('applySsoGroups: strict sync never removes the last administrator', async () => {
  ssoSetup();
  state.groupMembers = [{ group_id: 1, user_id: 2, source: 'sso' }];
  const r = await applySsoGroups({ userId: 2, grantedGroupIds: [3], general: { ssoStrictRoleSync: true }, mappingsConfigured: true });
  assert.deepEqual(r.removed, []);
  assert.equal(r.skippedRemoval, 'last active administrator');
  assert.equal(state.groupMembers.some((m) => m.group_id === 1 && m.user_id === 2), true, 'admin membership restored');
});
