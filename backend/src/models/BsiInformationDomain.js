const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Informationsverbund nach BSI-Standard 200-2 (Kap. 8.1): der Geltungsbereich,
// fuer den die Sicherheitskonzeption erstellt wird.
//
// protection_approach ist die Absicherungsvariante (200-2 Kap. 3.3):
//   basis    - Basis-Absicherung: nur Basis-Anforderungen
//   standard - Standard-Absicherung: Basis- und Standard-Anforderungen
//   kern     - Kern-Absicherung: die "Kronjuwelen" eines eingegrenzten
//              Bereichs, dort alle Anforderungen einschliesslich erhoehtem
//              Schutzbedarf (siehe services/bsiDomainService.js)
//
// catalog_id folgt dem aktiven Katalog: Es gibt hoechstens einen aktiven
// Katalog (bsi_catalogs.status = 'active'), und dessen Aktivierung zieht alle
// Verbuende nach (bsiCatalogService.activateCatalog). Der Wert haelt fest,
// nach welchem Katalog der Verbund zuletzt modelliert wurde.
//
// is_default markiert den Verbund, den die Migration fuer den Bestand anlegt:
// Ihm gehoeren die Anforderungen, die es vor den Verbuenden schon gab.
const BsiInformationDomain = sequelize.define('BsiInformationDomain', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  scope: { type: DataTypes.TEXT, allowNull: true },
  protection_approach: { type: DataTypes.ENUM('basis', 'standard', 'kern'), allowNull: false, defaultValue: 'standard' },
  catalog_id: { type: DataTypes.INTEGER, allowNull: true },
  is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'bsi_information_domains',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = BsiInformationDomain;
