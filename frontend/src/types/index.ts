export type UserRole = 'admin' | 'owner' | 'assessor' | 'viewer' | 'it-staff' | 'dpo' | 'management' | 'employee';
/** Value of `user.role` for a user who holds no role through any group. */
export type UserRoleOrNone = UserRole | 'none';

/** A role a group carries: a built-in role or a custom role. */
export type RoleRef = { system_role: UserRole; custom_role_id?: never; name?: never; base_role?: never } | { custom_role_id: number; name?: string | null; base_role?: UserRole | null; system_role?: never };
export type AssetType = 'hardware' | 'software' | 'information' | 'process' | 'service' | 'personal' | 'application' | 'data' | 'ai_application' | 'ai_agent' | 'other';
export type Classification = 'public' | 'internal' | 'confidential' | 'secret';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ReminderStatus = 'pending' | 'acknowledged' | 'overdue' | 'completed';
export type HostingType = 'on-premise' | 'cloud_public' | 'cloud_private' | 'hybrid';
export type LifecycleStatus = 'evaluation' | 'production' | 'maintenance' | 'archived';
export type PatchStatus = 'up-to-date' | 'pending' | 'critical';
export type VvtStatus = 'none' | 'pending' | 'complete';
export type DataCategory = 'none' | 'normal' | 'special';

export interface CustomRole {
  id: number;
  name: string;
  description?: string | null;
  base_role: UserRole;
  permissions?: Record<string, Record<string, boolean>> | null;
  users_count?: number;
  groups?: { id: number; name: string; members?: number }[];
}

export interface User {
  id: number;
  name: string;
  email: string;
  /** The most privileged role the user holds through groups ('none' = no role). */
  role: UserRoleOrNone;
  /** All roles the user holds through groups (from /auth/me). */
  roles?: UserRole[];
  group_ids?: number[];
  /** Admin directory only: the user's groups and the roles they grant. */
  groups?: { id: number; name: string; color?: string; source?: 'manual' | 'sso' }[];
  access_roles?: RoleRef[];
  department?: string;
  active: boolean;
  last_seen_at?: string;
  avatar_url?: string;
  sso_user?: boolean;
  totp_enabled?: boolean;
  passkeys?: { id: number; name: string }[];
  custom_role_id?: number | null;
  customRole?: { id: number; name: string; base_role: UserRole } | null;
  created_at: string;
}

export interface Asset {
  id: number;
  name: string;
  type: AssetType;
  description?: string;
  classification: Classification;
  
  // 1. Identifikation
  hosting_type: HostingType;
  location?: string;
  lifecycle_status: LifecycleStatus;
  version?: string;
  vendor?: string;

  // 2. Governance
  owner_id: number;
  assessor_id: number;
  vendor_id?: number;
  owner?: User;
  assessor?: User;
  vendorContact?: Vendor;

  // 3. Schutzbedarf
  nis2_relevant: boolean;
  rto?: string;
  rpo?: string;
  sdo?: string;
  mto?: string;
  ioa?: string;

  // 4. Abhängigkeiten
  parent_id?: number;
  parentAsset?: Asset;
  childAssets?: Asset[];
  business_processes?: string[];
  data_flows?: any[];

  // 5. Security
  patch_status: PatchStatus;
  eol_date?: string;
  cve_critical: number;
  cve_high: number;
  cve_medium: number;
  cve_low: number;
  backup_plan?: string;
  last_restore_test?: string;
  hardening_status: boolean;

  // 6. Privacy / DSMS
  vvt_status: VvtStatus;
  dsfa_required: boolean;
  data_category: DataCategory;

  status: 'active' | 'inactive' | 'decommissioned';
  tags?: string[];
  frameworks?: Framework[];
  policies?: Policy[];
  vvtEntries?: VvtEntry[];
  incidents?: Incident[];
  risks?: Risk[];
  created_at: string;
  Assessments?: Assessment[];
  Reminders?: Reminder[];
}

