#!/usr/bin/env node
'use strict';

/**
 * Parser und Vergleich fuer versionierte Grundschutz-Kataloge (keine Datenbank).
 *
 *   - Kompendium-XML (DocBook): Bausteine, Anforderungen, Stufe, Rollen, ENTFALLEN
 *   - OSCAL catalog (Grundschutz++-Aufbau): Praktiken, verschachtelte Controls,
 *     sec_level, modal_verb, target_object_categories, Parameter
 *   - Sicherheit: DOCTYPE/XXE/Entitaeten abgelehnt, Groessenlimit, falsche Formate
 *   - Diff neu/geaendert/entfallen
 *
 * Run: node scripts/test-bsi-catalog-import.js
 */

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const p = require(path.join(SRC, 'services', 'bsiCatalogParsers'));
const { seedAsParsed } = require(path.join(SRC, 'services', 'bsiCatalogService'));
const { kompendiumXml, oscalCatalog } = require('./fixtures/bsi-catalog');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const throwsWith = (label, fn, re) => {
  try { fn(); failures++; console.log(`  FAIL  ${label} → keine Ausnahme`); }
  catch (e) {
    const ok = e instanceof p.CatalogParseError && re.test(e.message);
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${e.name}: ${e.message}`}`);
  }
};

console.log('Titel des Kompendiums zerlegen:');
eq('Stufe und Rollen', p.splitKompendiumTitle('Titel X (S) [ISB, IT-Betrieb] '), { title: 'Titel X', level: 'standard', roles: 'ISB, IT-Betrieb', withdrawn: false });
eq('ohne Rolle', p.splitKompendiumTitle('Titel Y (H)'), { title: 'Titel Y', level: 'erhoehter_schutzbedarf', roles: null, withdrawn: false });
eq('ENTFALLEN', p.splitKompendiumTitle('ENTFALLEN (B)').withdrawn, true);

console.log('\nKompendium-XML:');
const k = p.parseCatalog(Buffer.from(kompendiumXml()));
eq('Format erkannt', k.format, 'kompendium_xml');
eq('Bausteine (nur mit Anforderungen)', k.modules.map(m => [m.module_id, m.title, m.layer]), [['ISMS.1', 'Sicherheitsmanagement', 'ISMS'], ['ORP.1', 'Organisation', 'ORP']]);
eq('Anforderungen', k.requirements.map(r => r.req_id), ['ISMS.1.A1', 'ISMS.1.A2', 'ISMS.1.A3', 'ORP.1.A1', 'ORP.1.A9']);
const a1 = k.requirements[0];
eq('Titel ohne Stufe/Rolle', a1.title, 'Testanforderung Eins');
eq('Stufe B → basis', a1.requirement_level, 'basis');
eq('Rolle', a1.roles, 'Institutionsleitung');
eq('Text mit Absaetzen, Entitaet und Liste', a1.text, 'Erster Absatz & mehr.\n\nZweiter Absatz.\n\n• Punkt A');
eq('ENTFALLEN markiert', k.requirements[1].withdrawn, true);
eq('Stufe S/H', [k.requirements[2].requirement_level, k.requirements[4].requirement_level], ['standard', 'erhoehter_schutzbedarf']);
eq('Schicht aus Kuerzel', k.requirements[3].layer, 'ORP');

console.log('\nKompendium-XML — Sicherheit und Fehler:');
const xxe = `<?xml version="1.0"?><!DOCTYPE book [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><book><chapter><title>&xxe;</title></chapter></book>`;
throwsWith('externe Entitaet (XXE) abgelehnt', () => p.parseKompendiumXml(xxe), /DOCTYPE/);
const lol = `<?xml version="1.0"?><!DOCTYPE book [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><book>&b;</book>`;
throwsWith('Entitaetsexpansion (Billion Laughs) abgelehnt', () => p.parseKompendiumXml(lol), /DOCTYPE/);
throwsWith('unbekannte Entitaet ohne DOCTYPE', () => p.parseKompendiumXml('<book><chapter><title>&foo;</title></chapter></book>'), /nicht wohlgeformt|keine Anforderungen/i);
throwsWith('kaputtes XML', () => p.parseKompendiumXml('<book><chapter>'), /nicht wohlgeformt|keine Anforderungen/i);
throwsWith('falsches Wurzelelement', () => p.parseKompendiumXml('<html><body/></html>'), /DocBook/);
throwsWith('DocBook ohne Anforderungen', () => p.parseKompendiumXml('<book><chapter><title>X</title></chapter></book>'), /Keine Anforderungen/);
throwsWith('doppelte Anforderung', () => p.parseKompendiumXml(kompendiumXml('<chapter><section><title>ISMS.1 Doppelt</title></section></chapter>')), /doppelt/);
throwsWith('Groessenlimit', () => p.parseKompendiumXml(Buffer.alloc(p.MAX_CATALOG_BYTES + 1, 0x20)), /zu gross/);

