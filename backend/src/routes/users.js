const express = require('express');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');
const { User, PasskeyCredential, CustomRole, Group, GroupMember } = require('../models');
const {
  isBuiltinRole, groupForSystemRole, groupForCustomRole, assertAdminRemains, syncUserRoles, AccessError,
} = require('../services/accessService');
const { authenticate, requirePermission, hasRole } = require('../middleware/auth');
const { serverError, requestError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { validate: validatePassword } = require('../services/passwordPolicy');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

// Secrets that must never be sent to a client in any user payload.
const SENSITIVE_FIELDS = ['password_hash', 'totp_secret', 'totp_last_used', 'reset_password_token', 'reset_password_expires'];
const stripSensitive = (userJson) => {
  const out = { ...userJson };
  for (const f of SENSITIVE_FIELDS) delete out[f];
  return out;
};

router.get('/', authenticate, requirePermission('users','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    // Admins get the full directory (incl. security posture: passkeys, 2FA state,
    // groups) for user management. Every other role still needs a directory
    // for assignee pickers and @-mentions, but must not see security-posture data —
    // so they receive only the minimal, non-sensitive fields those features use.
    const admin = hasRole(req.user, 'admin');
    const query = admin
      ? {
          attributes: { exclude: SENSITIVE_FIELDS },
          include: [
            { model: PasskeyCredential, as: 'passkeys', attributes: ['id', 'name'] },
            { model: Group, as: 'groups', attributes: ['id', 'name', 'color'], through: { attributes: ['source'] } },
          ],
          order: [['name', 'ASC']],
        }
      : {
          attributes: ['id', 'name', 'email', 'role', 'department', 'active', 'avatar_url', 'last_seen_at'],
          order: [['name', 'ASC']],
        };
    const users = await User.findAll(query);
    if (!admin) return res.json(users);
    // Roles per user, derived from their groups — for display in the directory.
    const rows = await sequelize.query(
      `SELECT gm.user_id, COALESCE(gr.system_role::text, cr.base_role::text) AS base_role,
              gr.system_role::text AS system_role, cr.id AS custom_role_id, cr.name AS custom_role_name
         FROM group_members gm
         JOIN group_roles gr ON gr.group_id = gm.group_id
         LEFT JOIN custom_roles cr ON cr.id = gr.custom_role_id`,
      { type: QueryTypes.SELECT },
    );
    const rolesByUser = new Map();
    for (const r of rows) {
      if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, new Map());
      const key = r.system_role ? `s:${r.system_role}` : `c:${r.custom_role_id}`;
      rolesByUser.get(r.user_id).set(key, r.system_role
        ? { system_role: r.system_role }
        : { custom_role_id: r.custom_role_id, name: r.custom_role_name, base_role: r.base_role });
    }
    res.json(users.map((u) => {
      const json = u.toJSON();
      json.groups = (json.groups || []).map(({ GroupMember: link, ...g }) => ({ ...g, source: link?.source || 'manual' }));
      json.access_roles = [...(rolesByUser.get(u.id)?.values() || [])];
      return json;
    }));
  } catch (e) { serverError(res, e, 'users'); }
});

