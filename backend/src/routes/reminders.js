const express = require('express');
const { Reminder, Asset, Task } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

router.get('/', authenticate, requirePermission('reminders','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};
    const reminders = await Reminder.findAll({
      where,
      include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'] }],
      order: [['due_date', 'ASC']]
    });
    res.json(reminders);
  } catch (e) { serverError(res, e, 'reminders'); }
});

router.patch('/:id/acknowledge', authenticate, requirePermission('reminders','acknowledge','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const reminder = await Reminder.findByPk(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'Not found' });
    
    await reminder.update({ status: 'acknowledged', acknowledged_at: new Date(), acknowledged_by: req.user.id });
    
    // Auto-close associated task if exists
    if (reminder.task_id) {
      await Task.update({ status: 'done', completed_at: new Date() }, { where: { id: reminder.task_id } });
    }

    await auditFromReq(req, 'acknowledge', 'reminder', reminder.id, `Reminder #${reminder.id}`, {
      asset_id: reminder.asset_id, due_date: reminder.due_date,
    });
    res.json(reminder);
  } catch (e) { serverError(res, e, 'reminders'); }
});

router.patch('/:id/dismiss', authenticate, requirePermission('reminders','acknowledge','admin','owner','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const reminder = await Reminder.findByPk(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'Not found' });
    await reminder.update({ dismissed: true });
    res.json({ success: true });
  } catch (e) { serverError(res, e, 'reminders'); }
});

module.exports = router;
