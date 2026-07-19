const router = require('express').Router();
const { heavyLimiter } = require('../middleware/rateLimiter');
router.use(heavyLimiter);
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { sequelize } = require('../models');
const { auditFromReq } = require('../services/auditService');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } }); // 1 GB

// Read app version once at startup. The VERSION file sits at the repo root in dev
// (backend/src/routes/../../../VERSION) but next to the app root in the Docker image
// (/app/VERSION → ../../VERSION). Try both, then APP_VERSION, before giving up.
const ISMS_VERSION = (() => {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  for (const p of [path.join(__dirname, '../../../VERSION'), path.join(__dirname, '../../VERSION')]) {
    try { const v = fs.readFileSync(p, 'utf8').trim(); if (v) return v; } catch { /* try next */ }
  }
  return 'unknown';
})();

// Max raw size for database.json before we even attempt JSON.parse (DoS guard)
const DB_JSON_MAX_BYTES = 512 * 1024 * 1024; // 512 MB

router.use(authenticate, requireRole('admin'));

// GET /api/admin/backup/export  — streams a zip download
router.get('/export', async (req, res) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="isms-backup-${timestamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { if (!res.headersSent) res.status(500).end(); console.error('[Backup]', err); });
    archive.pipe(res);

    // Dump all tables via raw SQL — captures junction tables too
    const [tables] = await sequelize.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    const dbDump = {};
    for (const tbl of tableNames) {
      const [rows] = await sequelize.query(`SELECT * FROM \`${tbl}\``); // NOSONAR(javascript:S3649) - tbl from SHOW TABLES, not user input
      dbDump[tbl] = rows;
    }

    const meta = {
      isms_version: ISMS_VERSION,
      exported_at: new Date().toISOString(),
      tables: Object.fromEntries(tableNames.map(t => [t, dbDump[t].length])),
    };

    archive.append(JSON.stringify(meta, null, 2), { name: 'backup-meta.json' });
    archive.append(JSON.stringify(dbDump, null, 2), { name: 'database.json' });

    if (fs.existsSync(UPLOAD_DIR)) {
      archive.directory(UPLOAD_DIR, 'uploads');
    }

    await archive.finalize();
    await auditFromReq(req, 'create', 'settings', null, 'Backup-Export', { tables: Object.keys(dbDump).length });
  } catch (e) {
    console.error('[Backup export]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Export fehlgeschlagen. Details im Server-Log.' });
  }
});

// GET /api/admin/backup/info  — returns last export info + current DB stats
router.get('/info', async (req, res) => {
  try {
    const [tables] = await sequelize.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    const counts = {};
    for (const tbl of tableNames) {
      const [[{ cnt }]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``); // NOSONAR(javascript:S3649) - tbl from SHOW TABLES
      counts[tbl] = Number(cnt);
    }
    const uploadSizeBytes = await getDirSize(UPLOAD_DIR);
    res.json({ tables: counts, upload_size_bytes: uploadSizeBytes, isms_version: ISMS_VERSION });
  } catch (e) {
    console.error('[Backup info]', e);
    res.status(500).json({ error: 'Systeminfo konnte nicht geladen werden.' });
  }
});

// POST /api/admin/backup/preview  — returns metadata from a zip without restoring
const uploadPreview = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
router.post('/preview', uploadPreview.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei' });
  try {
    const zip = new AdmZip(req.file.buffer);
    const metaEntry = zip.getEntry('backup-meta.json');
    if (!metaEntry) return res.status(400).json({ error: 'Ungültige Backup-Datei' });
    const meta = JSON.parse(metaEntry.getData().toString('utf8'));
    // Include version compatibility hint
    meta._current_version = ISMS_VERSION;
    res.json(meta);
  } catch (e) {
    console.error('[Backup preview]', e);
    res.status(400).json({ error: 'Backup-Datei konnte nicht gelesen werden.' });
  }
});

