const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DiscoveredSoftware = sequelize.define('DiscoveredSoftware', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  version: { type: DataTypes.STRING(50) },
  vendor: { type: DataTypes.STRING(255) },
  hostname: { type: DataTypes.STRING(255), allowNull: false },
  ip: { type: DataTypes.STRING(255) },
  // TEXT statt STRING(255): Das Feld traegt bei Connector-Eintraegen nicht nur
  // den Betriebssystemnamen, sondern die Herkunftszeile ("CheckMK-Host: x |
  // IP: ... | 5x CRIT: ..."). Mit mehreren Servicenamen darin sind 255 Zeichen
  // schnell erreicht, und PostgreSQL kuerzt nicht, sondern bricht die Zeile ab
  // — ein Host mit vielen CRIT-Services waere damit ausgerechnet der, der es
  // nicht ins Staging schafft.
  os: { type: DataTypes.TEXT },
  status: { type: DataTypes.ENUM('pending', 'approved', 'ignored'), defaultValue: 'pending', allowNull: false },
  source: { type: DataTypes.STRING(50), defaultValue: 'agent', allowNull: false },
  asset_type: { type: DataTypes.STRING(50), defaultValue: 'software', allowNull: false },
  open_ports: { type: DataTypes.TEXT, allowNull: true },
  // Weitere Asset-Angaben, fuer die es hier keine Spalte gibt (JSON).
  //
  // Eine Excel-Zeile traegt mehr als Name, Hostname und IP: Klassifizierung,
  // Schutzbedarf, Abteilung, Tags. Ohne diese Spalte muesste der Import
  // entweder an der Freigabe vorbei direkt Assets anlegen oder die Angaben
  // wegwerfen — und Wegwerfen faellt niemandem auf, weil das Asset ja entsteht.
  //
  // Beim Freigeben werden nur bekannte Felder uebernommen (services/
  // integrations/datei.js). Ein ungefiltertes Spread haette hier eine
  // Mass-Assignment-Luecke aufgemacht: der Inhalt stammt aus einer Datei.
  payload: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'discovered_softwares', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = DiscoveredSoftware;
