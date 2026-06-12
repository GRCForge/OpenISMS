const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Audit = sequelize.define('Audit', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  scope: { type: DataTypes.TEXT },
  audit_type: { type: DataTypes.ENUM('internal', 'external', 'certification'), defaultValue: 'internal' },
  status: { type: DataTypes.ENUM('planned', 'in_progress', 'completed'), defaultValue: 'planned' },
  auditor: { type: DataTypes.STRING(255) },
  start_date: { type: DataTypes.DATEONLY },
  end_date: { type: DataTypes.DATEONLY },
  report_link: { type: DataTypes.STRING(500) },
  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'audits',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Audit;
