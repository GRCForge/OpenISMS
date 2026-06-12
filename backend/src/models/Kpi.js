const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Kpi = sequelize.define('Kpi', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  target: { type: DataTypes.STRING(255), allowNull: false },
  current_value: { type: DataTypes.STRING(50) },
  status: { type: DataTypes.ENUM('on_target', 'warning', 'critical'), defaultValue: 'on_target' },
  owner_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'kpis',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Kpi;
