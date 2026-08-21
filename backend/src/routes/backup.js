const router = require('express').Router();
const { heavyLimiter } = require('../middleware/rateLimiter');
router.use(heavyLimiter);
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { PassThrough } = require('stream');
const AdmZip = require('adm-zip');
const multer = require('multer');
const { authenticate, requirePermission } = require('../middleware/auth');
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

router.use(authenticate);


// Writes { "table": [ …rows… ], … } to a stream without ever holding more than one
// batch in memory. Rows are paged by primary key where there is a single-column
// one; tables without it (junction tables, and they are small) are read in one go,
// because LIMIT/OFFSET without a stable sort can skip or repeat rows.
const EXPORT_BATCH_SIZE = 500;

async function streamDatabaseJson(stream, tableNames, counts) {
  const write = (chunk) => new Promise((resolve, reject) => {
    if (stream.write(chunk)) return resolve();
    stream.once('drain', resolve);
    stream.once('error', reject);
  });

  try {
    await write('{');
    let firstTable = true;
    for (const tbl of tableNames) {
      await write(`${firstTable ? '' : ','}\n${JSON.stringify(tbl)}:[`);
      firstTable = false;

      const [pkRows] = await sequelize.query(
        `SHOW KEYS FROM \`${tbl}\` WHERE Key_name = 'PRIMARY'` // NOSONAR(javascript:S3649) - tbl from SHOW TABLES
      );
      const pk = pkRows.length === 1 ? pkRows[0].Column_name : null;

      let firstRow = true;
      const emit = async (rows) => {
        for (const row of rows) {
          await write((firstRow ? '' : ',') + JSON.stringify(row));
          firstRow = false;
        }
      };

      if (!pk || counts[tbl] <= EXPORT_BATCH_SIZE) {
        const [rows] = await sequelize.query(`SELECT * FROM \`${tbl}\``); // NOSONAR(javascript:S3649) - tbl from SHOW TABLES
        await emit(rows);
      } else {
        let after = null;
        for (;;) {
          const [rows] = await sequelize.query(
            after === null
              ? `SELECT * FROM \`${tbl}\` ORDER BY \`${pk}\` LIMIT ${EXPORT_BATCH_SIZE}` // NOSONAR(javascript:S3649) - identifiers from SHOW TABLES/SHOW KEYS
              : `SELECT * FROM \`${tbl}\` WHERE \`${pk}\` > ? ORDER BY \`${pk}\` LIMIT ${EXPORT_BATCH_SIZE}`, // NOSONAR(javascript:S3649)
            after === null ? {} : { replacements: [after] }
          );
          if (!rows.length) break;
          await emit(rows);
          after = rows[rows.length - 1][pk];
          if (rows.length < EXPORT_BATCH_SIZE) break;
        }
      }
      await write(']');
    }
    await write('\n}');
    stream.end();
  } catch (e) {
    // Destroy rather than end: a truncated database.json must not look complete.
    stream.destroy(e);
    throw e;
  }
}

// GET /api/admin/backup/export  — streams a zip download
router.get('/export', requirePermission('backup','export','admin'), async (req, res) => {
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

    // Row counts up front: they belong in the metadata, and they let the export
    // below decide per table whether it needs to page at all.
    const counts = {};
    for (const tbl of tableNames) {
      const [[{ cnt }]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``); // NOSONAR(javascript:S3649) - tbl from SHOW TABLES
      counts[tbl] = Number(cnt);
    }

    const meta = {
      isms_version: ISMS_VERSION,
      exported_at: new Date().toISOString(),
      tables: counts,
    };

    archive.append(JSON.stringify(meta, null, 2), { name: 'backup-meta.json' });

    // database.json is streamed rather than built in memory. The previous version
    // held every row of every table in a single object and then ran
    // JSON.stringify over it, so peak memory was roughly twice the database —
    // enough to take the container down on an installation of any size, at the
    // exact moment an operator is trying to get their data out.
    const dbStream = new PassThrough();
    archive.append(dbStream, { name: 'database.json' });

    if (fs.existsSync(UPLOAD_DIR)) {
      archive.directory(UPLOAD_DIR, 'uploads');
    }

    await Promise.all([
      streamDatabaseJson(dbStream, tableNames, counts),
      archive.finalize(),
    ]);
    await auditFromReq(req, 'create', 'settings', null, 'Backup-Export', {
      tables: tableNames.length,
      rows: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  } catch (e) {
    console.error('[Backup export]', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export fehlgeschlagen. Details im Server-Log.' });
    } else {
      // The zip is already on the wire, so there is no status code left to send.
      // Tearing the connection down makes the download fail visibly instead of
      // handing the operator a truncated archive that looks complete.
      res.destroy(e);
    }
  }
});

// GET /api/admin/backup/info  — returns last export info + current DB stats
router.get('/info', requirePermission('backup','info','admin'), async (req, res) => {
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
router.post('/preview', requirePermission('backup','restore','admin'), uploadPreview.single('backup'), async (req, res) => {
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
router.post('/restore', requirePermission('backup','restore','admin'), upload.single('backup'), async (req, res) => {
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

    // Tables this database has but the backup does not (an older backup restored
    // into a newer schema, typically). Restore only truncates what it is about to
    // refill, so those keep their current rows — which is the safe behaviour, but
    // it leaves the installation in a mixed state. Silence about it was the
    // problem: the operator had no way to tell. Their row counts go into the
    // response and the audit entry.
    const untouchedTables = {};
    for (const tbl of allowedTables) {
      if (backupTables.includes(tbl)) continue;
      const [[{ cnt }]] = await sequelize.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``); // NOSONAR(javascript:S3649) - tbl from SHOW TABLES
      if (Number(cnt) > 0) untouchedTables[tbl] = Number(cnt);
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
      tables_untouched: Object.keys(untouchedTables),
    });

    res.json({
      success: true,
      tables_restored: Object.keys(dbDump).length,
      files_restored: fileEntries.length,
      // Non-empty means the database now holds a mix: everything from the backup,
      // plus whatever these tables had before. Usually a backup from a version
      // that did not have them yet.
      tables_untouched: untouchedTables,
      warning: Object.keys(untouchedTables).length
        ? `Das Backup enthält ${Object.keys(untouchedTables).length} Tabelle(n) nicht, die in dieser Datenbank Daten haben: `
          + `${Object.entries(untouchedTables).map(([t, c]) => `${t} (${c})`).join(', ')}. `
          + 'Deren Inhalt blieb unverändert — vermutlich stammt das Backup aus einer älteren Version.'
        : undefined,
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
