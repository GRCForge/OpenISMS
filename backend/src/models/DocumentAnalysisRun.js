const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Analysis engine for Documents and Policies — separate from the vendor-triage
// engine (VendorTriageRun/VendorFinding), which stays vendor_id-scoped. subject_type
// + subject_id is a polymorphic reference across two unrelated tables (Document,
// Policy), so there is deliberately no Sequelize belongsTo here; the service layer
// resolves the subject manually.
const DocumentAnalysisRun = sequelize.define('DocumentAnalysisRun', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  subject_type: { type: DataTypes.ENUM('document', 'policy'), allowNull: false },
  subject_id: { type: DataTypes.INTEGER, allowNull: false },
  // Profile key (avv, tom, soc2, sla, ola, encryption, other, …), same catalog as
  // vendor triage's triageProfiles.js. STRING rather than ENUM so admin-configurable
  // profiles are not tied to a DB migration.
  doc_type: {
    type: DataTypes.STRING(32),
    defaultValue: 'other',
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'done', 'error'),
    defaultValue: 'pending',
  },
  llm_provider: { type: DataTypes.STRING(50) },
  llm_model: { type: DataTypes.STRING(100) },
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: true,
  },
  summary: { type: DataTypes.TEXT },
  // Requirement coverage matrix: [{ ref, requirement, status: met|partial|missing|na, note }]
  coverage: { type: DataTypes.JSON, allowNull: true },
  truncated: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Extracted plain text, snapshotted at analysis time so the split-view's
  // quote-highlighting stays consistent even if the underlying file is later
  // replaced (new Policy version, re-uploaded Document).
  extracted_text: { type: DataTypes.TEXT('long'), allowNull: true },
  source_file_hash: { type: DataTypes.STRING(64), allowNull: true },
  error_message: { type: DataTypes.TEXT },
  started_at: { type: DataTypes.DATE },
  completed_at: { type: DataTypes.DATE },
  triggered_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'document_analysis_runs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = DocumentAnalysisRun;
