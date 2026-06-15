const express = require('express');
const { Op } = require('sequelize');
const { 
  sequelize, Asset, User, Assessment, Reminder, Vendor, VendorContact, 
  Policy, PolicyVersion, VvtEntry, Incident, Risk 
} = require('../models');
const { authenticate, requireRole, requireWriteAccess, isAssessor, isItStaff, isAdmin } = require('../middleware/auth');
const { requireModule } = require('../middleware/modules');
const { auditFromReq } = require('../services/auditService');
const { notify } = require('../services/notifyService');
const { checkAndManageAssetTasks } = require('../services/taskAutomationService');
const { fetchCVEsForAsset, resolveCPEForAsset, suggestCPEsForAsset } = require('../services/cveService');
const { escapeLike } = require('../utils/sqlUtils');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

// Inform active DPOs about DPIA requirements
const notifyDpos = async (asset, actorId) => {
  const dpos = await User.findAll({ where: { role: 'dpo', active: true }, attributes: ['id'] });
  for (const d of dpos) {
    await notify({
      userId: d.id, actorId, type: 'assignment',
      title: 'Datenschutz-Prüfung erforderlich',
      content: `Für das Asset „${asset.name}" ist eine Datenschutz-Folgenabschätzung (DSFA) erforderlich.`,
      link: `/assets/${asset.id}`,
    });
  }
};

router.get('/', authenticate, async (req, res) => {
  try {
    const { type, classification, status, lifecycle_status, search } = req.query;
    const where = {};
    if (type) where.type = type;
    if (classification) where.classification = classification;
    if (lifecycle_status) where.lifecycle_status = lifecycle_status;
    if (status) {
      if (status !== 'all') where.status = status;
    } else {
      where.status = { [Op.ne]: 'decommissioned' };
    }
    if (search) where.name = { [Op.like]: `%${escapeLike(search)}%` };

    const assets = await Asset.findAll({
      where,
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'department'] },
        { model: User, as: 'assessor', attributes: ['id', 'name', 'email'] },
        { model: Assessment, where: { is_current: true }, required: false, limit: 1, order: [['assessed_at', 'DESC']] },
        { model: Reminder, where: { status: ['pending', 'overdue'] }, required: false, limit: 1 },
        { model: Vendor, as: 'vendorContact', required: false },
      ],
      order: [['name', 'ASC']]
    });
    res.json(assets);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aggregated CVEs across all assets
router.get('/cves', authenticate, requireModule('discovery'), async (req, res) => {
  try {
    const assets = await Asset.findAll({
      attributes: ['id', 'name', 'cve_ids'],
      where: {
        status: { [Op.ne]: 'decommissioned' }
      }
    });

    const cveMap = {};
    for (const asset of assets) {
      let cves = [];
      if (asset.cve_ids) {
        try {
          cves = typeof asset.cve_ids === 'string' ? JSON.parse(asset.cve_ids) : asset.cve_ids;
        } catch (e) {
          cves = [];
        }
      }
      if (Array.isArray(cves)) {
        for (const cve of cves) {
          if (!cve.id) continue;
          if (!cveMap[cve.id]) {
            cveMap[cve.id] = {
              id: cve.id,
              score: Number(cve.score) || 0,
              severity: cve.severity || 'none',
              description: cve.description || '',
              published: cve.published || '',
              source: cve.source || '',
              assets: []
            };
          }
          // Avoid duplicate assets if somehow listed multiple times
          if (!cveMap[cve.id].assets.some(a => a.id === asset.id)) {
            cveMap[cve.id].assets.push({ id: asset.id, name: asset.name });
          }
        }
      }
    }

    const cveList = Object.values(cveMap);
    // Sort by CVSS score descending
    cveList.sort((a, b) => b.score - a.score);

    res.json(cveList);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all distinct location strings from assets table
router.get('/locations', authenticate, async (req, res) => {
  try {
    const locations = await Asset.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('location')), 'location']],
      where: {
        location: {
          [Op.ne]: null,
          [Op.ne]: ''
        }
      },
      order: [['location', 'ASC']]
    });
    res.json(locations.map(l => l.getDataValue('location')));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const asset = await Asset.findByPk(req.params.id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email', 'department', 'last_seen_at'] },
        { model: User, as: 'assessor', attributes: ['id', 'name', 'email', 'department'] },
        { model: Assessment, include: [{ model: User, as: 'assessorUser', attributes: ['id', 'name'] }], order: [['assessed_at', 'DESC']] },
        { model: Reminder, order: [['due_date', 'DESC']] },
        { model: Vendor, as: 'vendorContact', required: false, include: [{ model: VendorContact, as: 'contacts' }] },
        { 
          model: Policy, as: 'policies', 
          through: { attributes: [] },
          include: [{ model: PolicyVersion, as: 'history', attributes: ['id', 'version', 'created_at'] }]
        },
        { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
        { model: Incident, as: 'incidents', through: { attributes: [] } },
        { model: Risk, as: 'risks', through: { attributes: [] } },
      ]
    });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (e) {
    console.error('ERROR IN GET ASSET:', e);
    res.status(500).json({ error: e.message }); 
  }
});

