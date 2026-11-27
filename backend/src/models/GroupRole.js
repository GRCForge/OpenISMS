const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A role a group carries. Since v3.10.0 roles reach a user only through the
// groups the user belongs to; a user's effective permissions are the union of
// the permission sets of all roles of all their groups (allow-only, no deny).
//
// Exactly one of the two columns is set:
//   system_role     one of the built-in roles; its permission set is the
//                   matching column of the global permission matrix
//   custom_role_id  a custom role with its own permission set
const GroupRole = sequelize.define('GroupRole', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  group_id: { type: DataTypes.INTEGER, allowNull: false },
  system_role: {
    type: DataTypes.ENUM('admin', 'assessor', 'dpo', 'it-staff', 'owner', 'viewer', 'employee', 'management'),
    allowNull: true,
  },
  custom_role_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'group_roles',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  validate: {
    exactlyOneRole() {
      if (Boolean(this.system_role) === Boolean(this.custom_role_id)) {
        throw new Error('A group role names either a system role or a custom role');
      }
    },
  },
});

module.exports = GroupRole;
