const express = require('express');
const { Assessment, Asset, User, Reminder, Task } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { checkAndManageAssetTasks } = require('../services/taskAutomationService');

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

router.get('/', authenticate, async (req, res) => {
  try {
    const { asset_id } = req.query;
    const where = asset_id ? { asset_id } : {};
    const assessments = await Assessment.findAll({
      where,
      include: [
        { model: Asset, attributes: ['id', 'name', 'type', 'classification'] },
        { model: User, as: 'assessorUser', attributes: ['id', 'name'] }
      ],
      order: [['assessed_at', 'DESC']]
    });
    res.json(assessments);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authenticate, requireRole('admin', 'assessor'), async (req, res) => {
  try {
    const {
      asset_id, confidentiality, integrity, availability, notes, mitigation,
      risk_treatment, treatment_justification, accepted_by, accepted_until, acceptance_document_id,
    } = req.body;
    const asset = await Asset.findByPk(asset_id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    // Risikoakzeptanz erfordert zwingend ein verknuepftes (Akzeptanz-)Dokument
    if (risk_treatment === 'accept' && !acceptance_document_id) {
      return res.status(400).json({ error: 'Risikoakzeptanz erfordert ein verknüpftes Akzeptanz-Dokument.' });
    }

    const { score, level } = Assessment.calculateRisk(confidentiality, integrity, availability);
    const assessed_at = new Date();

    // When risk_treatment is 'accept' and accepted_until is set, use the earlier of
    // accepted_until and +1 year as the next review date — the acceptance expires first.
    const oneYearOut = new Date(assessed_at);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

    const acceptedUntilDate = (risk_treatment === 'accept' && accepted_until && accepted_until !== 'Invalid date')
      ? new Date(accepted_until) : null;

    const next_review_at = (acceptedUntilDate && acceptedUntilDate < oneYearOut)
      ? acceptedUntilDate : oneYearOut;

    // Mark previous assessments as not current
    await Assessment.update({ is_current: false }, { where: { asset_id, is_current: true } });

    const assessment = await Assessment.create({
      asset_id,
      assessor_id: req.user.id,
      confidentiality,
      integrity,
      availability,
      risk_score: score,
      risk_level: level,
      notes,
      mitigation,
      risk_treatment: risk_treatment || null,
      treatment_justification: treatment_justification || null,
      accepted_by: risk_treatment === 'accept' ? (accepted_by || null) : null,
      accepted_until: acceptedUntilDate ? accepted_until : null,
      acceptance_document_id: risk_treatment === 'accept' ? (acceptance_document_id || null) : null,
      assessed_at,
      next_review_at,
      is_current: true
    });

    // Remove previous pending reminders for this asset
    await Reminder.destroy({ where: { asset_id, status: 'pending' } });

    // Task + Reminder title differs for risk acceptance vs. regular review
    const isAcceptance = risk_treatment === 'accept' && acceptedUntilDate;
    const taskTitle = isAcceptance
      ? `Risikoakzeptanz läuft ab: ${asset.name}`
      : `Review fällig: ${asset.name}`;
    const taskDesc = isAcceptance
      ? `Die Risikoakzeptanz für Asset „${asset.name}" läuft am ${accepted_until} ab und muss erneuert oder das Risiko anders behandelt werden.`
      : `Regelmäßige Überprüfung der Schutzbedarfsfeststellung (Risikobewertung) für das Asset „${asset.name}".`;
    const taskTags = isAcceptance ? ['Risikoakzeptanz', 'Risiko'] : ['Review', 'Risiko'];

    const task = await Task.create({
      title: taskTitle,
      description: taskDesc,
      priority: isAcceptance && level === 'critical' ? 'high' : 'medium',
      assigned_to_id: asset.assessor_id || req.user.id,
      due_date: next_review_at.toISOString().split('T')[0],
      related_type: 'asset',
      related_id: asset.id,
      tags: taskTags,
    });

    await Reminder.create({
      asset_id,
      assessment_id: assessment.id,
      due_date: next_review_at.toISOString().split('T')[0],
      status: 'pending',
      task_id: task.id,
      notes: isAcceptance
        ? `Risikoakzeptanz von „${accepted_by || 'unbekannt'}" gültig bis ${accepted_until}`
        : null,
    });

    // Audit log — include risk-treatment details so acceptance decisions are traceable
    await auditFromReq(req, 'assess', 'assessment', assessment.id, asset.name, {
      asset_id, confidentiality, integrity, availability,
      risk_score: score, risk_level: level,
      risk_treatment: risk_treatment || null,
      ...(isAcceptance ? {
        accepted_by: accepted_by || null,
        accepted_until,
        acceptance_document_id: acceptance_document_id || null,
      } : {}),
    });

    // Auto-close related tasks
    await checkAndManageAssetTasks(asset);

    res.status(201).json(assessment);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