// POST /api/admin/backup/restore  — accepts zip, validates, restores
router.post('/restore', upload.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Backup-Datei übergeben.' });

  try {
    const zip = new AdmZip(req.file.buffer);

    const metaEntry = zip.getEntry('backup-meta.json');
    if (!metaEntry) return res.status(400).json({ error: 'Ungültige Backup-Datei: backup-meta.json fehlt.' });

    let meta;
    try {
      meta = JSON.parse(metaEntry.getData().toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'backup-meta.json ist kein gültiges JSON.' });
    }

    const dbEntry = zip.getEntry('database.json');
    if (!dbEntry) return res.status(400).json({ error: 'Ungültige Backup-Datei: database.json fehlt.' });

    // Guard against oversized payloads before JSON.parse (DoS protection)
    const rawDb = dbEntry.getData();
    if (rawDb.length > DB_JSON_MAX_BYTES) {
      return res.status(400).json({ error: `database.json überschreitet das Limit von 512 MB.` });
    }

    let dbDump;
    try {
      dbDump = JSON.parse(rawDb.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'database.json ist kein gültiges JSON.' });
    }

    if (typeof dbDump !== 'object' || dbDump === null || Array.isArray(dbDump)) {
      return res.status(400).json({ error: 'Ungültiges Backup-Format: database.json muss ein Objekt sein.' });
    }

    // Build whitelist of actual DB tables to prevent SQL injection via backup table names
    const [existingTables] = await sequelize.query('SHOW TABLES');
    const allowedTables = new Set(existingTables.map(t => Object.values(t)[0]));

    const backupTables = Object.keys(dbDump);
    const unknownTables = backupTables.filter(t => !allowedTables.has(t));
    if (unknownTables.length) {
      return res.status(400).json({ error: `Unbekannte Tabellen im Backup: ${unknownTables.join(', ')}` });
    }

    // Restore DB in a transaction — FK checks disabled for the duration
    await sequelize.transaction(async (t) => {
      await sequelize.query('SET FOREIGN_KEY_CHECKS = 0', { transaction: t });
      try {
        // Truncate all tables that are in the backup (tbl is allowlist-validated above)
        for (const tbl of backupTables) {
          await sequelize.query(`DELETE FROM \`${tbl}\``, { transaction: t }); // NOSONAR(javascript:S3649) - tbl validated against DB allowlist
        }

        // Re-insert all rows table by table in batches.
        // Column names are validated against the live DB schema to prevent injection
        // via a crafted backup file (defence-in-depth on top of the table allowlist).
        for (const [tbl, rows] of Object.entries(dbDump)) {
          if (!Array.isArray(rows) || !rows.length) continue;

          // Fetch actual column names AND types from the DB so we never use
          // backup-supplied identifiers raw, and so we can normalize values per type.
          const [schemaRows] = await sequelize.query(
            `SHOW COLUMNS FROM \`${tbl}\``, // NOSONAR(javascript:S3649) - tbl validated against DB allowlist
            { transaction: t }
          );
          const allowedCols = new Set(schemaRows.map(r => r.Field));
          const colTypes = {};
          schemaRows.forEach(r => { colTypes[r.Field] = String(r.Type || '').toLowerCase(); });

          const safeCols = Array.from(allowedCols);
          if (!safeCols.length) continue;

          const cols = safeCols.map(c => `\`${c}\``).join(', ');
          const safeRows = rows.map(row => {
            const normalized = {};
            for (const col of safeCols) {
              normalized[col] = normalizeValue(colTypes[col], row[col]);
            }
            return normalized;
          });

          const batchSize = 200;
          try {
            for (let i = 0; i < safeRows.length; i += batchSize) {
              const batch = safeRows.slice(i, i + batchSize);
              const placeholders = batch.map(() => `(${safeCols.map(() => '?').join(', ')})`).join(', ');
              const values = batch.flatMap(row => safeCols.map(col => row[col]));
              await sequelize.query(
                `INSERT INTO \`${tbl}\` (${cols}) VALUES ${placeholders}`,
                { replacements: values, transaction: t }
              );
            }
          } catch (err) {
            // Surface which table failed so a bad restore is diagnosable.
            throw new Error(`Restore in Tabelle '${tbl}' fehlgeschlagen: ${err.message}`);
          }
        }
      } finally {
        // Re-enable FK checks even if an error occurs (SET is session-scoped, not transactional)
        await sequelize.query('SET FOREIGN_KEY_CHECKS = 1', { transaction: t });
      }
    });

    // Restore uploaded files — ZIP Slip protection: ensure path stays within UPLOAD_DIR
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    const fileEntries = zip.getEntries().filter(e => e.entryName.startsWith('uploads/') && !e.isDirectory);
    if (fs.existsSync(UPLOAD_DIR)) fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });

    for (const entry of fileEntries) {
      const rel = entry.entryName.slice('uploads/'.length);
      if (!rel) continue;
      const dest = path.resolve(path.join(UPLOAD_DIR, rel));
      if (!dest.startsWith(resolvedUploadDir + path.sep)) {
        console.warn('[Backup restore] Skipping path traversal attempt:', entry.entryName);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
    }

    await auditFromReq(req, 'update', 'settings', null, 'Backup-Restore', {
      source_version: meta.isms_version,
      exported_at: meta.exported_at,
      tables_restored: Object.keys(dbDump).length,
      files_restored: fileEntries.length,
    });

    res.json({
      success: true,
      tables_restored: Object.keys(dbDump).length,
      files_restored: fileEntries.length,
      meta,
    });
  } catch (e) {
    console.error('[Backup restore]', e);
    // Admin-only endpoint — return the (controlled) error incl. the failing table
    // so the operator can act on it instead of guessing.
    res.status(500).json({ error: `Wiederherstellen fehlgeschlagen: ${e.message}` });
  }
});

// Normalize a value from the JSON dump for insertion, based on the target column
// type. JSON columns come back from mysql2 as objects/arrays and must be
// re-serialized to a JSON string (otherwise mysql2 renders them as invalid SQL in
// a VALUES position — this is what previously broke restore for tables like
// `settings` and `audit_logs`). Date/time columns get a form MySQL accepts in
// strict mode.
function normalizeValue(colType, val) {
  if (val === undefined || val === null) return null;
  const type = colType || '';
  if (type.startsWith('json')) {
    return typeof val === 'string' ? val : JSON.stringify(val);
  }
  if (type.startsWith('datetime') || type.startsWith('timestamp')) {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d; // mysql2 formats Date consistently (same-server round-trip)
  }
  if (type === 'date' || type.startsWith('date(')) {
    // DATEONLY — keep just the calendar date to avoid any timezone shift.
    return String(val).slice(0, 10);
  }
  // Defensive: any object/array reaching a non-JSON column would break the insert.
  if (typeof val === 'object') return JSON.stringify(val);
  return val;
}

async function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await getDirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

module.exports = router;
