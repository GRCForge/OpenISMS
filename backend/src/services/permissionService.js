const { getPermissions } = require('./settingsService');

// Resolving permissions happens on every guarded request, so the global matrix
// is cached briefly rather than hitting the settings table each time (the roles
// of a user are cached in services/accessService.js). Mirrors middleware/modules.js.
const CACHE_TTL_MS = 30 * 1000;
let globalCache = null;
let globalCacheAt = 0;

const getGlobalMatrix = async () => {
  const now = Date.now();
  if (globalCache && now - globalCacheAt < CACHE_TTL_MS) return globalCache;
  globalCache = await getPermissions();
  globalCacheAt = now;
  return globalCache;
};

const invalidatePermissionCache = () => {
  globalCache = null;
  require('./accessService').invalidateAccessCache();
};

// One role's view of the global matrix: { module: { action: boolean } }.
const projectGlobal = (global, role) => {
  const result = Object.create(null);
  for (const [module, actions] of Object.entries(global || {})) {
    if (!isSafeKey(module) || !actions || typeof actions !== 'object') continue;
    const projected = Object.create(null);
    for (const [action, roles] of Object.entries(actions)) {
      if (!isSafeKey(action)) continue;
      projected[action] = Array.isArray(roles) && roles.includes(role);
    }
    result[module] = projected;
  }
  return result;
};

// The permission set of one role (a grant, see services/accessService.js):
// a system role is its column of the global matrix; a custom role is its own
// set, or — without one — the column of its base role.
const matrixOfGrant = (global, grant) => {
  if (grant.system_role) return projectGlobal(global, grant.system_role);
  if (grant.permissions && typeof grant.permissions === 'object') return grant.permissions;
  return projectGlobal(global, grant.base_role);
};

const grantsOf = async (user) => {
  if (!user) return [];
  if (!Array.isArray(user.accessGrants)) await require('./accessService').attachAccess(user);
  return user.accessGrants || [];
};

// The decision for one module.action, role by role, allow-only:
//   - a role whose set says true allows
//   - a role whose set says nothing allows when its base role is among
//     fallbackRoles — the role list the route carried before the matrix existed,
//     so a module added after a custom role was written cannot lock it out
//   - nothing else allows; a user without roles is denied
const decide = async (user, module, action, fallbackRoles = []) => {
  const grants = await grantsOf(user);
  if (grants.length === 0) return false;
  const global = await getGlobalMatrix();
  const { baseRoleOf } = require('./accessService');
  for (const g of grants) {
    const entry = matrixOfGrant(global, g)?.[module]?.[action];
    if (entry === true) return true;
    if (entry === undefined && fallbackRoles.includes(baseRoleOf(g))) return true;
  }
  return false;
};

// The effective matrix of a user, merged across roles (true wins over false;
// actions no role defines are left out). For display — the UI hides what the
// user cannot do — and for /api/me/permissions. Access decisions use decide().
const resolvePermissions = async (user) => {
  const grants = await grantsOf(user);
  const global = await getGlobalMatrix();
  const merged = Object.create(null);
  for (const g of grants) {
    for (const [module, actions] of Object.entries(matrixOfGrant(global, g) || {})) {
      if (!isSafeKey(module) || !actions || typeof actions !== 'object') continue;
      if (!merged[module]) merged[module] = Object.create(null);
      for (const [action, value] of Object.entries(actions)) {
        if (!isSafeKey(action) || typeof value !== 'boolean') continue;
        merged[module][action] = merged[module][action] === true || value;
      }
    }
  }
  const out = {};
  for (const [m, a] of Object.entries(merged)) out[m] = { ...a };
  return out;
};

// true when a role allows, false when every role that speaks says no,
// undefined when no role defines module+action. Kept for callers that combine
// it with a role check of their own; new code should call decide().
const can = async (user, module, action) => {
  const grants = await grantsOf(user);
  const global = await getGlobalMatrix();
  let sawFalse = false;
  let sawUndefined = false;
  for (const g of grants) {
    const entry = matrixOfGrant(global, g)?.[module]?.[action];
    if (entry === true) return true;
    if (entry === false) sawFalse = true; else sawUndefined = true;
  }
  if (sawUndefined || !sawFalse) return undefined;
  return false;
};

// Module and action names are identifiers the admin UI picks from, never free
// text, so bounding them to that shape costs nothing. Without it a request body
// carrying __proto__ or constructor would have its key written straight into the
// accumulator and reach the prototype chain (CodeQL js/remote-property-injection).
const SAFE_KEY = /^[a-zA-Z0-9_-]{1,64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isSafeKey = (key) => typeof key === 'string' && SAFE_KEY.test(key) && !FORBIDDEN_KEYS.has(key);

// Reduce arbitrary client input to { module: { action: boolean } }. Anything that
// is not a boolean is dropped rather than coerced, so a malformed value becomes an
// absent entry — which falls through to the route's own check — instead of an
// accidental grant. Returns null for "no matrix of its own".
const sanitizeMatrix = (input) => {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('permissions muss ein Objekt sein');
  const out = Object.create(null);
  for (const [module, actions] of Object.entries(input)) {
    if (!isSafeKey(module)) continue;
    if (!actions || typeof actions !== 'object' || Array.isArray(actions)) continue;
    const cleaned = Object.create(null);
    for (const [action, value] of Object.entries(actions)) {
      if (!isSafeKey(action)) continue;
      if (typeof value === 'boolean') cleaned[action] = value;
    }
    if (Object.keys(cleaned).length) out[module] = { ...cleaned };
  }
  return Object.keys(out).length ? { ...out } : null;
};

module.exports = { resolvePermissions, can, decide, invalidatePermissionCache, sanitizeMatrix, projectGlobal, matrixOfGrant };
