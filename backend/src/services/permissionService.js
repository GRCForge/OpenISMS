const { CustomRole } = require('../models');
const { getPermissions } = require('./settingsService');

// Resolving permissions happens on every guarded request, so both the global
// matrix and the custom-role matrices are cached briefly rather than hitting the
// settings and custom_roles tables each time. Mirrors middleware/modules.js.
const CACHE_TTL_MS = 30 * 1000;
let globalCache = null;
let globalCacheAt = 0;
let roleCache = null;
let roleCacheAt = 0;

const getGlobalMatrix = async () => {
  const now = Date.now();
  if (globalCache && now - globalCacheAt < CACHE_TTL_MS) return globalCache;
  globalCache = await getPermissions();
  globalCacheAt = now;
  return globalCache;
};

const getCustomRoleMatrices = async () => {
  const now = Date.now();
  if (roleCache && now - roleCacheAt < CACHE_TTL_MS) return roleCache;
  const roles = await CustomRole.findAll({ attributes: ['id', 'permissions'] });
  roleCache = Object.fromEntries(roles.map(r => [r.id, r.permissions || null]));
  roleCacheAt = now;
  return roleCache;
};

const invalidatePermissionCache = () => {
  globalCache = null;
  roleCache = null;
};

// The effective matrix for a user, normalised to { module: { action: boolean } }.
// A custom role with its own matrix replaces the global one outright — the admin
// chose to define that role fully. Without one, the global matrix is projected
// through the user's role, which is the custom role's base_role when assigned.
const resolvePermissions = async (user) => {
  if (!user) return {};
  if (user.custom_role_id) {
    const matrices = await getCustomRoleMatrices();
    const own = matrices[user.custom_role_id];
    if (own && typeof own === 'object') return own;
  }
  const global = await getGlobalMatrix();
  const result = {};
  for (const [module, actions] of Object.entries(global)) {
    result[module] = {};
    for (const [action, roles] of Object.entries(actions)) {
      result[module][action] = Array.isArray(roles) && roles.includes(user.role);
    }
  }
  return result;
};

// true / false when the matrix decides, undefined when it says nothing about this
// module+action. Callers must treat undefined as "not my call" and fall back to
// whatever check the route already had, so an entry missing from a custom role's
// matrix cannot silently deny access to a module added after the role was written.
const can = async (user, module, action) => {
  const matrix = await resolvePermissions(user);
  const entry = matrix?.[module]?.[action];
  return typeof entry === 'boolean' ? entry : undefined;
};

// Reduce arbitrary client input to { module: { action: boolean } }. Anything that
// is not a boolean is dropped rather than coerced, so a malformed value becomes an
// absent entry — which falls through to the route's own check — instead of an
// accidental grant. Returns null for "no matrix of its own".
const sanitizeMatrix = (input) => {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('permissions muss ein Objekt sein');
  const out = {};
  for (const [module, actions] of Object.entries(input)) {
    if (!actions || typeof actions !== 'object' || Array.isArray(actions)) continue;
    const cleaned = {};
    for (const [action, value] of Object.entries(actions)) {
      if (typeof value === 'boolean') cleaned[action] = value;
    }
    if (Object.keys(cleaned).length) out[module] = cleaned;
  }
  return Object.keys(out).length ? out : null;
};

module.exports = { resolvePermissions, can, invalidatePermissionCache, sanitizeMatrix };