router.post('/', authenticate, requireRole('admin', 'assessor', 'it-staff', 'dpo'), async (req, res) => {
  try {
    const data = { ...req.body };
    ['owner_id', 'assessor_id', 'vendor_id', 'parent_id'].forEach(f => {
      if (data[f] === '') data[f] = null;
    });
    ['eol_date', 'last_restore_test'].forEach(f => {
      if (data[f] === '' || data[f] === 'Invalid date') data[f] = null;
    });

    if (data.lifecycle_status === 'archived') data.status = 'inactive';

    const asset = await Asset.create(data);
    if (Array.isArray(req.body.vvt_ids)) await asset.setVvtEntries(req.body.vvt_ids);
    
    await auditFromReq(req, 'create', 'asset', asset.id, asset.name, {
      type: asset.type, classification: asset.classification,
      owner_id: asset.owner_id, assessor_id: asset.assessor_id,
    });
    
    if (asset.assessor_id) {
      await notify({
        userId: asset.assessor_id, actorId: req.user.id, type: 'assignment',
        title: 'Risikobewertung zugewiesen',
        content: `Sie wurden als Bewerter für das Asset „${asset.name}" zugewiesen.`,
        link: `/assets/${asset.id}`,
      });
    }
    if (asset.dsfa_required) await notifyDpos(asset, req.user.id);
    res.status(201).json(asset);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    
    const { isDpo } = require('../middleware/auth');
    const canEdit = isAssessor(req) || isItStaff(req) || isDpo(req) || req.user.id === asset.owner_id || req.user.id === asset.assessor_id || isAdmin(req);
    if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

    const data = { ...req.body };
    ['owner_id', 'assessor_id', 'vendor_id', 'parent_id'].forEach(f => {
      if (data[f] === '') data[f] = null;
    });
    ['eol_date', 'last_restore_test'].forEach(f => {
      if (data[f] === '' || data[f] === 'Invalid date') data[f] = null;
    });

    if (!isAssessor(req) && !isDpo(req) && !isAdmin(req)) {
      const protectedFields = ['classification', 'nis2_relevant', 'rto', 'rpo'];
      const changed = protectedFields.filter(f => data[f] !== undefined && String(data[f]) !== String(asset[f]));
      if (changed.length > 0) {
        return res.status(403).json({ error: `Ihre Rolle darf folgende geschützte Felder nicht ändern: ${changed.join(', ')}` });
      }
    }

    if (data.lifecycle_status === 'archived') {
      data.status = 'inactive';
    } else if (['production', 'maintenance', 'evaluation'].includes(data.lifecycle_status)) {
      if (asset.status === 'inactive') data.status = 'active';
    }

    const fields = [
      'name', 'type', 'classification', 'status', 'lifecycle_status', 'hosting_type', 'location',
      'owner_id', 'assessor_id', 'vendor_id', 'parent_id', 'version', 'vendor', 
      'description', 'frameworks', 'nis2_relevant', 'rto', 'rpo', 'sdo', 'mto', 'ioa', 'patch_status', 
      'eol_date', 'backup_plan', 'last_restore_test', 'hardening_status', 'dsfa_required',
      'data_category', 'vvt_status'
    ];
    
    const before = {};
    fields.forEach(f => before[f] = asset[f]);
    const prevDsfa = asset.dsfa_required;
    
    await asset.update(data);
    if (Array.isArray(req.body.vvt_ids)) await asset.setVvtEntries(req.body.vvt_ids);
    
    const after = {};
    fields.forEach(f => after[f] = asset[f]);
    await auditFromReq(req, 'update', 'asset', asset.id, asset.name, { before, after });

    if (asset.assessor_id && String(before.assessor_id) !== String(asset.assessor_id)) {
      await notify({
        userId: asset.assessor_id, actorId: req.user.id, type: 'assignment',
        title: 'Risikobewertung zugewiesen',
        content: `Sie wurden als Bewerter für das Asset „${asset.name}" zugewiesen.`,
        link: `/assets/${asset.id}`,
      });
    }
    if (asset.dsfa_required && !prevDsfa) await notifyDpos(asset, req.user.id);
    
    // Auto-manage tasks
    await checkAndManageAssetTasks(asset);

    res.json(asset);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Only admins can decommission assets' });
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    await asset.update({ status: 'decommissioned' });
    await checkAndManageAssetTasks(asset);
    await auditFromReq(req, 'delete', 'asset', asset.id, asset.name, {});
    res.json({ message: 'Asset decommissioned' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bulk-delete', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Only admins can decommission assets' });
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Ungültige IDs' });
    }
    const assets = await Asset.findAll({ where: { id: ids } });
    if (assets.length === 0) {
      return res.status(404).json({ error: 'Keine Assets gefunden' });
    }
    for (const asset of assets) {
      await asset.update({ status: 'decommissioned' });
      await checkAndManageAssetTasks(asset);
      await auditFromReq(req, 'delete', 'asset', asset.id, asset.name, {});
    }
    res.json({ message: `${assets.length} Assets außer Betrieb gesetzt` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Suggest CPEs: returns top-10 matches from NVD for user selection (no save)
router.post('/:id/cpe-suggestions', authenticate, requireModule('discovery'), requireRole('admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });
    const query = req.body?.query;
    let suggestions;
    if (query && String(query).trim().length >= 3) {
      suggestions = await suggestCPEsForAsset({ name: String(query).trim(), vendor: null });
    } else {
      suggestions = await suggestCPEsForAsset(asset);
    }
    res.json({ suggestions });
  } catch (e) {
    console.error('[CVE] CPE suggestions failed for asset', req.params.id + ':', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Save a CPE — either auto-resolved (best match) or user-selected from suggestions
router.post('/:id/resolve-cpe', authenticate, requireModule('discovery'), requireRole('admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });

    // If the client sends a pre-selected CPE (from the suggestion picker), save it directly.
    if (req.body?.cpe && req.body?.title) {
      const cpe   = String(req.body.cpe).trim();
      const title = String(req.body.title).trim();
      if (!cpe.startsWith('cpe:2.3:')) return res.status(400).json({ error: 'Ungültiges CPE-Format.' });
      await asset.update({ cpe, cpe_title: title, cpe_resolved_at: new Date() });
      return res.json({ found: true, cpe, title });
    }

    // Otherwise run auto-resolution against NVD (with cooldown).
    if (asset.cpe_resolved_at && Date.now() - new Date(asset.cpe_resolved_at).getTime() < 5 * 60 * 1000) {
      return res.json({ found: false, cooldown: true, message: 'CPE-Auflösung erst nach 5 Minuten wieder möglich.' });
    }

    const result = await resolveCPEForAsset(asset);
    if (!result) return res.json({ found: false, message: 'Kein CPE-Eintrag in NVD gefunden. Bitte Hersteller/Name prüfen oder CPE manuell eingeben.' });

    await asset.update({ cpe: result.cpe, cpe_title: result.title, cpe_resolved_at: new Date() });
    res.json({ found: true, cpe: result.cpe, title: result.title });
  } catch (e) {
    console.error('[CVE] CPE resolve failed for asset', req.params.id + ':', e.message);
    res.status(500).json({ error: e.message });
  }
});

// CVE refresh: query NVD / Shodan CVEDB for the given asset
router.post('/:id/refresh-cves', authenticate, requireModule('discovery'), requireRole('admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const asset = await Asset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });

    if (asset.cve_last_checked && Date.now() - new Date(asset.cve_last_checked).getTime() < 60 * 1000) {
      return res.json({ skipped: true, cooldown: true, reason: 'CVE-Aktualisierung erst nach 1 Minute wieder möglich.' });
    }

    const result = await fetchCVEsForAsset(asset);
    if (!result) {
      return res.status(200).json({ skipped: true, reason: 'Zu wenige Asset-Informationen für eine CVE-Suche (Typ oder Felder fehlen).' });
    }

    await asset.update({
      cve_critical: result.counts.critical,
      cve_high:     result.counts.high,
      cve_medium:   result.counts.medium,
      cve_low:      result.counts.low,
      cve_ids:      result.cveList,
      cve_last_checked: new Date(),
    });

    await auditFromReq(req, 'update', 'asset', asset.id, asset.name, { cve_refresh: { source: result.source, total: result.total, query: result.query } });
    res.json({ counts: result.counts, cveList: result.cveList, total: result.total, source: result.source, query: result.query });
  } catch (e) {
    console.error('[CVE] Refresh failed for asset', req.params.id + ':', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
