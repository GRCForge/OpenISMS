'use strict';

/**
 * Adapter CheckMK — Asset-Inventar aus dem Monitoring.
 *
 * Zweck: CheckMK weiss, welche Systeme es wirklich gibt und ob sie laufen.
 * Genau diese Aussage fehlt einem manuell gepflegten Asset-Register.
 *
 * Hier steht nur, WIE aus CheckMK-Hosts Vorschlaege werden. Was damit im ISMS
 * passiert, steht quellenunabhaengig in services/discoverySync.js; wie die
 * Daten geholt werden, in services/checkmkService.js.
 */

const checkmk = require('../checkmkService');

/**
 * Kurzfassung der offenen CRIT-Services eines Hosts — landet in der
 * Staging-Beschreibung, damit der Freigebende sieht, was er sich einkauft.
 */
function summariseCriticals(criticals) {
  if (!criticals.length) return null;
  const shown = criticals.slice(0, 4).map((c) => c.service).join(', ');
  const rest = criticals.length > 4 ? ` (+${criticals.length - 4} weitere)` : '';
  return `${criticals.length}x CRIT: ${shown}${rest}`;
}

function buildStagingName(host) {
  const alias = (host.alias || '').trim();
  // Aliase wie "Ubuntu Wordpress" sind sprechender als der technische
  // Hostname — aber nur, wenn sie sich unterscheiden und nicht leer sind.
  if (alias && alias.toLowerCase() !== host.name.toLowerCase()) {
    return `${alias} (${host.name})`;
  }
  return host.name;
}

function buildDescription(host, criticalSummary, runDate) {
  const parts = [
    `CheckMK-Host: ${host.name}`,
    host.address ? `IP: ${host.address}` : null,
    `Status: ${host.state}`,
    host.last_state_change ? `seit ${host.last_state_change.slice(0, 16).replace('T', ' ')}` : null,
    criticalSummary,
    host.in_downtime ? 'In Wartung (Downtime)' : null,
    `Datenstand: ${runDate} (Quelle: CheckMK)`,
  ];
  return parts.filter(Boolean).join(' | ');
}

module.exports = {
  id: 'checkmk',
  label: 'CheckMK',
  beschreibung: 'Ueberwachte Hosts aus einer CheckMK-Site als Asset-Vorschlaege.',
  art: 'pull',

  // CheckMK zaehlt seinen Bestand vollstaendig auf: was es nicht meldet,
  // ueberwacht es nicht. Daraus darf der Abgleich auf 'MISSING' schliessen.
  zaehltBestandVollstaendig: true,

  // Das Secret liegt wie das OIDC-Client-Secret nur verschluesselt (secretEnc)
  // und verlaesst das Backend nie im Klartext.
  defaults: {
    enabled: false,
    url: '',            // z. B. https://checkmk.intern
    site: '',           // CheckMK-Site, z. B. 'cmk'
    username: '',       // Automationsbenutzer
    secretEnc: null,
    // Aus: eine unverifizierte TLS-Verbindung ins Monitoring muss eine
    // bewusste, sichtbare Entscheidung sein — kein stiller Fallback.
    allowSelfSigned: false,
    lastSyncAt: null,
    lastSyncSummary: null,
  },

  konfigFelder: [
    { name: 'url', label: 'URL', typ: 'text', pflicht: true, hinweis: 'z. B. https://checkmk.intern' },
    { name: 'site', label: 'Site', typ: 'text', pflicht: true, hinweis: 'CheckMK-Site, z. B. cmk' },
    { name: 'username', label: 'Benutzer', typ: 'text', pflicht: true, hinweis: 'Automationsbenutzer' },
    { name: 'secret', label: 'Secret', typ: 'geheim', pflicht: true },
    { name: 'allowSelfSigned', label: 'Selbstsigniertes Zertifikat zulassen', typ: 'bool', pflicht: false },
  ],

  /**
   * Ein konfigurierter, aber unvollstaendiger Connector ist ein haeufiger
   * Stolperstein — lieber eine klare Meldung als ein HTTP-401 aus CheckMK.
   */
  fehlendeKonfiguration(cfg) {
    const fehlt = [];
    if (!cfg.url) fehlt.push('URL');
    if (!cfg.site) fehlt.push('Site');
    if (!cfg.username) fehlt.push('Benutzer');
    if (!cfg.secret) fehlt.push('Secret');
    return fehlt;
  },

  /**
   * URL/Site fruehzeitig validieren, damit ein Tippfehler beim Speichern
   * auffaellt und nicht erst beim naechtlichen Sync.
   */
  patchPruefen(patch, aktuell) {
    if (patch.url || patch.site) {
      checkmk.buildApiBase(patch.url ?? aktuell.url, patch.site ?? aktuell.site);
    }
  },

  /**
   * Verbindungstest — bewusst gegen den Host-Endpunkt statt gegen /version,
   * damit auch die Leseberechtigung geprueft wird und nicht nur die Anmeldung.
   */
  pruefen: (cfg) => checkmk.testConnection(cfg),

  /** Rohdaten fuer die Anzeige ohne Schreibwirkung. */
  vorschau: async (cfg) => ({ hosts: await checkmk.fetchHosts(cfg) }),

  /**
   * Holt die Hosts und bildet sie auf die normalisierte Form ab, mit der
   * discoverySync arbeitet.
   */
  async lesen(cfg) {
    const runDate = new Date().toISOString().slice(0, 10);

    let serviceEnrichmentFailed = null;
    const [hosts, criticalServices] = await Promise.all([
      checkmk.fetchHosts(cfg),
      // Ein fehlgeschlagener Service-Abruf darf den Host-Import nicht kippen —
      // die Statusanreicherung ist Beiwerk, das Inventar ist der Zweck. Der
      // Fehler wird aber gemeldet: sonst ist "keine CRIT-Services" nicht von
      // "Abruf kaputt" zu unterscheiden.
      checkmk.fetchServicesByState(cfg, 2).catch((e) => { serviceEnrichmentFailed = e.message; return []; }),
    ]);

    const criticalsByHost = new Map();
    for (const svc of criticalServices) {
      if (!criticalsByHost.has(svc.host)) criticalsByHost.set(svc.host, []);
      criticalsByHost.get(svc.host).push(svc);
    }

    const records = hosts.map((host) => {
      const criticals = criticalsByHost.get(host.name) || [];
      return {
        external_id: host.name,
        name: buildStagingName(host),
        ip: host.address || null,
        os: buildDescription(host, summariseCriticals(criticals), runDate),
        asset_type: 'hardware',
        status: host.state,
        criticals: criticals.length,
      };
    });

    return { records, zusatz: { service_enrichment_failed: serviceEnrichmentFailed } };
  },
};
