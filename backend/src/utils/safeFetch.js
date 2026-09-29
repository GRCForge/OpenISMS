'use strict';

/**
 * Abruf einer URL, die nicht aus der eigenen Konfiguration stammt.
 *
 * Sobald der Server eine URL abruft, die jemand anders bestimmen kann, ist das
 * eine SSRF-Primitive: Der Abruf kommt aus dem Netz des Servers und erreicht
 * damit Ziele, die von aussen unerreichbar sind — interne Dienste, die
 * Datenbank, der Metadatendienst des Cloud-Anbieters unter 169.254.169.254, der
 * Zugangsdaten herausgibt.
 *
 * Deshalb:
 *   - nur http/https,
 *   - der aufgeloeste Host muss eine oeffentliche Unicast-Adresse sein, und zwar
 *     jede, die die Aufloesung liefert (ein Name kann auf mehrere zeigen),
 *   - keine Weiterleitungen: eine oeffentliche URL darf nicht auf eine interne
 *     umlenken und die Pruefung damit umgehen,
 *   - harte Grenzen fuer Zeit und Groesse.
 *
 * Restrisiko, das diese Pruefung nicht abdeckt: Zwischen Aufloesung und Verbindung
 * kann sich der DNS-Eintrag aendern (DNS Rebinding). Dagegen hilft nur, die
 * geprüfte Adresse selbst zu verbinden — das kann fetch() nicht. Fuer Ziele, die
 * ein Administrator eintraegt, ist das vertretbar; fuer beliebige Nutzereingaben
 * waere es das nicht.
 */

const { lookup: dnsLookup } = require('dns').promises;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

const isBlockedAddress = (ip) => {
  if (typeof ip !== 'string' || !ip) return true;
  if (ip.includes(':')) { // IPv6
    const v6 = ip.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isBlockedAddress(mapped[1]) : false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;            // link-local, inkl. Cloud-Metadaten
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  if (a >= 224) return true;                          // Multicast und reserviert
  return false;
};

/**
 * Prueft Schema und Zielradressen. Wirft mit einer Meldung, die in einem
 * Statusfeld stehen darf — sie nennt den Grund, aber keine internen Adressen.
 * @returns {Promise<URL>}
 */
const assertPublicUrl = async (rawUrl) => {
  let parsed;
  try { parsed = new URL(String(rawUrl)); } catch { throw new Error('Ungueltige URL'); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Nur http und https sind erlaubt');
  }
  let addresses;
  try {
    addresses = await dnsLookup(parsed.hostname, { all: true });
  } catch {
    throw new Error('Hostname konnte nicht aufgeloest werden');
  }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new Error('Ziel liegt in einem nicht erlaubten Netzbereich');
  }
  return parsed;
};

/**
 * Laedt eine oeffentliche URL als Text.
 * @param {string} rawUrl
 * @param {{timeoutMs?:number, maxBytes?:number, accept?:string, userAgent?:string}} [opts]
 * @returns {Promise<{text:string, contentType:string, status:number}>}
 */
const fetchPublicText = async (rawUrl, opts = {}) => {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : DEFAULT_MAX_BYTES;
  const parsed = await assertPublicUrl(rawUrl);

  const res = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
    headers: {
      'accept': opts.accept || '*/*',
      'user-agent': opts.userAgent || 'OpenISMS-ThreatIntel/1.0',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Antwort ist groesser als ${maxBytes} Byte`);
  }
  // Content-Length ist optional und darf luegen — die tatsaechliche Groesse
  // entscheidet, sonst haengt die Grenze am Wohlwollen der Gegenstelle.
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`Antwort ist groesser als ${maxBytes} Byte`);

  return { text: buf.toString('utf8'), contentType, status: res.status };
};

module.exports = { isBlockedAddress, assertPublicUrl, fetchPublicText };
