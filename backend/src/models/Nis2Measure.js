const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Nis2Measure = sequelize.define('Nis2Measure', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  article_ref: { type: DataTypes.STRING(30), allowNull: false },
  category: { type: DataTypes.STRING(100) },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  implementation_status: {
    type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable'),
    defaultValue: 'not_started',
  },
  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  evidence: { type: DataTypes.TEXT },
  deadline: { type: DataTypes.DATEONLY },
  notes: { type: DataTypes.TEXT },
  last_review_date: { type: DataTypes.DATEONLY },
}, {
  tableName: 'nis2_measures',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Nis2Measure;
