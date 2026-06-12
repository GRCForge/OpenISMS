const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const C5Criterion = sequelize.define('C5Criterion', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  criterion_id: { type: DataTypes.STRING(20), allowNull: false },
  domain: { type: DataTypes.STRING(10), allowNull: false },
  domain_name: { type: DataTypes.STRING(100), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  implementation_status: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable'),
    defaultValue: 'not_started',
  },
  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  evidence: { type: DataTypes.TEXT, allowNull: true },
  notes: { type: DataTypes.TEXT, allowNull: true },
  last_review_date: { type: DataTypes.DATEONLY, allowNull: true },
  pqc_relevant: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  cc_relevant: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  has_sharpen: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
}, {
  tableName: 'c5_criteria',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = C5Criterion;
