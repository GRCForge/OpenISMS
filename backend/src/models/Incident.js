const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Sicherheitsvorfaelle (Incident Management, ISO 27001 A.5.24-5.28 / NIS-2 Art. 23).
const Incident = sequelize.define('Incident', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(20) },                 // INC-0001 (auto)
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  category: {
    type: DataTypes.ENUM('malware', 'phishing', 'data_breach', 'dos', 'unauthorized_access', 'misconfiguration', 'loss_theft', 'social_engineering', 'other'),
    defaultValue: 'other',
  },
  severity: { type: DataTypes.ENUM('low', 'medium', 'high', 'critical'), defaultValue: 'medium' },
  status: { type: DataTypes.ENUM('reported', 'investigating', 'contained', 'resolved', 'closed'), defaultValue: 'reported' },

  // Incident Classification
  is_security_incident: { type: DataTypes.BOOLEAN, defaultValue: true },
  is_gdpr_incident: { type: DataTypes.BOOLEAN, defaultValue: false },

  reporter_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },
  assignee_id: { type: DataTypes.INTEGER, references: { model: 'users', key: 'id' } },

  detected_at: { type: DataTypes.DATE },
  occurred_at: { type: DataTypes.DATE },
  resolved_at: { type: DataTypes.DATE },

  // NIS-2 Art. 23 Meldepflichten
  nis2_reportable: { type: DataTypes.BOOLEAN, defaultValue: false },
  early_warning_at: { type: DataTypes.DATE },   // Fruehwarnung (24h)
  notification_at: { type: DataTypes.DATE },    // Meldung (72h)

  impact: { type: DataTypes.TEXT },
  root_cause: { type: DataTypes.TEXT },
  corrective_actions: { type: DataTypes.TEXT },
  lessons_learned: { type: DataTypes.TEXT },

  // Weitergehende Dokumentation (DSGVO Art. 33/34 · NIS-2)
  affected_systems: { type: DataTypes.INTEGER, defaultValue: 0 },
  data_breach_details: { type: DataTypes.TEXT },  // Art und Umfang der betroffenen Daten
  external_report_id: { type: DataTypes.STRING(100) }, // Aktenzeichen Behörde (z.B. BSI, LfDI)

  // DSGVO Art. 33 — 72h Meldepflicht an Aufsichtsbehörde
  gdpr_breach_discovered_at: { type: DataTypes.DATE, allowNull: true }, // Zeitpunkt Kenntnisnahme
  gdpr_notified_at: { type: DataTypes.DATE, allowNull: true },           // Zeitpunkt der Meldung
  deleted: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  deleted_at: { type: DataTypes.DATE, allowNull: true },
  deletion_reason: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'incidents', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

Incident.afterCreate(async (incident) => {
  if (!incident.ref) {
    incident.ref = `INC-${String(incident.id).padStart(4, '0')}`;
    await incident.save();
  }
});

module.exports = Incident;
