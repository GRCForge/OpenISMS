const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BsiRequirement = sequelize.define('BsiRequirement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  baustein_id: { type: DataTypes.STRING(20), allowNull: false },
  baustein_name: { type: DataTypes.STRING(255), allowNull: false },
  layer: { type: DataTypes.STRING(20), allowNull: false },
  req_id: { type: DataTypes.STRING(30), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  // normal_sdt/erhoeht: Absicherungsstufen des Grundschutz++ (siehe BsiCatalogRequirement).
  requirement_level: {
    type: DataTypes.ENUM('basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht'),
    defaultValue: 'basis',
  },
  // Katalog, aus dem die Anforderung zuletzt abgeglichen wurde (bsi_catalogs.id).
  catalog_id: { type: DataTypes.INTEGER, allowNull: true },
  // Informationsverbund, dem der Umsetzungsstand gehoert (bsi_information_domains.id).
  // Die Startmigration ordnet den Bestand dem Standard-Verbund zu
  // (bsiDomainService.ensureDefaultDomain); null kommt danach nicht mehr vor.
  domain_id: { type: DataTypes.INTEGER, allowNull: true },
  // Im aktiven Katalog nicht mehr enthalten oder dort "ENTFALLEN". Die Zeile
  // bleibt mit Status, Verantwortlichem und Notizen erhalten - geloescht wird
  // beim Katalogwechsel nichts.
  retired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Zielobjekt des IT-Grundschutz-Checks (bsi_target_objects.id); null = die
  // Anforderung gilt fuer den ganzen Verbund. Die bisherige Liste ist der
  // Verbund-Stand des Standard-Verbunds (target_object_id = null).
  target_object_id: { type: DataTypes.INTEGER, allowNull: true },
  // Umsetzungsstatus = Ergebnis des IT-Grundschutz-Checks (BSI 200-2 Kap. 8.4):
  //   implemented     ja
  //   in_progress     teilweise
  //   not_implemented nein (bewusst nicht umgesetzt) - seit 3.5
  //   not_applicable  entbehrlich
  //   not_started     offen (noch nicht geprueft)
  // not_implemented und not_applicable verlangen eine Begruendung
  // (services/bsiCheckService.js, an jedem Schreibweg).
  implementation_status: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable', 'not_implemented'),
    defaultValue: 'not_started',
  },
  justification: { type: DataTypes.TEXT, allowNull: true },
  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  responsible_group_id: { type: DataTypes.INTEGER, allowNull: true },
  // Umsetzungstermin (Realisierungsplanung)
  due_date: { type: DataTypes.DATEONLY, allowNull: true },
  // Kosten in EUR: einmalig bzw. laufend pro Jahr
  cost_once: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  cost_recurring: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  // Priority in the realisation plan (reference document A.6, 3.10.0). NULL:
  // not set - the plan then suggests one from the requirement level
  // (services/bsiRiskAnalysisService.js suggestRequirementPriority).
  realization_priority: { type: DataTypes.ENUM('high', 'medium', 'low'), allowNull: true },
  notes: { type: DataTypes.TEXT },
  last_review_date: { type: DataTypes.DATEONLY },
}, {
  tableName: 'bsi_requirements',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = BsiRequirement;
