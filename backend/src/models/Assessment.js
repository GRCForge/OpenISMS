const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Assessment = sequelize.define('Assessment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  asset_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'assets', key: 'id' } },
  assessor_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
  confidentiality: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 }, comment: '1=Very Low, 5=Very High' },
  integrity: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
  availability: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
  risk_score: { type: DataTypes.FLOAT, allowNull: false },
  risk_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), allowNull: false },
  notes: { type: DataTypes.TEXT },
  mitigation: { type: DataTypes.TEXT },

  // Risikobehandlung (ISO 27005 / NIS-2): Reduzieren, Akzeptieren, Uebertragen, Vermeiden
  risk_treatment: { type: DataTypes.ENUM('mitigate', 'accept', 'transfer', 'avoid'), allowNull: true },
  treatment_justification: { type: DataTypes.TEXT },
  // Bei Risikoakzeptanz (accept): Verantwortliche/r, Gueltigkeit und verknuepftes Akzeptanz-Dokument (Pflicht)
  accepted_by: { type: DataTypes.STRING(150) },
  accepted_until: { type: DataTypes.DATEONLY },
  acceptance_document_id: { type: DataTypes.INTEGER, allowNull: true },
  assessed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  next_review_at: { type: DataTypes.DATE, allowNull: false },
  is_current: { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'assessments', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

Assessment.calculateRisk = (c, i, a) => {
  const score = (c + i + a) / 3;
  let level;
  if (score <= 2) level = 'low';
  else if (score <= 3) level = 'medium';
  else if (score <= 4) level = 'high';
  else level = 'critical';
  return { score: parseFloat(score.toFixed(2)), level };
};

module.exports = Assessment;
