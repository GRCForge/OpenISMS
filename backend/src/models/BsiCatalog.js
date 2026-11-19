const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Ein importierter Grundschutz-Katalog in einer bestimmten Edition.
//
// Kataloge werden zur Laufzeit importiert (Kompendium-XML oder OSCAL-catalog),
// nicht mit dem Code ausgeliefert. Ein Import landet zunaechst als "preview":
// Er ist gespeichert und vergleichbar, aendert aber nichts an den Anforderungen,
// mit denen gearbeitet wird. Erst "activate" uebernimmt ihn - bewusst, mit
// Audit-Eintrag. Es gibt hoechstens einen aktiven Katalog; der vorige wird
// "archived" und bleibt fuer Vergleiche erhalten.
const BsiCatalog = sequelize.define('BsiCatalog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  edition: { type: DataTypes.STRING(120), allowNull: true },
  // seed = der mitgelieferte Auszug, kompendium_xml = DocBook-XML des BSI,
  // oscal_catalog = OSCAL catalog-Modell (z. B. Grundschutz++ Anwenderkatalog).
  format: { type: DataTypes.ENUM('seed', 'kompendium_xml', 'oscal_catalog'), allowNull: false },
  source: { type: DataTypes.ENUM('seed', 'upload', 'url'), allowNull: false },
  source_url: { type: DataTypes.STRING(2048), allowNull: true },
  source_filename: { type: DataTypes.STRING(255), allowNull: true },
  source_sha256: { type: DataTypes.STRING(64), allowNull: true },
  // Aus dem Dokument selbst (OSCAL metadata.version / oscal-version), falls vorhanden.
  source_version: { type: DataTypes.STRING(120), allowNull: true },
  oscal_version: { type: DataTypes.STRING(20), allowNull: true },
  status: { type: DataTypes.ENUM('preview', 'active', 'archived'), allowNull: false, defaultValue: 'preview' },
  module_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  requirement_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  imported_by_id: { type: DataTypes.INTEGER, allowNull: true },
  activated_by_id: { type: DataTypes.INTEGER, allowNull: true },
  activated_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'bsi_catalogs',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = BsiCatalog;
