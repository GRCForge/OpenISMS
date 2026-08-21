#!/usr/bin/env node
'use strict';

/**
 * Proves that the streamed database.json is byte-for-byte the JSON the old
 * in-memory export produced: same tables, same rows, same order — just without
 * holding the whole database in memory. Sequelize is mocked, no DB needed.
 *
 * Covers the paging path (table with a single-column primary key and more rows
 * than one batch), the single-shot path (no usable primary key), empty tables,
 * and a query failure mid-stream, which must not yield a parseable file.
 *
 * Run: node scripts/test-backup-export.js
 */

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const SRC = path.join(__dirname, '..', 'backend', 'src');

// Lift streamDatabaseJson out of the route module: requiring the route would pull
// in express, multer and the models for no benefit.
const src = fs.readFileSync(path.join(SRC, 'routes/backup.js'), 'utf8');
const start = src.indexOf('const EXPORT_BATCH_SIZE');
const end = src.indexOf('// GET /api/admin/backup/export');
if (start < 0 || end < 0) { console.error('streamDatabaseJson nicht gefunden'); process.exit(1); }

let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`); };

function makeSequelize(tables, { failOn = null } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, opts) => {
      queries.push(sql);
      const tbl = (sql.match(/FROM `([^`]+)`/) || [])[1];
      if (failOn && tbl === failOn) throw new Error('DB weg');
      if (sql.startsWith('SHOW KEYS')) {
        const pk = tables[tbl].pk;
        return [pk ? [{ Column_name: pk }] : []];
      }
      const rows = tables[tbl].rows;
      const pk = tables[tbl].pk;
      const limit = Number((sql.match(/LIMIT (\d+)/) || [])[1] || rows.length);
      if (sql.includes('WHERE')) {
        const after = opts.replacements[0];
        return [rows.filter(r => r[pk] > after).slice(0, limit)];
      }
      if (sql.includes('ORDER BY')) return [rows.slice(0, limit)];
      return [rows];
    },
  };
}

async function collect(tables, opts) {
  const sequelize = makeSequelize(tables, opts);
  const streamDatabaseJson = new Function('sequelize', src.slice(start, end) + '; return streamDatabaseJson;')(sequelize);
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', c => chunks.push(c));
  // destroy(err) feuert ein 'error'-Event; ohne Handler wuerde Node den Prozess
  // beenden, bevor die Pruefung greift. In der Anwendung haengt der Archiver
  // daran und leitet den Fehler an archive.on('error') weiter.
  stream.on('error', () => {});
  const counts = Object.fromEntries(Object.entries(tables).map(([t, v]) => [t, v.rows.length]));
  const done = streamDatabaseJson(stream, Object.keys(tables), counts);
  let error = null;
  await done.catch(e => { error = e; });
  await new Promise(r => stream.on('close', r).on('end', r));
  return { text: Buffer.concat(chunks).toString('utf8'), error, queries: sequelize.queries };
}

(async () => {
  const many = Array.from({ length: 1201 }, (_, i) => ({ id: i + 1, name: `Zeile ${i + 1}`, payload: { a: i } }));
  const tables = {
    assets: { pk: 'id', rows: many },
    settings: { pk: 'key', rows: [{ key: 'general', value: { appName: 'OpenISMS' } }] },
    risk_controls: { pk: null, rows: [{ risk_id: 1, control_id: 2 }, { risk_id: 1, control_id: 3 }] },
    empty_table: { pk: 'id', rows: [] },
  };

  console.log('Streaming-Export:');
  const { text, queries } = await collect(tables);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* bleibt null */ }
  check('database.json ist gültiges JSON', parsed !== null);
  if (parsed) {
    check('alle Tabellen enthalten', JSON.stringify(Object.keys(parsed)) === JSON.stringify(Object.keys(tables)));
    check('gepagte Tabelle vollständig (1201 Zeilen)', parsed.assets.length === 1201);
    check('Reihenfolge bleibt erhalten', parsed.assets[0].id === 1 && parsed.assets[1200].id === 1201);
    check('verschachtelte Werte unverändert', JSON.stringify(parsed.assets[7].payload) === JSON.stringify({ a: 7 }));
    check('Tabelle ohne Primärschlüssel vollständig', parsed.risk_controls.length === 2);
    check('leere Tabelle wird als [] geschrieben', Array.isArray(parsed.empty_table) && parsed.empty_table.length === 0);
    check('identisch zum In-Memory-Dump', JSON.stringify(parsed) === JSON.stringify(
      Object.fromEntries(Object.entries(tables).map(([t, v]) => [t, v.rows]))));
  }
  const paged = queries.filter(q => q.includes('LIMIT 500')).length;
  check(`große Tabelle wird in Batches gelesen (${paged} Abfragen)`, paged >= 3);
  check('kleine Tabellen ohne Paging', queries.some(q => q === 'SELECT * FROM `settings`'));

  console.log('Abbruch mitten im Stream:');
  const broken = await collect(tables, { failOn: 'risk_controls' });
  check('Fehler wird durchgereicht', broken.error instanceof Error);
  let brokenParsed = true;
  try { JSON.parse(broken.text); } catch { brokenParsed = false; }
  check('unvollständige Datei ist nicht parsebar (kein stiller Teil-Dump)', !brokenParsed);

  console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
  process.exit(failures ? 1 : 0);
})();
