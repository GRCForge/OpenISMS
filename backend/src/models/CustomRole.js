const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CustomRole = sequelize.define('CustomRole', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  base_role: {
    type: DataTypes.ENUM('admin', 'assessor', 'dpo', 'it-staff', 'owner', 'viewer', 'employee', 'management'),
    allowNull: false,
    defaultValue: 'viewer',
  },
}, { tableName: 'custom_roles', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = CustomRole;
