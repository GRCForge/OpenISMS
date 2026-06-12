const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Iso27001Control = sequelize.define('Iso27001Control', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(10), allowNull: false },
  theme: {
    type: DataTypes.ENUM('Organizational', 'People', 'Physical', 'Technological'),
    allowNull: false,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  applicable: { type: DataTypes.BOOLEAN, defaultValue: true },
  implementation_status: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable'),
    defaultValue: 'not_started',
  },
  justification: { type: DataTypes.TEXT },
  owner_id: { type: DataTypes.INTEGER, allowNull: true },
  evidence: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT },
  last_review_date: { type: DataTypes.DATEONLY },
  description: { type: DataTypes.TEXT },
}, {
  tableName: 'iso27001_controls',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Iso27001Control;
