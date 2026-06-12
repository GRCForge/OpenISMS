const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DoraThirdParty = sequelize.define('DoraThirdParty', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  ict_service: { type: DataTypes.STRING(255), allowNull: false },
  criticality: { type: DataTypes.ENUM('critical', 'important', 'standard'), defaultValue: 'standard' },
  contract_start: { type: DataTypes.DATEONLY },
  contract_end: { type: DataTypes.DATEONLY },
  country: { type: DataTypes.STRING(100) },
  contact_name: { type: DataTypes.STRING(255) },
  contact_email: { type: DataTypes.STRING(255) },
  sla_rto_hours: { type: DataTypes.INTEGER },
  sla_rpo_hours: { type: DataTypes.INTEGER },
  last_review_date: { type: DataTypes.DATEONLY },
  next_review_date: { type: DataTypes.DATEONLY },
  status: { type: DataTypes.ENUM('active', 'under_review', 'terminated'), defaultValue: 'active' },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'dora_third_parties', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = DoraThirdParty;
