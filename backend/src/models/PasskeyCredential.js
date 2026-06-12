const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PasskeyCredential = sequelize.define('PasskeyCredential', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  credential_id: { type: DataTypes.TEXT('long'), allowNull: false },
  public_key: { type: DataTypes.TEXT('long'), allowNull: false },
  counter: { type: DataTypes.BIGINT, defaultValue: 0 },
  device_type: { type: DataTypes.STRING(50), allowNull: true },
  backed_up: { type: DataTypes.BOOLEAN, defaultValue: false },
  transports: { type: DataTypes.JSON, defaultValue: [] },
  name: { type: DataTypes.STRING(255), defaultValue: 'Passkey' },
}, { tableName: 'passkey_credentials', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = PasskeyCredential;
