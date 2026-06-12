const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OidcClaimMapping = sequelize.define('OidcClaimMapping', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  claim_path: { type: DataTypes.STRING(255), allowNull: false },
  claim_value: { type: DataTypes.STRING(255), allowNull: false },
  role: {
    type: DataTypes.ENUM('admin', 'assessor', 'dpo', 'it-staff', 'owner', 'viewer', 'employee'),
    allowNull: true,
  },
  custom_role_id: { type: DataTypes.INTEGER, allowNull: true },
  priority: { type: DataTypes.INTEGER, defaultValue: 0, allowNull: false },
}, { tableName: 'oidc_claim_mappings', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = OidcClaimMapping;
