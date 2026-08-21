const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DocumentAnalysisFinding = sequelize.define('DocumentAnalysisFinding', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  run_id: { type: DataTypes.INTEGER, allowNull: false },
  finding_ref: { type: DataTypes.STRING(20) },
  severity: {
    type: DataTypes.ENUM('critical', 'warning', 'gap'),
    allowNull: false,
  },
  title: { type: DataTypes.STRING(500), allowNull: false },
  control_ref: { type: DataTypes.STRING(200) },
  framework: { type: DataTypes.STRING(100) },
  quote: { type: DataTypes.TEXT },
  description: { type: DataTypes.TEXT },
  remediation: { type: DataTypes.TEXT },
}, {
  tableName: 'document_analysis_findings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = DocumentAnalysisFinding;
