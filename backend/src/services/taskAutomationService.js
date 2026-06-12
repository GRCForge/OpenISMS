const { Asset, Task, User, Assessment, Risk, PasskeyCredential, AiSystem, SubjectRequest, Incident } = require('../models');
const { Op } = require('sequelize');

/**
 * Scans the database for incomplete data and creates tasks for the responsible roles.
 * Runs automatically via cron or can be triggered manually.
 */
const runTaskAutomation = async () => {
  console.log('[Automation] Starting task automation scan...');

  try {
    // 1. Core Asset-Completeness & Risk checks
    const assets = await Asset.findAll({
      where: { status: { [Op.ne]: 'decommissioned' } },
      include: [
        { model: Assessment, order: [['created_at', 'DESC']], separate: true }
      ]
    });

    for (const asset of assets) {
      await checkAndManageAssetTasks(asset);
    }

    // 2. Security-Onboarding (MFA-Enforcement)
    await runMfaEnforcementAutomation();

    // 3. Jährliche Rezertifizierung (Asset Owner Verification)
    await runAssetReverificationAutomation();

    // 4. Mitarbeiter-Offboarding (Orphaned Resource Reassignment)
    await runOffboardingAutomation();

    // 5. EU AI Act Compliance
    await runAiSystemAutomation();

    // 6. Hochrisiken ohne Behandlungsplan (Assessor)
    await runHighRiskAutomation();

    // 7. Betroffenenanfragen nahe Frist (DPO)
    await runSubjectRequestAutomation();

    // 8. Kritische/Hohe Vorfälle ohne Bearbeitung (IT-Staff)
    await runCriticalIncidentAutomation();

    console.log('[Automation] Scan complete.');
  } catch (error) {
    console.error('[Automation] Error during task automation:', error);
  }
};

/**
 * Checks an asset for missing data and manages (creates/completes) related tasks.
 */
const checkAndManageAssetTasks = async (asset) => {
  if (!asset) return;

  if (asset.status === 'decommissioned') {
    await Task.update(
      { status: 'cancelled' },
      {
        where: {
          related_type: 'asset',
          related_id: asset.id,
          status: { [Op.in]: ['open', 'in_progress'] }
        }
      }
    );
    return;
  }
  
  // Reload if needed to get assessments
  if (asset.Assessments === undefined) {
    asset = await Asset.findByPk(asset.id, {
      include: [{ model: Assessment, order: [['created_at', 'DESC']] }]
    });
  }

  // 1. Completeness Check (Owner/Assessor task)
  const incompleteFields = [];
  if (!asset.description) incompleteFields.push('Beschreibung');
  if (!asset.classification) incompleteFields.push('Klassifizierung');
  if (!asset.location && asset.hosting_type === 'on-premise') incompleteFields.push('Standort');
  
  const stammdatenTitle = `Stammdaten vervollständigen: ${asset.name}`;
  if (incompleteFields.length > 0) {
    const description = `Folgende Felder fehlen oder sind unvollständig: ${incompleteFields.join(', ')}.`;
    // If owner is set, assign to individual, otherwise to owner role (conceptual) or first admin
    // For now, we prefer individual owner if set
    await createUniqueTask(stammdatenTitle, description, 'high', asset.owner_id, 'owner', 'asset', asset.id, ['Stammdaten']);
  } else {
    await completeRelatedTask('asset', asset.id, 'Stammdaten vervollständigen:');
  }

  // 2. Privacy Check (DPO task) -> Assigned to ROLE 'dpo'
  const vvtTitle = `Datenschutz-Dokumentation (VVT): ${asset.name}`;
  if (asset.data_category !== 'none' && (asset.vvt_status === 'none' || asset.vvt_status === 'pending')) {
    const description = `Das Asset verarbeitet personenbezogene Daten (${asset.data_category}), aber der VVT-Status ist noch nicht 'complete'. Bitte Verarbeitungsverzeichnis prüfen.`;
    await createUniqueTask(vvtTitle, description, 'medium', null, 'dpo', 'asset', asset.id, ['Datenschutz', 'VVT']);
  } else {
    await completeRelatedTask('asset', asset.id, 'Datenschutz-Dokumentation (VVT):');
  }

  // 3. Risk Assessment Check (Assessor task) -> Assigned to ROLE 'assessor'
  const lastAssessment = asset.Assessments?.[0];
  const needsAssessment = !lastAssessment || (new Date() - new Date(lastAssessment.created_at) > 365 * 24 * 60 * 60 * 1000);
  const riskTitle = `Risikobewertung fällig: ${asset.name}`;
  
  if (needsAssessment) {
    const description = lastAssessment 
      ? `Die letzte Risikobewertung ist über ein Jahr alt (${new Date(lastAssessment.created_at).toLocaleDateString()}). Bitte neues Review durchführen.`
      : `Für dieses Asset wurde noch nie eine Risikobewertung (CIA) durchgeführt.`;
    await createUniqueTask(riskTitle, description, 'high', null, 'assessor', 'asset', asset.id, ['Risiko', 'Review']);
  } else {
    await completeRelatedTask('asset', asset.id, 'Risikobewertung fällig:');
  }
};

