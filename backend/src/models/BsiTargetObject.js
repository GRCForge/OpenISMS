const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Zielobjekt eines Informationsverbunds (BSI-Standard 200-2 Kap. 8.1.x,
// Strukturanalyse). Zielobjekte sind keine eigene Inventarliste, sondern
// Assets aus dem Assetregister mit ihrem Grundschutz-Typ. Ein Asset ist je
// Verbund hoechstens einmal Zielobjekt.
//
// target_type: Zielobjekttypen der Strukturanalyse
//   business_process - Geschaeftsprozess
//   application      - Anwendung
//   it_system        - IT-System
//   ics              - ICS-System (industrielle Steuerung)
//   room             - Raum
//   building         - Gebaeude
//   network          - Netz / Kommunikationsverbindung
const BsiTargetObject = sequelize.define('BsiTargetObject', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  domain_id: { type: DataTypes.INTEGER, allowNull: false },
  asset_id: { type: DataTypes.INTEGER, allowNull: false },
  target_type: {
    type: DataTypes.ENUM('business_process', 'application', 'it_system', 'ics', 'room', 'building', 'network'),
    allowNull: false,
  },
  notes: { type: DataTypes.TEXT, allowNull: true },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'bsi_target_objects',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['domain_id', 'asset_id'] }],
});

module.exports = BsiTargetObject;