console.log('\nOSCAL catalog (Grundschutz++-Aufbau):');
const g = p.parseCatalog(Buffer.from(JSON.stringify(oscalCatalog())));
eq('Format erkannt', g.format, 'oscal_catalog');
eq('Metadaten', g.meta, { title: 'Testkatalog Grundschutz++', version: '2026-01-01', oscalVersion: '1.1.3' });
eq('Module: Thema der Praktik bzw. Praktik selbst', g.modules.map(m => [m.module_id, m.title, m.layer]), [['GC.1', 'Governance und Compliance › Grundlagen', 'GC'], ['STM', 'Strukturmodellierung', 'STM']]);
eq('Controls inkl. verschachtelter', g.requirements.map(r => [r.req_id, r.parent_req_id]), [['GC.1.1', null], ['GC.1.1.1', 'GC.1.1'], ['STM.1', null]]);
const c1 = g.requirements[0];
eq('sec_level normal-SdT → normal_sdt', c1.requirement_level, 'normal_sdt');
eq('sec_level erhöht → erhoeht', g.requirements[1].requirement_level, 'erhoeht');
eq('modal_verb', [c1.modal_verb, g.requirements[1].modal_verb], ['MUSS', 'SOLLTE']);
eq('effort_level', c1.effort_level, 2);
eq('target_object_categories', c1.target_object_categories, ['IT-Systeme', 'Netze']);
eq('Parameter eingesetzt', c1.text, 'Die Institution MUSS etwas nach Testwert tun.');
eq('unbekannter Parameter sichtbar', g.requirements[1].text, 'Unter [unbekannt].');
eq('guidance getrennt', c1.guidance, 'Hinweis eins.');
eq('ohne sec_level keine Stufe', g.requirements[2].requirement_level, null);

console.log('\nOSCAL — Fehler:');
throwsWith('kein JSON', () => p.parseOscalCatalog('{kaputt'), /JSON/);
throwsWith('Profil statt Katalog', () => p.parseOscalCatalog(JSON.stringify({ profile: { imports: [] } })), /Kein OSCAL-Katalog/);
throwsWith('Katalog ohne Controls', () => p.parseOscalCatalog(JSON.stringify({ catalog: { metadata: {}, groups: [] } })), /keine Controls/);
const dup = oscalCatalog(); dup.catalog.groups[1].controls.push({ id: 'GC.1.1', title: 'doppelt' });
throwsWith('doppelte Control-ID', () => p.parseOscalCatalog(JSON.stringify(dup)), /doppelt/);
let deep = { id: 'X0', title: 'x' }; for (let i = 1; i < 20; i++) deep = { id: `X${i}`, title: 'x', controls: [deep] };
throwsWith('Verschachtelungstiefe', () => p.parseOscalCatalog(JSON.stringify({ catalog: { controls: [deep] } })), /tief/);
throwsWith('Format nicht erkannt', () => p.parseCatalog(Buffer.from('hallo')), /nicht erkannt/);

console.log('\nVergleich (diff):');
const seed = seedAsParsed();
const seedRaw = require(path.join(SRC, 'services', 'bsiCatalog'));
eq('Seed: alle Eintraege, Format seed', [seed.requirements.length, seed.format], [seedRaw.length, 'seed']);
eq('Seed: Module eindeutig je Baustein', seed.modules.length, new Set(seedRaw.map(e => e.baustein_id)).size);
const d = p.diffRequirements(k.requirements, g.requirements);
eq('Kompendium → GS++: alles neu bzw. entfallen', [d.added.length, d.changed.length, d.removed.length, d.unchanged], [3, 0, 5, 0]);
const k2 = JSON.parse(JSON.stringify(k.requirements));
k2[0].title = 'Geaendert'; k2.splice(2, 1); k2.push({ ...k2[1], req_id: 'ISMS.1.A99', withdrawn: false });
const d2 = p.diffRequirements(k.requirements, k2);
eq('neu', d2.added.map(r => r.req_id), ['ISMS.1.A99']);
eq('geaendert mit Feld', d2.changed.map(c => [c.req_id, c.fields]), [['ISMS.1.A1', ['title']]]);
eq('entfallen', d2.removed.map(r => r.req_id), ['ISMS.1.A3']);
eq('unveraendert', d2.unchanged, 3);

console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