/**
 * Marks an automated task as 'done' if the condition is no longer met.
 */
async function completeRelatedTask(relatedType, relatedId, titlePrefix) {
  const task = await Task.findOne({
    where: {
      related_type: relatedType,
      related_id: relatedId,
      title: { [Op.like]: `${titlePrefix}%` },
      status: { [Op.notIn]: ['done', 'cancelled'] }
    }
  });

  if (task) {
    await task.update({ 
      status: 'done',
      description: task.description + '\n\n[System] Automatisch als erledigt markiert, da die Daten vervollständigt wurden.'
    });
  }
}

/**
 * Creates a task only if it doesn't already exist for this relation and title.
 */
async function createUniqueTask(title, description, priority, assignedToId, assignedRole, relatedType, relatedId, tags) {
  const existing = await Task.findOne({
    where: {
      related_type: relatedType,
      related_id: relatedId,
      title, // Exact title match for duplicates
      status: { [Op.notIn]: ['done', 'cancelled'] }
    }
  });

  if (existing) return false;

  await Task.create({
    title,
    description,
    priority,
    assigned_to_id: assignedToId || null,
    assigned_role: assignedRole || null,
    related_type: relatedType,
    related_id: relatedId,
    tags,
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) // 1 week deadline
  });

  return true;
}

/**
 * Automates MFA enforcement check for users registered for more than 7 days.
 */
async function runMfaEnforcementAutomation() {
  console.log('[Automation] Running MFA Enforcement scan...');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const users = await User.findAll({
    where: {
      active: true,
      created_at: { [Op.lt]: sevenDaysAgo }
    }
  });

  for (const user of users) {
    let hasMfa = user.totp_enabled;
    if (!hasMfa) {
      const passkeyCount = await PasskeyCredential.count({ where: { user_id: user.id } });
      hasMfa = passkeyCount > 0;
    }

    const taskTitle = `MFA einrichten: ${user.name}`;
    if (!hasMfa) {
      const description = `Ihr Benutzerkonto wurde vor über einer Woche erstellt (${new Date(user.created_at).toLocaleDateString()}), aber Sie haben noch keine Multi-Faktor-Authentifizierung (MFA) eingerichtet. Bitte aktivieren Sie TOTP oder einen Passkey in Ihrem Profil, um Ihr Konto zu sichern.`;
      await createUniqueTask(taskTitle, description, 'high', user.id, null, 'user', user.id, ['Sicherheit', 'MFA']);
    } else {
      await completeRelatedTask('user', user.id, `MFA einrichten: ${user.name}`);
    }
  }
}

/**
 * Automates annual asset re-verification workflow.
 */
