const crypto = require('crypto');

// AES-256-GCM encryption for sensitive data at rest (OIDC/SMTP/LLM secrets, TOTP
// secrets). New encryption always uses the primary key (ENCRYPTION_KEY preferred,
// otherwise JWT_SECRET). Decryption, however, tries EVERY configured key so that
// data encrypted earlier under the JWT_SECRET fallback stays readable after an
// ENCRYPTION_KEY is later introduced — otherwise such a key change would silently
// make existing secrets (e.g. a user's TOTP seed) undecryptable.
const rawKeys = [process.env.ENCRYPTION_KEY, process.env.JWT_SECRET].filter(Boolean);
if (rawKeys.length === 0) { console.error('FATAL: ENCRYPTION_KEY or JWT_SECRET must be set for encryption'); process.exit(1); }
const uniqueRawKeys = [...new Set(rawKeys)]; // dedupe, preserve order (primary first)
const KEYS = uniqueRawKeys.map(k => crypto.createHash('sha256').update(k).digest()); // 32 bytes each
const KEY = KEYS[0]; // primary — used for all new encryption

const encrypt = (plain) => {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv | authTag | ciphertext)
  return Buffer.concat([iv, tag, enc]).toString('base64');
};

const decrypt = (data) => {
  if (!data) return null;
  let buf;
  try { buf = Buffer.from(data, 'base64'); } catch { return null; }
  if (buf.length < 28) return null; // need at least iv(12) + tag(16)
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  for (const key of KEYS) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    } catch { /* wrong key or not ciphertext — try the next candidate */ }
  }
  return null;
};

// Fast one-way hash for high-entropy secrets (e.g. API tokens) so they are not
// stored in cleartext. The token is 256-bit random, so a plain SHA-256 is
// sufficient (no need for a slow password hash) and allows constant-cost lookup.
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Keyed HMAC for tamper-evident audit rows. One HMAC key is derived per configured
// root secret (distinct label so it is independent of the encryption key). Signing
// uses the primary key; verification accepts any configured key so a key change
// does not turn every previously-signed row into a false "tampered" result.
const AUDIT_KEYS = uniqueRawKeys.map(k => crypto.createHash('sha256').update('openisms-audit-integrity:' + k).digest());
const signAudit = (canonical) => crypto.createHmac('sha256', AUDIT_KEYS[0]).update(String(canonical)).digest('hex');
const verifyAuditSignature = (canonical, hash) => {
  if (!hash) return false;
  return AUDIT_KEYS.some(key => crypto.createHmac('sha256', key).update(String(canonical)).digest('hex') === hash);
};

module.exports = { encrypt, decrypt, hashToken, signAudit, verifyAuditSignature };
