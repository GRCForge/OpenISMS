'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { randomUUID, timingSafeEqual } = require('crypto');
const { z } = require('zod');
const { Op } = require('sequelize');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { hashToken } = require('../services/cryptoService');

// ─── Auth ────────────────────────────────────────────────────────────────────

const getTokenFromHeaders = (req) => {
  // 1. Authorization header (Bearer <token> or raw isms_api_... token)
  const authHeader = String(req.headers['authorization'] || '').trim();
  if (authHeader) {
    // Bounded prefix-match + slice instead of /^Bearer\s+(.+)$/i: the old regex had
    // two adjacent quantifiers (\s+ and .+) that overlap on whitespace, allowing
    // polynomial-time backtracking on a crafted Authorization header (CodeQL
    // js/polynomial-redos, alert #254). This form is equivalent and linear-time.
    const bearerPrefix = /^Bearer\s+/i.exec(authHeader);
    if (bearerPrefix) return authHeader.slice(bearerPrefix[0].length).trim();
    if (authHeader.startsWith('isms_api_') || !authHeader.includes(' ')) {
      return authHeader;
    }
  }

  // 2. Custom API key headers
  const apiKeyHeader = String(
    req.headers['x-api-key'] ||
    req.headers['x-mcp-key'] ||
    req.headers['api-key'] ||
    ''
  ).trim();
  if (apiKeyHeader) return apiKeyHeader;

  // 3. Query string parameter (essential for standard SSE / EventSource in browsers/clients)
  // Query-string token fallback is a deliberate, scoped tradeoff (same reasoning as
  // middleware/auth.js): browser EventSource (SSE) clients cannot set custom headers,
  // so a short-lived session token has to travel in the URL for that one transport.
  // Scoped to GET only -- POST-based Streamable-HTTP clients always authenticate via
  // the Authorization header above. Mitigation: helmet's default `Referrer-Policy:
  // no-referrer` (see index.js) keeps the token out of any Referer header.
  if (req.method === 'GET') {
    const queryToken = req.query?.token || req.query?.apiKey || req.query?.api_key || req.query?.access_token || req.query?.key;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }
  }

  return null;
};

const getWwwAuthHeader = async () => {
  try {
    const { getOidcConfig } = require('../services/settingsService');
    const cfg = await getOidcConfig();
    if (cfg.enabled && cfg.issuer) {
      const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
      return `Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource"`;
    }
  } catch { /* fallback */ }
  return 'Bearer realm="OpenISMS MCP"';
};

async function mcpAuth(req, res, next) {
  // Allow preflight OPTIONS requests without requiring authentication
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // OAuth 2.0 Protected Resource Metadata (RFC 9728) & Discovery
  if (req.path.includes('oauth-protected-resource') || String(req.originalUrl || '').includes('oauth-protected-resource')) {
    try {
      const { getOidcConfig } = require('../services/settingsService');
      const cfg = await getOidcConfig();
      if (cfg.enabled && cfg.issuer) {
        const appUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
        return res.type('application/json').json({
          resource: `${appUrl}/mcp`,
          authorization_servers: [cfg.issuer.replace(/\/$/, '')],
          scopes_supported: (cfg.scopes || 'openid profile email').split(' ').filter(Boolean),
          resource_name: 'OpenISMS MCP Server',
          resource_documentation: `${appUrl}/api/docs`,
        });
      }
    } catch { /* OIDC not active */ }
    return res.status(404).type('application/json').json({
      error: 'not_found',
      message: 'OAuth 2.0 metadata discovery is not implemented on this endpoint. Use static Bearer token authentication.'
    });
  }

  if (req.path.includes('/.well-known') || String(req.originalUrl || '').includes('/.well-known')) {
    return res.status(404).type('application/json').json({
      error: 'not_found',
      message: 'OAuth 2.0 metadata discovery is not implemented on this endpoint. Use static Bearer token authentication.'
    });
  }

  const token = getTokenFromHeaders(req);

  if (!token) {
    const wwwAuth = await getWwwAuthHeader();
    res.setHeader('WWW-Authenticate', wwwAuth);
    return res.status(401).json({ error: 'MCP: Authorization header or token required' });
  }

  // Option A: static MCP_SECRET (timing-safe comparison to prevent timing attacks)
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const tokenBuf  = Buffer.from(token,  'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
      req.mcpUser = { id: 0, name: 'MCP Client', role: 'admin', custom_role_id: null };
      req.auth = req.mcpUser;
      req._mcpUser = req.mcpUser;
      return next();
    }
  }

  // Option B: regular API Token (isms_api_...)
  // Validate format before DB lookup: prefix + 64 lowercase hex chars
  if (token.startsWith('isms_api_')) {
    if (!/^isms_api_[0-9a-f]{64}$/.test(token)) {
      const wwwAuth = await getWwwAuthHeader();
      res.setHeader('WWW-Authenticate', `${wwwAuth}, error="invalid_token", error_description="Invalid token format"`);
      return res.status(401).json({ error: 'MCP: Invalid token' });
    }
    try {
      const { ApiToken, User } = getModels();
      const dbToken = await ApiToken.findOne({ where: { token_hash: hashToken(token) } });
      if (!dbToken) {
        const wwwAuth = await getWwwAuthHeader();
        res.setHeader('WWW-Authenticate', `${wwwAuth}, error="invalid_token", error_description="Token not found"`);
        return res.status(401).json({ error: 'MCP: Invalid token' });
      }

      // Check for expiration
      if (dbToken.expires_at && new Date(dbToken.expires_at) < new Date()) {
        const { notify } = require('../services/notifyService');
        const userId = dbToken.user_id;
        const tokenName = dbToken.name;
        await dbToken.destroy();
        await notify({
          userId: userId,
          title: 'API-Token abgelaufen (MCP)',
          content: `Ihr API-Token "${tokenName}" für den MCP-Server ist abgelaufen und wurde gelöscht.`,
          type: 'system'
        });
        const wwwAuth = await getWwwAuthHeader();
        res.setHeader('WWW-Authenticate', `${wwwAuth}, error="invalid_token", error_description="Token expired"`);
        return res.status(401).json({ error: 'MCP: Token expired' });
      }

      const user = await User.findByPk(dbToken.user_id);
      if (!user || !user.active) {
        const wwwAuth = await getWwwAuthHeader();
        res.setHeader('WWW-Authenticate', `${wwwAuth}, error="invalid_token", error_description="User inactive"`);
        return res.status(401).json({ error: 'MCP: User not found or inactive' });
      }

      req.mcpUser = { id: user.id, name: user.name, role: user.role, custom_role_id: user.custom_role_id };
      req.auth = req.mcpUser;
      req._mcpUser = req.mcpUser;
      return next();
    } catch (e) {
      return res.status(500).json({ error: `MCP: Auth error: ${e.message}` });
    }
  }

  // Option C: regular JWT issued by /api/auth/login or OIDC flow
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Reject pre-2FA temporary tokens — they must not grant full access.
    if (payload.totp_pending) {
      const wwwAuth = await getWwwAuthHeader();
      res.setHeader('WWW-Authenticate', `${wwwAuth}, error="insufficient_scope", error_description="MFA required"`);
      return res.status(401).json({ error: 'MCP: Two-factor authentication required' });
    }
    // Re-validate the user against the DB so deactivated/role-changed accounts
    // lose access immediately instead of until token expiry.
    const { User } = getModels();
    const user = await User.findByPk(payload.id);
    if (!user || !user.active) {
      const wwwAuth = await getWwwAuthHeader();
      res.setHeader('WWW-Authenticate', `${wwwAuth}, error="invalid_token", error_description="User inactive"`);
      return res.status(401).json({ error: 'MCP: User not found or inactive' });
    }
    req.mcpUser = { id: user.id, name: user.name, role: user.role, custom_role_id: user.custom_role_id };
    req.auth = req.mcpUser;
    req._mcpUser = req.mcpUser;
    return next();
  } catch (jwtErr) {
    // Option D: If OIDC is configured, attempt validation with upstream IdP userinfo endpoint
    try {
      const { buildConfig, client } = require('../services/oidcService');
      const { config } = await buildConfig();
      const info = await client.fetchUserInfo(config, token, client.skipSubjectCheck);
      const email = String(info.email || info.preferred_username || '').toLowerCase();
      if (email) {
        const { User } = getModels();
        let user = await User.findOne({ where: { email } });
        if (!user) {
          const { getGeneral } = require('../services/settingsService');
          const general = await getGeneral();
          if (general.ssoAutoProvision) {
            user = await User.create({
              name: info.name || email,
              email,
              password_hash: await User.hashPassword(require('crypto').randomBytes(24).toString('hex')),
              role: general.ssoDefaultRole || 'viewer',
              active: true,
              sso_user: true,
            });
          }
        }
        if (user && user.active) {
          req.mcpUser = { id: user.id, name: user.name, role: user.role, custom_role_id: user.custom_role_id };
          req.auth = req.mcpUser;
          req._mcpUser = req.mcpUser;
          return next();
        }
      }
    } catch {
      // OIDC validation skipped or failed
    }

    const wwwAuth = await getWwwAuthHeader();
    res.setHeader('WWW-Authenticate', `${wwwAuth}, error="invalid_token", error_description="Invalid or expired token"`);
    return res.status(401).json({ error: 'MCP: Invalid or expired token' });
  }
}

// ─── Models (loaded lazily so DB is ready) ───────────────────────────────────

function getModels() {
  return require('../models');
}

// ─── Audit & User logging helpers ────────────────────────────────────────────

async function logAudit(action, entityType, entityId, entityName, details = {}, mcpUser = null) {
  try {
    const { AuditLog } = getModels();
    await AuditLog.create({
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      actor_id: mcpUser?.id || null,
      actor_name: mcpUser?.name || 'MCP Client',
      details,
      ip_address: '127.0.0.1',
    });
  } catch (e) {
    console.error('[MCP Audit] Failed to write log:', e.message);
  }
}

async function getValidUserId(mcpUser) {
  let userId = mcpUser?.id || null;
  if (!userId || userId === 0) {
    const { User } = getModels();
    const firstUser = await User.findOne({ where: { role: 'admin' } }) || await User.findOne();
    userId = firstUser ? firstUser.id : 1;
  }
  return userId;
}

// ─── Permission & Module Gating ──────────────────────────────────────────────