async function runAssetReverificationAutomation() {
  console.log('[Automation] Running Asset Rezertifizierung scan...');
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const assets = await Asset.findAll({
    where: {
      status: 'active',
      [Op.or]: [
        { last_reviewed_at: { [Op.lt]: oneYearAgo } },
        {
          last_reviewed_at: null,
          created_at: { [Op.lt]: thirtyDaysAgo }
        }
      ]
    }
  });

  for (const asset of assets) {
    const taskTitle = `Asset-Verifizierung fällig: ${asset.name}`;
    const description = `Bitte überprüfen und verifizieren Sie die Stammdaten, Klassifizierung und Zuständigkeiten des Assets „${asset.name}". Gehen Sie dazu auf die Asset-Detailseite und klicken Sie auf „Daten verifizieren".`;
    await createUniqueTask(taskTitle, description, 'medium', asset.owner_id, 'owner', 'asset', asset.id, ['Governance', 'Rezertifizierung']);
  }
}

/**
 * Automates employee offboarding orphaned resources check.
 */
async function runOffboardingAutomation() {
  console.log('[Automation] Running Mitarbeiter-Offboarding scan...');

  const inactiveUsers = await User.findAll({
    where: { active: false }
  });

  for (const user of inactiveUsers) {
    const assetsOwned = await Asset.findAll({ where: { owner_id: user.id, status: { [Op.ne]: 'decommissioned' } } });
    const assetsAssessed = await Asset.findAll({ where: { assessor_id: user.id, status: { [Op.ne]: 'decommissioned' } } });
    const risksOwned = await Risk.findAll({ where: { owner_id: user.id, status: { [Op.ne]: 'closed' } } });
    const aiSystemsOwned = await AiSystem.findAll({ where: { owner_id: user.id } });

    const totalCount = assetsOwned.length + assetsAssessed.length + risksOwned.length + aiSystemsOwned.length;
    const taskTitle = `Ressourcen-Übergabe für ausgeschiedenen Mitarbeiter: ${user.name}`;

    if (totalCount > 0) {
      let description = `Der Mitarbeiter ${user.name} wurde deaktiviert, ist aber noch für folgende Ressourcen eingetragen:\n\n`;
      if (assetsOwned.length > 0) {
        description += `**Eigentümer von Assets:**\n` + assetsOwned.map(a => `- ${a.name} (ID: ${a.id})`).join('\n') + `\n\n`;
      }
      if (assetsAssessed.length > 0) {
        description += `**Bewerter von Assets:**\n` + assetsAssessed.map(a => `- ${a.name} (ID: ${a.id})`).join('\n') + `\n\n`;
      }
      if (risksOwned.length > 0) {
        description += `**Eigentümer von Risiken:**\n` + risksOwned.map(r => `- ${r.title} (${r.ref || r.id})`).join('\n') + `\n\n`;
      }
      if (aiSystemsOwned.length > 0) {
        description += `**Verantwortlicher von KI-Systemen:**\n` + aiSystemsOwned.map(ai => `- ${ai.name} (ID: ${ai.id})`).join('\n') + `\n\n`;
      }
      description += `Bitte weisen Sie diese Ressourcen anderen Mitarbeitern zu, um lückenlose Verantwortlichkeiten zu gewährleisten.`;

      await createUniqueTask(taskTitle, description, 'high', null, 'admin', 'user', user.id, ['Offboarding', 'Governance']);
    } else {
      await completeRelatedTask('user', user.id, `Ressourcen-Übergabe für ausgeschiedenen Mitarbeiter: ${user.name}`);
    }
  }
}

/**
 * Scans AI systems for compliance gaps (EU AI Act) and creates tasks.
 */