export interface PolicyVersion {
  id: number;
  policy_id: number;
  version: string;
  file_url: string;
  original_filename: string;
  created_at: string;
}

export interface Policy {
  id: number;
  title: string;
  code?: string;
  description?: string;
  category: 'policy' | 'guideline' | 'procedure' | 'contract' | 'other';
  status: 'draft' | 'active' | 'retired';
  version: string;
  valid_from?: string;
  valid_until?: string;
  file_url?: string;
  original_filename?: string;
  created_at: string;
  assets?: Asset[];
  history?: PolicyVersion[];
  controls?: Control[];
}

export interface Assessment {
  id: number;
  asset_id: number;
  assessor_id: number;
  confidentiality: number;
  integrity: number;
  availability: number;
  risk_score: number;
  risk_level: RiskLevel;
  notes?: string;
  mitigation?: string;
  risk_treatment?: RiskTreatment;
  treatment_justification?: string;
  accepted_by?: string;
  accepted_until?: string;
  acceptance_document_id?: number;
  assessed_at: string;
  next_review_at: string;
  is_current: boolean;
  Asset?: Asset;
  assessorUser?: User;
}

export type RiskTreatment = 'mitigate' | 'accept' | 'transfer' | 'avoid';
export type RiskStatus = 'open' | 'in_treatment' | 'accepted' | 'closed';

export interface Risk {
  id: number;
  ref?: string;
  title: string;
  description?: string;
  category?: string;
  owner_id?: number;
  owner?: User;
  likelihood: number;
  impact: number;
  inherent_level?: RiskLevel;
  treatment: RiskTreatment;
  treatment_plan?: string;
  residual_likelihood?: number;
  residual_impact?: number;
  residual_level?: RiskLevel;
  // 3.7.0: impact per dimension, assessment rationale, net-risk override, target risk
  impact_dimensions?: Partial<Record<ImpactDimensionKey, number>> | null;
  likelihood_rationale?: string | null;
  impact_rationale?: string | null;
  residual_override?: boolean;
  residual_override_reason?: string | null;
  residual_override_at?: string | null;
  residualOverrideBy?: { id: number; name: string } | null;
  residual_calculated?: { residual_likelihood: number; residual_impact: number; residual_level: RiskLevel | null };
  target_likelihood?: number | null;
  target_impact?: number | null;
  target_level?: RiskLevel | null;
  scenarios?: RiskScenario[];
  status: RiskStatus;
  // Risikomethodik (vom Server berechnet, siehe services/riskMethodology.js)
  methodology_id?: number | null;
  methodology_version?: number | null;
  needs_reassessment?: boolean;
  matrix_changed?: boolean;
  effective_level?: RiskLevel | null;
  appetite_max_level?: RiskLevel | null;
  appetite_exceeded?: boolean;
  acceptance_document_id?: number;
  acceptanceDocument?: { id: number; original_name: string };
  review_date?: string;
  assets?: Asset[];
  threats?: Threat[];
  controls?: Control[];
  vvtEntries?: VvtEntry[];
  incidents?: Incident[];
  // Risk-Owner Sign-off (NIS-2 Management-Haftung)
  accepted_by_id?: number;
  acceptedBy?: { id: number; name: string };
  accepted_at?: string;
  accepted_until?: string;
  created_at: string;
  updated_at: string;
}

export type ControlStatus = 'implemented' | 'planned' | 'not_applicable';
export type ControlFramework = 'iso27001' | 'nis2' | 'bsi' | 'custom';
export type ControlType = 'organizational' | 'people' | 'physical' | 'technological';

export interface Control {
  id: number;
  framework: ControlFramework;
  code?: string;
  title: string;
  description?: string;
  type: ControlType;
  status: ControlStatus;
  applicability_justification?: string;
  RiskControl?: { effectiveness: number };
  policies?: Policy[];
}