// Group ids for a create/update request. `group_ids` is the way since v3.8.0;
// the former `role` / `custom_role_id` are still accepted and mean "the group
// that carries this role" (created on demand), so existing scripts keep working.
const requestedGroupIds = async (body) => {
  if (Array.isArray(body.group_ids)) {
    const ids = [...new Set(body.group_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    const found = ids.length ? await Group.findAll({ where: { id: ids }, attributes: ['id'] }) : [];
    if (found.length !== ids.length) throw new AccessError('Unknown group in group_ids');
    return ids;
  }
  if (body.custom_role_id) {
    const cr = await CustomRole.findByPk(body.custom_role_id);
    if (!cr) throw new AccessError('Benutzerdefinierte Rolle nicht gefunden');
    return [(await groupForCustomRole(cr)).id];
  }
  if (body.role !== undefined && body.role !== null && body.role !== '') {
    if (!isBuiltinRole(body.role)) throw new AccessError(`Unknown role "${body.role}"`);
    return [(await groupForSystemRole(body.role)).id];
  }
  return undefined;
};

// Granting group memberships hands out roles: needs admin.roles.
const mayAssignGroups = async (req) => {
  const { decide } = require('../services/permissionService');
  return decide(req.user, 'admin', 'roles', ['admin']);
};

// Replaces the user's memberships with groupIds inside a transaction.
// Memberships granted by SSO stay as they are unless removed explicitly.
const setMemberships = async (userId, groupIds, transaction) => {
  const current = await GroupMember.findAll({ where: { user_id: userId }, transaction });
  const want = new Set(groupIds);
  for (const m of current) if (!want.has(m.group_id)) await m.destroy({ transaction });
  const have = new Set(current.map((m) => m.group_id));
  for (const gid of want) if (!have.has(gid)) await GroupMember.create({ group_id: gid, user_id: userId, source: 'manual' }, { transaction });
  return { added: [...want].filter((g) => !have.has(g)), removed: current.filter((m) => !want.has(m.group_id)).map((m) => m.group_id) };
};

router.post('/', authenticate, requirePermission('users','create','admin'), async (req, res) => {
  try {
    const { name, email, password, department } = req.body || {};
    const check = await validatePassword(password);
    if (!check.valid) return res.status(400).json({ error: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` });

    // Seit v3.0.0 haelt ein eindeutiger Index auf lower(email) die Anmeldeidentitaet
    // eindeutig. Ohne diese Vorabpruefung kaeme der Verstoss als roher
    // Datenbankfehler zurueck - der landet hier im error-Feld der Antwort und
    // damit in der Oberflaeche, samt Index- und Tabellennamen. Eine benannte
    // Meldung ist verstaendlicher und verraet nichts ueber das Schema.
    const normalisiert = String(email || '').trim().toLowerCase();
    if (!normalisiert) return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
    if (await User.findOne({ where: { email: normalisiert } })) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse wird bereits von einem Benutzer verwendet.' });
    }
    const groupIds = (await requestedGroupIds(req.body || {})) || [];
    if (groupIds.length && !(await mayAssignGroups(req))) return res.status(403).json({ error: 'Assigning groups requires the permission admin.roles' });
    const password_hash = await User.hashPassword(password);
    const user = await sequelize.transaction(async (t) => {
      const u = await User.create({ name, email, password_hash, role: 'none', department }, { transaction: t });
      await setMemberships(u.id, groupIds, t);
      return u;
    });
    await syncUserRoles([user.id]);
    await user.reload();
    const userData = stripSensitive(user.toJSON());
    await auditFromReq(req, 'create', 'user', user.id, user.name, { role: user.role, group_ids: groupIds, email: user.email });
    res.status(201).json(userData);
  } catch (e) {
    if (e instanceof AccessError) return res.status(e.status).json({ error: e.message });
    requestError(res, e, 'users');
  }
});

router.put('/:id', authenticate, requirePermission('users','edit','admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });

    const { name, email, department, active, password } = req.body || {};
    const groupIds = await requestedGroupIds(req.body || {});
    if (groupIds !== undefined && !(await mayAssignGroups(req))) {
      return res.status(403).json({ error: 'Assigning groups requires the permission admin.roles' });
    }

    // Prevent self-deactivation
    if (parseInt(req.params.id) === req.user.id && active === false) {
      return res.status(400).json({ error: 'Sie können Ihren eigenen Account nicht deaktivieren' });
    }

    if (password) {
      const check = await validatePassword(password);
      if (!check.valid) return res.status(400).json({ error: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` });
      req.body.password_hash = await User.hashPassword(password);
      await auditFromReq(req, 'change_password', 'user', user.id, user.name, { admin_reset: true });
    }
    const before = { name: user.name, role: user.role, active: user.active, email: user.email, department: user.department };
    let membership = null;
    await sequelize.transaction(async (t) => {
      await user.update({
        name, email, department, active,
        // Ein vom Admin gesetztes Passwort beendet wie jede andere Passwortaenderung
        // alle bestehenden Sitzungen des Kontos (middleware/auth.js vergleicht iat
        // mit password_changed_at). Vorher blieben sie bis zu 24 h gueltig — gerade
        // dann, wenn der Reset wegen eines kompromittierten Kontos erfolgt.
        ...(password ? { password_hash: req.body.password_hash, password_changed_at: new Date() } : {}),
      }, { transaction: t });
      if (groupIds !== undefined) membership = await setMemberships(user.id, groupIds, t);
      // Covers both: removing the last administrator's admin group and
      // deactivating the last administrator.
      if (groupIds !== undefined || active === false) await assertAdminRemains(t);
    });
    // An administrator must not take the administrator role away from themselves.
    if (membership && parseInt(req.params.id) === req.user.id) {
      const { findUserIdsWithRole } = require('../services/accessService');
      if (!(await findUserIdsWithRole('admin')).includes(req.user.id)) {
        // Undo: restore the previous memberships.
        await sequelize.transaction(async (t) => {
          for (const gid of membership.removed) await GroupMember.create({ group_id: gid, user_id: user.id, source: 'manual' }, { transaction: t });
          for (const gid of membership.added) await GroupMember.destroy({ where: { group_id: gid, user_id: user.id }, transaction: t });
        });
        await syncUserRoles([user.id]);
        return res.status(400).json({ error: 'Sie können Ihre eigene Administrator-Rolle nicht entziehen' });
      }
    }
    if (membership) await syncUserRoles([user.id]);
    await user.reload();

    const action = active === false ? 'deactivate' : 'update';
    await auditFromReq(req, action, 'user', user.id, user.name, {
      before,
      after: { name: user.name, role: user.role, active: user.active, email: user.email, department: user.department },
      ...(membership ? { groups_added: membership.added, groups_removed: membership.removed } : {}),
    });
    const userData = stripSensitive(user.toJSON());
    res.json(userData);
  } catch (e) {
    if (e instanceof AccessError) return res.status(e.status).json({ error: e.message });
    requestError(res, e, 'users');
  }
});

router.delete('/:id', authenticate, requirePermission('users','delete','admin'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Sie können Ihren eigenen Account nicht deaktivieren' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    try {
      await sequelize.transaction(async (t) => {
        await user.update({ active: false }, { transaction: t });
        await assertAdminRemains(t);
      });
    } catch (err) {
      if (err instanceof AccessError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    await auditFromReq(req, 'deactivate', 'user', user.id, user.name, {});
    res.json({ message: 'Benutzer deaktiviert' });
  } catch (e) { serverError(res, e, 'users'); }
});

module.exports = router;
