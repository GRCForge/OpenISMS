'use strict';

/**
 * CheckMK-Connector — Asset-Inventar aus einem Monitoring-System.
 *
 * Zweck: CheckMK weiss, welche Systeme es wirklich gibt und ob sie laufen.
 * Genau diese Aussage fehlt einem manuell gepflegten Asset-Register. Der
 * Connector holt die ueberwachten Hosts und legt sie im bestehenden
 * Discovery-Staging ab (source='checkmk') — er legt KEINE Assets direkt an.
 *
 * Das ist Absicht und folgt dem Muster, das der Agent-Import bereits nutzt
 * ("kein Auto-Anlegen mehr"): ein Drittsystem darf das Inventar vorschlagen,
 * aber nicht bestimmen. Die Freigabe bleibt eine dokumentierte Entscheidung
 * eines Menschen — das ist es, was ein Auditor sehen will.
 *
 * Re-Sync ist idempotent ueber Asset.external_source + Asset.external_id
 * (= CheckMK-Hostname). Bereits freigegebene Assets werden aktualisiert,
 * nicht dupliziert.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 MB — grosse Installationen, aber kein unbegrenzter Puffer

// CheckMK-Hostzustaende (Livestatus)
const HOST_STATE = { 0: 'UP', 1: 'DOWN', 2: 'UNREACHABLE' };
// CheckMK-Servicezustaende
const SERVICE_STATE = { 0: 'OK', 1: 'WARN', 2: 'CRIT', 3: 'UNKNOWN' };

/**
 * Baut die API-Basis-URL. CheckMK haengt die Site in den Pfad:
 *   https://<host>/<site>/check_mk/api/1.0
 */
function buildApiBase(rawUrl, site) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('CheckMK-URL ist nicht konfiguriert.');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('CheckMK-URL ist keine gueltige URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('CheckMK-URL muss http:// oder https:// verwenden.');
  }
  const siteName = String(site || '').trim();
  if (!siteName || !/^[A-Za-z0-9_-]+$/.test(siteName)) {
    throw new Error('CheckMK-Site fehlt oder enthaelt unzulaessige Zeichen.');
  }
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return `${base}/${siteName}/check_mk/api/1.0`;
}

/**
 * Ein einzelner GET gegen die CheckMK-REST-API.
 *
 * Bewusst node:https statt fetch: fuer interne Instanzen mit eigener CA
 * brauchen wir eine explizite TLS-Ausnahme, die per Default AUS ist und
 * einzeln eingeschaltet werden muss. Mit fetch ginge das nur ueber eine
 * zusaetzliche Abhaengigkeit (undici Agent).
 */
function apiGet(cfg, path, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const apiBase = buildApiBase(cfg.url, cfg.site);
  const target = new URL(`${apiBase}${path}`);
  const lib = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          // CheckMK-Automationsbenutzer: "Bearer <user> <secret>"
          Authorization: `Bearer ${cfg.username} ${cfg.secret}`,
          Accept: 'application/json',
        },
        // Nur wirksam bei https. Default false — eine unverifizierte
        // TLS-Verbindung ins Monitoring ist eine bewusste Entscheidung,
        // kein stiller Fallback.
        rejectUnauthorized: !cfg.allowSelfSigned,
      },
      (res) => {
        let body = '';
        let bytes = 0;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_RESPONSE_BYTES) {
            req.destroy();
            reject(new Error('CheckMK-Antwort ueberschreitet die Groessengrenze (8 MB).'));
            return;
          }
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error(`CheckMK lehnt die Anmeldung ab (HTTP ${res.statusCode}). Benutzer, Secret oder Berechtigung pruefen.`));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            // Antworttext gekuerzt: er kann die angefragte URL enthalten, aber
            // niemals den Authorization-Header — der wird hier nie geloggt.
            reject(new Error(`CheckMK antwortet mit HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('CheckMK-Antwort ist kein gueltiges JSON (steht ein Reverse Proxy oder Login-Portal davor?).'));
          }
        });
      }
    );
    req.on('error', (e) => reject(new Error(`CheckMK nicht erreichbar: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`CheckMK antwortet nicht innerhalb von ${timeoutMs} ms.`));
    });
    req.end();
  });
}

function columnQuery(columns) {
  return columns.map((c) => `columns=${encodeURIComponent(c)}`).join('&');
}

/**
 * Alle ueberwachten Hosts mit Livestatus-Zustand.
 */
async function fetchHosts(cfg) {
  const cols = ['name', 'address', 'alias', 'state', 'plugin_output', 'acknowledged', 'scheduled_downtime_depth', 'last_state_change'];
  const data = await apiGet(cfg, `/domain-types/host/collections/all?${columnQuery(cols)}`);
  const rows = Array.isArray(data?.value) ? data.value : [];
  return rows.map((row) => {
    const e = row.extensions || {};
    return {
      name: e.name,
      address: e.address || null,
      alias: e.alias || null,
      state_code: typeof e.state === 'number' ? e.state : null,
      state: HOST_STATE[e.state] ?? 'UNKNOWN',
      plugin_output: e.plugin_output || null,
      acknowledged: Boolean(e.acknowledged),
      in_downtime: Number(e.scheduled_downtime_depth || 0) > 0,
      last_state_change: e.last_state_change ? new Date(e.last_state_change * 1000).toISOString() : null,
    };
  }).filter((h) => h.name);
}

/**
 * Services in einem bestimmten Zustand (Default: CRIT).
 * Wird fuer die Statusanreicherung der Assets genutzt.
 */
async function fetchServicesByState(cfg, state = 2) {
  const cols = ['host_name', 'description', 'state', 'plugin_output', 'acknowledged'];
  const query = encodeURIComponent(JSON.stringify({ op: '=', left: 'state', right: String(state) }));
  const data = await apiGet(cfg, `/domain-types/service/collections/all?${columnQuery(cols)}&query=${query}`);
  const rows = Array.isArray(data?.value) ? data.value : [];
  return rows.map((row) => {
    const e = row.extensions || {};
    return {
      host: e.host_name,
      service: e.description,
      state: SERVICE_STATE[e.state] ?? 'UNKNOWN',
      state_code: e.state,
      plugin_output: e.plugin_output || null,
      acknowledged: Boolean(e.acknowledged),
    };
  }).filter((s) => s.host && s.service);
}

/**
 * Verbindungstest — bewusst gegen den Host-Endpunkt statt gegen /version,
 * damit auch die Leseberechtigung geprueft wird und nicht nur die Anmeldung.
 */
async function testConnection(cfg) {
  const started = Date.now();
  const hosts = await fetchHosts(cfg);
  return {
    ok: true,
    host_count: hosts.length,
    duration_ms: Date.now() - started,
    sample: hosts.slice(0, 3).map((h) => ({ name: h.name, state: h.state })),
  };
}

module.exports = {
  buildApiBase,
  fetchHosts,
  fetchServicesByState,
  testConnection,
  HOST_STATE,
  SERVICE_STATE,
  DEFAULT_TIMEOUT_MS,
};
