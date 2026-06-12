const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { Iso27001Control, Nis2Measure, BsiRequirement, C5Criterion } = require('../models');

// Lazy-load to avoid startup crash if catalog isn't generated yet
let catalog = null;
const getCatalog = () => {
  if (!catalog) {
    try { catalog = require('../services/controlMappings'); }
    catch { catalog = { lookup: () => [], stats: () => ({ total: 0, byPair: {} }) }; }
  }
  return catalog;
};

// Also load the raw catalogs for title resolution
let iso27001Catalog, nis2Catalog, bsiCatalog, c5Catalog;
const getTitleCatalogs = () => {
  if (!iso27001Catalog) {
    try { iso27001Catalog = require('../services/iso27001Catalog'); } catch { iso27001Catalog = []; }
    try { nis2Catalog = require('../services/nis2Catalog'); } catch { nis2Catalog = []; }
    try { bsiCatalog = require('../services/bsiCatalog'); } catch { bsiCatalog = []; }
    try { c5Catalog = require('../services/c5Catalog'); } catch { c5Catalog = []; }
  }
  return { iso27001Catalog, nis2Catalog, bsiCatalog, c5Catalog };
};

const resolveTitle = (framework, ref) => {
  const { iso27001Catalog, nis2Catalog, bsiCatalog, c5Catalog } = getTitleCatalogs();
  switch (framework) {
    case 'iso27001': return iso27001Catalog.find(x => x.ref === ref)?.title || ref;
    case 'nis2': return nis2Catalog.find(x => x.article_ref === ref)?.title || ref;
    case 'bsi_grundschutz': return bsiCatalog.find(x => x.req_id === ref)?.title || ref;
    case 'c5': return c5Catalog.find(x => x.criterion_id === ref)?.title || ref;
    default: return ref;
  }
};

// GET /api/mappings?framework=iso27001&ref=5.1
// Returns all related controls from other frameworks for a given control
router.get('/', authenticate, async (req, res) => {
  try {
    const { framework, ref } = req.query;
    if (!framework || !ref) return res.status(400).json({ error: 'framework und ref erforderlich' });
    const related = getCatalog().lookup(framework, String(ref));
    
    const [isoDb, nisDb, bsiDb, c5Db] = await Promise.all([
      Iso27001Control.findAll({ attributes: ['ref', 'implementation_status'] }).catch(() => []),
      Nis2Measure.findAll({ attributes: ['article_ref', 'implementation_status'] }).catch(() => []),
      BsiRequirement.findAll({ attributes: ['req_id', 'implementation_status'] }).catch(() => []),
      C5Criterion.findAll({ attributes: ['criterion_id', 'implementation_status'] }).catch(() => []),
    ]);

    const statusMap = {
      iso27001: new Map(isoDb.map(x => [x.ref, x.implementation_status])),
      nis2: new Map(nisDb.map(x => [x.article_ref, x.implementation_status])),
      bsi_grundschutz: new Map(bsiDb.map(x => [x.req_id, x.implementation_status])),
      c5: new Map(c5Db.map(x => [x.criterion_id, x.implementation_status])),
    };

    const enriched = related.map(m => ({
      framework: m.framework,
      ref: m.ref,
      type: m.type,
      title: resolveTitle(m.framework, m.ref),
      status: statusMap[m.framework]?.get(m.ref) || 'not_started',
    }));
    res.json({ framework, ref, related: enriched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/mappings/stats
// Returns mapping statistics
router.get('/stats', authenticate, (req, res) => {
  res.json(getCatalog().stats());
});

// GET /api/mappings/overview?source=iso27001
// Returns all controls of a framework with their mapping counts and implementation status
router.get('/overview', authenticate, async (req, res) => {
  const source = req.query.source || 'iso27001';
  const { iso27001Catalog, nis2Catalog, bsiCatalog, c5Catalog } = getTitleCatalogs();

  let items;
  switch (source) {
    case 'iso27001': items = iso27001Catalog.map(x => ({ ref: x.ref, title: x.title, theme: x.theme })); break;
    case 'nis2': items = nis2Catalog.map(x => ({ ref: x.article_ref, title: x.title, category: x.category })); break;
    case 'bsi_grundschutz': items = bsiCatalog.map(x => ({ ref: x.req_id, title: x.title, baustein: x.baustein_id })); break;
    case 'c5': items = c5Catalog.map(x => ({ ref: x.criterion_id, title: x.title, domain: x.domain })); break;
    default: return res.status(400).json({ error: 'Unbekanntes Framework' });
  }

  try {
    const [isoDb, nisDb, bsiDb, c5Db] = await Promise.all([
      Iso27001Control.findAll({ attributes: ['ref', 'implementation_status'] }).catch(() => []),
      Nis2Measure.findAll({ attributes: ['article_ref', 'implementation_status'] }).catch(() => []),
      BsiRequirement.findAll({ attributes: ['req_id', 'implementation_status'] }).catch(() => []),
      C5Criterion.findAll({ attributes: ['criterion_id', 'implementation_status'] }).catch(() => []),
    ]);

    const statusMap = {
      iso27001: new Map(isoDb.map(x => [x.ref, x.implementation_status])),
      nis2: new Map(nisDb.map(x => [x.article_ref, x.implementation_status])),
      bsi_grundschutz: new Map(bsiDb.map(x => [x.req_id, x.implementation_status])),
      c5: new Map(c5Db.map(x => [x.criterion_id, x.implementation_status])),
    };

    const result = items.map(item => {
      const related = getCatalog().lookup(source, item.ref);
      const byFw = {};
      for (const r of related) {
        if (!byFw[r.framework]) byFw[r.framework] = [];
        const targetStatus = statusMap[r.framework]?.get(r.ref) || 'not_started';
        byFw[r.framework].push({ 
          ref: r.ref, 
          type: r.type, 
          title: resolveTitle(r.framework, r.ref),
          status: targetStatus
        });
      }
      const itemStatus = statusMap[source]?.get(item.ref) || 'not_started';
      return { ...item, status: itemStatus, mappings: byFw, total_mappings: related.length };
    });

    res.json({ source, items: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
