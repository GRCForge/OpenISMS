const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ApiToken = sequelize.define('ApiToken', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  // Legacy cleartext column — kept nullable for backward compatibility during
  // migration; new tokens store only the hash below and leave this null.
  token: { type: DataTypes.STRING(255), allowNull: true },
  // SHA-256 hash of the token; the cleartext is shown to the user only once.
  token_hash: { type: DataTypes.STRING(64), allowNull: true },
  // Non-secret prefix for display/identification in the UI (e.g. isms_api_a1b2c3).
  token_prefix: { type: DataTypes.STRING(24), allowNull: true },
  expires_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'api_tokens', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = ApiToken;
