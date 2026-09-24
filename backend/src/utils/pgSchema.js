'use strict';

// Schemaauskunft fuer PostgreSQL.
//
// Bis v2.2.x fragte das Backup mit SHOW TABLES / SHOW COLUMNS / SHOW KEYS, was
// es unter PostgreSQL nicht gibt. Diese Auskuenfte liegen hier zusammen, weil
// sie alle dieselbe heikle Eigenschaft teilen: Ihre Rueckgabe wird anschliessend
// als Bezeichner in SQL eingesetzt, und sie ist die EINZIGE Quelle, aus der ein
// Tabellen- oder Spaltenname dorthin gelangen darf. Was aus einer Backup-Datei
// kommt, wird gegen diese Listen geprueft und nie selbst eingesetzt.

const { QueryTypes } = require('sequelize');

/**
 * Bezeichner fuer die Verwendung in SQL quotieren.
 *
 * Doppelte Anfuehrungszeichen werden verdoppelt - das ist die Escape-Regel von
 * PostgreSQL. Damit kann auch ein boshafter Name nicht aus dem Bezeichner
 * ausbrechen. Die Aufrufer setzen ohnehin nur Namen ein, die aus dem Katalog
 * der laufenden Datenbank stammen; das hier ist die zweite Sicherung.
 */
const quote = (bezeichner) => `"${String(bezeichner).replace(/"/g, '""')}"`;

/**
 * Alle Basistabellen der Anwendung.
 *
 * Eingeschraenkt auf current_schema() - also public. Das ist kein Beiwerk,
 * sondern der Grund, warum Apache AGE das Backup nicht sprengt: AGE legt je
 * Graph ein eigenes Schema mit seinen Knoten- und Kantentabellen an, dazu
 * kommt ag_catalog. Die gehoeren nicht ins Backup. Sie waeren nicht nur
 * ueberfluessig - beim Wiederherstellen wuerden sie mit dem Graphen kollidieren,
 * den die Trigger beim Einspielen ohnehin neu erzeugen.
 *
 * Views bleiben ebenfalls draussen (BASE TABLE), sie haben keinen eigenen
 * Inhalt.
 */
const tabellen = async (sequelize, options = {}) => {
  const rows = await sequelize.query(
    `SELECT table_name AS name
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    { type: QueryTypes.SELECT, ...options },
  );
  return rows.map(r => r.name);
};

/** Spaltennamen und -typen einer Tabelle: { name: datentyp }. */
const spalten = async (sequelize, tabelle, options = {}) => {
  const rows = await sequelize.query(
    `SELECT column_name AS name, data_type AS typ
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    { bind: [tabelle], type: QueryTypes.SELECT, ...options },
  );
  const out = {};
  for (const r of rows) out[r.name] = String(r.typ || '').toLowerCase();
  return out;
};

/**
 * Die Primaerschluesselspalte, sofern es genau EINE gibt.
 *
 * Bei einem zusammengesetzten Schluessel (die Verknuepfungstabellen) gibt es
 * keine einzelne Spalte, nach der sich seitenweise blaettern liesse - dort
 * liefert die Funktion null, und der Aufrufer liest die Tabelle am Stueck.
 */
const primaerschluessel = async (sequelize, tabelle, options = {}) => {
  const rows = await sequelize.query(
    `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisprimary
        AND t.relname = $1
        AND n.nspname = current_schema()`,
    { bind: [tabelle], type: QueryTypes.SELECT, ...options },
  );
  return rows.length === 1 ? rows[0].name : null;
};

/**
 * Alle Sequenzen, die an einer Spalte haengen, auf den groessten vorhandenen
 * Wert setzen.
 *
 * DAS IST DER SCHRITT, DEN MYSQL NICHT BRAUCHTE.
 *
 * Ein Wiederherstellen schreibt die ids aus dem Backup ausdruecklich mit. Unter
 * MySQL zog AUTO_INCREMENT dabei automatisch nach. Die Sequenz einer
 * PostgreSQL-Spalte tut das NICHT: Sie steht nach dem Einspielen weiterhin auf
 * dem Wert von vorher, meist auf 1.
 *
 * Ohne diesen Ausgleich verliefe eine Wiederherstellung voellig unauffaellig -
 * bis der erste neue Datensatz angelegt wird und an einem Schluesselkonflikt
 * scheitert. Und zwar bei jedem weiteren Versuch wieder, bis die Sequenz sich
 * an den bestehenden Daten vorbeigezaehlt hat.
 *
 * coalesce(max, 0) + Startwert-Logik: Bei einer leeren Tabelle wird die Sequenz
 * so gesetzt, dass der naechste Wert 1 ist.
 */
const sequenzenAusgleichen = async (sequelize, options = {}) => {
  const rows = await sequelize.query(
    `SELECT s.relname      AS sequenz,
            t.relname      AS tabelle,
            a.attname      AS spalte
       FROM pg_class s
       JOIN pg_depend d   ON d.objid = s.oid AND d.classid = 'pg_class'::regclass
       JOIN pg_class t    ON t.oid = d.refobjid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE s.relkind = 'S'
        AND n.nspname = current_schema()`,
    { type: QueryTypes.SELECT, ...options },
  );

  let angepasst = 0;
  for (const r of rows) {
    // quote_ident() um den Tabellennamen ist PFLICHT, kein Beiwerk:
    // pg_get_serial_sequence() nimmt den Namen als Text entgegen und PARST ihn
    // anschliessend als Bezeichner. Ein unquotierter Name wird dabei auf
    // Kleinschreibung gefaltet - und dieses Schema enthaelt mit
    // "VendorContacts" eine Tabelle in gemischter Schreibweise. Ohne quote_ident
    // scheiterte das Wiederherstellen dort mit "Relation vendorcontacts
    // existiert nicht", und zwar am Ende, nachdem alles andere schon
    // eingespielt war.
    //
    // Die Bezeichner in den uebrigen Ausdruecken stammen aus dem Systemkatalog
    // und werden ueber quote() gesetzt.
    await sequelize.query(
      `SELECT setval(
                pg_get_serial_sequence(quote_ident($1), $2),
                coalesce((SELECT max(${quote(r.spalte)}) FROM ${quote(r.tabelle)}), 0) + 1,
                false)
        WHERE pg_get_serial_sequence(quote_ident($1), $2) IS NOT NULL`,
      { bind: [r.tabelle, r.spalte], ...options },
    );
    angepasst++;
  }
  return angepasst;
};

module.exports = { quote, tabellen, spalten, primaerschluessel, sequenzenAusgleichen };
