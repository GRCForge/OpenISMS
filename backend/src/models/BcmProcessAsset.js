const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Welche Assets traegt ein Geschaeftsprozess?
//
// bcm_processes.dependencies war bis v2.2.x ein Freitextfeld. Darin stand
// zwar meist die richtige Antwort, aber nur fuer Menschen lesbar: Keine
// Auswertung konnte daraus ableiten, welche Prozesse stillstehen, wenn ein
// bestimmter Server ausfaellt. Genau das ist aber die Frage, die eine
// Auswirkungsanalyse beantworten soll, und die Kette Asset -> Prozess ->
// Risiko -> Massnahme -> Anforderung beginnt hier.
//
// Das Freitextfeld bleibt erhalten und wird nicht ersetzt - es traegt
// Abhaengigkeiten, die kein Asset im Inventar sind (Personal, Zulieferung,
// Raeumlichkeiten). Diese Tabelle ergaenzt es um den Teil, der auswertbar ist.
const BcmProcessAsset = sequelize.define('BcmProcessAsset', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  bcm_process_id: { type: DataTypes.INTEGER, allowNull: false },
  asset_id: { type: DataTypes.INTEGER, allowNull: false },
  // Wie hart haengt der Prozess an diesem Asset? Ein Prozess kann ohne sein
  // Reporting-System weiterlaufen, ohne seine Datenbank nicht. Ohne diese
  // Unterscheidung meldet die Auswirkungsanalyse jeden Ausfall als
  // Prozessausfall und wird damit wertlos.
  criticality: {
    type: DataTypes.ENUM('essential', 'supporting'),
    defaultValue: 'essential',
    allowNull: false,
  },
  note: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'bcm_process_assets',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['bcm_process_id', 'asset_id'], name: 'uq_bcm_process_asset' },
    { fields: ['asset_id'], name: 'idx_bcm_process_assets_asset' },
  ],
});

module.exports = BcmProcessAsset;