async function runAiSystemAutomation() {
  console.log('[Automation] Running EU AI Act compliance scan...');
  
  const systems = await AiSystem.findAll();
  
  for (const system of systems) {
    // 1. High Risk / Prohibited Conformity Check
    if ((system.risk_category === 'high_risk' || system.risk_category === 'prohibited') && 
        (system.conformity_status === 'not_assessed' || system.conformity_status === 'non_compliant')) {
      const taskTitle = `Konformitätsprüfung fällig: KI-System ${system.name}`;
      const description = `Das KI-System „${system.name}“ ist als '${system.risk_category === 'high_risk' ? 'Hohes Risiko (Anhang III)' : 'Verboten (Art. 5)'}' eingestuft, aber der Konformitätsstatus ist '${system.conformity_status === 'not_assessed' ? 'Nicht bewertet' : 'Nicht konform'}'. Bitte führen Sie eine Konformitätsbewertung gemäß EU AI Act durch.`;
      await createUniqueTask(taskTitle, description, 'high', system.owner_id, 'assessor', 'ai_system', system.id, ['Compliance', 'AI Act', 'Risiko']);
    } else {
      await completeRelatedTask('ai_system', system.id, `Konformitätsprüfung fällig: KI-System`);
    }

    // 2. High Risk Documentation Check
    if (system.risk_category === 'high_risk' && !system.documentation_url) {
      const taskTitle = `Technische Dokumentation fehlt: KI-System ${system.name}`;
      const description = `Das KI-System „${system.name}“ ist als 'Hohes Risiko (Anhang III)' eingestuft, besitzt aber keine hinterlegte Dokumentations-URL. Gemäß EU AI Act ist eine detaillierte technische Dokumentation verpflichtend.`;
      await createUniqueTask(taskTitle, description, 'high', system.owner_id, 'assessor', 'ai_system', system.id, ['Compliance', 'AI Act', 'Dokumentation']);
    } else {
      await completeRelatedTask('ai_system', system.id, `Technische Dokumentation fehlt: KI-System`);
    }

    // 3. Review Interval Check (Annual review)
    const needsReview = !system.last_review_date || (new Date() - new Date(system.last_review_date) > 365 * 24 * 60 * 60 * 1000);
    if (needsReview) {
      const taskTitle = `KI-System Überprüfung fällig: ${system.name}`;
      const description = system.last_review_date
        ? `Die letzte Überprüfung dieses KI-Systems ist über ein Jahr alt (${new Date(system.last_review_date).toLocaleDateString()}). Bitte führen Sie eine Überprüfung der Risikoklassifikation und des Konformitätsstatus durch.`
        : `Für dieses KI-System wurde noch keine Überprüfung durchgeführt. Bitte prüfen Sie die Risikoklassifikation und den Konformitätsstatus.`;
      await createUniqueTask(taskTitle, description, 'medium', system.owner_id, 'owner', 'ai_system', system.id, ['Governance', 'AI Act', 'Review']);
    } else {
      await completeRelatedTask('ai_system', system.id, `KI-System Überprüfung fällig:`);
    }
  }
}

/**
 * Creates tasks for high/critical risks that have no treatment plan after 14 days.
 * Assigned to role 'assessor'.
 */
async function runHighRiskAutomation() {
  console.log('[Automation] Running High-Risk treatment scan...');
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const risks = await Risk.findAll({
    where: {
      status: { [Op.in]: ['open', 'in_treatment'] },
      inherent_level: { [Op.in]: ['high', 'critical'] },
      treatment: 'mitigate',
      [Op.or]: [
        { treatment_plan: null },
        { treatment_plan: '' },
      ],
      created_at: { [Op.lt]: fourteenDaysAgo },
    },
  });

  for (const risk of risks) {
    const taskTitle = `Behandlungsplan fehlt: ${risk.title}`;
    const description = `Das Risiko „${risk.title}" (${risk.inherent_level === 'critical' ? 'Kritisch' : 'Hoch'}) existiert seit über 14 Tagen ohne dokumentierten Behandlungsplan. Bitte erfassen Sie konkrete Maßnahmen zur Risikominimierung.`;
    await createUniqueTask(taskTitle, description, risk.inherent_level === 'critical' ? 'high' : 'medium', risk.owner_id, 'assessor', 'risk', risk.id, ['Risiko', 'Behandlungsplan']);
  }

  // Complete tasks for risks that now have a plan
  const risksWithPlan = await Risk.findAll({
    where: {
      status: { [Op.in]: ['open', 'in_treatment', 'accepted', 'closed'] },
      treatment_plan: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] },
    },
  });
  for (const risk of risksWithPlan) {
    await completeRelatedTask('risk', risk.id, 'Behandlungsplan fehlt:');
  }
}

