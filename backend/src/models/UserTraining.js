const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const UserTraining = sequelize.define('UserTraining', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: true },
  training_id: { type: DataTypes.INTEGER, allowNull: true },
  training_title: { type: DataTypes.STRING(255), allowNull: false },
  employee_name: { type: DataTypes.STRING(255), allowNull: true },
  employee_email: { type: DataTypes.STRING(255), allowNull: true },
  completed_at: { type: DataTypes.DATEONLY, allowNull: true },
  expires_at: { type: DataTypes.DATEONLY, allowNull: true },
  certificate_url: { type: DataTypes.STRING(500) },
  status: { type: DataTypes.STRING(50), defaultValue: 'pending' },
  contested: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  contestation_comment: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'user_trainings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = UserTraining;