const TOOL_GATES = {
  // --- Assets & CVEs ---
  'isms_create_asset': { perm: ['assets', 'create'], needsWrite: true },
  'isms_update_asset': { perm: ['assets', 'edit_basics'], needsWrite: true },
  'isms_delete_asset': { perm: ['assets', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_refresh_asset_cves': { perm: ['assets', 'cve'], needsWrite: true },
  'isms_refresh_all_asset_cves': { perm: ['assets', 'cve'], requiredRoles: ['admin', 'it-staff'] },
  'isms_suggest_cpe': { perm: ['assets', 'cve'], moduleKey: 'discovery' },
  'isms_resolve_cpe': { perm: ['assets', 'cve'], moduleKey: 'discovery', needsWrite: true },
  'isms_create_assessment': { perm: ['assessments', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Drittsystem-Anbindungen ---
  // Lesen darf, wer das Inventar bewertet; ausloesen nur Admin/IT. Die
  // Konfiguration inkl. Secret bleibt der Weboberflaeche vorbehalten und ist
  // bewusst NICHT ueber MCP aenderbar.
  'isms_checkmk_status': { perm: ['integrations', 'view'], requiredRoles: ['admin', 'it-staff', 'assessor'] },
  'isms_checkmk_hosts': { perm: ['integrations', 'view'], requiredRoles: ['admin', 'it-staff', 'assessor'] },
  'isms_checkmk_sync': { perm: ['integrations', 'sync'], requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  // --- Risks & Threats ---
  'isms_create_risk': { perm: ['risks', 'create'], needsWrite: true },
  'isms_update_risk': { perm: ['risks', 'edit'], needsWrite: true },
  'isms_signoff_risk': { perm: ['risks', 'sign_off'], requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_revoke_risk_signoff': { perm: ['risks', 'sign_off'], requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_delete_risk': { perm: ['risks', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_threat': { perm: ['threats', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Management Reviews ---
  'isms_create_review_signoff': { perm: ['review', 'sign_off'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Incidents ---
  'isms_create_incident': { perm: ['incidents', 'create'], needsWrite: true },
  'isms_update_incident_status': { perm: ['incidents', 'edit'], needsWrite: true },
  'isms_update_incident': { perm: ['incidents', 'edit'], needsWrite: true },
  'isms_delete_incident': { perm: ['incidents', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  // --- Tasks & Reminders ---
  'isms_create_task': { perm: ['tasks', 'create'], needsWrite: true },
  'isms_update_task': { perm: ['tasks', 'edit'], needsWrite: true },
  'isms_complete_task': { perm: ['tasks', 'edit'], needsWrite: true },
  'isms_delete_task': { perm: ['tasks', 'delete'], needsWrite: true },
  'isms_acknowledge_reminder': { perm: ['reminders', 'acknowledge'], needsWrite: true },
  'isms_dismiss_reminder': { perm: ['reminders', 'acknowledge'], needsWrite: true },
  // --- Controls ---
  'isms_create_control': { perm: ['controls', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_control_status': { perm: ['controls', 'edit'], needsWrite: true },
  'isms_update_control': { perm: ['controls', 'edit'], needsWrite: true },
  'isms_delete_control': { perm: ['controls', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Compliance Catalogs ---
  'isms_list_iso27001_controls': { perm: ['iso27001', 'view'], moduleKey: 'iso27001' },
  'isms_update_iso27001_control': { perm: ['iso27001', 'edit'], moduleKey: 'iso27001', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_list_bsi_requirements': { perm: ['bsi_grundschutz', 'view'], moduleKey: 'bsi_grundschutz' },
  'isms_update_bsi_requirement': { perm: ['bsi_grundschutz', 'edit'], moduleKey: 'bsi_grundschutz', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_list_nis2_measures': { perm: ['nis2', 'view'], moduleKey: 'nis2' },
  'isms_update_nis2_measure': { perm: ['nis2', 'edit'], moduleKey: 'nis2', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_list_c5_criteria': { perm: ['c5', 'view'], moduleKey: 'c5' },
  'isms_update_c5_criterion': { perm: ['c5', 'edit'], moduleKey: 'c5', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  'isms_list_tisax_requirements': { perm: ['tisax', 'view'], moduleKey: 'tisax' },
  'isms_update_tisax_requirement': { perm: ['tisax', 'edit'], moduleKey: 'tisax', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_list_tisax_assessments': { perm: ['tisax', 'view'], moduleKey: 'tisax' },
  'isms_create_tisax_assessment': { perm: ['tisax', 'create'], moduleKey: 'tisax', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_tisax_assessment': { perm: ['tisax', 'edit'], moduleKey: 'tisax', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_tisax_assessment': { perm: ['tisax', 'delete'], moduleKey: 'tisax', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Trainings ---
  'isms_create_training_course': { perm: ['compliance_trainings', 'create'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_training_course': { perm: ['compliance_trainings', 'edit'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_training_course': { perm: ['compliance_trainings', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_record_user_training': { perm: ['compliance_trainings', 'create'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_user_training': { perm: ['compliance_trainings', 'edit'], requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_user_training': { perm: ['compliance_trainings', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Audit Logs ---
  'isms_list_audit_logs': { perm: ['auditlog', 'view'], requiredRoles: ['admin', 'assessor'] },
  'isms_verify_audit_logs': { perm: ['auditlog', 'verify'], requiredRoles: ['admin'] },
  // --- Legal Requirements ---
  'isms_create_legal_requirement': { perm: ['legal_requirements', 'create'], needsWrite: true },
  'isms_update_legal_requirement': { perm: ['legal_requirements', 'edit'], needsWrite: true },
  'isms_delete_legal_requirement': { perm: ['legal_requirements', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- EU AI Act ---
  'isms_list_ai_systems': { perm: ['ai_act', 'view'], moduleKey: 'ai_act' },
  'isms_create_ai_system': { perm: ['ai_act', 'create'], moduleKey: 'ai_act', needsWrite: true },
  'isms_update_ai_system': { perm: ['ai_act', 'edit'], moduleKey: 'ai_act', needsWrite: true },
  'isms_delete_ai_system': { perm: ['ai_act', 'delete'], moduleKey: 'ai_act', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Policies & Templates ---
  'isms_create_policy': { perm: ['policies', 'create'], requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_update_policy': { perm: ['policies', 'edit'], requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_delete_policy': { perm: ['policies', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_acknowledge_policy': { needsWrite: true },
  'isms_delete_template': { perm: ['templates', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Audits, CAPA & KPIs ---
  'isms_create_audit': { perm: ['compliance_audits', 'create'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_audit': { perm: ['compliance_audits', 'edit'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_audit': { perm: ['compliance_audits', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_audit_finding': { perm: ['compliance_audits', 'create_findings'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_audit_finding': { perm: ['compliance_audits', 'edit_findings'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_audit_finding': { perm: ['compliance_audits', 'delete_findings'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_create_kpi': { perm: ['compliance_kpis', 'create'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_kpi': { perm: ['compliance_kpis', 'edit'], requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_kpi': { perm: ['compliance_kpis', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_record_kpi_measurement': { perm: ['compliance_kpis', 'measure'], needsWrite: true },
  // --- Settings & Admin ---
  'isms_set_feature_status': { perm: ['modules', 'edit'], requiredRoles: ['admin'] },
  'isms_get_settings': { perm: ['admin', 'settings'], requiredRoles: ['admin'] },
  'isms_update_settings': { perm: ['admin', 'settings'], requiredRoles: ['admin'], needsWrite: true },
  'isms_get_permissions': { perm: ['admin', 'permissions'], requiredRoles: ['admin'] },
  'isms_update_permissions': { perm: ['admin', 'permissions'], requiredRoles: ['admin'], needsWrite: true },
  'isms_list_custom_roles': { perm: ['admin', 'roles'], requiredRoles: ['admin'] },
  'isms_create_custom_role': { perm: ['admin', 'roles'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_custom_role': { perm: ['admin', 'roles'], requiredRoles: ['admin'], needsWrite: true },
  'isms_delete_custom_role': { perm: ['admin', 'roles'], requiredRoles: ['admin'], needsWrite: true },
  'isms_run_automation': { perm: ['admin', 'maintenance'], requiredRoles: ['admin'], needsWrite: true },
  // --- Users, Groups & Tokens ---
  'isms_create_user': { perm: ['users', 'create'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_user': { perm: ['users', 'edit'], requiredRoles: ['admin'], needsWrite: true },
  'isms_delete_user': { perm: ['users', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_group': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_update_group': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_delete_group': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_add_group_member': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_remove_group_member': { perm: ['groups', 'manage'], requiredRoles: ['admin'], needsWrite: true },
  'isms_create_api_token': { perm: ['tokens', 'create'], needsWrite: true },
  'isms_revoke_api_token': { perm: ['tokens', 'delete'], needsWrite: true },
  // --- Pentests ---
  'isms_list_pentests': { perm: ['pentests', 'view'], moduleKey: 'pentest' },
  'isms_create_pentest': { perm: ['pentests', 'create'], moduleKey: 'pentest', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_pentest': { perm: ['pentests', 'edit'], moduleKey: 'pentest', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_pentest': { perm: ['pentests', 'delete'], moduleKey: 'pentest', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_pentest_findings': { perm: ['pentests', 'view'], moduleKey: 'pentest' },
  'isms_create_pentest_finding': { perm: ['pentests', 'create'], moduleKey: 'pentest', needsWrite: true },
  'isms_update_pentest_finding': { perm: ['pentests', 'edit'], moduleKey: 'pentest', needsWrite: true },
  'isms_delete_pentest_finding': { perm: ['pentests', 'delete_findings'], moduleKey: 'pentest', requiredRoles: ['admin', 'assessor', 'it-staff'], needsWrite: true },
  // --- GDPR / DSGVO ---
  'isms_list_vvt_entries': { perm: ['vvt', 'view'], moduleKey: 'dsgvo' },
  'isms_get_vvt_entry': { perm: ['vvt', 'view_details'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'] },
  'isms_create_vvt_entry': { perm: ['vvt', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_vvt_entry': { perm: ['vvt', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_vvt_entry': { perm: ['vvt', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin'], needsWrite: true },
  'isms_get_vvt_dsfa': { perm: ['vvt', 'view_details'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'] },
  'isms_create_vvt_dsfa': { perm: ['vvt', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_update_vvt_dsfa': { perm: ['vvt', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_delete_vvt_dsfa': { perm: ['vvt', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin'], needsWrite: true },
  'isms_list_dataflows': { perm: ['dataflows', 'view'], moduleKey: 'dsgvo' },
  'isms_get_dataflow': { perm: ['dataflows', 'view_details'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'] },
  'isms_create_dataflow': { perm: ['dataflows', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_dataflow': { perm: ['dataflows', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_dataflow': { perm: ['dataflows', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin'], needsWrite: true },
  'isms_list_subject_requests': { perm: ['subject_requests', 'view'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo', 'assessor'] },
  'isms_create_subject_request': { perm: ['subject_requests', 'create'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  'isms_update_subject_request_status': { perm: ['subject_requests', 'edit'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  'isms_delete_subject_request': { perm: ['subject_requests', 'delete'], moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  // --- Vendors ---
  'isms_get_vendor': { perm: ['vendors', 'view_details'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_create_vendor': { perm: ['vendors', 'create'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_vendor': { perm: ['vendors', 'edit'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_vendor': { perm: ['vendors', 'delete'], requiredRoles: ['admin'], needsWrite: true },
  'isms_assess_vendor': { perm: ['vendors', 'assess'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_add_vendor_contact': { perm: ['vendors', 'contacts'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_vendor_contact': { perm: ['vendors', 'contacts'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_vendor_contact': { perm: ['vendors', 'contacts'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_list_vendor_triage_runs': { perm: ['vendor_triage', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_get_vendor_triage_run': { perm: ['vendor_triage', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_run_vendor_triage': { perm: ['vendor_triage', 'run'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_get_triage_profiles': { perm: ['triage_profiles', 'view'], requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'] },
  'isms_update_triage_profiles': { perm: ['triage_profiles', 'edit'], requiredRoles: ['admin'], needsWrite: true },
  // --- BCM ---
  'isms_list_bcm_processes': { perm: ['bcm', 'view'], moduleKey: 'bcm' },
  'isms_create_bcm_process': { perm: ['bcm', 'create'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_bcm_process': { perm: ['bcm', 'edit'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_bcm_process': { perm: ['bcm', 'delete'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_bcm_exercises': { perm: ['bcm', 'view'], moduleKey: 'bcm' },
  'isms_create_bcm_exercise': { perm: ['bcm', 'create'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_bcm_exercise': { perm: ['bcm', 'edit'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_delete_bcm_exercise': { perm: ['bcm', 'delete'], moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- DORA ---
  'isms_list_dora_third_parties': { perm: ['dora', 'view'], moduleKey: 'dora' },
  'isms_create_dora_third_party': { perm: ['dora', 'create'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_dora_third_party': { perm: ['dora', 'edit'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_dora_third_party': { perm: ['dora', 'delete'], moduleKey: 'dora', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_dora_tests': { perm: ['dora', 'view'], moduleKey: 'dora' },
  'isms_create_dora_test': { perm: ['dora', 'create'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_update_dora_test': { perm: ['dora', 'edit'], moduleKey: 'dora', requiredRoles: ['admin', 'owner', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_delete_dora_test': { perm: ['dora', 'delete'], moduleKey: 'dora', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  // --- Auto-Discovery ---
  'isms_list_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'] },
  'isms_approve_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  'isms_ignore_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  'isms_delete_discovered_software': { perm: ['discovery', 'access'], moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  // --- Comments & Documents ---
  'isms_add_asset_comment': { perm: ['comments', 'create'], needsWrite: true },
  'isms_delete_asset_comment': { perm: ['comments', 'delete'], needsWrite: true },
  'isms_delete_document': { perm: ['documents', 'delete'], requiredRoles: ['admin', 'assessor'], needsWrite: true },

  // Read-only tools that had no gate at all: any authenticated MCP client could
  // call them. They carry no role requirement here either — the matrix decides,
  // and where it says nothing they stay open, exactly as before.
  'isms_get_asset': { perm: ['assets', 'view'] },
  'isms_get_asset_cve_report': { perm: ['assets', 'view'] },
  'isms_get_central_cve_report': { perm: ['assets', 'cve'] },
  'isms_get_compliance_overview': { perm: ['compliance', 'view'] },
  'isms_get_dashboard': { perm: ['dashboard', 'view'] },
  'isms_get_framework_mapping_overview': { perm: ['mappings', 'view'] },
  'isms_get_framework_mapping_stats': { perm: ['mappings', 'view'] },
  'isms_get_group': { perm: ['groups', 'view'] },
  'isms_get_management_report': { perm: ['reports', 'view'] },
  'isms_get_policy': { perm: ['policies', 'view'] },
  'isms_get_policy_acknowledgments': { perm: ['policies', 'acknowledgments'] },
  'isms_get_review_signoffs': { perm: ['review', 'view'] },
  'isms_get_risk': { perm: ['risks', 'view'] },
  'isms_get_task': { perm: ['tasks', 'view'] },
  'isms_get_task_stats': { perm: ['tasks', 'view'] },
  'isms_list_api_tokens': { perm: ['tokens', 'view'] },
  'isms_list_assessments': { perm: ['assessments', 'view'] },
  'isms_list_asset_comments': { perm: ['comments', 'view'] },
  'isms_list_assets': { perm: ['assets', 'view'] },
  'isms_list_audits': { perm: ['compliance_audits', 'view'] },
  'isms_list_controls': { perm: ['controls', 'view'] },
  'isms_list_documents': { perm: ['documents', 'view'] },
  'isms_list_features': { perm: ['modules', 'view'] },
  'isms_list_groups': { perm: ['groups', 'view'] },
  'isms_list_incidents': { perm: ['incidents', 'view'] },
  'isms_list_kpis': { perm: ['compliance_kpis', 'view'] },
  'isms_list_legal_requirements': { perm: ['legal_requirements', 'view'] },
  'isms_list_policies': { perm: ['policies', 'view'] },
  'isms_list_reminders': { perm: ['reminders', 'view'] },
  'isms_list_risks': { perm: ['risks', 'view'] },
  'isms_list_tasks': { perm: ['tasks', 'view'] },
  'isms_list_templates': { perm: ['templates', 'view'] },
  'isms_list_threats': { perm: ['threats', 'view'] },
  'isms_list_training_courses': { perm: ['compliance_trainings', 'view'] },
  'isms_list_user_trainings': { perm: ['compliance_trainings', 'view'] },
  'isms_list_users': { perm: ['users', 'view'] },
  'isms_list_vendors': { perm: ['vendors', 'view'] },
  'isms_lookup_framework_mappings': { perm: ['mappings', 'view'] },
};

async function gateTool(mcpUser, moduleKey = null, requiredRoles = null, needsWrite = false, perm = null) {
  if (moduleKey) {
    const { getModules } = require('../middleware/modules');
    const modules = await getModules();
    if (!modules[moduleKey]) {
      return { content: [{ type: 'text', text: `Zugriff verweigert: Das Modul '${moduleKey}' ist im ISMS nicht aktiviert.` }], isError: true };
    }
  }

  const role = mcpUser?.role || 'viewer';

  // The permission matrix decides where it has something to say about this
  // tool's module+action — the same contract requirePermission applies to the
  // REST API, so an admin who edits the matrix (or writes a custom role) sees
  // the change here too. Until this existed, MCP answered only to the
  // hardcoded role lists below and quietly ignored both.
  if (perm) {
    try {
      const { can } = require('../services/permissionService');
      const verdict = await can(mcpUser, perm[0], perm[1]);
      if (verdict === false) {
        return { content: [{ type: 'text', text: `Zugriff verweigert: Die Berechtigung '${perm[0]}.${perm[1]}' fehlt für Ihre Rolle.` }], isError: true };
      }
      if (verdict === true) {
        // Matrix grants it. needsWrite still applies: it mirrors requireWriteAccess(),
        // which sits next to requirePermission on the REST side rather than inside it.
        if (needsWrite && ['viewer', 'management', 'employee'].includes(role)) {
          return { content: [{ type: 'text', text: 'Zugriff verweigert: Schreibrechte erforderlich.' }], isError: true };
        }
        return null;
      }
    } catch (e) {
      // Never fail open — a broken matrix lookup must not hand out access.
      console.error('[MCP] Permission check failed:', e.message);
      return { content: [{ type: 'text', text: 'Berechtigungsprüfung fehlgeschlagen.' }], isError: true };
    }
  }

  if (requiredRoles && !requiredRoles.includes(role)) {
    return { content: [{ type: 'text', text: `Zugriff verweigert: Diese Aktion erfordert eine der folgenden Rollen: ${requiredRoles.join(', ')}.` }], isError: true };
  }

  if (needsWrite && ['viewer', 'management', 'employee'].includes(role)) {
    return { content: [{ type: 'text', text: 'Zugriff verweigert: Schreibrechte erforderlich.' }], isError: true };
  }

  return null;
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const toolsToRegister = [];
const server = {
  tool: (name, description, schemaOrCallback, maybeCallback) => {
    let schema = null;
    let originalCallback = null;

    if (typeof schemaOrCallback === 'function') {
      originalCallback = schemaOrCallback;
    } else {
      schema = schemaOrCallback;
      originalCallback = maybeCallback;
    }

    const wrappedCallback = async (args, context) => {
      const mcpUser = context?.mcpUser || context?._mcpUser || context?.authInfo;
      const ctx = { ...context, mcpUser };
      const gate = TOOL_GATES[name];
      if (gate) {
        const errorResult = await gateTool(
          mcpUser,
          gate.moduleKey || null,
          gate.requiredRoles || null,
          gate.needsWrite || false,
          gate.perm || null
        );
        if (errorResult) return errorResult;
      }
      return originalCallback(args, ctx);
    };

    if (schema) {
      toolsToRegister.push([name, description, schema, wrappedCallback]);
    } else {
      toolsToRegister.push([name, description, wrappedCallback]);
    }
  }
};

// ─── Assets ──────────────────────────────────────────────────────────────────

server.tool(
  'isms_list_assets',
  'List assets from the ISMS asset register. Returns id, name, type, classification, status, hosting_type, lifecycle_status, patch_status, nis2_relevant.',
  {
    search:         z.string().optional().describe('Search in name'),
    type:           z.string().optional().describe('Filter by type (hardware, software, application, service, data, process, personal, ai_application, ai_agent, other)'),
    status:         z.string().optional().describe('Filter by status (active, inactive, decommissioned, all). Defaults to active and inactive (non-decommissioned) assets.'),
    classification: z.string().optional().describe('Filter by classification (public, internal, confidential, secret)'),
    limit:          z.number().int().min(1).max(500).default(50).describe('Max results'),
  },
  async ({ search, type, status, classification, limit }) => {
    const { Asset } = getModels();
    const where = {};
    if (type) where.type = type;
    if (status) {
      if (status !== 'all') where.status = status;
    } else {
      where.status = { [Op.ne]: 'decommissioned' };
    }
    if (classification) where.classification = classification;
    if (search) where.name = { [Op.like]: `%${search}%` };

    const assets = await Asset.findAll({
      where, limit,
      order: [['name', 'ASC']],
      attributes: ['id','name','type','classification','status','hosting_type','lifecycle_status','patch_status','nis2_relevant','rto','rpo','sdo','mto','ioa','cve_critical','cve_high','created_at'],
    });
    return { content: [{ type: 'text', text: JSON.stringify(assets, null, 2) }] };
  }
);

server.tool(
  'isms_get_asset',
  'Get full details of a single asset including its latest CIA assessment, linked risks, incidents, and compliance frameworks.',
  { id: z.number().int().describe('Asset ID') },
  async ({ id }) => {
    const { Asset, Assessment, Risk, Incident, User } = getModels();
    const asset = await Asset.findByPk(id, {
      include: [
        { model: Assessment, as: 'Assessments', limit: 1, order: [['created_at', 'DESC']] },
        { model: User, as: 'owner', attributes: ['id','name','email'] },
        { model: User, as: 'assessor', attributes: ['id','name','email'] },
      ],
    });
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
  }
);

server.tool(
  'isms_create_asset',
  'Create a new asset in the ISMS asset register.',
  {
    name:           z.string().min(1).describe('Asset name'),
    type:           z.enum(['hardware','software','application','service','data','process','personal','ai_application','ai_agent','other']).describe('Asset type'),
    classification: z.enum(['public','internal','confidential','secret']).default('internal'),
    description:    z.string().optional(),
    hosting_type:   z.enum(['on-premise','cloud_public','cloud_private','hybrid']).optional(),
    lifecycle_status: z.enum(['evaluation','production','maintenance','archived']).default('production'),
    nis2_relevant:  z.boolean().default(false),
    owner_id:       z.number().int().optional().describe('User ID of the asset owner. Defaults to the calling MCP user.'),
    assessor_id:    z.number().int().optional().describe('User ID of the assessor. Defaults to the calling MCP user.'),
    rto:            z.string().optional().describe('Recovery Time Objective (Wiederanlaufzeit, e.g. 4h)'),
    rpo:            z.string().optional().describe('Recovery Point Objective (Datenverlust-Toleranz, e.g. 1h)'),
    sdo:            z.string().optional().describe('Service Delivery Objective (Mindest-Service-Level im Notbetrieb, e.g. 24h)'),
    mto:            z.string().optional().describe('Maximum Tolerable Outage (Maximal tolerierbare Ausfallzeit, e.g. 48h)'),
    ioa:            z.string().optional().describe('Impact of Activity / Disruption (Ausfallwirkung, e.g. High)'),
    // Felder, die das Modell laengst kennt, hier aber bislang fehlten. Ohne sie
    // konnte ein Import Standort, Version oder Hersteller nicht mitgeben und
    // musste sie in die Beschreibung schreiben.
    location:       z.string().optional().describe('Physical or logical location (e.g. rack, site, IP)'),
    version:        z.string().optional(),
    vendor:         z.string().optional().describe('Vendor/manufacturer name (free text)'),
    tags:           z.array(z.string()).optional(),
    patch_status:   z.enum(['up-to-date','pending','critical']).optional(),
    eol_date:       z.string().optional().describe('End-of-life date (YYYY-MM-DD)'),
    external_source: z.string().optional().describe("Third-party system this asset came from, e.g. 'checkmk'"),
    external_id:    z.string().optional().describe('Identifier of this asset in the third-party system (e.g. CheckMK hostname)'),
  },
  async (args, { mcpUser }) => {
    const { Asset } = getModels();

    // owner_id und assessor_id sind im Modell NOT NULL. Sie waren hier bislang
    // optional bzw. gar nicht vorhanden, wodurch jeder Aufruf an der
    // Datenbank-Constraint scheiterte — das Tool war nie funktionsfaehig.
    // getValidUserId() faellt auf den aufrufenden MCP-Benutzer und sonst auf
    // einen Admin zurueck, so wie isms_create_assessment es bereits tut.
    const fallbackUserId = await getValidUserId(mcpUser);

    const asset = await Asset.create({
      ...args,
      owner_id: args.owner_id || fallbackUserId,
      assessor_id: args.assessor_id || fallbackUserId,
      status: 'active',
    });

    // Schreibende MCP-Aufrufe gehoerten schon immer ins Audit-Log; hier fehlte
    // der Eintrag. Ein Asset, dessen Entstehung nicht protokolliert ist, ist
    // fuer eine Nachweisfuehrung wertlos.
    await logAudit('create', 'Asset', asset.id, asset.name, {
      type: asset.type,
      classification: asset.classification,
      via: 'mcp',
      external_source: asset.external_source || null,
    }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
  }
);

// ─── Drittsystem-Anbindung: CheckMK ──────────────────────────────────────────

server.tool(
  'isms_checkmk_status',
  'Show the CheckMK integration configuration (without the secret) and the result of the last sync run.',
  {},
  async () => {
    const { getCheckmkPublic } = require('../services/settingsService');
    return { content: [{ type: 'text', text: JSON.stringify(await getCheckmkPublic(), null, 2) }] };
  }
);

server.tool(
  'isms_checkmk_hosts',
  'Fetch the live host list from CheckMK (name, IP, state, plugin output). Read-only, writes nothing to the ISMS.',
  {},
  async () => {
    const { getCheckmkConfig } = require('../services/settingsService');
    const { fetchHosts } = require('../services/checkmkService');
    const cfg = await getCheckmkConfig();
    if (!cfg.url || !cfg.secret) {
      return { content: [{ type: 'text', text: 'CheckMK integration is not configured.' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(await fetchHosts(cfg), null, 2) }] };
  }
);

server.tool(
  'isms_checkmk_sync',
  'Reconcile the ISMS asset register against CheckMK. Linked assets get fresh live status; unknown hosts land in the discovery staging area as pending — assets are never created automatically, approval stays a human decision. Use dry_run first.',
  {
    dry_run: z.boolean().optional().default(true).describe('true (default) reports what would change without writing anything'),
  },
  async ({ dry_run }, { mcpUser }) => {
    const { getCheckmkConfig, setCheckmk } = require('../services/settingsService');
    const { syncFromCheckmk } = require('../services/checkmkSyncService');

    const cfg = await getCheckmkConfig();
    if (!cfg.url || !cfg.secret) {
      return { content: [{ type: 'text', text: 'CheckMK integration is not configured.' }], isError: true };
    }
    if (!cfg.enabled) {
      return { content: [{ type: 'text', text: 'CheckMK integration is disabled. Enable it before syncing.' }], isError: true };
    }

    const result = await syncFromCheckmk({ cfg, dryRun: dry_run });

    // Ein Probelauf setzt keinen Sync-Stand — sonst behauptet die Anzeige eine
    // Aktualitaet, die nie geschrieben wurde.
    if (!dry_run) {
      await setCheckmk({
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

    await logAudit(dry_run ? 'read' : 'update', 'Integration', null, 'CheckMK', {
      action: dry_run ? 'sync_dry_run' : 'sync',
      hosts_seen: result.hosts_seen,
      assets_updated: result.assets_updated,
      staging_created: result.staging_created,
      assets_missing: result.assets_missing,
      via: 'mcp',
    }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── CVE Reports ─────────────────────────────────────────────────────────────

server.tool(
  'isms_get_asset_cve_report',
  'Get the CVE vulnerability report for a single asset, optionally refreshing it from external sources.',
  {
    id:      z.number().int().describe('Asset ID'),
    refresh: z.boolean().optional().default(false).describe('Trigger a real-time refresh from NVD/Shodan APIs'),
  },
  async ({ id, refresh }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    if (refresh) {
      const { fetchCVEsForAsset } = require('../services/cveService');
      const result = await fetchCVEsForAsset(asset);
      if (result) {
        await asset.update({
          cve_critical: result.counts.critical,
          cve_high:     result.counts.high,
          cve_medium:   result.counts.medium,
          cve_low:      result.counts.low,
          cve_ids:      result.cveList,
          cve_last_checked: new Date(),
        });
      }
    }

    let cves = [];
    if (asset.cve_ids) {
      try {
        cves = typeof asset.cve_ids === 'string' ? JSON.parse(asset.cve_ids) : asset.cve_ids;
      } catch (e) {
        cves = [];
      }
    }

    const report = {
      asset_id: asset.id,
      asset_name: asset.name,
      cpe: asset.cpe,
      cpe_title: asset.cpe_title,
      cve_last_checked: asset.cve_last_checked,
      counts: {
        critical: asset.cve_critical,
        high: asset.cve_high,
        medium: asset.cve_medium,
        low: asset.cve_low,
      },
      cves: cves
    };

    return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
  }
);

server.tool(
  'isms_get_central_cve_report',
  'Get a central CVE report aggregated across all non-decommissioned assets, showing unique CVEs and their affected assets.',
  {
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional().describe('Filter CVEs by severity'),
    limit:    z.number().int().min(1).max(500).default(50).describe('Max results'),
  },
  async ({ severity, limit }) => {
    const { Asset } = getModels();
    const assets = await Asset.findAll({
      attributes: ['id', 'name', 'cve_ids'],
      where: {
        status: { [Op.ne]: 'decommissioned' }
      }
    });

    const cveMap = {};
    for (const asset of assets) {
      let cves = [];
      if (asset.cve_ids) {
        try {
          cves = typeof asset.cve_ids === 'string' ? JSON.parse(asset.cve_ids) : asset.cve_ids;
        } catch (e) {
          cves = [];
        }
      }
      if (Array.isArray(cves)) {
        for (const cve of cves) {
          if (!cve.id) continue;
          const cveSeverity = cve.severity || 'none';
          if (severity && cveSeverity !== severity) continue;

          if (!cveMap[cve.id]) {
            cveMap[cve.id] = {
              id: cve.id,
              score: Number(cve.score) || 0,
              severity: cveSeverity,
              description: cve.description || '',
              published: cve.published || '',
              source: cve.source || '',
              assets: []
            };
          }
          if (!cveMap[cve.id].assets.some(a => a.id === asset.id)) {
            cveMap[cve.id].assets.push({ id: asset.id, name: asset.name });
          }
        }
      }
    }

    const cveList = Object.values(cveMap);
    cveList.sort((a, b) => b.score - a.score);
    const resultList = cveList.slice(0, limit);

    return { content: [{ type: 'text', text: JSON.stringify(resultList, null, 2) }] };
  }
);

server.tool(
  'isms_update_asset',
  'Update details of an existing asset in the ISMS asset register.',
  {
    id:             z.number().int().describe('Asset ID'),
    name:           z.string().optional().describe('Asset name'),
    type:           z.enum(['hardware','software','application','service','data','process','personal','ai_application','ai_agent','other']).optional().describe('Asset type'),
    classification: z.enum(['public','internal','confidential','secret']).optional().describe('Classification level'),
    description:    z.string().optional().describe('Detailed description'),
    hosting_type:   z.enum(['on-premise','cloud_public','cloud_private','hybrid']).optional(),
    lifecycle_status: z.enum(['evaluation','production','maintenance','archived']).optional(),
    nis2_relevant:  z.boolean().optional(),
    owner_id:       z.number().int().optional().describe('User ID of the asset owner'),
    assessor_id:    z.number().int().optional().describe('User ID of the risk assessor'),
    patch_status:   z.enum(['up-to-date','pending','critical']).optional(),
    rto:            z.string().optional().describe('Recovery Time Objective (Wiederanlaufzeit, e.g. 4h)'),
    rpo:            z.string().optional().describe('Recovery Point Objective (Datenverlust-Toleranz, e.g. 1h)'),
    sdo:            z.string().optional().describe('Service Delivery Objective (Mindest-Service-Level im Notbetrieb, e.g. 24h)'),
    mto:            z.string().optional().describe('Maximum Tolerable Outage (Maximal tolerierbare Ausfallzeit, e.g. 48h)'),
    ioa:            z.string().optional().describe('Impact of Activity / Disruption (Ausfallwirkung, e.g. High)'),
    location:       z.string().optional().describe('Physical or logical location (e.g. rack, site, IP)'),
    version:        z.string().optional(),
    vendor:         z.string().optional().describe('Vendor/manufacturer name (free text)'),
    // Verknuepfung zu einem Drittsystem. isms_create_asset kennt diese Felder
    // bereits, das Update-Tool nicht — dadurch liess sich ein BESTEHENDES
    // Asset nicht nachtraeglich an eine Quelle binden. Folge: der CheckMK-Sync
    // schlug es bei jedem Lauf erneut als unbekannt vor und haette beim
    // Freigeben eine Dublette erzeugt. Betroffen waren vier Geraete, die
    // laengst im Register standen.
    external_source: z.string().optional().describe("Third-party system this asset is linked to, e.g. 'checkmk'"),
    external_id:    z.string().optional().describe('Identifier in the third-party system (e.g. CheckMK hostname)'),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    // Eine frisch gesetzte Verknuepfung gilt ab jetzt als bestaetigt. Ohne
    // diesen Zeitstempel behandelt der naechste Sync-Lauf das Asset als
    // "seit jeher nicht gemeldet" und markiert es faelschlich als MISSING.
    if (updates.external_id && !asset.external_last_seen_at) {
      updates.external_last_seen_at = new Date();
    }

    if (updates.lifecycle_status === 'archived') {
      updates.status = 'inactive';
    } else if (updates.lifecycle_status && ['production', 'maintenance', 'evaluation'].includes(updates.lifecycle_status)) {
      if (asset.status === 'inactive') updates.status = 'active';
    }

    await asset.update(updates);

    // Wie zuvor bei isms_create_asset fehlte hier der Audit-Eintrag. Eine
    // nachtraegliche Aenderung an einem bestehenden Asset muss nachvollziehbar
    // sein — wer wann welches Feld angefasst hat.
    await logAudit('update', 'Asset', asset.id, asset.name, {
      fields: Object.keys(updates),
      via: 'mcp',
    }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
  }
);

server.tool(
  'isms_refresh_asset_cves',
  'Trigger a real-time CVE vulnerability refresh from external APIs for a specific asset.',
  {
    id: z.number().int().describe('Asset ID'),
  },
  async ({ id }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    const { fetchCVEsForAsset } = require('../services/cveService');
    const result = await fetchCVEsForAsset(asset);
    if (!result) {
      return { content: [{ type: 'text', text: 'No search parameters found for asset (e.g. type, vendor, version, package_name, cpe)' }], isError: true };
    }

    await asset.update({
      cve_critical: result.counts.critical,
      cve_high:     result.counts.high,
      cve_medium:   result.counts.medium,
      cve_low:      result.counts.low,
      cve_ids:      result.cveList,
      cve_last_checked: new Date(),
    });

    return { content: [{ type: 'text', text: JSON.stringify({ asset_id: asset.id, asset_name: asset.name, counts: result.counts, total: result.total, source: result.source }, null, 2) }] };
  }
);

server.tool(
  'isms_refresh_all_asset_cves',
  'Trigger a background/real-time CVE vulnerability refresh from external APIs for all non-decommissioned assets.',
  {},
  async () => {
    const { Asset } = getModels();
    const assets = await Asset.findAll({
      where: { status: { [Op.ne]: 'decommissioned' } }
    });

    const { fetchCVEsForAsset } = require('../services/cveService');
    let updatedCount = 0;
    let errorsCount = 0;

    for (const asset of assets) {
      try {
        const result = await fetchCVEsForAsset(asset);
        if (result) {
          await asset.update({
            cve_critical: result.counts.critical,
            cve_high:     result.counts.high,
            cve_medium:   result.counts.medium,
            cve_low:      result.counts.low,
            cve_ids:      result.cveList,
            cve_last_checked: new Date(),
          });
          updatedCount++;
        }
      } catch (e) {
        errorsCount++;
      }
    }

    return { content: [{ type: 'text', text: JSON.stringify({ message: 'CVE refresh completed', total_assets: assets.length, successfully_updated: updatedCount, failed_updates: errorsCount }, null, 2) }] };
  }
);

server.tool(
  'isms_suggest_cpe',
  'Get CPE 2.3 format suggestions from NVD for an asset or search query to enable accurate vulnerability matching.',
  {
    id:    z.number().int().optional().describe('Asset ID to look up suggestions for'),
    query: z.string().optional().describe('Search query string (e.g. "nginx", "apache tomcat", "postgresql")'),
  },
  async ({ id, query }) => {
    const { Asset } = getModels();
    const { suggestCPEsForAsset } = require('../services/cveService');
    let assetObj = null;
    if (id) {
      assetObj = await Asset.findByPk(id);
      if (!assetObj) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
    }
    
    let suggestions;
    if (query && query.trim().length >= 3) {
      suggestions = await suggestCPEsForAsset({ name: query.trim(), vendor: null });
    } else if (assetObj) {
      suggestions = await suggestCPEsForAsset(assetObj);
    } else {
      return { content: [{ type: 'text', text: 'Either asset id or search query (min 3 chars) is required.' }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ suggestions }, null, 2) }] };
  }
);

server.tool(
  'isms_resolve_cpe',
  'Resolve or assign a standardized CPE (Common Platform Enumeration) string to an asset for automated CVE scanning.',
  {
    id:    z.number().int().describe('Asset ID'),
    cpe:   z.string().optional().describe('Standardized CPE 2.3 identifier, e.g. "cpe:2.3:a:nginx:nginx"'),
    title: z.string().optional().describe('Human-readable product title, e.g. "Nginx"'),
  },
  async ({ id, cpe, title }, { mcpUser }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    if (cpe && title) {
      const cleanCpe = String(cpe).trim();
      const cleanTitle = String(title).trim();
      if (!cleanCpe.startsWith('cpe:2.3:')) {
        return { content: [{ type: 'text', text: 'Invalid CPE format. Must start with cpe:2.3:' }], isError: true };
      }
      await asset.update({ cpe: cleanCpe, cpe_title: cleanTitle, cpe_resolved_at: new Date() });
      await logAudit('update', 'asset', asset.id, asset.name, { action: 'set_cpe', cpe: cleanCpe, title: cleanTitle }, mcpUser);
      return { content: [{ type: 'text', text: JSON.stringify({ found: true, cpe: cleanCpe, title: cleanTitle }, null, 2) }] };
    }

    const { resolveCPEForAsset } = require('../services/cveService');
    const result = await resolveCPEForAsset(asset);
    if (!result) {
      return { content: [{ type: 'text', text: 'No matching CPE entry found in NVD. Please verify vendor/name or provide CPE manually.' }], isError: true };
    }

    await asset.update({ cpe: result.cpe, cpe_title: result.title, cpe_resolved_at: new Date() });
    await logAudit('update', 'asset', asset.id, asset.name, { action: 'auto_resolve_cpe', cpe: result.cpe, title: result.title }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ found: true, cpe: result.cpe, title: result.title }, null, 2) }] };
  }
);

server.tool(
  'isms_create_assessment',
  'Create a CIA (Confidentiality, Integrity, Availability) protection needs and risk assessment for an asset.',
  {
    asset_id:                z.number().int().describe('Asset ID to assess'),
    confidentiality:         z.enum(['low', 'medium', 'high', 'critical']).describe('Schutzbedarf Vertraulichkeit (C)'),
    integrity:               z.enum(['low', 'medium', 'high', 'critical']).describe('Schutzbedarf Integrität (I)'),
    availability:            z.enum(['low', 'medium', 'high', 'critical']).describe('Schutzbedarf Verfügbarkeit (A)'),
    notes:                   z.string().optional().describe('Assessment notes / justification'),
    mitigation:              z.string().optional().describe('Planned mitigation measures'),
    risk_treatment:          z.enum(['mitigate', 'accept', 'transfer', 'avoid']).optional().default('mitigate'),
    treatment_justification: z.string().optional(),
    accepted_by:             z.string().optional().describe('Name of manager accepting residual risk (if risk_treatment is accept)'),
    accepted_until:          z.string().optional().describe('ISO Date (YYYY-MM-DD) until acceptance is valid'),
  },
  async (args, { mcpUser }) => {
    const { Assessment, Asset, Reminder, Task } = getModels();
    const { checkAndManageAssetTasks } = require('../services/taskAutomationService');
    const asset = await Asset.findByPk(args.asset_id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    const { score, level } = Assessment.calculateRisk(args.confidentiality, args.integrity, args.availability);
    const assessed_at = new Date();
    const oneYearOut = new Date(assessed_at);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);

    const acceptedUntilDate = (args.risk_treatment === 'accept' && args.accepted_until && args.accepted_until !== 'Invalid date')
      ? new Date(args.accepted_until) : null;
    const next_review_at = (acceptedUntilDate && acceptedUntilDate < oneYearOut)
      ? acceptedUntilDate : oneYearOut;

    await Assessment.update({ is_current: false }, { where: { asset_id: args.asset_id, is_current: true } });

    const assessor_id = await getValidUserId(mcpUser);
    const assessment = await Assessment.create({
      asset_id: args.asset_id,
      assessor_id,
      confidentiality: args.confidentiality,
      integrity: args.integrity,
      availability: args.availability,
      risk_score: score,
      risk_level: level,
      notes: args.notes,
      mitigation: args.mitigation,
      risk_treatment: args.risk_treatment || null,
      treatment_justification: args.treatment_justification || null,
      accepted_by: args.risk_treatment === 'accept' ? (args.accepted_by || null) : null,
      accepted_until: acceptedUntilDate ? args.accepted_until : null,
      assessed_at,
      next_review_at,
      is_current: true,
    });

    await Reminder.destroy({ where: { asset_id: args.asset_id, status: 'pending' } });

    const isAcceptance = args.risk_treatment === 'accept' && acceptedUntilDate;
    const taskTitle = isAcceptance
      ? `Risikoakzeptanz läuft ab: ${asset.name}`
      : `Review fällig: ${asset.name}`;
    const taskDesc = isAcceptance
      ? `Die Risikoakzeptanz für Asset „${asset.name}" läuft am ${args.accepted_until} ab und muss erneuert oder das Risiko anders behandelt werden.`
      : `Regelmäßige Überprüfung der Schutzbedarfsfeststellung (Risikobewertung) für das Asset „${asset.name}".`;

    const task = await Task.create({
      title: taskTitle,
      description: taskDesc,
      priority: isAcceptance && level === 'critical' ? 'high' : 'medium',
      assigned_to_id: asset.assessor_id || assessor_id,
      due_date: next_review_at.toISOString().split('T')[0],
      related_type: 'asset',
      related_id: asset.id,
      tags: isAcceptance ? ['Risikoakzeptanz', 'Risiko'] : ['Review', 'Risiko'],
      created_by_id: assessor_id,
    });

    await Reminder.create({
      asset_id: args.asset_id,
      assessment_id: assessment.id,
      due_date: next_review_at.toISOString().split('T')[0],
      status: 'pending',
      task_id: task.id,
      notes: isAcceptance ? `Risikoakzeptanz von „${args.accepted_by || 'unbekannt'}" gültig bis ${args.accepted_until}` : null,
    });

    await logAudit('assess', 'assessment', assessment.id, asset.name, {
      asset_id: args.asset_id, risk_score: score, risk_level: level,
    }, mcpUser);

    await checkAndManageAssetTasks(asset);

    return { content: [{ type: 'text', text: JSON.stringify(assessment, null, 2) }] };
  }
);

server.tool(
  'isms_list_assessments',
  'List Schutzbedarfsfeststellungen / CIA assessments for assets.',
  {
    asset_id: z.number().int().optional().describe('Filter by asset ID'),
    limit:    z.number().int().min(1).max(200).default(50),
  },
  async ({ asset_id, limit }) => {
    const { Assessment, Asset, User } = getModels();
    const where = asset_id ? { asset_id } : {};
    const assessments = await Assessment.findAll({
      where, limit,
      include: [
        { model: Asset, attributes: ['id', 'name', 'type', 'classification'] },
        { model: User, as: 'assessorUser', attributes: ['id', 'name', 'email'] },
      ],
      order: [['assessed_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(assessments, null, 2) }] };
  }
);

server.tool(
  'isms_delete_asset',
  'Decommission / delete an asset from the active register.',
  {
    id: z.number().int().describe('Asset ID to decommission'),
  },
  async ({ id }, { mcpUser }) => {
    const { Asset } = getModels();
    const { checkAndManageAssetTasks } = require('../services/taskAutomationService');
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    await asset.update({ status: 'decommissioned' });
    await checkAndManageAssetTasks(asset);
    await logAudit('delete', 'asset', asset.id, asset.name, {}, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Asset "${asset.name}" (ID: ${asset.id}) marked as decommissioned.` }, null, 2) }] };
  }
);

// ─── Risks ───────────────────────────────────────────────────────────────────

server.tool(
  'isms_list_risks',
  'List risks from the risk register with optional filters.',
  {
    status:  z.enum(['open','in_treatment','accepted','closed']).optional(),
    level:   z.enum(['low','medium','high','critical']).optional().describe('Filter by residual risk level'),
    search:  z.string().optional().describe('Search in title/description'),
    limit:   z.number().int().min(1).max(200).default(50),
  },
  async ({ status, level, search, limit }) => {
    const { Risk, User } = getModels();
    const where = {};
    if (status) where.status = status;
    if (level) where.residual_level = level;
    if (search) where[Op.or] = [
      { title: { [Op.like]: `%${search}%` } },
      { description: { [Op.like]: `%${search}%` } },
    ];

    const risks = await Risk.findAll({
      where, limit,
      order: [['created_at', 'DESC']],
      include: [{ model: User, as: 'owner', attributes: ['id','name'] }],
    });
    return { content: [{ type: 'text', text: JSON.stringify(risks, null, 2) }] };
  }
);

server.tool(
  'isms_get_risk',
  'Get full details of a single risk including linked controls, threats, assets, and sign-off status.',
  {
    id: z.number().int().describe('Risk ID'),
  },
  async ({ id }) => {
    const { Risk, Asset, User, Threat, Control, Document, VvtEntry, Incident } = getModels();
    const risk = await Risk.findByPk(id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'acceptedBy', attributes: ['id', 'name', 'email'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
        { model: Threat, as: 'threats', attributes: ['id', 'code', 'title', 'source'], through: { attributes: [] } },
        { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework', 'status'], through: { attributes: ['effectiveness'] } },
        { model: Document, as: 'acceptanceDocument', attributes: ['id', 'original_name'] },
        { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
        { model: Incident, as: 'incidents', through: { attributes: [] } },
      ],
    });
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(risk, null, 2) }] };
  }
);

server.tool(
  'isms_create_risk',
  'Add a new risk to the risk register.',
  {
    title:                z.string().min(1),
    description:          z.string().optional(),
    category:             z.string().optional(),
    inherent_likelihood:  z.number().int().min(1).max(5),
    inherent_impact:      z.number().int().min(1).max(5),
    treatment:            z.enum(['mitigate','accept','transfer','avoid']).default('mitigate'),
    owner_id:             z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    const { Risk } = getModels();
    const score = args.inherent_likelihood * args.inherent_impact;
    const level = score <= 4 ? 'low' : score <= 9 ? 'medium' : score <= 16 ? 'high' : 'critical';
    const risk = await Risk.create({
      ...args,
      likelihood: args.inherent_likelihood,
      impact: args.inherent_impact,
      inherent_level: level,
      residual_likelihood: args.inherent_likelihood,
      residual_impact: args.inherent_impact,
      residual_level: level,
      status: 'open',
    });
    await logAudit('create', 'risk', risk.id, risk.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(risk, null, 2) }] };
  }
);

server.tool(
  'isms_update_risk',
  'Update an existing risk in the risk register including likelihood, impact, treatment, and linked controls/assets.',
  {
    id:             z.number().int().describe('Risk ID'),
    title:          z.string().optional(),
    description:    z.string().optional(),
    category:       z.string().optional(),
    owner_id:       z.number().int().optional(),
    likelihood:     z.number().int().min(1).max(5).optional(),
    impact:         z.number().int().min(1).max(5).optional(),
    treatment:      z.enum(['mitigate', 'accept', 'transfer', 'avoid']).optional(),
    treatment_plan: z.string().optional(),
    status:         z.enum(['open', 'in_treatment', 'accepted', 'closed']).optional(),
    review_date:    z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    asset_ids:      z.array(z.number().int()).optional().describe('Linked Asset IDs'),
    threat_ids:     z.array(z.number().int()).optional().describe('Linked Threat IDs'),
    vvt_ids:        z.array(z.number().int()).optional().describe('Linked VVT entry IDs'),
    incident_ids:   z.array(z.number().int()).optional().describe('Linked Incident IDs'),
    controls:       z.array(z.object({ id: z.number().int(), effectiveness: z.number().int().min(1).max(5).optional() })).optional().describe('Linked Controls with effectiveness (1-5)'),
  },
  async ({ id, asset_ids, threat_ids, vvt_ids, incident_ids, controls, ...updates }, { mcpUser }) => {
    const { Risk } = getModels();
    const { computeLevel } = require('../services/riskScale');
    const { computeResidual } = require('../services/residual');

    const risk = await Risk.findByPk(id);
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };

    const l = updates.likelihood !== undefined ? updates.likelihood : (risk.likelihood || risk.inherent_likelihood || 3);
    const i = updates.impact !== undefined ? updates.impact : (risk.impact || risk.inherent_impact || 3);
    const inherent_level = computeLevel(l, i);

    const f = {
      ...updates,
      likelihood: l,
      impact: i,
      inherent_likelihood: l,
      inherent_impact: i,
      inherent_level,
    };

    await risk.update(f);

    const ops = [];
    if (Array.isArray(asset_ids)) ops.push(risk.setAssets(asset_ids));
    if (Array.isArray(threat_ids)) ops.push(risk.setThreats(threat_ids));
    if (Array.isArray(vvt_ids)) ops.push(risk.setVvtEntries(vvt_ids));
    if (Array.isArray(incident_ids)) ops.push(risk.setIncidents(incident_ids));
    if (Array.isArray(controls)) {
      ops.push((async () => {
        await risk.setControls([]);
        await Promise.all(
          controls.filter(c => c && c.id).map(c =>
            risk.addControl(c.id, { through: { effectiveness: parseInt(c.effectiveness) || 3 } })
          )
        );
      })());
    }
    await Promise.all(ops);

    const riskControls = await risk.getControls({ joinTableAttributes: ['effectiveness'] });
    const links = riskControls.map(c => ({ effectiveness: c.RiskControl?.effectiveness, status: c.status }));
    const residual = computeResidual(l, i, links);
    await risk.update(residual);

    await logAudit('update', 'risk', risk.id, risk.title, updates, mcpUser);

    const updated = await Risk.findByPk(id, {
      include: [{ model: getModels().User, as: 'owner', attributes: ['id', 'name'] }],
    });
    return { content: [{ type: 'text', text: JSON.stringify(updated, null, 2) }] };
  }
);

server.tool(
  'isms_signoff_risk',
  'Digitally sign off and accept a risk (NIS-2 management sign-off).',
  {
    id:          z.number().int().describe('Risk ID'),
    valid_until: z.string().optional().describe('ISO Date (YYYY-MM-DD) until acceptance is valid'),
  },
  async ({ id, valid_until }, { mcpUser }) => {
    const { Risk } = getModels();
    const risk = await Risk.findByPk(id);
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };

    const accepted_by_id = await getValidUserId(mcpUser);
    await risk.update({
      status: 'accepted',
      accepted_by_id,
      accepted_at: new Date(),
      accepted_until: valid_until || null,
    });

    await logAudit('acknowledge', 'risk', risk.id, risk.title, { accepted_until: valid_until || null }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(risk, null, 2) }] };
  }
);

server.tool(
  'isms_revoke_risk_signoff',
  'Revoke a previous risk sign-off / acceptance, setting it back to in_treatment.',
  {
    id: z.number().int().describe('Risk ID'),
  },
  async ({ id }, { mcpUser }) => {
    const { Risk } = getModels();
    const risk = await Risk.findByPk(id);
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };

    await risk.update({
      status: 'in_treatment',
      accepted_by_id: null,
      accepted_at: null,
      accepted_until: null,
    });

    await logAudit('update', 'risk', risk.id, risk.title, { action: 'revoke_signoff' }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(risk, null, 2) }] };
  }
);

server.tool(
  'isms_delete_risk',
  'Delete a risk from the risk register and cancel related open tasks.',
  {
    id: z.number().int().describe('Risk ID to delete'),
  },
  async ({ id }, { mcpUser }) => {
    const { Risk, Task } = getModels();
    const risk = await Risk.findByPk(id);
    if (!risk) return { content: [{ type: 'text', text: 'Risk not found' }], isError: true };

    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'risk', related_id: risk.id, status: { [Op.in]: ['open', 'in_progress'] } } }
    );

    await logAudit('delete', 'risk', risk.id, risk.title, {}, mcpUser);
    await risk.destroy();

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Risk "${risk.title}" (ID: ${id}) deleted.` }, null, 2) }] };
  }
);

server.tool(
  'isms_list_threats',
  'List cybersecurity threats from the standardized threat catalog.',
  {
    search: z.string().optional().describe('Filter threats by code, title, or category'),
  },
  async ({ search }) => {
    const { Threat } = getModels();
    const where = {};
    if (search) {
      where[Op.or] = [
        { code: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
      ];
    }
    const threats = await Threat.findAll({ where, order: [['code', 'ASC']] });
    return { content: [{ type: 'text', text: JSON.stringify(threats, null, 2) }] };
  }
);

// ─── Incidents ───────────────────────────────────────────────────────────────

server.tool(
  'isms_list_incidents',
  'List security incidents. Returns ref, title, category, severity, status, nis2_reportable, detected_at.',
  {
    status:   z.string().optional().describe('Filter by status (reported, investigating, contained, resolved, closed)'),
    severity: z.string().optional().describe('Filter by severity (low, medium, high, critical)'),
    search:   z.string().optional(),
    limit:    z.number().int().min(1).max(200).default(50),
  },
  async ({ status, severity, search, limit }) => {
    const { Incident, User } = getModels();
    const where = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (search) where.title = { [Op.like]: `%${search}%` };

    const incidents = await Incident.findAll({
      where, limit,
      order: [['detected_at', 'DESC']],
      include: [{ model: User, as: 'assignee', attributes: ['id','name'] }],
    });
    return { content: [{ type: 'text', text: JSON.stringify(incidents, null, 2) }] };
  }
);

server.tool(
  'isms_create_incident',
  'Report a new security incident.',
  {
    title:         z.string().min(1),
    description:   z.string().optional(),
    category:      z.enum(['malware','phishing','data_breach','dos','unauthorized_access','misconfiguration','loss_theft','social_engineering','other']),
    severity:      z.enum(['low','medium','high','critical']),
    nis2_reportable: z.boolean().default(false),
    detected_at:   z.string().optional().describe('ISO 8601 datetime, defaults to now'),
    assignee_id:   z.number().int().optional(),
  },
  async (args) => {
    const { Incident } = getModels();
    const incident = await Incident.create({
      ...args,
      detected_at: args.detected_at || new Date(),
      status: 'reported',
    });
    return { content: [{ type: 'text', text: JSON.stringify(incident, null, 2) }] };
  }
);

server.tool(
  'isms_update_incident_status',
  'Update the status of an incident.',
  {
    id:             z.number().int(),
    status:         z.enum(['reported','investigating','contained','resolved','closed']),
    resolution:     z.string().optional().describe('Resolution notes'),
    lessons_learned: z.string().optional(),
  },
  async ({ id, status, resolution, lessons_learned }) => {
    const { Incident } = getModels();
    const incident = await Incident.findByPk(id);
    if (!incident) return { content: [{ type: 'text', text: 'Incident not found' }], isError: true };
    const updates = { status };
    if (resolution) updates.corrective_actions = resolution;
    if (lessons_learned) updates.lessons_learned = lessons_learned;
    if (status === 'resolved' || status === 'closed') updates.resolved_at = new Date();
    await incident.update(updates);
    return { content: [{ type: 'text', text: JSON.stringify(incident, null, 2) }] };
  }
);

server.tool(
  'isms_update_incident',
  'Update an existing security incident details.',
  {
    id:             z.number().int().describe('Incident ID'),
    title:          z.string().optional(),
    description:    z.string().optional(),
    category:       z.enum(['malware','phishing','data_breach','dos','unauthorized_access','misconfiguration','loss_theft','social_engineering','other']).optional(),
    severity:       z.enum(['low','medium','high','critical']).optional(),
    status:         z.enum(['reported','investigating','contained','resolved','closed']).optional(),
    assignee_id:    z.number().int().optional(),
    nis2_reportable: z.boolean().optional(),
    impact:         z.string().optional(),
    root_cause:     z.string().optional(),
    corrective_actions: z.string().optional(),
    lessons_learned: z.string().optional(),
    asset_ids:      z.array(z.number().int()).optional().describe('Linked Asset IDs'),
    risk_ids:       z.array(z.number().int()).optional().describe('Linked Risk IDs'),
  },
  async ({ id, asset_ids, risk_ids, ...updates }) => {
    const { Incident } = getModels();
    const incident = await Incident.findByPk(id);
    if (!incident) return { content: [{ type: 'text', text: 'Incident not found' }], isError: true };

    if (updates.status === 'resolved' || updates.status === 'closed') {
      updates.resolved_at = new Date();
    }

    await incident.update(updates);

    if (asset_ids !== undefined) await incident.setAssets(asset_ids);
    if (risk_ids !== undefined) await incident.setRisks(risk_ids);

    const updatedIncident = await Incident.findByPk(id, {
      include: [
        { model: getModels().User, as: 'assignee', attributes: ['id', 'name'] },
        { model: getModels().Asset, as: 'assets', attributes: ['id', 'name'] }
      ]
    });

    return { content: [{ type: 'text', text: JSON.stringify(updatedIncident, null, 2) }] };
  }
);

// ─── Tasks ───────────────────────────────────────────────────────────────────

server.tool(
  'isms_list_tasks',
  'List tasks. Supports filtering by status and assignee. Group-assigned tasks are included.',
  {
    status:          z.enum(['open','in_progress','done','cancelled']).optional(),
    priority:        z.enum(['low','medium','high','critical']).optional(),
    assigned_to_id:  z.number().int().optional(),
    limit:           z.number().int().min(1).max(200).default(50),
  },
  async ({ status, priority, assigned_to_id, limit }) => {
    const { Task, User, Group } = getModels();
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assigned_to_id) where.assigned_to_id = assigned_to_id;

    const tasks = await Task.findAll({
      where, limit,
      order: [['due_date', 'ASC'], ['created_at', 'DESC']],
      include: [
        { model: User, as: 'assignee', attributes: ['id','name'], required: false },
        { model: Group, as: 'assignedGroup', attributes: ['id','name','color'], required: false },
        { model: User, as: 'completedBy', attributes: ['id','name'], required: false },
      ],
    });
    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  }
);

server.tool(
  'isms_create_task',
  'Create a new task. Assign to a user OR a group (first-to-complete semantics for groups).',
  {
    title:                 z.string().min(1),
    description:           z.string().optional(),
    priority:              z.enum(['low','medium','high','critical']).default('medium'),
    due_date:              z.string().optional().describe('ISO 8601 date (YYYY-MM-DD)'),
    assigned_to_id:        z.number().int().optional().describe('Assign to specific user'),
    assigned_to_group_id:  z.number().int().optional().describe('Assign to a group (mutually exclusive with assigned_to_id)'),
    related_type:          z.string().optional().describe('e.g. asset, risk, incident'),
    related_id:            z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    const { Task } = getModels();
    if (args.assigned_to_id && args.assigned_to_group_id) {
      return { content: [{ type: 'text', text: 'Cannot assign to both user and group' }], isError: true };
    }
    const task = await Task.create({ ...args, status: 'open', created_by_id: mcpUser?.id || null });
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  'isms_complete_task',
  'Mark a task as done.',
  {
    id: z.number().int(),
  },
  async ({ id }, { mcpUser }) => {
    const { Task } = getModels();
    const task = await Task.findByPk(id);
    if (!task) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    await task.update({
      status: 'done',
      completed_by_id: mcpUser?.id || null,
      completed_at: new Date(),
    });
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

// ─── Controls / SoA ──────────────────────────────────────────────────────────

server.tool(
  'isms_list_controls',
  'List security controls and their implementation status (Statement of Applicability).',
  {
    framework: z.string().optional().describe('Filter by framework (iso27001, nis2, bsi, custom)'),
    status:    z.string().optional().describe('Filter by status (implemented, planned, not_applicable)'),
    search:    z.string().optional(),
    limit:     z.number().int().min(1).max(500).default(100),
  },
  async ({ framework, status, search, limit }) => {
    const { Control, Policy } = getModels();
    const where = {};
    if (framework) where.framework = framework;
    if (status) where.status = status;
    if (search) where[Op.or] = [
      { code: { [Op.like]: `%${search}%` } },
      { title: { [Op.like]: `%${search}%` } },
    ];

    const controls = await Control.findAll({
      where, limit,
      order: [['framework', 'ASC'], ['code', 'ASC']],
      include: [{ model: Policy, as: 'policies', through: { attributes: [] }, required: false }],
    });
    return { content: [{ type: 'text', text: JSON.stringify(controls, null, 2) }] };
  }
);

server.tool(
  'isms_update_control_status',
  'Update the implementation status of a control.',
  {
    id:             z.number().int(),
    status:         z.enum(['implemented', 'planned', 'not_applicable']),
    justification:  z.string().optional().describe('Required/used for not_applicable'),
  },
  async ({ id, status, justification }) => {
    const { Control, Iso27001Control } = getModels();
    const control = await Control.findByPk(id);
    if (!control) return { content: [{ type: 'text', text: 'Control not found' }], isError: true };
    
    const updates = { status };
    if (justification !== undefined) {
      updates.applicability_justification = justification;
    }
    await control.update(updates);

    // Sync status back to module-specific table (best-effort)
    const SOA_TO_ISO = { implemented: 'implemented', not_applicable: 'not_applicable', planned: 'in_progress' };
    if (control.framework === 'iso27001' && control.code && SOA_TO_ISO[status]) {
      Iso27001Control.update(
        { implementation_status: SOA_TO_ISO[status] },
        { where: { ref: control.code } }
      ).catch(() => {});
    }

    return { content: [{ type: 'text', text: JSON.stringify(control, null, 2) }] };
  }
);

server.tool(
  'isms_update_control',
  'Update details, implementation status, or applicability justification of a compliance control / measure.',
  {
    id:             z.number().int().describe('Control ID'),
    status:         z.enum(['implemented', 'planned', 'not_applicable']).optional().describe('SoA implementation status'),
    applicability_justification: z.string().optional().describe('Justification for applicability or non-applicability'),
    title:          z.string().optional(),
    description:    z.string().optional(),
    type:           z.enum(['organizational', 'people', 'physical', 'technological']).optional(),
  },
  async ({ id, ...updates }) => {
    const { Control, Iso27001Control } = getModels();
    const control = await Control.findByPk(id);
    if (!control) return { content: [{ type: 'text', text: 'Control not found' }], isError: true };

    await control.update(updates);

    // Sync status back to module-specific table (best-effort)
    const SOA_TO_ISO = { implemented: 'implemented', not_applicable: 'not_applicable', planned: 'in_progress' };
    if (updates.status !== undefined && control.framework === 'iso27001' && control.code && SOA_TO_ISO[updates.status]) {
      Iso27001Control.update(
        { implementation_status: SOA_TO_ISO[updates.status] },
        { where: { ref: control.code } }
      ).catch(() => {});
    }

    return { content: [{ type: 'text', text: JSON.stringify(control, null, 2) }] };
  }
);

// ─── Dashboard & Reports ─────────────────────────────────────────────────────

server.tool(
  'isms_get_dashboard',
  'Get current ISMS dashboard summary: asset counts, risk distribution, open incidents, overdue reviews, compliance coverage.',
  {},
  async () => {
    const { Asset, Risk, Incident, Reminder, Control } = getModels();
    const [
      totalAssets, activeAssets, openIncidents, criticalRisks, highRisks,
      overdueReminders, implementedControls, totalControls,
    ] = await Promise.all([
      Asset.count({ where: { status: { [Op.ne]: 'decommissioned' } } }),
      Asset.count({ where: { status: 'active' } }),
      Incident.count({ where: { status: { [Op.notIn]: ['resolved','closed'] } } }),
      Risk.count({ where: { status: { [Op.notIn]: ['accepted','closed'] }, residual_level: 'critical' } }),
      Risk.count({ where: { status: { [Op.notIn]: ['accepted','closed'] }, residual_level: 'high' } }),
      Reminder.count({ where: { status: 'overdue' } }),
      Control.count({ where: { status: 'implemented' } }),
      Control.count(),
    ]);
    const coverage = totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0;
    const summary = { totalAssets, activeAssets, openIncidents, criticalRisks, highRisks, overdueReminders, controlCoverage: `${coverage}%`, implementedControls, totalControls };
    return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
  }
);

server.tool(
  'isms_get_management_report',
  'Fetch the full management report: 12-month trends, risk/control/task distribution, auto-calculated KPIs (Health Score, MTTR, coverage rates) and manual KPIs.',
  {},
  async () => {
    // Reuse the same logic as the report route
    try {
      const reportRoute = require('../routes/report');
      // Directly call the DB queries used in the route
      const { Asset, Risk, Incident, Control, Task, Reminder } = getModels();
      const [totalAssets, implementedControls, totalControls, openHighRisks, overdueReminders, totalTasks, doneTasks] = await Promise.all([
        Asset.count({ where: { status: { [Op.ne]: 'decommissioned' } } }),
        Control.count({ where: { status: 'implemented' } }),
        Control.count(),
        Risk.count({ where: { residual_level: { [Op.in]: ['high','critical'] }, status: { [Op.notIn]: ['accepted','closed'] } } }),
        Reminder.count({ where: { status: 'overdue' } }),
        Task.count({ where: { status: { [Op.ne]: 'cancelled' } } }),
        Task.count({ where: { status: 'done' } }),
      ]);
      const coverage = totalControls > 0 ? Math.round((implementedControls / totalControls) * 100) : 0;
      const taskRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
      const healthScore = Math.round(coverage * 0.4 + taskRate * 0.2 + Math.max(0, 100 - openHighRisks * 5) * 0.3 + Math.max(0, 100 - overdueReminders * 10) * 0.1);
      const report = { health_score: Math.min(100, healthScore), control_coverage: coverage, task_completion_rate: taskRate, open_high_risks: openHighRisks, overdue_reminders: overdueReminders, total_assets: totalAssets };
      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
  }
);

server.tool(
  'isms_get_compliance_overview',
  'Get compliance framework coverage overview: percentage of implemented controls per framework.',
  {},
  async () => {
    const { Control, sequelize } = getModels();
    const rows = await Control.findAll({
      attributes: [
        'framework',
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
        [sequelize.fn('SUM', sequelize.literal("CASE WHEN status='implemented' THEN 1 ELSE 0 END")), 'implemented'],
      ],
      group: ['framework'],
      raw: true,
    });
    const overview = rows.map(r => ({
      framework: r.framework,
      total: parseInt(r.total),
      implemented: parseInt(r.implemented) || 0,
      coverage: r.total > 0 ? `${Math.round((parseInt(r.implemented) || 0) / r.total * 100)}%` : '0%',
    }));
    return { content: [{ type: 'text', text: JSON.stringify(overview, null, 2) }] };
  }
);

server.tool(
  'isms_get_review_signoffs',
  'List historical Management Review sign-offs (ISO 27001 Kap. 9.3).',
  {},
  async () => {
    const { ReviewSignOff, User } = getModels();
    const signOffs = await ReviewSignOff.findAll({
      include: [{ model: User, as: 'approvedBy', attributes: ['id', 'name', 'email'] }],
      order: [['approved_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(signOffs, null, 2) }] };
  }
);

server.tool(
  'isms_create_review_signoff',
  'Submit a new Management Review digital sign-off and approval (ISO 27001 Kap. 9.3).',
  {
    report_date: z.string().optional().describe('ISO Date (YYYY-MM-DD) of report, defaults to today'),
    notes:       z.string().optional().describe('Management review notes, executive summary, or decisions'),
  },
  async ({ report_date, notes }, { mcpUser }) => {
    const { ReviewSignOff, User } = getModels();
    const approved_by_id = await getValidUserId(mcpUser);
    const signOff = await ReviewSignOff.create({
      report_date: report_date || new Date().toISOString().slice(0, 10),
      approved_by_id,
      approved_at: new Date(),
      notes,
    });
    const full = await ReviewSignOff.findByPk(signOff.id, {
      include: [{ model: User, as: 'approvedBy', attributes: ['id', 'name', 'email'] }],
    });
    await logAudit('create', 'review_signoff', signOff.id, `Management Review ${signOff.report_date}`, { notes }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(full, null, 2) }] };
  }
);

// ─── Users & Groups ──────────────────────────────────────────────────────────

server.tool(
  'isms_list_users',
  'List all users. Admin operation — returns name, email, role, active status.',
  {
    role:   z.string().optional().describe('Filter by role'),
    active: z.boolean().optional().describe('Filter by active status'),
  },
  async ({ role, active }) => {
    const { User } = getModels();
    const where = {};
    if (role) where.role = role;
    if (active !== undefined) where.active = active;
    const users = await User.findAll({
      where,
      attributes: ['id','name','email','role','department','active','last_seen_at'],
      order: [['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(users, null, 2) }] };
  }
);

server.tool(
  'isms_list_groups',
  'List all groups/teams with their members.',
  {},
  async () => {
    const { Group, User } = getModels();
    const groups = await Group.findAll({
      include: [{ model: User, as: 'members', attributes: ['id','name','email','role'], through: { attributes: [] } }],
      order: [['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
  }
);

// ─── Pentests (v2.2.0) ───────────────────────────────────────────────────────

server.tool(
  'isms_list_pentests',
  'List all pentest projects from the pentest register, including owner and findings summary.',
  {},
  async () => {
    const { PentestProject, User, PentestFinding } = getModels();
    const projects = await PentestProject.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: PentestFinding, as: 'findings', attributes: ['id', 'severity', 'status'] },
      ],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
  }
);

server.tool(
  'isms_create_pentest',
  'Register a new pentest project.',
  {
    title:       z.string().min(1).describe('Project title'),
    description: z.string().optional().describe('Details about scope/target'),
    target:      z.string().optional().describe('Scope target (IPs, domains, apps)'),
    status:      z.enum(['planned', 'active', 'completed']).default('planned'),
    owner_id:    z.number().int().optional().describe('User ID of the project owner'),
  },
  async (args, { mcpUser }) => {
    const { PentestProject } = getModels();
    const owner_id = args.owner_id || await getValidUserId(mcpUser);
    const project = await PentestProject.create({ ...args, owner_id });
    await logAudit('create', 'pentest_project', project.id, project.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] };
  }
);

server.tool(
  'isms_list_pentest_findings',
  'List findings for a specific pentest project with optional severity and status filters.',
  {
    project_id: z.number().int().describe('Pentest project ID'),
    severity:   z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by severity'),
    status:     z.enum(['open', 'in_progress', 'resolved', 'ignored']).optional().describe('Filter by status'),
  },
  async ({ project_id, severity, status }) => {
    const { PentestFinding, User } = getModels();
    const where = { project_id };
    if (severity) where.severity = severity;
    if (status) where.status = status;

    const findings = await PentestFinding.findAll({
      where,
      include: [{ model: User, as: 'assignee', attributes: ['id', 'name', 'email'] }],
      order: [['severity', 'ASC'], ['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(findings, null, 2) }] };
  }
);

server.tool(
  'isms_create_pentest_finding',
  'Add a new finding to a pentest project.',
  {
    project_id:  z.number().int().describe('Pentest project ID'),
    title:       z.string().min(1).describe('Finding title'),
    description: z.string().optional().describe('Detailed explanation of vulnerability'),
    severity:    z.enum(['low', 'medium', 'high', 'critical']),
    status:      z.enum(['open', 'in_progress', 'resolved', 'ignored']).default('open'),
    remediation: z.string().optional().describe('Remediation recommendation'),
    assignee_id: z.number().int().optional().describe('User ID assigned to resolve finding'),
  },
  async (args, { mcpUser }) => {
    const { PentestFinding } = getModels();
    const finding = await PentestFinding.create(args);
    await logAudit('create', 'pentest_finding', finding.id, finding.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

server.tool(
  'isms_update_pentest_finding',
  'Update details or status of an existing pentest finding.',
  {
    id:          z.number().int().describe('Finding ID'),
    title:       z.string().optional(),
    description: z.string().optional(),
    severity:    z.enum(['low', 'medium', 'high', 'critical']).optional(),
    status:      z.enum(['open', 'in_progress', 'resolved', 'ignored']).optional(),
    remediation: z.string().optional(),
    assignee_id: z.number().int().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { PentestFinding } = getModels();
    const finding = await PentestFinding.findByPk(id);
    if (!finding) return { content: [{ type: 'text', text: 'Finding not found' }], isError: true };
    await finding.update(updates);
    await logAudit('update', 'pentest_finding', finding.id, finding.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

// ─── GDPR / DSGVO (v2.2.0) ───────────────────────────────────────────────────

server.tool(
  'isms_list_vvt_entries',
  'List all records of processing activities (VVT - Verzeichnis von Verarbeitungstätigkeiten) for GDPR/DSGVO compliance.',
  {},
  async () => {
    const { VvtEntry, User, Vendor, Asset } = getModels();
    const entries = await VvtEntry.findAll({
      include: [
        { model: User, as: 'responsible', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'processor', attributes: ['id', 'name'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Vendor, as: 'vendors', attributes: ['id', 'name'], through: { attributes: [] } },
      ],
      order: [['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
  }
);

server.tool(
  'isms_create_vvt_entry',
  'Create a new VVT entry in the GDPR/DSGVO record of processing activities.',
  {
    name:                    z.string().min(1).describe('Process name'),
    purpose:                 z.string().describe('Purpose of processing'),
    legal_basis:             z.string().describe('Legal basis (e.g. GDPR Art. 6(1)(b))'),
    data_categories:         z.array(z.string()).optional().describe('Categories of personal data processed'),
    special_categories:      z.boolean().optional().describe('Special/sensitive data (e.g. health data, biometric)'),
    data_subjects:           z.array(z.string()).optional().describe('Categories of affected data subjects'),
    recipients:              z.array(z.string()).optional().describe('Internal/external recipients of the data'),
    third_country_transfers: z.boolean().optional().describe('Data transfer details outside EU/EEA'),
    transfer_safeguards:     z.string().optional().describe('Safeguards for transfer (e.g., SCCs)'),
    retention_period:        z.string().optional().describe('Data retention duration'),
    retention_legal_basis:   z.string().optional().describe('Legal basis for keeping the data'),
    deletion_procedure:      z.string().optional().describe('How data is safely deleted'),
    security_measures:       z.string().optional().describe('Technical/organizational measures (TOMs)'),
    responsible_id:          z.number().int().optional().describe('User ID of process owner'),
    processor_id:            z.number().int().optional().describe('Vendor ID of data processor'),
    status:                  z.enum(['draft', 'active', 'archived']).default('active'),
    notes:                   z.string().optional(),
    dsfa_required:           z.boolean().default(false).describe('Whether a DSFA / DPIA is required'),
    asset_ids:               z.array(z.number().int()).optional().describe('Associated Asset IDs'),
    vendor_ids:              z.array(z.number().int()).optional().describe('Associated Vendor IDs'),
  },
  async ({ asset_ids, vendor_ids, ...fields }, { mcpUser }) => {
    const { VvtEntry } = getModels();
    const responsible_id = fields.responsible_id || await getValidUserId(mcpUser);
    const entry = await VvtEntry.create({ ...fields, responsible_id });
    if (Array.isArray(asset_ids)) await entry.setAssets(asset_ids);
    if (Array.isArray(vendor_ids)) await entry.setVendors(vendor_ids);
    await logAudit('create', 'vvt', entry.id, entry.name, fields, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(entry, null, 2) }] };
  }
);

server.tool(
  'isms_list_subject_requests',
  'List GDPR Subject Access Requests (Betroffenenanfragen) with optional status filter.',
  {
    status: z.enum(['received', 'in_progress', 'completed', 'rejected', 'extended']).optional().describe('Filter by request status'),
  },
  async ({ status }) => {
    const { SubjectRequest, User } = getModels();
    const where = {};
    if (status) where.status = status;
    const requests = await SubjectRequest.findAll({
      where,
      include: [{ model: User, as: 'handler', attributes: ['id', 'name', 'email'] }],
      order: [['received_date', 'DESC'], ['id', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(requests, null, 2) }] };
  }
);

server.tool(
  'isms_create_subject_request',
  'Register a new GDPR Subject Access Request (Betroffenenanfrage). Due date is automatically calculated as +30 days.',
  {
    requester_name:       z.string().min(1).describe('Name of the person requesting data'),
    requester_email:      z.string().email().describe('Email address of the requester'),
    type:                 z.enum(['access', 'rectification', 'erasure', 'restriction', 'portability', 'objection', 'withdraw_consent']),
    received_date:        z.string().describe('ISO date (YYYY-MM-DD) when request was received'),
    due_date:             z.string().optional().describe('ISO date (YYYY-MM-DD). If omitted, +30 days from received_date'),
    description:          z.string().optional().describe('Request details'),
    handler_id:           z.number().int().optional().describe('User ID of the DPO/Handler'),
    notes:                z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { SubjectRequest } = getModels();
    const body = { ...args };
    if (!body.due_date && body.received_date) {
      const d = new Date(body.received_date);
      d.setDate(d.getDate() + 30);
      body.due_date = d.toISOString().split('T')[0];
    }
    const handler_id = body.handler_id || await getValidUserId(mcpUser);
    const request = await SubjectRequest.create({ ...body, handler_id });
    const year = new Date(request.created_at || new Date()).getFullYear();
    const ref = `BSA-${year}-${String(request.id).padStart(3, '0')}`;
    await request.update({ ref });
    await logAudit('create', 'subject_request', request.id, `${ref} (${request.requester_name})`, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(request, null, 2) }] };
  }
);

server.tool(
  'isms_update_subject_request_status',
  'Update status, decision, or handler of a GDPR Subject Access Request.',
  {
    id:               z.number().int().describe('Subject request ID'),
    status:           z.enum(['received', 'in_progress', 'completed', 'rejected', 'extended']),
    decision:         z.string().optional().describe('Decision details (e.g. data sent, rejected reason)'),
    notes:            z.string().optional(),
    handler_id:       z.number().int().optional(),
    extended_until:   z.string().optional().describe('Extended due date ISO YYYY-MM-DD'),
    extension_reason: z.string().optional(),
  },
  async ({ id, status, decision, notes, handler_id, extended_until, extension_reason }, { mcpUser }) => {
    const { SubjectRequest } = getModels();
    const request = await SubjectRequest.findByPk(id);
    if (!request) return { content: [{ type: 'text', text: 'Subject request not found' }], isError: true };

    const updates = { status };
    if (decision !== undefined) updates.decision = decision;
    if (notes !== undefined) updates.notes = notes;
    if (handler_id !== undefined) updates.handler_id = handler_id;
    if (extended_until !== undefined) updates.extended_until = extended_until;
    if (extension_reason !== undefined) updates.extension_reason = extension_reason;

    if (status === 'completed' && !request.completed_at) {
      updates.completed_at = new Date();
    }

    await request.update(updates);
    await logAudit('update', 'subject_request', request.id, request.ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(request, null, 2) }] };
  }
);

// ─── Vendor Risk Management (v2.2.0) ─────────────────────────────────────────

server.tool(
  'isms_list_vendors',
  'List all vendors/processors with their details and risk levels.',
  {
    risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by risk level'),
  },
  async ({ risk_level }) => {
    const { Vendor, VendorContact } = getModels();
    const where = {};
    if (risk_level) where.risk_level = risk_level;
    const vendors = await Vendor.findAll({
      where,
      include: [{ model: VendorContact, as: 'contacts' }],
      order: [['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(vendors, null, 2) }] };
  }
);

server.tool(
  'isms_create_vendor',
  'Register a new vendor/processor in the vendor register.',
  {
    name:    z.string().min(1).describe('Vendor name'),
    type:    z.enum(['it_provider', 'software_vendor', 'hardware_vendor', 'cloud_provider', 'support', 'consultant', 'other', 'software', 'cloud', 'hardware', 'consulting', 'hosting', 'logistics']).default('other').describe('Vendor type'),
    website: z.string().optional(),
    phone:   z.string().optional(),
    address: z.string().optional(),
    notes:   z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor } = getModels();
    const vendor = await Vendor.create(args);
    await logAudit('create', 'vendor', vendor.id, vendor.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(vendor, null, 2) }] };
  }
);

server.tool(
  'isms_assess_vendor',
  'Perform or update the security and risk assessment of a vendor/processor.',
  {
    id:                  z.number().int().describe('Vendor ID'),
    risk_level:          z.enum(['low', 'medium', 'high', 'critical']).describe('Assessed risk level'),
    risk_score:          z.number().int().min(1).max(25).describe('Calculated risk score (e.g., probability x impact, 1-25)'),
    data_processor:      z.boolean().describe('Is the vendor a processor of personal data (GDPR)?'),
    dpa_signed:          z.boolean().describe('Is the Data Processing Agreement (DPA/AVV) signed?'),
    dpa_signed_at:       z.string().optional().describe('ISO date (YYYY-MM-DD) when DPA was signed'),
    iso27001_certified:  z.boolean().describe('Is the vendor ISO 27001 certified?'),
    soc2_certified:      z.boolean().describe('Has the vendor a SOC2 Type II report?'),
    gdpr_compliant:      z.boolean().describe('Is the vendor evaluated as GDPR compliant?'),
    fourth_party_risks:  z.string().optional().describe('Notes on subcontractors/fourth-parties'),
    assessment_notes:    z.string().optional().describe('Summary of the audit/assessment'),
    next_review_date:    z.string().optional().describe('ISO date (YYYY-MM-DD) for next audit'),
  },
  async ({ id, dpa_signed_at, next_review_date, ...updates }, { mcpUser }) => {
    const { Vendor } = getModels();
    const vendor = await Vendor.findByPk(id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };

    const cleanDate = (val) => (val === '' || val === 'Invalid date' || !val) ? null : val;
    const assessed_by_id = await getValidUserId(mcpUser);

    const fullUpdates = {
      ...updates,
      dpa_signed_at: cleanDate(dpa_signed_at),
      next_review_date: cleanDate(next_review_date),
      last_assessed_at: new Date(),
      assessed_by_id,
    };

    await vendor.update(fullUpdates);
    await logAudit('update', 'vendor', vendor.id, vendor.name, { action: 'risk_assessment', ...fullUpdates }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(vendor, null, 2) }] };
  }
);

// ─── Business Continuity Management (v2.2.0) ─────────────────────────────────

server.tool(
  'isms_list_bcm_processes',
  'List all critical business processes from the Business Impact Analysis (BIA).',
  {},
  async () => {
    const { BcmProcess, User } = getModels();
    const processes = await BcmProcess.findAll({
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['criticality', 'ASC'], ['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(processes, null, 2) }] };
  }
);

server.tool(
  'isms_list_bcm_exercises',
  'List BCM tests, exercises, and drills performed for business continuity.',
  {},
  async () => {
    const { BcmExercise, BcmProcess } = getModels();
    const exercises = await BcmExercise.findAll({
      include: [{ model: BcmProcess, as: 'process', attributes: ['id', 'name', 'criticality'] }],
      order: [['exercise_date', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(exercises, null, 2) }] };
  }
);

server.tool(
  'isms_create_bcm_exercise',
  'Create/log a new BCM tabletop exercise, simulation, or full drill.',
  {
    title:            z.string().min(1).describe('Exercise/Drill title'),
    process_id:       z.number().int().describe('Associated BCM/BIA Process ID'),
    exercise_type:    z.enum(['tabletop', 'simulation', 'technical_recovery', 'full_failover']).describe('Type of test'),
    exercise_date:    z.string().describe('ISO Date (YYYY-MM-DD) when test took place'),
    participants:     z.string().optional().describe('List of participants'),
    result:           z.enum(['pending', 'passed', 'passed_with_findings', 'failed']).default('passed'),
    findings:         z.string().optional().describe('Gaps/issues identified during the test'),
    actions:          z.string().optional().describe('Corrective actions planned (remediation)'),
    notes:            z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmExercise } = getModels();
    const exercise = await BcmExercise.create(args);
    await logAudit('create', 'bcm_exercise', exercise.id, exercise.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(exercise, null, 2) }] };
  }
);

// ─── DORA Compliance (v2.2.0) ────────────────────────────────────────────────

server.tool(
  'isms_list_dora_third_parties',
  'List ICT third-party service providers registered under DORA regulations.',
  {},
  async () => {
    const { DoraThirdParty } = getModels();
    const providers = await DoraThirdParty.findAll({
      order: [['criticality', 'ASC'], ['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(providers, null, 2) }] };
  }
);

server.tool(
  'isms_list_dora_tests',
  'List digital operational resilience tests required by DORA.',
  {},
  async () => {
    const { DoraResilienceTest } = getModels();
    const tests = await DoraResilienceTest.findAll({
      order: [['test_date', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(tests, null, 2) }] };
  }
);

// ─── Auto-Discovery (v2.2.0) ─────────────────────────────────────────────────

server.tool(
  'isms_list_discovered_software',
  'List staged auto-discovered software and hosts from network scans or agents.',
  {
    status: z.enum(['pending', 'approved', 'ignored']).optional().default('pending').describe('Filter by staged status'),
  },
  async ({ status }) => {
    const { DiscoveredSoftware } = getModels();
    const list = await DiscoveredSoftware.findAll({
      where: { status },
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
  }
);

server.tool(
  'isms_approve_discovered_software',
  'Approve a staged discovered item, which converts it into an active Asset.',
  {
    id:         z.number().int().describe('Staged item ID'),
    asset_type: z.enum(['hardware', 'software', 'application', 'service', 'other']).optional().describe('Asset type to override'),
  },
  async ({ id, asset_type }, { mcpUser }) => {
    const { DiscoveredSoftware, Asset } = getModels();
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Staged item not found' }], isError: true };
    if (item.status === 'approved') return { content: [{ type: 'text', text: 'Item is already approved' }], isError: true };

    const isNetworkScan = item.source === 'network-scan';
    const searchWhere = isNetworkScan && item.ip
      ? { name: { [Op.like]: `%${item.ip}%` } }
      : { name: item.name };

    const existing = await Asset.findOne({
      where: { ...searchWhere, status: { [Op.ne]: 'decommissioned' } }
    });

    if (!existing) {
      let tags, description;
      const today = new Date().toISOString().split('T')[0];

      if (isNetworkScan) {
        const openPorts = item.open_ports ? JSON.parse(item.open_ports) : [];
        const portTags = openPorts.map(p => `port:${p.port}`);
        tags = ['network-scan', `ip:${item.ip}`, ...portTags];
        if (item.os) tags.push(`os:${item.os.replace(/\s+/g, '_')}`);
        const services = openPorts.map(p => p.service).join(', ');
        description = `Netzwerk-Scan: ${item.ip}${item.hostname !== item.ip ? ` (${item.hostname})` : ''}${item.os ? ` · System: ${item.os}${item.version ? ` ${item.version}` : ''}` : ''}${services ? ` · Dienste: ${services}` : ''} — freigegeben am ${today}`;
      } else {
        tags = ['auto-discovered', `host:${item.hostname}`];
        if (item.ip) tags.push(`ip:${item.ip}`);
        description = `Automatisch erkannt auf ${item.hostname}${item.ip ? ` (${item.ip})` : ''}${item.os ? ` · ${item.os}` : ''} und am ${today} freigegeben.`;
      }

      const creatorId = await getValidUserId(mcpUser);

      await Asset.create({
        name:             item.name,
        type:             asset_type || item.asset_type || 'software',
        classification:   'internal',
        lifecycle_status: 'evaluation',
        location:         item.ip || null,
        version:          item.version || null,
        vendor:           item.vendor  || null,
        owner_id:         creatorId,
        assessor_id:      creatorId,
        tags:             tags,
        description,
        status:           'active',
      });
    }

    await item.update({ status: 'approved' });
    await logAudit('approve_discovery', 'asset', item.id, item.name, { asset_type }, mcpUser);

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `Discovered software approved and added/merged into active Assets.` }, null, 2) }] };
  }
);

server.tool(
  'isms_ignore_discovered_software',
  'Ignore a staged discovered item so it is hidden from approval queues.',
  {
    id: z.number().int().describe('Staged item ID'),
  },
  async ({ id }, { mcpUser }) => {
    const { DiscoveredSoftware } = getModels();
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Staged item not found' }], isError: true };
    await item.update({ status: 'ignored' });
    await logAudit('ignore_discovery', 'discovered_software', item.id, item.name, {}, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Item marked as ignored.' }, null, 2) }] };
  }
);

// ─── Search ───────────────────────────────────────────────────────────────────

server.tool(
  'isms_search',
  'Cross-entity search across assets, risks, incidents, and tasks.',
  {
    query: z.string().min(1).describe('Search term'),
    limit: z.number().int().min(1).max(20).default(10).describe('Results per entity type'),
  },
  async ({ query, limit }) => {
    const { Asset, Risk, Incident, Task } = getModels();
    const like = { [Op.like]: `%${query}%` };
    const [assets, risks, incidents, tasks] = await Promise.all([
      Asset.findAll({ where: { name: like }, limit, attributes: ['id','name','type','status'] }),
      Risk.findAll({ where: { title: like }, limit, attributes: ['id','ref','title','residual_level','status'] }),
      Incident.findAll({ where: { title: like }, limit, attributes: ['id','ref','title','severity','status'] }),
      Task.findAll({ where: { title: like }, limit, attributes: ['id','title','status','priority','due_date'] }),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ assets, risks, incidents, tasks }, null, 2) }] };
  }
);

server.tool(
  'isms_list_features',
  'List all system compliance modules/features and their activation status (enabled/disabled).',
  {},
  async () => {
    const { getModules } = require('../middleware/modules');
    const modules = await getModules();
    return { content: [{ type: 'text', text: JSON.stringify(modules, null, 2) }] };
  }
);

server.tool(
  'isms_set_feature_status',
  'Enable or disable a specific system feature/module.',
  {
    feature: z.enum(['dsgvo', 'tisax', 'dora', 'ai_act', 'bcm', 'pentest', 'discovery', 'iso27001', 'bsi_grundschutz', 'nis2', 'c5', 'mcp']).describe('The feature key'),
    enabled: z.boolean().describe('Set true to enable, false to disable'),
  },
  async ({ feature, enabled }) => {
    const { getSetting, setSetting } = require('../services/settingsService');
    const { invalidateModulesCache, MODULE_DEFAULTS } = require('../middleware/modules');

    const raw = await getSetting('modules');
    let stored = {};
    if (raw) {
      try {
        stored = JSON.parse(raw);
        if (typeof stored === 'string') stored = JSON.parse(stored);
      } catch (e) {
        stored = {};
      }
    }
    
    const value = { ...MODULE_DEFAULTS, ...stored };
    value[feature] = enabled;

    await setSetting('modules', value);
    invalidateModulesCache();

    return { content: [{ type: 'text', text: JSON.stringify({ feature, enabled, current_state: value }, null, 2) }] };
  }
);

// ─── EU AI Act (v2.2.0) ──────────────────────────────────────────────────────

server.tool(
  'isms_list_ai_systems',
  'List all registered AI systems from the EU AI Act compliance register.',
  {
    risk_category:     z.enum(['prohibited', 'high_risk', 'limited', 'minimal']).optional().describe('Filter by AI Act risk category'),
    conformity_status: z.enum(['not_assessed', 'in_assessment', 'compliant', 'non_compliant']).optional(),
    approval_status:   z.enum(['approved', 'not_approved']).optional(),
  },
  async ({ risk_category, conformity_status, approval_status }) => {
    const { AiSystem, User, Vendor } = getModels();
    const where = {};
    if (risk_category) where.risk_category = risk_category;
    if (conformity_status) where.conformity_status = conformity_status;
    if (approval_status) where.approval_status = approval_status;

    const systems = await AiSystem.findAll({
      where,
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'vendor', attributes: ['id', 'name'] },
      ],
      order: [['risk_category', 'ASC'], ['name', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(systems, null, 2) }] };
  }
);

server.tool(
  'isms_create_ai_system',
  'Register a new AI system in the EU AI Act register.',
  {
    name:               z.string().min(1).describe('AI system name'),
    description:        z.string().optional(),
    risk_category:      z.enum(['prohibited', 'high_risk', 'limited', 'minimal']).default('minimal'),
    use_case:           z.string().optional(),
    provider:           z.string().optional().describe('Vendor or provider of the AI model'),
    vendor_id:          z.number().int().optional(),
    location:           z.string().optional(),
    deployed_since:     z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    owner_id:           z.number().int().optional(),
    conformity_status:  z.enum(['not_assessed', 'in_assessment', 'compliant', 'non_compliant']).default('not_assessed'),
    approval_status:    z.enum(['approved', 'not_approved']).default('approved'),
    documentation_url:  z.string().optional(),
    last_review_date:   z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    notes:              z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { AiSystem } = getModels();
    const owner_id = args.owner_id || await getValidUserId(mcpUser);
    const system = await AiSystem.create({ ...args, owner_id });
    await logAudit('create', 'ai_system', system.id, system.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(system, null, 2) }] };
  }
);

server.tool(
  'isms_update_ai_system',
  'Update details, conformity status, or risk category of an AI system in the EU AI Act register.',
  {
    id:                 z.number().int().describe('AI System ID'),
    name:               z.string().optional(),
    description:        z.string().optional(),
    risk_category:      z.enum(['prohibited', 'high_risk', 'limited', 'minimal']).optional(),
    use_case:           z.string().optional(),
    provider:           z.string().optional(),
    vendor_id:          z.number().int().optional(),
    location:           z.string().optional(),
    deployed_since:     z.string().optional(),
    owner_id:           z.number().int().optional(),
    conformity_status:  z.enum(['not_assessed', 'in_assessment', 'compliant', 'non_compliant']).optional(),
    approval_status:    z.enum(['approved', 'not_approved']).optional(),
    documentation_url:  z.string().optional(),
    last_review_date:   z.string().optional(),
    notes:              z.string().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { AiSystem } = getModels();
    const system = await AiSystem.findByPk(id);
    if (!system) return { content: [{ type: 'text', text: 'AI System not found' }], isError: true };

    await system.update(updates);
    await logAudit('update', 'ai_system', system.id, system.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(system, null, 2) }] };
  }
);

server.tool(
  'isms_delete_ai_system',
  'Delete an AI system from the EU AI Act register and cancel associated open tasks.',
  {
    id: z.number().int().describe('AI System ID to delete'),
  },
  async ({ id }, { mcpUser }) => {
    const { AiSystem, Task } = getModels();
    const system = await AiSystem.findByPk(id);
    if (!system) return { content: [{ type: 'text', text: 'AI System not found' }], isError: true };

    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'ai_system', related_id: system.id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );

    await logAudit('delete', 'ai_system', system.id, system.name, {}, mcpUser);
    await system.destroy();

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: `AI System "${system.name}" (ID: ${id}) deleted.` }, null, 2) }] };
  }
);

// ─── Policies (v2.2.0) ───────────────────────────────────────────────────────

server.tool(
  'isms_list_policies',
  'List security policies, guidelines, and procedures with linked assets and controls.',
  {
    category: z.enum(['policy', 'guideline', 'procedure', 'contract', 'other']).optional().describe('Filter by policy category'),
    status:   z.enum(['draft', 'active', 'retired']).optional().describe('Filter by status'),
    search:   z.string().optional().describe('Search in title, code, or description'),
  },
  async ({ category, status, search }) => {
    const { Policy, Asset, Control } = getModels();
    const where = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { code: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }

    const policies = await Policy.findAll({
      where,
      include: [
        { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework'], through: { attributes: [] } },
      ],
      order: [['code', 'ASC'], ['title', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(policies, null, 2) }] };
  }
);

server.tool(
  'isms_get_policy',
  'Get full details of a single policy including version history, mapped controls, and assets.',
  {
    id: z.number().int().describe('Policy ID'),
  },
  async ({ id }) => {
    const { Policy, PolicyVersion, Asset, Control } = getModels();
    const policy = await Policy.findByPk(id, {
      include: [
        { model: PolicyVersion, as: 'history', attributes: ['id', 'version', 'created_at', 'notes'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name', 'type'], through: { attributes: [] } },
        { model: Control, as: 'controls', attributes: ['id', 'code', 'title', 'framework', 'status'], through: { attributes: [] } },
      ],
    });
    if (!policy) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] };
  }
);

server.tool(
  'isms_create_policy',
  'Register a new policy, guideline, or procedure in the policy management system.',
  {
    title:       z.string().min(1).describe('Policy title'),
    code:        z.string().optional().describe('Policy code, e.g. "POL-001"'),
    description: z.string().optional().describe('Summary / content of the policy'),
    category:    z.enum(['policy', 'guideline', 'procedure', 'contract', 'other']).default('policy'),
    status:      z.enum(['draft', 'active', 'retired']).default('active'),
    version:     z.string().default('1.0'),
    valid_from:  z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    valid_until: z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    asset_ids:   z.array(z.number().int()).optional().describe('Linked Asset IDs'),
    control_ids: z.array(z.number().int()).optional().describe('Linked Control IDs (TOMs)'),
  },
  async ({ asset_ids, control_ids, ...fields }, { mcpUser }) => {
    const { Policy } = getModels();
    const policy = await Policy.create(fields);
    if (Array.isArray(asset_ids)) await policy.setAssets(asset_ids);
    if (Array.isArray(control_ids)) await policy.setControls(control_ids);
    await logAudit('create', 'policy', policy.id, policy.title, fields, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] };
  }
);

server.tool(
  'isms_update_policy',
  'Update details, status, or mapped controls of an existing policy.',
  {
    id:          z.number().int().describe('Policy ID'),
    title:       z.string().optional(),
    code:        z.string().optional(),
    description: z.string().optional(),
    category:    z.enum(['policy', 'guideline', 'procedure', 'contract', 'other']).optional(),
    status:      z.enum(['draft', 'active', 'retired']).optional(),
    version:     z.string().optional(),
    valid_from:  z.string().optional(),
    valid_until: z.string().optional(),
    asset_ids:   z.array(z.number().int()).optional(),
    control_ids: z.array(z.number().int()).optional(),
  },
  async ({ id, asset_ids, control_ids, ...updates }, { mcpUser }) => {
    const { Policy } = getModels();
    const policy = await Policy.findByPk(id);
    if (!policy) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };

    await policy.update(updates);
    if (Array.isArray(asset_ids)) await policy.setAssets(asset_ids);
    if (Array.isArray(control_ids)) await policy.setControls(control_ids);

    await logAudit('update', 'policy', policy.id, policy.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(policy, null, 2) }] };
  }
);

server.tool(
  'isms_acknowledge_policy',
  'Submit user acknowledgment/acceptance of a security policy.',
  {
    id: z.number().int().describe('Policy ID to acknowledge'),
  },
  async ({ id }, { mcpUser }) => {
    const { Policy, PolicyAcknowledgment } = getModels();
    const policy = await Policy.findByPk(id);
    if (!policy) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };

    const user_id = await getValidUserId(mcpUser);
    const existing = await PolicyAcknowledgment.findOne({ where: { policy_id: id, user_id } });
    if (existing) {
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Policy already acknowledged.', acknowledged_at: existing.acknowledged_at }, null, 2) }] };
    }

    const ack = await PolicyAcknowledgment.create({
      policy_id: id,
      user_id,
      acknowledged_at: new Date(),
    });

    await logAudit('acknowledge', 'policy', policy.id, policy.title, { acknowledged_by: user_id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(ack, null, 2) }] };
  }
);

// ─── Compliance Audits, CAPA & KPIs (v2.2.0) ─────────────────────────────────

server.tool(
  'isms_list_audits',
  'List internal, external, and certification audits along with findings and CAPA tasks.',
  {
    audit_type: z.enum(['internal', 'external', 'certification']).optional().describe('Filter by audit type'),
    status:     z.enum(['planned', 'in_progress', 'completed']).optional().describe('Filter by status'),
  },
  async ({ audit_type, status }) => {
    const { Audit, AuditFinding, User, Task } = getModels();
    const where = {};
    if (audit_type) where.audit_type = audit_type;
    if (status) where.status = status;

    const audits = await Audit.findAll({
      where,
      include: [
        {
          model: AuditFinding,
          as: 'findings',
          include: [
            { model: User, as: 'assignee', attributes: ['id', 'name'] },
            { model: Task, as: 'capaTask', attributes: ['id', 'title', 'status'] },
          ],
        },
      ],
      order: [['start_date', 'DESC'], ['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(audits, null, 2) }] };
  }
);

server.tool(
  'isms_create_audit',
  'Plan or log a new compliance audit (internal, external, or certification).',
  {
    title:       z.string().min(1).describe('Audit title / objective'),
    scope:       z.string().optional().describe('Scope and audited departments / systems'),
    audit_type:  z.enum(['internal', 'external', 'certification']).default('internal'),
    status:      z.enum(['planned', 'in_progress', 'completed']).default('planned'),
    auditor:     z.string().optional().describe('Auditor or auditing company name'),
    start_date:  z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    end_date:    z.string().optional().describe('ISO Date (YYYY-MM-DD)'),
    report_link: z.string().optional().describe('Link to final audit report'),
    notes:       z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Audit } = getModels();
    const audit = await Audit.create(args);
    await logAudit('create', 'audit', audit.id, audit.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }] };
  }
);

server.tool(
  'isms_update_audit',
  'Update details or status of an existing compliance audit.',
  {
    id:          z.number().int().describe('Audit ID'),
    title:       z.string().optional(),
    scope:       z.string().optional(),
    audit_type:  z.enum(['internal', 'external', 'certification']).optional(),
    status:      z.enum(['planned', 'in_progress', 'completed']).optional(),
    auditor:     z.string().optional(),
    start_date:  z.string().optional(),
    end_date:    z.string().optional(),
    report_link: z.string().optional(),
    notes:       z.string().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { Audit } = getModels();
    const audit = await Audit.findByPk(id);
    if (!audit) return { content: [{ type: 'text', text: 'Audit not found' }], isError: true };

    await audit.update(updates);
    await logAudit('update', 'audit', audit.id, audit.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }] };
  }
);

server.tool(
  'isms_create_audit_finding',
  'Create a new finding / deviation from an audit and optionally assign it for remediation.',
  {
    audit_id:    z.number().int().describe('Audit ID'),
    title:       z.string().min(1).describe('Finding title / issue description'),
    description: z.string().optional().describe('Detailed observation and standard non-conformity'),
    severity:    z.enum(['minor', 'major', 'observation']).default('observation'),
    status:      z.enum(['open', 'resolved', 'wont_fix']).default('open'),
    assignee_id: z.number().int().optional().describe('User ID responsible for resolution'),
  },
  async (args, { mcpUser }) => {
    const { Audit, AuditFinding } = getModels();
    const audit = await Audit.findByPk(args.audit_id);
    if (!audit) return { content: [{ type: 'text', text: 'Audit not found' }], isError: true };

    const finding = await AuditFinding.create(args);
    await logAudit('create', 'audit_finding', finding.id, finding.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

server.tool(
  'isms_update_audit_finding',
  'Update status, severity, or remediation details of an audit finding.',
  {
    id:          z.number().int().describe('Audit Finding ID'),
    title:       z.string().optional(),
    description: z.string().optional(),
    severity:    z.enum(['minor', 'major', 'observation']).optional(),
    status:      z.enum(['open', 'resolved', 'wont_fix']).optional(),
    assignee_id: z.number().int().optional(),
  },
  async ({ id, ...updates }, { mcpUser }) => {
    const { AuditFinding } = getModels();
    const finding = await AuditFinding.findByPk(id);
    if (!finding) return { content: [{ type: 'text', text: 'Audit finding not found' }], isError: true };

    await finding.update(updates);
    await logAudit('update', 'audit_finding', finding.id, finding.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(finding, null, 2) }] };
  }
);

server.tool(
  'isms_list_kpis',
  'List security & compliance KPIs along with measurement history and target values.',
  {},
  async () => {
    const { Kpi, KpiMeasurement, User } = getModels();
    const kpis = await Kpi.findAll({
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'email'] },
        { model: KpiMeasurement, as: 'measurements', order: [['measured_at', 'DESC']] },
      ],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(kpis, null, 2) }] };
  }
);

server.tool(
  'isms_record_kpi_measurement',
  'Record a new measured value for a security KPI.',
  {
    kpi_id:      z.number().int().describe('KPI ID'),
    value:       z.number().describe('Measured numerical value'),
    measured_at: z.string().optional().describe('ISO Date (YYYY-MM-DD), defaults to today'),
    notes:       z.string().optional(),
  },
  async ({ kpi_id, value, measured_at, notes }, { mcpUser }) => {
    const { Kpi, KpiMeasurement } = getModels();
    const kpi = await Kpi.findByPk(kpi_id);
    if (!kpi) return { content: [{ type: 'text', text: 'KPI not found' }], isError: true };

    const measurement = await KpiMeasurement.create({
      kpi_id,
      value,
      measured_at: measured_at || new Date().toISOString().split('T')[0],
      notes,
    });

    await kpi.update({ current_value: value });
    await logAudit('create', 'kpi_measurement', measurement.id, `KPI: ${kpi.title}`, { value }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(measurement, null, 2) }] };
  }
);




// ─── Threats ─────────────────────────────────────────────────────────────────

server.tool(
  'isms_create_threat',
  'Add a custom cybersecurity threat to the ISMS threat catalog.',
  {
    name: z.string().min(1).describe('Threat name / title'),
    category: z.string().optional().describe('Threat category (e.g. Malware, Phishing, Physical, Human Error)'),
    description: z.string().optional().describe('Threat description'),
    default_likelihood: z.number().int().min(1).max(5).default(3).describe('Default likelihood (1-5)'),
    default_impact: z.number().int().min(1).max(5).default(3).describe('Default impact (1-5)'),
  },
  async (args, { mcpUser }) => {
    const { Threat } = getModels();
    const item = await Threat.create(args);
    await logAudit('create', 'threat', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

// ─── Incident Deletion ───────────────────────────────────────────────────────

server.tool(
  'isms_delete_incident',
  'Delete / remove a security incident from the incident register.',
  { id: z.number().int().describe('Incident ID') },
  async ({ id }, { mcpUser }) => {
    const { Incident } = getModels();
    const item = await Incident.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Incident not found' }], isError: true };
    await logAudit('delete', 'incident', item.id, item.title || `Incident #${item.id}`, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Task Details, Stats & Deletion ──────────────────────────────────────────

server.tool(
  'isms_get_task',
  'Get full details of a specific task including assignee, group members, and creator.',
  { id: z.number().int().describe('Task ID') },
  async ({ id }) => {
    const { Task, User, Group } = getModels();
    const item = await Task.findByPk(id, {
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'createdBy', attributes: ['id', 'name'] },
        { model: User, as: 'completedBy', attributes: ['id', 'name'] },
        {
          model: Group,
          as: 'assignedGroup',
          attributes: ['id', 'name', 'color'],
          include: [{ model: User, as: 'members', attributes: ['id', 'name', 'email'], through: { attributes: [] } }],
        },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_task',
  'Update details, status, priority, due date, or assignees of a task.',
  {
    id: z.number().int().describe('Task ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    due_date: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    reminder_date: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    assigned_to_id: z.number().int().nullable().optional(),
    assigned_to_group_id: z.number().int().nullable().optional(),
  },
  async (args, { mcpUser }) => {
    const { Task } = getModels();
    const item = await Task.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.status === 'done' && !item.completed_at) {
      updates.completed_at = new Date();
      updates.completed_by_id = await getValidUserId(mcpUser);
    }
    await item.update(updates);
    await logAudit('update', 'task', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_task',
  'Delete a task from the system.',
  { id: z.number().int().describe('Task ID') },
  async ({ id }, { mcpUser }) => {
    const { Task } = getModels();
    const item = await Task.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Task not found' }], isError: true };
    await logAudit('delete', 'task', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_task_stats',
  'Get aggregated task counts (open, in_progress, done, overdue).',
  {},
  async () => {
    const { Task, Asset } = getModels();
    const inactiveAssets = await Asset.findAll({
      where: { status: { [Op.in]: ['inactive', 'decommissioned'] } },
      attributes: ['id'],
      raw: true,
    });
    const inactiveAssetIds = new Set(inactiveAssets.map(a => a.id));
    const activeAssetFilter = inactiveAssetIds.size > 0 ? {
      [Op.or]: [
        { related_type: { [Op.ne]: 'asset' } },
        { related_type: null },
        { related_id: { [Op.notIn]: [...inactiveAssetIds] } },
      ]
    } : {};
    const todayStr = new Date().toISOString().slice(0, 10);
    const [open, in_progress, done, overdue] = await Promise.all([
      Task.count({ where: { status: 'open', ...activeAssetFilter } }),
      Task.count({ where: { status: 'in_progress', ...activeAssetFilter } }),
      Task.count({ where: { status: 'done', ...activeAssetFilter } }),
      Task.count({ where: { status: { [Op.notIn]: ['done', 'cancelled'] }, due_date: { [Op.lt]: todayStr }, ...activeAssetFilter } }),
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ open, in_progress, done, overdue }, null, 2) }] };
  }
);

// ─── Reminders, Notifications & User Dashboard ───────────────────────────────

server.tool(
  'isms_list_reminders',
  'List active and pending asset review reminders.',
  {
    status: z.enum(['pending', 'acknowledged', 'overdue', 'all']).default('all'),
  },
  async ({ status }) => {
    const { Reminder, Asset } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    const items = await Reminder.findAll({
      where,
      include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'] }],
      order: [['due_date', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_acknowledge_reminder',
  'Acknowledge / complete an asset review reminder, auto-closing any associated task.',
  { id: z.number().int().describe('Reminder ID') },
  async ({ id }, { mcpUser }) => {
    const { Reminder, Task } = getModels();
    const item = await Reminder.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Reminder not found' }], isError: true };
    const userId = await getValidUserId(mcpUser);
    await item.update({ status: 'acknowledged', acknowledged_at: new Date(), acknowledged_by: userId });
    if (item.task_id) {
      await Task.update({ status: 'done', completed_at: new Date(), completed_by_id: userId }, { where: { id: item.task_id } });
    }
    await logAudit('acknowledge', 'reminder', item.id, `Reminder #${item.id}`, { asset_id: item.asset_id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_dismiss_reminder',
  'Dismiss an asset review reminder.',
  { id: z.number().int().describe('Reminder ID') },
  async ({ id }, { mcpUser }) => {
    const { Reminder } = getModels();
    const item = await Reminder.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Reminder not found' }], isError: true };
    await item.update({ dismissed: true });
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, id }) }] };
  }
);

server.tool(
  'isms_list_notifications',
  'List pending notifications, overdue reminders, and assets requiring review.',
  {},
  async (args, { mcpUser }) => {
    const { Reminder, Asset, Notification, User, sequelize } = getModels();
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().split('T')[0];
    const userId = mcpUser?.id || 1;

    const [overdueRows, upcomingRows, unassessedAssets, userNotes] = await Promise.all([
      Reminder.findAll({
        where: { status: 'overdue', dismissed: { [Op.not]: true } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'], where: { status: 'active' } }],
        order: [['due_date', 'ASC']],
      }),
      Reminder.findAll({
        where: { status: 'pending', due_date: { [Op.between]: [todayStr, in30Str] }, dismissed: { [Op.not]: true } },
        include: [{ model: Asset, attributes: ['id', 'name', 'type', 'classification'], where: { status: 'active' } }],
        order: [['due_date', 'ASC']],
      }),
      Asset.findAll({
        where: {
          status: 'active',
          id: { [Op.notIn]: sequelize.literal('(SELECT asset_id FROM assessments WHERE is_current = 1 AND asset_id IS NOT NULL)') },
        },
        attributes: ['id', 'name', 'type', 'classification'],
      }),
      Notification.findAll({
        where: { user_id: userId, read: false },
        include: [{ model: User, as: 'actor', attributes: ['name'] }],
        order: [['created_at', 'DESC']],
        limit: 20,
      }),
    ]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          overdueReminders: overdueRows,
          upcomingReminders: upcomingRows,
          unassessedAssets,
          unreadNotifications: userNotes,
        }, null, 2),
      }],
    };
  }
);

server.tool(
  'isms_get_my_overview',
  'Get personalized user dashboard summary (assigned assets, open tasks, unread notifications, pending policy acknowledgments, training statuses).',
  {},
  async (args, { mcpUser }) => {
    const { Asset, Task, Notification, Policy, PolicyAcknowledgment, UserTraining, GroupMember } = getModels();
    const userId = mcpUser?.id || 1;

    const memberOf = await GroupMember.findAll({ where: { user_id: userId } });
    const groupIds = memberOf.map(m => m.group_id);
    const taskOr = [{ assigned_to_id: userId }];
    if (groupIds.length > 0) taskOr.push({ assigned_to_group_id: { [Op.in]: groupIds } });

    const [ownedAssets, myTasks, unreadNotifs, trainings, allPolicies, acks] = await Promise.all([
      Asset.findAll({ where: { owner_id: userId, status: 'active' }, attributes: ['id', 'name', 'type', 'classification'] }),
      Task.findAll({ where: { [Op.or]: taskOr, status: { [Op.notIn]: ['done', 'cancelled'] } }, order: [['due_date', 'ASC']] }),
      Notification.findAll({ where: { user_id: userId, read: false }, limit: 10 }),
      UserTraining.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']] }),
      Policy.findAll({ where: { status: 'published' }, attributes: ['id', 'title', 'version'] }),
      PolicyAcknowledgment.findAll({ where: { user_id: userId } }),
    ]);

    const ackPolicyIds = new Set(acks.map(a => a.policy_id));
    const pendingPolicies = allPolicies.filter(p => !ackPolicyIds.has(p.id));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          user: { id: userId, name: mcpUser?.name, role: mcpUser?.role },
          ownedAssetsCount: ownedAssets.length,
          ownedAssets,
          openTasksCount: myTasks.length,
          openTasks: myTasks,
          unreadNotificationsCount: unreadNotifs.length,
          unreadNotifications: unreadNotifs,
          pendingPolicyAcknowledgmentsCount: pendingPolicies.length,
          pendingPolicies,
          trainings,
        }, null, 2),
      }],
    };
  }
);

// ─── Controls Management ─────────────────────────────────────────────────────

server.tool(
  'isms_create_control',
  'Create a new custom security control in the Statement of Applicability (SoA) register.',
  {
    code: z.string().min(1).describe('Control reference code (e.g. C-01, ISO-5.1)'),
    framework: z.string().default('custom').describe('Framework identifier (iso27001, bsi, nis2, c5, custom)'),
    title: z.string().min(1).describe('Control title'),
    description: z.string().optional(),
    category: z.string().optional(),
    status: z.enum(['not_applicable', 'planned', 'in_progress', 'implemented']).default('planned'),
    justification: z.string().optional(),
    owner_id: z.number().int().optional(),
    evidence: z.string().optional(),
    implementation_notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Control } = getModels();
    const item = await Control.create(args);
    await logAudit('create', 'control', item.id, `${item.code}: ${item.title}`, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_control',
  'Delete a security control from the Statement of Applicability register.',
  { id: z.number().int().describe('Control ID') },
  async ({ id }, { mcpUser }) => {
    const { Control } = getModels();
    const item = await Control.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Control not found' }], isError: true };
    await logAudit('delete', 'control', item.id, `${item.code}: ${item.title}`, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── User, Group & API Token Management ──────────────────────────────────────

server.tool(
  'isms_create_user',
  'Create a new user account (admin only).',
  {
    name: z.string().min(1).describe('User display name'),
    email: z.string().email().describe('User email address'),
    password: z.string().min(8).describe('Initial password'),
    role: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).default('viewer'),
    department: z.string().optional(),
    custom_role_id: z.number().int().nullable().optional(),
  },
  async (args, { mcpUser }) => {
    const { User, CustomRole } = getModels();
    const { validate: validatePassword } = require('../services/passwordPolicy');
    const check = await validatePassword(args.password);
    if (!check.valid) {
      return { content: [{ type: 'text', text: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` }], isError: true };
    }
    const password_hash = await User.hashPassword(args.password);
    let effectiveRole = args.role;
    let customRoleId = null;
    if (args.custom_role_id) {
      const cr = await CustomRole.findByPk(args.custom_role_id);
      if (!cr) return { content: [{ type: 'text', text: 'Custom role not found' }], isError: true };
      effectiveRole = cr.base_role;
      customRoleId = cr.id;
    }
    const user = await User.create({
      name: args.name,
      email: args.email.toLowerCase().trim(),
      password_hash,
      role: effectiveRole,
      department: args.department || null,
      custom_role_id: customRoleId,
    });
    await logAudit('create', 'user', user.id, user.name, { role: user.role, email: user.email }, mcpUser);
    const userJson = user.toJSON();
    delete userJson.password_hash;
    return { content: [{ type: 'text', text: JSON.stringify(userJson, null, 2) }] };
  }
);

server.tool(
  'isms_update_user',
  'Update user details, role, department, or active status (admin only).',
  {
    id: z.number().int().describe('User ID'),
    name: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).optional(),
    department: z.string().optional(),
    active: z.boolean().optional(),
    password: z.string().min(8).optional(),
    custom_role_id: z.number().int().nullable().optional(),
  },
  async (args, { mcpUser }) => {
    const { User, CustomRole } = getModels();
    const user = await User.findByPk(args.id);
    if (!user) return { content: [{ type: 'text', text: 'User not found' }], isError: true };
    const { id, password, custom_role_id, role, ...updates } = args;

    if (custom_role_id) {
      const cr = await CustomRole.findByPk(custom_role_id);
      if (!cr) return { content: [{ type: 'text', text: 'Custom role not found' }], isError: true };
      updates.role = cr.base_role;
      updates.custom_role_id = cr.id;
    } else if (custom_role_id === null) {
      updates.custom_role_id = null;
      if (role) updates.role = role;
    } else if (role) {
      updates.role = role;
      updates.custom_role_id = null;
    }

    if (password) {
      const { validate: validatePassword } = require('../services/passwordPolicy');
      const check = await validatePassword(password);
      if (!check.valid) {
        return { content: [{ type: 'text', text: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` }], isError: true };
      }
      updates.password_hash = await User.hashPassword(password);
    }

    await user.update(updates);
    await logAudit('update', 'user', user.id, user.name, updates, mcpUser);
    const userJson = user.toJSON();
    delete userJson.password_hash;
    return { content: [{ type: 'text', text: JSON.stringify(userJson, null, 2) }] };
  }
);

server.tool(
  'isms_delete_user',
  'Deactivate / delete a user account (admin only).',
  { id: z.number().int().describe('User ID') },
  async ({ id }, { mcpUser }) => {
    const { User } = getModels();
    const user = await User.findByPk(id);
    if (!user) return { content: [{ type: 'text', text: 'User not found' }], isError: true };
    if (user.id === mcpUser?.id) return { content: [{ type: 'text', text: 'Cannot delete own account' }], isError: true };
    await logAudit('delete', 'user', user.id, user.name, {}, mcpUser);
    await user.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_group',
  'Get details of a group / team including its members.',
  { id: z.number().int().describe('Group ID') },
  async ({ id }) => {
    const { Group, User } = getModels();
    const group = await Group.findByPk(id, {
      include: [{ model: User, as: 'members', attributes: ['id', 'name', 'email', 'role'], through: { attributes: [] } }],
    });
    if (!group) return { content: [{ type: 'text', text: 'Group not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(group, null, 2) }] };
  }
);

server.tool(
  'isms_create_group',
  'Create a new team / group for task assignments and notifications (admin only).',
  {
    name: z.string().min(1).describe('Group name'),
    description: z.string().optional(),
    color: z.string().default('#3b82f6').describe('Hex color code'),
  },
  async (args, { mcpUser }) => {
    const { Group } = getModels();
    const userId = await getValidUserId(mcpUser);
    const item = await Group.create({ ...args, created_by_id: userId });
    await logAudit('create', 'group', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_group',
  'Update group name, description, or color (admin only).',
  {
    id: z.number().int().describe('Group ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    color: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Group } = getModels();
    const item = await Group.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Group not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'group', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_group',
  'Delete a group (admin only).',
  { id: z.number().int().describe('Group ID') },
  async ({ id }, { mcpUser }) => {
    const { Group } = getModels();
    const item = await Group.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Group not found' }], isError: true };
    await logAudit('delete', 'group', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_add_group_member',
  'Add a user as member to a group (admin only).',
  {
    group_id: z.number().int().describe('Group ID'),
    user_id: z.number().int().describe('User ID to add'),
  },
  async ({ group_id, user_id }, { mcpUser }) => {
    const { Group, User, GroupMember } = getModels();
    const group = await Group.findByPk(group_id);
    if (!group) return { content: [{ type: 'text', text: 'Group not found' }], isError: true };
    const user = await User.findByPk(user_id);
    if (!user) return { content: [{ type: 'text', text: 'User not found' }], isError: true };
    const [, created] = await GroupMember.findOrCreate({ where: { group_id, user_id } });
    if (!created) return { content: [{ type: 'text', text: 'User is already a member of this group' }], isError: true };
    await logAudit('update', 'group', group.id, group.name, { action: 'add_member', user_name: user.name }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, group_id, user_id }) }] };
  }
);

server.tool(
  'isms_remove_group_member',
  'Remove a user from a group (admin only).',
  {
    group_id: z.number().int().describe('Group ID'),
    user_id: z.number().int().describe('User ID to remove'),
  },
  async ({ group_id, user_id }, { mcpUser }) => {
    const { Group, GroupMember } = getModels();
    const group = await Group.findByPk(group_id);
    if (!group) return { content: [{ type: 'text', text: 'Group not found' }], isError: true };
    const deleted = await GroupMember.destroy({ where: { group_id, user_id } });
    if (!deleted) return { content: [{ type: 'text', text: 'User is not a member of this group' }], isError: true };
    await logAudit('update', 'group', group.id, group.name, { action: 'remove_member', user_id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, group_id, user_id }) }] };
  }
);

server.tool(
  'isms_list_api_tokens',
  'List active API tokens for the authenticated user.',
  {},
  async (args, { mcpUser }) => {
    const { ApiToken } = getModels();
    const userId = mcpUser?.id || 1;
    const tokens = await ApiToken.findAll({
      where: { user_id: userId },
      attributes: ['id', 'user_id', 'name', 'token_prefix', 'expires_at', 'created_at', 'updated_at'],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(tokens, null, 2) }] };
  }
);

server.tool(
  'isms_create_api_token',
  'Generate a new API token for the authenticated user (returns plaintext token string once).',
  {
    name: z.string().min(1).describe('Token description / name (e.g. CI/CD Pipeline, MCP Assistant)'),
    expires_at: z.string().optional().describe('Expiration ISO date (YYYY-MM-DD)'),
  },
  async ({ name, expires_at }, { mcpUser }) => {
    const { ApiToken } = getModels();
    const crypto = require('crypto');
    const userId = await getValidUserId(mcpUser);
    const tokenStr = 'isms_api_' + crypto.randomBytes(32).toString('hex');
    const newToken = await ApiToken.create({
      user_id: userId,
      name: name.trim(),
      token: null,
      token_hash: hashToken(tokenStr),
      token_prefix: tokenStr.slice(0, 17),
      expires_at: expires_at ? new Date(expires_at) : null,
    });
    await logAudit('create', 'api_token', newToken.id, newToken.name, { expires_at }, mcpUser);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          id: newToken.id,
          name: newToken.name,
          token_prefix: newToken.token_prefix,
          token: tokenStr,
          expires_at: newToken.expires_at,
          warning: 'Please save this token now. It cannot be retrieved again.',
        }, null, 2),
      }],
    };
  }
);

server.tool(
  'isms_revoke_api_token',
  'Revoke / delete an API token.',
  { id: z.number().int().describe('API Token ID') },
  async ({ id }, { mcpUser }) => {
    const { ApiToken } = getModels();
    const userId = mcpUser?.id;
    const where = { id };
    if (mcpUser?.role !== 'admin' && userId) where.user_id = userId;
    const token = await ApiToken.findOne({ where });
    if (!token) return { content: [{ type: 'text', text: 'API token not found' }], isError: true };
    await logAudit('delete', 'api_token', token.id, token.name, {}, mcpUser);
    await token.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Vendor Management & Triage ──────────────────────────────────────────────

server.tool(
  'isms_get_vendor',
  'Get full details of a single vendor / third-party processor including contacts, linked incidents, and VVT entries.',
  { id: z.number().int().describe('Vendor ID') },
  async ({ id }) => {
    const { Vendor, VendorContact, User, Incident, VvtEntry } = getModels();
    const item = await Vendor.findByPk(id, {
      include: [
        { model: VendorContact, as: 'contacts' },
        { model: User, as: 'assessedBy', attributes: ['id', 'name'] },
        { model: Incident, as: 'incidents', through: { attributes: [] } },
        { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_vendor',
  'Update vendor information (name, type, website, phone, address, notes).',
  {
    id: z.number().int().describe('Vendor ID'),
    name: z.string().optional(),
    type: z.string().optional(),
    website: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor } = getModels();
    const item = await Vendor.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'vendor', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vendor',
  'Delete a vendor from the register.',
  { id: z.number().int().describe('Vendor ID') },
  async ({ id }, { mcpUser }) => {
    const { Vendor } = getModels();
    const item = await Vendor.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    await logAudit('delete', 'vendor', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_add_vendor_contact',
  'Add a contact person to a vendor.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    name: z.string().min(1).describe('Contact person name'),
    email: z.string().optional(),
    phone: z.string().optional(),
    role: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const vendor = await Vendor.findByPk(args.vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const contact = await VendorContact.create(args);
    await logAudit('create', 'vendor', vendor.id, vendor.name, { action: 'add_contact', contact_name: contact.name }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(contact, null, 2) }] };
  }
);

server.tool(
  'isms_update_vendor_contact',
  'Update a vendor contact person.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    contact_id: z.number().int().describe('Contact ID'),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    role: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const vendor = await Vendor.findByPk(args.vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const contact = await VendorContact.findOne({ where: { id: args.contact_id, vendor_id: args.vendor_id } });
    if (!contact) return { content: [{ type: 'text', text: 'Contact not found' }], isError: true };
    const { vendor_id, contact_id, ...updates } = args;
    await contact.update(updates);
    await logAudit('update', 'vendor', vendor.id, vendor.name, { action: 'update_contact', contact_name: contact.name }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(contact, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vendor_contact',
  'Delete a vendor contact person.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    contact_id: z.number().int().describe('Contact ID'),
  },
  async ({ vendor_id, contact_id }, { mcpUser }) => {
    const { Vendor, VendorContact } = getModels();
    const vendor = await Vendor.findByPk(vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };
    const contact = await VendorContact.findOne({ where: { id: contact_id, vendor_id } });
    if (!contact) return { content: [{ type: 'text', text: 'Contact not found' }], isError: true };
    const contactName = contact.name;
    await contact.destroy();
    await logAudit('delete', 'vendor', vendor.id, vendor.name, { action: 'delete_contact', contact_name: contactName }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedContactId: contact_id }) }] };
  }
);

server.tool(
  'isms_list_vendor_triage_runs',
  'List AI contract analysis triage runs for a vendor.',
  { vendor_id: z.number().int().describe('Vendor ID') },
  async ({ vendor_id }) => {
    const { VendorTriageRun, Document, User } = getModels();
    const runs = await VendorTriageRun.findAll({
      where: { vendor_id },
      include: [
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(runs, null, 2) }] };
  }
);

server.tool(
  'isms_get_vendor_triage_run',
  'Get full analysis findings and summary of a specific vendor contract triage run.',
  {
    vendor_id: z.number().int().describe('Vendor ID'),
    run_id: z.number().int().describe('Triage run ID'),
  },
  async ({ vendor_id, run_id }) => {
    const { VendorTriageRun, VendorFinding, Document, User } = getModels();
    const run = await VendorTriageRun.findOne({
      where: { id: run_id, vendor_id },
      include: [
        { model: VendorFinding, as: 'findings' },
        { model: Document, as: 'document', attributes: ['id', 'original_name', 'mimetype', 'category'] },
        { model: User, as: 'triggeredBy', attributes: ['id', 'name'] },
      ],
      order: [[{ model: VendorFinding, as: 'findings' }, 'id', 'ASC']],
    });
    if (!run) return { content: [{ type: 'text', text: 'Triage run not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(run, null, 2) }] };
  }
);

server.tool(
  'isms_run_vendor_triage',
  'Start an AI contract analysis for a document already attached to a vendor. Runs asynchronously: '
  + 'this returns the created run immediately with status "pending" — poll isms_get_vendor_triage_run for findings. '
  + 'Consumes LLM budget, so it is gated on vendor_triage.run rather than on read access to the results.',
  {
    vendor_id: z.number().int().positive().describe('Vendor ID'),
    document_id: z.number().int().positive().describe('ID of a document attached to THIS vendor'),
    doc_type: z.string().optional().describe('Analysis profile key (see isms_get_triage_profiles); unknown values fall back to "other"'),
  },
  async ({ vendor_id, document_id, doc_type }, { mcpUser }) => {
    const { VendorTriageRun, Vendor, Document } = getModels();

    const vendor = await Vendor.findByPk(vendor_id);
    if (!vendor) return { content: [{ type: 'text', text: 'Vendor not found' }], isError: true };

    // Scoped to the vendor on purpose: without the vendor_id in the lookup this
    // would analyse any document in the installation by id.
    const doc = await Document.findOne({ where: { id: document_id, vendor_id } });
    if (!doc) return { content: [{ type: 'text', text: 'Document not found for this vendor' }], isError: true };

    const { getProfiles } = require('../services/triageProfiles');
    const profiles = await getProfiles();
    const resolvedDocType = typeof doc_type === 'string' && Object.hasOwn(profiles, doc_type) ? doc_type : 'other';

    const run = await VendorTriageRun.create({
      vendor_id,
      document_id: doc.id,
      doc_type: resolvedDocType,
      status: 'pending',
      triggered_by_id: await getValidUserId(mcpUser),
    });

    await logAudit('create', 'vendor', vendor_id, vendor.name, {
      action: 'triage_started', run_id: run.id, document: doc.original_name, via: 'mcp',
    }, mcpUser);

    // Same as the REST route: do not await, the analysis takes minutes.
    const { runTriage } = require('../services/vendorTriageService');
    runTriage(run.id).catch(err => console.error(`[Triage] MCP run ${run.id} failed:`, err.message));

    return { content: [{ type: 'text', text: JSON.stringify({
      run_id: run.id, vendor: vendor.name, document: doc.original_name,
      doc_type: resolvedDocType, status: 'pending',
      hint: 'Ergebnisse mit isms_get_vendor_triage_run abrufen, sobald der Status auf "done" steht.',
    }, null, 2) }] };
  }
);

server.tool(
  'isms_get_triage_profiles',
  'Get vendor contract analysis triage criteria profiles and reference baselines.',
  {},
  async () => {
    const { getProfiles } = require('../services/triageProfiles');
    const profiles = await getProfiles();
    return { content: [{ type: 'text', text: JSON.stringify(profiles, null, 2) }] };
  }
);

server.tool(
  'isms_update_triage_profiles',
  'Update vendor contract analysis triage criteria profiles (admin only).',
  { profiles: z.record(z.any()).describe('Custom profile overrides dictionary') },
  async ({ profiles }, { mcpUser }) => {
    const { saveProfiles } = require('../services/triageProfiles');
    const saved = await saveProfiles(profiles || {});
    await logAudit('update', 'settings', null, 'Vertragsanalyse-Profile', { profiles: Object.keys(saved) }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
  }
);

// ─── BCM & DORA Enhancements ─────────────────────────────────────────────────

server.tool(
  'isms_create_bcm_process',
  'Register a critical business process in the BIA (Business Impact Analysis) register.',
  {
    name: z.string().min(1).describe('Process name'),
    description: z.string().optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    rto_hours: z.number().optional().describe('Recovery Time Objective in hours'),
    rpo_hours: z.number().optional().describe('Recovery Point Objective in hours'),
    owner_id: z.number().int().optional(),
    dependencies: z.string().optional(),
    recovery_strategy: z.string().optional(),
    status: z.enum(['active', 'in_review', 'archived']).default('active'),
    last_test_date: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmProcess } = getModels();
    const item = await BcmProcess.create(args);
    await logAudit('create', 'bcm_process', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_bcm_process',
  'Update details, RTO, RPO, or recovery strategy of a BCM process.',
  {
    id: z.number().int().describe('BCM process ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    rto_hours: z.number().optional(),
    rpo_hours: z.number().optional(),
    owner_id: z.number().int().nullable().optional(),
    dependencies: z.string().optional(),
    recovery_strategy: z.string().optional(),
    status: z.enum(['active', 'in_review', 'archived']).optional(),
    last_test_date: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmProcess } = getModels();
    const item = await BcmProcess.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'BCM process not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'bcm_process', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_bcm_process',
  'Delete a BCM business process from the BIA register.',
  { id: z.number().int().describe('BCM process ID') },
  async ({ id }, { mcpUser }) => {
    const { BcmProcess } = getModels();
    const item = await BcmProcess.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'BCM process not found' }], isError: true };
    await logAudit('delete', 'bcm_process', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_update_bcm_exercise',
  'Update a BCM test, exercise, or drill record.',
  {
    id: z.number().int().describe('BCM exercise ID'),
    process_id: z.number().int().nullable().optional(),
    title: z.string().optional(),
    exercise_type: z.enum(['tabletop', 'simulation', 'parallel', 'full_interruption']).optional(),
    exercise_date: z.string().optional(),
    participants: z.string().optional(),
    result: z.enum(['passed', 'partially_passed', 'failed']).optional(),
    findings: z.string().optional(),
    actions: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BcmExercise } = getModels();
    const item = await BcmExercise.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'BCM exercise not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'bcm_exercise', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_bcm_exercise',
  'Delete a BCM exercise record.',
  { id: z.number().int().describe('BCM exercise ID') },
  async ({ id }, { mcpUser }) => {
    const { BcmExercise } = getModels();
    const item = await BcmExercise.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'BCM exercise not found' }], isError: true };
    await logAudit('delete', 'bcm_exercise', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_create_dora_third_party',
  'Register an ICT third-party service provider under DORA (EU 2022/2554) regulations.',
  {
    name: z.string().min(1).describe('Service provider name'),
    ict_service: z.string().min(1).describe('ICT service type (e.g. Cloud Hosting, Core Banking SaaS)'),
    criticality: z.enum(['critical', 'important', 'standard']).default('important'),
    contract_start: z.string().optional(),
    contract_end: z.string().optional(),
    country: z.string().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().optional(),
    sla_rto_hours: z.number().optional(),
    sla_rpo_hours: z.number().optional(),
    last_review_date: z.string().optional(),
    next_review_date: z.string().optional(),
    status: z.enum(['active', 'in_onboarding', 'terminated']).default('active'),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraThirdParty } = getModels();
    const item = await DoraThirdParty.create(args);
    await logAudit('create', 'dora_third_party', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_dora_third_party',
  'Update a DORA ICT third-party provider record.',
  {
    id: z.number().int().describe('DORA provider ID'),
    name: z.string().optional(),
    ict_service: z.string().optional(),
    criticality: z.enum(['critical', 'important', 'standard']).optional(),
    contract_start: z.string().optional(),
    contract_end: z.string().optional(),
    country: z.string().optional(),
    contact_name: z.string().optional(),
    contact_email: z.string().optional(),
    sla_rto_hours: z.number().optional(),
    sla_rpo_hours: z.number().optional(),
    last_review_date: z.string().optional(),
    next_review_date: z.string().optional(),
    status: z.enum(['active', 'in_onboarding', 'terminated']).optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraThirdParty } = getModels();
    const item = await DoraThirdParty.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'DORA third-party not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dora_third_party', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_dora_third_party',
  'Delete a DORA ICT third-party provider record.',
  { id: z.number().int().describe('DORA provider ID') },
  async ({ id }, { mcpUser }) => {
    const { DoraThirdParty } = getModels();
    const item = await DoraThirdParty.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'DORA third-party not found' }], isError: true };
    await logAudit('delete', 'dora_third_party', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_create_dora_test',
  'Register a DORA digital operational resilience test (Art. 24-26, e.g. vulnerability scan, TLPT, penetration test).',
  {
    title: z.string().min(1).describe('Test title'),
    test_type: z.enum(['vulnerability_scan', 'pentest', 'tlpt_threat_led', 'gap_analysis', 'scenario_test', 'source_code_review']).default('pentest'),
    test_date: z.string().min(1).describe('Date of test (YYYY-MM-DD)'),
    performed_by: z.string().optional().describe('Internal auditor or external security testing company'),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).default('planned'),
    result: z.enum(['passed', 'passed_with_findings', 'failed']).optional(),
    findings: z.string().optional(),
    remediation: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraResilienceTest } = getModels();
    const item = await DoraResilienceTest.create(args);
    await logAudit('create', 'dora_test', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_dora_test',
  'Update details, results, or remediation of a DORA resilience test.',
  {
    id: z.number().int().describe('DORA test ID'),
    title: z.string().optional(),
    test_type: z.enum(['vulnerability_scan', 'pentest', 'tlpt_threat_led', 'gap_analysis', 'scenario_test', 'source_code_review']).optional(),
    test_date: z.string().optional(),
    performed_by: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
    result: z.enum(['passed', 'passed_with_findings', 'failed']).optional(),
    findings: z.string().optional(),
    remediation: z.string().optional(),
    next_test_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { DoraResilienceTest } = getModels();
    const item = await DoraResilienceTest.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'DORA test not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dora_test', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_dora_test',
  'Delete a DORA resilience test record.',
  { id: z.number().int().describe('DORA test ID') },
  async ({ id }, { mcpUser }) => {
    const { DoraResilienceTest } = getModels();
    const item = await DoraResilienceTest.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'DORA test not found' }], isError: true };
    await logAudit('delete', 'dora_test', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Pentests (Update & Delete) ──────────────────────────────────────────────

server.tool(
  'isms_update_pentest',
  'Update an existing pentest project.',
  {
    id: z.number().int().describe('Pentest project ID'),
    title: z.string().optional(),
    scope: z.string().optional(),
    vendor: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'completed', 'retesting', 'closed']).optional(),
    report_url: z.string().optional(),
    owner_id: z.number().int().nullable().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { PentestProject } = getModels();
    const item = await PentestProject.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Pentest project not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'pentest_project', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_pentest',
  'Delete a pentest project and all of its associated findings.',
  { id: z.number().int().describe('Pentest project ID') },
  async ({ id }, { mcpUser }) => {
    const { PentestProject, PentestFinding } = getModels();
    const item = await PentestProject.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Pentest project not found' }], isError: true };
    await logAudit('delete', 'pentest_project', item.id, item.title, {}, mcpUser);
    await PentestFinding.destroy({ where: { project_id: id } });
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_delete_pentest_finding',
  'Delete a finding from a pentest project.',
  {
    project_id: z.number().int().describe('Pentest project ID'),
    id: z.number().int().describe('Finding ID'),
  },
  async ({ project_id, id }, { mcpUser }) => {
    const { PentestFinding } = getModels();
    const item = await PentestFinding.findOne({ where: { id, project_id } });
    if (!item) return { content: [{ type: 'text', text: 'Pentest finding not found' }], isError: true };
    await logAudit('delete', 'pentest_finding', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Policies & Templates (Delete) ───────────────────────────────────────────

server.tool(
  'isms_delete_policy',
  'Delete a security policy from the repository.',
  { id: z.number().int().describe('Policy ID') },
  async ({ id }, { mcpUser }) => {
    const { Policy } = getModels();
    const item = await Policy.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Policy not found' }], isError: true };
    await logAudit('delete', 'policy', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_policy_acknowledgments',
  'List employee acknowledgments / signatures for a specific security policy.',
  { id: z.number().int().describe('Policy ID') },
  async ({ id }) => {
    const { PolicyAcknowledgment, User } = getModels();
    const acks = await PolicyAcknowledgment.findAll({
      where: { policy_id: id },
      include: [{ model: User, attributes: ['id', 'name', 'email', 'department'] }],
      order: [['acknowledged_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(acks, null, 2) }] };
  }
);

server.tool(
  'isms_list_templates',
  'List policy and ISMS document templates available in the template library.',
  {},
  async () => {
    const { Template } = getModels();
    const items = await Template.findAll({ order: [['name', 'ASC']] });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_delete_template',
  'Delete a document template from the library.',
  { id: z.number().int().describe('Template ID') },
  async ({ id }, { mcpUser }) => {
    const { Template } = getModels();
    const item = await Template.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Template not found' }], isError: true };
    await logAudit('delete', 'template', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Audits, Findings & KPIs (Delete & Create) ───────────────────────────────

server.tool(
  'isms_delete_audit',
  'Delete a compliance audit.',
  { id: z.number().int().describe('Audit ID') },
  async ({ id }, { mcpUser }) => {
    const { Audit } = getModels();
    const item = await Audit.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Audit not found' }], isError: true };
    await logAudit('delete', 'audit', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_delete_audit_finding',
  'Delete an audit finding / deviation.',
  { id: z.number().int().describe('Audit finding ID') },
  async ({ id }, { mcpUser }) => {
    const { AuditFinding } = getModels();
    const item = await AuditFinding.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Audit finding not found' }], isError: true };
    await logAudit('delete', 'audit_finding', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_create_kpi',
  'Create a new security or compliance KPI metric to track.',
  {
    title: z.string().min(1).describe('KPI title'),
    description: z.string().optional(),
    target: z.number().describe('Target metric value'),
    current_value: z.number().default(0),
    status: z.enum(['green', 'yellow', 'red']).default('green'),
    owner_id: z.number().int().optional(),
  },
  async (args, { mcpUser }) => {
    const { Kpi } = getModels();
    const item = await Kpi.create(args);
    await logAudit('create', 'kpi', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_kpi',
  'Update an existing security KPI (target, current value, status, owner).',
  {
    id: z.number().int().describe('KPI ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    target: z.number().optional(),
    current_value: z.number().optional(),
    status: z.enum(['green', 'yellow', 'red']).optional(),
    owner_id: z.number().int().nullable().optional(),
  },
  async (args, { mcpUser }) => {
    const { Kpi } = getModels();
    const item = await Kpi.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'KPI not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'kpi', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_kpi',
  'Delete a security KPI metric.',
  { id: z.number().int().describe('KPI ID') },
  async ({ id }, { mcpUser }) => {
    const { Kpi } = getModels();
    const item = await Kpi.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'KPI not found' }], isError: true };
    await logAudit('delete', 'kpi', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Auto-Discovery Software Deletion ────────────────────────────────────────

server.tool(
  'isms_delete_discovered_software',
  'Delete a staged discovered host or software item from the discovery inbox.',
  { id: z.number().int().describe('Discovery item ID') },
  async ({ id }, { mcpUser }) => {
    const { DiscoveredSoftware } = getModels();
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Discovered software item not found' }], isError: true };
    await logAudit('delete', 'discovered_software', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);



// ─── Compliance Catalogs (ISO 27001, BSI, NIS-2, C5, TISAX) ────────────────

server.tool(
  'isms_list_iso27001_controls',
  'List all ISO 27001 Annex A controls including applicability, implementation status, owner, evidence, and notes.',
  {
    search: z.string().optional().describe('Search in control reference or title'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all').describe('Filter by implementation status'),
    applicable: z.boolean().optional().describe('Filter by applicability'),
    limit: z.number().int().min(1).max(500).default(100).describe('Max results'),
  },
  async ({ search, status, applicable, limit }) => {
    const { Iso27001Control, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (applicable !== undefined) where.applicable = applicable;
    if (search) {
      where[Op.or] = [
        { ref: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await Iso27001Control.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['ref', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_iso27001_control',
  'Update details, applicability, justification, or implementation status of an ISO 27001 Annex A control.',
  {
    id: z.number().int().describe('ISO 27001 control record ID'),
    applicable: z.boolean().optional().describe('Whether the control is applicable'),
    implementation_status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    justification: z.string().optional().describe('Justification for inclusion or exclusion'),
    owner_id: z.number().int().nullable().optional().describe('User ID of the control owner'),
    evidence: z.string().optional().describe('Audit evidence / documentation description'),
    notes: z.string().optional(),
    last_review_date: z.string().optional().describe('ISO date (YYYY-MM-DD) of last review'),
  },
  async (args, { mcpUser }) => {
    const { Iso27001Control, Control } = getModels();
    const item = await Iso27001Control.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'ISO 27001 control not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    const ISO_TO_SOA = { implemented: 'implemented', not_applicable: 'not_applicable', not_started: 'planned', in_progress: 'planned' };
    if (updates.implementation_status && ISO_TO_SOA[updates.implementation_status]) {
      Control.update(
        { status: ISO_TO_SOA[updates.implementation_status] },
        { where: { framework: 'iso27001', code: item.ref } }
      ).catch(() => {});
    }
    await logAudit('update', 'iso27001_control', item.id, item.ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_bsi_requirements',
  'List BSI IT-Grundschutz requirements and Bausteine with implementation status.',
  {
    search: z.string().optional().describe('Search in req_id, baustein_id, or title'),
    layer: z.string().optional().describe('Filter by layer (ISMS, ORG, CON, OPS, DER, APP, SYS, IND, INF, NET)'),
    status: z.enum(['ja', 'teilweise', 'nein', 'entbehrlich', 'all']).default('all').describe('Implementation status'),
    limit: z.number().int().min(1).max(500).default(100).describe('Max results'),
  },
  async ({ search, layer, status, limit }) => {
    const { BsiRequirement, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (layer) where.layer = layer;
    if (search) {
      where[Op.or] = [
        { req_id: { [Op.like]: `%${search}%` } },
        { baustein_id: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await BsiRequirement.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['layer', 'ASC'], ['baustein_id', 'ASC'], ['req_id', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_bsi_requirement',
  'Update implementation status or responsible person of a BSI IT-Grundschutz requirement.',
  {
    id: z.number().int().describe('BSI requirement ID'),
    implementation_status: z.enum(['ja', 'teilweise', 'nein', 'entbehrlich']).optional(),
    responsible_id: z.number().int().nullable().optional(),
    notes: z.string().optional(),
    last_review_date: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { BsiRequirement } = getModels();
    const item = await BsiRequirement.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'BSI requirement not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'bsi_requirement', item.id, item.req_id, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_nis2_measures',
  'List NIS-2 cybersecurity measures according to Art. 21 NIS-2 / § 30 BSIG.',
  {
    search: z.string().optional().describe('Search in article_ref or title'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, status, limit }) => {
    const { Nis2Measure, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (search) {
      where[Op.or] = [
        { article_ref: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await Nis2Measure.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['article_ref', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_nis2_measure',
  'Update implementation status, responsible person, deadline, or evidence of a NIS-2 measure.',
  {
    id: z.number().int().describe('NIS-2 measure ID'),
    implementation_status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    responsible_id: z.number().int().nullable().optional(),
    evidence: z.string().optional(),
    deadline: z.string().optional(),
    notes: z.string().optional(),
    last_review_date: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Nis2Measure } = getModels();
    const item = await Nis2Measure.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'NIS-2 measure not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'nis2_measure', item.id, item.article_ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_c5_criteria',
  'List BSI C5 (Cloud Computing Compliance Criteria Catalogue) criteria.',
  {
    search: z.string().optional().describe('Search in criterion_id or title'),
    domain: z.string().optional().describe('Filter by domain (e.g. OAS, OIS, SEC, CRY, …)'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, domain, status, limit }) => {
    const { C5Criterion, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.implementation_status = status;
    if (domain) where.domain = domain;
    if (search) {
      where[Op.or] = [
        { criterion_id: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await C5Criterion.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['domain', 'ASC'], ['criterion_id', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_c5_criterion',
  'Update implementation status, responsible person, or evidence of a C5 criterion.',
  {
    id: z.number().int().describe('C5 criterion ID'),
    implementation_status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    responsible_id: z.number().int().nullable().optional(),
    evidence: z.string().optional(),
    notes: z.string().optional(),
    last_review_date: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { C5Criterion } = getModels();
    const item = await C5Criterion.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'C5 criterion not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'c5_criterion', item.id, item.criterion_id, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_tisax_requirements',
  'List VDA-ISA requirements for TISAX assessment.',
  {
    search: z.string().optional().describe('Search in ref or title'),
    chapter: z.string().optional().describe('Filter by chapter'),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ search, chapter, status, limit }) => {
    const { TisaxRequirement } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (chapter) where.chapter = chapter;
    if (search) {
      where[Op.or] = [
        { ref: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await TisaxRequirement.findAll({ where, order: [['ref', 'ASC']], limit });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_update_tisax_requirement',
  'Update maturity level, target level, status, or notes of a TISAX VDA-ISA requirement.',
  {
    id: z.number().int().describe('TISAX requirement ID'),
    maturity_level: z.number().min(0).max(5).optional(),
    target_level: z.number().min(0).max(5).optional(),
    status: z.enum(['not_started', 'in_progress', 'implemented', 'not_applicable']).optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { TisaxRequirement } = getModels();
    const item = await TisaxRequirement.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'TISAX requirement not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'tisax_requirement', item.id, item.ref, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_list_tisax_assessments',
  'List TISAX assessment projects and label tracking records.',
  {
    status: z.enum(['planned', 'in_progress', 'passed', 'failed', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(50),
  },
  async ({ status, limit }) => {
    const { TisaxAssessment, User } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    const items = await TisaxAssessment.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['created_at', 'DESC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_create_tisax_assessment',
  'Register a new TISAX assessment / label tracking project.',
  {
    scope_description: z.string().min(1).describe('Assessment scope description'),
    assessment_level: z.enum(['AL1', 'AL2', 'AL3']).default('AL2'),
    label_requested: z.string().optional().describe('E.g. Info High, Info Very High, Prototype, Data Protection'),
    status: z.enum(['planned', 'in_progress', 'passed', 'failed']).default('planned'),
    auditor_company: z.string().optional().describe('Audit provider / testing service provider'),
    assessment_date: z.string().optional().describe('ISO date of audit'),
    label_valid_until: z.string().optional().describe('ISO date of validity (usually 3 years)'),
    owner_id: z.number().int().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { TisaxAssessment } = getModels();
    const item = await TisaxAssessment.create(args);
    await logAudit('create', 'tisax_assessment', item.id, `TISAX Assessment ${item.id}`, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_tisax_assessment',
  'Update an existing TISAX assessment record.',
  {
    id: z.number().int().describe('TISAX assessment ID'),
    scope_description: z.string().optional(),
    assessment_level: z.enum(['AL1', 'AL2', 'AL3']).optional(),
    label_requested: z.string().optional(),
    status: z.enum(['planned', 'in_progress', 'passed', 'failed']).optional(),
    auditor_company: z.string().optional(),
    assessment_date: z.string().optional(),
    label_valid_until: z.string().optional(),
    owner_id: z.number().int().nullable().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { TisaxAssessment } = getModels();
    const item = await TisaxAssessment.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'TISAX assessment not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'tisax_assessment', item.id, `TISAX Assessment ${item.id}`, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_tisax_assessment',
  'Delete a TISAX assessment record.',
  { id: z.number().int().describe('TISAX assessment ID') },
  async ({ id }, { mcpUser }) => {
    const { TisaxAssessment } = getModels();
    const item = await TisaxAssessment.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'TISAX assessment not found' }], isError: true };
    await logAudit('delete', 'tisax_assessment', item.id, `TISAX Assessment ${item.id}`, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Framework Mappings ──────────────────────────────────────────────────────

server.tool(
  'isms_lookup_framework_mappings',
  'Look up cross-framework mappings for a specific control reference across ISO 27001, NIS-2, BSI IT-Grundschutz, and C5.',
  {
    framework: z.enum(['iso27001', 'nis2', 'bsi_grundschutz', 'c5']).describe('Source framework'),
    ref: z.string().min(1).describe('Control reference code (e.g. 5.1, A.5.1, OPS.1.1.4.A1, CRY-01)'),
  },
  async ({ framework, ref }) => {
    const controlMappings = require('../services/controlMappings');
    const { Iso27001Control, Nis2Measure, BsiRequirement, C5Criterion } = getModels();
    const related = controlMappings.lookup(framework, ref);

    const [isoDb, nisDb, bsiDb, c5Db] = await Promise.all([
      Iso27001Control.findAll({ attributes: ['ref', 'implementation_status'] }).catch(() => []),
      Nis2Measure.findAll({ attributes: ['article_ref', 'implementation_status'] }).catch(() => []),
      BsiRequirement.findAll({ attributes: ['req_id', 'implementation_status'] }).catch(() => []),
      C5Criterion.findAll({ attributes: ['criterion_id', 'implementation_status'] }).catch(() => []),
    ]);

    const statusMap = {
      iso27001: new Map(isoDb.map(x => [x.ref, x.implementation_status])),
      nis2: new Map(nisDb.map(x => [x.article_ref, x.implementation_status])),
      bsi_grundschutz: new Map(bsiDb.map(x => [x.req_id, x.implementation_status])),
      c5: new Map(c5Db.map(x => [x.criterion_id, x.implementation_status])),
    };

    const enriched = related.map(m => ({
      framework: m.framework,
      ref: m.ref,
      type: m.type,
      status: statusMap[m.framework]?.get(m.ref) || 'not_started',
    }));

    return { content: [{ type: 'text', text: JSON.stringify({ framework, ref, related: enriched }, null, 2) }] };
  }
);

server.tool(
  'isms_get_framework_mapping_stats',
  'Get statistics on cross-framework control mappings between ISO 27001, NIS-2, BSI IT-Grundschutz, and C5.',
  {},
  async () => {
    const controlMappings = require('../services/controlMappings');
    return { content: [{ type: 'text', text: JSON.stringify(controlMappings.stats(), null, 2) }] };
  }
);

server.tool(
  'isms_get_framework_mapping_overview',
  'Get a complete overview table matrix of cross-framework control mappings.',
  {},
  async () => {
    const controlMappings = require('../services/controlMappings');
    const { Iso27001Control, Nis2Measure, BsiRequirement, C5Criterion } = getModels();

    const [isoControls, nisMeasures, bsiReqs, c5Criteria] = await Promise.all([
      Iso27001Control.findAll({ attributes: ['ref', 'title', 'implementation_status'] }).catch(() => []),
      Nis2Measure.findAll({ attributes: ['article_ref', 'title', 'implementation_status'] }).catch(() => []),
      BsiRequirement.findAll({ attributes: ['req_id', 'title', 'implementation_status'] }).catch(() => []),
      C5Criterion.findAll({ attributes: ['criterion_id', 'title', 'implementation_status'] }).catch(() => []),
    ]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          stats: controlMappings.stats(),
          iso27001Count: isoControls.length,
          nis2Count: nisMeasures.length,
          bsiCount: bsiReqs.length,
          c5Count: c5Criteria.length,
        }, null, 2),
      }],
    };
  }
);

// ─── Awareness & Trainings ───────────────────────────────────────────────────

server.tool(
  'isms_list_training_courses',
  'List compliance and security training courses / curriculum with assignment and completion stats.',
  {
    search: z.string().optional().describe('Search in training title or description'),
    mandatory: z.boolean().optional().describe('Filter by mandatory flag'),
    limit: z.number().int().min(1).max(500).default(50),
  },
  async ({ search, mandatory, limit }) => {
    const { Training, UserTraining, User } = getModels();
    const where = {};
    if (mandatory !== undefined) where.mandatory = mandatory;
    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await Training.findAll({
      where,
      include: [{
        model: UserTraining,
        as: 'assignments',
        include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'department'] }]
      }],
      order: [['date', 'DESC']],
      limit,
    });
    const formatted = items.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      date: t.date,
      mandatory: t.mandatory,
      total_assigned: t.assignments?.length || 0,
      total_completed: (t.assignments || []).filter(a => a.completed_at !== null).length,
      assignments: t.assignments,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
  }
);

server.tool(
  'isms_create_training_course',
  'Create a new security awareness or compliance training course in the catalog.',
  {
    title: z.string().min(1).describe('Training title (e.g. Information Security Awareness 2026)'),
    description: z.string().optional().describe('Training course description and learning objectives'),
    date: z.string().min(1).describe('Training date or deadline (YYYY-MM-DD)'),
    mandatory: z.boolean().default(true).describe('Whether this training is mandatory for employees'),
  },
  async (args, { mcpUser }) => {
    const { Training } = getModels();
    const item = await Training.create(args);
    await logAudit('create', 'training', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_training_course',
  'Update an existing training course details.',
  {
    id: z.number().int().describe('Training course ID'),
    title: z.string().optional(),
    description: z.string().optional(),
    date: z.string().optional(),
    mandatory: z.boolean().optional(),
  },
  async (args, { mcpUser }) => {
    const { Training, UserTraining } = getModels();
    const item = await Training.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Training course not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    if (updates.title) {
      await UserTraining.update({ training_title: updates.title }, { where: { training_id: item.id } });
    }
    await logAudit('update', 'training', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_training_course',
  'Delete a training course and cancel associated tasks.',
  { id: z.number().int().describe('Training course ID') },
  async ({ id }, { mcpUser }) => {
    const { Training, Task } = getModels();
    const item = await Training.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Training course not found' }], isError: true };
    await Task.update(
      { status: 'cancelled' },
      { where: { related_type: 'training', related_id: id, status: { [Op.notIn]: ['done', 'cancelled'] } } }
    );
    await logAudit('delete', 'training', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_list_user_trainings',
  'List user training participation and completion records.',
  {
    user_id: z.number().int().optional().describe('Filter by specific user ID'),
    training_id: z.number().int().optional().describe('Filter by training course ID'),
    status: z.enum(['pending', 'valid', 'expired', 'all']).default('all'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ user_id, training_id, status, limit }) => {
    const { UserTraining, User, Training } = getModels();
    const where = {};
    if (user_id) where.user_id = user_id;
    if (training_id) where.training_id = training_id;
    if (status && status !== 'all') where.status = status;
    const items = await UserTraining.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'name', 'email', 'department'] },
        { model: Training, as: 'training' },
      ],
      order: [['completed_at', 'DESC'], ['created_at', 'DESC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_record_user_training',
  'Record a training completion or assign a training to a registered user or external employee.',
  {
    user_id: z.number().int().nullable().optional().describe('User ID if registered user'),
    training_id: z.number().int().nullable().optional().describe('Training course ID'),
    training_title: z.string().optional().describe('Title of training if not linked to course ID'),
    employee_name: z.string().optional().describe('External employee name'),
    employee_email: z.string().optional().describe('External employee email'),
    completed_at: z.string().nullable().optional().describe('ISO date (YYYY-MM-DD) of completion'),
    expires_at: z.string().nullable().optional().describe('ISO date (YYYY-MM-DD) of validity expiration'),
    certificate_url: z.string().optional(),
    status: z.enum(['pending', 'valid', 'expired']).default('valid'),
  },
  async (args, { mcpUser }) => {
    const { UserTraining, Training } = getModels();
    const data = { ...args };
    if (data.training_id && !data.training_title) {
      const tr = await Training.findByPk(data.training_id);
      if (tr) data.training_title = tr.title;
    }
    if (data.completed_at) {
      data.status = 'valid';
    } else {
      data.status = 'pending';
    }
    const item = await UserTraining.create(data);
    await logAudit('create', 'user_training', item.id, item.training_title || 'Training Record', args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_user_training',
  'Update an individual user training record (completion date, expiration, certificate).',
  {
    id: z.number().int().describe('User training record ID'),
    completed_at: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    certificate_url: z.string().optional(),
    status: z.enum(['pending', 'valid', 'expired']).optional(),
  },
  async (args, { mcpUser }) => {
    const { UserTraining } = getModels();
    const item = await UserTraining.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'User training record not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.completed_at !== undefined) {
      updates.status = updates.completed_at ? 'valid' : 'pending';
    }
    await item.update(updates);
    await logAudit('update', 'user_training', item.id, item.training_title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_user_training',
  'Delete a user training record.',
  { id: z.number().int().describe('User training record ID') },
  async ({ id }, { mcpUser }) => {
    const { UserTraining } = getModels();
    const item = await UserTraining.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'User training record not found' }], isError: true };
    await logAudit('delete', 'user_training', item.id, item.training_title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Audit Logs & Verification ──────────────────────────────────────────────

server.tool(
  'isms_list_audit_logs',
  'Query immutable ISMS audit log entries with filters.',
  {
    entity_type: z.string().optional().describe('Filter by entity type (asset, risk, incident, user, etc.)'),
    action: z.string().optional().describe('Filter by action (create, update, delete, assess, signoff, etc.)'),
    actor_id: z.number().int().optional().describe('Filter by actor user ID'),
    search: z.string().optional().describe('Search in entity name'),
    from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  },
  async ({ entity_type, action, actor_id, search, from, to, limit, offset }) => {
    const { AuditLog } = getModels();
    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (action) where.action = action;
    if (actor_id) where.actor_id = actor_id;
    if (search) where.entity_name = { [Op.like]: `%${search}%` };
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) where.created_at[Op.lte] = new Date(to + 'T23:59:59');
    }
    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return { content: [{ type: 'text', text: JSON.stringify({ total: count, logs: rows }, null, 2) }] };
  }
);

server.tool(
  'isms_verify_audit_logs',
  'Verify the cryptographic HMAC tamper-evidence integrity chain of the entire ISMS audit log.',
  {},
  async () => {
    const { AuditLog } = getModels();
    const { verifyAuditRow } = require('../services/auditService');
    const BATCH = 1000;
    let offset = 0, total = 0, intact = 0, tampered = 0, unverifiable = 0;
    const tamperedIds = [];
    for (;;) {
      const rows = await AuditLog.findAll({ order: [['id', 'ASC']], limit: BATCH, offset });
      if (rows.length === 0) break;
      for (const row of rows) {
        total++;
        const result = verifyAuditRow(row);
        if (result === null) unverifiable++;
        else if (result) intact++;
        else { tampered++; if (tamperedIds.length < 100) tamperedIds.push(row.id); }
      }
      offset += rows.length;
      if (rows.length < BATCH) break;
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total,
          intact,
          tampered,
          unverifiable,
          tamperedIds,
          isCompromised: tampered > 0,
        }, null, 2),
      }],
    };
  }
);

// ─── Legal Requirements / Rechtskataster ────────────────────────────────────

server.tool(
  'isms_list_legal_requirements',
  'List legal and regulatory compliance requirements in the legal register (Rechtskataster).',
  {
    category: z.string().optional().describe('Filter by category (e.g. Datenschutz, IT-Sicherheit, Arbeitsrecht)'),
    status: z.enum(['compliant', 'partially_compliant', 'non_compliant', 'not_applicable', 'all']).default('all'),
    search: z.string().optional().describe('Search in title or description'),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ category, status, search, limit }) => {
    const { LegalRequirement, User } = getModels();
    const where = {};
    if (category) where.category = category;
    if (status && status !== 'all') where.status = status;
    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }
    const items = await LegalRequirement.findAll({
      where,
      include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'email'] }],
      order: [['title', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_create_legal_requirement',
  'Add a new legal requirement or regulation to the legal register.',
  {
    title: z.string().min(1).describe('Law / Regulation title (e.g. DSGVO, BSIG, TKG, NIS-2-Umsetzungsgesetz)'),
    category: z.string().optional().describe('Category (e.g. IT-Sicherheit, Datenschutz, Branchenrecht)'),
    description: z.string().optional(),
    reference_url: z.string().optional(),
    applicable_since: z.string().optional().describe('ISO date (YYYY-MM-DD)'),
    review_date: z.string().optional().describe('Next review date (YYYY-MM-DD)'),
    owner_id: z.number().int().optional(),
    status: z.enum(['compliant', 'partially_compliant', 'non_compliant', 'not_applicable']).default('compliant'),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { LegalRequirement } = getModels();
    const item = await LegalRequirement.create(args);
    await logAudit('create', 'legal_requirement', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_legal_requirement',
  'Update a legal requirement in the legal register.',
  {
    id: z.number().int().describe('Legal requirement ID'),
    title: z.string().optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    reference_url: z.string().optional(),
    applicable_since: z.string().optional(),
    review_date: z.string().optional(),
    owner_id: z.number().int().nullable().optional(),
    status: z.enum(['compliant', 'partially_compliant', 'non_compliant', 'not_applicable']).optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { LegalRequirement } = getModels();
    const item = await LegalRequirement.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Legal requirement not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'legal_requirement', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_legal_requirement',
  'Delete a legal requirement from the legal register.',
  { id: z.number().int().describe('Legal requirement ID') },
  async ({ id }, { mcpUser }) => {
    const { LegalRequirement } = getModels();
    const item = await LegalRequirement.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Legal requirement not found' }], isError: true };
    await logAudit('delete', 'legal_requirement', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── GDPR Data Flows & DSFA ──────────────────────────────────────────────────

server.tool(
  'isms_list_dataflows',
  'List data flow mappings between systems and assets in compliance with GDPR Art. 30.',
  {
    status: z.enum(['active', 'planned', 'deprecated', 'all']).default('all'),
    contains_personal_data: z.boolean().optional(),
    limit: z.number().int().min(1).max(500).default(100),
  },
  async ({ status, contains_personal_data, limit }) => {
    const { DataFlow, Asset } = getModels();
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (contains_personal_data !== undefined) where.contains_personal_data = contains_personal_data;
    const items = await DataFlow.findAll({
      where,
      include: [
        { model: Asset, as: 'source', attributes: ['id', 'name', 'type'] },
        { model: Asset, as: 'target', attributes: ['id', 'name', 'type'] },
      ],
      order: [['name', 'ASC']],
      limit,
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_get_dataflow',
  'Get full details of a specific data flow.',
  { id: z.number().int().describe('Data flow ID') },
  async ({ id }) => {
    const { DataFlow, Asset } = getModels();
    const item = await DataFlow.findByPk(id, {
      include: [
        { model: Asset, as: 'source', attributes: ['id', 'name', 'type'] },
        { model: Asset, as: 'target', attributes: ['id', 'name', 'type'] },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'Data flow not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_create_dataflow',
  'Register a new data flow between source and target assets/systems.',
  {
    name: z.string().min(1).describe('Data flow name'),
    description: z.string().optional(),
    source_id: z.number().int().optional().describe('Source asset ID'),
    target_id: z.number().int().optional().describe('Target asset ID'),
    data_categories: z.string().optional().describe('Categories of transferred data'),
    transfer_mechanism: z.string().optional().describe('E.g. REST API, SFTP, Direct DB, Kafka'),
    encryption: z.string().optional().describe('E.g. TLS 1.3, AES-256, None'),
    frequency: z.string().optional().describe('E.g. Real-time, Hourly, Daily batch'),
    contains_personal_data: z.boolean().default(false),
    notes: z.string().optional(),
    status: z.enum(['active', 'planned', 'deprecated']).default('active'),
  },
  async (args, { mcpUser }) => {
    const { DataFlow } = getModels();
    const item = await DataFlow.create(args);
    await logAudit('create', 'dataflow', item.id, item.name, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_dataflow',
  'Update details of an existing data flow.',
  {
    id: z.number().int().describe('Data flow ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    source_id: z.number().int().nullable().optional(),
    target_id: z.number().int().nullable().optional(),
    data_categories: z.string().optional(),
    transfer_mechanism: z.string().optional(),
    encryption: z.string().optional(),
    frequency: z.string().optional(),
    contains_personal_data: z.boolean().optional(),
    notes: z.string().optional(),
    status: z.enum(['active', 'planned', 'deprecated']).optional(),
  },
  async (args, { mcpUser }) => {
    const { DataFlow } = getModels();
    const item = await DataFlow.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'Data flow not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dataflow', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_dataflow',
  'Delete a data flow record.',
  { id: z.number().int().describe('Data flow ID') },
  async ({ id }, { mcpUser }) => {
    const { DataFlow } = getModels();
    const item = await DataFlow.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Data flow not found' }], isError: true };
    await logAudit('delete', 'dataflow', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_vvt_entry',
  'Get full details of a single VVT processing activity (Verarbeitungstätigkeit) including linked assets and processors.',
  { id: z.number().int().describe('VVT entry ID') },
  async ({ id }) => {
    const { VvtEntry, User, Vendor, Asset } = getModels();
    const item = await VvtEntry.findByPk(id, {
      include: [
        { model: User, as: 'responsible', attributes: ['id', 'name', 'email'] },
        { model: Vendor, as: 'processor', attributes: ['id', 'name'] },
        { model: Asset, as: 'assets', attributes: ['id', 'name'], through: { attributes: [] } },
        { model: Vendor, as: 'vendors', attributes: ['id', 'name'], through: { attributes: [] } },
      ],
    });
    if (!item) return { content: [{ type: 'text', text: 'VVT entry not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_vvt_entry',
  'Update a GDPR Record of Processing Activities (VVT) entry.',
  {
    id: z.number().int().describe('VVT entry ID'),
    name: z.string().optional(),
    purpose: z.string().optional(),
    legal_basis: z.string().optional(),
    data_categories: z.string().optional(),
    special_categories: z.string().optional(),
    data_subjects: z.string().optional(),
    recipients: z.string().optional(),
    third_country_transfers: z.string().optional(),
    transfer_safeguards: z.string().optional(),
    retention_period: z.string().optional(),
    retention_legal_basis: z.string().optional(),
    deletion_procedure: z.string().optional(),
    security_measures: z.string().optional(),
    responsible_id: z.number().int().nullable().optional(),
    processor_id: z.number().int().nullable().optional(),
    status: z.enum(['draft', 'in_review', 'active', 'archived']).optional(),
    notes: z.string().optional(),
    dsfa_required: z.boolean().optional(),
    last_review_date: z.string().optional(),
    asset_ids: z.array(z.number().int()).optional(),
    vendor_ids: z.array(z.number().int()).optional(),
  },
  async (args, { mcpUser }) => {
    const { VvtEntry } = getModels();
    const item = await VvtEntry.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'VVT entry not found' }], isError: true };
    const { id, asset_ids, vendor_ids, ...updates } = args;
    await item.update(updates);
    if (Array.isArray(asset_ids)) await item.setAssets(asset_ids);
    if (Array.isArray(vendor_ids)) await item.setVendors(vendor_ids);
    await logAudit('update', 'vvt', item.id, item.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vvt_entry',
  'Delete a VVT entry from the GDPR register.',
  { id: z.number().int().describe('VVT entry ID') },
  async ({ id }, { mcpUser }) => {
    const { VvtEntry } = getModels();
    const item = await VvtEntry.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'VVT entry not found' }], isError: true };
    await logAudit('delete', 'vvt', item.id, item.name, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_get_vvt_dsfa',
  'Get the DSFA (Data Protection Impact Assessment / Datenschutz-Folgenabschätzung) for a VVT entry.',
  { vvt_id: z.number().int().describe('VVT entry ID') },
  async ({ vvt_id }) => {
    const { Dsfa, User } = getModels();
    const item = await Dsfa.findOne({
      where: { vvt_id },
      include: [{ model: User, as: 'approver', attributes: ['id', 'name'] }],
    });
    if (!item) return { content: [{ type: 'text', text: 'No DSFA found for this VVT entry' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_create_vvt_dsfa',
  'Create a DSFA (Data Protection Impact Assessment) according to GDPR Art. 35 for a VVT entry.',
  {
    vvt_id: z.number().int().describe('VVT entry ID'),
    title: z.string().min(1).describe('DSFA assessment title'),
    processing_description: z.string().optional(),
    necessity_assessment: z.string().optional(),
    risks_identified: z.string().optional(),
    measures_taken: z.string().optional(),
    residual_risk: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
    dpa_consultation_required: z.boolean().default(false),
    status: z.enum(['draft', 'in_review', 'approved', 'rejected']).default('draft'),
    approver_id: z.number().int().optional(),
    approval_date: z.string().optional(),
    next_review_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Dsfa } = getModels();
    const existing = await Dsfa.findOne({ where: { vvt_id: args.vvt_id } });
    if (existing) return { content: [{ type: 'text', text: 'DSFA already exists for this VVT entry' }], isError: true };
    const item = await Dsfa.create(args);
    await logAudit('create', 'dsfa', item.id, item.title, args, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_update_vvt_dsfa',
  'Update an existing DSFA assessment.',
  {
    id: z.number().int().describe('DSFA ID'),
    title: z.string().optional(),
    processing_description: z.string().optional(),
    necessity_assessment: z.string().optional(),
    risks_identified: z.string().optional(),
    measures_taken: z.string().optional(),
    residual_risk: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    dpa_consultation_required: z.boolean().optional(),
    status: z.enum(['draft', 'in_review', 'approved', 'rejected']).optional(),
    approver_id: z.number().int().nullable().optional(),
    approval_date: z.string().optional(),
    next_review_date: z.string().optional(),
    notes: z.string().optional(),
  },
  async (args, { mcpUser }) => {
    const { Dsfa } = getModels();
    const item = await Dsfa.findByPk(args.id);
    if (!item) return { content: [{ type: 'text', text: 'DSFA not found' }], isError: true };
    const { id, ...updates } = args;
    await item.update(updates);
    await logAudit('update', 'dsfa', item.id, item.title, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
  }
);

server.tool(
  'isms_delete_vvt_dsfa',
  'Delete a DSFA record.',
  { id: z.number().int().describe('DSFA ID') },
  async ({ id }, { mcpUser }) => {
    const { Dsfa } = getModels();
    const item = await Dsfa.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'DSFA not found' }], isError: true };
    await logAudit('delete', 'dsfa', item.id, item.title, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_delete_subject_request',
  'Delete a GDPR Subject Access Request (Betroffenenanfrage).',
  { id: z.number().int().describe('Subject request ID') },
  async ({ id }, { mcpUser }) => {
    const { SubjectRequest } = getModels();
    const item = await SubjectRequest.findByPk(id);
    if (!item) return { content: [{ type: 'text', text: 'Subject request not found' }], isError: true };
    await logAudit('delete', 'subject_request', item.id, item.ref, {}, mcpUser);
    await item.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

// ─── Settings, Custom Roles & Automation ─────────────────────────────────────

server.tool(
  'isms_get_settings',
  'Get general system settings (appName, review intervals, audit retention, SSO configuration, etc.).',
  {},
  async () => {
    const { getGeneral } = require('../services/settingsService');
    const settings = await getGeneral();
    return { content: [{ type: 'text', text: JSON.stringify(settings, null, 2) }] };
  }
);

server.tool(
  'isms_update_settings',
  'Update general system settings (admin only).',
  {
    appName: z.string().optional(),
    reviewIntervalMonths: z.number().int().min(1).max(60).optional(),
    ssoAutoProvision: z.boolean().optional(),
    ssoDefaultRole: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).optional(),
    ssoAllowedDomains: z.string().optional(),
    ssoStrictRoleSync: z.boolean().optional(),
    auditLogRetentionMonths: z.number().int().min(3).max(120).optional(),
  },
  async (args, { mcpUser }) => {
    const { getGeneral, setGeneral } = require('../services/settingsService');
    const before = await getGeneral();
    const saved = await setGeneral(args);
    await logAudit('update', 'settings', null, 'Allgemeine Einstellungen', { before, after: saved }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(saved, null, 2) }] };
  }
);

server.tool(
  'isms_get_permissions',
  'Get the role permissions matrix mapping system actions to roles.',
  {},
  async () => {
    const { getPermissions, DEFAULT_PERMISSIONS } = require('../services/settingsService');
    const permissions = await getPermissions();
    return { content: [{ type: 'text', text: JSON.stringify({ permissions, defaults: DEFAULT_PERMISSIONS }, null, 2) }] };
  }
);

server.tool(
  'isms_update_permissions',
  'Update the role permissions matrix (admin only).',
  { permissions: z.record(z.any()).describe('Permissions matrix object') },
  async ({ permissions }, { mcpUser }) => {
    const { getPermissions, setPermissions } = require('../services/settingsService');
    const { invalidatePermissionCache } = require('../services/permissionService');
    const before = await getPermissions();
    const saved = await setPermissions(permissions);
    invalidatePermissionCache();
    await logAudit('update', 'settings', null, 'Rollen & Rechte', { before, after: saved }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ permissions: saved }, null, 2) }] };
  }
);

server.tool(
  'isms_list_custom_roles',
  'List custom user roles and their assigned permission matrices.',
  {},
  async () => {
    const { CustomRole, User } = getModels();
    const roles = await CustomRole.findAll({ order: [['name', 'ASC']] });
    const counts = await User.findAll({
      attributes: ['custom_role_id', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'cnt']],
      where: { custom_role_id: { [Op.ne]: null } },
      group: ['custom_role_id'],
      raw: true,
    });
    const countMap = Object.fromEntries(counts.map(c => [c.custom_role_id, parseInt(c.cnt)]));
    const result = roles.map(r => ({ ...r.toJSON(), users_count: countMap[r.id] || 0 }));
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'isms_create_custom_role',
  'Create a custom user role with specific permissions (admin only).',
  {
    name: z.string().min(1).describe('Custom role name'),
    description: z.string().optional(),
    base_role: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).default('viewer'),
    permissions: z.record(z.any()).optional().describe('Custom permissions matrix override'),
  },
  async (args, { mcpUser }) => {
    const { CustomRole } = getModels();
    const { sanitizeMatrix, invalidatePermissionCache } = require('../services/permissionService');
    const role = await CustomRole.create({
      name: args.name.trim(),
      description: args.description || null,
      base_role: args.base_role,
      permissions: sanitizeMatrix(args.permissions),
    });
    invalidatePermissionCache();
    await logAudit('create', 'custom_role', role.id, role.name, { permissions: role.permissions }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(role, null, 2) }] };
  }
);

server.tool(
  'isms_update_custom_role',
  'Update a custom user role (admin only).',
  {
    id: z.number().int().describe('Custom role ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    base_role: z.enum(['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'viewer', 'employee']).optional(),
    permissions: z.record(z.any()).optional(),
  },
  async (args, { mcpUser }) => {
    const { CustomRole, User } = getModels();
    const { sanitizeMatrix, invalidatePermissionCache } = require('../services/permissionService');
    const role = await CustomRole.findByPk(args.id);
    if (!role) return { content: [{ type: 'text', text: 'Custom role not found' }], isError: true };
    const { id, ...updates } = args;
    if (updates.permissions) updates.permissions = sanitizeMatrix(updates.permissions);
    const beforeBaseRole = role.base_role;
    await role.update(updates);
    if (updates.base_role && updates.base_role !== beforeBaseRole) {
      await User.update({ role: updates.base_role }, { where: { custom_role_id: role.id } });
    }
    invalidatePermissionCache();
    await logAudit('update', 'custom_role', role.id, role.name, updates, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(role, null, 2) }] };
  }
);

server.tool(
  'isms_delete_custom_role',
  'Delete a custom role (admin only).',
  { id: z.number().int().describe('Custom role ID') },
  async ({ id }, { mcpUser }) => {
    const { CustomRole, User } = getModels();
    const { invalidatePermissionCache } = require('../services/permissionService');
    const role = await CustomRole.findByPk(id);
    if (!role) return { content: [{ type: 'text', text: 'Custom role not found' }], isError: true };
    const name = role.name;
    await User.update({ custom_role_id: null }, { where: { custom_role_id: role.id } });
    await role.destroy();
    invalidatePermissionCache();
    await logAudit('delete', 'custom_role', id, name, {}, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedId: id }) }] };
  }
);

server.tool(
  'isms_run_automation',
  'Trigger background automation rules manually (generating recurring tasks, review reminders, and CVE status updates).',
  {},
  async (args, { mcpUser }) => {
    const { runTaskAutomation } = require('../services/taskAutomationService');
    await runTaskAutomation();
    await logAudit('execute', 'settings', null, 'Task-Automatisierung manuell gestartet', {}, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Automation executed successfully' }) }] };
  }
);

// ─── Comments & Documents ────────────────────────────────────────────────────

server.tool(
  'isms_list_asset_comments',
  'List comments and meeting notes for a specific asset.',
  { asset_id: z.number().int().describe('Asset ID') },
  async ({ asset_id }) => {
    const { Comment, User } = getModels();
    const comments = await Comment.findAll({
      where: { asset_id },
      include: [{ model: User, as: 'author', attributes: ['id', 'name', 'role'] }],
      order: [['created_at', 'ASC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }] };
  }
);

server.tool(
  'isms_add_asset_comment',
  'Add a meeting note or comment to an asset, supporting @mentions and auto-task checkboxes ("- [ ] @mention Task").',
  {
    asset_id: z.number().int().describe('Asset ID'),
    content: z.string().min(1).describe('Comment content / meeting notes'),
    meeting_date: z.string().optional().describe('Optional ISO meeting date (YYYY-MM-DD)'),
    parent_id: z.number().int().optional().describe('Parent comment ID if thread reply'),
  },
  async ({ asset_id, content, meeting_date, parent_id }, { mcpUser }) => {
    const { Comment, Asset } = getModels();
    const asset = await Asset.findByPk(asset_id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };
    const userId = await getValidUserId(mcpUser);
    const comment = await Comment.create({
      asset_id,
      user_id: userId,
      parent_id: parent_id || null,
      content: content.trim(),
      meeting_date: meeting_date || null,
    });
    await logAudit('create', 'asset', asset.id, asset.name, { action: 'add_comment', comment_id: comment.id }, mcpUser);
    return { content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }] };
  }
);

server.tool(
  'isms_delete_asset_comment',
  'Delete a comment or meeting note from an asset.',
  {
    asset_id: z.number().int().describe('Asset ID'),
    comment_id: z.number().int().describe('Comment ID'),
  },
  async ({ asset_id, comment_id }, { mcpUser }) => {
    const { Comment, Asset } = getModels();
    const comment = await Comment.findOne({ where: { id: comment_id, asset_id } });
    if (!comment) return { content: [{ type: 'text', text: 'Comment not found' }], isError: true };
    const asset = await Asset.findByPk(asset_id);
    await comment.destroy();
    if (asset) {
      await logAudit('delete', 'asset', asset.id, asset.name, { action: 'delete_comment', comment_id }, mcpUser);
    }
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedCommentId: comment_id }) }] };
  }
);

server.tool(
  'isms_list_documents',
  'List attached documents and metadata for an asset, vendor, or incident.',
  {
    entity_type: z.enum(['asset', 'vendor', 'incident']).describe('Entity type'),
    entity_id: z.number().int().describe('Entity ID'),
  },
  async ({ entity_type, entity_id }) => {
    const { Document, User } = getModels();
    const where = {};
    if (entity_type === 'asset') where.asset_id = entity_id;
    if (entity_type === 'vendor') where.vendor_id = entity_id;
    if (entity_type === 'incident') where.incident_id = entity_id;
    const items = await Document.findAll({
      where,
      include: [{ model: User, as: 'uploader', attributes: ['id', 'name'] }],
      order: [['created_at', 'DESC']],
    });
    return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
  }
);

server.tool(
  'isms_delete_document',
  'Delete an uploaded document attachment and its file from storage.',
  { doc_id: z.number().int().describe('Document record ID') },
  async ({ doc_id }, { mcpUser }) => {
    const { Document } = getModels();
    const doc = await Document.findByPk(doc_id);
    if (!doc) return { content: [{ type: 'text', text: 'Document not found' }], isError: true };
    const fs = require('fs');
    const path = require('path');
    const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
    if (doc.filename) {
      const filePath = path.join(UPLOAD_DIR, path.basename(doc.filename));
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { console.warn('Could not delete file:', e.message); }
    }
    await logAudit('delete', 'document', doc.id, doc.original_name, {}, mcpUser);
    await doc.destroy();
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, deletedDocId: doc_id }) }] };
  }
);


// ─── HTTP Transport & Router ─────────────────────────────────────────────────

const sessions = new Map(); // sessionId → StreamableHTTPServerTransport
const sseTransports = new Map(); // sessionId → SSEServerTransport

function createServerInstance() {
  const connectionServer = new McpServer({
    name: 'OpenISMS',
    version: (() => {
      try {
        const fs = require('fs');
        const path = require('path');
        return fs.readFileSync(path.join(__dirname, '../../../VERSION'), 'utf8').trim();
      } catch { return '2.2.22'; }
    })(),
  });

  for (const args of toolsToRegister) {
    connectionServer.tool(...args);
  }

  return connectionServer;
}

function createMcpRouter() {
  const { apiLimiter } = require('../middleware/rateLimiter');
  const router = express.Router();

  // CORS for MCP endpoints: external MCP clients (Claude Desktop, claude.ai, other
  // third-party MCP hosts) can call this from any origin, so we deliberately don't
  // restrict Origin the way the main frontend API does (index.js, APP_URL allowlist).
  // `credentials: true` was previously combined with a reflect-any-origin policy,
  // which CodeQL correctly flags as a permissive-CORS misconfiguration (alert #251):
  // that combination lets any web page make credentialed (cookie-bearing) cross-
  // origin requests. This router never reads cookies for auth (see getTokenFromHeaders
  // above -- Authorization header, X-API-Key/X-MCP-Key headers, or a GET-only query
  // token), so `credentials: true` served no purpose here and is removed.
  router.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'x-api-key',
      'x-mcp-key',
      'mcp-session-id',
      'MCP-Session-Id',
      'last-event-id',
      'Last-Event-ID',
      'mcp-protocol-version',
      'MCP-Protocol-Version',
      'Accept',
      'Origin',
    ],
    exposedHeaders: ['mcp-session-id', 'MCP-Session-Id', 'WWW-Authenticate'],
  }));

  router.use(apiLimiter);
  router.use(express.json({ limit: '10mb' }));
  router.use(mcpAuth);

  // POST / (and /mcp) — Streamable HTTP client -> server messages (also initializes session)
  router.post('/', async (req, res) => {
    const existingId = req.headers['mcp-session-id'];
    let transport = existingId ? sessions.get(existingId) : null;

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      const connectionServer = createServerInstance();
      await connectionServer.connect(transport);
    }

    req.auth = req.mcpUser;
    req._mcpUser = req.mcpUser;
    await transport.handleRequest(req, res, req.body);
  });

  // GET / (and /mcp) — SSE event stream (server -> client)
  router.get('/', async (req, res) => {
    const id = req.headers['mcp-session-id'];
    const transport = id && sessions.get(id);
    if (transport) {
      req.auth = req.mcpUser;
      req._mcpUser = req.mcpUser;
      return await transport.handleRequest(req, res);
    }

    // Standard SSE client initialization (e.g. mcp-remote, Claude Desktop)
    const sseTransport = new SSEServerTransport('/mcp/messages', res);
    sseTransports.set(sseTransport.sessionId, sseTransport);
    res.on('close', () => {
      sseTransports.delete(sseTransport.sessionId);
    });

    const connectionServer = createServerInstance();
    await connectionServer.connect(sseTransport);
  });

  // GET /sse (and /mcp/sse) — explicit SSE stream initialization
  router.get('/sse', async (req, res) => {
    const sseTransport = new SSEServerTransport('/mcp/messages', res);
    sseTransports.set(sseTransport.sessionId, sseTransport);
    res.on('close', () => {
      sseTransports.delete(sseTransport.sessionId);
    });

    const connectionServer = createServerInstance();
    await connectionServer.connect(sseTransport);
  });

  // POST /messages (and /mcp/messages) — legacy SSE message endpoint
  router.post('/messages', async (req, res) => {
    const sessionId = String(req.query.sessionId || req.headers['mcp-session-id'] || '').trim();
    const transport = sessionId && sseTransports.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: 'MCP: SSE session not found or expired' });
    }
    req.auth = req.mcpUser;
    req._mcpUser = req.mcpUser;
    await transport.handlePostMessage(req, res, req.body);
  });

  // DELETE / (and /mcp) — terminate Streamable HTTP session
  router.delete('/', async (req, res) => {
    const id = req.headers['mcp-session-id'];
    if (id && sessions.has(id)) {
      await sessions.get(id).close();
      sessions.delete(id);
    }
    res.status(200).end();
  });

  return router;
}

module.exports = { createMcpRouter };
