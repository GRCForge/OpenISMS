const express = require('express');
const { apiLimiter, heavyLimiter } = require('../middleware/rateLimiter');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { runAnalysis } = require('../services/documentAnalysisService');

// Same class of action as vendor_triage: running an analysis costs LLM budget
// and writes findings, viewing existing results is a separate, lighter action.
const ROLES = ['admin', 'assessor', 'it-staff', 'dpo'];

// See parsePositiveInt in vendorTriage.js — same rationale: a raw req.params/body
// value can be an object (Sequelize interprets it as an operator expression), so
// every identifier that reaches a `where` clause is coerced to a plain positive
// integer first.
const parsePositiveInt = (value) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// it-staff and viewer roles must not access contract documents (mirrors
// canAccessContract() in documents.js). Only applies to subject_type 'document' —
// policies.js has no equivalent per-category restriction on its own downloads.
const canAccessContract = (user) => user.role !== 'it-staff' && user.role !== 'viewer';

// One shared router implementation for both Documents and Policies, mounted
// separately for each so subject_type is fixed by which mount was hit rather
// than accepted from the client — a caller with document_analysis:run cannot use
// a documents-scoped request to write a subject_type:'policy' row or vice versa.
function createAnalysisRouter(subjectType) {
  const router = express.Router({ mergeParams: true });
  router.use(apiLimiter);
  router.use(authenticate);

  async function loadSubject(req, res) {
    const subjectId = parsePositiveInt(req.params.subjectId);
    if (subjectId === null) { res.status(400).json({ error: 'Invalid id' }); return null; }
    const { Document, Policy } = require('../models');
    const Model = subjectType === 'document' ? Document : Policy;
    const subject = await Model.findByPk(subjectId);
    if (!subject) { res.status(404).json({ error: 'Not found' }); return null; }
    if (subjectType === 'document' && subject.category === 'contract' && !canAccessContract(req.user)) {
      res.status(403).json({ error: 'Verboten' }); return null;
    }
    return { subjectId, subject };
  }

  router.get('/', requirePermission('document_analysis', 'view', ...ROLES), async (req, res) => {
    try {
      const ctx = await loadSubject(req, res);
      if (!ctx) return;
      const { DocumentAnalysisRun, User } = require('../models');
      const runs = await DocumentAnalysisRun.findAll({
        where: { subject_type: subjectType, subject_id: ctx.subjectId },
        include: [{ model: User, as: 'triggeredBy', attributes: ['id', 'name'] }],
        order: [['created_at', 'DESC']],
        attributes: { exclude: ['extracted_text'] },
      });
      res.json(runs);
    } catch (e) { serverError(res, e, 'documentAnalysis'); }
  });

  router.get('/:runId', requirePermission('document_analysis', 'view', ...ROLES), async (req, res) => {
    try {
      const ctx = await loadSubject(req, res);
      if (!ctx) return;
      const runId = parsePositiveInt(req.params.runId);
      if (runId === null) return res.status(400).json({ error: 'Invalid run id' });
      const { DocumentAnalysisRun, DocumentAnalysisFinding, User } = require('../models');
      const run = await DocumentAnalysisRun.findOne({
        where: { id: runId, subject_type: subjectType, subject_id: ctx.subjectId },
        include: [
          { model: DocumentAnalysisFinding, as: 'findings' },
          { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
        ],
        order: [[{ model: DocumentAnalysisFinding, as: 'findings' }, 'id', 'ASC']],
      });
      if (!run) return res.status(404).json({ error: 'Not found' });
      res.json(run);
    } catch (e) { serverError(res, e, 'documentAnalysis'); }
  });

  router.post('/', requirePermission('document_analysis', 'run', ...ROLES), heavyLimiter, async (req, res) => {
    try {
      const ctx = await loadSubject(req, res);
      if (!ctx) return;
      const { doc_type } = req.body;
      const { getProfiles } = require('../services/triageProfiles');
      const profiles = await getProfiles();
      // doc_type indexes into the profile map — only accept a string key, so a
      // crafted body cannot reach the lookup with an object or array.
      const resolvedDocType = typeof doc_type === 'string' && Object.hasOwn(profiles, doc_type) ? doc_type : 'other';

      const { DocumentAnalysisRun } = require('../models');
      const run = await DocumentAnalysisRun.create({
        subject_type: subjectType,
        subject_id: ctx.subjectId,
        doc_type: resolvedDocType,
        status: 'pending',
        triggered_by_id: req.user.id,
      });

      await auditFromReq(req, 'create', subjectType, ctx.subjectId, ctx.subject.original_name || ctx.subject.title, {
        action: 'ai_analysis_started',
        run_id: run.id,
      });

      runAnalysis(run.id).catch(err => {
        console.error(`[DocAnalysis] Run ${run.id} failed:`, err.message);
      });

      res.status(202).json(run);
    } catch (e) { serverError(res, e, 'documentAnalysis'); }
  });

  router.post('/:runId/retry', requirePermission('document_analysis', 'run', ...ROLES), heavyLimiter, async (req, res) => {
    try {
      const ctx = await loadSubject(req, res);
      if (!ctx) return;
      const runId = parsePositiveInt(req.params.runId);
      if (runId === null) return res.status(400).json({ error: 'Invalid run id' });
      const { DocumentAnalysisRun } = require('../models');
      const prev = await DocumentAnalysisRun.findOne({ where: { id: runId, subject_type: subjectType, subject_id: ctx.subjectId } });
      if (!prev) return res.status(404).json({ error: 'Not found' });

      const run = await DocumentAnalysisRun.create({
        subject_type: subjectType,
        subject_id: ctx.subjectId,
        doc_type: prev.doc_type,
        status: 'pending',
        triggered_by_id: req.user.id,
      });
      runAnalysis(run.id).catch(err => console.error(`[DocAnalysis] Retry run ${run.id} failed:`, err.message));
      res.status(202).json(run);
    } catch (e) { serverError(res, e, 'documentAnalysis'); }
  });

  router.delete('/:runId', requirePermission('document_analysis', 'delete', 'admin'), async (req, res) => {
    try {
      const ctx = await loadSubject(req, res);
      if (!ctx) return;
      const runId = parsePositiveInt(req.params.runId);
      if (runId === null) return res.status(400).json({ error: 'Invalid run id' });
      const { DocumentAnalysisRun, DocumentAnalysisFinding } = require('../models');
      const run = await DocumentAnalysisRun.findOne({ where: { id: runId, subject_type: subjectType, subject_id: ctx.subjectId } });
      if (!run) return res.status(404).json({ error: 'Not found' });
      await DocumentAnalysisFinding.destroy({ where: { run_id: run.id } });
      await run.destroy();
      res.json({ ok: true });
    } catch (e) { serverError(res, e, 'documentAnalysis'); }
  });

  return router;
}

module.exports = {
  forDocument: createAnalysisRouter('document'),
  forPolicy: createAnalysisRouter('policy'),
};
