const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BsiRequirement = sequelize.define('BsiRequirement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  baustein_id: { type: DataTypes.STRING(20), allowNull: false },
  baustein_name: { type: DataTypes.STRING(255), allowNull: false },
  layer: { type: DataTypes.STRING(20), allowNull: false },
  req_id: { type: DataTypes.STRING(30), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  requirement_level: {
    type: DataTypes.ENUM('basis', 'standard', 'erhoehter_schutzbedarf'),
    defaultValue: 'basis',
  },
  implementation_status: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable'),
    defaultValue: 'not_started',
  },
  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  notes: { type: DataTypes.TEXT },
  last_review_date: { type: DataTypes.DATEONLY },
}, {
  tableName: 'bsi_requirements',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = BsiRequirement;
