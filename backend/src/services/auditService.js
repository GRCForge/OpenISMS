const { AuditLog } = require('../models');
const { signAudit, verifyAuditSignature } = require('./cryptoService');

// Deterministic serialization with recursively sorted object keys. This makes the
// canonical form independent of key ordering, which matters because the JSONB
// column type re-orders object keys (as MySQL's JSON did before it) — without
// this, a round-tripped `details` object would hash differently and be
// misreported as tampered.
const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
};

// Canonical HMAC input over the immutable audit fields. created_at is reduced to
// whole seconds. That started as a MySQL necessity (DATETIME has no sub-second
// precision, so the in-memory Date differed from the stored value on read-back)
// and is kept deliberately on Postgres: timestamptz stores microseconds, a JS
// Date carries milliseconds, and the truncation between them would otherwise
// change the hashed representation and report an untouched entry as tampered.
const canonicalize = (row) => stableStringify({
  action: row.action ?? null,
  entity_type: row.entity_type ?? null,
  entity_id: row.entity_id ?? null,
  entity_name: row.entity_name ?? null,
  actor_id: row.actor_id ?? null,
  actor_name: row.actor_name ?? null,
  details: row.details ?? null,
  ip_address: row.ip_address ?? null,
  created_at: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
});

const auditFromReq = async (req, action, entityType, entityId, entityName, details = {}) => {
  try {
    // Create first so created_at is the DB-assigned value, then sign and persist
    // the HMAC. Signing after insert keeps the hashed representation aligned with
    // what a later read returns (same created_at, same normalized details).
    const row = await AuditLog.create({
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_name: entityName,
      actor_id: req.user?.id ?? null,
      actor_name: req.user?.name ?? 'System',
      details,
      ip_address: req.ip ?? null,
    });
    row.integrity_hash = signAudit(canonicalize(row));
    await row.save({ fields: ['integrity_hash'] });
  } catch (e) {
    console.error('[Audit] Failed to write log:', e.message);
  }
};

// Recompute and compare the HMAC for a stored row. Returns true if intact, false if
// tampered, null if the row predates the integrity feature (cannot be verified).
const verifyAuditRow = (row) => {
  if (!row.integrity_hash) return null;
  return verifyAuditSignature(canonicalize(row), row.integrity_hash);
};

module.exports = { auditFromReq, verifyAuditRow, canonicalize };
