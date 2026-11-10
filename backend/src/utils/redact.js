'use strict';

/**
 * Geheimnisse aus einer Request-URL entfernen, bevor sie ins Log geht.
 *
 * Der Request-Logger in index.js schrieb req.originalUrl ungefiltert nach
 * stdout und in die Logdatei (lesbar ueber GET /api/admin/logs und in jeder
 * Logsammlung). Darin standen u. a. Sitzungs-JWTs und API-Tokens aus dem
 * Query-Fallback (?token=, ?api_key=), Passwort-Reset-Tokens
 * (/reset-password?token=, eine Stunde gueltig) und OIDC-Codes.
 */
const SECRET_PARAMS = new Set([
  'token', 'apikey', 'api_key', 'access_token', 'id_token', 'refresh_token',
  'key', 'code', 'password', 'secret', 'temp_token', 'session_state',
]);

const redactUrlSecrets = (url) => {
  const s = String(url ?? '');
  const q = s.indexOf('?');
  if (q === -1) return s;
  const [query, hash = ''] = s.slice(q + 1).split('#', 2);
  const parts = query.split('&').map((pair) => {
    const eqIdx = pair.indexOf('=');
    const rawName = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    let name = rawName;
    try { name = decodeURIComponent(rawName.replace(/\+/g, ' ')); } catch { /* keep raw */ }
    return SECRET_PARAMS.has(name.toLowerCase()) && eqIdx !== -1 ? `${rawName}=[REDACTED]` : pair;
  });
  return `${s.slice(0, q)}?${parts.join('&')}${hash ? `#${hash}` : ''}`;
};

module.exports = { redactUrlSecrets, SECRET_PARAMS };
