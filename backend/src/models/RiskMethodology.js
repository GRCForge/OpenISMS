const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Risikomethodik (ISO 27005 Kap. 6/7, ISO 31000 6.3.4, ISO 27001 6.1.2 a):
// Skalen fuer Wahrscheinlichkeit und Auswirkung, Risikostufen mit Schwellen,
// Risikoappetit je Kategorie und Akzeptanzbefugnis je Stufe.
//
// Jede Zeile ist EINE VERSION und wird nach dem Anlegen nicht mehr geaendert.
// Eine Aenderung an der aktiven Methodik legt eine neue Zeile an und setzt die
// bisherige auf "superseded"; Risiken behalten den Verweis auf die Version, nach
// der sie bewertet wurden. So bleibt jede Bewertung mit genau den Kriterien
// nachvollziehbar, unter denen sie entstand.
//
// Aufbau der JSON-Felder (geprueft in services/riskMethodology.js):
//   likelihood_levels / impact_levels: [{ value, label_de, label_en, description, range_min, range_max }]
//   risk_levels: [{ key: low|medium|high|critical, label_de, label_en, color, min_score, max_score }]
//   appetite:    { default_max_level: key|null, categories: [{ category, max_level }] }
//   acceptance:  [{ level, roles: [...], max_months: n|null }]
const RiskMethodology = sequelize.define('RiskMethodology', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  version: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  name: { type: DataTypes.STRING(150), allowNull: false },
  status: { type: DataTypes.ENUM('active', 'superseded'), allowNull: false, defaultValue: 'active' },
  likelihood_unit: { type: DataTypes.STRING(60) },
  impact_unit: { type: DataTypes.STRING(60) },
  likelihood_levels: { type: DataTypes.JSONB, allowNull: false },
  impact_levels: { type: DataTypes.JSONB, allowNull: false },
  risk_levels: { type: DataTypes.JSONB, allowNull: false },
  appetite: { type: DataTypes.JSONB, allowNull: false },
  acceptance: { type: DataTypes.JSONB, allowNull: false },
  change_note: { type: DataTypes.TEXT },
  created_by_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  activated_at: { type: DataTypes.DATE },
  superseded_at: { type: DataTypes.DATE },
}, { tableName: 'risk_methodologies', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = RiskMethodology;
