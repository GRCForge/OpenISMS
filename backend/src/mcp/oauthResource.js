'use strict';

/**
 * OAuth 2.1 Resource-Server-Teil des MCP-Endpunkts
 * (MCP Authorization, Spezifikation 2025-06-18).
 *
 * Was hier entschieden wird:
 *
 *  - Protected Resource Metadata (RFC 9728): welche Ressource wir sind und
 *    welcher Authorization Server (der konfigurierte OIDC-Issuer) Tokens fuer
 *    uns ausstellt.
 *  - Pruefung eines IdP-Access-Tokens: Signatur gegen die JWKS des Issuers,
 *    iss exakt, exp/nbf, und vor allem die Audience. Ein Token muss fuer
 *    DIESE Ressource ausgestellt sein (aud = <APP_URL>/mcp, RFC 8707) oder fuer
 *    eine ausdruecklich erlaubte Audience/Client-ID.
 *
 * Warum nicht mehr userinfo: Der userinfo-Endpunkt beantwortet nur "ist dieser
 * Token beim Issuer noch gueltig?", nicht "fuer wen wurde er ausgestellt?".
 * Damit wurde jeder Access-Token irgendeiner Anwendung im selben Realm als
 * MCP-Anmeldung akzeptiert (Token-Passthrough / Confused Deputy, CWE-863) -
 * und bei aktivem SSO-Auto-Provisioning sogar ein neuer Benutzer angelegt.
 *
 * Konfiguration (alle optional):
 *   MCP_OAUTH_AUDIENCES        zusaetzliche erlaubte aud-Werte (Komma-Liste)
 *   MCP_OAUTH_ALLOWED_CLIENTS  Client-IDs, deren Tokens (azp) auch ohne
 *                              passende aud akzeptiert werden (Komma-Liste;
 *                              Vorgabe leer - nur fuer Uebergaenge gedacht)
 *   MCP_OAUTH_SCOPES           scopes_supported in den Metadaten
 *                              (Leerzeichen-Liste; Vorgabe: OIDC-Scopes)
 *   MCP_OAUTH_REQUIRED_SCOPE   Scope, den ein Token tragen muss (sonst 403
 *                              insufficient_scope); Vorgabe leer
 *   MCP_OAUTH_AUTO_PROVISION   "true" legt unbekannte Benutzer bei der
 *                              MCP-Anmeldung an (nur wenn zusaetzlich
 *                              SSO-Auto-Provisioning aktiv ist); Vorgabe aus
 */

const ASYMMETRIC_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'];
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const list = (value, sep = ',') =>
  String(value || '').split(sep).map((s) => s.trim()).filter(Boolean);

/** Basis-URL der Anwendung. APP_URL darf eine Komma-Liste sein (CORS); die erste gilt. */
const getAppUrl = () => {
  const first = list(process.env.APP_URL)[0] || `http://localhost:${process.env.PORT || 3001}`;
  return first.replace(/\/$/, '');
};

/** Kanonische Ressourcen-URL des MCP-Endpunkts (RFC 8707 / RFC 9728 "resource"). */
const getResourceUrl = () => `${getAppUrl()}/mcp`;

const getMetadataUrl = () => `${getAppUrl()}/.well-known/oauth-protected-resource`;

const getAllowedAudiences = () => {
  const resource = getResourceUrl();
  return [...new Set([resource, ...list(process.env.MCP_OAUTH_AUDIENCES)])];
};

const getAllowedClients = () => list(process.env.MCP_OAUTH_ALLOWED_CLIENTS);

const getRequiredScope = () => String(process.env.MCP_OAUTH_REQUIRED_SCOPE || '').trim();

const getScopesSupported = (cfg = {}) => {
  const fromEnv = list(process.env.MCP_OAUTH_SCOPES, ' ');
  const base = fromEnv.length ? fromEnv : list(cfg.scopes || 'openid profile email', ' ');
  const required = getRequiredScope();
  return [...new Set(required ? [...base, required] : base)];
};

const isAutoProvisionEnabled = () => String(process.env.MCP_OAUTH_AUTO_PROVISION || '').toLowerCase() === 'true';

/** RFC 9728 Protected Resource Metadata, oder null wenn OIDC nicht aktiv ist. */
const buildProtectedResourceMetadata = (cfg) => {
  if (!cfg || !cfg.enabled || !cfg.issuer) return null;
  const appUrl = getAppUrl();
  return {
    resource: getResourceUrl(),
    authorization_servers: [String(cfg.issuer).replace(/\/$/, '')],
    scopes_supported: getScopesSupported(cfg),
    bearer_methods_supported: ['header'],
    resource_name: 'OpenISMS MCP Server',
    resource_documentation: `${appUrl}/api/docs`,
  };
};

