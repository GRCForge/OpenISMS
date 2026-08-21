const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { C5Criterion, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const catalog = require('../services/c5Catalog');

router.get('/', authenticate, requirePermission('c5','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const items = await C5Criterion.findAll({
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['domain', 'ASC'], ['criterion_id', 'ASC']],
    });
    res.json(items);
  } catch (e) { serverError(res, e, 'c5'); }
});

router.post('/seed', authenticate, requirePermission('c5','seed','admin','assessor'), async (req, res) => {
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const count = await C5Criterion.count();
    if (count > 0 && !force) return res.status(409).json({ error: 'Katalog bereits geladen. Verwende force=true zum Aktualisieren.' });
    if (force && count > 0) {
      // Update flags for existing criteria from catalog
      for (const entry of catalog) {
        await C5Criterion.update(
          { pqc_relevant: entry.pqc_relevant, cc_relevant: entry.cc_relevant, has_sharpen: entry.has_sharpen },
          { where: { criterion_id: entry.criterion_id } }
        );
      }
      await auditFromReq(req, 'reseed', 'c5_criterion', null, 'C5-Katalog', { count: catalog.length });
      return res.json({ ok: true, updated: catalog.length });
    }
    await C5Criterion.bulkCreate(catalog);
    await auditFromReq(req, 'seed', 'c5_criterion', null, 'C5-Katalog', { count: catalog.length });
    res.status(201).json({ ok: true, count: catalog.length });
  } catch (e) { serverError(res, e, 'c5'); }
});

router.put('/:id', authenticate, requirePermission('c5','edit','admin','assessor','it-staff'), async (req, res) => {
  try {
    const item = await C5Criterion.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { implementation_status, responsible_id, evidence, notes, last_review_date } = req.body;
    await item.update({ implementation_status, responsible_id, evidence, notes, last_review_date });
    await auditFromReq(req, 'update', 'c5_criterion', item.id, item.criterion_id, {});
    res.json(item);
  } catch (e) { serverError(res, e, 'c5'); }
});

router.delete('/:id', authenticate, requirePermission('c5','delete','admin','assessor'), async (req, res) => {
  try {
    const item = await C5Criterion.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    await auditFromReq(req, 'delete', 'c5_criterion', item.id, item.criterion_id, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'c5'); }
});

module.exports = router;
