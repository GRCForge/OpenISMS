const sequelize = require('../config/database');
const User = require('./User');
const Asset = require('./Asset');
const Assessment = require('./Assessment');
const Reminder = require('./Reminder');
const AuditLog = require('./AuditLog');
const Document = require('./Document');
const Comment = require('./Comment');
const Vendor = require('./Vendor');
const VendorContact = require('./VendorContact');
const Policy = require('./Policy');
const PolicyVersion = require('./PolicyVersion');
const Setting = require('./Setting');
const Risk = require('./Risk');
const Notification = require('./Notification');
const Control = require('./Control');
const Threat = require('./Threat');
const ThreatSource = require('./ThreatSource');
const ThreatAdvisory = require('./ThreatAdvisory');
const ThreatAdvisoryAsset = require('./ThreatAdvisoryAsset');
const RiskControl = require('./RiskControl');
const RiskMethodology = require('./RiskMethodology');
const RiskCategory = require('./RiskCategory');
const RiskScenario = require('./RiskScenario');
const RiskTreatmentItem = require('./RiskTreatmentItem');
const RiskAcceptanceRequest = require('./RiskAcceptanceRequest');
const RiskAssessmentHistory = require('./RiskAssessmentHistory');
const RiskKri = require('./RiskKri');
const RiskReviewFlag = require('./RiskReviewFlag');
const JobRun = require('./JobRun');
const Vulnerability = require('./Vulnerability');
const Incident = require('./Incident');
const VvtEntry = require('./VvtEntry');
const Task = require('./Task');
const DataFlow = require('./DataFlow');
const PasskeyCredential = require('./PasskeyCredential');
const ApiToken = require('./ApiToken');
const Template = require('./Template');
const DiscoveredSoftware = require('./DiscoveredSoftware');
const SubjectRequest = require('./SubjectRequest');
const PolicyAcknowledgment = require('./PolicyAcknowledgment');
const ReviewSignOff = require('./ReviewSignOff');
const LegalRequirement = require('./LegalRequirement');
const PentestProject = require('./PentestProject');
const PentestFinding = require('./PentestFinding');
const TisaxAssessment = require('./TisaxAssessment');
const TisaxRequirement = require('./TisaxRequirement');
const DoraThirdParty = require('./DoraThirdParty');
const DoraResilienceTest = require('./DoraResilienceTest');
const AiSystem = require('./AiSystem');
const BcmProcess = require('./BcmProcess');
const BcmExercise = require('./BcmExercise');
const Dsfa = require('./Dsfa');
const Iso27001Control = require('./Iso27001Control');
const BsiRequirement = require('./BsiRequirement');
const BsiCatalog = require('./BsiCatalog');
const BsiCatalogModule = require('./BsiCatalogModule');
const BsiCatalogRequirement = require('./BsiCatalogRequirement');
const BsiInformationDomain = require('./BsiInformationDomain');
const BsiTargetObject = require('./BsiTargetObject');
const BsiModeling = require('./BsiModeling');
const BsiRequirementDocument = require('./BsiRequirementDocument');
const Nis2Measure = require('./Nis2Measure');
const Nis2SelfCheckItem = require('./Nis2SelfCheckItem');
const C5Criterion = require('./C5Criterion');
const CustomRole = require('./CustomRole');
const OidcClaimMapping = require('./OidcClaimMapping');
const Kpi = require('./Kpi');
const KpiMeasurement = require('./KpiMeasurement');
const Audit = require('./Audit');
const AuditFinding = require('./AuditFinding');
const UserTraining = require('./UserTraining');
const Training = require('./Training');
const Group = require('./Group');
const GroupMember = require('./GroupMember');
const PushSubscription = require('./PushSubscription');
const VendorTriageRun = require('./VendorTriageRun');
const VendorFinding = require('./VendorFinding');
const DocumentAnalysisRun = require('./DocumentAnalysisRun');
const DocumentAnalysisFinding = require('./DocumentAnalysisFinding');
const ControlRequirement = require('./ControlRequirement');
const BcmProcessAsset = require('./BcmProcessAsset');

// Associations
Training.hasMany(UserTraining, { as: 'assignments', foreignKey: 'training_id', onDelete: 'CASCADE' });
UserTraining.belongsTo(Training, { as: 'training', foreignKey: 'training_id' });
Policy.hasMany(PolicyVersion, { as: 'history', foreignKey: 'policy_id' });
PolicyVersion.belongsTo(Policy, { foreignKey: 'policy_id' });

