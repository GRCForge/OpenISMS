const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(100), allowNull: false },
  email: { type: DataTypes.STRING(255), allowNull: false },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  role: { type: DataTypes.ENUM('admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), allowNull: false, defaultValue: 'assessor' },
  department: { type: DataTypes.STRING(100) },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  last_seen_at: { type: DataTypes.DATE },
  avatar_url: { type: DataTypes.TEXT, allowNull: true },
  totp_secret: { type: DataTypes.STRING(255), allowNull: true },
  totp_enabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  totp_last_used: { type: DataTypes.STRING(10), allowNull: true },
  sso_user: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  failed_login_attempts: { type: DataTypes.INTEGER, defaultValue: 0, allowNull: false },
  lockout_until: { type: DataTypes.DATE, allowNull: true },
  reset_password_token: { type: DataTypes.STRING(255), allowNull: true },
  reset_password_expires: { type: DataTypes.DATE, allowNull: true },
  custom_role_id: { type: DataTypes.INTEGER, allowNull: true },
}, { tableName: 'users', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password_hash);
};

User.hashPassword = async (password) => bcrypt.hash(password, 12);

module.exports = User;
