const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Document = sequelize.define('Document', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  asset_id: { type: DataTypes.INTEGER, allowNull: true },
  vendor_id: { type: DataTypes.INTEGER, allowNull: true },
  incident_id: { type: DataTypes.INTEGER, allowNull: true },
  uploaded_by: { type: DataTypes.INTEGER, allowNull: false },
  filename: { type: DataTypes.STRING(255), allowNull: false },
  original_name: { type: DataTypes.STRING(255), allowNull: false },
  mimetype: { type: DataTypes.STRING(100) },
  size: { type: DataTypes.INTEGER },
  category: {
    type: DataTypes.ENUM('contract', 'dpa', 'policy', 'certificate', 'risk_report', 'risk_acceptance', 'other'),
    defaultValue: 'other',
  },
  description: { type: DataTypes.STRING(500) },
}, { tableName: 'documents', timestamps: true, createdAt: 'created_at', updatedAt: false });

module.exports = Document;
