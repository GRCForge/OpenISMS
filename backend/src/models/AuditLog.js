const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  action: { type: DataTypes.STRING(64), allowNull: false },
  entity_type: { type: DataTypes.STRING(64), allowNull: false },
  entity_id: { type: DataTypes.INTEGER },
  entity_name: { type: DataTypes.STRING(255) },
  actor_id: { type: DataTypes.INTEGER },
  actor_name: { type: DataTypes.STRING(100) },
  details: { type: DataTypes.JSON },
  ip_address: { type: DataTypes.STRING(45) },
}, {
  tableName: 'audit_logs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['created_at'] },
    { fields: ['entity_type'] }
  ]
});

module.exports = AuditLog;
