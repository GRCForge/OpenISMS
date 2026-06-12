const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DataFlow = sequelize.define('DataFlow', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  source_id: { type: DataTypes.INTEGER, allowNull: true },
  target_id: { type: DataTypes.INTEGER, allowNull: true },
  data_categories: { type: DataTypes.JSON, defaultValue: [] },
  transfer_mechanism: {
    type: DataTypes.ENUM('api', 'file', 'database', 'manual', 'email', 'sftp', 'message_queue', 'other'),
    defaultValue: 'api',
  },
  encryption: { type: DataTypes.BOOLEAN, defaultValue: false },
  frequency: { type: DataTypes.STRING(100) },
  contains_personal_data: { type: DataTypes.BOOLEAN, defaultValue: false },
  notes: { type: DataTypes.TEXT },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'planned'),
    defaultValue: 'active',
  },
}, { tableName: 'data_flows', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = DataFlow;
