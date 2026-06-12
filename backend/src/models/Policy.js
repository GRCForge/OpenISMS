const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Policy = sequelize.define('Policy', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  code: { type: DataTypes.STRING(50) }, // e.g. "POL-001"
  description: { type: DataTypes.TEXT },
  category: { 
    type: DataTypes.ENUM('policy', 'guideline', 'procedure', 'contract', 'other'), 
    defaultValue: 'policy' 
  },
  status: { type: DataTypes.ENUM('draft', 'active', 'retired'), defaultValue: 'active' },
  version: { type: DataTypes.STRING(20), defaultValue: '1.0' },
  valid_from: { type: DataTypes.DATEONLY },
  valid_until: { type: DataTypes.DATEONLY },
  file_url: { type: DataTypes.STRING(500) },
  original_filename: { type: DataTypes.STRING(255) }
}, { tableName: 'policies', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Policy;
