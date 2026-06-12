const express = require('express');
const { User, PasskeyCredential, CustomRole } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { validate: validatePassword } = require('../services/passwordPolicy');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password_hash'] },
      include: [
        { model: PasskeyCredential, as: 'passkeys', attributes: ['id', 'name'] },
        { model: CustomRole, as: 'customRole', attributes: ['id', 'name', 'base_role'] },
      ],
      order: [['name', 'ASC']]
    });
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, role, department, custom_role_id } = req.body;
    const check = await validatePassword(password);
    if (!check.valid) return res.status(400).json({ error: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` });
    const password_hash = await User.hashPassword(password);
    // Eine benutzerdefinierte Rolle pinnt die effektive Rolle auf ihre Basisrolle.
    let effectiveRole = role;
    let customRoleId = null;
    if (custom_role_id) {
      const cr = await CustomRole.findByPk(custom_role_id);
      if (!cr) return res.status(400).json({ error: 'Benutzerdefinierte Rolle nicht gefunden' });
      effectiveRole = cr.base_role;
      customRoleId = cr.id;
    }
    const user = await User.create({ name, email, password_hash, role: effectiveRole, department, custom_role_id: customRoleId });
    const { password_hash: _, ...userData } = user.toJSON();
    await auditFromReq(req, 'create', 'user', user.id, user.name, { role: user.role, custom_role_id: customRoleId, email: user.email });
    res.status(201).json(userData);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    
    const { name, email, role, department, active, password, custom_role_id } = req.body;

    // Rollen-Auflösung: Eine benutzerdefinierte Rolle hat Vorrang und pinnt die
    // effektive Rolle auf ihre Basisrolle; das Setzen einer Standardrolle entfernt sie.
    let resolvedRole;     // undefined => Rolle unverändert lassen
    let resolvedCustomId; // undefined => custom_role_id unverändert lassen
    if (custom_role_id) {
      const cr = await CustomRole.findByPk(custom_role_id);
      if (!cr) return res.status(400).json({ error: 'Benutzerdefinierte Rolle nicht gefunden' });
      resolvedRole = cr.base_role;
      resolvedCustomId = cr.id;
    } else if (custom_role_id === null || custom_role_id === '') {
      resolvedCustomId = null;
      if (role !== undefined) resolvedRole = role;
    } else if (role !== undefined) {
      resolvedRole = role;
      resolvedCustomId = null;
    }

    // Prevent self-deactivation or self-demotion
    if (parseInt(req.params.id) === req.user.id) {
      if (active === false) return res.status(400).json({ error: 'Sie können Ihren eigenen Account nicht deaktivieren' });
      const finalRole = resolvedRole !== undefined ? resolvedRole : user.role;
      if (finalRole !== 'admin') return res.status(400).json({ error: 'Sie können Ihre eigene Administrator-Rolle nicht entziehen' });
    }

    if (password) {
      const check = await validatePassword(password);
      if (!check.valid) return res.status(400).json({ error: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` });
      req.body.password_hash = await User.hashPassword(password);
      await auditFromReq(req, 'change_password', 'user', user.id, user.name, { admin_reset: true });
    }
    const before = { name: user.name, role: user.role, custom_role_id: user.custom_role_id, active: user.active, email: user.email, department: user.department };
    await user.update({
      name, email, department, active,
      ...(resolvedRole !== undefined ? { role: resolvedRole } : {}),
      ...(resolvedCustomId !== undefined ? { custom_role_id: resolvedCustomId } : {}),
      ...(password ? { password_hash: req.body.password_hash } : {}),
    });

    const action = active === false ? 'deactivate' : 'update';
    await auditFromReq(req, action, 'user', user.id, user.name, {
      before,
      after: { name: user.name, role: user.role, custom_role_id: user.custom_role_id, active: user.active, email: user.email, department: user.department },
    });
    const { password_hash: _, ...userData } = user.toJSON();
    res.json(userData);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Sie können Ihren eigenen Account nicht deaktivieren' });
    }
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    await user.update({ active: false });
    await auditFromReq(req, 'deactivate', 'user', user.id, user.name, {});
    res.json({ message: 'Benutzer deaktiviert' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
