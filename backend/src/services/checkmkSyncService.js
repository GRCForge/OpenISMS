'use strict';

/**
 * Abgleich CheckMK -> ISMS.
 *
 * Bewusst getrennt vom API-Client (checkmkService.js): hier steht, was mit den
 * Daten im ISMS passiert, dort nur, wie sie geholt werden.
 *
 * Drei Faelle je CheckMK-Host:
 *   1. Es gibt bereits ein verknuepftes Asset  -> Livedaten aktualisieren.
 *   2. Es gibt einen offenen Staging-Eintrag   -> Staging-Eintrag aktualisieren.
 *   3. Nichts davon                            -> neuer Staging-Eintrag (pending).
 *
 * Und ein vierter, der oft vergessen wird:
 *   4. Ein verknuepftes Asset taucht im Lauf NICHT mehr auf -> als 'MISSING'
 *      markieren. Ein Asset, das das Monitoring nicht mehr kennt, ist ein
 *      Befund (ausgemustert? vergessen? Monitoring kaputt?) und darf nicht
 *      stillschweigend weiter als gepflegt gelten.
 */

const { Op } = require('sequelize');
const { Asset, DiscoveredSoftware } = require('../models');
const { fetchHosts, fetchServicesByState } = require('./checkmkService');

const SOURCE = 'checkmk';

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

/**
 * @param {object} opts
 * @param {object} opts.cfg       CheckMK-Konfiguration inkl. entschluesseltem Secret
 * @param {boolean} opts.dryRun   true = nichts schreiben, nur berichten
 * @returns {Promise<object>} Zaehler und Detailliste
 */
async function syncFromCheckmk({ cfg, dryRun = false }) {
  const runDate = new Date().toISOString().slice(0, 10);
  const now = new Date();

  const [hosts, criticalServices] = await Promise.all([
    fetchHosts(cfg),
    // Ein fehlgeschlagener Service-Abruf darf den Host-Import nicht kippen —
    // die Statusanreicherung ist Beiwerk, das Inventar ist der Zweck.
    fetchServicesByState(cfg, 2).catch(() => []),
  ]);

  const criticalsByHost = new Map();
  for (const svc of criticalServices) {
    if (!criticalsByHost.has(svc.host)) criticalsByHost.set(svc.host, []);
    criticalsByHost.get(svc.host).push(svc);
  }

  const result = {
    dry_run: dryRun,
    run_at: now.toISOString(),
    hosts_seen: hosts.length,
    assets_updated: 0,
    staging_created: 0,
    staging_updated: 0,
    skipped_ignored: 0,
    assets_missing: 0,
    details: [],
  };

  const seenHostNames = new Set();

  for (const host of hosts) {
    seenHostNames.add(host.name);
    const criticals = criticalsByHost.get(host.name) || [];
    const criticalSummary = summariseCriticals(criticals);

    // Fall 1: bereits verknuepftes Asset
    const linked = await Asset.findOne({
      where: { external_source: SOURCE, external_id: host.name },
    });

    if (linked) {
      const patch = {
        external_status: host.state,
        external_last_seen_at: now,
      };
      // location nur befuellen, nie ueberschreiben: eine manuell gepflegte
      // Standortangabe ("Rack 3, Serverraum") ist wertvoller als eine IP.
      if (!linked.location && host.address) patch.location = host.address;

      if (!dryRun) await linked.update(patch);
      result.assets_updated++;
      result.details.push({
        host: host.name, action: 'asset_updated', asset_id: linked.id,
        state: host.state, criticals: criticals.length,
      });
      continue;
    }

    // Fall 2 / 3: Staging
    const staged = await DiscoveredSoftware.findOne({
      where: { source: SOURCE, hostname: host.name },
      order: [['created_at', 'DESC']],
    });

    if (staged && staged.status === 'ignored') {
      // Eine bewusste Ablehnung wird nicht bei jedem Lauf neu vorgelegt.
      result.skipped_ignored++;
      result.details.push({ host: host.name, action: 'skipped_ignored' });
      continue;
    }

    if (staged && staged.status === 'pending') {
      const patch = {
        name: buildStagingName(host),
        ip: host.address || null,
        os: buildDescription(host, criticalSummary, runDate),
      };
      if (!dryRun) await staged.update(patch);
      result.staging_updated++;
      result.details.push({ host: host.name, action: 'staging_updated', staging_id: staged.id, state: host.state });
      continue;
    }

    if (staged && staged.status === 'approved') {
      // Freigegeben, aber ohne external_id verknuepft — das passiert bei
      // Eintraegen aus der Zeit vor dieser Verknuepfung. Nicht erneut anlegen.
      result.details.push({ host: host.name, action: 'already_approved', staging_id: staged.id });
      continue;
    }

    if (!dryRun) {
      await DiscoveredSoftware.create({
        name: buildStagingName(host),
        hostname: host.name,
        ip: host.address || null,
        os: buildDescription(host, criticalSummary, runDate),
        source: SOURCE,
        asset_type: 'hardware',
        status: 'pending',
      });
    }
    result.staging_created++;
    result.details.push({
      host: host.name, action: 'staging_created',
      state: host.state, criticals: criticals.length,
    });
  }

  // Fall 4: verknuepfte Assets, die CheckMK nicht mehr meldet
  const linkedAssets = await Asset.findAll({
    where: { external_source: SOURCE, external_id: { [Op.ne]: null } },
    attributes: ['id', 'name', 'external_id', 'external_status'],
  });
  for (const asset of linkedAssets) {
    if (seenHostNames.has(asset.external_id)) continue;
    if (asset.external_status === 'MISSING') continue; // schon gemeldet
    if (!dryRun) await Asset.update({ external_status: 'MISSING' }, { where: { id: asset.id } });
    result.assets_missing++;
    result.details.push({
      host: asset.external_id, action: 'asset_missing', asset_id: asset.id,
      note: 'Asset ist im ISMS verknuepft, wird von CheckMK aber nicht mehr gemeldet.',
    });
  }

  return result;
}

module.exports = { syncFromCheckmk, SOURCE };
