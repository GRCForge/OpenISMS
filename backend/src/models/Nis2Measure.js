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

  // Fuer wen gilt dieses Kriterium?
  //
  // NIS-2 trifft nicht alle gleich. Eine wesentliche Einrichtung nach Anhang I
  // schuldet den vollen Katalog inklusive der Meldepflichten aus Art. 23. Ein
  // Zulieferer, der selbst nicht in den Anwendungsbereich faellt, aber von
  // einer betroffenen Einrichtung beliefert wird, schuldet der Behoerde gar
  // nichts — ihm werden Anforderungen ueber Art. 21(2)(d) vertraglich
  // durchgereicht, und zwar nur ein Teil davon.
  //
  // Ohne diese Unterscheidung misst die Erfuellungsquote das Falsche: Ein
  // indirekt Betroffener steht dauerhaft bei "nicht erfuellt", weil er die
  // 24-Stunden-Fruehwarnung ans CSIRT nicht leistet, die er gar nicht leisten
  // muss. Werte je Profil: 'required', 'recommended', 'not_applicable'.
  applicability: {
    type: DataTypes.JSONB,
    defaultValue: { essential: 'required', important: 'required', indirect: 'recommended' },
  },

  // Selbst angelegte Kriterien werden beim Katalogabgleich nicht angefasst.
  custom: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'nis2_measures',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Nis2Measure;
