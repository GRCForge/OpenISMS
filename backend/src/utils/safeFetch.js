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

/**
 * IPv6-Adresse in acht 16-Bit-Gruppen zerlegen (inkl. eingebetteter IPv4 am Ende).
 * @returns {number[]|null}
 */
const expandV6 = (ip) => {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    if (p.some((n) => !Number.isInteger(n) || n > 255)) return null;
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
};

const v4FromGroups = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

const isBlockedAddress = (ip) => {
  if (typeof ip !== 'string' || !ip) return true;
  if (ip.includes(':')) { // IPv6
    const g = expandV6(ip);
    if (!g) return true;
    const zeroPrefix = (n) => g.slice(0, n).every((x) => x === 0);
    if (zeroPrefix(8)) return true;                                  // ::
    if (zeroPrefix(7) && g[7] === 1) return true;                    // ::1
    // Eingebettete IPv4-Adressen nach der IPv4-Regel beurteilen — sonst erreicht
    // ::ffff:7f00:1 (= 127.0.0.1 in Hex-Schreibweise) oder 64:ff9b::a9fe:a9fe
    // (NAT64 auf 169.254.169.254) genau die Ziele, die hier gesperrt sind.
    if (zeroPrefix(5) && g[5] === 0xffff) return isBlockedAddress(v4FromGroups(g[6], g[7])); // IPv4-mapped
    if (zeroPrefix(6)) return isBlockedAddress(v4FromGroups(g[6], g[7]));                   // IPv4-compatible (veraltet)
    if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedAddress(v4FromGroups(g[6], g[7])); // NAT64 64:ff9b::/96 und /48
    if (g[0] === 0x2002) return isBlockedAddress(v4FromGroups(g[1], g[2]));                  // 6to4
    if (g[0] === 0x2001 && g[1] === 0) return true;                  // Teredo
    if ((g[0] & 0xffc0) === 0xfe80) return true;                     // link-local
    if ((g[0] & 0xfe00) === 0xfc00) return true;                     // ULA fc00::/7
    if ((g[0] & 0xff00) === 0xff00) return true;                     // Multicast
    if (g[0] === 0x100 && zeroPrefix(4)) return true;                // Discard 100::/64
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true;              // Dokumentation
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;            // link-local, inkl. Cloud-Metadaten
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  if (a === 192 && b === 0 && c === 0) return true;   // IETF-Protokollzuweisungen
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmark-Netz
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
