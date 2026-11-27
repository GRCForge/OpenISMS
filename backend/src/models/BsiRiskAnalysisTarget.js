const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Selection of a target object for the risk analysis (BSI-Standard 200-3,
// chapter 3: which target objects need a risk analysis). Whether a target
// object is selected is computed from the data on every read
// (services/bsiRiskAnalysisService.js): high or very high protection need,
// no module modelled, or an operating scenario the modules do not cover.
// A row exists only once somebody decided something by hand:
//
//   decision  auto    - the computed criteria decide (default)
//             include - added by hand, decision_reason mandatory
//             exclude - removed by hand, decision_reason mandatory
//   scenario_not_covered - "Einsatzszenario nicht abgedeckt" (200-3 ch. 3),
//             a manual criterion: the catalogue cannot know it; note mandatory
//   status    progress of the analysis for this target object
//
// One row per target object; it goes with nothing implicitly - a target
// object with risk analysis data cannot be removed from its domain
// (bsiDomainService.removeTargetObject).
const BsiRiskAnalysisTarget = sequelize.define('BsiRiskAnalysisTarget', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  domain_id: { type: DataTypes.INTEGER, allowNull: false },
  target_object_id: { type: DataTypes.INTEGER, allowNull: false },
  decision: { type: DataTypes.ENUM('auto', 'include', 'exclude'), allowNull: false, defaultValue: 'auto' },
  decision_reason: { type: DataTypes.TEXT, allowNull: true },
  scenario_not_covered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  scenario_note: { type: DataTypes.TEXT, allowNull: true },
  status: { type: DataTypes.ENUM('open', 'in_progress', 'completed'), allowNull: false, defaultValue: 'open' },
  completed_at: { type: DataTypes.DATE, allowNull: true },
  updated_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'bsi_risk_analysis_targets',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['target_object_id'] }, { fields: ['domain_id'] }],
});

module.exports = BsiRiskAnalysisTarget;
