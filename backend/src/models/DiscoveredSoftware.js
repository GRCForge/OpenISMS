const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DiscoveredSoftware = sequelize.define('DiscoveredSoftware', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  version: { type: DataTypes.STRING(50) },
  vendor: { type: DataTypes.STRING(255) },
  hostname: { type: DataTypes.STRING(255), allowNull: false },
  ip: { type: DataTypes.STRING(255) },
  os: { type: DataTypes.STRING(255) },
  status: { type: DataTypes.ENUM('pending', 'approved', 'ignored'), defaultValue: 'pending', allowNull: false },
  source: { type: DataTypes.STRING(50), defaultValue: 'agent', allowNull: false },
  asset_type: { type: DataTypes.STRING(50), defaultValue: 'software', allowNull: false },
  open_ports: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'discovered_softwares', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = DiscoveredSoftware;
