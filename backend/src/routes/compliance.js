const express = require('express');
const { Op } = require('sequelize');
const { Asset, Assessment, Kpi, KpiMeasurement, Audit, AuditFinding, UserTraining, User, Task, Training } = require('../models');
const { authenticate, requireRole, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const multer = require('multer');
const upload = multer();

const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

router.get('/stats', authenticate, async (req, res) => {
  try {
    const assets = await Asset.findAll({
      where: { status: 'active' },
      attributes: ['id', 'name', 'type', 'classification', 'frameworks', 'owner_id', 'nis2_relevant', 'data_category', 'vvt_status'],
      include: [{
        model: Assessment,
        where: { is_current: true },
        required: false,
        attributes: ['risk_level', 'risk_score', 'next_review_at'],
      }],
    });

    const fwBuckets = { iso27001: [], nis2: [], gdpr: [] };
    let highRiskCount = 0;

    assets.forEach(a => {
      const assessment = a.Assessments?.[0];
      if (assessment && ['high', 'critical'].includes(assessment.risk_level)) highRiskCount++;

      // Automatic Framework Mapping
      // 1. ISO 27001: All active assets are in scope
      fwBuckets.iso27001.push({ id: a.id, name: a.name, type: a.type, classification: a.classification, risk_level: assessment?.risk_level });

      // 2. NIS-2: Based on specific flag
      if (a.nis2_relevant) {
        fwBuckets.nis2.push({ id: a.id, name: a.name, type: a.type, classification: a.classification, risk_level: assessment?.risk_level });
      }

      // 3. GDPR: Based on data category
      if (a.data_category !== 'none') {
        fwBuckets.gdpr.push({ id: a.id, name: a.name, type: a.type, classification: a.classification, risk_level: assessment?.risk_level });
      }
    });

    // Assets that handle personal data but have no completed VVT — DSGVO gap
    const dsgvoGaps = assets
      .filter(a => a.data_category !== 'none' && a.vvt_status !== 'complete')
      .map(a => ({ id: a.id, name: a.name, data_category: a.data_category, vvt_status: a.vvt_status }));

    res.json({
      total: assets.length,
      coverage: 100, // Now implicitly 100% since ISO 27001 covers all
      highRisk: highRiskCount,
      frameworks: {
        iso27001: { count: fwBuckets.iso27001.length, assets: fwBuckets.iso27001.slice(0, 20) },
        nis2:     { count: fwBuckets.nis2.length,     assets: fwBuckets.nis2.slice(0, 20) },
        gdpr:     { count: fwBuckets.gdpr.length,     assets: fwBuckets.gdpr.slice(0, 20) },
      },
      noFramework: { count: 0, assets: [] },
      dsgvoGaps,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── KPI & Effectiveness Measurement ──────────────────────────────────
router.get('/kpis', authenticate, async (req, res) => {
  try {
    const items = await Kpi.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: KpiMeasurement, as: 'measurements' }
      ],
      order: [['created_at', 'DESC']]
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/kpis', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await Kpi.create(req.body);
    await auditFromReq(req, 'create', 'kpi', item.id, item.title, {
      description: item.description,
      target: item.target,
      status: item.status,
      owner_id: item.owner_id
    });
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/kpis/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await Kpi.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const before = {
      title: item.title,
      description: item.description,
      target: item.target,
      current_value: item.current_value,
      status: item.status,
      owner_id: item.owner_id
    };
    await item.update(req.body);
    const after = {
      title: item.title,
      description: item.description,
      target: item.target,
      current_value: item.current_value,
      status: item.status,
      owner_id: item.owner_id
    };
    await auditFromReq(req, 'update', 'kpi', item.id, item.title, { before, after });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/kpis/:id', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await Kpi.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { id, title } = item;
    await item.destroy();
    await auditFromReq(req, 'delete', 'kpi', id, title, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/kpis/:id/measurements', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const kpi = await Kpi.findByPk(req.params.id);
    if (!kpi) return res.status(404).json({ error: 'KPI nicht gefunden' });
    
    const measurement = await KpiMeasurement.create({
      ...req.body,
      kpi_id: kpi.id
    });
    
    // Update KPI current value
    await kpi.update({
      current_value: measurement.value
    });
    
    await auditFromReq(req, 'create', 'kpi_measurement', measurement.id, `KPI: ${kpi.title}`, { value: measurement.value });
    res.status(201).json(measurement);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Audit & CAPA Module ────────────────────────────────────────────
router.get('/audits', authenticate, async (req, res) => {
  try {
    const items = await Audit.findAll({
      include: [
        {
          model: AuditFinding,
          as: 'findings',
          include: [
            { model: User, as: 'assignee', attributes: ['id', 'name'] },
            { model: Task, as: 'capaTask', attributes: ['id', 'title', 'status'] }
          ]
        }
      ],
      order: [['start_date', 'DESC'], ['created_at', 'DESC']]
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await Audit.create(req.body);
    await auditFromReq(req, 'create', 'audit', item.id, item.title, {
      scope: item.scope,
      audit_type: item.audit_type,
      status: item.status,
      auditor: item.auditor,
      start_date: item.start_date,
      end_date: item.end_date
    });
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/audits/:id', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await Audit.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const before = {
      title: item.title,
      scope: item.scope,
      audit_type: item.audit_type,
      status: item.status,
      auditor: item.auditor,
      start_date: item.start_date,
      end_date: item.end_date,
      report_link: item.report_link,
      notes: item.notes
    };
    await item.update(req.body);
    const after = {
      title: item.title,
      scope: item.scope,
      audit_type: item.audit_type,
      status: item.status,
      auditor: item.auditor,
      start_date: item.start_date,
      end_date: item.end_date,
      report_link: item.report_link,
      notes: item.notes
    };
    await auditFromReq(req, 'update', 'audit', item.id, item.title, { before, after });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/audits/:id', authenticate, requireRole('admin'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await Audit.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { id, title } = item;
    await item.destroy();
    await auditFromReq(req, 'delete', 'audit', id, title, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/audits/:id/findings', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const audit = await Audit.findByPk(req.params.id);
    if (!audit) return res.status(404).json({ error: 'Audit nicht gefunden' });
    
    const finding = await AuditFinding.create({
      ...req.body,
      audit_id: audit.id
    });
    
    await auditFromReq(req, 'create', 'audit_finding', finding.id, finding.title, {
      audit_id: audit.id,
      description: finding.description,
      severity: finding.severity,
      status: finding.status,
      assignee_id: finding.assignee_id
    });
    res.status(201).json(finding);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/findings/:id', authenticate, requireWriteAccess(), async (req, res) => {
  try {
    const item = await AuditFinding.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const before = {
      audit_id: item.audit_id,
      title: item.title,
      description: item.description,
      severity: item.severity,
      status: item.status,
      capa_task_id: item.capa_task_id,
      assignee_id: item.assignee_id
    };
    await item.update(req.body);
    const after = {
      audit_id: item.audit_id,
      title: item.title,
      description: item.description,
      severity: item.severity,
      status: item.status,
      capa_task_id: item.capa_task_id,
      assignee_id: item.assignee_id
    };
    await auditFromReq(req, 'update', 'audit_finding', item.id, item.title, { before, after });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/findings/:id', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await AuditFinding.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { id, title } = item;
    await item.destroy();
    await auditFromReq(req, 'delete', 'audit_finding', id, title, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Awareness & Training Tracking ──────────────────────────────────
// GET master list of trainings
router.get('/trainings-list', authenticate, async (req, res) => {
  try {
    const items = await Training.findAll({
      include: [{
        model: UserTraining,
        as: 'assignments',
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'department'] }]
      }],
      order: [['date', 'DESC']]
    });
    
    const formatted = items.map(t => {
      const assignments = t.assignments || [];
      const total = assignments.length;
      const completed = assignments.filter(a => a.completed_at !== null).length;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        date: t.date,
        mandatory: t.mandatory,
        total_assigned: total,
        total_completed: completed,
        assignments: assignments
      };
    });
    
    res.json(formatted);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST create a new training course
router.post('/trainings-list', authenticate, requireRole('admin', 'assessor', 'dpo'), requireWriteAccess(), async (req, res) => {
  try {
    const { title, description, date, mandatory } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Schulungstitel ist erforderlich' });
    if (!date) return res.status(400).json({ error: 'Datum ist erforderlich' });
    
    const item = await Training.create({
      title: title.trim(),
      description: description || null,
      date,
      mandatory: !!mandatory
    });
    
    await auditFromReq(req, 'create', 'training', item.id, item.title, {
      date: item.date,
      mandatory: item.mandatory
    });
    
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update a training course
router.put('/trainings-list/:id', authenticate, requireRole('admin', 'assessor', 'dpo'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await Training.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Schulung nicht gefunden' });
    
    const { title, description, date, mandatory } = req.body;
    const before = { title: item.title, description: item.description, date: item.date, mandatory: item.mandatory };
    
    await item.update({
      title: title !== undefined ? title.trim() : item.title,
      description: description !== undefined ? description : item.description,
      date: date !== undefined ? date : item.date,
      mandatory: mandatory !== undefined ? !!mandatory : item.mandatory
    });
    
    const after = { title: item.title, description: item.description, date: item.date, mandatory: item.mandatory };
    await auditFromReq(req, 'update', 'training', item.id, item.title, { before, after });
    
    // Update training_title on all related assignments
    await UserTraining.update(
      { training_title: item.title },
      { where: { training_id: item.id } }
    );
    
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE a training course
router.delete('/trainings-list/:id', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await Training.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Schulung nicht gefunden' });
    
    const { id, title } = item;
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'training', related_id: id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );
    await item.destroy();
    await auditFromReq(req, 'delete', 'training', id, title, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET all user training assignments
router.get('/trainings', authenticate, async (req, res) => {
  try {
    const whereClause = req.user.role === 'employee' ? { user_id: req.user.id } : {};
    const items = await UserTraining.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'department'] },
        { model: Training, as: 'training' }
      ],
      order: [['completed_at', 'DESC'], ['created_at', 'DESC']]
    });
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST contest a user training assignment
router.post('/trainings/:id/contest', authenticate, async (req, res) => {
  try {
    const item = await UserTraining.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Schulungsteilnahme nicht gefunden' });
    
    // An employee can only contest their own training
    if (req.user.role === 'employee' && item.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Nicht autorisiert, diese Schulung zu beanstanden' });
    }
    
    const { comment } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Eine Begründung ist erforderlich' });
    }
    
    const before = { contested: item.contested, contestation_comment: item.contestation_comment };
    item.contested = true;
    item.contestation_comment = comment.trim();
    await item.save();
    
    const after = { contested: item.contested, contestation_comment: item.contestation_comment };
    
    // Create an audit log
    await auditFromReq(req, 'update', 'training_contest', item.id, item.training_title, { before, after });
    
    // Auto-create a task for assessors to review this contestation
    await Task.create({
      title: `Beanstandung: Schulungsteilnahme für ${req.user.name}`,
      description: `Mitarbeiter ${req.user.name} (${req.user.email}) hat die Teilnahme an der Schulung "${item.training_title}" beanstandet. Begründung: "${comment.trim()}"`,
      status: 'open',
      priority: 'high',
      assigned_role: 'assessor',
      related_type: 'training',
      related_id: item.id
    });
    
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST assign users to a training (manual and/or Excel mapping list)
router.post('/trainings/bulk', authenticate, requireRole('admin', 'assessor', 'dpo'), requireWriteAccess(), upload.single('file'), async (req, res) => {
  try {
    const { training_id, training_title, completed_at, expires_at, certificate_url, mark_completed } = req.body;
    let user_ids = [];
    if (req.body.user_ids) {
      if (typeof req.body.user_ids === 'string') {
        try {
          user_ids = JSON.parse(req.body.user_ids);
        } catch (e) {
          user_ids = req.body.user_ids.split(',').map(Number).filter(Boolean);
        }
      } else if (Array.isArray(req.body.user_ids)) {
        user_ids = req.body.user_ids.map(Number);
      }
    }

    let finalTitle = training_title || '';
    let dbTraining = null;
    if (training_id) {
      dbTraining = await Training.findByPk(training_id);
      if (dbTraining) {
        finalTitle = dbTraining.title;
      }
    }

    if (!finalTitle?.trim()) {
      return res.status(400).json({ error: 'Schulungsname ist erforderlich' });
    }

    const activeUsers = await User.findAll({ where: { active: true } });
    const matchedUserIds = new Set(user_ids);
    const externalEmployees = []; // Array of { name, email }

    if (req.file) {
      const { readSheet } = require('read-excel-file/node');
      // First sheet as array of rows, each row an array of (typed) cell values.
      const sheet = await readSheet(req.file.buffer);

      const parsedRows = [];
      for (const row of sheet) {
        let name = '';
        let email = '';
        for (const cell of row) {
          const val = String(cell ?? '').trim();
          if (!val) continue;
          if (val.includes('@') && val.length <= 254 && /^[a-zA-Z0-9_'+.\-]+@[a-zA-Z0-9\-.]+\.[a-zA-Z]{2,}$/.test(val)) {
            email = val.toLowerCase();
          } else {
            if (!name) name = val;
          }
        }
        if (name || email) {
          parsedRows.push({ name, email });
        }
      }

      for (const rowData of parsedRows) {
        // Try to match active user
        const matchedUser = activeUsers.find(u => 
          (rowData.email && u.email.toLowerCase() === rowData.email) ||
          (rowData.name && u.name.toLowerCase() === rowData.name.toLowerCase())
        );
        
        if (matchedUser) {
          matchedUserIds.add(matchedUser.id);
        } else {
          const empName = rowData.name || rowData.email;
          if (empName) {
            externalEmployees.push({ name: empName, email: rowData.email });
          }
        }
      }
    }

    const finalUserIds = Array.from(matchedUserIds);
    if (finalUserIds.length === 0 && externalEmployees.length === 0) {
      return res.status(400).json({ error: 'Keine Teilnehmer ausgewählt oder in der Excel-Liste gefunden.' });
    }

    const isCompleted = mark_completed === 'true' || mark_completed === true || !!completed_at;
    const completedDate = isCompleted ? (completed_at || dbTraining?.date || new Date().toISOString().slice(0, 10)) : null;
    const expiresDate = isCompleted ? (expires_at || null) : null;
    const statusValue = isCompleted ? 'valid' : 'pending';

    const created = [];

    // 1. Process registered users.
    // Pre-load existing assignments for all users in ONE query (was a findOne
    // per user — N+1 that scaled linearly with the number assigned).
    const existingByUser = new Map();
    if (training_id && finalUserIds.length) {
      const rows = await UserTraining.findAll({
        where: { training_id, user_id: { [Op.in]: finalUserIds } },
      });
      rows.forEach(a => existingByUser.set(a.user_id, a));
    }

    for (const userId of finalUserIds) {
      const assignment = training_id ? existingByUser.get(userId) : null;

      if (assignment) {
        await assignment.update({
          completed_at: completedDate,
          expires_at: expiresDate,
          certificate_url: certificate_url || assignment.certificate_url,
          status: statusValue
        });
        created.push(assignment);
      } else {
        const item = await UserTraining.create({
          user_id: userId,
          training_id: training_id ? Number(training_id) : null,
          training_title: finalTitle.trim(),
          completed_at: completedDate,
          expires_at: expiresDate,
          certificate_url: certificate_url || null,
          status: statusValue
        });
        created.push(item);
      }
    }

    // 2. Process external employees.
    // Same batching: one query for all external names instead of a findOne each.
    // Within a request training_id is fixed, so the match key is consistent.
    const existingByName = new Map();
    if (externalEmployees.length) {
      const empNames = externalEmployees.map(e => e.name);
      const whereBase = training_id
        ? { training_id, user_id: null }
        : { training_title: finalTitle.trim(), user_id: null };
      const rows = await UserTraining.findAll({
        where: { ...whereBase, employee_name: { [Op.in]: empNames } },
      });
      rows.forEach(a => existingByName.set(a.employee_name, a));
    }

    for (const emp of externalEmployees) {
      const assignment = existingByName.get(emp.name) || null;

      if (assignment) {
        await assignment.update({
          employee_email: emp.email || assignment.employee_email,
          completed_at: completedDate,
          expires_at: expiresDate,
          certificate_url: certificate_url || assignment.certificate_url,
          status: statusValue
        });
        created.push(assignment);
      } else {
        const item = await UserTraining.create({
          user_id: null,
          training_id: training_id ? Number(training_id) : null,
          training_title: finalTitle.trim(),
          employee_name: emp.name,
          employee_email: emp.email || null,
          completed_at: completedDate,
          expires_at: expiresDate,
          certificate_url: certificate_url || null,
          status: statusValue
        });
        created.push(item);
      }
    }

    await auditFromReq(req, 'create', 'user_training', null, `Bulk: ${finalTitle}`, { count: created.length, training_id });
    res.status(201).json({ count: created.length, items: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create single user training assignment (backward compatibility)
router.post('/trainings', authenticate, requireRole('admin', 'assessor', 'dpo'), requireWriteAccess(), async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.training_id) {
      const tr = await Training.findByPk(data.training_id);
      if (tr) {
        data.training_title = tr.title;
      }
    }
    
    // Automatically set status based on completion date
    if (data.completed_at) {
      data.status = 'valid';
    } else {
      data.status = 'pending';
    }

    const item = await UserTraining.create(data);
    await auditFromReq(req, 'create', 'user_training', item.id, item.training_title, {
      user_id: item.user_id,
      training_id: item.training_id,
      completed_at: item.completed_at,
      expires_at: item.expires_at,
      status: item.status
    });
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update user training assignment
router.put('/trainings/:id', authenticate, requireRole('admin', 'assessor', 'dpo'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await UserTraining.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    
    const before = {
      user_id: item.user_id,
      training_id: item.training_id,
      training_title: item.training_title,
      completed_at: item.completed_at,
      expires_at: item.expires_at,
      certificate_url: item.certificate_url,
      status: item.status
    };

    const data = { ...req.body };
    if (data.training_id && data.training_id !== item.training_id) {
      const tr = await Training.findByPk(data.training_id);
      if (tr) {
        data.training_title = tr.title;
      }
    }

    if (data.completed_at) {
      data.status = 'valid';
    } else if (data.completed_at === null) {
      data.status = 'pending';
    }

    await item.update(data);
    const after = {
      user_id: item.user_id,
      training_id: item.training_id,
      training_title: item.training_title,
      completed_at: item.completed_at,
      expires_at: item.expires_at,
      certificate_url: item.certificate_url,
      status: item.status
    };
    await auditFromReq(req, 'update', 'user_training', item.id, item.training_title, { before, after });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE user training assignment
router.delete('/trainings/:id', authenticate, requireRole('admin', 'assessor'), requireWriteAccess(), async (req, res) => {
  try {
    const item = await UserTraining.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    const { id, training_title } = item;
    await item.destroy();
    await auditFromReq(req, 'delete', 'user_training', id, training_title, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
