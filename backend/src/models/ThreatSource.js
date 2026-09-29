const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Register der Quellen, aus denen die Bedrohungslage beobachtet wird.
//
// NIS-2 Art. 21(2)(a) verlangt, dass die aktuelle Bedrohungslage systematisch
// verfolgt wird — ISO 27001:2022 A.5.7 ("Threat intelligence") formuliert
// dieselbe Anforderung. Ein Auditor fragt dabei immer zwei Dinge: WELCHE Quellen
// werden beobachtet, und WIE OFT. Beides steht hier, zusammen mit dem Nachweis,
// wann zuletzt tatsaechlich hineingesehen wurde (last_reviewed_at) und wann es
// wieder faellig ist (next_review_at).
const ThreatSource = sequelize.define('ThreatSource', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(255), allowNull: false },

  // national_csirt trennt die nationale Stelle (in DE: CERT-Bund/BSI) von allen
  // uebrigen Quellen. Der NIS-2-Fragebogen fragt sie ausdruecklich ab, und die
  // Statistik kann so belegen, dass sie ueberhaupt abgedeckt ist.
  type: {
    type: DataTypes.ENUM('national_csirt', 'authority', 'cert', 'vendor', 'isac', 'commercial', 'news', 'community', 'internal'),
    defaultValue: 'cert',
  },
  country: { type: DataTypes.STRING(8) },          // DE, EU, US, INT
  url: { type: DataTypes.STRING(500) },
  feed_url: { type: DataTypes.STRING(500) },
  feed_format: { type: DataTypes.ENUM('none', 'rss', 'atom', 'cisa_kev'), defaultValue: 'none' },
  // Automatischer Abruf ist bewusst abgewaehlt, auch wenn ein Feed hinterlegt
  // ist. Eine frische Installation soll nicht ungefragt anfangen, nach aussen
  // zu telefonieren — in einer abgeschotteten Umgebung ist genau das der
  // Befund, den niemand erklaeren kann. Die Quelle steht trotzdem im Register:
  // beobachtet wird sie auch dann, nur eben von Hand.
  auto_fetch: { type: DataTypes.BOOLEAN, defaultValue: false },

  review_frequency: {
    type: DataTypes.ENUM('daily', 'weekly', 'biweekly', 'monthly', 'quarterly'),
    defaultValue: 'weekly',
  },
  responsible_id: { type: DataTypes.INTEGER, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },

  last_reviewed_at: { type: DataTypes.DATEONLY },
  next_review_at: { type: DataTypes.DATEONLY },
  last_review_note: { type: DataTypes.TEXT },

  // Ergebnis des letzten automatischen Abrufs. Getrennt von last_reviewed_at:
  // Ein Abruf ist noch keine Bewertung — "der Feed laeuft" ist kein Nachweis
  // dafuer, dass jemand die Meldungen gelesen hat.
  last_fetch_at: { type: DataTypes.DATE },
  last_fetch_status: { type: DataTypes.STRING(255) },

  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'threat_sources',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ fields: ['active'] }, { fields: ['next_review_at'] }],
});

module.exports = ThreatSource;
