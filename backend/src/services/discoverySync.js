'use strict';

/**
 * Abgleich eines Drittsystems mit dem Asset-Register — quellenunabhaengig.
 *
 * Bis 3.0.0 stand diese Logik in checkmkSyncService.js und galt nur fuer
 * CheckMK. Eine zweite Quelle haette sie kopiert; die vier Faelle unten sind
 * aber genau die Stelle, an der ein Fehler still bleibt, und ein Fehler in
 * einer Kopie faellt noch spaeter auf.
 *
 * Vier Faelle je gemeldetem Datensatz:
 *   1. Es gibt bereits ein verknuepftes Asset  -> Livedaten aktualisieren.
 *   2. Es gibt einen offenen Staging-Eintrag   -> Staging-Eintrag aktualisieren.
 *   3. Nichts davon                            -> neuer Staging-Eintrag (pending).
 *   4. Ein verknuepftes Asset taucht im Lauf NICHT mehr auf -> als 'MISSING'
 *      markieren. Ein Asset, das die Quelle nicht mehr kennt, ist ein Befund
 *      (ausgemustert? vergessen? Anbindung kaputt?) und darf nicht
 *      stillschweigend weiter als gepflegt gelten.
 *
 * Der vierte Fall gilt NICHT fuer jede Quelle. Er ist ein Schluss aus
 * Abwesenheit, und der ist nur erlaubt, wenn die Quelle ihren Bestand
 * vollstaendig aufzaehlt. Ein Monitoring, das alle Hosts meldet, darf das; eine
 * hochgeladene Excel-Liste darf es nicht — sie ist ein Ausschnitt, den jemand
 * geschickt hat, keine Aussage ueber alles Uebrige. Welche Quelle was darf,
 * steht im Adapter als `zaehltBestandVollstaendig` und nicht hier.
 *
 * Der Abgleich legt KEINE Assets an. Er schreibt ins Discovery-Staging; Assets
 * entstehen erst durch die Freigabe unter /api/discovery/staged/:id/approve.
 * Ein Drittsystem darf das Inventar vorschlagen, nicht bestimmen.
 */

const { Op } = require('sequelize');
const { Asset, DiscoveredSoftware } = require('../models');

/**
 * @param {object} opts
 * @param {string} opts.source     Quellenkennung, landet in DiscoveredSoftware.source
 *                                 und Asset.external_source
 * @param {Array}  opts.records    normalisierte Datensaetze (siehe adapters/*)
 * @param {boolean} opts.dryRun    true = nichts schreiben, nur berichten
 * @param {boolean} opts.zaehltBestandVollstaendig  darf der Lauf aus Abwesenheit
 *                                 auf 'MISSING' schliessen?
 * @param {object} [opts.zusatz]   zusaetzliche Felder fuer den Bericht
 */
