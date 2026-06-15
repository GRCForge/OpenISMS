require('dotenv').config();
require('./services/logger');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { apiLimiter, heavyLimiter: sharedHeavyLimiter } = require('./middleware/rateLimiter');
const session = require('express-session');
const passport = require('passport');
const { sequelize } = require('./models');
const { startReminderService } = require('./services/reminderService');
const { runTaskAutomation } = require('./services/taskAutomationService');
const { seedCatalog } = require('./services/catalogSeed');
const cron = require('node-cron');
const { Op } = require('sequelize');

const compression = require('compression');

const app = express();

// Trust reverse proxy headers (e.g. X-Forwarded-For, X-Forwarded-Proto).
// WICHTIG: kein pauschales `true` — damit wäre req.ip der vom Client frei
// wählbare linkeste X-Forwarded-For-Eintrag und IP-basierte Rate-Limits
// liessen sich durch Header-Spoofing umgehen. Standard: genau 1 Proxy-Hop
// (nginx/Traefik vor dem Container); über TRUST_PROXY_HOPS anpassbar.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

app.use(compression());

app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

const allowedOrigins = (process.env.APP_URL || 'http://localhost:3000').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));

// Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

const sessionSecret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
if (!sessionSecret) { console.error('FATAL: SESSION_SECRET or JWT_SECRET must be set'); process.exit(1); }
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  // Secure-Cookies nur hinter HTTPS aktivieren (SECURE_COOKIES=true). Standard
  // false, damit der Betrieb hinter HTTP (z.B. Unraid ohne Reverse-Proxy) funktioniert.
  //
  // sameSite MUSS 'lax' sein (nicht 'strict'): Der OIDC-Flow leitet den Browser
  // zum externen Identity-Provider (z.B. Azure/Entra) und wieder zurueck. Bei
  // 'strict' wuerde der Browser das Session-Cookie beim Ruecksprung von der
  // fremden Domain NICHT mitsenden -> state/PKCE-Verifier waeren weg und der
  // Callback schluege fehl. 'lax' erlaubt das Cookie bei Top-Level-GET-Navigation
  // (genau der OAuth-Redirect) und blockt weiterhin Cross-Site-POST (CSRF).
  cookie: {
    secure: process.env.SECURE_COOKIES === 'true',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Login-Limiter zählt pro Account (E-Mail) statt nur pro IP — reine IP-Limits
// liessen sich via X-Forwarded-For-Rotation umgehen, wenn trust proxy falsch
// konfiguriert ist. Fallback auf IP, wenn keine E-Mail im Body steht.
const emailOrIpKey = (req) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (email) return `acct:${email}`;
  return typeof rateLimit.ipKeyGenerator === 'function' ? rateLimit.ipKeyGenerator(req.ip) : req.ip;
};
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: emailOrIpKey, message: { error: 'Zu viele Anmeldeversuche. Bitte warte 15 Minuten.' } });
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' } });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/login/totp', strictLimiter);
app.use('/api/auth/passkey/login-verify', strictLimiter);
app.use('/api/auth/2fa', strictLimiter);

