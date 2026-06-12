const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PolicyAcknowledgment = sequelize.define('PolicyAcknowledgment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  policy_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  acknowledged_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'policy_acknowledgments', timestamps: false });

module.exports = PolicyAcknowledgment;
