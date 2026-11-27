#!/usr/bin/env node
'use strict';

/**
 * Integration test against a THROWAWAY Postgres database: migration to
 * group-based access (v3.10.0).
 *
 *   1. Data as in v3.7.0 (one role per user, a custom role, an existing team
 *      named like a role group, OIDC mappings by role and by custom role, SSO
 *      default role) -> ensureGroupBasedAccess keeps every user's roles, moves
 *      mappings and the SSO default to groups, leaves the team without roles,
 *      and is idempotent.
 *   2. Grant guards: last administrator, syncUserRoles, findUserIdsWithRole on
 *      the real SQL.
 *
 * Runs only with GROUP_ACCESS_TEST_DB=1 and DB_* / DATABASE_URL pointing at an
 * empty test database — schema public is dropped:
 *
 *   GROUP_ACCESS_TEST_DB=1 DATABASE_URL=postgres://u:p@localhost/openisms_test \
 *   JWT_SECRET=x node scripts/test-group-access-db.js
 */

if (process.env.GROUP_ACCESS_TEST_DB !== '1') {
  console.log('Skipped (set GROUP_ACCESS_TEST_DB=1 and DB_* for a throwaway database).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await p; return 'ok'; } catch (e) { return e.status || e.name; } };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const access = require(path.join(SRC, 'services', 'accessService'));
  const { ensureGroupBasedAccess } = require(path.join(SRC, 'services', 'accessMigration'));
  const settings = require(path.join(SRC, 'services', 'settingsService'));
  await m.sequelize.sync();

  // 1. Data as in v3.7.0.
  const mk = (name, role, extra = {}) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role, ...extra });
  const auditor = await m.CustomRole.create({ name: 'Auditor', base_role: 'assessor', permissions: { incidents: { view: false } } });
  const unused = await m.CustomRole.create({ name: 'Unused', base_role: 'viewer' });
  const users = {
    admin: await mk('admin', 'admin'),
    admin2: await mk('admin2', 'admin', { active: false }),
    assessor: await mk('assessor', 'assessor'),
    dpo: await mk('dpo', 'dpo'),
    it: await mk('it', 'it-staff'),
    viewer: await mk('viewer', 'viewer'),
    audit: await mk('audit', 'viewer', { custom_role_id: auditor.id }), // custom role wins
  };
  const team = await m.Group.create({ name: 'Administrators', description: 'existing task team' });
  await m.GroupMember.create({ group_id: team.id, user_id: users.viewer.id });
  const mapRole = await m.OidcClaimMapping.create({ claim_path: 'groups', claim_value: 'isms-admins', role: 'admin', priority: 10 });
  const mapCustom = await m.OidcClaimMapping.create({ claim_path: 'groups', claim_value: 'isms-audit', custom_role_id: auditor.id, priority: 5 });
  await settings.setGeneral({ ssoDefaultRole: 'employee', ssoAutoProvision: true });
  const rolesBefore = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.role]));

  console.log('Migration:');
  const counts = await ensureGroupBasedAccess({ log: { log: () => {} } });
  eq('groups created: 5 roles in use + Auditor + Employees (SSO default)', counts.groups, 7);
  eq('every user joined one role group', counts.memberships, 7);
  eq('both SSO mappings moved', counts.mappings, 2);

  const rolesOf = async (u) => (await access.attachAccess({ id: u.id })).roles;
  access.invalidateAccessCache();
  for (const [k, u] of Object.entries(users)) {
    const want = k === 'audit' ? ['assessor'] : [rolesBefore[k]];
    eq(`${k}: roles unchanged`, await rolesOf(u), want);
  }
  const auditGrants = (await access.attachAccess({ id: users.audit.id })).accessGrants;
  eq('audit: the custom role (with its own permissions), not the column role', auditGrants.map((g) => [g.custom_role_id, g.permissions]), [[auditor.id, { incidents: { view: false } }]]);

  const groups = await m.Group.findAll({ include: [{ model: m.GroupRole, as: 'groupRoles' }], order: [['id', 'ASC']] });
  const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
  eq('existing team kept, carries no roles', byName.Administrators.groupRoles.length, 0);
  eq('admin role group named around the team', !!byName['Administrators (2)'], true);
  eq('custom role group', byName['Role: Auditor'].groupRoles.map((r) => r.custom_role_id), [auditor.id]);
  eq('unused custom role gets no group', groups.some((g) => g.name === `Role: ${unused.name}`), false);

  await mapRole.reload(); await mapCustom.reload();
  eq('role mapping -> admin group', mapRole.group_id, byName['Administrators (2)'].id);
  eq('custom mapping -> Auditor group', mapCustom.group_id, byName['Role: Auditor'].id);
  const general = await settings.getGeneral();
  eq('SSO default role -> default group', general.ssoDefaultGroupId, byName.Employees.id);

  const model = await access.getAccessModel();
  eq('access_model recorded', [model.version, Object.keys(model.roleGroups).sort()], [1, ['admin', 'assessor', 'dpo', 'employee', 'it-staff', 'viewer']]);

  const again = await ensureGroupBasedAccess({ log: { log: () => {} } });
  eq('second run does nothing', again, { skipped: true });
  eq('no extra groups', await m.Group.count(), groups.length);

  console.log('\nGuards on the real SQL:');
  eq('active admins only', await access.findUserIdsWithRole('admin'), [users.admin.id]);
  eq('with inactive', (await access.findUserIdsWithRole('admin', { activeOnly: false })).sort(), [users.admin.id, users.admin2.id].sort());
  eq('custom role counts through its base role', (await access.findUserIdsWithRole('assessor')).sort(), [users.assessor.id, users.audit.id].sort());

  const adminGroup = byName['Administrators (2)'];
  const t = await sequelize.transaction();
  await m.GroupMember.destroy({ where: { group_id: adminGroup.id, user_id: users.admin.id }, transaction: t });
  eq('removing the last active admin -> 409', await status(access.assertAdminRemains(t)), 409);
  await t.rollback();
  eq('rolled back, admin still there', await access.findUserIdsWithRole('admin'), [users.admin.id]);

  // Multi-role: viewer joins Assessors; cache column shows the stronger role.
  await m.GroupMember.create({ group_id: byName.Assessors.id, user_id: users.viewer.id });
  await access.syncUserRoles([users.viewer.id]);
  await users.viewer.reload();
  eq('cache column = most privileged role', users.viewer.role, 'assessor');
  access.invalidateAccessCache();
  eq('roles combine', await rolesOf(users.viewer), ['assessor', 'viewer']);

  // Leaving every role group -> 'none'.
  await m.GroupMember.destroy({ where: { user_id: users.it.id } });
  await access.syncUserRoles([users.it.id]);
  await users.it.reload();
  eq('no group -> role none', users.it.role, 'none');

  await sequelize.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
