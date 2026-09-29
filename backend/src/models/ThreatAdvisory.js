const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Eine einzelne externe Warnmeldung (BSI/CERT-Bund-Warnung, CISA-Advisory,
// Herstellermeldung, Security-News) samt ihrer Bewertung.
//
// Der Nachweis, den NIS-2 Art. 21(2)(a) verlangt, entsteht nicht durch das
// Sammeln der Meldungen, sondern durch die Spalten danach: relevance (ist das
// fuer uns ueberhaupt einschlaegig?), assessed_by/assessed_at (wer hat das wann
// entschieden?) und risk_id/task_id/incident_id (was ist daraus im
// Risikomanagement geworden?). Eine Meldung ohne diese Entscheidung ist
// 'not_assessed' und faellt in der Statistik als offene Bewertung auf.
const ThreatAdvisory = sequelize.define('ThreatAdvisory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ref: { type: DataTypes.STRING(20) },                  // TA-0001 (auto)

  source_id: { type: DataTypes.INTEGER, allowNull: true },
  // Kennung der Quelle (WID-SEC-2026-0001, CVE-2026-1234, GUID eines Feeds).
  // Zusammen mit source_id der Schluessel gegen Doubletten beim Feed-Abruf.
  external_id: { type: DataTypes.STRING(255) },

  title: { type: DataTypes.STRING(500), allowNull: false },
  summary: { type: DataTypes.TEXT },
  url: { type: DataTypes.STRING(1000) },
  published_at: { type: DataTypes.DATE },

  severity: { type: DataTypes.ENUM('critical', 'high', 'medium', 'low', 'info'), defaultValue: 'medium' },
  cve_ids: { type: DataTypes.TEXT },                    // "CVE-2026-1234, CVE-2026-1235"

  relevance: {
    type: DataTypes.ENUM('not_assessed', 'not_relevant', 'monitor', 'relevant', 'critical'),
    defaultValue: 'not_assessed',
  },
  status: {
    type: DataTypes.ENUM('new', 'in_assessment', 'action_required', 'mitigated', 'closed'),
    defaultValue: 'new',
  },

  assessed_by_id: { type: DataTypes.INTEGER, allowNull: true },
  assessed_at: { type: DataTypes.DATE },
  assessment_notes: { type: DataTypes.TEXT },

  // Uebergabe an das Risikomanagement — der belastbare Teil der Antwort auf
  // "werden externe Warnmeldungen systematisch einbezogen?".
  risk_id: { type: DataTypes.INTEGER, allowNull: true },
  task_id: { type: DataTypes.INTEGER, allowNull: true },
  incident_id: { type: DataTypes.INTEGER, allowNull: true },

  ingested_via: { type: DataTypes.ENUM('manual', 'feed'), defaultValue: 'manual' },
}, {
  tableName: 'threat_advisories',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['status'] },
    { fields: ['relevance'] },
    { fields: ['published_at'] },
    // Doubletten-Schutz fuer den Feed-Abruf: dieselbe Meldung derselben Quelle
    // darf nur einmal im Register stehen. Manuelle Eintraege ohne external_id
    // sind davon nicht betroffen (NULL kollidiert in Postgres nie).
    { unique: true, fields: ['source_id', 'external_id'], name: 'threat_advisories_source_external_uq' },
  ],
});

// Lesbare Referenz (TA-0001) nach dem Anlegen setzen — wie bei Risk.
ThreatAdvisory.afterCreate(async (advisory) => {
  if (!advisory.ref) {
    advisory.ref = `TA-${String(advisory.id).padStart(4, '0')}`;
    await advisory.save();
  }
});

module.exports = ThreatAdvisory;
