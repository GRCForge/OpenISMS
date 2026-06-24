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
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.post('/exercises', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const { process_id, title, exercise_type, exercise_date, participants, result, findings, actions, notes } = req.body;
    const item = await BcmExercise.create({ process_id, title, exercise_type, exercise_date, participants, result, findings, actions, notes });
    await auditFromReq(req, 'create', 'bcm_exercise', item.id, item.title, {});
    res.status(201).json(item);
  } catch (e) { console.error('[BCM] POST /exercises', e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.put('/exercises/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmExercise.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { process_id, title, exercise_type, exercise_date, participants, result, findings, actions, notes } = req.body;
    await item.update({ process_id, title, exercise_type, exercise_date, participants, result, findings, actions, notes });
    await auditFromReq(req, 'update', 'bcm_exercise', item.id, item.title, {});
    res.json(item);
  } catch (e) { console.error('[BCM] PUT /exercises/:id', e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.delete('/exercises/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmExercise.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'bcm_exercise', item.id, item.title, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

// ── Prozessregister (BIA) ────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const items = await BcmProcess.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['criticality', 'ASC'], ['name', 'ASC']],
    });
    res.json(items);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.post('/', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const { name, description, criticality, rto_hours, rpo_hours, owner_id, dependencies, recovery_strategy, status, last_test_date, next_test_date, notes } = req.body;
    const item = await BcmProcess.create({ name, description, criticality, rto_hours, rpo_hours, owner_id, dependencies, recovery_strategy, status, last_test_date, next_test_date, notes });
    await auditFromReq(req, 'create', 'bcm_process', item.id, item.name, {});
    res.status(201).json(item);
  } catch (e) { console.error('[BCM] POST /', e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.put('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmProcess.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { name, description, criticality, rto_hours, rpo_hours, owner_id, dependencies, recovery_strategy, status, last_test_date, next_test_date, notes } = req.body;
    await item.update({ name, description, criticality, rto_hours, rpo_hours, owner_id, dependencies, recovery_strategy, status, last_test_date, next_test_date, notes });
    await auditFromReq(req, 'update', 'bcm_process', item.id, item.name, {});
    res.json(item);
  } catch (e) { console.error('[BCM] PUT /:id', e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

router.delete('/:id', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const item = await BcmProcess.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'bcm_process', item.id, item.name, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Interner Serverfehler' }); }
});

module.exports = router;
