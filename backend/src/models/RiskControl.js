const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Verknuepfungstabelle Risiko <-> Control inkl. Wirksamkeit der Massnahme (1-5).
// Nur umgesetzte (implemented) Controls reduzieren das Restrisiko.
const RiskControl = sequelize.define('RiskControl', {
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  control_id: { type: DataTypes.INTEGER, allowNull: false },
  effectiveness: { type: DataTypes.INTEGER, defaultValue: 3, validate: { min: 1, max: 5 } },
}, { tableName: 'risk_controls', timestamps: false });

module.exports = RiskControl;
