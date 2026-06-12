const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VvtEntry = sequelize.define('VvtEntry', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  purpose: { type: DataTypes.TEXT },
  legal_basis: {
    type: DataTypes.STRING(255),
    defaultValue: 'legitimate_interests',
  },
  data_categories: { type: DataTypes.JSON, defaultValue: [] },
  special_categories: { type: DataTypes.BOOLEAN, defaultValue: false },
  data_subjects: { type: DataTypes.JSON, defaultValue: [] },
  recipients: { type: DataTypes.JSON, defaultValue: [] },
  third_country_transfers: { type: DataTypes.BOOLEAN, defaultValue: false },
  transfer_safeguards: { type: DataTypes.TEXT },
  retention_period: { type: DataTypes.STRING(255) },
  retention_legal_basis: { type: DataTypes.STRING(255) }, // Gesetzliche Grundlage der Frist
  deletion_procedure: { type: DataTypes.TEXT },            // Beschreibung des Löschprozesses
  security_measures: { type: DataTypes.TEXT },
  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  processor_id: { type: DataTypes.INTEGER, allowNull: true },
  status: { type: DataTypes.ENUM('draft', 'active', 'archived'), defaultValue: 'draft' },
  notes: { type: DataTypes.TEXT },
  asset_ids: { type: DataTypes.JSON, defaultValue: [] },
  dsfa_required: { type: DataTypes.BOOLEAN, defaultValue: false },
  last_review_date: { type: DataTypes.DATEONLY, allowNull: true },
}, { tableName: 'vvt_entries', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = VvtEntry;
