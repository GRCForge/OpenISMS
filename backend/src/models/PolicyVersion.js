const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PolicyVersion = sequelize.define('PolicyVersion', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  policy_id: { type: DataTypes.INTEGER, allowNull: false },
  version: { type: DataTypes.STRING(20), allowNull: false },
  valid_from: { type: DataTypes.DATEONLY },
  valid_until: { type: DataTypes.DATEONLY },
  file_url: { type: DataTypes.STRING(500), allowNull: false },
  original_filename: { type: DataTypes.STRING(255) },
  created_by: { type: DataTypes.INTEGER },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'policy_versions', timestamps: true, createdAt: 'created_at', updatedAt: false });

module.exports = PolicyVersion;
