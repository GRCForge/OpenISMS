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
const RiskControl = require('./RiskControl');
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
const Nis2Measure = require('./Nis2Measure');
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
Risk.belongsToMany(Asset, { through: 'risk_assets', as: 'assets', foreignKey: 'risk_id' });
Asset.belongsToMany(Risk, { through: 'risk_assets', as: 'risks', foreignKey: 'asset_id' });

Risk.belongsToMany(VvtEntry, { through: 'risk_vvt', as: 'vvtEntries', foreignKey: 'risk_id' });
VvtEntry.belongsToMany(Risk, { through: 'risk_vvt', as: 'risks', foreignKey: 'vvt_id' });

// Bedrohungen (M:N) und Controls (M:N mit Wirksamkeit)
Risk.belongsToMany(Threat, { through: 'risk_threats', as: 'threats', foreignKey: 'risk_id' });
Threat.belongsToMany(Risk, { through: 'risk_threats', as: 'risks', foreignKey: 'threat_id' });
Risk.belongsToMany(Control, { through: RiskControl, as: 'controls', foreignKey: 'risk_id', otherKey: 'control_id' });
Control.belongsToMany(Risk, { through: RiskControl, as: 'risks', foreignKey: 'control_id', otherKey: 'risk_id' });

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
Nis2Measure.belongsTo(User, { as: 'responsible', foreignKey: 'responsible_id' });
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

module.exports = {
  sequelize, User, Asset, Assessment, Reminder, AuditLog, Document, Comment,
  Vendor, VendorContact, Policy, PolicyVersion, Setting, Risk, Notification,
  Control, Threat, RiskControl, Incident, VvtEntry, Task, DataFlow, PasskeyCredential, ApiToken,
  Template, DiscoveredSoftware, SubjectRequest, PolicyAcknowledgment, ReviewSignOff, LegalRequirement,
  PentestProject, PentestFinding, TisaxAssessment, TisaxRequirement, DoraThirdParty, DoraResilienceTest,
  AiSystem, BcmProcess, BcmExercise, Dsfa,
  Iso27001Control, BsiRequirement, Nis2Measure, C5Criterion,
  CustomRole, OidcClaimMapping,
  Kpi, KpiMeasurement, Audit, AuditFinding, UserTraining, Training,
  Group, GroupMember, PushSubscription,
  VendorTriageRun, VendorFinding,
};
