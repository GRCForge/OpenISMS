const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ApiToken = sequelize.define('ApiToken', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  token: { type: DataTypes.STRING(255), allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'api_tokens', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = ApiToken;
