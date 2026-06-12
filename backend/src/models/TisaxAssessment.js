const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TisaxAssessment = sequelize.define('TisaxAssessment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  scope_description: { type: DataTypes.TEXT, allowNull: false },
  assessment_level: { type: DataTypes.ENUM('AL2', 'AL3'), defaultValue: 'AL2' },
  label_requested: { type: DataTypes.STRING(100) },
  status: { type: DataTypes.ENUM('preparation', 'requested', 'scheduled', 'audit_done', 'label_received'), defaultValue: 'preparation' },
  auditor_company: { type: DataTypes.STRING(255) },
  assessment_date: { type: DataTypes.DATEONLY },
  label_valid_until: { type: DataTypes.DATEONLY },
  owner_id: { type: DataTypes.INTEGER, allowNull: true },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'tisax_assessments', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = TisaxAssessment;
