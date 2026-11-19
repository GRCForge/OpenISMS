#!/usr/bin/env node
'use strict';

/**
 * Integrationstest gegen eine WEGWERF-Postgres-Datenbank: Migration eines
 * Bestands mit BSI-Statusdaten, Seed-Katalog, Import, Diff und Aktivierung.
 *
 * Laeuft nur mit BSI_CATALOG_TEST_DB=1 und DB_*-Variablen auf eine leere
 * Testdatenbank - die Tabellen werden geloescht und neu angelegt. Nicht in CI
 * (dort gibt es keine Datenbank); vor einem Merge lokal ausfuehren:
 *
 *   BSI_CATALOG_TEST_DB=1 DB_HOST=/tmp DB_PORT=55432 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x node scripts/test-bsi-catalog-db.js
 */

if (process.env.BSI_CATALOG_TEST_DB !== '1') {
  console.log('Uebersprungen (BSI_CATALOG_TEST_DB=1 und DB_* fuer eine Wegwerf-Datenbank setzen).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const { DataTypes } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sequelize'));
const { kompendiumXml, oscalCatalog } = require('./fixtures/bsi-catalog');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  // 1. Bestand wie bis 3.3.12: bsi_requirements ohne catalog_id/retired, mit Statusdaten.
  const Old = sequelize.define('OldBsiRequirement', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    baustein_id: { type: DataTypes.STRING(20), allowNull: false },
    baustein_name: { type: DataTypes.STRING(255), allowNull: false },
    layer: { type: DataTypes.STRING(20), allowNull: false },
    req_id: { type: DataTypes.STRING(30), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    requirement_level: { type: DataTypes.ENUM('basis', 'standard', 'erhoehter_schutzbedarf'), defaultValue: 'basis' },
    implementation_status: { type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable'), defaultValue: 'not_started' },
    responsible_id: { type: DataTypes.INTEGER, allowNull: true },
    notes: { type: DataTypes.TEXT },
    last_review_date: { type: DataTypes.DATEONLY },
  }, { tableName: 'bsi_requirements', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
  await Old.sync();
  await Old.bulkCreate([
    { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A1', title: 'Alt A1', implementation_status: 'implemented', notes: 'Nachweis liegt vor' },
    { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A2', title: 'Alt A2', implementation_status: 'in_progress' },
    { baustein_id: 'ORP.1', baustein_name: 'Organisation', layer: 'ORP', req_id: 'ORP.1.A1', title: 'Alt ORP', implementation_status: 'not_applicable', notes: 'begruendet' },
  ]);
  sequelize.modelManager.removeModel(Old);

  // 2. Neue Modelle + Sync wie beim Start (index.js), dann Startmigration.
  const m = require(path.join(SRC, 'models'));
  await m.sequelize.sync({ alter: { drop: false } });
  const svc = require(path.join(SRC, 'services', 'bsiCatalogService'));
  const { parseCatalog } = require(path.join(SRC, 'services', 'bsiCatalogParsers'));

  console.log('Startmigration mit Bestand:');
  const seed = await svc.ensureSeedCatalog();
  eq('Seed-Katalog angelegt und aktiv', [seed.name, seed.status, seed.format], [svc.SEED_NAME, 'active', 'seed']);
  eq('zweiter Lauf legt nichts an', await svc.ensureSeedCatalog(), null);
  const rows = await m.BsiRequirement.findAll({ order: [['req_id', 'ASC']], raw: true });
  eq('Statusdaten unveraendert', rows.map(r => [r.req_id, r.implementation_status, r.notes]),
    [['ISMS.1.A1', 'implemented', 'Nachweis liegt vor'], ['ISMS.1.A2', 'in_progress', null], ['ORP.1.A1', 'not_applicable', 'begruendet']]);
  eq('Zeilen dem Seed zugeordnet, nicht abgeloest', rows.map(r => [r.catalog_id, r.retired]), [[seed.id, false], [seed.id, false], [seed.id, false]]);

  console.log('\nImport Kompendium-XML (Vorschau) und Diff:');
  const kBuf = Buffer.from(kompendiumXml());
  const kCat = await svc.storeCatalog(parseCatalog(kBuf), { name: 'Test-Kompendium', edition: 'Test', source: 'upload', buffer: kBuf, userId: null });
  eq('Status preview, Zaehler', [kCat.status, kCat.module_count, kCat.requirement_count], ['preview', 2, 5]);
  eq('SHA-256 gespeichert', kCat.source_sha256, svc.sha256(kBuf));
  eq('Vorschau aendert Umsetzungsstand nicht', await m.BsiRequirement.count(), 3);
  const diff = await svc.diffAgainstActive(kCat.id);
  eq('Diff gegen Seed: geaendert enthaelt ISMS.1.A1', diff.changed.some(c => c.req_id === 'ISMS.1.A1'), true);
  eq('Diff: ORP.1.A9 neu', diff.added.some(a => a.req_id === 'ORP.1.A9'), true);

  console.log('\nAktivierung Kompendium:');
  const stats = await svc.activateCatalog(kCat.id, null);
  const after = new Map((await m.BsiRequirement.findAll({ raw: true })).map(r => [r.req_id, r]));
  eq('A1: Titel aus Katalog, Status bleibt', [after.get('ISMS.1.A1').title, after.get('ISMS.1.A1').implementation_status, after.get('ISMS.1.A1').notes], ['Testanforderung Eins', 'implemented', 'Nachweis liegt vor']);
  eq('A2 ENTFALLEN → retired, Status bleibt', [after.get('ISMS.1.A2').retired, after.get('ISMS.1.A2').implementation_status], [true, 'in_progress']);
  eq('neue Anforderung angelegt', [after.get('ORP.1.A9')?.implementation_status, after.get('ORP.1.A9')?.requirement_level], ['not_started', 'erhoehter_schutzbedarf']);
  eq('ORP.1.A1 auch im Kompendium → bleibt aktiv, Status bleibt', [after.get('ORP.1.A1').retired, after.get('ORP.1.A1').implementation_status], [false, 'not_applicable']);
  eq('Kompendium aktiv, Seed archiviert', (await m.BsiCatalog.findAll({ order: [['id', 'ASC']], raw: true })).map(c => c.status), ['archived', 'active']);
  eq('Statistik: neu A3+A9, aktualisiert A1+ORP.1.A1, abgeloest A2', [stats.created, stats.updated, stats.retired], [2, 2, 1]);
  let err = null; try { await svc.activateCatalog(kCat.id, null); } catch (e) { err = e.status; }
  eq('erneutes Aktivieren → 409', err, 409);

  console.log('\nWechsel auf OSCAL (Grundschutz++-Aufbau):');
  const gBuf = Buffer.from(JSON.stringify(oscalCatalog()));
  const gCat = await svc.storeCatalog(parseCatalog(gBuf), { source: 'url', source_url: 'https://example.invalid/x.json', buffer: gBuf });
  eq('Name und Edition aus Metadaten', [gCat.name, gCat.edition, gCat.oscal_version], ['Testkatalog Grundschutz++', '2026-01-01', '1.1.3']);
  await svc.activateCatalog(gCat.id, null);
  const g = await m.BsiRequirement.findAll({ where: { retired: false }, order: [['req_id', 'ASC']], raw: true });
  eq('aktiv nur noch GS++-Anforderungen', g.map(r => [r.req_id, r.layer, r.requirement_level]), [['GC.1.1', 'GC', 'normal_sdt'], ['GC.1.1.1', 'GC', 'erhoeht'], ['STM.1', 'STM', null]]);
  const old = await m.BsiRequirement.findOne({ where: { req_id: 'ISMS.1.A1' }, raw: true });
  eq('Kompendium-Zeile bleibt mit Status erhalten', [old.retired, old.implementation_status], [true, 'implemented']);

  console.log('\nZurueck auf das Kompendium (archiviert → aktiv):');
  const back = await svc.activateCatalog(kCat.id, null);
  eq('frueher abgeloeste Zeilen reaktiviert', back.reactivated >= 4, true);
  eq('A1 wieder aktiv mit Status', (await m.BsiRequirement.findOne({ where: { req_id: 'ISMS.1.A1' }, raw: true })).retired, false);

  console.log('\nVorschau verwerfen loescht Module und Anforderungen mit:');
  const pBuf = Buffer.from(kompendiumXml());
  const pCat = await svc.storeCatalog(parseCatalog(pBuf), { source: 'upload', buffer: pBuf });
  await pCat.destroy();
  eq('keine verwaisten Zeilen', await m.BsiCatalogRequirement.count({ where: { catalog_id: pCat.id } }), 0);

  await m.sequelize.close();
  console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
