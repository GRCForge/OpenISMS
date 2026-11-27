const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const GroupMember = sequelize.define('GroupMember', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  group_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  // 'manual' = added by an administrator, 'sso' = granted by an OIDC claim
  // mapping at login. Strict role sync only ever removes 'sso' memberships, so a
  // membership an administrator set by hand survives the next SSO login.
  source: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'manual' },
}, { tableName: 'group_members', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = GroupMember;
