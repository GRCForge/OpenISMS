'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { randomUUID, timingSafeEqual } = require('crypto');
const { z } = require('zod');
const { Op } = require('sequelize');
const express = require('express');
const jwt = require('jsonwebtoken');

// ─── Auth ────────────────────────────────────────────────────────────────────

async function mcpAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'MCP: Authorization header required' });
  }

  // Option A: static MCP_SECRET (timing-safe comparison to prevent timing attacks)
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const tokenBuf  = Buffer.from(token,  'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
      req.mcpUser = { id: 0, name: 'MCP Client', role: 'admin' };
      return next();
    }
  }

  // Option B: regular API Token (isms_api_...)
  // Validate format before DB lookup: prefix + 64 lowercase hex chars
  if (token.startsWith('isms_api_')) {
    if (!/^isms_api_[0-9a-f]{64}$/.test(token)) {
      return res.status(401).json({ error: 'MCP: Invalid token' });
    }
    try {
      const { ApiToken, User } = getModels();
      const dbToken = await ApiToken.findOne({ where: { token } });
      if (!dbToken) {
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
        return res.status(401).json({ error: 'MCP: Token expired' });
      }

      const user = await User.findByPk(dbToken.user_id);
      if (!user || !user.active) {
        return res.status(401).json({ error: 'MCP: User not found or inactive' });
      }

      req.mcpUser = { id: user.id, name: user.name, role: user.role };
      return next();
    } catch (e) {
      return res.status(500).json({ error: `MCP: Auth error: ${e.message}` });
    }
  }

  // Option C: regular JWT issued by /api/auth/login
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    req.mcpUser = payload;
    return next();
  } catch {
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
  // --- Assets ---
  'isms_create_asset': { needsWrite: true },
  'isms_update_asset': { needsWrite: true },
  'isms_refresh_asset_cves': { needsWrite: true },
  'isms_refresh_all_asset_cves': { requiredRoles: ['admin', 'it-staff'] },

  // --- Risks ---
  'isms_create_risk': { needsWrite: true },

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
      const mcpUser = context?.mcpUser || context?._mcpUser;
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
      return originalCallback(args, context || {});
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
  async (args) => {
    const { Risk } = getModels();
    const score = args.inherent_likelihood * args.inherent_impact;
    const level = score <= 4 ? 'low' : score <= 9 ? 'medium' : score <= 16 ? 'high' : 'critical';
    const risk = await Risk.create({
      ...args,
      inherent_level: level,
      residual_likelihood: args.inherent_likelihood,
      residual_impact: args.inherent_impact,
      residual_level: level,
      status: 'open',
    });
    return { content: [{ type: 'text', text: JSON.stringify(risk, null, 2) }] };
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

// ─── HTTP Transport & Router ─────────────────────────────────────────────────

const sessions = new Map(); // sessionId → StreamableHTTPServerTransport

function createMcpRouter() {
  const { apiLimiter } = require('../middleware/rateLimiter');
  const router = express.Router();
  router.use(apiLimiter);
  router.use(express.json());
  router.use(mcpAuth);

  // POST /mcp — client → server messages (also establishes SSE upgrade)
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

      const connectionServer = new McpServer({
        name: 'OpenISMS',
        version: (() => {
          try {
            const fs = require('fs');
            const path = require('path');
            return fs.readFileSync(path.join(__dirname, '../../../VERSION'), 'utf8').trim();
          } catch { return '2.1.0'; }
        })(),
      });

      for (const args of toolsToRegister) {
        connectionServer.tool(...args);
      }

      await connectionServer.connect(transport);
    }

    // Pass mcpUser via extra context for tools that need it
    req._mcpUser = req.mcpUser;
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE event stream (server → client)
  router.get('/', async (req, res) => {
    const id = req.headers['mcp-session-id'];
    const transport = id && sessions.get(id);
    if (!transport) return res.status(400).json({ error: 'No active MCP session. POST first.' });
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — terminate session
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