/**
 * Creates tasks for subject requests (Art. 15-22 DSGVO) approaching their 30-day deadline.
 * Assigned to role 'dpo'.
 */
async function runSubjectRequestAutomation() {
  console.log('[Automation] Running Betroffenenanfragen (DSGVO) scan...');
  const today = new Date();
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

  // Open requests with due_date within 7 days OR overdue
  const requests = await SubjectRequest.findAll({
    where: {
      status: { [Op.in]: ['received', 'in_progress'] },
      [Op.or]: [
        { due_date: { [Op.lte]: sevenDaysFromNow.toISOString().slice(0, 10) } },
        { due_date: null, received_date: { [Op.lte]: new Date(today - 23 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) } },
      ],
    },
  });

  for (const req of requests) {
    const deadlineStr = req.due_date
      ? new Date(req.due_date).toLocaleDateString('de-DE')
      : 'unbekannt (Eingang vor über 23 Tagen)';
    const isOverdue = req.due_date && new Date(req.due_date) < today;
    const taskTitle = `Betroffenenanfrage fällig: ${req.ref || req.id} (${req.type})`;
    const description = isOverdue
      ? `Die Betroffenenanfrage „${req.ref || req.id}" (${req.requester_name}) ist seit dem ${deadlineStr} überfällig. Gemäß Art. 12 DSGVO muss innerhalb von 30 Tagen geantwortet werden.`
      : `Die Betroffenenanfrage „${req.ref || req.id}" (${req.requester_name}) hat eine Frist bis ${deadlineStr}. Bitte zeitnah bearbeiten.`;
    await createUniqueTask(taskTitle, description, isOverdue ? 'high' : 'medium', null, 'dpo', 'subject_request', req.id, ['Datenschutz', 'DSGVO', 'Betroffenenanfrage']);
  }

  // Complete tasks for requests that are resolved/completed/rejected
  const closedRequests = await SubjectRequest.findAll({
    where: { status: { [Op.in]: ['completed', 'rejected'] } },
  });
  for (const req of closedRequests) {
    await completeRelatedTask('subject_request', req.id, 'Betroffenenanfrage fällig:');
  }
}

/**
 * Creates tasks for critical/high severity incidents that remain unresolved after 3 days.
 * Assigned to role 'it-staff'.
 */
async function runCriticalIncidentAutomation() {
  console.log('[Automation] Running Critical Incident scan...');
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const incidents = await Incident.findAll({
    where: {
      severity: { [Op.in]: ['high', 'critical'] },
      status: { [Op.in]: ['reported', 'investigating'] },
      created_at: { [Op.lt]: threeDaysAgo },
    },
  });

  for (const incident of incidents) {
    const taskTitle = `Offener Vorfall eskaliert: ${incident.title}`;
    const sevLabel = incident.severity === 'critical' ? 'Kritischer' : 'Schwerwiegender';
    const description = `${sevLabel} Vorfall „${incident.title}" ist seit über 3 Tagen im Status „${incident.status === 'reported' ? 'Gemeldet' : 'In Untersuchung'}" ohne Eindämmung. Bitte umgehend bearbeiten und Status aktualisieren.`;
    await createUniqueTask(taskTitle, description, incident.severity === 'critical' ? 'high' : 'medium', incident.assignee_id, 'it-staff', 'incident', incident.id, ['Vorfall', 'Eskalation']);
  }

  // Complete tasks for contained/resolved/closed incidents
  const resolvedIncidents = await Incident.findAll({
    where: { status: { [Op.in]: ['contained', 'resolved', 'closed'] } },
  });
  for (const incident of resolvedIncidents) {
    await completeRelatedTask('incident', incident.id, 'Offener Vorfall eskaliert:');
  }
}

module.exports = { runTaskAutomation, checkAndManageAssetTasks };

