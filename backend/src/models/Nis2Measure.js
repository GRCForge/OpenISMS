const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Nis2Measure = sequelize.define('Nis2Measure', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  article_ref: { type: DataTypes.STRING(30), allowNull: false },

  // Verweis auf das deutsche Umsetzungsgesetz.
  //
  // Geprueft wird eine deutsche Einrichtung nicht an der Richtlinie, sondern am
  // BSIG. Die zehn Massnahmen aus Art. 21(2)(a)-(j) stehen dort als
  // § 30 Abs. 2 Nr. 1-10 und werden von Aufsicht und Beratern auch so zitiert.
  // Leer, wo die Zuordnung nicht belegt ist — eine geratene Paragraphenangabe
  // waere in einem Compliance-Werkzeug schlimmer als gar keine.
  bsig_ref: { type: DataTypes.STRING(60) },

  // Artikelreferenz des uebergeordneten Kriteriums, oder null fuer die oberste
  // Ebene.
  //
  // Eine Massnahme wie "Aufrechterhaltung des Betriebs" ist als eine Zeile
  // nicht pruefbar — sie zerfaellt in Auswirkungsanalyse, Backup-Konzept,
  // Wiederherstellungstests, Notfallplaene und Krisenkommunikation, und jedes
  // davon ist einzeln umgesetzt oder eben nicht. Die Oberkriterien bleiben als
  // gesetzlicher Anker stehen; gezaehlt werden die Blaetter.
  parent_ref: { type: DataTypes.STRING(30) },

  // Bedingung, unter der dieses Kriterium ueberhaupt gilt.
  //
  // Zwei Pflichten des BSIG treffen nicht jede betroffene Einrichtung, sondern
  // nur Betreiber kritischer Anlagen: die Systeme zur Angriffserkennung nach
  // § 31 und der Nachweis alle drei Jahre nach § 39. Fuer wen sie gelten, ist
  // eine harte Rechtspflicht — fuer alle anderen gar kein Kriterium. Das
  // Betroffenheitsprofil kann das nicht abbilden, weil ein KRITIS-Betreiber
  // immer zugleich eine besonders wichtige Einrichtung ist.
  //
  // Deshalb steht die Bedingung hier als Text und wird in der Oberflaeche
  // angezeigt. Wen sie nicht betrifft, setzt das Kriterium auf
  // implementation_status 'not_applicable'; die Quote laesst es dann fallen.
  // Eine vorweggenommene Annahme waere schlechter: Sie wuerde entweder einem
  // KRITIS-Betreiber eine Pflicht verschweigen oder allen anderen eine
  // erfinden.
  scope_note: { type: DataTypes.STRING(200) },

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
  indexes: [{ fields: ['parent_ref'] }],
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Nis2Measure;
