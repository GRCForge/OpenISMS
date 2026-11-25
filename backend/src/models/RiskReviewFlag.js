const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// "Needs reassessment" marker of a risk with its reason (3.9.0, ISO/IEC
// 27005:2022 10.2/10.5, NIS-2 Art. 21). Raised by an event - incident, audit
// finding, threat advisory, critical/high CVE, KRI breach - or by an overdue
// periodic review. The assessment itself is never changed automatically.
//
// At most one OPEN flag per risk and trigger type (partial unique index,
// services/riskMonitoringService.js ensureIndexes); further events of the same
// type are appended to `occurrences`. The flag carries the reassessment task
// for the risk owner - at most one open task per risk and trigger type.
const TRIGGER_TYPES = ['incident', 'audit_finding', 'threat_advisory', 'cve', 'kri', 'review_overdue'];

const RiskReviewFlag = sequelize.define('RiskReviewFlag', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  trigger_type: { type: DataTypes.ENUM(...TRIGGER_TYPES), allowNull: false },
  status: { type: DataTypes.ENUM('open', 'resolved'), allowNull: false, defaultValue: 'open' },
  // First event: what raised the flag and why (text built by the server).
  source_type: { type: DataTypes.STRING(40) },
  source_id: { type: DataTypes.INTEGER },
  reason: { type: DataTypes.TEXT, allowNull: false },
  // Later events of the same type while the flag is open: [{ source_type,
  // source_id, reason, at }], newest last, capped.
  occurrences: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  occurrence_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  last_occurred_at: { type: DataTypes.DATE },
  task_id: { type: DataTypes.INTEGER },
  resolved_at: { type: DataTypes.DATE },
  resolved_by_id: { type: DataTypes.INTEGER },
  // reviewed | task_done | condition_cleared
  resolution: { type: DataTypes.STRING(40) },
  resolution_note: { type: DataTypes.TEXT },
}, {
  tableName: 'risk_review_flags', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at',
  indexes: [{ fields: ['risk_id', 'status'] }, { fields: ['task_id'] }, { fields: ['status', 'trigger_type'] }],
});

RiskReviewFlag.TRIGGER_TYPES = TRIGGER_TYPES;
module.exports = RiskReviewFlag;
