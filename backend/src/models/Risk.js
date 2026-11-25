const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Zentrales Risikoregister (ISO 27005 / BSI 200-3). Bewertung ueber
// Wahrscheinlichkeit x Auswirkung nach der Risikomethodik, an deren Version das
// Risiko haengt (methodology_id, siehe services/riskMethodology.js). Die Skalen
// haben 3 bis 6 Stufen; ob ein Wert in die Skala SEINER Version passt, prueft der
// beforeSave-Hook in models/index.js - die Grenzen hier sind nur der Rahmen.
const Risk = sequelize.define('Risk', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(20) },                 // R-0001 (auto)
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  // Key of an entry in the risk category taxonomy (risk_categories.key). Since
  // 3.7.0 a maintained list; values from before became entries at startup.
  category: { type: DataTypes.STRING(100) },

  owner_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },

  // Inhaerentes Risiko (Brutto)
  likelihood: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3, validate: { min: 1, max: 6 } },
  impact: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3, validate: { min: 1, max: 6 } },
  inherent_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical') },
  // Impact per dimension { confidentiality: 4, financial: 2, ... } - only the
  // dimensions the methodology version enables. When at least one is rated,
  // impact is their maximum (beforeSave hook). NULL: impact is a single value
  // (all risks from before 3.7.0 - no conversion).
  impact_dimensions: { type: DataTypes.JSONB, allowNull: true },
  // Rationale of the assessment (ISO 27005:2022 8.3). Mandatory whenever the
  // values change (services/riskService.js); existing risks stay editable.
  likelihood_rationale: { type: DataTypes.TEXT },
  impact_rationale: { type: DataTypes.TEXT },

  // Behandlung
  treatment: { type: DataTypes.ENUM('mitigate', 'accept', 'transfer', 'avoid'), defaultValue: 'mitigate' },
  treatment_plan: { type: DataTypes.TEXT },

  // Net (current) risk with the implemented controls - calculated in
  // services/residual.js unless overridden with a rationale (residual_override).
  residual_likelihood: { type: DataTypes.INTEGER, validate: { min: 1, max: 6 } },
  residual_impact: { type: DataTypes.INTEGER, validate: { min: 1, max: 6 } },
  residual_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical') },
  residual_override: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  residual_override_reason: { type: DataTypes.TEXT },
  residual_override_by_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  residual_override_at: { type: DataTypes.DATE },

  // Target risk after the planned treatment - set manually
  target_likelihood: { type: DataTypes.INTEGER, validate: { min: 1, max: 6 } },
  target_impact: { type: DataTypes.INTEGER, validate: { min: 1, max: 6 } },
  target_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical') },

  status: { type: DataTypes.ENUM('open', 'in_treatment', 'accepted', 'closed'), defaultValue: 'open' },
  acceptance_document_id: { type: DataTypes.INTEGER },  // Nachweis-/Akzeptanz-Dokument
  review_date: { type: DataTypes.DATEONLY },

  // Risk-Owner Sign-off (NIS-2 Management-Haftung): digitaler Freigabestatus
  accepted_by_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  accepted_at: { type: DataTypes.DATE },
  accepted_until: { type: DataTypes.DATEONLY },

  // Version der Risikomethodik, nach der dieses Risiko bewertet ist. Weicht sie
  // von der aktiven Version ab, steht das Risiko auf der Liste "neu zu
  // bewerten"; umgerechnet wird nie still, nur durch eine protokollierte
  // Neubewertung (services/riskService.js).
  methodology_id: { type: DataTypes.INTEGER, references: { model: 'risk_methodologies', key: 'id' } },
}, { tableName: 'risks', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

// Lesbare Referenz (R-0001) nach dem Anlegen setzen
Risk.afterCreate(async (risk) => {
  if (!risk.ref) {
    risk.ref = `R-${String(risk.id).padStart(4, '0')}`;
    await risk.save();
  }
});

module.exports = Risk;
