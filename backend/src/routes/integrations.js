'use strict';

/**
 * Drittsystem-Anbindungen fuer das Asset-Register.
 *
 * Erste Quelle: CheckMK. Der Aufbau ist bewusst generisch gehalten
 * (/api/integrations/<system>/...), damit Wazuh, Proxmox oder eine CMDB
 * spaeter danebenpassen, ohne dass die Route umgebaut werden muss.
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
const checkmk = require('../services/checkmkService');
const { syncFromCheckmk } = require('../services/checkmkSyncService');

router.use(heavyLimiter);

// Ein konfigurierter, aber unvollstaendiger Connector ist ein haeufiger
// Stolperstein — lieber eine klare Meldung als ein HTTP-401 aus CheckMK.
function assertConfigured(cfg) {
  const missing = [];
  if (!cfg.url) missing.push('URL');
  if (!cfg.site) missing.push('Site');
  if (!cfg.username) missing.push('Benutzer');
  if (!cfg.secret) missing.push('Secret');
  if (missing.length) {
    const e = new Error(`CheckMK-Anbindung unvollstaendig konfiguriert. Fehlt: ${missing.join(', ')}.`);
    e.status = 400;
    throw e;
  }
}

function sendError(res, e) {
  res.status(e.status || 500).json({ error: e.message });
}

// ── Konfiguration lesen ───────────────────────────────────────────────────────

router.get('/checkmk', authenticate, requirePermission('integrations', 'view', 'admin', 'it-staff'), async (req, res) => {
  try {
    res.json(await settingsService.getCheckmkPublic());
  } catch (e) { sendError(res, e); }
});

// ── Konfiguration schreiben ───────────────────────────────────────────────────

router.put('/checkmk', authenticate, requirePermission('integrations', 'configure', 'admin'), requireWriteAccess(), async (req, res) => {
  try {
    const { enabled, url, site, username, secret, allowSelfSigned } = req.body || {};
    const patch = {};
    if (enabled !== undefined) patch.enabled = Boolean(enabled);
    if (url !== undefined) patch.url = String(url).trim();
    if (site !== undefined) patch.site = String(site).trim();
    if (username !== undefined) patch.username = String(username).trim();
    if (allowSelfSigned !== undefined) patch.allowSelfSigned = Boolean(allowSelfSigned);
    if (secret) patch.secret = String(secret);

    // URL/Site fruehzeitig validieren, damit ein Tippfehler beim Speichern
    // auffaellt und nicht erst beim naechtlichen Sync.
    if (patch.url || patch.site) {
      const current = await settingsService.getCheckmkRaw();
      checkmk.buildApiBase(patch.url ?? current.url, patch.site ?? current.site);
    }

    const saved = await settingsService.setCheckmk(patch);

    // Nur protokollieren, WAS geaendert wurde — niemals das Secret selbst.
    await auditFromReq(req, 'update', 'Integration', null, 'CheckMK', {
      fields: Object.keys(patch).map((k) => (k === 'secret' ? 'secret (ersetzt)' : k)),
      enabled: saved.enabled,
    });

    res.json(saved);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

// ── Verbindungstest ───────────────────────────────────────────────────────────

router.post('/checkmk/test', authenticate, requirePermission('integrations', 'sync', 'admin', 'it-staff'), async (req, res) => {
  try {
    const cfg = await settingsService.getCheckmkConfig();
    assertConfigured(cfg);
    const result = await checkmk.testConnection(cfg);
    await auditFromReq(req, 'read', 'Integration', null, 'CheckMK', {
      action: 'connection_test', host_count: result.host_count,
    });
    res.json(result);
  } catch (e) { sendError(res, e); }
});

// ── Livedaten ohne Schreibwirkung ─────────────────────────────────────────────

router.get('/checkmk/hosts', authenticate, requirePermission('integrations', 'view', 'admin', 'it-staff'), async (req, res) => {
  try {
    const cfg = await settingsService.getCheckmkConfig();
    assertConfigured(cfg);
    res.json({ hosts: await checkmk.fetchHosts(cfg) });
  } catch (e) { sendError(res, e); }
});

// ── Abgleich ──────────────────────────────────────────────────────────────────

router.post('/checkmk/sync', authenticate, requirePermission('integrations', 'sync', 'admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  try {
    const cfg = await settingsService.getCheckmkConfig();
    assertConfigured(cfg);
    if (!cfg.enabled) {
      return res.status(400).json({ error: 'CheckMK-Anbindung ist deaktiviert. Erst aktivieren, dann synchronisieren.' });
    }

    const dryRun = Boolean(req.body?.dryRun);
    const result = await syncFromCheckmk({ cfg, dryRun });

    // Ein Probelauf ist kein Stand — sonst wuerde "zuletzt synchronisiert"
    // eine Aktualitaet behaupten, die es nicht gibt.
    if (!dryRun) {
      await settingsService.setCheckmk({
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

    await auditFromReq(req, dryRun ? 'read' : 'update', 'Integration', null, 'CheckMK', {
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
