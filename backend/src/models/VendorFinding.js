const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VendorFinding = sequelize.define('VendorFinding', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  triage_run_id: { type: DataTypes.INTEGER, allowNull: false },
  vendor_id: { type: DataTypes.INTEGER, allowNull: false },
  finding_ref: { type: DataTypes.STRING(20) },
  severity: {
    type: DataTypes.ENUM('critical', 'warning', 'gap'),
    allowNull: false,
  },
  title: { type: DataTypes.STRING(500), allowNull: false },
  control_ref: { type: DataTypes.STRING(200) },
  framework: { type: DataTypes.STRING(100) },
  quote: { type: DataTypes.TEXT },
  description: { type: DataTypes.TEXT },
  remediation: { type: DataTypes.TEXT },
}, {
  tableName: 'vendor_findings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = VendorFinding;
