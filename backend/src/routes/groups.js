const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Group, GroupMember, User } = require('../models');
const { authenticate, requireWriteAccess, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.use(authenticate);

const groupInclude = [
  { model: User, as: 'members', attributes: ['id', 'name', 'email', 'role'], through: { attributes: [] } },
];

// List all groups
router.get('/', async (req, res) => {
  try {
    const groups = await Group.findAll({ include: groupInclude, order: [['name', 'ASC']] });
    res.json(groups);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single group
router.get('/:id', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id, { include: groupInclude });
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(group);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create group (admin only)
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
    const group = await Group.create({ name: name.trim(), description, color: color || '#3b82f6', created_by_id: req.user.id });
    await auditFromReq(req, 'create', 'group', group.id, group.name, { description: group.description });
    const full = await Group.findByPk(group.id, { include: groupInclude });
    res.status(201).json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Update group (admin only)
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    const { name, description, color } = req.body;
    await group.update({ name: name?.trim() || group.name, description, color });
    await auditFromReq(req, 'update', 'group', group.id, group.name, {});
    const full = await Group.findByPk(group.id, { include: groupInclude });
    res.json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Delete group (admin only)
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    const name = group.name;
    await group.destroy();
    await auditFromReq(req, 'delete', 'group', req.params.id, name, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add member to group (admin only)
router.post('/:id/members', requireRole('admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group) return res.status(404).json({ error: 'Nicht gefunden' });
    const { user_id } = req.body;
    const user = await User.findByPk(user_id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    const [, created] = await GroupMember.findOrCreate({ where: { group_id: group.id, user_id } });
    if (!created) return res.status(409).json({ error: 'Bereits Mitglied' });
    const full = await Group.findByPk(group.id, { include: groupInclude });
    res.status(201).json(full);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Remove member from group (admin only)
router.delete('/:id/members/:userId', requireRole('admin'), async (req, res) => {
  try {
    const deleted = await GroupMember.destroy({ where: { group_id: req.params.id, user_id: req.params.userId } });
    if (!deleted) return res.status(404).json({ error: 'Mitglied nicht gefunden' });
    const full = await Group.findByPk(req.params.id, { include: groupInclude });
    res.json(full);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
