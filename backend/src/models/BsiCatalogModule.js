const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Baustein (Kompendium) bzw. Praktik-Gruppe (Grundschutz++) eines Katalogs.
//
// layer ist im Kompendium die Schicht (ISMS, ORP, ... INF), im Grundschutz++
// das Kuerzel der Praktik (GC, STM, ...). kind haelt fest, welches von beiden.
const BsiCatalogModule = sequelize.define('BsiCatalogModule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  catalog_id: { type: DataTypes.INTEGER, allowNull: false },
  module_id: { type: DataTypes.STRING(40), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  layer: { type: DataTypes.STRING(20), allowNull: false },
  kind: { type: DataTypes.ENUM('baustein', 'praktik'), allowNull: false, defaultValue: 'baustein' },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  tableName: 'bsi_catalog_modules',
  timestamps: false,
  indexes: [{ unique: true, fields: ['catalog_id', 'module_id'] }],
});

module.exports = BsiCatalogModule;
