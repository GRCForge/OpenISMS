const crypto = require('crypto');

// AES-256-GCM encryption for sensitive settings (e.g. OIDC client_secret).
// Key is derived from ENCRYPTION_KEY (preferred) or JWT_SECRET — no hardcoded fallback.
const rawKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
if (!rawKey) { console.error('FATAL: ENCRYPTION_KEY or JWT_SECRET must be set for encryption'); process.exit(1); }
const KEY = crypto.createHash('sha256').update(rawKey).digest(); // 32 bytes

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
  try {
    const buf = Buffer.from(data, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

// Fast one-way hash for high-entropy secrets (e.g. API tokens) so they are not
// stored in cleartext. The token is 256-bit random, so a plain SHA-256 is
// sufficient (no need for a slow password hash) and allows constant-cost lookup.
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { encrypt, decrypt, hashToken };
