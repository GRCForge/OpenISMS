const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Zentrales Risikoregister (ISO 27005 / BSI 200-3). Standardisierte Bewertung
// ueber Wahrscheinlichkeit x Auswirkung (5x5, siehe services/riskScale.js).
const Risk = sequelize.define('Risk', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(20) },                 // R-0001 (auto)
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  category: { type: DataTypes.STRING(100) },           // Taxonomie/Kategorie

  owner_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },

  // Inhaerentes Risiko
  likelihood: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3, validate: { min: 1, max: 5 } },
  impact: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3, validate: { min: 1, max: 5 } },
  inherent_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical') },

  // Behandlung
  treatment: { type: DataTypes.ENUM('mitigate', 'accept', 'transfer', 'avoid'), defaultValue: 'mitigate' },
  treatment_plan: { type: DataTypes.TEXT },

  // Restrisiko (nach Behandlung)
  residual_likelihood: { type: DataTypes.INTEGER, validate: { min: 1, max: 5 } },
  residual_impact: { type: DataTypes.INTEGER, validate: { min: 1, max: 5 } },
  residual_level: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical') },

  status: { type: DataTypes.ENUM('open', 'in_treatment', 'accepted', 'closed'), defaultValue: 'open' },
  acceptance_document_id: { type: DataTypes.INTEGER },  // Nachweis-/Akzeptanz-Dokument
  review_date: { type: DataTypes.DATEONLY },

  // Risk-Owner Sign-off (NIS-2 Management-Haftung): digitaler Freigabestatus
  accepted_by_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  accepted_at: { type: DataTypes.DATE },
  accepted_until: { type: DataTypes.DATEONLY },
}, { tableName: 'risks', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

// Lesbare Referenz (R-0001) nach dem Anlegen setzen
Risk.afterCreate(async (risk) => {
  if (!risk.ref) {
    risk.ref = `R-${String(risk.id).padStart(4, '0')}`;
    await risk.save();
  }
});

module.exports = Risk;
