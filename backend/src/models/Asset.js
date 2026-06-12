const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Asset = sequelize.define('Asset', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  type: { type: DataTypes.ENUM('hardware', 'software', 'information', 'process', 'service', 'personal', 'application', 'data', 'ai_application', 'ai_agent', 'other'), allowNull: false },
  description: { type: DataTypes.TEXT },
  classification: { type: DataTypes.ENUM('public', 'internal', 'confidential', 'secret'), allowNull: false },

  // 1. Identifikation & Status
  hosting_type: { type: DataTypes.ENUM('on-premise', 'cloud_public', 'cloud_private', 'hybrid'), defaultValue: 'on-premise' },
  location: { type: DataTypes.STRING(255) },
  lifecycle_status: { type: DataTypes.ENUM('evaluation', 'production', 'maintenance', 'archived'), defaultValue: 'production' },
  version: { type: DataTypes.STRING(50) },
  vendor: { type: DataTypes.STRING(255) },

  // 2. Governance
  owner_id: { type: DataTypes.INTEGER, allowNull: false },
  assessor_id: { type: DataTypes.INTEGER, allowNull: false },
  vendor_id: { type: DataTypes.INTEGER, allowNull: true },

  // 3. Schutzbedarf & Kritikalität
  nis2_relevant: { type: DataTypes.BOOLEAN, defaultValue: false },
  rto: { type: DataTypes.STRING(50) },
  rpo: { type: DataTypes.STRING(50) },
  sdo: { type: DataTypes.STRING(50) },
  mto: { type: DataTypes.STRING(50) },
  ioa: { type: DataTypes.STRING(50) },

  // 4. Abhängigkeiten
  parent_id: { type: DataTypes.INTEGER, allowNull: true },
  business_processes: { type: DataTypes.JSON, defaultValue: [] },
  data_flows: { type: DataTypes.JSON, defaultValue: [] },

  // 5. Security & Vulnerability
  patch_status: { type: DataTypes.ENUM('up-to-date', 'pending', 'critical'), defaultValue: 'up-to-date' },
  eol_date: { type: DataTypes.DATEONLY, allowNull: true },
  cve_critical: { type: DataTypes.INTEGER, defaultValue: 0 },
  cve_high: { type: DataTypes.INTEGER, defaultValue: 0 },
  cve_medium: { type: DataTypes.INTEGER, defaultValue: 0 },
  cve_low: { type: DataTypes.INTEGER, defaultValue: 0 },
  cve_last_checked: { type: DataTypes.DATE, allowNull: true },
  cve_ids: { type: DataTypes.JSON, defaultValue: [] },
  cve_search_query: { type: DataTypes.STRING(500), allowNull: true },
  // Phase 1: CPE-based matching
  cpe: { type: DataTypes.STRING(255), allowNull: true },
  cpe_title: { type: DataTypes.STRING(255), allowNull: true },
  cpe_resolved_at: { type: DataTypes.DATE, allowNull: true },
  // Phase 2: OSV.dev package matching
  package_name: { type: DataTypes.STRING(255), allowNull: true },
  package_ecosystem: { type: DataTypes.STRING(50), allowNull: true },
  backup_plan: { type: DataTypes.STRING(255) },
  last_restore_test: { type: DataTypes.DATEONLY, allowNull: true },
  hardening_status: { type: DataTypes.BOOLEAN, defaultValue: true },

  status: { type: DataTypes.ENUM('active', 'inactive', 'decommissioned'), defaultValue: 'active' },
  tags: { type: DataTypes.JSON },
  frameworks: { type: DataTypes.JSON, defaultValue: [] },
  // 6. Privacy / DSMS
  vvt_status: { type: DataTypes.ENUM('none', 'pending', 'complete'), defaultValue: 'none' },
  dsfa_required: { type: DataTypes.BOOLEAN, defaultValue: false },
  data_category: { type: DataTypes.ENUM('none', 'normal', 'special'), defaultValue: 'none' }, // Special = Art. 9 DSGVO
}, { tableName: 'assets', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Asset;
