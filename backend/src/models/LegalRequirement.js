const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LegalRequirement = sequelize.define('LegalRequirement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  category: {
    type: DataTypes.ENUM('data_protection', 'information_security', 'sector_specific', 'labor_law', 'commercial_law', 'other'),
    defaultValue: 'other',
  },
  description: { type: DataTypes.TEXT },
  reference_url: { type: DataTypes.STRING(500) },
  applicable_since: { type: DataTypes.DATEONLY, allowNull: true },
  review_date: { type: DataTypes.DATEONLY, allowNull: true },
  owner_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } },
  status: {
    type: DataTypes.ENUM('identified', 'assessed', 'implemented', 'obsolete'),
    defaultValue: 'identified',
  },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'legal_requirements', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = LegalRequirement;
