const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Datenschutz-Folgenabschätzung (DPIA) gem. Art. 35 DSGVO
const Dsfa = sequelize.define('Dsfa', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  vvt_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  processing_description: { type: DataTypes.TEXT },
  necessity_assessment: { type: DataTypes.TEXT },
  risks_identified: { type: DataTypes.TEXT },
  measures_taken: { type: DataTypes.TEXT },
  residual_risk: { type: DataTypes.ENUM('low', 'medium', 'high', 'very_high'), defaultValue: 'medium' },
  dpa_consultation_required: { type: DataTypes.BOOLEAN, defaultValue: false },
  status: { type: DataTypes.ENUM('draft', 'in_review', 'approved', 'rejected'), defaultValue: 'draft' },
  approver_id: { type: DataTypes.INTEGER, allowNull: true },
  approval_date: { type: DataTypes.DATEONLY },
  next_review_date: { type: DataTypes.DATEONLY },
  notes: { type: DataTypes.TEXT },
}, { tableName: 'dsfas', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Dsfa;