User.hasMany(Notification, { as: 'notifications', foreignKey: 'user_id' });
Notification.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
Notification.belongsTo(User, { as: 'actor', foreignKey: 'actor_id' });

User.hasMany(ApiToken, { as: 'apiTokens', foreignKey: 'user_id', onDelete: 'CASCADE' });
ApiToken.belongsTo(User, { as: 'user', foreignKey: 'user_id' });

Asset.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
Asset.belongsTo(User, { as: 'assessor', foreignKey: 'assessor_id' });
Asset.hasMany(Assessment, { foreignKey: 'asset_id' });
Asset.hasMany(Reminder, { foreignKey: 'asset_id' });
Asset.hasMany(Document, { foreignKey: 'asset_id' });
Asset.hasMany(Comment, { foreignKey: 'asset_id' });
Asset.belongsTo(Vendor, { as: 'vendorContact', foreignKey: 'vendor_id' });

Assessment.belongsTo(Asset, { foreignKey: 'asset_id' });
Assessment.belongsTo(User, { as: 'assessorUser', foreignKey: 'assessor_id' });
Assessment.hasMany(Reminder, { foreignKey: 'assessment_id' });

Reminder.belongsTo(Asset, { foreignKey: 'asset_id' });
Reminder.belongsTo(Assessment, { foreignKey: 'assessment_id' });
Reminder.belongsTo(User, { as: 'acknowledgedByUser', foreignKey: 'acknowledged_by' });
Reminder.belongsTo(Task, { as: 'task', foreignKey: 'task_id' });
Task.hasOne(Reminder, { foreignKey: 'task_id' });

Document.belongsTo(Asset, { foreignKey: 'asset_id' });
Document.belongsTo(User, { as: 'uploader', foreignKey: 'uploaded_by' });

Comment.belongsTo(Asset, { foreignKey: 'asset_id' });
Comment.belongsTo(User, { as: 'author', foreignKey: 'user_id' });
Comment.hasMany(Comment, { as: 'replies', foreignKey: 'parent_id' });
Comment.belongsTo(Comment, { as: 'parent', foreignKey: 'parent_id' });

Vendor.hasMany(VendorContact, { as: 'contacts', foreignKey: 'vendor_id' });
VendorContact.belongsTo(Vendor, { foreignKey: 'vendor_id' });
Vendor.belongsTo(User, { as: 'assessedBy', foreignKey: 'assessed_by_id' });
Vendor.hasMany(Document, { foreignKey: 'vendor_id' });
Document.belongsTo(Vendor, { foreignKey: 'vendor_id' });

// Vendor Triage associations
Vendor.hasMany(VendorTriageRun, { as: 'triageRuns', foreignKey: 'vendor_id' });
VendorTriageRun.belongsTo(Vendor, { foreignKey: 'vendor_id' });
VendorTriageRun.belongsTo(Document, { as: 'document', foreignKey: 'document_id' });
Document.hasMany(VendorTriageRun, { as: 'triageRuns', foreignKey: 'document_id' });
VendorTriageRun.belongsTo(User, { as: 'triggeredBy', foreignKey: 'triggered_by_id' });
VendorTriageRun.hasMany(VendorFinding, { as: 'findings', foreignKey: 'triage_run_id' });
VendorFinding.belongsTo(VendorTriageRun, { foreignKey: 'triage_run_id' });
VendorFinding.belongsTo(Vendor, { foreignKey: 'vendor_id' });

// Document/Policy Analysis associations (separate engine from vendor triage —
// subject_type/subject_id is a polymorphic reference across Document/Policy, so
// there is deliberately no belongsTo to either of those two models here).
DocumentAnalysisRun.belongsTo(User, { as: 'triggeredBy', foreignKey: 'triggered_by_id' });
DocumentAnalysisRun.hasMany(DocumentAnalysisFinding, { as: 'findings', foreignKey: 'run_id' });
DocumentAnalysisFinding.belongsTo(DocumentAnalysisRun, { foreignKey: 'run_id' });

// Policy - Asset Mapping (Many-to-Many)
Policy.belongsToMany(Asset, { through: 'policy_assets', as: 'assets', foreignKey: 'policy_id' });
Asset.belongsToMany(Policy, { through: 'policy_assets', as: 'policies', foreignKey: 'asset_id' });

// Policy - Control Mapping (TOMs)
Policy.belongsToMany(Control, { through: 'policy_controls', as: 'controls', foreignKey: 'policy_id' });
Control.belongsToMany(Policy, { through: 'policy_controls', as: 'policies', foreignKey: 'control_id' });

