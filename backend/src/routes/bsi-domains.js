'use strict';

/**
 * Informationsverbund, Zielobjekte und Modellierung (BSI-Standard 200-2).
 * Eingehaengt unter /api/bsi-grundschutz/domains hinter requireModule('bsi_grundschutz').
 *
 * Die Arbeit selbst (Validierung, Sichtbarkeit, Verbundpruefung) liegt in
 * services/bsiDomainService.js und wird von den MCP-Tools genauso genutzt.
 * Jede Aenderung schreibt einen Audit-Eintrag.
 */

const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate, requirePermission, requireWriteAccess } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const svc = require('../services/bsiDomainService');
const check = require('../services/bsiCheckService');

router.use(apiLimiter);

function fail(res, e) {
  if (e instanceof svc.DomainError || e instanceof check.CheckError) return res.status(e.status).json({ error: e.message });
  return serverError(res, e, 'bsi-domains');
}

// Stammdaten fuer die Oberflaeche: Zielobjekttypen, Absicherungsvarianten,
// Typvorschlag je Asset-Typ, Prozessschichten.
router.get('/meta', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), (req, res) => {
  res.json({
    target_types: svc.TARGET_TYPES,
    protection_approaches: svc.PROTECTION_APPROACHES,
    process_layers: svc.PROCESS_LAYERS,
    asset_type_suggestions: svc.ASSET_TYPE_TO_TARGET,
  });
});

router.get('/', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await svc.listDomains()); } catch (e) { fail(res, e); }
});

router.post('/', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const domain = await svc.createDomain(req.body, req.user);
    await auditFromReq(req, 'create', 'bsi_information_domain', domain.id, domain.name, {
      protection_approach: domain.protection_approach, catalog_id: domain.catalog_id,
    });
    res.status(201).json(domain);
  } catch (e) { fail(res, e); }
});

router.get('/:id', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await svc.getDomain(req.params.id)); } catch (e) { fail(res, e); }
});

router.put('/:id', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const { domain, before, changes } = await svc.updateDomain(req.params.id, req.body);
    if (Object.keys(changes).length) {
      await auditFromReq(req, 'update', 'bsi_information_domain', domain.id, domain.name, { before, after: changes });
    }
    res.json(domain);
  } catch (e) { fail(res, e); }
});

// ── Zielobjekte ──────────────────────────────────────────────────────────────

router.get('/:id/target-objects', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await svc.listTargetObjects(req.params.id, req.user)); } catch (e) { fail(res, e); }
});

router.post('/:id/target-objects', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const { domain, targetObject, asset } = await svc.addTargetObject(req.params.id, req.body, req.user);
    await auditFromReq(req, 'create', 'bsi_target_object', targetObject.id, asset.name, {
      domain_id: domain.id, asset_id: asset.id, target_type: targetObject.target_type,
    });
    res.status(201).json(targetObject);
  } catch (e) { fail(res, e); }
});

router.put('/:id/target-objects/:targetId', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const { domain, targetObject, asset, before, changes } = await svc.updateTargetObject(req.params.id, req.params.targetId, req.body, req.user);
    if (Object.keys(changes).length) {
      await auditFromReq(req, 'update', 'bsi_target_object', targetObject.id, asset.name, { domain_id: domain.id, before, after: changes });
    }
    res.json(targetObject);
  } catch (e) { fail(res, e); }
});

router.delete('/:id/target-objects/:targetId', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const { domain, snapshot, asset, id } = await svc.removeTargetObject(req.params.id, req.params.targetId, req.user);
    await auditFromReq(req, 'delete', 'bsi_target_object', id, asset.name, { domain_id: domain.id, ...snapshot });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ── Modellierung ─────────────────────────────────────────────────────────────

router.get('/:id/modeling', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await svc.listModeling(req.params.id, req.user)); } catch (e) { fail(res, e); }
});

// ?target_object_id=<id> fuer ein Zielobjekt, ohne Parameter fuer den ganzen Verbund.
router.get('/:id/modeling/suggestions', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const target = typeof req.query.target_object_id === 'string' ? req.query.target_object_id : undefined;
    res.json(await svc.suggestModeling(req.params.id, target, req.user));
  } catch (e) { fail(res, e); }
});

router.post('/:id/modeling', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const { domain, modeling, module: mod, target } = await svc.addModeling(req.params.id, req.body, req.user);
    await auditFromReq(req, 'create', 'bsi_modeling', modeling.id, mod.module_id, {
      domain_id: domain.id, target_object_id: modeling.target_object_id, asset_id: target?.asset?.id ?? null,
      module_id: mod.module_id, catalog_id: modeling.catalog_id,
    });
    res.status(201).json(modeling);
  } catch (e) { fail(res, e); }
});

router.delete('/:id/modeling/:modelingId', authenticate, requirePermission('bsi_grundschutz','manage_domain','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const { domain, snapshot, id } = await svc.removeModeling(req.params.id, req.params.modelingId, req.user);
    await auditFromReq(req, 'delete', 'bsi_modeling', id, snapshot.module_id, { domain_id: domain.id, ...snapshot });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ── IT-Grundschutz-Check ─────────────────────────────────────────────────────
// Liste, Auswertung, Export und Dokumentauswahl lesen ueber dieselbe Funktion
// (check.getCheck bzw. linkableDocuments) mit denselben Sichtbarkeitsregeln.

const targetParam = (q) => (typeof q.target_object_id === 'string' ? q.target_object_id : undefined);

router.get('/:id/check', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await check.getCheck(req.params.id, req.user, { targetObjectId: targetParam(req.query) })); } catch (e) { fail(res, e); }
});

router.get('/:id/check/summary', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const c = await check.getCheck(req.params.id, req.user);
    res.json({ domain: c.domain, levels: c.levels, ...check.summarize(c.entries) });
  } catch (e) { fail(res, e); }
});

// Zeilen fuer den Excel-Export im Aufbau des Referenzdokuments A.4; die Datei
// baut der Browser (wie die uebrigen Exporte). Strings sind formel-neutralisiert.
router.get('/:id/check/export', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const c = await check.getCheck(req.params.id, req.user);
    res.json({ domain: c.domain, ...check.buildA4Rows(c), summary: check.summarize(c.entries) });
  } catch (e) { fail(res, e); }
});

router.get('/:id/check/documents', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await check.linkableDocuments(req.params.id, targetParam(req.query), req.user)); } catch (e) { fail(res, e); }
});

router.put('/:id/check', authenticate, requirePermission('bsi_grundschutz','edit','admin','assessor','it-staff'), requireWriteAccess(), async (req, res) => {
  try {
    const r = await check.setCheckEntry(req.params.id, req.body, req.user);
    const changed = Object.keys(r.changes).length || r.docsAdded.length || r.docsRemoved.length || r.controlsAdded.length || r.controlsRemoved.length;
    if (r.created || changed) {
      await auditFromReq(req, r.created ? 'create' : 'update', 'bsi_requirement', r.row.id, r.row.req_id, {
        domain_id: r.domain.id, target_object_id: r.row.target_object_id, asset_id: r.target?.asset_id ?? null,
        before: r.before, after: r.changes,
        documents_added: r.docsAdded, documents_removed: r.docsRemoved,
        controls_added: r.controlsAdded, controls_removed: r.controlsRemoved,
      });
    }
    res.json(r.row);
  } catch (e) { fail(res, e); }
});

module.exports = router;
