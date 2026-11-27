const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A measure from the risk treatment plan taken over into the realisation plan
// of an information domain (BSI-Standard 200-3 chapter 7, consolidation:
// additional measures become part of the security concept; reference
// document A.6). Responsible, due date, status and costs stay in the
// treatment item - one source, no copy. The link only adds the priority in
// the realisation plan. It goes with its treatment item (CASCADE: items go
// with their risk).
const BsiRealizationMeasure = sequelize.define('BsiRealizationMeasure', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  domain_id: { type: DataTypes.INTEGER, allowNull: false },
  treatment_item_id: { type: DataTypes.INTEGER, allowNull: false },
  priority: { type: DataTypes.ENUM('high', 'medium', 'low'), allowNull: true },
  added_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'bsi_realization_measures',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['domain_id', 'treatment_item_id'] }],
});

module.exports = BsiRealizationMeasure;
