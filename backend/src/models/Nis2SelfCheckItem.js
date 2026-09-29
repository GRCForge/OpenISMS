const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Eine Frage aus dem NIS-2-Self-Check samt Antwort.
//
// Der Kriterienkatalog (nis2_measures) fuehrt die Pflichten aus Art. 20, 21 und
// 23 als Massnahmen mit Umsetzungsstatus. Das beantwortet aber nicht die Frage,
// die am Anfang steht: Wo stehen wir ueberhaupt? Dafuer braucht es einen
// Fragebogen, der beides getrennt abfragt — und genau so fragt auch jeder
// externe Self-Check:
//
//   answer_implementation  Ist die Massnahme umgesetzt?
//   answer_evidence        Koennen wir das belegen?
//
// Die Trennung ist keine Formalie. "Wir machen das schon, nur aufgeschrieben
// hat es niemand" ist der haeufigste Befund in einem Erstaudit, und er faellt
// nur auf, wenn beide Achsen einzeln erfasst werden.
const Nis2SelfCheckItem = sequelize.define('Nis2SelfCheckItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  // Stabile Kennung (q1 … q37). Sie bleibt ueber Katalogversionen hinweg
  // gleich, damit ein anderswo erhobener Antwortsatz importiert werden kann,
  // ohne ihn von Hand zuzuordnen.
  question_ref: { type: DataTypes.STRING(20), allowNull: false },
  category: { type: DataTypes.STRING(100), allowNull: false },
  // Verbindung zum Kriterienkatalog: dieselbe Artikelreferenz wie in
  // nis2_measures. Darueber entsteht die Gap-Liste je NIS-2-Element.
  article_ref: { type: DataTypes.STRING(30), allowNull: false },
  question: { type: DataTypes.TEXT, allowNull: false },
  // Was zu tun ist, wenn die Antwort schwach ausfaellt. Steht im Katalog, damit
  // aus einer Luecke mit einem Klick eine Aufgabe wird.
  recommendation: { type: DataTypes.TEXT },

  answer_implementation: {
    type: DataTypes.ENUM('not_assessed', 'yes', 'partly', 'no'),
    defaultValue: 'not_assessed',
  },
  answer_evidence: {
    type: DataTypes.ENUM('not_assessed', 'yes', 'partly', 'no'),
    defaultValue: 'not_assessed',
  },
  // Womit wird belegt? Dokumentenname, Richtlinie, Ticket, Protokoll.
  evidence_source: { type: DataTypes.TEXT },
  notes: { type: DataTypes.TEXT },

  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  due_date: { type: DataTypes.DATEONLY },
  answered_by_id: { type: DataTypes.INTEGER, allowNull: true },
  answered_at: { type: DataTypes.DATE },

  // Aufgabe, die aus dieser Luecke entstanden ist.
  task_id: { type: DataTypes.INTEGER, allowNull: true },

  // Wie bei nis2_measures: Was ein Profil nicht schuldet, faellt aus der
  // Quote heraus statt sie dauerhaft nach unten zu ziehen.
  applicability: {
    type: DataTypes.JSONB,
    defaultValue: { essential: 'required', important: 'required', indirect: 'recommended' },
  },
  custom: { type: DataTypes.BOOLEAN, defaultValue: false },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'nis2_self_check',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['question_ref'], name: 'uq_nis2_self_check_question_ref' },
    { fields: ['category'] },
    { fields: ['article_ref'] },
  ],
});

module.exports = Nis2SelfCheckItem;
