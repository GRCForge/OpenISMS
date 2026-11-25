const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Key risk indicator (3.9.0, ISO/IEC 27005:2022 10.2, ISO/IEC 27001:2022 9.1):
// links an existing KPI (models/Kpi.js) to a risk with a threshold and a
// direction. direction 'above': breached when the latest value is greater
// than the threshold; 'below': when it is smaller. A breach flags the risk for
// reassessment once per breach (services/riskMonitoringService.js); the flag
// clears when the value returns inside the threshold.
const RiskKri = sequelize.define('RiskKri', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  kpi_id: { type: DataTypes.INTEGER, allowNull: false },
  threshold: { type: DataTypes.DECIMAL(18, 4), allowNull: false },
  direction: { type: DataTypes.ENUM('above', 'below'), allowNull: false, defaultValue: 'above' },
  note: { type: DataTypes.TEXT },
  // State of the last evaluation.
  breached: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  breached_at: { type: DataTypes.DATE },
  breach_value: { type: DataTypes.DECIMAL(18, 4) },
  breach_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  last_value: { type: DataTypes.DECIMAL(18, 4) },
  last_measured_at: { type: DataTypes.DATEONLY },
  last_evaluated_at: { type: DataTypes.DATE },
  created_by_id: { type: DataTypes.INTEGER },
}, {
  tableName: 'risk_kris', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['risk_id', 'kpi_id'], name: 'risk_kris_risk_kpi_uq' }, { fields: ['kpi_id'] }],
});

module.exports = RiskKri;