// Risiko-Verknuepfungen (Risikoregister)
Risk.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
Risk.belongsTo(User, { as: 'acceptedBy', foreignKey: 'accepted_by_id' });
Risk.belongsTo(Document, { as: 'acceptanceDocument', foreignKey: 'acceptance_document_id' });
// Version der Risikomethodik, nach der das Risiko bewertet ist. RESTRICT: eine
// Version, an der Bewertungen haengen, darf nicht verschwinden.
Risk.belongsTo(RiskMethodology, { as: 'methodology', foreignKey: 'methodology_id', onDelete: 'RESTRICT' });
RiskMethodology.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id' });

// Jede Speicherung eines Risikos - Formular, MCP, Import, Uebernahme aus einer
// Warnmeldung - laeuft hier durch: Risiken ohne Version bekommen die aktive,
// Wahrscheinlichkeit und Auswirkung werden gegen die Skala IHRER Version geprueft
// und die Stufen nach deren Schwellen berechnet. Ohne den zentralen Hook haette
// jeder Schreibweg eine eigene Kopie der Regeln (der MCP-Weg rechnete bis 3.5.1
// mit einer eigenen, abweichenden Schwelle). Lazy require: der Dienst braucht
// die Modelle.
Risk.addHook('beforeSave', 'riskMethodology', async (risk, options) => {
  await require('../services/riskMethodology').applyToRisk(risk, options);
});
Risk.belongsToMany(Asset, { through: 'risk_assets', as: 'assets', foreignKey: 'risk_id' });
Asset.belongsToMany(Risk, { through: 'risk_assets', as: 'risks', foreignKey: 'asset_id' });

Risk.belongsToMany(VvtEntry, { through: 'risk_vvt', as: 'vvtEntries', foreignKey: 'risk_id' });
VvtEntry.belongsToMany(Risk, { through: 'risk_vvt', as: 'risks', foreignKey: 'vvt_id' });

// Bedrohungen (M:N) und Controls (M:N mit Wirksamkeit)
Risk.belongsToMany(Threat, { through: 'risk_threats', as: 'threats', foreignKey: 'risk_id' });
Threat.belongsToMany(Risk, { through: 'risk_threats', as: 'risks', foreignKey: 'threat_id' });
Risk.belongsToMany(Control, { through: RiskControl, as: 'controls', foreignKey: 'risk_id', otherKey: 'control_id' });
Control.belongsToMany(Risk, { through: RiskControl, as: 'risks', foreignKey: 'control_id', otherKey: 'risk_id' });

// Vulnerabilities and risk scenarios (3.7.0): a scenario is asset(s) x threat x
// vulnerability. Scenarios go with their risk (CASCADE). A threat or
// vulnerability in use is not deleted silently: the vulnerability service
// refuses (409) and threats have no delete route; SET NULL is the fallback for
// anything that bypasses both.
Vulnerability.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id' });
Vulnerability.belongsToMany(Asset, { through: 'vulnerability_assets', as: 'assets', foreignKey: 'vulnerability_id', otherKey: 'asset_id' });
Asset.belongsToMany(Vulnerability, { through: 'vulnerability_assets', as: 'vulnerabilities', foreignKey: 'asset_id', otherKey: 'vulnerability_id' });
Risk.hasMany(RiskScenario, { as: 'scenarios', foreignKey: 'risk_id', onDelete: 'CASCADE', hooks: true });
RiskScenario.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskScenario.belongsTo(Threat, { as: 'threat', foreignKey: 'threat_id', onDelete: 'SET NULL' });
RiskScenario.belongsTo(Vulnerability, { as: 'vulnerability', foreignKey: 'vulnerability_id', onDelete: 'SET NULL' });
Vulnerability.hasMany(RiskScenario, { as: 'scenarios', foreignKey: 'vulnerability_id' });
RiskScenario.belongsToMany(Asset, { through: 'risk_scenario_assets', as: 'assets', foreignKey: 'scenario_id', otherKey: 'asset_id' });
Asset.belongsToMany(RiskScenario, { through: 'risk_scenario_assets', as: 'riskScenarios', foreignKey: 'asset_id', otherKey: 'scenario_id' });
Risk.belongsTo(User, { as: 'residualOverrideBy', foreignKey: 'residual_override_by_id' });

