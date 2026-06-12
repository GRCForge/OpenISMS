const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PushSubscription = sequelize.define('PushSubscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  endpoint: { type: DataTypes.TEXT, allowNull: false },
  p256dh: { type: DataTypes.TEXT, allowNull: false },
  auth: { type: DataTypes.TEXT, allowNull: false },
  user_agent: { type: DataTypes.STRING(255), allowNull: true },
}, { tableName: 'push_subscriptions', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = PushSubscription;
