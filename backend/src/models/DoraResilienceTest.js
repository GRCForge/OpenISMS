const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Tests der digitalen operationalen Resilienz nach DORA Art. 24-26
const DoraResilienceTest = sequelize.define('DoraResilienceTest', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  test_type: { type: DataTypes.ENUM('tlpt', 'penetration_test', 'vulnerability_scan', 'scenario_based', 'bcp_test', 'other'), defaultValue: 'scenario_based' },
  test_date: { type: DataTypes.DATEONLY },
  performed_by: { type: DataTypes.STRING(255) },
  status: { type: DataTypes.ENUM('planned', 'in_progress', 'completed'), defaultValue: 'planned' },
  result: { type: DataTypes.ENUM('pending', 'passed', 'passed_with_findings', 'failed'), defaultValue: 'pending' },
  findings: { type: DataTypes.TEXT },
  remediation: { type: DataTypes.TEXT },
  next_test_date: { type: DataTypes.DATEONLY },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'dora_resilience_tests', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = DoraResilienceTest;
