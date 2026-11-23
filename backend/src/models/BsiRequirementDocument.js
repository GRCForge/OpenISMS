const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Nachweis-Dokument einer Anforderung im IT-Grundschutz-Check. Verknuepft
// werden vorhandene Dokumente (documents, z. B. am Asset hochgeladen); die
// Datei selbst bleibt am Objekt, an dem sie hochgeladen wurde, und erbt dessen
// Sichtbarkeit (routes/documents.js canAccessDocumentParent).
const BsiRequirementDocument = sequelize.define('BsiRequirementDocument', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  requirement_id: { type: DataTypes.INTEGER, allowNull: false },
  document_id: { type: DataTypes.INTEGER, allowNull: false },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'bsi_requirement_documents',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [{ unique: true, fields: ['requirement_id', 'document_id'] }],
});

module.exports = BsiRequirementDocument;
