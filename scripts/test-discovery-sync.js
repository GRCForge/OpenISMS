#!/usr/bin/env node
'use strict';

/**
 * Prueft den quellenunabhaengigen Abgleich (services/discoverySync.js) ohne
 * Datenbank.
 *
 * Der teuerste Fehler in diesem Code ist kein Absturz, sondern ein falscher
 * Schluss aus Abwesenheit: Wenn ein Lauf nichts liefert und der Abgleich
 * daraus folgert, es gebe nichts mehr, markiert er das gesamte verknuepfte
 * Inventar als vermisst. Das laeuft fehlerfrei durch, meldet Erfolg und muss
 * von Hand zurueckgedreht werden. Zwei Sperren verhindern das — beide werden
 * hier geprueft, weil beide still sind, solange sie greifen.
 *
 * Die Modelle werden gestellt. Der Sinn ist die Entscheidungslogik, nicht
 * Sequelize.
 *
 * Run: node scripts/test-discovery-sync.js
 */

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'backend', 'src');

// ── Gestellte Modelle ────────────────────────────────────────────────────────

const zustand = { assets: [], staging: [], naechsteId: 100 };

const passendeZeilen = (liste, where) => liste.filter((z) => Object.entries(where).every(([feld, wert]) => {
  if (wert && typeof wert === 'object') return z[feld] !== null && z[feld] !== undefined; // { [Op.ne]: null }
  return z[feld] === wert;
}));

const alsDatensatz = (obj) => ({
  ...obj,
  async update(patch) { Object.assign(this, patch); Object.assign(obj, patch); },
});

const Asset = {
  async findAll({ where }) { return passendeZeilen(zustand.assets, where).map(alsDatensatz); },
  async update(patch, { where }) {
    for (const a of zustand.assets) if (a.id === where.id) Object.assign(a, patch);
  },
};

const DiscoveredSoftware = {
  async findAll({ where }) { return passendeZeilen(zustand.staging, where).map(alsDatensatz); },
  async create(felder) {
    const zeile = { id: zustand.naechsteId++, created_at: new Date(), ...felder };
    zustand.staging.push(zeile);
    return zeile;
  },
};

// models vor dem ersten require ersetzen — discoverySync zieht sie beim Laden.
const modelsPfad = require.resolve(path.join(SRC, 'models'));
require.cache[modelsPfad] = new Module(modelsPfad, null);
require.cache[modelsPfad].filename = modelsPfad;
require.cache[modelsPfad].loaded = true;
require.cache[modelsPfad].exports = { Asset, DiscoveredSoftware };

// checkmkService stellen: geprueft wird die Abbildung Host -> Vorschlag,
// nicht der HTTP-Abruf.
const checkmkPfad = require.resolve(path.join(SRC, 'services/checkmkService'));
require.cache[checkmkPfad] = new Module(checkmkPfad, null);
require.cache[checkmkPfad].filename = checkmkPfad;
require.cache[checkmkPfad].loaded = true;
const checkmkStub = { hosts: [], services: [] };
require.cache[checkmkPfad].exports = {
  buildApiBase: () => 'https://beispiel/cmk/check_mk/api/1.0',
  fetchHosts: async () => checkmkStub.hosts,
  fetchServicesByState: async () => checkmkStub.services,
  testConnection: async () => ({ ok: true, host_count: checkmkStub.hosts.length }),
};

const { abgleichen } = require(path.join(SRC, 'services/discoverySync'));
const registry = require(path.join(SRC, 'services/integrations'));
const datei = require(path.join(SRC, 'services/integrations/datei'));

// ── Pruefgeruest ─────────────────────────────────────────────────────────────

