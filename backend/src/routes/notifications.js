const express = require('express');
const { Op } = require('sequelize');
const { Asset, Assessment, Reminder, Notification, User } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get all notifications (structured)
router.get('/', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().split('T')[0];

    // Mark stale reminders (background)
    Reminder.update(
      { status: 'overdue' },
      { where: { status: 'pending', due_date: { [Op.lt]: todayStr } } }
    ).catch(e => console.error(e));

    const [overdueRows, upcomingRows, activeAssets, userNotes] = await Promise.all([
      Reminder.findAll({
        where: { status: 'overdue', dismissed: { [Op.not]: true } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'], where: { status: 'active' } }],
        order: [['due_date', 'ASC']],
      }),
      Reminder.findAll({
        where: { status: 'pending', due_date: { [Op.between]: [todayStr, in30Str] }, dismissed: { [Op.not]: true } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'], where: { status: 'active' } }],
        order: [['due_date', 'ASC']],
      }),
      Asset.findAll({
        where: { status: 'active' },
        attributes: ['id', 'name', 'type', 'classification'],
        include: [{ model: Assessment, where: { is_current: true }, required: false, attributes: ['id'] }],
      }),
      Notification.findAll({
        where: { user_id: req.user.id, read: false },
        include: [{ model: User, as: 'actor', attributes: ['name'] }],
        order: [['created_at', 'DESC']],
        limit: 20
      })
    ]);

    const mapReminder = (type) => (r) => ({
      id: r.id,
      type,
      asset_id: r.asset_id,
      asset_name: r.Asset?.name || 'Unbekannt',
      type_label: r.Asset?.type,
      classification: r.Asset?.classification,
      due_date: r.due_date,
    });

    const overdue = overdueRows.map(mapReminder('overdue'));
    const upcoming = upcomingRows.map(mapReminder('upcoming'));
    const neverAssessed = activeAssets
      .filter(a => !a.Assessments || a.Assessments.length === 0)
      .map(a => ({
        type: 'never_assessed',
        asset_id: a.id,
        asset_name: a.name,
        type_label: a.type,
        classification: a.classification,
        due_date: null,
      }));

    res.json({
      overdue,
      upcoming,
      neverAssessed,
      mentions: userNotes,
      total: overdue.length + upcoming.length + neverAssessed.length + userNotes.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark mention as read
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await Notification.update({ read: true }, { where: { id: req.params.id, user_id: req.user.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
