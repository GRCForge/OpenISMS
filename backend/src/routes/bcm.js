const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { BcmProcess, BcmExercise, User } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

// ── Übungsprotokoll ──────────────────────────────────────────────
// Wichtig: vor den parametrischen /:id-Routen definiert.

router.get('/exercises', authenticate, async (req, res) => {
  try {
    const items = await BcmExercise.findAll({
      include: [{ model: BcmProcess, as: 'process', attributes: ['id', 'name', 'criticality'] }],
      order: [['exercise_date', 'DESC'], ['created_at', 'DESC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/exercises', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmExercise.create(req.body);
    await auditFromReq(req, 'create', 'bcm_exercise', item.id, item.title, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/exercises/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmExercise.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await item.update(req.body);
    await auditFromReq(req, 'update', 'bcm_exercise', item.id, item.title, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/exercises/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmExercise.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'bcm_exercise', item.id, item.title, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Prozessregister (BIA) ────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await BcmProcess.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['criticality', 'ASC'], ['name', 'ASC']],
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmProcess.create(req.body);
    await auditFromReq(req, 'create', 'bcm_process', item.id, item.name, {});
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmProcess.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await item.update(req.body);
    await auditFromReq(req, 'update', 'bcm_process', item.id, item.name, {});
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmProcess.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'bcm_process', item.id, item.name, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