// Risk treatment plan and acceptance workflow (3.8.0). Both go with their risk
// (CASCADE). A deleted control, task, user or group does not take the item or
// request with it (SET NULL); the audit log keeps who did what.
Risk.hasMany(RiskTreatmentItem, { as: 'treatmentItems', foreignKey: 'risk_id', onDelete: 'CASCADE', hooks: true });
RiskTreatmentItem.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskTreatmentItem.belongsTo(User, { as: 'responsibleUser', foreignKey: 'responsible_user_id', onDelete: 'SET NULL' });
RiskTreatmentItem.belongsTo(Group, { as: 'responsibleGroup', foreignKey: 'responsible_group_id', onDelete: 'SET NULL' });
RiskTreatmentItem.belongsTo(Control, { as: 'control', foreignKey: 'control_id', onDelete: 'SET NULL' });
RiskTreatmentItem.belongsTo(Task, { as: 'task', foreignKey: 'task_id', onDelete: 'SET NULL' });
RiskTreatmentItem.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id', onDelete: 'SET NULL' });
Risk.hasMany(RiskAcceptanceRequest, { as: 'acceptanceRequests', foreignKey: 'risk_id', onDelete: 'CASCADE', hooks: true });
RiskAcceptanceRequest.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskAcceptanceRequest.belongsTo(User, { as: 'requestedBy', foreignKey: 'requested_by_id', onDelete: 'SET NULL' });
RiskAcceptanceRequest.belongsTo(User, { as: 'decidedBy', foreignKey: 'decided_by_id', onDelete: 'SET NULL' });
RiskAcceptanceRequest.belongsTo(User, { as: 'ownerConfirmedBy', foreignKey: 'owner_confirmed_by_id', onDelete: 'SET NULL' });

// A task created from a treatment item keeps the item status in step (task
// done -> item implemented, logged). Every write path of tasks - REST, MCP,
// reminders, automation - runs through these hooks; bulk updates included.
// Lazy require: the service needs the models.
Task.addHook('afterUpdate', 'riskTreatmentSync', async (task, options) => {
  await require('../services/riskTreatmentService').onTaskUpdated(task, options);
});
Task.addHook('afterBulkUpdate', 'riskTreatmentSync', async (options) => {
  await require('../services/riskTreatmentService').onTasksBulkUpdated(options);
});

