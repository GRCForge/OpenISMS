'use strict';

/**
 * Erlaubte Quellen fuer den Katalog-Abruf per URL.
 *
 * safeFetch sperrt interne Ziele, bleibt aber anfaellig fuer DNS-Rebinding
 * (siehe Kommentar dort) — vertretbar nur fuer Ziele, die ein Administrator
 * fest eintraegt. Der Katalog-Import nimmt die URL dagegen pro Anfrage entgegen,
 * auch von Assessoren. Deshalb gilt zusaetzlich eine Host-Liste: die offiziellen
 * BSI-Quellen, erweiterbar ueber BSI_CATALOG_URL_HOSTS (kommagetrennt). Die
 * Ziel-URL wird aus dem erlaubten Host der Liste neu gebaut, nicht aus der
 * Eingabe uebernommen.
 */

const DEFAULT_CATALOG_HOSTS = Object.freeze([
  'www.bsi.bund.de',
  'bsi.bund.de',
  'raw.githubusercontent.com',
]);

const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Erlaubte Hosts: Standardliste plus BSI_CATALOG_URL_HOSTS. */
function allowedCatalogHosts(env = process.env) {
  const extra = String(env.BSI_CATALOG_URL_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => HOST_RE.test(h));
  return [...new Set([...DEFAULT_CATALOG_HOSTS, ...extra])];
}

/**
 * Prueft eine Katalog-URL gegen die Host-Liste.
 * @returns {string|null} die neu gebaute https-URL oder null, wenn nicht erlaubt
 */
function resolveCatalogSourceUrl(raw, env = process.env) {
  if (typeof raw !== 'string' || !raw || raw.length > 2048) return null;
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  const requested = parsed.hostname.toLowerCase();
  const host = allowedCatalogHosts(env).find((h) => h === requested);
  if (!host) return null;
  return new URL(`${parsed.pathname}${parsed.search}`, `https://${host}`).toString();
}

module.exports = { DEFAULT_CATALOG_HOSTS, allowedCatalogHosts, resolveCatalogSourceUrl };
