const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Bedrohungskatalog (BSI Elementargefaehrdungen + gaengige IT-Bedrohungsszenarien).
const Threat = sequelize.define('Threat', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  source: { type: DataTypes.ENUM('bsi_elementar', 'common', 'custom'), defaultValue: 'common' },
  code: { type: DataTypes.STRING(20) },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
}, { tableName: 'threats', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Threat;
