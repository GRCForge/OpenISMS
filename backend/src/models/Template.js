const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Template = sequelize.define('Template', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT },
  category: {
    type: DataTypes.ENUM('asset', 'risk', 'assessment', 'incident', 'policy', 'general'),
    defaultValue: 'general',
    allowNull: false
  },
  filename: { type: DataTypes.STRING(255), allowNull: false },
  original_name: { type: DataTypes.STRING(255), allowNull: false },
  mimetype: { type: DataTypes.STRING(100) },
  size: { type: DataTypes.INTEGER },
  uploaded_by: { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'templates', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });

module.exports = Template;
