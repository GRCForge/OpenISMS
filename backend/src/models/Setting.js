const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Generische Key-Value-Tabelle fuer systemweite Einstellungen (allgemein + OIDC).
// Sensible Werte (z.B. OIDC client_secret) werden verschluesselt im JSON abgelegt.
const Setting = sequelize.define('Setting', {
  key: { type: DataTypes.STRING(64), primaryKey: true },
  value: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
}, { tableName: 'settings', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Setting;