let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`); };

const zuruecksetzen = () => { zustand.assets = []; zustand.staging = []; zustand.naechsteId = 100; };

const rec = (id, extra = {}) => ({ external_id: id, name: id, status: 'UP', ...extra });

// ── Die vier Faelle ──────────────────────────────────────────────────────────

(async () => {
  console.log('Die vier Faelle je Datensatz:');

  zuruecksetzen();
  let r = await abgleichen({ source: 'checkmk', records: [rec('neu-1')], zaehltBestandVollstaendig: true });
  check('unbekannter Host -> neuer Staging-Eintrag', r.staging_created === 1 && zustand.staging.length === 1);
  check('der Eintrag steht auf pending', zustand.staging[0].status === 'pending');
  check('kein Asset entsteht dabei', zustand.assets.length === 0);

  zuruecksetzen();
  zustand.staging.push({ id: 1, hostname: 'h1', source: 'checkmk', status: 'pending', name: 'alt', created_at: new Date() });
  r = await abgleichen({ source: 'checkmk', records: [rec('h1', { name: 'neuer Name' })], zaehltBestandVollstaendig: true });
  check('offener Vorschlag wird aktualisiert statt verdoppelt',
    r.staging_updated === 1 && zustand.staging.length === 1 && zustand.staging[0].name === 'neuer Name');

  zuruecksetzen();
  zustand.staging.push({ id: 1, hostname: 'h1', source: 'checkmk', status: 'ignored', created_at: new Date() });
  r = await abgleichen({ source: 'checkmk', records: [rec('h1')], zaehltBestandVollstaendig: true });
  check('abgelehnter Vorschlag wird nicht neu vorgelegt',
    r.skipped_ignored === 1 && r.staging_created === 0 && zustand.staging.length === 1);

  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'checkmk', external_id: 'h1', location: null, external_status: 'UP' });
  r = await abgleichen({ source: 'checkmk', records: [rec('h1', { ip: '10.0.0.1', status: 'DOWN' })], zaehltBestandVollstaendig: true });
  check('verknuepftes Asset bekommt den Livestatus',
    r.assets_updated === 1 && zustand.assets[0].external_status === 'DOWN');
  check('leerer Standort wird mit der IP befuellt', zustand.assets[0].location === '10.0.0.1');

  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'checkmk', external_id: 'h1', location: 'Rack 3, Serverraum' });
  await abgleichen({ source: 'checkmk', records: [rec('h1', { ip: '10.0.0.1' })], zaehltBestandVollstaendig: true });
  check('gepflegter Standort wird NICHT durch eine IP ersetzt',
    zustand.assets[0].location === 'Rack 3, Serverraum');

  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'checkmk', external_id: 'weg', external_status: 'UP' });
  r = await abgleichen({ source: 'checkmk', records: [rec('da')], zaehltBestandVollstaendig: true });
  check('nicht mehr gemeldetes Asset wird als MISSING markiert',
    r.assets_missing === 1 && zustand.assets[0].external_status === 'MISSING');

  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'checkmk', external_id: 'weg', external_status: 'MISSING' });
  r = await abgleichen({ source: 'checkmk', records: [rec('da')], zaehltBestandVollstaendig: true });
  check('ein bereits gemeldetes MISSING wird nicht erneut gezaehlt', r.assets_missing === 0);

  console.log('Kein Schluss aus Abwesenheit, wo er nicht erlaubt ist:');

  // Sperre 1: leeres Ergebnis einer vollzaehligen Quelle.
  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'checkmk', external_id: 'h1', external_status: 'UP' });
  r = await abgleichen({ source: 'checkmk', records: [], zaehltBestandVollstaendig: true });
  check('leerer Lauf markiert NICHTS als vermisst',
    r.assets_missing === 0 && zustand.assets[0].external_status === 'UP');
  check('und sagt, dass der Abgleich uebersprungen wurde', r.missing_check_skipped === true);

  // Sperre 2: Quelle, die nur einen Ausschnitt liefert.
  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'excel', external_id: 'A-1', external_status: 'OK' });
  r = await abgleichen({ source: 'excel', records: [rec('A-2')], zaehltBestandVollstaendig: false });
  check('eine Datei markiert nichts als vermisst, auch wenn sie Zeilen enthaelt',
    r.assets_missing === 0 && zustand.assets[0].external_status === 'OK');
  check('und sagt, warum', r.missing_check_skipped === true);

  console.log('Quellen bleiben getrennt:');

  zuruecksetzen();
  zustand.staging.push({ id: 1, hostname: 'h1', source: 'checkmk', status: 'pending', created_at: new Date() });
  r = await abgleichen({ source: 'excel', records: [rec('h1')], zaehltBestandVollstaendig: false });
  check('gleicher Schluessel in anderer Quelle ist ein eigener Vorschlag',
    r.staging_created === 1 && zustand.staging.length === 2);

  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'wazuh', external_id: 'h1', external_status: 'UP' });
  r = await abgleichen({ source: 'checkmk', records: [], zaehltBestandVollstaendig: true });
  check('ein Asset einer fremden Quelle wird nicht angefasst',
    r.assets_updated === 0 && zustand.assets[0].external_status === 'UP');

  console.log('Probelauf schreibt nicht:');

  zuruecksetzen();
  zustand.assets.push({ id: 7, external_source: 'checkmk', external_id: 'weg', external_status: 'UP' });
  r = await abgleichen({ source: 'checkmk', records: [rec('neu')], dryRun: true, zaehltBestandVollstaendig: true });
  check('dry_run meldet, was passieren wuerde', r.staging_created === 1 && r.assets_missing === 1);
  check('schreibt aber weder Staging noch Asset',
    zustand.staging.length === 0 && zustand.assets[0].external_status === 'UP');

  console.log('Verzeichnis der Quellen:');

  check('bekannte Quelle loest auf', registry.adapter('checkmk').id === 'checkmk');
  let geworfen = false;
  try { registry.adapter('gibtsnicht'); } catch (e) { geworfen = e.status === 404; }
  check('unbekannte Quelle -> 404', geworfen);
  geworfen = false;
  try { registry.pullAdapter('excel'); } catch (e) { geworfen = e.status === 400; }
  check('eine Push-Quelle laesst sich nicht abrufen', geworfen);
  check('CheckMK darf aus Abwesenheit schliessen', registry.adapter('checkmk').zaehltBestandVollstaendig === true);
  check('eine Datei darf es nicht', registry.adapter('excel').zaehltBestandVollstaendig === false);

  console.log('payload: nur bekannte Felder ueberleben:');

  const gefiltert = datei.payloadFiltern({
    classification: 'confidential', id: 999, external_source: 'gefaelscht',
    hardening_status: false, tags: ['a'], leer: '',
  });
  check('erlaubtes Feld bleibt', gefiltert.classification === 'confidential');
  check('id wird verworfen', gefiltert.id === undefined);
  check('external_source wird verworfen', gefiltert.external_source === undefined);
  check('unbekanntes Asset-Feld wird verworfen', gefiltert.hardening_status === undefined);
  check('leere Werte werden verworfen', !('leer' in gefiltert));
  check('payloadLesen filtert auch beim Lesen',
    datei.payloadLesen(JSON.stringify({ id: 5, department: 'IT', type: 'hardware' })).id === undefined
    && datei.payloadLesen(JSON.stringify({ type: 'hardware' })).type === 'hardware');
  check('unlesbare payload wirft nicht', Object.keys(datei.payloadLesen('{kaputt')).length === 0);

  console.log('CheckMK-Abbildung Host -> Vorschlag:');

  // Servicenamen so, wie CheckMK sie wirklich vergibt — der Laengentest unten
  // misst sonst eine Kuerze, die im Betrieb nicht vorkommt.
  checkmkStub.hosts = [
    { name: 'webserver-wordpress-prod', address: '10.10.10.225', alias: 'Ubuntu Wordpress', state: 'UP', in_downtime: false, last_state_change: '2026-09-20T14:32:11.000Z' },
    { name: 'db-01', address: null, alias: 'db-01', state: 'DOWN', in_downtime: true, last_state_change: null },
  ];
  const H = 'webserver-wordpress-prod';
  checkmkStub.services = [
    { host: H, service: 'Filesystem /var/lib/postgresql/18/main' },
    { host: H, service: 'Check_MK Agent Version and Certificate' },
    { host: H, service: 'Postfix Queue /var/spool/postfix/deferred' },
    { host: H, service: 'Interface 4 Traffic' },
    { host: H, service: 'Systemd Service Summary' },
    { host: H, service: 'Memory' },
  ];

  const cmk = registry.adapter('checkmk');
  const { records: cmkRecords, zusatz } = await cmk.lesen({});
  const wp = cmkRecords.find((r) => r.external_id === 'webserver-wordpress-prod');
  const db = cmkRecords.find((r) => r.external_id === 'db-01');

  check('der Hostname ist der Korrelationsschluessel', Boolean(wp) && Boolean(db));
  check('ein sprechender Alias kommt in den Namen', wp.name === 'Ubuntu Wordpress (webserver-wordpress-prod)');
  check('ein Alias gleich dem Hostnamen wird nicht verdoppelt', db.name === 'db-01');
  check('der Livestatus wird uebernommen', wp.status === 'UP' && db.status === 'DOWN');
  check('CheckMK-Hosts sind Hardware, nicht Software', wp.asset_type === 'hardware');
  check('offene CRIT-Services stehen in der Herkunftszeile', /6x CRIT:/.test(wp.os));
  check('die Liste wird nach vier Diensten gekuerzt und sagt das', /\(\+2 weitere\)/.test(wp.os));
  check('eine Wartung wird benannt', /In Wartung \(Downtime\)/.test(db.os));
  check('ein Host ohne CRIT-Services bekommt keine leere Angabe', !/CRIT/.test(db.os));
  // Genau dieser Fall liess die Spalte ueberlaufen: viele Dienste, lange Namen.
  check('die Herkunftszeile kann laenger als 255 Zeichen werden (deshalb TEXT)', wp.os.length > 255);
  check('ein fehlgeschlagener Service-Abruf wird gemeldet, nicht verschwiegen',
    'service_enrichment_failed' in zusatz);

  console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})();
