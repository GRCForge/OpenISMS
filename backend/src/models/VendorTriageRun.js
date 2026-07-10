const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VendorTriageRun = sequelize.define('VendorTriageRun', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  vendor_id: { type: DataTypes.INTEGER, allowNull: false },
  document_id: { type: DataTypes.INTEGER, allowNull: true },
  doc_type: {
    type: DataTypes.ENUM('avv', 'tom', 'soc2', 'other'),
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
  // Requirement coverage matrix (e.g. GDPR Art. 28(3)(a-h)): [{ ref, requirement,
  // status: met|partial|missing|na, note }]. This is the actual "is the AVV
  // sufficient?" verdict, alongside the findings.
  coverage: { type: DataTypes.JSON, allowNull: true },
  // Whether the document was truncated before analysis (very long contract).
  truncated: { type: DataTypes.BOOLEAN, defaultValue: false },
  error_message: { type: DataTypes.TEXT },
  started_at: { type: DataTypes.DATE },
  completed_at: { type: DataTypes.DATE },
  triggered_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'vendor_triage_runs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = VendorTriageRun;
