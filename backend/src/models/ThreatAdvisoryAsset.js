const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Welche Assets betrifft eine Warnmeldung?
//
// Ohne diese Verknuepfung bleibt eine Meldung eine Nachricht. Mit ihr wird sie
// auswertbar: "welche unserer Systeme sind von der aktuellen Warnung betroffen"
// ist die erste Frage in jeder Lagebesprechung und zugleich der Nachweis, dass
// die Meldung ueberhaupt gegen das eigene Inventar geprueft wurde.
//
// match_source trennt dabei, was die Maschine vorgeschlagen hat, von dem, was
// ein Mensch bestaetigt hat. Ein automatischer CVE- oder Namenstreffer ist ein
// Hinweis, keine Feststellung — und ein Auditor darf den Unterschied sehen.
const ThreatAdvisoryAsset = sequelize.define('ThreatAdvisoryAsset', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  advisory_id: { type: DataTypes.INTEGER, allowNull: false },
  asset_id: { type: DataTypes.INTEGER, allowNull: false },
  match_source: {
    type: DataTypes.ENUM('manual', 'cve_match', 'keyword_match'),
    defaultValue: 'manual',
    allowNull: false,
  },
  confirmed: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  note: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'threat_advisory_assets',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['advisory_id', 'asset_id'], name: 'uq_threat_advisory_asset' },
    { fields: ['asset_id'], name: 'idx_threat_advisory_assets_asset' },
  ],
});

module.exports = ThreatAdvisoryAsset;
