const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Task = sequelize.define('Task', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  status: {
    type: DataTypes.ENUM('open', 'in_progress', 'done', 'cancelled'),
    defaultValue: 'open',
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    defaultValue: 'medium',
  },
  due_date: { type: DataTypes.DATEONLY },
  assigned_to_id: { type: DataTypes.INTEGER, allowNull: true },
  assigned_role: {
    type: DataTypes.ENUM('admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'),
    allowNull: true,
  },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
  related_type: { type: DataTypes.STRING(50), allowNull: true },
  related_id: { type: DataTypes.INTEGER, allowNull: true },
  tags: { type: DataTypes.JSON, defaultValue: [] },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  assigned_to_group_id: { type: DataTypes.INTEGER, allowNull: true },
  completed_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'tasks', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Task;
