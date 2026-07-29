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
  // Full permission matrix for this role, shaped like DEFAULT_PERMISSIONS but with
  // booleans instead of role lists: { module: { action: true|false } }. NULL means
  // the role has none of its own and the global matrix for base_role applies, which
  // is what every existing row gets on upgrade. Entries the matrix does not define
  // fall through to the route's own role check, so adding a module later does not
  // silently lock a custom role out of it.
  permissions: { type: DataTypes.JSON, allowNull: true },
}, { tableName: 'custom_roles', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = CustomRole;
