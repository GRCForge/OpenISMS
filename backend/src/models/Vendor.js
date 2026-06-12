const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vendor = sequelize.define('Vendor', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  type: {
    type: DataTypes.ENUM('it_provider', 'software_vendor', 'hardware_vendor', 'cloud_provider', 'support', 'consultant', 'other', 'software', 'cloud', 'hardware', 'consulting', 'hosting', 'logistics'),
    defaultValue: 'other',
  },
  website: { type: DataTypes.STRING(500) },
  phone: { type: DataTypes.STRING(50) },
  address: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT },
  // Risk Assessment fields
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    allowNull: true,
  },
  risk_score: { type: DataTypes.INTEGER, allowNull: true },
  last_assessed_at: { type: DataTypes.DATE, allowNull: true },
  assessed_by_id: { type: DataTypes.INTEGER, allowNull: true },
  data_processor: { type: DataTypes.BOOLEAN, defaultValue: false },
  dpa_signed: { type: DataTypes.BOOLEAN, defaultValue: false },
  dpa_signed_at: { type: DataTypes.DATEONLY, allowNull: true },
  iso27001_certified: { type: DataTypes.BOOLEAN, defaultValue: false },
  soc2_certified: { type: DataTypes.BOOLEAN, defaultValue: false },
  gdpr_compliant: { type: DataTypes.BOOLEAN, defaultValue: false },
  fourth_party_risks: { type: DataTypes.TEXT },
  assessment_notes: { type: DataTypes.TEXT },
  next_review_date: { type: DataTypes.DATEONLY, allowNull: true },
}, { tableName: 'vendors', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Vendor;
