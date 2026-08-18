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
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
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
  const queryToken = req.query?.token || req.query?.apiKey || req.query?.api_key || req.query?.access_token || req.query?.key;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
};

async function mcpAuth(req, res, next) {
  // Allow preflight OPTIONS requests without requiring authentication
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Allow OAuth/OIDC discovery probes to return 404 cleanly instead of 401
  if (req.path.includes('/.well-known') || String(req.originalUrl || '').includes('/.well-known')) {
    return res.status(404).type('application/json').json({
      error: 'not_found',
      message: 'OAuth 2.0 metadata discovery is not implemented on this endpoint. Use static Bearer token authentication.'
    });
  }

  const token = getTokenFromHeaders(req);

  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="OpenISMS MCP"');
    return res.status(401).json({ error: 'MCP: Authorization header or token required' });
  }

  // Option A: static MCP_SECRET (timing-safe comparison to prevent timing attacks)
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const tokenBuf  = Buffer.from(token,  'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
      req.mcpUser = { id: 0, name: 'MCP Client', role: 'admin' };
      req.auth = req.mcpUser;
      req._mcpUser = req.mcpUser;
      return next();
    }
  }

  // Option B: regular API Token (isms_api_...)
  // Validate format before DB lookup: prefix + 64 lowercase hex chars
  if (token.startsWith('isms_api_')) {
    if (!/^isms_api_[0-9a-f]{64}$/.test(token)) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Invalid token format"');
      return res.status(401).json({ error: 'MCP: Invalid token' });
    }
    try {
      const { ApiToken, User } = getModels();
      const dbToken = await ApiToken.findOne({ where: { token_hash: hashToken(token) } });
      if (!dbToken) {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Token not found"');
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
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Token expired"');
        return res.status(401).json({ error: 'MCP: Token expired' });
      }

      const user = await User.findByPk(dbToken.user_id);
      if (!user || !user.active) {
        res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="User inactive"');
        return res.status(401).json({ error: 'MCP: User not found or inactive' });
      }

      req.mcpUser = { id: user.id, name: user.name, role: user.role };
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
      res.setHeader('WWW-Authenticate', 'Bearer error="insufficient_scope", error_description="MFA required"');
      return res.status(401).json({ error: 'MCP: Two-factor authentication required' });
    }
    // Re-validate the user against the DB so deactivated/role-changed accounts
    // lose access immediately instead of until token expiry.
    const { User } = getModels();
    const user = await User.findByPk(payload.id);
    if (!user || !user.active) {
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="User inactive"');
      return res.status(401).json({ error: 'MCP: User not found or inactive' });
    }
    req.mcpUser = { id: user.id, name: user.name, role: user.role };
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
        const user = await User.findOne({ where: { email } });
        if (user && user.active) {
          req.mcpUser = { id: user.id, name: user.name, role: user.role };
          req.auth = req.mcpUser;
          req._mcpUser = req.mcpUser;
          return next();
        }
      }
    } catch {
      // OIDC validation skipped or failed
    }

    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Invalid or expired token"');
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
  'isms_create_asset': { needsWrite: true },
  'isms_update_asset': { needsWrite: true },
  'isms_delete_asset': { requiredRoles: ['admin'], needsWrite: true },
  'isms_refresh_asset_cves': { needsWrite: true },
  'isms_refresh_all_asset_cves': { requiredRoles: ['admin', 'it-staff'] },
  'isms_suggest_cpe': { moduleKey: 'discovery' },
  'isms_resolve_cpe': { moduleKey: 'discovery', needsWrite: true },
  'isms_create_assessment': { requiredRoles: ['admin', 'assessor'], needsWrite: true },

  // --- Risks ---
  'isms_create_risk': { needsWrite: true },
  'isms_update_risk': { needsWrite: true },
  'isms_signoff_risk': { requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_revoke_risk_signoff': { requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_delete_risk': { requiredRoles: ['admin'], needsWrite: true },

  // --- Management Reviews ---
  'isms_create_review_signoff': { requiredRoles: ['admin', 'assessor'], needsWrite: true },

  // --- Incidents ---
  'isms_create_incident': { needsWrite: true },
  'isms_update_incident_status': { needsWrite: true },
  'isms_update_incident': { needsWrite: true },

  // --- Tasks ---
  'isms_create_task': { needsWrite: true },
  'isms_complete_task': { needsWrite: true },

  // --- Controls ---
  'isms_update_control_status': { needsWrite: true },
  'isms_update_control': { needsWrite: true },

  // --- EU AI Act ---
  'isms_list_ai_systems': { moduleKey: 'ai_act' },
  'isms_create_ai_system': { moduleKey: 'ai_act', needsWrite: true },
  'isms_update_ai_system': { moduleKey: 'ai_act', needsWrite: true },
  'isms_delete_ai_system': { moduleKey: 'ai_act', requiredRoles: ['admin', 'assessor'], needsWrite: true },

  // --- Policies ---
  'isms_create_policy': { requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_update_policy': { requiredRoles: ['admin', 'assessor', 'owner'], needsWrite: true },
  'isms_acknowledge_policy': { needsWrite: true },

  // --- Audits, CAPA & KPIs ---
  'isms_create_audit': { requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_audit': { requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_create_audit_finding': { requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_update_audit_finding': { requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_record_kpi_measurement': { needsWrite: true },

  // --- Settings / Admin ---
  'isms_set_feature_status': { requiredRoles: ['admin'] },

  // --- Pentests ---
  'isms_list_pentests': { moduleKey: 'pentest' },
  'isms_create_pentest': { moduleKey: 'pentest', requiredRoles: ['admin', 'assessor'], needsWrite: true },
  'isms_list_pentest_findings': { moduleKey: 'pentest' },
  'isms_create_pentest_finding': { moduleKey: 'pentest', needsWrite: true },
  'isms_update_pentest_finding': { moduleKey: 'pentest', needsWrite: true },

  // --- GDPR / DSGVO ---
  'isms_list_vvt_entries': { moduleKey: 'dsgvo' },
  'isms_create_vvt_entry': { moduleKey: 'dsgvo', requiredRoles: ['admin', 'assessor', 'dpo'], needsWrite: true },
  'isms_list_subject_requests': { moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo', 'assessor'] },
  'isms_create_subject_request': { moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },
  'isms_update_subject_request_status': { moduleKey: 'dsgvo', requiredRoles: ['admin', 'dpo'], needsWrite: true },

  // --- Vendors ---
  'isms_create_vendor': { requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },
  'isms_assess_vendor': { requiredRoles: ['admin', 'assessor', 'it-staff', 'dpo'], needsWrite: true },

  // --- BCM ---
  'isms_list_bcm_processes': { moduleKey: 'bcm' },
  'isms_list_bcm_exercises': { moduleKey: 'bcm' },
  'isms_create_bcm_exercise': { moduleKey: 'bcm', requiredRoles: ['admin', 'assessor'], needsWrite: true },

  // --- DORA ---
  'isms_list_dora_third_parties': { moduleKey: 'dora' },
  'isms_list_dora_tests': { moduleKey: 'dora' },

  // --- Auto-Discovery ---
  'isms_list_discovered_software': { moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'] },
  'isms_approve_discovered_software': { moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
  'isms_ignore_discovered_software': { moduleKey: 'discovery', requiredRoles: ['admin', 'it-staff'], needsWrite: true },
};

async function gateTool(mcpUser, moduleKey = null, requiredRoles = null, needsWrite = false) {
  if (moduleKey) {
    const { getModules } = require('../middleware/modules');
    const modules = await getModules();
    if (!modules[moduleKey]) {
      return { content: [{ type: 'text', text: `Zugriff verweigert: Das Modul '${moduleKey}' ist im ISMS nicht aktiviert.` }], isError: true };
    }
  }

  const role = mcpUser?.role || 'viewer';

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
          gate.needsWrite || false
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
        { model: Assessment, as: 'assessments', limit: 1, order: [['created_at', 'DESC']] },
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
    owner_id:       z.number().int().optional().describe('User ID of the asset owner'),
    rto:            z.string().optional().describe('Recovery Time Objective (Wiederanlaufzeit, e.g. 4h)'),
    rpo:            z.string().optional().describe('Recovery Point Objective (Datenverlust-Toleranz, e.g. 1h)'),
    sdo:            z.string().optional().describe('Service Delivery Objective (Mindest-Service-Level im Notbetrieb, e.g. 24h)'),
    mto:            z.string().optional().describe('Maximum Tolerable Outage (Maximal tolerierbare Ausfallzeit, e.g. 48h)'),
    ioa:            z.string().optional().describe('Impact of Activity / Disruption (Ausfallwirkung, e.g. High)'),
  },
  async (args) => {
    const { Asset } = getModels();
    const asset = await Asset.create({ ...args, status: 'active' });
    return { content: [{ type: 'text', text: JSON.stringify(asset, null, 2) }] };
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
  },
  async ({ id, ...updates }) => {
    const { Asset } = getModels();
    const asset = await Asset.findByPk(id);
    if (!asset) return { content: [{ type: 'text', text: 'Asset not found' }], isError: true };

    if (updates.lifecycle_status === 'archived') {
      updates.status = 'inactive';
    } else if (updates.lifecycle_status && ['production', 'maintenance', 'evaluation'].includes(updates.lifecycle_status)) {
      if (asset.status === 'inactive') updates.status = 'active';
    }

    await asset.update(updates);
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

  // Dedicated permissive CORS for MCP endpoints
  router.use(cors({
    origin: true,
    credentials: true,
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
