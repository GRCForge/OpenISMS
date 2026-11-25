const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Assessment history of a risk (3.9.0, ISO/IEC 27005:2022 clause 10, ISO/IEC
// 27001:2022 8.2/9.1): one immutable row per change of the gross, net or
// target assessment - values, levels, methodology version, trigger, user,
// time. Written by services/riskHistoryService.js from the Risk save hooks, so
// every write path (form, MCP, import, carry-over, threat advisory) is covered.
// Rows are never updated or deleted by the application (hooks below); they go
// only with their risk (CASCADE).
//
// trigger:
//   baseline_at_upgrade  first row for risks that existed before 3.9.0
//   created              risk created
//   assessment           likelihood/impact/target changed by a person
//   reassessment         reassessed under the active methodology version
//   carry_over           carried over to a new methodology version
//   residual_override    net risk overridden or override removed
//   residual_recalculated net risk recalculated (controls changed)
//   review               periodic review confirmed (values unchanged)
//   system               any other write path
const TRIGGERS = ['baseline_at_upgrade', 'created', 'assessment', 'reassessment', 'carry_over', 'residual_override', 'residual_recalculated', 'review', 'system'];
const LEVELS = ['low', 'medium', 'high', 'critical'];

const RiskAssessmentHistory = sequelize.define('RiskAssessmentHistory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  risk_id: { type: DataTypes.INTEGER, allowNull: false },
  recorded_at: { type: DataTypes.DATE, allowNull: false },
  trigger: { type: DataTypes.ENUM(...TRIGGERS), allowNull: false },
  trigger_detail: { type: DataTypes.STRING(255) },
  user_id: { type: DataTypes.INTEGER },
  user_name: { type: DataTypes.STRING(255) },
  methodology_id: { type: DataTypes.INTEGER },
  methodology_version: { type: DataTypes.INTEGER },
  likelihood: { type: DataTypes.INTEGER },
  impact: { type: DataTypes.INTEGER },
  impact_dimensions: { type: DataTypes.JSONB },
  inherent_level: { type: DataTypes.ENUM(...LEVELS) },
  residual_likelihood: { type: DataTypes.INTEGER },
  residual_impact: { type: DataTypes.INTEGER },
  residual_level: { type: DataTypes.ENUM(...LEVELS) },
  residual_override: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  target_likelihood: { type: DataTypes.INTEGER },
  target_impact: { type: DataTypes.INTEGER },
  target_level: { type: DataTypes.ENUM(...LEVELS) },
  // Fields that changed against the previous row (empty for baseline/review).
  changed_fields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  note: { type: DataTypes.TEXT },
}, {
  tableName: 'risk_assessment_history', timestamps: false,
  indexes: [{ fields: ['risk_id', 'recorded_at'] }, { fields: ['recorded_at'] }],
});

const immutable = () => { throw Object.assign(new Error('Assessment history entries are immutable.'), { status: 409 }); };
RiskAssessmentHistory.addHook('beforeUpdate', 'immutable', immutable);
RiskAssessmentHistory.addHook('beforeBulkUpdate', 'immutable', immutable);
RiskAssessmentHistory.addHook('beforeDestroy', 'immutable', immutable);
RiskAssessmentHistory.addHook('beforeBulkDestroy', 'immutable', immutable);

RiskAssessmentHistory.TRIGGERS = TRIGGERS;
module.exports = RiskAssessmentHistory;
