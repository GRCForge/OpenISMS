const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const AiSystem = sequelize.define('AiSystem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  risk_category: { type: DataTypes.ENUM('prohibited', 'high_risk', 'limited', 'minimal'), defaultValue: 'minimal' },
  use_case: { type: DataTypes.STRING(255) },
  provider: { type: DataTypes.STRING(255) },
  vendor_id: { type: DataTypes.INTEGER, allowNull: true },
  location: { type: DataTypes.STRING(255), allowNull: true },
  deployed_since: { type: DataTypes.DATEONLY, allowNull: true },
  owner_id: { type: DataTypes.INTEGER, allowNull: true },
  conformity_status: { type: DataTypes.ENUM('not_assessed', 'in_assessment', 'compliant', 'non_compliant'), defaultValue: 'not_assessed' },
  // Whether the system is approved/released for use. A 'not_approved' system is not
  // in production, so it needs no conformity assessment, start date or periodic
  // review — and the task automation creates no tasks for it.
  approval_status: { type: DataTypes.ENUM('approved', 'not_approved'), defaultValue: 'approved' },
  documentation_url: { type: DataTypes.STRING(500) },
  last_review_date: { type: DataTypes.DATEONLY, allowNull: true },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'ai_systems', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = AiSystem;
