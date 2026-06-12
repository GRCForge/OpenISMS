const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BcmProcess = sequelize.define('BcmProcess', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  criticality: { type: DataTypes.ENUM('critical', 'important', 'normal'), defaultValue: 'normal' },
  rto_hours: { type: DataTypes.INTEGER },
  rpo_hours: { type: DataTypes.INTEGER },
  owner_id: { type: DataTypes.INTEGER, allowNull: true },
  dependencies: { type: DataTypes.TEXT },
  recovery_strategy: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('documented', 'tested', 'approved'), defaultValue: 'documented' },
  last_test_date: { type: DataTypes.DATEONLY },
  next_test_date: { type: DataTypes.DATEONLY },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'bcm_processes', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = BcmProcess;
