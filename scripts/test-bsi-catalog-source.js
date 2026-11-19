#!/usr/bin/env node
'use strict';

// Katalog-Import per URL: Host-Liste und ReDoS-Festigkeit des OSCAL-Platzhalters.
// Keine Datenbank, kein Netz.

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const { resolveCatalogSourceUrl, allowedCatalogHosts } = require(path.join(SRC, 'services/bsiCatalogSource'));
const { parseCatalog } = require(path.join(SRC, 'services/bsiCatalogParsers'));

let failed = 0;
const check = (name, cond) => {
  if (cond) console.log(`  ok    ${name}`);
  else { console.log(`  FAIL  ${name}`); failed++; }
};

console.log('Host-Liste');
const GSPP = 'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/main/x.json';
check('BSI-GitHub-Rohdatei erlaubt', resolveCatalogSourceUrl(GSPP, {}) === GSPP);
check('bsi.bund.de erlaubt', resolveCatalogSourceUrl('https://www.bsi.bund.de/a/b.xml', {}) === 'https://www.bsi.bund.de/a/b.xml');
check('Grossschreibung im Host wird normalisiert', resolveCatalogSourceUrl('https://WWW.BSI.BUND.DE/a.xml', {}) === 'https://www.bsi.bund.de/a.xml');
check('fremder Host abgelehnt', resolveCatalogSourceUrl('https://example.com/x.json', {}) === null);
check('Suffix-Trick abgelehnt', resolveCatalogSourceUrl('https://www.bsi.bund.de.evil.example/x.xml', {}) === null);
check('http abgelehnt', resolveCatalogSourceUrl('http://www.bsi.bund.de/x.xml', {}) === null);
check('Zugangsdaten in URL abgelehnt', resolveCatalogSourceUrl('https://u:p@www.bsi.bund.de/x.xml', {}) === null);
check('eigener Port abgelehnt', resolveCatalogSourceUrl('https://www.bsi.bund.de:8443/x.xml', {}) === null);
check('interne IP abgelehnt', resolveCatalogSourceUrl('https://127.0.0.1/x.json', {}) === null);
check('Metadaten-IP abgelehnt', resolveCatalogSourceUrl('https://169.254.169.254/latest', {}) === null);
check('keine URL abgelehnt', resolveCatalogSourceUrl('kein url', {}) === null);
const env = { BSI_CATALOG_URL_HOSTS: 'mirror.example.org, ungueltig_host ,' };
check('Zusatz-Host aus Umgebung erlaubt', resolveCatalogSourceUrl('https://mirror.example.org/k.xml', env) === 'https://mirror.example.org/k.xml');
check('ungueltiger Zusatz-Host ignoriert', !allowedCatalogHosts(env).includes('ungueltig_host'));
check('Fragment wird verworfen', resolveCatalogSourceUrl('https://www.bsi.bund.de/a.xml#x', {}) === 'https://www.bsi.bund.de/a.xml');

console.log('OSCAL-Platzhalter');
const prose = '{{{{insert:param,' + '{{{{insert:param,!'.repeat(20000);
const catalog = {
  catalog: {
    uuid: '00000000-0000-4000-8000-000000000000',
    metadata: { title: 'T', version: '1', 'oscal-version': '1.1.3' },
    groups: [{ id: 'g', title: 'G', controls: [{ id: 'g.1', title: 'C', parts: [{ name: 'statement', prose }] }] }],
  },
};
const t0 = Date.now();
let ok = true;
try { parseCatalog(Buffer.from(JSON.stringify(catalog)), 'oscal_catalog'); } catch { ok = true; }
const ms = Date.now() - t0;
check(`boesartiger Platzhalter in ${ms} ms verarbeitet`, ok && ms < 2000);

if (failed) { console.error(`\n${failed} Pruefung(en) fehlgeschlagen.`); process.exit(1); }
console.log('\nAlle Pruefungen bestanden.');
