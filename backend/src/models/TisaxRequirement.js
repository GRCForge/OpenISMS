const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// VDA-ISA-Anforderung mit Reifegrad-Selbstbewertung (0-5, Zielreifegrad i.d.R. 3)
const TisaxRequirement = sequelize.define('TisaxRequirement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(20), allowNull: false },
  chapter: { type: DataTypes.STRING(255), allowNull: false },
  title: { type: DataTypes.STRING(500), allowNull: false },
  question: { type: DataTypes.TEXT },
  maturity_level: { type: DataTypes.INTEGER, allowNull: true },
  target_level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
  status: { type: DataTypes.ENUM('open', 'in_progress', 'implemented', 'not_applicable'), defaultValue: 'open' },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'tisax_requirements', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = TisaxRequirement;
