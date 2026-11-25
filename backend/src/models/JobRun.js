const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One row per scheduled job and period (utils/jobLock.js withJobSlot, 3.9.0):
// the unique (name, slot) pair lets exactly one instance run a job per period
// when several instances share the database.
const JobRun = sequelize.define('JobRun', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(80), allowNull: false },
  slot: { type: DataTypes.STRING(40), allowNull: false },
  holder: { type: DataTypes.STRING(120) },
  status: { type: DataTypes.ENUM('running', 'done', 'failed'), allowNull: false, defaultValue: 'running' },
  started_at: { type: DataTypes.DATE, allowNull: false },
  finished_at: { type: DataTypes.DATE },
}, {
  tableName: 'job_runs', timestamps: false,
  indexes: [{ unique: true, fields: ['name', 'slot'], name: 'job_runs_name_slot_uq' }],
});

module.exports = JobRun;