const quote = (v) => String(v).replace(/["\\\r\n]/g, ' ');

/**
 * WWW-Authenticate-Wert (RFC 6750 §3 / RFC 9728 §5.1).
 * @param {object} opts { oidc: boolean, error, description, scope }
 */
const buildWwwAuthenticate = ({ oidc, error, description, scope } = {}) => {
  const parts = oidc
    ? [`resource_metadata="${getMetadataUrl()}"`]
    : ['realm="OpenISMS MCP"'];
  if (scope) parts.push(`scope="${quote(scope)}"`);
  if (error) parts.push(`error="${quote(error)}"`);
  if (description) parts.push(`error_description="${quote(description)}"`);
  return `Bearer ${parts.join(', ')}`;
};

/** Sieht der Wert wie ein JWS in Compact-Serialisierung aus? */
const looksLikeJwt = (token) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(token || ''));

// ─── JWKS ────────────────────────────────────────────────────────────────────

let joseModule = null;
const loadJose = async () => {
  if (!joseModule) joseModule = await import('jose');
  return joseModule;
};

// issuer -> { jwks, expires }
const jwksCache = new Map();

/**
 * JWKS des Issuers. Die jwks_uri kommt aus dessen Discovery-Dokument; das
 * Dokument muss denselben Issuer nennen (OIDC Discovery §4.3), sonst wird es
 * verworfen. Unabhaengig von openid-client, weil die Token-Pruefung kein
 * Client-Secret braucht.
 */
const getIssuerJwks = async (issuer) => {
  const key = String(issuer).replace(/\/$/, '');
  const hit = jwksCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.jwks;

  const { createRemoteJWKSet } = await loadJose();
  const res = await fetch(`${key}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status})`);
  const doc = await res.json();
  if (String(doc.issuer || '').replace(/\/$/, '') !== key) {
    throw new Error('OIDC discovery: issuer mismatch');
  }
  if (!doc.jwks_uri) throw new Error('OIDC discovery: no jwks_uri');
  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri), {
    timeoutDuration: 5000,
    cooldownDuration: 30000,
    cacheMaxAge: 10 * 60 * 1000,
  });
  jwksCache.set(key, { jwks, expires: Date.now() + DISCOVERY_TTL_MS });
  return jwks;
};

const resetJwksCache = () => jwksCache.clear();

class TokenError extends Error {
  constructor(code, description, status = 401, reason = 'rejected') {
    super(description);
    this.code = code;          // 'invalid_token' | 'insufficient_scope'
    this.description = description;
    this.status = status;
    this.reason = reason;      // fester Schluessel fuers Log
  }
}

const REASONS = ['rejected', 'not_jwt', 'no_keys', 'expired', 'invalid', 'not_access_token', 'audience', 'scope',
  'no_email', 'email_unverified', 'domain', 'no_account', 'inactive', 'no_oidc'];
/** Fester Log-Schluessel einer Ablehnung (keine Werte aus Token oder Konfiguration). */
const reasonKey = (e) => REASONS.find((r) => e && r === e.reason) || 'rejected';

/**
 * IdP-Access-Token pruefen.
 *
 * @param {string} token
 * @param {object} opts
 *   issuer      erwarteter Issuer (exakt, ohne abschliessenden Slash verglichen)
 *   jwks        optional: Schluesselquelle (fuer Tests); sonst Discovery
 *   audiences   erlaubte aud-Werte (Vorgabe: getAllowedAudiences())
 *   clients     erlaubte azp-Werte (Vorgabe: getAllowedClients())
 *   requiredScope  (Vorgabe: getRequiredScope())
 * @returns {Promise<object>} verifizierte Claims
 * @throws {TokenError}
 */
const verifyAccessToken = async (token, opts = {}) => {
  if (!opts.issuer) throw new TokenError('invalid_token', 'OIDC not configured', 401, 'no_oidc');
  if (!looksLikeJwt(token)) throw new TokenError('invalid_token', 'Token is not a JWT', 401, 'not_jwt');

  const issuer = String(opts.issuer).replace(/\/$/, '');
  const audiences = opts.audiences || getAllowedAudiences();
  const clients = opts.clients || getAllowedClients();
  const requiredScope = opts.requiredScope !== undefined ? opts.requiredScope : getRequiredScope();

  const { jwtVerify } = await loadJose();
  let jwks;
  try {
    jwks = opts.jwks || await getIssuerJwks(issuer);
  } catch {
    throw new TokenError('invalid_token', 'Issuer keys unavailable', 401, 'no_keys');
  }

  let payload;
  try {
    // iss wird exakt geprueft; ein konfigurierter Slash am Ende wird oben
    // entfernt (Keycloak-Issuer haben keinen). "sub" wird nicht verlangt:
    // Keycloak >= 25 setzt ihn nur ueber den Client-Scope "basic".
    ({ payload } = await jwtVerify(token, jwks, {
      issuer,
      algorithms: ASYMMETRIC_ALGS,
      clockTolerance: 30,
      requiredClaims: ['exp'],
    }));
  } catch (e) {
    const expired = e && e.code === 'ERR_JWT_EXPIRED';
    throw expired
      ? new TokenError('invalid_token', 'Token expired', 401, 'expired')
      : new TokenError('invalid_token', 'Token signature or claims invalid', 401, 'invalid');
  }

  // Keycloak kennzeichnet Token-Arten im Claim "typ". ID- und Refresh-Tokens
  // sind keine Zugriffstokens, auch wenn ihre aud zufaellig passt.
  if (payload.typ && !['bearer', 'at+jwt'].includes(String(payload.typ).toLowerCase())) {
    throw new TokenError('invalid_token', 'Not an access token', 401, 'not_access_token');
  }

  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : (payload.aud ? [String(payload.aud)] : []);
  const audOk = aud.some((a) => audiences.includes(a));
  const azpOk = !!payload.azp && clients.includes(String(payload.azp));
  if (!audOk && !azpOk) {
    throw new TokenError('invalid_token', 'Token audience does not include this resource', 401, 'audience');
  }

  if (requiredScope) {
    const scopes = String(payload.scope || payload.scp || '').split(' ').filter(Boolean);
    if (!scopes.includes(requiredScope)) {
      throw new TokenError('insufficient_scope', 'Required scope missing', 403, 'scope');
    }
  }

  return payload;
};

module.exports = {
  ASYMMETRIC_ALGS,
  TokenError,
  buildProtectedResourceMetadata,
  buildWwwAuthenticate,
  getAllowedAudiences,
  getAllowedClients,
  getAppUrl,
  getMetadataUrl,
  getRequiredScope,
  getResourceUrl,
  getScopesSupported,
  isAutoProvisionEnabled,
  looksLikeJwt,
  reasonKey,
  resetJwksCache,
  verifyAccessToken,
};
