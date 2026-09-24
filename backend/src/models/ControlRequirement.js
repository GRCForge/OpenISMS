const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Eine Massnahme erfuellt Anforderungen aus MEHREREN Regelwerken.
//
// Bis v2.2.x trug controls.framework genau einen Wert, und die
// Anforderungskataloge (iso27001_controls, bsi_requirements, nis2_measures,
// c5_criteria, tisax_requirements) standen voellig unverbunden daneben. Wer
// dieselbe Massnahme fuer ISO A.5.15, BSI ORP.4.A1 und C5 IDM-01 nachweisen
// wollte, musste sie dreimal anlegen - und beim naechsten Audit dreimal
// pflegen, mit drei Staenden, die auseinanderlaufen.
//
// WARUM POLYMORPH UND NICHT FUENF SPALTEN
// Fuenf nullbare Fremdschluessel (iso_id, bsi_id, nis2_id, ...) waeren
// referenziell sauberer, aber jede neue Norm braechte eine Schemaaenderung und
// jede Abfrage ein weiteres COALESCE. Der Katalog waechst erfahrungsgemaess
// (DORA, TISAX, NIS-2 kamen nacheinander dazu), die Menge der Regelwerke ist
// also kein Fixum. framework + requirement_id bleibt bei einer neuen Norm ein
// zusaetzlicher ENUM-Wert.
//
// Der Preis ist ehrlich zu benennen: Die Datenbank kann requirement_id nicht
// per Fremdschluessel absichern. Deshalb pruefen die Routen die Existenz beim
// Anlegen, und graphService.rebuild() verwirft beim Neuaufbau Kanten, deren
// Ziel nicht mehr existiert, statt sie stillschweigend mitzuschleppen.
const ControlRequirement = sequelize.define('ControlRequirement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  control_id: { type: DataTypes.INTEGER, allowNull: false },
  framework: {
    type: DataTypes.ENUM('iso27001', 'bsi', 'nis2', 'c5', 'tisax'),
    allowNull: false,
  },
  // Zeilen-id im jeweiligen Katalog, NICHT die fachliche Referenz ("A.5.15").
  // Die fachliche Referenz aendert sich mit einer Normrevision, die Zeile
  // bleibt dieselbe.
  requirement_id: { type: DataTypes.INTEGER, allowNull: false },
  // Womit wird die Erfuellung belegt? Steht bewusst an der ZUORDNUNG und nicht
  // an der Massnahme: Dieselbe Massnahme belegt gegenueber dem C5-Pruefer oft
  // etwas anderes als gegenueber dem ISO-Auditor.
  coverage: {
    type: DataTypes.ENUM('full', 'partial'),
    defaultValue: 'full',
    allowNull: false,
  },
  note: { type: DataTypes.TEXT, allowNull: true },
  created_by_id: { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName: 'control_requirements',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // Dieselbe Zuordnung zweimal waere kein Fehler mit Folgen, aber sie
    // verdoppelte jede Abdeckungszahl in der Auswertung.
    { unique: true, fields: ['control_id', 'framework', 'requirement_id'], name: 'uq_control_requirement' },
    // Die haeufigste Abfrage: "Welche Massnahmen erfuellen diese Anforderung?"
    { fields: ['framework', 'requirement_id'], name: 'idx_control_req_target' },
  ],
});

module.exports = ControlRequirement;
