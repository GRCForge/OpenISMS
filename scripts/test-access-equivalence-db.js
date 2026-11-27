#!/usr/bin/env node
'use strict';

/**
 * Integration test against a THROWAWAY Postgres database: the migration to
 * group-based access (v3.10.0) keeps every user's effective rights.
 *
 * Data as in v3.9.0: one role per user, custom roles with and without their own
 * permission set (with true and false entries, entries beyond the base role,
 * modules the global matrix does not know), global matrix overrides, inactive
 * users, SSO mappings. For every user, every module.action of the matrices
 * (plus one unknown action) and every fallback role list a route can carry
 * ([], each single role, all roles), the decision BEFORE (v3.9.0 logic) is
 * compared with the decision AFTER the migration (services/permissionService
 * decide() over the user's groups). The role-based rules are compared too:
 * requireRole / isAdmin / canViewAllAssets (hasRole per role) and
 * requireWriteAccess (read-only).
 *
 * Expected: identical for every consistent user. A user whose users.role
 * differs from the base role of their custom role (only possible through
 * direct database edits before v3.10.0) keeps both roles: every former allow
 * is still an allow (superset), nothing is lost.
 *
 * Also: second run is a no-op; three concurrent runs migrate once (advisory
 * lock); a role group that already exists is reused; the active admins stay.
 *
 * Reference for "before": the v3.9.0 decision logic embedded below (verbatim
 * from v3.9.0 services/permissionService.js and middleware/auth.js). With
 * OLD_SRC=<v3.9.0 checkout>/backend/src the real v3.9.0 modules are loaded
 * and must agree with the embedded reference.
 *
 *   ACCESS_EQUIVALENCE_TEST_DB=1 DATABASE_URL=postgres://u@localhost/openisms_test \
 *   JWT_SECRET=x [OLD_SRC=/path/to/v3.9.0/backend/src] node scripts/test-access-equivalence-db.js
 */

