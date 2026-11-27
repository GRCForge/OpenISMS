const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One line of the threat overview ("Gefaehrdungsuebersicht", BSI-Standard
// 200-3 chapter 4) of a target object: an elementary threat (threats.source
// 'bsi_elementar', G 0.1 - G 0.47) or an additional threat.
//
//   relevant   null = not yet assessed, true/false = assessed (note optional)
//   coverage   whether the requirements of the modelled modules cover the
//              threat: unknown | covered | partially | not_covered. Always set
//              by hand: the imported catalogues carry no mapping of elementary
//              threats to modules (the cross-reference tables of the
//              Kompendium are not part of the XML edition, Grundschutz++ has
//              none) - see services/bsiRiskAnalysisService.js.
//   risk_id    the risk in the register created from the classification
//              (frequency x impact, 200-3 chapter 5). Values live in the risk
//              only - no copy here that could drift. A second classification
//              updates that risk instead of creating another one.
//
// Elementary threats without a row are shown as "not assessed"; rows of
// additional threats exist from the moment they are added.
const BsiRiskAnalysisThreat = sequelize.define('BsiRiskAnalysisThreat', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  domain_id: { type: DataTypes.INTEGER, allowNull: false },
  target_object_id: { type: DataTypes.INTEGER, allowNull: false },
  threat_id: { type: DataTypes.INTEGER, allowNull: false },
  relevant: { type: DataTypes.BOOLEAN, allowNull: true },
  relevance_note: { type: DataTypes.TEXT, allowNull: true },
  coverage: { type: DataTypes.ENUM('unknown', 'covered', 'partially', 'not_covered'), allowNull: false, defaultValue: 'unknown' },
  coverage_note: { type: DataTypes.TEXT, allowNull: true },
  // true for a threat added to the overview of this target object (not one of
  // the 47 elementary threats).
  additional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  risk_id: { type: DataTypes.INTEGER, allowNull: true },
  assessed_by_id: { type: DataTypes.INTEGER, allowNull: true },
  assessed_at: { type: DataTypes.DATE, allowNull: true },
  classified_by_id: { type: DataTypes.INTEGER, allowNull: true },
  classified_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'bsi_risk_analysis_threats',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['target_object_id', 'threat_id'] }, { fields: ['domain_id'] }, { fields: ['risk_id'] }],
});

module.exports = BsiRiskAnalysisThreat;
