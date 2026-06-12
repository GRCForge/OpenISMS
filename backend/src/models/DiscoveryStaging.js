const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Zwischenspeicher für vom Discovery-Agent gemeldete Software. Einträge landen
// zunächst als 'pending' und werden erst nach manueller Freigabe zu echten
// Assets — kein Auto-Anlegen mehr.
const DiscoveryStaging = sequelize.define('DiscoveryStaging', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:             { type: DataTypes.STRING(255), allowNull: false },
  version:          { type: DataTypes.STRING(120), allowNull: true },
  vendor:           { type: DataTypes.STRING(255), allowNull: true },
  hostname:         { type: DataTypes.STRING(255), allowNull: true },
  ip:               { type: DataTypes.STRING(64),  allowNull: true },
  os:               { type: DataTypes.STRING(255), allowNull: true },
  source:           { type: DataTypes.ENUM('agent', 'network-scan'), defaultValue: 'agent' },
  status:           { type: DataTypes.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' },
  matched_asset_id: { type: DataTypes.INTEGER, allowNull: true }, // existierendes Asset (Update-Kandidat)
  reported_by:      { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'discovery_staging', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = DiscoveryStaging;
