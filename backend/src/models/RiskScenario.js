const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Risk scenario (ISO 27005:2022 8.2, BSI 200-3 Gefaehrdungsuebersicht):
// asset(s) x threat x vulnerability. A risk can have several scenarios; each
// scenario names the affected assets (several allowed), at most one threat and
// at most one vulnerability, and at least one of the three. Scenarios belong
// to their risk and are replaced as a whole when the risk is saved
// (services/riskService.js); they are deleted with the risk.
const RiskScenario = sequelize.define('RiskScenario', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  threat_id: { type: DataTypes.INTEGER },
  vulnerability_id: { type: DataTypes.INTEGER },
  description: { type: DataTypes.TEXT },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: 'risk_scenarios', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = RiskScenario;