// Belt-and-suspenders: heavy paths also guarded at the app level.
// Each router file applies its own limiter directly for CodeQL compliance (CWE-770).
app.use('/api/admin/backup', sharedHeavyLimiter);
app.use('/api/import', sharedHeavyLimiter);
app.use('/api/report', sharedHeavyLimiter);
app.use('/api/discovery', sharedHeavyLimiter);
app.use('/api/dashboard', sharedHeavyLimiter);
app.use('/api', apiLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/auth/oidc', require('./routes/authOidc'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/report', require('./routes/report'));
app.use('/api/reminders', require('./routes/reminders'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/risks', require('./routes/risks'));
app.use('/api/controls', require('./routes/controls'));
app.use('/api/threats', require('./routes/threats'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/audit-log', require('./routes/auditlog'));
app.use('/api/assets/:assetId/documents', require('./routes/documents'));
app.use('/api/vendors/:vendorId/documents', require('./routes/documents'));
app.use('/api/incidents/:incidentId/documents', require('./routes/documents'));
app.use('/api/assets/:assetId/comments', require('./routes/comments'));
app.use('/api/compliance', require('./routes/compliance'));
app.use('/api/import', require('./routes/import'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/policies', require('./routes/policies'));
app.use('/api/admin/backup', require('./routes/backup'));
const { requireModule } = require('./middleware/modules');
app.use('/api/vvt', requireModule('dsgvo'), require('./routes/vvt'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/dataflows', requireModule('dsgvo'), require('./routes/dataflows'));
app.use('/api/auth/passkey', require('./routes/passkey'));
app.use('/api/auth/tokens', require('./routes/tokens'));
app.use('/api/me', require('./routes/me'));
app.use('/api/discovery', requireModule('discovery'), require('./routes/discovery'));
app.use('/api/subject-requests', requireModule('dsgvo'), require('./routes/subject-requests'));
app.use('/api/legal-requirements', require('./routes/legal-requirements'));
app.use('/api/review', require('./routes/review'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/pentests', requireModule('pentest'), require('./routes/pentests'));
app.use('/api/tisax', requireModule('tisax'), require('./routes/tisax'));
app.use('/api/dora', requireModule('dora'), require('./routes/dora'));
app.use('/api/ai-act', requireModule('ai_act'), require('./routes/ai-act'));
app.use('/api/bcm', requireModule('bcm'), require('./routes/bcm'));
app.use('/api/iso27001', requireModule('iso27001'), require('./routes/iso27001'));
app.use('/api/bsi-grundschutz', requireModule('bsi_grundschutz'), require('./routes/bsi-grundschutz'));
app.use('/api/nis2', requireModule('nis2'), require('./routes/nis2'));
app.use('/api/c5', requireModule('c5'), require('./routes/c5'));
app.use('/api/mappings', require('./routes/mappings'));

// Browser Push Notifications (Web Push API / VAPID)
app.use('/api/push', require('./routes/push'));

// MCP (Model Context Protocol) server — HTTP/SSE transport
// Auth: Authorization: Bearer <MCP_SECRET>  or  Bearer <JWT>
app.use('/mcp', require('./mcp/server').createMcpRouter());

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// OpenAPI spec + Swagger-UI (CDN-based, no extra npm packages needed)
app.get('/api/openapi.json', (req, res) => {
  const filePath = require('path').join(__dirname, 'openapi.json');
  if (req.query.download === '1') {
    res.download(filePath, 'openapi.json');
  } else {
    res.sendFile(filePath);
  }
});
app.get('/api/docs', (req, res) => {
  const base = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
  res.type('html').send(`<!DOCTYPE html><html><head>
  <title>ISMS API Dokumentation</title><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
  </style>
  </head><body>
  <div style="background:#0f172a; padding:12px 24px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#fff;">
    <span style="font-weight:bold; font-size:15px; letter-spacing:0.5px; display:inline-flex; align-items:center; gap:8px;">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      ISMS API Dokumentation (OpenAPI 3.0)
    </span>
    <a href="${base}/api/openapi.json?download=1" style="background:#2563eb; color:#fff; text-decoration:none; padding:8px 16px; font-size:12px; border-radius:6px; font-weight:bold; display:inline-flex; align-items:center; gap:6px; transition: background 0.2s;" onmouseover="this.style.backgroundColor='#1d4ed8'" onmouseout="this.style.backgroundColor='#2563eb'">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Spezifikation herunterladen
    </a>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
  SwaggerUIBundle({
    url:"${base}/api/openapi.json",dom_id:'#swagger-ui',
    presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout:"BaseLayout",persistAuthorization:true,tryItOutEnabled:true,
    requestInterceptor:(req)=>{const t=localStorage.getItem('isms_token');if(t)req.headers['Authorization']='Bearer '+t;return req;}
  });
  </script></body></html>`);
});

// App-Version aus der VERSION-Datei (im Container nach /app/VERSION kopiert,
// lokal im Repo-Root). Fallback: APP_VERSION env oder 'dev'.
app.get('/api/version', (req, res) => {
  const fsv = require('fs'); const pathv = require('path');
  let version = process.env.APP_VERSION || 'dev';
  for (const p of [pathv.join(__dirname, '../VERSION'), pathv.join(__dirname, '../../VERSION')]) {
    try { const v = fsv.readFileSync(p, 'utf8').trim(); if (v) { version = v; break; } } catch { /* ignore */ }
  }
  res.json({ version });
});

// Single-Container-Deployment: gebautes Frontend aus ./public ausliefern.
// Existiert das Verzeichnis nicht (z.B. reines API-Setup), wird es uebersprungen.
const path = require('path');
const fs = require('fs');
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '../public');
if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  app.use(express.static(PUBLIC_DIR));
  // SPA-Fallback: alle GET-Routen ausserhalb von /api auf index.html (Client-Routing)
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  console.log(`[Static] Serving frontend from ${PUBLIC_DIR}`);
}

const PORT = process.env.PORT || 3001;

const connectWithRetry = async (maxRetries = 10, delayMs = 3000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sequelize.authenticate();
      console.log('Database connected');
      return;
    } catch (e) {
      if (attempt === maxRetries) throw e;
      console.log(`DB connection attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
};

// Drop duplicate non-primary indexes on a table (accumulated by sequelize.sync alter:true).
// MySQL allows max 64 keys per table — duplicate UNIQUE indexes cause ER_TOO_MANY_KEYS.
const cleanupDuplicateIndexes = async (tableName) => {
  try {
    const [rows] = await sequelize.query(`SHOW INDEX FROM \`${tableName}\``); // NOSONAR(javascript:S3649) - tableName is a hardcoded string literal, not user input
    const byColumn = {};
    for (const r of rows) {
      if (r.Key_name === 'PRIMARY') continue;
      (byColumn[r.Column_name] = byColumn[r.Column_name] || []).push(r.Key_name);
    }
    for (const [col, keys] of Object.entries(byColumn)) {
      // Keep the last key (usually the original constraint); drop all prior duplicates
      for (const key of keys.slice(0, -1)) {
        await sequelize.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${key}\``); // NOSONAR(javascript:S3649) - tableName hardcoded; key from SHOW INDEX output
        console.log(`[DB] Removed duplicate index \`${key}\` on ${tableName}.${col}`);
      }
    }
  } catch { /* table may not exist yet on first run */ }
};

const start = async () => {
  try {
    await connectWithRetry();

    // Data Cleanup: Fix orphaned references before sync
    try {
      // Fix assets -> vendors
      await sequelize.query('UPDATE assets SET vendor_id = NULL WHERE vendor_id IS NOT NULL AND vendor_id NOT IN (SELECT id FROM vendors)');
      console.log('[DB] Cleaned up orphaned vendor_id references in assets table');
      
      // Fix VendorContacts -> vendors
      // Sequelize might use "VendorContacts" or "vendor_contacts"
      const [tables] = await sequelize.query("SHOW TABLES LIKE 'VendorContacts'");
      const tableName = tables.length > 0 ? 'VendorContacts' : 'vendor_contacts';
      await sequelize.query(`DELETE FROM \`${tableName}\` WHERE vendor_id NOT IN (SELECT id FROM vendors)`); // NOSONAR(javascript:S3649) - tableName is 'VendorContacts' or 'vendor_contacts' (hardcoded strings)
      console.log(`[DB] Cleaned up orphaned references in ${tableName} table`);
    } catch (e) {
      /* ignore if tables don't exist yet */
      console.log('[DB] Cleanup skipped (tables might not exist yet)');
    }

    // Purge duplicate indexes before sync to avoid ER_TOO_MANY_KEYS (MySQL max 64 keys)
    for (const table of ['users', 'passkey_credentials', 'assets', 'vendors', 'risks', 'controls', 'incidents']) {
      await cleanupDuplicateIndexes(table);
    }

    // Ensure ENUMs are updated (Sequelize alter often fails for ENUMs in MySQL)
    await sequelize.query(`
      ALTER TABLE vendors MODIFY COLUMN type ENUM(
        'it_provider', 'software_vendor', 'hardware_vendor', 'cloud_provider',
        'support', 'consultant', 'other', 'software', 'cloud', 'hardware', 'consulting', 'hosting', 'logistics'
      ) DEFAULT 'other'
    `).catch(e => console.warn('[DB] Could not alter vendors.type:', e.message));

    // Convert vvt_entries.legal_basis from ENUM to VARCHAR(255)
    await sequelize.query(`
      ALTER TABLE vvt_entries MODIFY COLUMN legal_basis VARCHAR(255) DEFAULT 'legitimate_interests'
    `).catch(e => console.warn('[DB] Could not alter vvt_entries.legal_basis:', e.message));

    // Convert audit_logs action/entity_type from ENUM to VARCHAR(64) to support all action strings
    await sequelize.query(`
      ALTER TABLE audit_logs MODIFY COLUMN action VARCHAR(64) NOT NULL
    `).catch(e => console.warn('[DB] Could not alter audit_logs.action:', e.message));
    await sequelize.query(`
      ALTER TABLE audit_logs MODIFY COLUMN entity_type VARCHAR(64) NOT NULL
    `).catch(e => console.warn('[DB] Could not alter audit_logs.entity_type:', e.message));

    await sequelize.query(`
      ALTER TABLE users MODIFY COLUMN role ENUM('admin','owner','assessor','viewer','it-staff','dpo','employee','management') NOT NULL DEFAULT 'viewer'
    `).catch(e => console.warn('[DB] Could not alter users.role:', e.message));

    await sequelize.query(`
      ALTER TABLE tasks MODIFY COLUMN assigned_role ENUM('admin','owner','assessor','viewer','it-staff','dpo','employee','management')
    `).catch(e => console.warn('[DB] Could not alter tasks.assigned_role:', e.message));

    // Drop old camelCase columns from push_subscriptions
    await sequelize.query(`
      ALTER TABLE push_subscriptions DROP COLUMN createdAt, DROP COLUMN updatedAt
    `).catch(e => {});

    await sequelize.sync({ alter: { drop: false } });
    console.log('Database synchronized (no-drop mode)');

    // Ensure unique index for user_id and endpoint on push_subscriptions
    await sequelize.query(
      "CREATE UNIQUE INDEX uq_push_user_endpoint ON push_subscriptions (user_id, endpoint(191))"
    ).catch(() => {});

    // DB-Indexes für häufig gefilterte Spalten (idempotent)
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_assets_classification ON assets(classification)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_assets_lifecycle ON assets(lifecycle_status)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, created_at)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_risks_status ON risks(status)').catch(() => {});
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)').catch(() => {});

    // Backfill ISO 27001 control descriptions from catalog (idempotent)
    try {
      const iso27001Catalog = require('./services/iso27001Catalog');
      const { Iso27001Control } = require('./models');
      const withDesc = iso27001Catalog.filter(c => c.description);
      if (withDesc.length > 0) {
        for (const entry of withDesc) {
          await Iso27001Control.update(
            { description: entry.description },
            { where: { ref: entry.ref, description: null } }
          );
        }
      }
    } catch (e) {
      console.warn('[DB] Could not backfill ISO 27001 descriptions:', e.message);
    }

    // Seed admin user if none exists. Passwort über ADMIN_PASSWORD setzbar;
    // ohne Override greift der dokumentierte Standard, der sofort zu ändern ist.
    const { User } = require('./models');
    const count = await User.count();
    if (count === 0) {
      const initialPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
      await User.create({
        name: 'Administrator',
        email: 'admin@isms.local',
        password_hash: await User.hashPassword(initialPassword),
        role: 'admin',
        department: 'IT Security'
      });
      if (process.env.ADMIN_PASSWORD) {
        console.log('Admin user created: admin@isms.local (Passwort aus ADMIN_PASSWORD)');
      } else {
        console.warn('[SECURITY] Admin-Standardkonto erstellt: admin@isms.local / Admin1234! — Passwort SOFORT ändern oder ADMIN_PASSWORD setzen!');
      }
    }

    await seedCatalog();
    startReminderService();

    // Run task automation on startup and then daily at 3:00 AM
    const { runTaskAutomation } = require('./services/taskAutomationService');
    runTaskAutomation();
    cron.schedule('0 3 * * *', async () => {
      await runTaskAutomation();
    });

    // Nightly CVE refresh: query NVD / Shodan for all active technical assets (02:30 AM)
    cron.schedule('30 2 * * *', async () => {
      try {
        const { Asset } = require('./models');
        const { fetchCVEsForAsset } = require('./services/cveService');
        const { Op } = require('sequelize');
        const skipTypes = new Set(['information', 'process', 'personal', 'data', 'other']);
        const assets = await Asset.findAll({ where: { status: { [Op.ne]: 'decommissioned' } } });
        let refreshed = 0; let skipped = 0; let failed = 0;
        for (const asset of assets) {
          if (skipTypes.has(asset.type)) { skipped++; continue; }
          try {
            const result = await fetchCVEsForAsset(asset);
            if (!result) { skipped++; continue; }
            await asset.update({
              cve_critical: result.counts.critical,
              cve_high:     result.counts.high,
              cve_medium:   result.counts.medium,
              cve_low:      result.counts.low,
              cve_ids:      result.cveList,
              cve_last_checked: new Date(),
            });
            refreshed++;
          } catch (e) {
            console.warn(`[CVE Cron] Asset ${asset.id} failed: ${e.message}`);
            failed++;
          }
        }
        console.log(`[CVE Cron] Done — refreshed: ${refreshed}, skipped: ${skipped}, failed: ${failed}`);
      } catch (e) {
        console.error('[CVE Cron] Fatal error:', e.message);
      }
    });

    // Daily audit log cleanup: remove entries older than configured retention period (default 15 months)
    cron.schedule('0 2 * * *', async () => {
      try {
        const { getGeneral } = require('./services/settingsService');
        const { AuditLog } = require('./models');
        const settings = await getGeneral();
        const months = settings.auditLogRetentionMonths || 15;
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - months);
        const deleted = await AuditLog.destroy({ where: { created_at: { [Op.lt]: cutoff } } });
        if (deleted > 0) console.log(`[AuditLog] Purged ${deleted} entries older than ${months} months`);
      } catch (e) {
        console.error('[AuditLog] Cleanup failed:', e.message);
      }
    });

    // Daily API Token cleanup: delete expired tokens and send notifications (04:00 AM)
    cron.schedule('0 4 * * *', async () => {
      try {
        const { ApiToken } = require('./models');
        const { notify } = require('./services/notifyService');
        const { Op } = require('sequelize');
        
        const expiredTokens = await ApiToken.findAll({
          where: {
            expires_at: { [Op.lt]: new Date() }
          }
        });
        
        for (const token of expiredTokens) {
          const userId = token.user_id;
          const tokenName = token.name;
          await token.destroy();
          await notify({
            userId: userId,
            title: 'API-Token abgelaufen',
            content: `Ihr API-Token "${tokenName}" für den Discovery-Agenten ist abgelaufen und wurde gelöscht.`,
            type: 'system'
          });
        }
        if (expiredTokens.length > 0) {
          console.log(`[API Token Cron] Purged ${expiredTokens.length} expired API tokens`);
        }
      } catch (e) {
        console.error('[API Token Cron] Cleanup failed:', e.message);
      }
    });

    app.listen(PORT, '0.0.0.0', () => console.log(`ISMS Backend running on port ${PORT}`));
  } catch (e) {
    console.error('Failed to start:', e);
    process.exit(1);
  }
};

start();
