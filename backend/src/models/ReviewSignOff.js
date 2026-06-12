const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ReviewSignOff = sequelize.define('ReviewSignOff', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  report_date: { type: DataTypes.DATEONLY, allowNull: false },
  approved_by_id: { type: DataTypes.INTEGER, allowNull: false },
  approved_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'review_sign_offs', timestamps: false });

module.exports = ReviewSignOff;
