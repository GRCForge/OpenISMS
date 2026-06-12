const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditFinding = sequelize.define('AuditFinding', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  audit_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  severity: { type: DataTypes.ENUM('minor', 'major', 'observation'), defaultValue: 'observation' },
  status: { type: DataTypes.ENUM('open', 'resolved', 'wont_fix'), defaultValue: 'open' },
  capa_task_id: { type: DataTypes.INTEGER, allowNull: true },
  assignee_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'audit_findings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = AuditFinding;