async function abgleichen({ source, records, dryRun = false, zaehltBestandVollstaendig = false, zusatz = {} }) {
  const now = new Date();

  const result = {
    source,
    dry_run: dryRun,
    run_at: now.toISOString(),
    hosts_seen: records.length,
    assets_updated: 0,
    staging_created: 0,
    staging_updated: 0,
    skipped_ignored: 0,
    assets_missing: 0,
    missing_check_skipped: false,
    details: [],
    ...zusatz,
  };

  // Beide Korrelationstabellen einmal laden statt zweimal pro Datensatz zu
  // fragen: bei einer Installation mit 500 Hosts sind das 1000 Einzelabfragen
  // weniger.
  const linkedAssets = await Asset.findAll({
    where: { external_source: source, external_id: { [Op.ne]: null } },
  });
  const assetsByExternalId = new Map(linkedAssets.map((a) => [a.external_id, a]));

  const stagedRows = await DiscoveredSoftware.findAll({
    where: { source },
    order: [['created_at', 'ASC']],
  });
  // ASC + Ueberschreiben laesst den juengsten Eintrag je Schluessel gewinnen.
  const stagedByKey = new Map(stagedRows.map((row) => [row.hostname, row]));

  const gesehen = new Set();

  for (const rec of records) {
    if (!rec.external_id) continue;
    gesehen.add(rec.external_id);

    // Fall 1: bereits verknuepftes Asset
    const linked = assetsByExternalId.get(rec.external_id);
    if (linked) {
      const patch = {
        external_status: rec.status || 'OK',
        external_last_seen_at: now,
      };
      // location nur befuellen, nie ueberschreiben: eine manuell gepflegte
      // Standortangabe ("Rack 3, Serverraum") ist wertvoller als eine IP.
      if (!linked.location && rec.ip) patch.location = rec.ip;

      if (!dryRun) await linked.update(patch);
      result.assets_updated++;
      result.details.push({
        host: rec.external_id, action: 'asset_updated', asset_id: linked.id, state: rec.status || null,
      });
      continue;
    }

    // Fall 2 / 3: Staging
    const staged = stagedByKey.get(rec.external_id);

    if (staged && staged.status === 'ignored') {
      // Eine bewusste Ablehnung wird nicht bei jedem Lauf neu vorgelegt.
      result.skipped_ignored++;
      result.details.push({ host: rec.external_id, action: 'skipped_ignored' });
      continue;
    }

    if (staged && staged.status === 'approved') {
      // Freigegeben, aber ohne external_id verknuepft — das passiert bei
      // Eintraegen aus der Zeit vor dieser Verknuepfung. Nicht erneut anlegen.
      result.details.push({ host: rec.external_id, action: 'already_approved', staging_id: staged.id });
      continue;
    }

    const felder = {
      name: rec.name,
      hostname: rec.external_id,
      ip: rec.ip || null,
      os: rec.os || null,
      vendor: rec.vendor || null,
      version: rec.version || null,
      source,
      asset_type: rec.asset_type || 'software',
      payload: rec.payload ? JSON.stringify(rec.payload) : null,
    };

    if (staged && staged.status === 'pending') {
      if (!dryRun) await staged.update(felder);
      result.staging_updated++;
      result.details.push({ host: rec.external_id, action: 'staging_updated', staging_id: staged.id, state: rec.status || null });
      continue;
    }

    if (!dryRun) await DiscoveredSoftware.create({ ...felder, status: 'pending' });
    result.staging_created++;
    result.details.push({ host: rec.external_id, action: 'staging_created', state: rec.status || null });
  }

  // Fall 4: verknuepfte Assets, die die Quelle nicht mehr meldet.
  if (!zaehltBestandVollstaendig) {
    result.missing_check_skipped = true;
    result.details.push({
      action: 'missing_check_skipped',
      note: `Die Quelle "${source}" liefert einen Ausschnitt, keine vollstaendige Bestandsaufnahme. `
        + 'Aus dem Fehlen eines Assets in diesem Lauf folgt nichts — es wird deshalb nicht als vermisst markiert.',
    });
    return result;
  }

  // Nur wenn der Lauf ueberhaupt etwas gesehen hat. Eine leere Ergebnisliste ist
  // kein Beleg dafuer, dass es keine Hosts mehr gibt — sie entsteht genauso bei
  // einem Automationsbenutzer ohne Leseberechtigung (CheckMK liefert dann eine
  // leere Collection statt eines 403) oder wenn ein Portal/Proxy mit HTTP 200
  // etwas anderes als die erwartete Struktur zurueckgibt. Ohne diese Sperre
  // wuerde ein einziger solcher Lauf das komplette verknuepfte Inventar auf
  // MISSING setzen — ein Datenschaden, der von Hand zurueckgedreht werden muss.
  if (!records.length) {
    result.missing_check_skipped = true;
    result.details.push({
      action: 'missing_check_skipped',
      note: `Die Quelle "${source}" hat keinen einzigen Datensatz geliefert. Der MISSING-Abgleich wurde `
        + 'uebersprungen, damit ein leeres Ergebnis nicht das gesamte verknuepfte Inventar als vermisst '
        + 'markiert. Berechtigungen und Konfiguration der Anbindung pruefen.',
    });
    return result;
  }

  for (const asset of linkedAssets) {
    if (gesehen.has(asset.external_id)) continue;
    if (asset.external_status === 'MISSING') continue; // schon gemeldet
    if (!dryRun) await Asset.update({ external_status: 'MISSING' }, { where: { id: asset.id } });
    result.assets_missing++;
    result.details.push({
      host: asset.external_id, action: 'asset_missing', asset_id: asset.id,
      note: `Asset ist im ISMS mit "${source}" verknuepft, wird von dort aber nicht mehr gemeldet.`,
    });
  }

  return result;
}

module.exports = { abgleichen };
