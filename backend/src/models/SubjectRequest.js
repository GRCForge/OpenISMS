const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SubjectRequest = sequelize.define('SubjectRequest', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(20) },
  type: {
    type: DataTypes.ENUM(
      'access', 'rectification', 'erasure', 'restriction',
      'portability', 'objection', 'withdraw_consent'
    ),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('received', 'in_progress', 'completed', 'rejected', 'extended'),
    defaultValue: 'received',
  },
  requester_name: { type: DataTypes.STRING(255), allowNull: false },
  requester_email: { type: DataTypes.STRING(255) },
  requester_id_verified: { type: DataTypes.BOOLEAN, defaultValue: false },
  received_date: { type: DataTypes.DATEONLY, allowNull: false },
  due_date: { type: DataTypes.DATEONLY },
  extended_until: { type: DataTypes.DATEONLY, allowNull: true },
  extension_reason: { type: DataTypes.TEXT },
  description: { type: DataTypes.TEXT },
  decision: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT },
  handler_id: { type: DataTypes.INTEGER, allowNull: true },
  completed_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'subject_requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = SubjectRequest;
