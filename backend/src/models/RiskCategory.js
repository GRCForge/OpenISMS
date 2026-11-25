const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Risk category taxonomy (ISO 27005:2022 7.2 risk criteria, ISO 31000 6.3.4).
// Until 3.6.0 risks.category was free text, with nine values offered by the
// form. Since 3.7.0 it holds the key of an entry here. The key never changes:
// it is what risks and the (immutable) methodology versions store, so renaming
// a category only changes its labels. Entries are deactivated rather than
// removed while anything still refers to them (services/riskCategoryService.js).
const RiskCategory = sequelize.define('RiskCategory', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  label_de: { type: DataTypes.STRING(100), allowNull: false },
  label_en: { type: DataTypes.STRING(100), allowNull: false },
  label_es: { type: DataTypes.STRING(100) },
  description: { type: DataTypes.TEXT },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  // manual | seed | migration - where the entry came from (evidence for the audit trail)
  origin: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual' },
}, { tableName: 'risk_categories', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = RiskCategory;
