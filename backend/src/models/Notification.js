const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false }, // Receiver
  type: { type: DataTypes.ENUM('mention', 'reminder', 'system', 'assignment'), defaultValue: 'mention' },
  title: { type: DataTypes.STRING(255), allowNull: false },
  content: { type: DataTypes.TEXT },
  link: { type: DataTypes.STRING(500) }, // e.g. /assets/1#comment-5
  read: { type: DataTypes.BOOLEAN, defaultValue: false },
  actor_id: { type: DataTypes.INTEGER }, // Person who triggered it
}, { tableName: 'notifications', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Notification;
