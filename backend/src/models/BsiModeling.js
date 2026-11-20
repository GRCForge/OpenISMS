const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Modellierung (BSI-Standard 200-2 Kap. 8.3): Ein Baustein (Kompendium) bzw.
// eine Praktik (Grundschutz++) wird einem Zielobjekt oder - bei
// prozessorientierten Bausteinen (ISMS, ORP, CON, OPS, DER) - dem ganzen
// Informationsverbund zugeordnet (target_object_id = null).
//
// module_id ist die Kennung im Katalog (bsi_catalog_modules.module_id), nicht
// deren Zeilen-ID: Nach einem Katalogwechsel bleibt die Zuordnung lesbar, auch
// wenn der neue Katalog den Baustein nicht mehr kennt.
//
// Die Eindeutigkeit (Verbund, Zielobjekt, Modul) prueft der Dienst in einer
// Transaktion; ein UNIQUE-Index greift bei target_object_id = null nicht,
// weil Postgres NULL-Werte als verschieden behandelt. Dafuer legt index.js
// einen Ausdrucksindex mit COALESCE an.
const BsiModeling = sequelize.define('BsiModeling', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  domain_id: { type: DataTypes.INTEGER, allowNull: false },
  target_object_id: { type: DataTypes.INTEGER, allowNull: true },
  catalog_id: { type: DataTypes.INTEGER, allowNull: true },
  module_id: { type: DataTypes.STRING(40), allowNull: false },
  notes: { type: DataTypes.TEXT, allowNull: true },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'bsi_modelings',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ fields: ['domain_id', 'module_id'] }],
});

module.exports = BsiModeling;
