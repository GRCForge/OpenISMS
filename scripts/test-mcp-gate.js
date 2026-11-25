#!/usr/bin/env node
'use strict';

/**
 * Verifies that MCP tool gating follows the same contract as the REST API's
 * requirePermission: each role of the user is asked and one that allows is
 * enough (allow-only union, since v3.8.0 roles come from groups). A role's
 * permission set decides where it says something, the tool's role list where it
 * does not, and a custom role's own set replaces its base role's column.
 *
 * Models and the settings service are mocked, so no database is needed.
 * Run: node scripts/test-mcp-gate.js
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'backend', 'src');

let matrix = {};
let customRoles = {};

Module._cache[require.resolve(path.join(SRC, 'models'))] = {
  id: 'models', loaded: true,
  exports: {
    CustomRole: { findAll: async () => Object.entries(customRoles).map(([id, p]) => ({ id: Number(id), permissions: p })) },
    Setting: { findByPk: async () => null },
  },
};
Module._cache[require.resolve(path.join(SRC, 'services/settingsService'))] = {
  id: 'settings', loaded: true,
  exports: { getPermissions: async () => matrix },
};

const { invalidatePermissionCache } = require(path.join(SRC, 'services/permissionService'));

// gateTool is module-private; lift it out of the source rather than exporting it
// just for the test (the export would be dead weight in production).
const src = fs.readFileSync(path.join(SRC, 'mcp/server.js'), 'utf8');
const start = src.indexOf('async function gateTool');
const end = src.indexOf('// ─── MCP Server', start);
if (start < 0 || end < 0) { console.error('gateTool im Quelltext nicht gefunden'); process.exit(1); }
const gateTool = new Function('require', 'console', src.slice(start, end) + '; return gateTool;')(
  (m) => require(m.startsWith('.') ? path.resolve(SRC, 'mcp', m) : m), console
);

let failures = 0;
const check = async (label, expected, ...args) => {
  const result = await gateTool(...args);
  const actual = result === null ? 'allow' : 'deny';
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label} → ${actual} (erwartet: ${expected})`);
};

(async () => {
  // Roles as attachAccess() hands them over: one grant per role of the user's groups.
  const sys = (...roles) => roles.map((r) => ({ system_role: r }));
  const withGrants = (id, grants) => {
    const { rolesOfGrants, primaryRole } = require(path.join(SRC, 'services/accessService'));
    const roles = rolesOfGrants(grants);
    return { id, role: primaryRole(roles), roles, accessGrants: grants };
  };
  const assessor = withGrants(5, sys('assessor'));
  const viewer = withGrants(6, sys('viewer'));
  const customGrant = () => ({ custom_role_id: 42, base_role: 'assessor', permissions: customRoles[42] });
  const customUser = () => withGrants(7, [customGrant()]);

  console.log('Matrix ist maßgeblich, wo sie etwas sagt:');
  matrix = { risks: { delete: ['admin'] } }; invalidatePermissionCache();
  await check('Matrix verbietet, Rollenliste würde erlauben', 'deny', assessor, null, ['admin', 'assessor'], true, ['risks', 'delete']);
  matrix = { risks: { delete: ['admin', 'assessor'] } }; invalidatePermissionCache();
  await check('Matrix erlaubt, Rollenliste würde verbieten', 'allow', assessor, null, ['admin'], true, ['risks', 'delete']);

  console.log('Wo die Matrix schweigt, entscheidet die Rollenliste:');
  matrix = {}; invalidatePermissionCache();
  await check('Rolle steht in der Fallback-Liste', 'allow', assessor, null, ['admin', 'assessor'], true, ['risks', 'delete']);
  await check('Rolle steht nicht in der Fallback-Liste', 'deny', assessor, null, ['admin'], true, ['risks', 'delete']);

  console.log('Schreibsperre gilt auch bei Matrix-Erlaubnis (wie requireWriteAccess):');
  matrix = { risks: { create: ['viewer'] } }; invalidatePermissionCache();
  await check('viewer mit Matrix-Erlaubnis, schreibendes Tool', 'deny', viewer, null, null, true, ['risks', 'create']);
  await check('viewer mit Matrix-Erlaubnis, lesendes Tool', 'allow', viewer, null, null, false, ['risks', 'create']);

  console.log('Custom Roles ersetzen die globale Matrix:');
  customRoles = { 42: { risks: { delete: false, view: true } } };
  matrix = { risks: { delete: ['admin', 'assessor'] } }; invalidatePermissionCache();
  await check('Custom Role verbietet, Basisrolle dürfte', 'deny', customUser(), null, ['admin', 'assessor'], true, ['risks', 'delete']);
  await check('Custom Role erlaubt', 'allow', customUser(), null, null, false, ['risks', 'view']);
  await check('Custom Role kennt die Aktion nicht → Fallback', 'allow', customUser(), null, ['assessor'], true, ['risks', 'create']);

  console.log('Mehrere Rollen über Gruppen — es genügt eine, die erlaubt:');
  matrix = { risks: { delete: ['admin', 'assessor'] } }; invalidatePermissionCache();
  await check('Custom Role verbietet, zweite Rolle (assessor) erlaubt', 'allow',
    withGrants(8, [customGrant(), ...sys('assessor')]), null, ['admin', 'assessor'], true, ['risks', 'delete']);
  matrix = { risks: { create: ['viewer', 'assessor'] } }; invalidatePermissionCache();
  await check('viewer + assessor: schreibendes Tool erlaubt', 'allow', withGrants(9, sys('viewer', 'assessor')), null, null, true, ['risks', 'create']);
  await check('viewer + management: weiterhin nur lesend', 'deny', withGrants(10, sys('viewer', 'management')), null, null, true, ['risks', 'create']);
  matrix = {}; invalidatePermissionCache();
  await check('Fallback greift über die zweite Rolle', 'allow', withGrants(11, sys('viewer', 'dpo')), null, ['dpo'], false, ['vvt', 'view']);
  await check('ohne Rolle (keine Gruppe mit Rolle) → deny', 'deny', withGrants(12, []), null, null, false, ['risks', 'view']);

  console.log('Tools ohne Matrix-Bindung verhalten sich unverändert:');
  matrix = { risks: { delete: ['niemand'] } }; invalidatePermissionCache();
  await check('keine perm-Bindung, Rolle passt', 'allow', assessor, null, ['assessor'], false, null);

  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
  process.exit(failures ? 1 : 0);
})();
