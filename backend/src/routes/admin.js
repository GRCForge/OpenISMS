const router = require('express').Router();
const { Op } = require('sequelize');
const client = require('openid-client');
const { authenticate, requireRole } = require('../middleware/auth');
const { getGeneral, setGeneral, getOidcRaw, setOidc, getPermissions, setPermissions, DEFAULT_PERMISSIONS, getSetting, setSetting } = require('../services/settingsService');
const { sendEmail, testSmtp, getSmtpConfig } = require('../services/emailService');
const { encrypt: encryptValue } = require('../services/cryptoService');
const { invalidate, getCallbackUrl } = require('../services/oidcService');
const { auditFromReq } = require('../services/auditService');
const { AuditLog, CustomRole, OidcClaimMapping, User } = require('../models');

// Gesamter Admin-Bereich nur fuer Administratoren
router.use(authenticate, requireRole('admin'));

// --- Allgemeine Einstellungen ---
router.get('/settings', async (req, res) => {
  try { res.json(await getGeneral()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/settings', async (req, res) => {
  try {
    const { appName, reviewIntervalMonths, ssoAutoProvision, ssoDefaultRole, auditLogRetentionMonths, passwordPolicy, bruteForcePolicy } = req.body || {};
    const patch = {};
    if (appName !== undefined) patch.appName = appName;
    if (reviewIntervalMonths !== undefined) patch.reviewIntervalMonths = parseInt(reviewIntervalMonths) || 12;
    if (ssoAutoProvision !== undefined) patch.ssoAutoProvision = !!ssoAutoProvision;
    if (ssoDefaultRole !== undefined) patch.ssoDefaultRole = ssoDefaultRole;
    if (auditLogRetentionMonths !== undefined) patch.auditLogRetentionMonths = Math.max(3, parseInt(auditLogRetentionMonths) || 15);
    if (passwordPolicy !== undefined) patch.passwordPolicy = passwordPolicy;
    if (bruteForcePolicy !== undefined) patch.bruteForcePolicy = bruteForcePolicy;
    const before = await getGeneral();
    const saved = await setGeneral(patch);
    await auditFromReq(req, 'update', 'settings', null, 'Allgemeine Einstellungen', { before, after: saved });
    res.json(saved);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Manual audit log purge (also returns count of deleted entries)
router.post('/maintenance/purge-audit-log', async (req, res) => {
  try {
    const settings = await getGeneral();
    const months = settings.auditLogRetentionMonths || 15;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const count = await AuditLog.destroy({ where: { created_at: { [Op.lt]: cutoff } } });
    await auditFromReq(req, 'delete', 'audit_log', null, 'Audit-Log Bereinigung', { deleted: count, cutoff: cutoff.toISOString() });
    res.json({ deleted: count, cutoff, retentionMonths: months });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trigger task automation manually
router.post('/maintenance/run-automation', async (req, res) => {
  try {
    const { runTaskAutomation } = require('../services/taskAutomationService');
    await runTaskAutomation();
    await auditFromReq(req, 'execute', 'settings', null, 'Task-Automatisierung manuell gestartet', {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Rollen & Rechte ---
router.get('/permissions', async (req, res) => {
  try { res.json({ permissions: await getPermissions(), defaults: DEFAULT_PERMISSIONS, roles: ['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee'] }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/permissions', async (req, res) => {
  try {
    const { permissions } = req.body || {};
    if (!permissions || typeof permissions !== 'object') return res.status(400).json({ error: 'permissions object required' });
    const before = await getPermissions();
    const saved = await setPermissions(permissions);
    await auditFromReq(req, 'update', 'settings', null, 'Rollen & Rechte', { before, after: saved });
    res.json({ permissions: saved });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/permissions/reset', async (req, res) => {
  try {
    const { Setting } = require('../models');
    await Setting.destroy({ where: { key: 'permissions' } });
    await auditFromReq(req, 'update', 'settings', null, 'Rollen & Rechte zurückgesetzt', {});
    res.json({ permissions: await getPermissions() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Custom Roles ---
router.get('/custom-roles', async (req, res) => {
  try {
    const roles = await CustomRole.findAll({ order: [['name', 'ASC']] });
    // Anzahl der direkt zugewiesenen Benutzer je Rolle ergänzen (für die GUI).
    const counts = await User.findAll({
      attributes: ['custom_role_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'cnt']],
      where: { custom_role_id: { [Op.ne]: null } },
      group: ['custom_role_id'],
      raw: true,
    });
    const countMap = Object.fromEntries(counts.map(c => [c.custom_role_id, parseInt(c.cnt)]));
    res.json(roles.map(r => ({ ...r.toJSON(), users_count: countMap[r.id] || 0 })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/custom-roles', async (req, res) => {
  try {
    const { name, description, base_role } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
    const role = await CustomRole.create({ name: name.trim(), description: description || null, base_role: base_role || 'viewer' });
    await auditFromReq(req, 'create', 'custom_role', role.id, role.name, {});
    res.status(201).json(role);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/custom-roles/:id', async (req, res) => {
  try {
    const role = await CustomRole.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: 'Nicht gefunden' });
    const { name, description, base_role } = req.body || {};
    const before = { name: role.name, description: role.description, base_role: role.base_role };
    await role.update({
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(base_role !== undefined && { base_role }),
    });
    // Basisrolle geändert: effektive Rolle aller zugewiesenen Benutzer nachziehen.
    if (base_role !== undefined && base_role !== before.base_role) {
      await User.update({ role: base_role }, { where: { custom_role_id: role.id } });
    }
    const after = { name: role.name, description: role.description, base_role: role.base_role };
    await auditFromReq(req, 'update', 'custom_role', role.id, role.name, { before, after });
    res.json(role);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/custom-roles/:id', async (req, res) => {
  try {
    const role = await CustomRole.findByPk(req.params.id);
    if (!role) return res.status(404).json({ error: 'Nicht gefunden' });
    const name = role.name;
    // Zuweisung bei Benutzern entfernen (Basisrolle bleibt als effektive Rolle erhalten).
    await User.update({ custom_role_id: null }, { where: { custom_role_id: role.id } });
    await role.destroy();
    await auditFromReq(req, 'delete', 'custom_role', req.params.id, name, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- OIDC Claim Mappings ---
router.get('/oidc-mappings', async (req, res) => {
  try {
    const mappings = await OidcClaimMapping.findAll({
      include: [{ model: CustomRole, as: 'customRole', attributes: ['id', 'name', 'base_role'] }],
      order: [['priority', 'DESC'], ['id', 'ASC']],
    });
    res.json(mappings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/oidc-mappings', async (req, res) => {
  try {
    const { claim_path, claim_value, role, custom_role_id, priority } = req.body || {};
    if (!claim_path?.trim() || !claim_value?.trim()) return res.status(400).json({ error: 'claim_path und claim_value erforderlich' });
    if (!role && !custom_role_id) return res.status(400).json({ error: 'role oder custom_role_id erforderlich' });
    const mapping = await OidcClaimMapping.create({
      claim_path: claim_path.trim(),
      claim_value: claim_value.trim(),
      role: role || null,
      custom_role_id: custom_role_id || null,
      priority: parseInt(priority) || 0,
    });
    await auditFromReq(req, 'create', 'oidc_mapping', mapping.id, `${claim_path}=${claim_value}`, {});
    res.status(201).json(mapping);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/oidc-mappings/:id', async (req, res) => {
  try {
    const mapping = await OidcClaimMapping.findByPk(req.params.id);
    if (!mapping) return res.status(404).json({ error: 'Nicht gefunden' });
    const label = `${mapping.claim_path}=${mapping.claim_value}`;
    await mapping.destroy();
    await auditFromReq(req, 'delete', 'oidc_mapping', req.params.id, label, {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- OIDC / SSO ---
// Secret wird NIE zurueckgegeben, nur ob es gesetzt ist.
router.get('/oidc', async (req, res) => {
  try {
    const o = await getOidcRaw();
    res.json({
      enabled: o.enabled,
      displayName: o.displayName || 'Single Sign-On',
      issuer: o.issuer || '',
      clientId: o.clientId || '',
      scopes: o.scopes || 'openid profile email',
      clientSecretSet: !!o.clientSecretEnc,
      callbackUrl: getCallbackUrl(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/oidc', async (req, res) => {
  try {
    const { enabled, displayName, issuer, clientId, clientSecret, scopes } = req.body || {};
    const patch = {};
    if (enabled !== undefined) patch.enabled = !!enabled;
    if (displayName !== undefined) patch.displayName = displayName;
    if (issuer !== undefined) patch.issuer = issuer.trim();
    if (clientId !== undefined) patch.clientId = clientId.trim();
    if (scopes !== undefined) patch.scopes = scopes.trim();
    if (clientSecret) patch.clientSecret = clientSecret;

    const before = await getOidcRaw();
    const saved = await setOidc(patch);
    invalidate();
    
    const auditBefore = { ...before };
    delete auditBefore.clientSecretEnc;
    const auditAfter = { enabled: saved.enabled, displayName: saved.displayName, issuer: saved.issuer, clientId: saved.clientId, scopes: saved.scopes };
    
    await auditFromReq(req, 'update', 'settings', null, 'OIDC-Konfiguration', { before: auditBefore, after: auditAfter });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Verbindungstest: Discovery-Dokument des Issuers laden
router.post('/oidc/test', async (req, res) => {
  try {
    const url = (req.body?.issuer || (await getOidcRaw()).issuer || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'Keine Issuer-URL angegeben' });
    
    const server = new URL(url);
    const options = server.protocol === 'http:'
      ? { execute: [client.allowInsecureRequests] }
      : undefined;

    const config = await client.discovery(server, 'dummy', 'dummy', undefined, options);
    const meta = config.serverMetadata();

    res.json({
      ok: true,
      issuer: meta.issuer,
      authorization_endpoint: meta.authorization_endpoint,
      token_endpoint: meta.token_endpoint,
      userinfo_endpoint: meta.userinfo_endpoint,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// --- SMTP / E-Mail-Konfiguration ---

router.get('/smtp', async (req, res) => {
  try {
    const cfg = await getSmtpConfig();
    if (!cfg) return res.json(null);
    // Mask password
    const masked = { ...cfg };
    if (masked.password) masked.password = '*****';
    res.json(masked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/smtp', async (req, res) => {
  try {
    const { host, port, secure, user, password, from } = req.body || {};
    // Load raw stored value (password still in enc:... form) to avoid decrypt→re-encrypt cycle
    const rawStored = await getSetting('smtp');
    const current = rawStored ? JSON.parse(rawStored) : {};
    // Only re-encrypt if the user provided a new plain-text password (not the mask sentinel)
    let storedPassword;
    if (password && password !== '*****') {
      storedPassword = `enc:${encryptValue(password)}`;
    } else {
      storedPassword = current.password; // keep existing enc:... value as-is
    }
    const updated = {
      host: host !== undefined ? host : current.host,
      port: port !== undefined ? port : current.port,
      secure: secure !== undefined ? secure : current.secure,
      user: user !== undefined ? user : current.user,
      password: storedPassword || undefined,
      from: from !== undefined ? from : current.from,
    };
    await setSetting('smtp', updated);
    const beforeMasked = { ...current };
    if (beforeMasked.password) beforeMasked.password = '*****';
    const afterMasked = { ...updated };
    if (afterMasked.password) afterMasked.password = '*****';
    await auditFromReq(req, 'update', 'settings', null, 'SMTP-Konfiguration', { before: beforeMasked, after: afterMasked });
    const masked = { ...updated };
    if (masked.password) masked.password = '*****';
    res.json(masked);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/smtp/test', async (req, res) => {
  try {
    let cfg;
    if (req.body?.host) {
      cfg = { ...req.body };
      // If frontend sent the mask sentinel, substitute the stored (decrypted) password
      if (!cfg.password || cfg.password === '*****') {
        const stored = await getSmtpConfig();
        cfg.password = stored?.password ?? '';
      }
    } else {
      cfg = await getSmtpConfig();
    }
    if (!cfg?.host) return res.status(400).json({ ok: false, error: 'Keine SMTP-Konfiguration vorhanden' });
    await testSmtp(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/smtp/send-test', async (req, res) => {
  try {
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ error: 'Empfänger (to) erforderlich' });
    await sendEmail({
      to,
      subject: '[OpenISMS] Test-E-Mail',
      text: 'Dies ist eine Test-E-Mail von OpenISMS. Die SMTP-Konfiguration funktioniert korrekt.',
      html: '<p>Dies ist eine <strong>Test-E-Mail</strong> von OpenISMS.</p><p>Die SMTP-Konfiguration funktioniert korrekt.</p>',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// --- Application Logs ---
router.get('/logs', async (req, res) => {
  try {
    const fs = require('fs');
    const { logFilePath } = require('../services/logger');
    
    if (!fs.existsSync(logFilePath)) {
      return res.json({ logs: 'No logs available.' });
    }
    
    if (req.query.download === '1') {
      return res.download(logFilePath, 'app.log');
    }
    
    const content = fs.readFileSync(logFilePath, 'utf8');
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const lastLines = lines.slice(-500).join('\n');
    res.json({ logs: lastLines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
