#!/usr/bin/env node
'use strict';

/**
 * Prueft die Graph-Projektion ohne Datenbank.
 *
 * Der Graph wird von erzeugten Triggern gepflegt (services/graphProjection.js →
 * services/graphService.js). Der gefaehrlichste Fehler dabei ist kein Absturz,
 * sondern eine Luecke: Wer eine Kante in die Projektion eintraegt und der
 * zugehoerige Trigger entsteht nicht, bekommt einen Graphen, der still
 * unvollstaendig ist. Jede Auswertung liefert dann weiterhin Ergebnisse - nur
 * eben falsche, und niemand sieht eine Fehlermeldung.
 *
 * Geprueft wird deshalb vor allem Vollstaendigkeit, dazu die Zusicherungen, auf
 * denen die Injektionssicherheit ruht.
 *
 * Run: node scripts/test-graph-projection.js
 */

const path = require('path');

// graphService laedt config/database, und das verlangt die Secrets. Fuer diese
// Pruefung wird keine Verbindung aufgebaut, nur das Modul geladen.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.JWT_SECRET = process.env.JWT_SECRET || '0'.repeat(64);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || '0'.repeat(64);

const SRC = path.join(__dirname, '..', 'backend', 'src');
const spec = require(path.join(SRC, 'services/graphProjection'));
const graph = require(path.join(SRC, 'services/graphService'));

let failures = 0;
const check = (label, cond) => { if (!cond) failures++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`); };

const ddl = graph.triggerDDL();
const alles = ddl.join('\n');

console.log('Vollstaendigkeit der Trigger:');

// Je Knotenquelle ein Trigger auf der richtigen Tabelle.
for (const n of spec.NODES) {
  check(`Knoten ${n.label} -> Trigger auf "${n.table}"`,
    alles.includes(`ON "${n.table}"`) && alles.includes(`:${n.label} {pk: $pk}`));
}
for (const q of spec.REQUIREMENT_SOURCES) {
  check(`Katalog ${q.framework} -> Trigger auf "${q.table}"`, alles.includes(`ON "${q.table}"`));
}
for (const e of spec.EDGES) {
  check(`Kante ${e.type} auf "${e.table}"`,
    alles.includes(`ON "${e.table}"`) && alles.includes(`:${e.type}`));
}
check(`Kante ${spec.REQUIREMENT_EDGE.type} auf "${spec.REQUIREMENT_EDGE.table}"`,
  alles.includes(`ON "${spec.REQUIREMENT_EDGE.table}"`));

// Jede Triggerfunktion MUSS ihren Suchpfad selbst setzen. Ohne das scheitert
// nicht nur die Graphpflege, sondern das INSERT - fuer jeden Zugang, der
// ag_catalog nicht im Suchpfad hat (psql, Migrationswerkzeuge).
const funktionen = (alles.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
const suchpfade = (alles.match(/SET search_path = public, ag_catalog/g) || []).length;
check(`jede der ${funktionen} Triggerfunktionen setzt ihren search_path (${suchpfade})`,
  funktionen > 0 && funktionen === suchpfade);

// Der Wachposten muss ueberall sitzen, sonst laesst sich die Pflege fuer einen
// Massenimport nicht abschalten und ein Import wird unbrauchbar langsam.
const wachposten = (alles.match(/current_setting\('isms\.graph_sync', true\)/g) || []).length;
check(`jede Triggerfunktion achtet auf isms.graph_sync (${wachposten})`, funktionen === wachposten);

console.log('Werte gelangen nie in den Abfragetext:');

// Werte werden ueber jsonb_build_object gebunden. Taucht irgendwo eine
// NEW.-Spalte direkt im Cypher-Text auf, waere das eine Verkettung.
const cypherTexte = [...alles.matchAll(/\$cy\$([\s\S]*?)\$cy\$/g)].map(m => m[1]);
check(`${cypherTexte.length} Cypher-Abschnitte gefunden`, cypherTexte.length > 0);
check('kein NEW./OLD. im Cypher-Text', !cypherTexte.some(t => /\b(NEW|OLD)\./.test(t)));
check('keine String-Verkettung im Cypher-Text', !cypherTexte.some(t => t.includes('||')));
check('Werte stehen als $parameter im Cypher', cypherTexte.some(t => /\$pk\b/.test(t)));

console.log('Positivlisten:');

check('bekanntes Label wird angenommen', graph.assertLabel('Asset') === 'Asset');
let geworfen = false;
try { graph.assertLabel('Asset) RETURN n //'); } catch { geworfen = true; }
check('Label mit Cypher-Syntax wird abgelehnt', geworfen);

check('bekannter Entitaetstyp loest auf', graph.labelFuerEntitaet('bcm_process') === 'BcmProcess');
geworfen = false;
try { graph.labelFuerEntitaet('gibtsnicht'); } catch { geworfen = true; }
check('unbekannter Entitaetstyp wird abgelehnt', geworfen);

// Jedes Label und jeder Kantentyp der Projektion muss in den Positivlisten
// stehen - sonst laesst sich eine gueltige Abfrage nicht mehr stellen.
check('ALL_LABELS deckt alle Knoten ab',
  spec.NODES.every(n => spec.ALL_LABELS.includes(n.label)) && spec.ALL_LABELS.includes(spec.REQUIREMENT_LABEL));
check('ALL_EDGE_TYPES deckt alle Kanten ab',
  spec.EDGES.every(e => spec.ALL_EDGE_TYPES.includes(e.type))
  && spec.ALL_EDGE_TYPES.includes(spec.REQUIREMENT_EDGE.type));
check('jedes ENTITY_LABELS-Ziel ist ein bekanntes Label',
  Object.values(spec.ENTITY_LABELS).every(l => spec.ALL_LABELS.includes(l)));

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
