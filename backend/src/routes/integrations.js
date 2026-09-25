'use strict';

/**
 * Drittsystem-Anbindungen fuer das Asset-Register.
 *
 * Alle Routen laufen ueber /api/integrations/<quelle>/... — welche Quellen es
 * gibt, steht in services/integrations/. Eine neue Anbindung braucht hier
 * keine Zeile; die bisherigen /checkmk/-Pfade sind unveraendert erreichbar,
 * weil "checkmk" jetzt einfach ein Wert von :source ist.
 *
 * Grundsatz: ein Drittsystem darf das Inventar vorschlagen, nicht bestimmen.
 * Der Sync schreibt in das Discovery-Staging; Assets entstehen erst durch die
 * bestehende Freigabe unter /api/discovery/staged/:id/approve.
 */

const router = require('express').Router();
const { heavyLimiter } = require('../middleware/rateLimiter');
const { authenticate, requirePermission, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const settingsService = require('../services/settingsService');
const registry = require('../services/integrations');
const { abgleichen } = require('../services/discoverySync');

router.use(heavyLimiter);

function assertConfigured(adapter, cfg) {
  const fehlt = adapter.fehlendeKonfiguration ? adapter.fehlendeKonfiguration(cfg) : [];
  if (fehlt.length) {
    const e = new Error(`${adapter.label}-Anbindung unvollstaendig konfiguriert. Fehlt: ${fehlt.join(', ')}.`);
    e.status = 400;
    throw e;
  }
}

function sendError(res, e) {
  res.status(e.status || 500).json({ error: e.message });
}

// ── Verzeichnis ───────────────────────────────────────────────────────────────
// Damit die Oberflaeche die verfuegbaren Quellen nicht fest verdrahten muss.

router.get('/', authenticate, requirePermission('integrations', 'view', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const liste = await Promise.all(registry.alle().map(async (a) => {
      const basis = {
        id: a.id,
        label: a.label,
        beschreibung: a.beschreibung,
        art: a.art || 'pull',
        zaehlt_bestand_vollstaendig: Boolean(a.zaehltBestandVollstaendig),
        konfig_felder: a.konfigFelder || [],
      };
      if (basis.art !== 'pull') return { ...basis, enabled: null };
      const cfg = await settingsService.getIntegrationPublic(a.id);
      return {
        ...basis,
        enabled: Boolean(cfg.enabled),
        configured: !(a.fehlendeKonfiguration
          ? a.fehlendeKonfiguration({ ...cfg, secret: cfg.secretConfigured ? 'x' : '' }).length : 0),
        last_sync_at: cfg.lastSyncAt || null,
      };
    }));
    res.json({ sources: liste });
  } catch (e) { sendError(res, e); }
});

// ── Konfiguration lesen ───────────────────────────────────────────────────────

router.get('/:source', authenticate, requirePermission('integrations', 'view', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const adapter = registry.pullAdapter(req.params.source);
    res.json(await settingsService.getIntegrationPublic(adapter.id));
  } catch (e) { sendError(res, e); }
});

// ── Konfiguration schreiben ───────────────────────────────────────────────────

router.put('/:source', authenticate, requirePermission('integrations', 'configure', 'admin'), requireWriteAccess(), async (req, res) => {
  try {
    const adapter = registry.pullAdapter(req.params.source);
    const body = req.body || {};
    const patch = {};

    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    // Nur deklarierte Felder werden uebernommen. Ein unbekannter Schluessel im
    // Body landete sonst ungeprueft im Settings-Datensatz.
    for (const feld of adapter.konfigFelder || []) {
      const wert = body[feld.name];
      if (wert === undefined) continue;
      if (feld.typ === 'bool') patch[feld.name] = Boolean(wert);
      else if (feld.typ === 'geheim') { if (wert) patch[feld.name] = String(wert); }
      else patch[feld.name] = String(wert).trim();
    }

    if (adapter.patchPruefen) {
      adapter.patchPruefen(patch, await settingsService.getIntegrationRaw(adapter.id));
    }

    const saved = await settingsService.setIntegration(adapter.id, patch);

    // Nur protokollieren, WAS geaendert wurde — niemals das Secret selbst.
    const geheim = new Set((adapter.konfigFelder || []).filter((f) => f.typ === 'geheim').map((f) => f.name));
    await auditFromReq(req, 'update', 'Integration', null, adapter.label, {
      fields: Object.keys(patch).map((k) => (geheim.has(k) ? `${k} (ersetzt)` : k)),
      enabled: saved.enabled,
    });

    res.json(saved);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// ── Verbindungstest ───────────────────────────────────────────────────────────

router.post('/:source/test', authenticate, requirePermission('integrations', 'sync', 'admin', 'it-staff'), async (req, res) => {
  try {
    const adapter = registry.pullAdapter(req.params.source);
    const cfg = await settingsService.getIntegrationConfig(adapter.id);
    assertConfigured(adapter, cfg);
    const result = await adapter.pruefen(cfg);
    await auditFromReq(req, 'read', 'Integration', null, adapter.label, {
      action: 'connection_test', host_count: result.host_count,
    });
    res.json(result);
  } catch (e) { sendError(res, e); }
});

// ── Livedaten ohne Schreibwirkung ─────────────────────────────────────────────
// /hosts bleibt als Pfad erhalten, weil die Oberflaeche ihn so aufruft.

router.get('/:source/hosts', authenticate, requirePermission('integrations', 'view', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const adapter = registry.pullAdapter(req.params.source);
    const cfg = await settingsService.getIntegrationConfig(adapter.id);
    assertConfigured(adapter, cfg);
    res.json(await adapter.vorschau(cfg));
  } catch (e) { sendError(res, e); }
});

// ── Abgleich ──────────────────────────────────────────────────────────────────

router.post('/:source/sync', authenticate, requirePermission('integrations', 'sync', 'admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  try {
    const adapter = registry.pullAdapter(req.params.source);
    const cfg = await settingsService.getIntegrationConfig(adapter.id);
    assertConfigured(adapter, cfg);
    if (!cfg.enabled) {
      return res.status(400).json({ error: `${adapter.label}-Anbindung ist deaktiviert. Erst aktivieren, dann synchronisieren.` });
    }

    const dryRun = Boolean(req.body?.dryRun);
    const { records, zusatz } = await adapter.lesen(cfg);
    const result = await abgleichen({
      source: adapter.id,
      records,
      dryRun,
      zaehltBestandVollstaendig: adapter.zaehltBestandVollstaendig,
      zusatz,
    });

    // Ein Probelauf ist kein Stand — sonst wuerde "zuletzt synchronisiert"
    // eine Aktualitaet behaupten, die es nicht gibt.
    if (!dryRun) {
      await settingsService.setIntegration(adapter.id, {
        lastSyncAt: result.run_at,
        lastSyncSummary: {
          hosts_seen: result.hosts_seen,
          assets_updated: result.assets_updated,
          staging_created: result.staging_created,
          staging_updated: result.staging_updated,
          assets_missing: result.assets_missing,
        },
      });
    }

    await auditFromReq(req, dryRun ? 'read' : 'update', 'Integration', null, adapter.label, {
      action: dryRun ? 'sync_dry_run' : 'sync',
      hosts_seen: result.hosts_seen,
      assets_updated: result.assets_updated,
      staging_created: result.staging_created,
      assets_missing: result.assets_missing,
    });

    res.json(result);
  } catch (e) { sendError(res, e); }
});

module.exports = router;
