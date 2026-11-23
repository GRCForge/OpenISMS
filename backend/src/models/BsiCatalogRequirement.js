const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Anforderung eines importierten Katalogs - Katalogstand, nicht Umsetzungsstand.
// Der Umsetzungsstand liegt weiterhin in bsi_requirements und wird beim
// Aktivieren eines Katalogs mit dessen Anforderungen abgeglichen.
//
// Absicherungsstufe (requirement_level):
//   Kompendium 2023: basis (B), standard (S), erhoehter_schutzbedarf (H)
//   Grundschutz++:   normal_sdt ("normal-SdT"), erhoeht ("erhöht")
//   generisches OSCAL ohne sec_level: null
const BsiCatalogRequirement = sequelize.define('BsiCatalogRequirement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  catalog_id: { type: DataTypes.INTEGER, allowNull: false },
  module_id: { type: DataTypes.STRING(40), allowNull: false },
  req_id: { type: DataTypes.STRING(40), allowNull: false },
  parent_req_id: { type: DataTypes.STRING(40), allowNull: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  layer: { type: DataTypes.STRING(20), allowNull: false },
  requirement_level: {
    type: DataTypes.ENUM('basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht'),
    allowNull: true,
  },
  modal_verb: { type: DataTypes.STRING(20), allowNull: true },
  effort_level: { type: DataTypes.INTEGER, allowNull: true },
  // Grundschutz++: statement.target_object_categories, z. B. ["IT-Systeme","Netze"]
  target_object_categories: { type: DataTypes.JSONB, allowNull: true },
  // Kompendium: zustaendige Rolle(n) aus "[...]" im Titel
  roles: { type: DataTypes.STRING(255), allowNull: true },
  text: { type: DataTypes.TEXT, allowNull: true },
  guidance: { type: DataTypes.TEXT, allowNull: true },
  // Kompendium: "ENTFALLEN" - die Nummer bleibt belegt, die Anforderung gilt nicht mehr.
  withdrawn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: 'bsi_catalog_requirements',
  timestamps: false,
  indexes: [{ unique: true, fields: ['catalog_id', 'req_id'] }],
});

module.exports = BsiCatalogRequirement;
