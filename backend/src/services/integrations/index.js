'use strict';

/**
 * Verzeichnis der Drittsystem-Anbindungen.
 *
 * Eine neue Quelle ist eine Datei in diesem Verzeichnis plus eine Zeile hier.
 * Routen, Einstellungen und Abgleich muessen dafuer nicht angefasst werden —
 * genau das war vorher nicht so: CheckMK war an fuenf fest verdrahteten Routen,
 * einem eigenen Settings-Schluessel und einem eigenen Sync-Service
 * festgeschrieben.
 *
 * Zwei Arten:
 *   'pull' — das ISMS fragt ab (Monitoring, CMDB, Hypervisor). Hat eine
 *            Konfiguration, einen Verbindungstest und ein lesen().
 *   'push' — die Quelle liefert (Datei-Upload, Agent). Keine Konfiguration,
 *            kein Abruf; nur die Regeln, was ihre Daten duerfen.
 */

const checkmk = require('./checkmk');
const datei = require('./datei');

const ADAPTER = { [checkmk.id]: checkmk, [datei.id]: datei };

/** Wirft mit HTTP-Status, damit die Route keine eigene Fehlerlogik braucht. */
function adapter(id) {
  const a = ADAPTER[id];
  if (!a) {
    const e = new Error(`Unbekannte Anbindung "${id}".`);
    e.status = 404;
    throw e;
  }
  return a;
}

/** Nur die abrufbaren Quellen — die mit Konfiguration und Verbindungstest. */
function pullAdapter(id) {
  const a = adapter(id);
  if (a.art === 'push' || typeof a.lesen !== 'function') {
    const e = new Error(`Die Anbindung "${id}" wird nicht abgerufen, sie liefert. Ein Sync ist hier nicht vorgesehen.`);
    e.status = 400;
    throw e;
  }
  return a;
}

const alle = () => Object.values(ADAPTER);

module.exports = { adapter, pullAdapter, alle, ADAPTER };
