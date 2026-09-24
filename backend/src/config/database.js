const { Sequelize } = require('sequelize');

// PostgreSQL seit v2.3.0. Die Begruendung steht in den Release Notes; kurz: Der
// Graph (Apache AGE) liegt in derselben Datenbank und derselben Transaktion wie
// die Tabellen, ein zweiter Datenspeicher waere sonst noetig gewesen.
//
// min:2 haelt einen kleinen warmen Boden, damit die erste Anfrage nach einer
// Ruhephase nicht den vollen Verbindungsaufbau bezahlt (min:0 verwarf jede
// untaetige Verbindung). connectTimeout scheitert schnell an einer toten
// Datenbank, statt bis zu `acquire` (30s) zu haengen.
const poolConfig = {
  max: Number(process.env.DB_POOL_MAX || 10),
  min: Number(process.env.DB_POOL_MIN || 2),
  acquire: 30000,
  idle: 10000,
};

// AGE liegt in ag_catalog. Ohne diesen search_path muesste jede Cypher-Abfrage
// den Typ ag_catalog.agtype voll qualifizieren - und die Rueckgabe von cypher()
// laesst sich gar nicht qualifizieren, weil die Typangabe in der AS-Klausel
// steht. Deshalb gehoert es an die Verbindung, nicht an die einzelne Abfrage.
//
// Gesetzt wird er ueber den Startup-Parameter der Verbindung, nicht ueber die
// Sequelize-Option `searchPath`: Letztere haengt ein "SET search_path to ..."
// vor JEDE Abfrage (siehe dialects/postgres/query.js), also zwei Anweisungen
// statt einer, fuer eine Einstellung, die sich pro Verbindung nie aendert.
//
// ag_catalog steht HINTER public, damit eine Tabelle von AGE niemals eine
// gleichnamige Tabelle der Anwendung verdeckt. Die Anwendungstabellen bleiben
// in public - die Sequelize-Option `schema` haette sie verschoben.
const searchPath = process.env.DB_SEARCH_PATH || 'public,ag_catalog';

const ssl = (() => {
  const modus = (process.env.DB_SSL || '').toLowerCase();
  if (!modus || modus === 'false' || modus === 'disable') return undefined;
  // "require" verschluesselt, prueft das Zertifikat aber nicht - das ist der
  // uebliche Fall fuer einen gemanagten Anbieter mit eigener CA. Wer prueft,
  // setzt DB_SSL=verify und legt die CA ueber DB_SSL_CA ab.
  if (modus === 'verify') {
    const ca = process.env.DB_SSL_CA;
    return { require: true, rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  }
  return { require: true, rejectUnauthorized: false };
})();

const dialectOptions = {
  // pg nennt es connectionTimeoutMillis, nicht connectTimeout wie mysql2.
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  // Startup-Parameter: gilt ab dem Verbindungsaufbau fuer JEDE Verbindung des
  // Pools, auch fuer die, die spaeter nachwachsen.
  options: `-c search_path=${searchPath}`,
  ...(ssl ? { ssl } : {}),
};

const gemeinsam = {
  dialect: 'postgres',
  logging: false,
  pool: poolConfig,
  dialectOptions,
};

let sequelize;
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, gemeinsam);
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || 'isms',
    process.env.DB_USER || 'isms_user',
    process.env.DB_PASSWORD || 'isms_password',
    {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      ...gemeinsam,
    }
  );
}

module.exports = sequelize;
