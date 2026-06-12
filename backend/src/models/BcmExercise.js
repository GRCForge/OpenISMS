const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// BCM-Übungsprotokoll: Tabletop-, Simulations- und Failover-Übungen
const BcmExercise = sequelize.define('BcmExercise', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  process_id: { type: DataTypes.INTEGER, allowNull: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  exercise_type: { type: DataTypes.ENUM('tabletop', 'simulation', 'technical_recovery', 'full_failover'), defaultValue: 'tabletop' },
  exercise_date: { type: DataTypes.DATEONLY },
  participants: { type: DataTypes.TEXT },
  result: { type: DataTypes.ENUM('pending', 'passed', 'passed_with_findings', 'failed'), defaultValue: 'pending' },
  findings: { type: DataTypes.TEXT },
  actions: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'bcm_exercises', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = BcmExercise;