export interface Threat {
  id: number;
  source: 'bsi_elementar' | 'common' | 'custom';
  code?: string;
  title: string;
  description?: string;
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'reported' | 'investigating' | 'contained' | 'resolved' | 'closed';
export type IncidentCategory = 'malware' | 'phishing' | 'data_breach' | 'dos' | 'unauthorized_access' | 'misconfiguration' | 'loss_theft' | 'social_engineering' | 'other';

export interface Incident {
  id: number;
  ref?: string;
  title: string;
  description?: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  is_security_incident: boolean;
  is_gdpr_incident: boolean;
  reporter_id?: number;
  reporter?: { id: number; name: string };
  assignee_id?: number;
  assignee?: { id: number; name: string };
  detected_at?: string;
  occurred_at?: string;
  resolved_at?: string;
  nis2_reportable: boolean;
  early_warning_at?: string;
  notification_at?: string;
  impact?: string;
  root_cause?: string;
  corrective_actions?: string;
  lessons_learned?: string;
  affected_systems: number;
  data_breach_details?: string;
  external_report_id?: string;
  gdpr_breach_discovered_at?: string;
  gdpr_notified_at?: string;
  assets?: Asset[];
  risks?: Risk[];
  vvtEntries?: VvtEntry[];
  vendors?: Vendor[];
  created_at: string;
  updated_at: string;
}

export interface RiskMatrixCell { likelihood: number; impact: number; score: number; level: RiskLevel | null; }
export interface RiskScaleStep {
  value: number;
  label_de: string;
  label_en: string;
  description: string | null;
  range_min: number | null;
  range_max: number | null;
}
export interface RiskLevelDef { key: RiskLevel; label_de: string; label_en: string; color: string; min_score: number; max_score: number; }
export interface RiskAppetite { default_max_level: RiskLevel | null; categories: { category: string; max_level: RiskLevel }[]; }
export interface RiskAcceptanceRule { level: RiskLevel; roles: string[]; max_months: number | null; }
// Antwort von /api/risks/scale: die aktive (oder per ?version angefragte) Risikomethodik.
export interface RiskScale {
  id: number | null;
  version: number | null;
  name: string;
  status: 'active' | 'superseded';
  change_note?: string | null;
  activated_at?: string | null;
  created_by?: { id: number; name: string } | null;
  size: number;
  likelihood_size: number;
  impact_size: number;
  max_score: number;
  likelihood: (string | null)[];
  impact: (string | null)[];
  likelihood_unit: string | null;
  impact_unit: string | null;
  likelihood_levels: RiskScaleStep[];
  impact_levels: RiskScaleStep[];
  risk_levels: RiskLevelDef[];
  thresholds: Record<string, string>;
  matrix: RiskMatrixCell[][];
  appetite: RiskAppetite;
  acceptance: RiskAcceptanceRule[];
  impact_dimensions: ImpactDimensionDef[];
}
export type ImpactDimensionKey = 'confidentiality' | 'integrity' | 'availability' | 'financial' | 'legal' | 'reputation' | 'operational';
export interface ImpactDimensionDef { key: ImpactDimensionKey; label_de: string; label_en: string; description: string | null; }
export interface RiskCategory {
  id: number; key: string; label_de: string; label_en: string; label_es: string | null;
  description: string | null; active: boolean; sort_order: number; origin: 'manual' | 'seed' | 'migration'; risk_count: number;
}
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';
export type VulnerabilityStatus = 'open' | 'mitigated' | 'closed';
export interface Vulnerability {
  id: number; ref: string | null; title: string; description: string | null;
  source: 'manual' | 'cve'; cve_id: string | null; cvss_score: string | number | null;
  severity: VulnerabilitySeverity | null; status: VulnerabilityStatus;
  assets?: { id: number; name: string; type?: string }[];
  createdBy?: { id: number; name: string } | null;
  risk_count?: number;
  risks?: { id: number; ref: string | null; title: string }[];
  hidden_risk_count?: number;
  created_at: string; updated_at: string;
}
export interface RiskScenario {
  id?: number;
  assets?: { id: number; name: string; type?: string }[];
  threat?: { id: number; code?: string | null; title: string } | null;
  vulnerability?: { id: number; ref: string | null; title: string; cve_id: string | null; severity: VulnerabilitySeverity | null; status: VulnerabilityStatus } | null;
  threat_id?: number | null;
  vulnerability_id?: number | null;
  description: string | null;
}
export interface AssetCveEntry {
  cve_id: string; severity: VulnerabilitySeverity | null; cvss_score: number | null; description: string | null; published: string | null;
  vulnerability: { id: number; ref: string | null; title: string; status: VulnerabilityStatus; linked_to_asset: boolean } | null;
}
export interface RiskMethodologyVersion {
  id: number; version: number; name: string; status: 'active' | 'superseded';
  likelihood_size: number; impact_size: number; change_note: string | null;
  created_at: string; activated_at: string | null; superseded_at: string | null;
  created_by: { id: number; name: string } | null; risk_count: number;
}

export interface Reminder {
  id: number;
  asset_id: number;
  assessment_id?: number;
  due_date: string;
  status: ReminderStatus;
  notified_at?: string;
  acknowledged_at?: string;
  notes?: string;
  Asset?: Asset;
}

export type Framework = 'iso27001' | 'nis2' | 'gdpr';
export type DocumentCategory = 'contract' | 'dpa' | 'policy' | 'certificate' | 'risk_report' | 'risk_acceptance' | 'other';

export interface AssetDocument {
  id: number;
  asset_id: number;
  filename: string;
  original_name: string;
  mimetype?: string;
  size?: number;
  category: DocumentCategory;
  description?: string;
  created_at: string;
  uploader?: User;
}

export interface AssetComment {
  id: number;
  asset_id: number;
  user_id: number;
  parent_id?: number;
  content: string;
  meeting_date?: string;
  created_at: string;
  updated_at: string;
  author?: User;
}

export type ComplianceAsset = Partial<Asset> & { risk_level?: RiskLevel };

export interface DsgvoGap { id: number; name: string; data_category: string; vvt_status: string; }

export interface ComplianceStats {
  total: number;
  coverage: number;
  highRisk: number;
  frameworks: Record<string, { count: number; assets: ComplianceAsset[] }>;
  noFramework: { count: number; assets: ComplianceAsset[] };
  dsgvoGaps?: DsgvoGap[];
}

export type AuditAction = 'create' | 'update' | 'delete' | 'assess' | 'login' | 'acknowledge' | 'deactivate' | 'change_password' | 'execute' | 'seed' | 'reseed';
export type AuditEntityType =
  | 'asset' | 'assessment' | 'user' | 'reminder' | 'auth' | 'vendor' | 'document'
  | 'settings' | 'risk' | 'control' | 'incident' | 'audit_log' | 'dataflow' | 'task' | 'vvt'
  | 'training' | 'user_training' | 'training_contest' | 'kpi' | 'kpi_measurement'
  | 'audit' | 'audit_finding' | 'custom_role' | 'oidc_mapping'
  | 'iso27001_control' | 'bsi_requirement' | 'tisax_requirement' | 'tisax_assessment'
  | 'nis2_measure' | 'c5_criterion' | 'ai_system' | 'bcm_process' | 'bcm_exercise'
  | 'dora_test' | 'dora_third_party' | 'pentest_project' | 'pentest_finding'
  | 'policy' | 'legal_requirement' | 'subject_request' | 'dsfa' | 'template';

export interface AuditLog {
  id: number;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: number;
  entity_name?: string;
  actor_id?: number;
  actor_name?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
}

export type VendorType = 'it_provider' | 'software_vendor' | 'hardware_vendor' | 'cloud_provider' | 'support' | 'consultant' | 'other';

export interface VendorContact {
  id: number;
  vendor_id: number;
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  notes?: string;
}

export interface Vendor {
  id: number;
  name: string;
  type: VendorType;
  website?: string;
  phone?: string;
  address?: string;
  notes?: string;
  contacts?: VendorContact[];
  // Risk assessment
  risk_level?: RiskLevel;
  risk_score?: number;
  last_assessed_at?: string;
  assessed_by_id?: number;
  assessedBy?: { id: number; name: string };
  data_processor?: boolean;
  dpa_signed?: boolean;
  dpa_signed_at?: string;
  iso27001_certified?: boolean;
  soc2_certified?: boolean;
  gdpr_compliant?: boolean;
  fourth_party_risks?: string;
  assessment_notes?: string;
  next_review_date?: string;
}

export type VvtLegalBasis = 'consent' | 'contract' | 'legal_obligation' | 'vital_interests' | 'public_task' | 'legitimate_interests';

export interface VvtEntry {
  id: number;
  name: string;
  purpose?: string;
  legal_basis: string;
  data_categories: string;
  special_categories: boolean;
  data_subjects: string;
  recipients: string;
  third_country_transfers: boolean;
  transfer_safeguards?: string;
  retention_period?: string;
  retention_legal_basis?: string;
  deletion_procedure?: string;
  security_measures?: string;
  responsible_id?: number;
  responsible?: { id: number; name: string; email: string };
  processor_id?: number;
  processor?: { id: number; name: string };
  status: 'draft' | 'active' | 'archived';
  notes?: string;
  assets?: Asset[];
  vendors?: Vendor[];
  incidents?: Incident[];
  created_at: string;
  updated_at: string;
}

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Group {
  id: number;
  name: string;
  description?: string;
  color: string;
  created_by_id?: number;
  members: { id: number; name: string; email: string; role: UserRoleOrNone; source?: 'manual' | 'sso' }[];
  /** Roles the group carries; its members receive all of them. */
  roles?: RoleRef[];
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: number;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string;
  assigned_to_id?: number;
  assignee?: { id: number; name: string; email: string };
  assigned_to_group_id?: number;
  assignedGroup?: { id: number; name: string; color: string; members: { id: number; name: string; email: string }[] };
  completed_by_id?: number;
  completedBy?: { id: number; name: string };
  created_by_id?: number;
  createdBy?: { id: number; name: string };
  related_type?: string;
  related_id?: number;
  tags: string[];
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DataFlow {
  id: number;
  name: string;
  description?: string;
  source_id?: number;
  source?: { id: number; name: string; type: string };
  target_id?: number;
  target?: { id: number; name: string; type: string };
  data_categories: string[];
  transfer_mechanism: 'api' | 'file' | 'database' | 'manual' | 'email' | 'sftp' | 'message_queue' | 'other';
  encryption: boolean;
  frequency?: string;
  contains_personal_data: boolean;
  notes?: string;
  status: 'active' | 'inactive' | 'planned';
  created_at: string;
  updated_at: string;
}

export interface DashboardData {
  stats: {
    totalAssets: number; activeAssets: number; overdueReminders: number;
    upcomingReminders: number; highRisk: number; compliancePct: number;
  };
  upcomingReminders: Reminder[];
  riskDistribution: { risk_level: RiskLevel; count: string }[];
  recentAssessments: Assessment[];
  assetsByClassification: { classification: Classification; count: string }[];
  assetsByType: { type: string; count: string }[];
  recentActivity: AuditLog[];
  frameworkCoverage: { iso27001: number; nis2: number; gdpr: number; total: number };
}

export type SubjectRequestType = 'access' | 'rectification' | 'erasure' | 'restriction' | 'portability' | 'objection' | 'withdraw_consent';
export type SubjectRequestStatus = 'received' | 'in_progress' | 'completed' | 'rejected' | 'extended';

export interface SubjectRequest {
  id: number;
  ref?: string;
  type: SubjectRequestType;
  status: SubjectRequestStatus;
  requester_name: string;
  requester_email?: string;
  requester_id_verified: boolean;
  received_date: string;
  due_date?: string;
  extended_until?: string;
  extension_reason?: string;
  description?: string;
  decision?: string;
  notes?: string;
  handler_id?: number;
  handler?: { id: number; name: string; email: string };
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: number;
  title: string;
  description?: string;
  category: 'asset' | 'risk' | 'assessment' | 'incident' | 'policy' | 'general';
  filename: string;
  original_name: string;
  mimetype?: string;
  size?: number;
  uploaded_by: number;
  uploader?: { id: number; name: string };
  created_at: string;
  updated_at: string;
}

export interface PolicyAcknowledgment {
  id: number;
  policy_id: number;
  user_id: number;
  user?: { id: number; name: string; email: string };
  acknowledged_at: string;
}

export interface ReviewSignOff {
  id: number;
  report_date: string;
  approved_by_id: number;
  approvedBy?: { id: number; name: string; email: string };
  approved_at: string;
  notes?: string;
}

export type LegalRequirementCategory = 'data_protection' | 'information_security' | 'sector_specific' | 'labor_law' | 'commercial_law' | 'other';
export type LegalRequirementStatus = 'identified' | 'assessed' | 'implemented' | 'obsolete';

export interface LegalRequirement {
  id: number;
  title: string;
  category: LegalRequirementCategory;
  description?: string;
  reference_url?: string;
  applicable_since?: string;
  review_date?: string;
  owner_id?: number;
  owner?: { id: number; name: string; email: string };
  status: LegalRequirementStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export type AiRiskCategory = 'prohibited' | 'high_risk' | 'limited' | 'minimal';
export type AiConformityStatus = 'not_assessed' | 'in_assessment' | 'compliant' | 'non_compliant';
export type AiApprovalStatus = 'approved' | 'not_approved';

export interface AiActItem {
  id: number;
  name: string;
  description?: string;
  risk_category: AiRiskCategory;
  use_case?: string;
  provider?: string;
  vendor_id?: number;
  vendor?: Vendor;
  vvt_id?: number;
  vvt?: VvtEntry;
  deployed_since?: string;
  owner_id?: number;
  owner?: User;
  conformity_status: AiConformityStatus;
  approval_status?: AiApprovalStatus;
  documentation_url?: string;
  last_review_date?: string;
  notes?: string;
  location?: string;
  created_at: string;
  updated_at: string;
}

export interface KPI {
  id: number;
  title: string;
  description: string;
  target: string;
  current_value: string;
  status: 'on_target' | 'warning' | 'critical';
  owner_id?: number | null;
  owner?: { id: number; name: string };
  measurements?: KPIMeasurement[];
  created_at: string;
}

export interface KPIMeasurement {
  id: number;
  kpi_id: number;
  measured_at: string;
  value: string;
  notes?: string;
}

export interface Audit {
  id: number;
  title: string;
  scope: string;
  audit_type: 'internal' | 'external' | 'certification';
  status: 'planned' | 'in_progress' | 'completed';
  auditor: string;
  start_date: string;
  end_date: string;
  report_link?: string;
  notes?: string;
  findings?: AuditFinding[];
  created_at: string;
}

export interface AuditFinding {
  id: number;
  audit_id: number;
  title: string;
  description: string;
  severity: 'minor' | 'major' | 'observation';
  status: 'open' | 'resolved' | 'wont_fix';
  capa_task_id?: number | null;
  capaTask?: Task | null;
  assignee_id?: number | null;
  assignee?: { id: number; name: string };
}

export interface UserTraining {
  id: number;
  user_id: number;
  user?: { id: number; name: string; department?: string };
  training_title: string;
  completed_at: string;
  expires_at?: string;
  certificate_url?: string;
  status: 'valid' | 'expired' | 'warning';
}