// Risk monitoring (3.9.0). History, KRIs and review flags go with their risk
// (CASCADE); a deleted KPI takes its KRI links with it. A deleted task or user
// does not take a flag with it (SET NULL).
Risk.hasMany(RiskAssessmentHistory, { as: 'assessmentHistory', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskAssessmentHistory.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskAssessmentHistory.belongsTo(User, { as: 'user', foreignKey: 'user_id', onDelete: 'SET NULL' });
RiskAssessmentHistory.belongsTo(RiskMethodology, { as: 'methodology', foreignKey: 'methodology_id', onDelete: 'SET NULL' });
Risk.hasMany(RiskKri, { as: 'kris', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskKri.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskKri.belongsTo(Kpi, { as: 'kpi', foreignKey: 'kpi_id', onDelete: 'CASCADE' });
Kpi.hasMany(RiskKri, { as: 'riskLinks', foreignKey: 'kpi_id', onDelete: 'CASCADE' });
RiskKri.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id', onDelete: 'SET NULL' });
Risk.hasMany(RiskReviewFlag, { as: 'reviewFlags', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskReviewFlag.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id', onDelete: 'CASCADE' });
RiskReviewFlag.belongsTo(Task, { as: 'task', foreignKey: 'task_id', onDelete: 'SET NULL' });
RiskReviewFlag.belongsTo(User, { as: 'resolvedBy', foreignKey: 'resolved_by_id', onDelete: 'SET NULL' });

// Assessment history: every save of a risk - form, MCP, import, carry-over,
// threat advisory - is compared with its previous values; a change of the
// gross, net or target assessment becomes one immutable history row
// (services/riskHistoryService.js). Registered after the methodology hook, so
// the levels it computes are part of the comparison. Errors are logged there,
// never thrown: the risk save itself has happened.
Risk.addHook('beforeCreate', 'riskMonitoring', (risk) => {
  if (!risk.last_reviewed_at) risk.last_reviewed_at = new Date();
  // The ref hook (models/Risk.js) saves again inside afterCreate; that save is
  // part of the creation, not a change (riskHistoryService.onRiskUpdated).
  risk._historyCreating = true;
});
Risk.addHook('afterCreate', 'riskHistory', async (risk, options) => {
  await require('../services/riskHistoryService').onRiskCreated(risk, options);
});
Risk.addHook('afterUpdate', 'riskHistory', async (risk, options) => {
  await require('../services/riskHistoryService').onRiskUpdated(risk, options);
});
// A reassessment task of a review flag that is done resolves the flag
// (services/riskMonitoringService.js). Same write paths as above.
Task.addHook('afterUpdate', 'riskReviewFlagSync', async (task, options) => {
  await require('../services/riskMonitoringService').onTaskUpdated(task, options);
});
Task.addHook('afterBulkUpdate', 'riskReviewFlagSync', async (options) => {
  await require('../services/riskMonitoringService').onTasksBulkUpdated(options);
});
// KRI evaluation on every new KPI measurement (REST and MCP) and on new CVEs
// found for an asset (nightly refresh and manual refresh alike).
KpiMeasurement.addHook('afterCreate', 'riskKri', async (measurement) => {
  await require('../services/riskMonitoringService').onKpiMeasurement(measurement);
});
Asset.addHook('afterUpdate', 'riskCveTrigger', async (asset, options) => {
  await require('../services/riskMonitoringService').onAssetUpdated(asset, options);
});

// Audit findings with a risk reference (3.9.0): a new finding linked to a
// risk flags it for reassessment.
AuditFinding.belongsToMany(Risk, { through: 'audit_finding_risks', as: 'risks', foreignKey: 'audit_finding_id', otherKey: 'risk_id' });
Risk.belongsToMany(AuditFinding, { through: 'audit_finding_risks', as: 'auditFindings', foreignKey: 'risk_id', otherKey: 'audit_finding_id' });

// Sicherheitsvorfaelle (Incident Management)
Incident.belongsTo(User, { as: 'reporter', foreignKey: 'reporter_id' });
Incident.belongsTo(User, { as: 'assignee', foreignKey: 'assignee_id' });
Incident.belongsToMany(Asset, { through: 'incident_assets', as: 'assets', foreignKey: 'incident_id' });
Asset.belongsToMany(Incident, { through: 'incident_assets', as: 'incidents', foreignKey: 'asset_id' });
Incident.belongsToMany(Risk, { through: 'incident_risks', as: 'risks', foreignKey: 'incident_id' });
Risk.belongsToMany(Incident, { through: 'incident_risks', as: 'incidents', foreignKey: 'risk_id' });
Incident.hasMany(Document, { foreignKey: 'incident_id' });
Document.belongsTo(Incident, { foreignKey: 'incident_id' });

// VVT associations
VvtEntry.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });
VvtEntry.belongsTo(Vendor, { as: 'processor', foreignKey: 'processor_id' }); // Primary DPA processor
VvtEntry.belongsToMany(Asset, { through: 'vvt_assets', as: 'assets', foreignKey: 'vvt_id' });
Asset.belongsToMany(VvtEntry, { through: 'vvt_assets', as: 'vvtEntries', foreignKey: 'asset_id' });
VvtEntry.belongsToMany(Vendor, { through: 'vvt_vendors', as: 'vendors', foreignKey: 'vvt_id' });
Vendor.belongsToMany(VvtEntry, { through: 'vvt_vendors', as: 'vvtEntries', foreignKey: 'vendor_id' });

// Enhanced Incident associations
Incident.belongsToMany(Vendor, { through: 'incident_vendors', as: 'vendors', foreignKey: 'incident_id' });
Vendor.belongsToMany(Incident, { through: 'incident_vendors', as: 'incidents', foreignKey: 'vendor_id' });
Incident.belongsToMany(VvtEntry, { through: 'incident_vvt', as: 'vvtEntries', foreignKey: 'incident_id' });
VvtEntry.belongsToMany(Incident, { through: 'incident_vvt', as: 'incidents', foreignKey: 'vvt_id' });

// Group associations
Group.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id' });
Group.belongsToMany(User, { through: GroupMember, as: 'members', foreignKey: 'group_id', otherKey: 'user_id' });
User.belongsToMany(Group, { through: GroupMember, as: 'groups', foreignKey: 'user_id', otherKey: 'group_id' });
GroupMember.belongsTo(Group, { foreignKey: 'group_id' });
GroupMember.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
Group.hasMany(GroupMember, { as: 'groupMembers', foreignKey: 'group_id', onDelete: 'CASCADE' });

// Tasks associations
Task.belongsTo(User, { as: 'assignee', foreignKey: 'assigned_to_id' });
Task.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id' });
Task.belongsTo(Group, { as: 'assignedGroup', foreignKey: 'assigned_to_group_id' });
Task.belongsTo(User, { as: 'completedBy', foreignKey: 'completed_by_id' });
Group.hasMany(Task, { as: 'tasks', foreignKey: 'assigned_to_group_id' });

// DataFlow associations
DataFlow.belongsTo(Asset, { as: 'source', foreignKey: 'source_id' });
DataFlow.belongsTo(Asset, { as: 'target', foreignKey: 'target_id' });

// Passkey associations
User.hasMany(PasskeyCredential, { as: 'passkeys', foreignKey: 'user_id' });
PasskeyCredential.belongsTo(User, { foreignKey: 'user_id' });

// Template associations
Template.belongsTo(User, { as: 'uploader', foreignKey: 'uploaded_by' });

// SubjectRequest associations
SubjectRequest.belongsTo(User, { as: 'handler', foreignKey: 'handler_id' });
User.hasMany(SubjectRequest, { as: 'handledRequests', foreignKey: 'handler_id' });

// PolicyAcknowledgment associations
PolicyAcknowledgment.belongsTo(Policy, { foreignKey: 'policy_id' });
Policy.hasMany(PolicyAcknowledgment, { as: 'acknowledgments', foreignKey: 'policy_id' });
PolicyAcknowledgment.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
User.hasMany(PolicyAcknowledgment, { as: 'policyAcknowledgments', foreignKey: 'user_id' });

// ReviewSignOff associations
ReviewSignOff.belongsTo(User, { as: 'approvedBy', foreignKey: 'approved_by_id' });
User.hasMany(ReviewSignOff, { as: 'signOffs', foreignKey: 'approved_by_id' });

// LegalRequirement associations
LegalRequirement.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
User.hasMany(LegalRequirement, { as: 'legalRequirements', foreignKey: 'owner_id' });

// PentestProject associations
PentestProject.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
PentestProject.hasMany(PentestFinding, { as: 'findings', foreignKey: 'project_id' });
PentestFinding.belongsTo(PentestProject, { foreignKey: 'project_id' });
PentestFinding.belongsTo(User, { as: 'assignee', foreignKey: 'assigned_to_id' });

// TisaxAssessment associations
TisaxAssessment.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });

// DoraThirdParty (no FK associations needed)

// AiSystem associations
AiSystem.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
AiSystem.belongsTo(Vendor, { as: 'vendor', foreignKey: 'vendor_id' });


// BcmProcess associations
BcmProcess.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
BcmProcess.hasMany(BcmExercise, { as: 'exercises', foreignKey: 'process_id' });
BcmExercise.belongsTo(BcmProcess, { as: 'process', foreignKey: 'process_id' });

// Dsfa associations
VvtEntry.hasOne(Dsfa, { as: 'dsfa', foreignKey: 'vvt_id' });
Dsfa.belongsTo(VvtEntry, { foreignKey: 'vvt_id' });
Dsfa.belongsTo(User, { as: 'approver', foreignKey: 'approver_id' });

// ISO 27001 / BSI / NIS-2 / C5 associations
Iso27001Control.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
BsiRequirement.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });
// Versionierte Grundschutz-Kataloge: Module und Anforderungen gehoeren genau
// einem Katalog und gehen mit ihm (nur Vorschau-Kataloge werden je geloescht).
BsiCatalog.hasMany(BsiCatalogModule, { as: 'modules', foreignKey: 'catalog_id', onDelete: 'CASCADE' });
BsiCatalog.hasMany(BsiCatalogRequirement, { as: 'requirements', foreignKey: 'catalog_id', onDelete: 'CASCADE' });
BsiCatalogModule.belongsTo(BsiCatalog, { as: 'catalog', foreignKey: 'catalog_id' });
BsiCatalogRequirement.belongsTo(BsiCatalog, { as: 'catalog', foreignKey: 'catalog_id' });
BsiCatalog.belongsTo(User, { as: 'importedBy', foreignKey: 'imported_by_id' });
BsiCatalog.belongsTo(User, { as: 'activatedBy', foreignKey: 'activated_by_id' });
BsiRequirement.belongsTo(BsiCatalog, { as: 'catalog', foreignKey: 'catalog_id', constraints: false });
// Informationsverbund, Zielobjekte und Modellierung. RESTRICT statt CASCADE/SET NULL:
// SET NULL machte aus der Modellierung eines Zielobjekts stillschweigend eine des
// ganzen Verbunds. Keine CASCADE-Loeschung:
// Zielobjekte und Modellierungen tragen Pruefhistorie und werden nur einzeln,
// mit Audit-Eintrag entfernt (routes/bsi-domains.js).
BsiInformationDomain.belongsTo(BsiCatalog, { as: 'catalog', foreignKey: 'catalog_id', constraints: false });
BsiInformationDomain.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id', constraints: false });
BsiInformationDomain.hasMany(BsiTargetObject, { as: 'targetObjects', foreignKey: 'domain_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiInformationDomain.hasMany(BsiModeling, { as: 'modelings', foreignKey: 'domain_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiTargetObject.belongsTo(BsiInformationDomain, { as: 'domain', foreignKey: 'domain_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiTargetObject.belongsTo(Asset, { as: 'asset', foreignKey: 'asset_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Asset.hasMany(BsiTargetObject, { as: 'bsiTargetObjects', foreignKey: 'asset_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiTargetObject.hasMany(BsiModeling, { as: 'modelings', foreignKey: 'target_object_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiModeling.belongsTo(BsiInformationDomain, { as: 'domain', foreignKey: 'domain_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiModeling.belongsTo(BsiTargetObject, { as: 'targetObject', foreignKey: 'target_object_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiModeling.belongsTo(BsiCatalog, { as: 'catalog', foreignKey: 'catalog_id', constraints: false });
BsiRequirement.belongsTo(BsiInformationDomain, { as: 'domain', foreignKey: 'domain_id', constraints: false });
// IT-Grundschutz-Check: Status je Zielobjekt. RESTRICT: Ein Zielobjekt mit
// Checkdaten laesst sich nicht entfernen (bsiDomainService.removeTargetObject).
BsiRequirement.belongsTo(BsiTargetObject, { as: 'targetObject', foreignKey: 'target_object_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiTargetObject.hasMany(BsiRequirement, { as: 'checkEntries', foreignKey: 'target_object_id', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
BsiRequirement.belongsTo(Group, { as: 'responsibleGroup', foreignKey: 'responsible_group_id', constraints: false });
// Nachweise: Verknuepfung geht mit der Anforderung bzw. dem Dokument (beides
// wird nur ueber eigene, auditierte Loeschwege entfernt).
BsiRequirement.belongsToMany(Document, { through: BsiRequirementDocument, as: 'evidence', foreignKey: 'requirement_id', otherKey: 'document_id' });
Document.belongsToMany(BsiRequirement, { through: BsiRequirementDocument, as: 'bsiRequirements', foreignKey: 'document_id', otherKey: 'requirement_id' });
Nis2Measure.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });
Nis2SelfCheckItem.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });
Nis2SelfCheckItem.belongsTo(User, { as: 'answeredBy', foreignKey: 'answered_by_id' });
Nis2SelfCheckItem.belongsTo(Task, { as: 'task', foreignKey: 'task_id' });
C5Criterion.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });

// CustomRole / OIDC associations
User.belongsTo(CustomRole, { as: 'customRole', foreignKey: 'custom_role_id' });
CustomRole.hasMany(User, { as: 'users', foreignKey: 'custom_role_id' });
OidcClaimMapping.belongsTo(CustomRole, { as: 'customRole', foreignKey: 'custom_role_id' });
CustomRole.hasMany(OidcClaimMapping, { as: 'mappings', foreignKey: 'custom_role_id' });

// KPI associations
Kpi.belongsTo(User, { as: 'owner', foreignKey: 'owner_id' });
Kpi.hasMany(KpiMeasurement, { as: 'measurements', foreignKey: 'kpi_id' });
KpiMeasurement.belongsTo(Kpi, { foreignKey: 'kpi_id' });

// Audit associations
Audit.hasMany(AuditFinding, { as: 'findings', foreignKey: 'audit_id' });
AuditFinding.belongsTo(Audit, { foreignKey: 'audit_id' });
AuditFinding.belongsTo(Task, { as: 'capaTask', foreignKey: 'capa_task_id' });
AuditFinding.belongsTo(User, { as: 'assignee', foreignKey: 'assignee_id' });
Audit.hasMany(Document, { foreignKey: 'audit_id' });
Document.belongsTo(Audit, { foreignKey: 'audit_id' });

// UserTraining associations
UserTraining.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
User.hasMany(UserTraining, { as: 'trainings', foreignKey: 'user_id' });

// PushSubscription associations
User.hasMany(PushSubscription, { as: 'pushSubscriptions', foreignKey: 'user_id', onDelete: 'CASCADE' });
PushSubscription.belongsTo(User, { foreignKey: 'user_id' });

// --- Cross-Framework-Zuordnung (v3.0.0) ---
// Eine Massnahme erfuellt Anforderungen aus mehreren Regelwerken. Die Gegenseite
// ist bewusst KEIN belongsToMany: Das Ziel ist polymorph (framework +
// requirement_id), Sequelize kann darueber keine Assoziation bilden. Die Routen
// loesen es ueber den jeweiligen Katalog auf.
Control.hasMany(ControlRequirement, { as: 'requirements', foreignKey: 'control_id', onDelete: 'CASCADE' });
ControlRequirement.belongsTo(Control, { as: 'control', foreignKey: 'control_id' });
ControlRequirement.belongsTo(User, { as: 'createdBy', foreignKey: 'created_by_id' });

// --- BCM-Prozess <-> Asset (v3.0.0) ---
BcmProcess.belongsToMany(Asset, { through: BcmProcessAsset, as: 'assets', foreignKey: 'bcm_process_id', otherKey: 'asset_id' });
Asset.belongsToMany(BcmProcess, { through: BcmProcessAsset, as: 'bcmProcesses', foreignKey: 'asset_id', otherKey: 'bcm_process_id' });
BcmProcess.hasMany(BcmProcessAsset, { as: 'assetLinks', foreignKey: 'bcm_process_id', onDelete: 'CASCADE' });
BcmProcessAsset.belongsTo(BcmProcess, { as: 'process', foreignKey: 'bcm_process_id' });
BcmProcessAsset.belongsTo(Asset, { as: 'asset', foreignKey: 'asset_id' });

// --- Bedrohungslage / Threat Intelligence (NIS-2 Art. 21(2)(a), ISO 27001 A.5.7) ---
// Eine Warnmeldung haengt an genau einer Quelle, betrifft beliebig viele Assets
// und muendet im Idealfall in ein Risiko, eine Aufgabe oder einen Vorfall. Die
// drei Ziele sind bewusst optional und schliessen sich nicht aus: eine Meldung
// kann sofort ein Incident sein UND ein Risiko hinterlassen.
ThreatSource.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });
ThreatSource.hasMany(ThreatAdvisory, { as: 'advisories', foreignKey: 'source_id' });
ThreatAdvisory.belongsTo(ThreatSource, { as: 'source', foreignKey: 'source_id' });
ThreatAdvisory.belongsTo(User, { as: 'assessedBy', foreignKey: 'assessed_by_id' });
ThreatAdvisory.belongsTo(Risk, { as: 'risk', foreignKey: 'risk_id' });
ThreatAdvisory.belongsTo(Task, { as: 'task', foreignKey: 'task_id' });
ThreatAdvisory.belongsTo(Incident, { as: 'incident', foreignKey: 'incident_id' });
ThreatAdvisory.belongsToMany(Asset, { through: ThreatAdvisoryAsset, as: 'assets', foreignKey: 'advisory_id', otherKey: 'asset_id' });
Asset.belongsToMany(ThreatAdvisory, { through: ThreatAdvisoryAsset, as: 'advisories', foreignKey: 'asset_id', otherKey: 'advisory_id' });

module.exports = {
  sequelize, User, Asset, Assessment, Reminder, AuditLog, Document, Comment,
  Vendor, VendorContact, Policy, PolicyVersion, Setting, Risk, Notification,
  Control, Threat, ThreatSource, ThreatAdvisory, ThreatAdvisoryAsset, RiskControl, RiskMethodology, RiskCategory, RiskScenario, RiskTreatmentItem, RiskAcceptanceRequest, RiskAssessmentHistory, RiskKri, RiskReviewFlag, JobRun, Vulnerability, Incident, VvtEntry, Task, DataFlow, PasskeyCredential, ApiToken,
  Template, DiscoveredSoftware, SubjectRequest, PolicyAcknowledgment, ReviewSignOff, LegalRequirement,
  PentestProject, PentestFinding, TisaxAssessment, TisaxRequirement, DoraThirdParty, DoraResilienceTest,
  AiSystem, BcmProcess, BcmExercise, Dsfa,
  Iso27001Control, BsiRequirement, BsiCatalog, BsiCatalogModule, BsiCatalogRequirement, BsiInformationDomain, BsiTargetObject, BsiModeling, BsiRequirementDocument, Nis2Measure, Nis2SelfCheckItem, C5Criterion,
  CustomRole, OidcClaimMapping,
  Kpi, KpiMeasurement, Audit, AuditFinding, UserTraining, Training,
  Group, GroupMember, PushSubscription,
  VendorTriageRun, VendorFinding,
  DocumentAnalysisRun, DocumentAnalysisFinding,
  ControlRequirement, BcmProcessAsset,
};
