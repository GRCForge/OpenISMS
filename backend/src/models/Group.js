const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Group = sequelize.define('Group', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  description: { type: DataTypes.TEXT },
  color: { type: DataTypes.STRING(20), defaultValue: '#3b82f6' },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'groups', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Group;
