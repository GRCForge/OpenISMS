const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Maßnahmen-/Controls-Katalog (Basis fuer das Statement of Applicability, SoA).
const Control = sequelize.define('Control', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  framework: { type: DataTypes.ENUM('iso27001', 'nis2', 'bsi', 'custom'), allowNull: false },
  code: { type: DataTypes.STRING(30), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  type: { type: DataTypes.ENUM('organizational', 'people', 'physical', 'technological'), defaultValue: 'organizational' },
  // SoA-Status
  status: { type: DataTypes.ENUM('implemented', 'planned', 'not_applicable'), defaultValue: 'planned' },
  applicability_justification: { type: DataTypes.TEXT },
}, { tableName: 'controls', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Control;