if (process.env.ACCESS_EQUIVALENCE_TEST_DB !== '1') {
  console.log('Skipped (set ACCESS_EQUIVALENCE_TEST_DB=1 and DB_* / DATABASE_URL for a throwaway database).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual).slice(0, 600)}, expected ${JSON.stringify(expected).slice(0, 600)}`}`);
};

const ROLES = ['admin', 'assessor', 'dpo', 'it-staff', 'owner', 'management', 'employee', 'viewer'];

// ── v3.9.0 reference (verbatim logic) ───────────────────────────────────────
// permissionService.resolvePermissions/can + middleware/auth.js requirePermission,
// requireRole, requireWriteAccess, canViewAllAssets.
const oldMatrix = (user, global, customById) => {
  if (user.custom_role_id) {
    const own = customById.get(user.custom_role_id)?.permissions;
    if (own && typeof own === 'object') return own;
  }
  const result = {};
  for (const [module, actions] of Object.entries(global)) {
    if (!actions || typeof actions !== 'object') continue;
    result[module] = {};
    for (const [action, roles] of Object.entries(actions)) result[module][action] = Array.isArray(roles) && roles.includes(user.role);
  }
  return result;
};
const oldCan = (user, global, customById, m, a) => {
  const e = oldMatrix(user, global, customById)?.[m]?.[a];
  return typeof e === 'boolean' ? e : undefined;
};
const oldDecide = (user, global, customById, m, a, fallback) => {
  const v = oldCan(user, global, customById, m, a);
  if (v === true) return true;
  if (v === false) return false;
  return fallback.includes(user.role);
};
const oldHasRole = (user, r) => user.role === r;
const oldReadOnly = (user) => user.role === 'viewer' || user.role === 'management' || user.role === 'employee';

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const settings = require(path.join(SRC, 'services', 'settingsService'));
  await m.sequelize.sync();

  // ── Data as in v3.9.0 ─────────────────────────────────────────────────────
  await settings.setPermissions({
    risks: { view: ['admin', 'assessor', 'owner', 'dpo'] },               // viewer/management/employee removed
    incidents: { create: ['admin', 'assessor', 'it-staff', 'employee'] }, // employee added
    custom_module: { run: ['dpo'] },                                      // module only in the overrides
  });
  const cr = {
    auditor: await m.CustomRole.create({ name: 'Auditor', base_role: 'assessor', permissions: { incidents: { view: false }, risks: { view: true, edit: false }, assets: { delete: true } } }),
    readerPlus: await m.CustomRole.create({ name: 'Reader plus', base_role: 'viewer', permissions: { risks: { create: true }, unknown_mod: { x: true } } }),
    baseOnly: await m.CustomRole.create({ name: 'IT base only', base_role: 'it-staff', permissions: null }),
    empty: await m.CustomRole.create({ name: 'Empty set', base_role: 'owner', permissions: {} }),
    unused: await m.CustomRole.create({ name: 'Unused', base_role: 'dpo' }),
  };
  const mk = (name, role, extra = {}) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role, ...extra });
  const users = {};
  for (const r of ROLES) users[r] = await mk(r, r);
  users.admin2 = await mk('admin2', 'admin');
  users.inactiveAdmin = await mk('inactiveAdmin', 'admin', { active: false });
  users.inactiveViewer = await mk('inactiveViewer', 'viewer', { active: false });
  users.auditor = await mk('auditor', 'assessor', { custom_role_id: cr.auditor.id });
  users.readerPlus = await mk('readerPlus', 'viewer', { custom_role_id: cr.readerPlus.id });
  users.baseOnly = await mk('baseOnly', 'it-staff', { custom_role_id: cr.baseOnly.id });
  users.empty = await mk('empty', 'owner', { custom_role_id: cr.empty.id });
  users.drift = await mk('drift', 'admin', { custom_role_id: cr.readerPlus.id }); // inconsistent: admin vs base viewer
  await m.OidcClaimMapping.create({ claim_path: 'groups', claim_value: 'admins', role: 'admin', priority: 10 });
  await m.OidcClaimMapping.create({ claim_path: 'groups', claim_value: 'audit', custom_role_id: cr.auditor.id, priority: 5 });
  await settings.setGeneral({ ssoDefaultRole: 'viewer', ssoAutoProvision: true });
  // A group carrying the admin role exists already (created by hand or by an
  // interrupted run): the migration must reuse it.
  const handMade = await m.Group.create({ name: 'Admins (hand-made)' });
  await m.GroupRole.create({ group_id: handMade.id, system_role: 'admin' });
  // An ordinary team: grants nothing.
  const team = await m.Group.create({ name: 'Tasks team' });
  await m.GroupMember.create({ group_id: team.id, user_id: users.viewer.id });

  const global = await settings.getPermissions();
  const customById = new Map((await m.CustomRole.findAll()).map((r) => [r.id, r.get({ plain: true })]));
  const before = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.get({ plain: true })]));

  const actions = new Set();
  for (const [mod, acts] of Object.entries(global)) for (const a of Object.keys(acts || {})) actions.add(`${mod}.${a}`);
  for (const r of customById.values()) for (const [mod, acts] of Object.entries(r.permissions || {})) for (const a of Object.keys(acts || {})) actions.add(`${mod}.${a}`);
  actions.add('zzz_unknown.none');
  const fallbacks = [[], ...ROLES.map((r) => [r]), ROLES];

  // Optional: the real v3.9.0 modules must agree with the embedded reference.
  if (process.env.OLD_SRC) {
    console.log(`Reference check against the real v3.9.0 code (${process.env.OLD_SRC}):`);
    const oldPerm = require(path.join(process.env.OLD_SRC, 'services', 'permissionService'));
    const oldSettings = require(path.join(process.env.OLD_SRC, 'services', 'settingsService'));
    const oldGlobal = await oldSettings.getPermissions();
    const newOnly = [];
    for (const k of actions) { const [mo, a] = k.split('.'); if (global[mo]?.[a] && !oldGlobal[mo]?.[a]) newOnly.push(k); }
    eq('actions added to the default matrix since v3.9.0 (new rights, compared separately)', newOnly, ['bsi_grundschutz.risk_analysis']);
    let checked = 0;
    const diffs = [];
    for (const [k, u] of Object.entries(before)) {
      for (const key of actions) {
        if (newOnly.includes(key)) continue;
        const [mo, a] = key.split('.');
        const real = await oldPerm.can({ id: u.id, role: u.role, custom_role_id: u.custom_role_id }, mo, a);
        const ref = oldCan(u, global, customById, mo, a);
        checked++;
        if (real !== ref) diffs.push(`${k} ${key}: real ${real}, reference ${ref}`);
      }
    }
    eq(`embedded reference = real v3.9.0 can() (${checked} decisions)`, diffs, []);
  }

  // ── Migration ─────────────────────────────────────────────────────────────
  console.log('\nMigration (three concurrent starts):');
  const { ensureGroupBasedAccess } = require(path.join(SRC, 'services', 'accessMigration'));
  const access = require(path.join(SRC, 'services', 'accessService'));
  const quiet = { log: () => {}, warn: () => {} };
  const runs = await Promise.all([1, 2, 3].map(() => ensureGroupBasedAccess({ log: quiet })));
  eq('exactly one run migrated, the others saw the finished state', runs.filter((r) => r.skipped).length, 2);
  const migrated = runs.find((r) => !r.skipped);
  eq('one inconsistent user reported', migrated.inconsistent, 1);
  const groupCount = await m.Group.count();
  const memberCount = await m.GroupMember.count();
  eq('hand-made admin group reused, no second admin group', (await m.GroupRole.count({ where: { system_role: 'admin' } })), 1);
  eq('admins are in the hand-made group', (await m.GroupMember.findAll({ where: { group_id: handMade.id } })).map((g) => g.user_id).sort((a, b) => a - b),
    [users.admin.id, users.admin2.id, users.inactiveAdmin.id, users.drift.id].sort((a, b) => a - b));
  eq('team still carries no role', await m.GroupRole.count({ where: { group_id: team.id } }), 0);
  eq('second run: no-op', await ensureGroupBasedAccess({ log: quiet }), { skipped: true });
  eq('second run: no new groups or memberships', [await m.Group.count(), await m.GroupMember.count()], [groupCount, memberCount]);

  // ── Effective rights before vs. after ────────────────────────────────────
  console.log('\nEffective rights (permission decisions and role rules):');
  const { decide } = require(path.join(SRC, 'services', 'permissionService'));
  require(path.join(SRC, 'services', 'permissionService')).invalidatePermissionCache();
  let decisions = 0;
  const lost = [];
  const gained = [];
  const roleDiff = [];
  const driftQuirk = [];
  for (const [k, u] of Object.entries(before)) {
    const now = await access.attachAccess({ id: u.id });
    for (const key of actions) {
      const [mo, a] = key.split('.');
      for (const fb of fallbacks) {
        const was = oldDecide(u, global, customById, mo, a, fb);
        const is = await decide(now, mo, a, fb);
        decisions++;
        if (was && !is) {
          // The inconsistent user: v3.9.0 replaced the global matrix by the
          // custom role's own set and then asked users.role for the fallback.
          // With the former role as a real grant again, the global matrix
          // speaks for it - where it explicitly excludes that role, the
          // quirk is gone. Anything else would be a real loss.
          const quirk = k === 'drift' && Array.isArray(global[mo]?.[a]) && !global[mo][a].includes(u.role);
          (quirk ? driftQuirk : lost).push(`${k} ${key} [${fb.join(',')}]`);
        }
        if (!was && is) gained.push(`${k} ${key} [${fb.join(',')}]`);
      }
    }
    for (const r of ROLES) {
      if (oldHasRole(u, r) && !access.hasRole(now, r)) roleDiff.push(`${k} lost role ${r}`);
      if (!oldHasRole(u, r) && access.hasRole(now, r) && k !== 'drift') roleDiff.push(`${k} gained role ${r}`);
    }
    const ro = access.isReadOnly(access.rolesOf(now));
    if (oldReadOnly(u) !== ro && !(k === 'drift' && !ro)) roleDiff.push(`${k} read-only ${oldReadOnly(u)} -> ${ro}`);
  }
  console.log(`  (${Object.keys(before).length} users × ${actions.size} actions × ${fallbacks.length} fallback lists = ${decisions} decisions)`);
  eq('no user lost a permission decision', lost, []);
  console.log(`  (inconsistent user: ${driftQuirk.length} decision(s) the global matrix explicitly denies the former role, allowed in v3.9.0 only through the fallback quirk)`);
  eq('only the inconsistent user gained rights (both roles kept)', [...new Set(gained.map((g) => g.split(' ')[0]))], ['drift']);
  eq('role rules (requireRole, isAdmin, canViewAllAssets, requireWriteAccess) unchanged', roleDiff, []);
  const driftNow = await access.attachAccess({ id: users.drift.id });
  eq('inconsistent user keeps custom role and former role', [access.rolesOf(driftNow), driftNow.accessGrants.map((g) => g.system_role || `custom:${g.custom_role_id}`).sort()], [['admin', 'viewer'], ['admin', `custom:${cr.readerPlus.id}`].sort()]);

  console.log('\nAdministrators and cache column:');
  eq('active admins unchanged', (await access.findUserIdsWithRole('admin')).sort((a, b) => a - b), [users.admin.id, users.admin2.id, users.drift.id].sort((a, b) => a - b));
  const after = Object.fromEntries((await m.User.findAll()).map((u) => [u.name, u.role]));
  eq('users.role cache unchanged for every consistent user',
    Object.entries(before).filter(([k]) => k !== 'drift').filter(([k, u]) => after[u.name] !== u.role).map(([k]) => k), []);
  eq('nobody ended up without a role', Object.values(after).filter((r) => r === 'none'), []);
  const general = await settings.getGeneral();
  const viewersGroup = await m.GroupRole.findOne({ where: { system_role: 'viewer' } });
  eq('SSO default role -> default group', general.ssoDefaultGroupId, viewersGroup.group_id);

  await sequelize.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
