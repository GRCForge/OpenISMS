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
const { apiLimiter, heavyLimiter } = require('../middleware/rateLimiter');
const { authenticate, requirePermission, requireWriteAccess } = require('../middleware/auth');
const { serverError, requestError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const svc = require('../services/bsiDomainService');
const check = require('../services/bsiCheckService');
const analysis = require('../services/bsiRiskAnalysisService');
const reports = require('../services/reportService');
const render = require('../services/reportRender');

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
    // Every export is written to the audit log, like the A.6 export (3.10.0).
    await auditFromReq(req, 'export', 'bsi_check', c.domain.id, c.domain.name, { format: 'xlsx', entries: c.entries.length });
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

// ── Risk analysis per BSI-Standard 200-3 (3.10.0) ───────────────────────────
// Reading: bsi_grundschutz.view (risks additionally need risks.view, treatment
// items follow the treatment plan rules - checked in the service). Writing:
// bsi_grundschutz.risk_analysis; creating or changing the risk additionally
// risks.create / risks.edit and the record rights. The service writes the
// signed audit entries (same as the MCP tools).

router.get('/:id/risk-analysis', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await analysis.getAnalysis(req.params.id, req.user)); } catch (e) { requestError(res, e, 'bsi-risk-analysis'); }
});

router.get('/:id/risk-analysis/:targetId', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await analysis.getTargetAnalysis(req.params.id, req.params.targetId, req.user)); } catch (e) { requestError(res, e, 'bsi-risk-analysis'); }
});

// Manual decision (include/exclude with reason), scenario not covered, progress.
router.put('/:id/risk-analysis/:targetId', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try { res.json(await analysis.setTargetDecision(req.params.id, req.params.targetId, req.body, req.user, req)); } catch (e) { requestError(res, e, 'bsi-risk-analysis'); }
});

// Add an additional threat (existing threat_id, or a new one: threats.create).
router.post('/:id/risk-analysis/:targetId/threats', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try { res.status(201).json(await analysis.addAdditionalThreat(req.params.id, req.params.targetId, req.body, req.user, req)); } catch (e) { requestError(res, e, 'bsi-risk-analysis'); }
});

// Relevance and coverage of a threat.
router.put('/:id/risk-analysis/:targetId/threats/:threatId', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try { res.json(await analysis.setThreatAssessment(req.params.id, req.params.targetId, req.params.threatId, req.body, req.user, req)); } catch (e) { requestError(res, e, 'bsi-risk-analysis'); }
});

// Classification (frequency x impact) -> risk in the register, created once.
router.post('/:id/risk-analysis/:targetId/threats/:threatId/classify', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const r = await analysis.classifyThreat(req.params.id, req.params.targetId, req.params.threatId, req.body, req.user, req);
    res.status(r.created ? 201 : 200).json(r);
  } catch (e) { requestError(res, e, 'bsi-risk-analysis'); }
});

// ── Realisation plan (reference document A.6) ───────────────────────────────

router.get('/:id/realization-plan', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try { res.json(await analysis.getRealizationPlan(req.params.id, req.user)); } catch (e) { requestError(res, e, 'bsi-realization-plan'); }
});

// Rows for the Excel export (the browser builds the file, like A.4);
// formula-neutralised. Every export is written to the audit log.
router.get('/:id/realization-plan/export', authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const plan = await analysis.getRealizationPlan(req.params.id, req.user);
    await auditFromReq(req, 'export', 'bsi_realization_plan', plan.domain.id, plan.domain.name, { format: 'xlsx', items: plan.items.length });
    res.json({ domain: plan.domain, generated_at: plan.generated_at, summary: plan.summary, ...analysis.buildA6Rows(plan) });
  } catch (e) { requestError(res, e, 'bsi-realization-plan'); }
});

router.post('/:id/realization-plan/measures', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try { res.status(201).json(await analysis.addRealizationMeasure(req.params.id, req.body, req.user, req)); } catch (e) { requestError(res, e, 'bsi-realization-plan'); }
});

router.put('/:id/realization-plan/measures/:measureId', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try { res.json(await analysis.updateRealizationMeasure(req.params.id, req.params.measureId, req.body, req.user, req)); } catch (e) { requestError(res, e, 'bsi-realization-plan'); }
});

router.delete('/:id/realization-plan/measures/:measureId', authenticate, requirePermission('bsi_grundschutz','risk_analysis','admin','assessor'), requireWriteAccess(), async (req, res) => {
  try { res.json(await analysis.removeRealizationMeasure(req.params.id, req.params.measureId, req.user, req)); } catch (e) { requestError(res, e, 'bsi-realization-plan'); }
});

// ── Reference documents A.1 - A.6 as DOCX / PDF ─────────────────────────────
// :doc is a1..a6 or all; ?format=docx|pdf. Same visibility as the lists the
// documents are built from; every download is written to the audit log.

router.get('/:id/reports/:doc', heavyLimiter, authenticate, requirePermission('bsi_grundschutz','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    const format = req.query.format === 'pdf' ? 'pdf' : req.query.format === 'docx' || req.query.format === undefined ? 'docx' : null;
    if (!format) return res.status(400).json({ error: 'format muss docx oder pdf sein' });
    // The key used further on is the allowlist entry, not the request value.
    const wanted = typeof req.params.doc === 'string' ? req.params.doc.toLowerCase() : '';
    const docKey = reports.BSI_DOC_KEYS.find(k => k === wanted);
    if (!docKey) return res.status(400).json({ error: `Dokument muss eines von ${reports.BSI_DOC_KEYS.join(', ')} sein` });
    const { doc, domain, keys } = await reports.buildBsiReport(req.params.id, docKey, req.user);
    const buffer = await render.render(doc, format);
    const filename = render.safeFilename(docKey === 'all' ? 'bsi-referenzdokumente' : `bsi-${docKey}`, domain.name, format);
    await auditFromReq(req, 'export', 'bsi_report', domain.id, domain.name, { document: docKey, sections: keys, format, filename, bytes: buffer.length });
    render.sendDocument(res, buffer, format, filename);
  } catch (e) { requestError(res, e, 'bsi-reports'); }
});

module.exports = router;
