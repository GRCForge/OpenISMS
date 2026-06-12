const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Reminder = sequelize.define('Reminder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  asset_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'assets', key: 'id' } },
  assessment_id: { type: DataTypes.INTEGER, references: { model: 'assessments', key: 'id' } },
  due_date: { type: DataTypes.DATEONLY, allowNull: false },
  status: { type: DataTypes.ENUM('pending', 'acknowledged', 'overdue', 'completed'), defaultValue: 'pending' },
  notified_at: { type: DataTypes.DATE },
  acknowledged_by: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  acknowledged_at: { type: DataTypes.DATE },
  notes: { type: DataTypes.TEXT },
  dismissed: { type: DataTypes.BOOLEAN, defaultValue: false },
  task_id: { type: DataTypes.INTEGER, references: { model: 'tasks', key: 'id' } },
}, { tableName: 'reminders', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Reminder;
