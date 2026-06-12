const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const KpiMeasurement = sequelize.define('KpiMeasurement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kpi_id: { type: DataTypes.INTEGER, allowNull: false },
  measured_at: { type: DataTypes.DATEONLY, allowNull: false },
  value: { type: DataTypes.STRING(50), allowNull: false },
  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'kpi_measurements',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = KpiMeasurement;
