'use strict';

/**
 * Authentifizierung des MCP-Endpunkts (/mcp, /sse).
 *
 * Reihenfolge der akzeptierten Bearer-Werte:
 *
 *   A  MCP_SECRET (statisch, aus der Umgebung). Rolle ueber MCP_SECRET_ROLE,
 *      Vorgabe "admin" wie bisher. Ungesetzt = abgeschaltet.
 *   B  API-Token isms_api_<64 hex> aus der Datenbank (Benutzerprofil ->
 *      API-Tokens). Der empfohlene Weg fuer lokale Konten.
 *   C  OpenISMS-Sitzungstoken (HS256, /api/auth/login bzw. SSO-Login).
 *   D  Access-Token des konfigurierten OIDC-Issuers, geprueft als OAuth-2.1-
 *      Resource-Server: Signatur (JWKS), iss, exp/nbf, Audience (siehe
 *      ./oauthResource.js). Kein userinfo-Fallback mehr.
 */

const { timingSafeEqual } = require('crypto');
const jwt = require('jsonwebtoken');
const { hashToken } = require('../services/cryptoService');
const oauth = require('./oauthResource');

const USER_ROLES = ['admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'];

const getModels = () => require('../models');

const getTokenFromHeaders = (req) => {
  // 1. Authorization header (Bearer <token> or raw isms_api_... token)
  const authHeader = String(req.headers['authorization'] || '').trim();
  if (authHeader) {
    // Bounded prefix-match + slice instead of /^Bearer\s+(.+)$/i: the old regex had
    // two adjacent quantifiers (\s+ and .+) that overlap on whitespace, allowing
    // polynomial-time backtracking on a crafted Authorization header (CodeQL
    // js/polynomial-redos, alert #254). This form is equivalent and linear-time.
    const bearerPrefix = /^Bearer\s+/i.exec(authHeader);
    if (bearerPrefix) return authHeader.slice(bearerPrefix[0].length).trim();
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
  // Query-string token fallback is a deliberate, scoped tradeoff (same reasoning as
  // middleware/auth.js): browser EventSource (SSE) clients cannot set custom headers,
  // so a short-lived session token has to travel in the URL for that one transport.
  // Scoped to GET only -- POST-based Streamable-HTTP clients always authenticate via
  // the Authorization header above. Mitigation: helmet's default `Referrer-Policy:
  // no-referrer` (see index.js) keeps the token out of any Referer header.
  if (req.method === 'GET') {
    const queryToken = req.query?.token || req.query?.apiKey || req.query?.api_key || req.query?.access_token || req.query?.key;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }
  }

  return null;
};

const loadOidcConfig = async () => {
  try {
    const { getOidcConfig } = require('../services/settingsService');
    const cfg = await getOidcConfig();
    return cfg && cfg.enabled && cfg.issuer ? cfg : null;
  } catch {
    return null;
  }
};

const getMcpSecretRole = () => {
  const role = String(process.env.MCP_SECRET_ROLE || 'admin').trim();
  return USER_ROLES.includes(role) ? role : 'viewer';
};

const setUser = (req, user) => {
  req.mcpUser = { id: user.id, name: user.name, role: user.role, custom_role_id: user.custom_role_id ?? null };
  req.auth = req.mcpUser;
  req._mcpUser = req.mcpUser;
};

/**
 * Benutzer zu verifizierten IdP-Claims. Gleiche Regeln wie der SSO-Login der
 * Oberflaeche (routes/authOidc.js): E-Mail-Claim, email_verified darf nicht
 * false sein, Domain-Allowlist. Neue Benutzer nur mit MCP_OAUTH_AUTO_PROVISION.
 */
const userFromClaims = async (claims) => {
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new oauth.TokenError('invalid_token', 'Token carries no email claim');
  }
  if (claims.email_verified === false || claims.email_verified === 'false') {
    throw new oauth.TokenError('invalid_token', 'Email not verified at identity provider');
  }
  const { getGeneral } = require('../services/settingsService');
  const general = await getGeneral();
  if (general.ssoAllowedDomains) {
    const allowed = general.ssoAllowedDomains.split(',').map((d) => d.trim()).filter(Boolean);
    if (!allowed.includes(email.split('@')[1] || '')) {
      throw new oauth.TokenError('invalid_token', 'Email domain not allowed');
    }
  }

  const { User } = getModels();
  let user = await User.findOne({ where: { email } });
  if (!user && oauth.isAutoProvisionEnabled() && general.ssoAutoProvision) {
    user = await User.create({
      name: claims.name || email,
      email,
      password_hash: await User.hashPassword(require('crypto').randomBytes(24).toString('hex')),
      role: general.ssoDefaultRole || 'viewer',
      active: true,
      sso_user: true,
    });
  }
  if (!user) throw new oauth.TokenError('invalid_token', 'No OpenISMS account for this identity');
  if (!user.active) throw new oauth.TokenError('invalid_token', 'User inactive');
  return user;
};

async function mcpAuth(req, res, next) {
  // Allow preflight OPTIONS requests without requiring authentication
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // OAuth 2.0 Protected Resource Metadata (RFC 9728), auch unter /mcp/.well-known
  const url = String(req.originalUrl || req.path || '');
  if (url.includes('/.well-known')) {
    if (url.includes('oauth-protected-resource')) {
      const meta = oauth.buildProtectedResourceMetadata(await loadOidcConfig());
      if (meta) return res.type('application/json').json(meta);
    }
    return res.status(404).type('application/json').json({
      error: 'not_found',
      message: 'OAuth metadata is served by the authorization server. Without SSO, use an API token (Authorization: Bearer isms_api_...).',
    });
  }

  const cfg = await loadOidcConfig();
  const deny = (status, body, wwwAuth) => {
    res.setHeader('WWW-Authenticate', oauth.buildWwwAuthenticate({ oidc: !!cfg, ...wwwAuth }));
    return res.status(status).json(body);
  };
  const invalid = (description, error = 'MCP: Invalid or expired token') =>
    deny(401, { error }, { error: 'invalid_token', description });

  const token = getTokenFromHeaders(req);
  if (!token) {
    // RFC 6750 §3.1: ohne Anmeldeversuch kein error-Attribut.
    const scope = cfg ? oauth.getScopesSupported(cfg).join(' ') : undefined;
    return deny(401, { error: 'MCP: Authorization header or token required' }, { scope });
  }

  // Option A: static MCP_SECRET (timing-safe comparison to prevent timing attacks)
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const tokenBuf = Buffer.from(token, 'utf8');
    const secretBuf = Buffer.from(secret, 'utf8');
    if (tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf)) {
      setUser(req, { id: 0, name: 'MCP Client (MCP_SECRET)', role: getMcpSecretRole(), custom_role_id: null });
      return next();
    }
  }

  // Option B: API token (isms_api_...) - format check before DB lookup
  if (token.startsWith('isms_api_')) {
    if (!/^isms_api_[0-9a-f]{64}$/.test(token)) return invalid('Invalid token format', 'MCP: Invalid token');
    try {
      const { ApiToken, User } = getModels();
      const dbToken = await ApiToken.findOne({ where: { token_hash: hashToken(token) } });
      if (!dbToken) return invalid('Token not found', 'MCP: Invalid token');

      if (dbToken.expires_at && new Date(dbToken.expires_at) < new Date()) {
        const { notify } = require('../services/notifyService');
        const userId = dbToken.user_id;
        const tokenName = dbToken.name;
        await dbToken.destroy();
        await notify({
          userId,
          title: 'API-Token abgelaufen (MCP)',
          content: `Ihr API-Token "${tokenName}" für den MCP-Server ist abgelaufen und wurde gelöscht.`,
          type: 'system',
        });
        return invalid('Token expired', 'MCP: Token expired');
      }

      const user = await User.findByPk(dbToken.user_id);
      if (!user || !user.active) return invalid('User inactive', 'MCP: User not found or inactive');
      setUser(req, user);
      return next();
    } catch (e) {
      console.error('[MCP] API token check failed:', e.message);
      return res.status(500).json({ error: 'MCP: Auth error' });
    }
  }

  if (!oauth.looksLikeJwt(token)) return invalid('Unknown token type');

  // Option C: OpenISMS session JWT (HS256, own secret)
  const header = oauth.peekHeader(token);
  if (header && header.alg === 'HS256') {
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return invalid('Invalid or expired token');
    }
    // Pre-2FA temporary tokens must not grant access.
    if (payload.totp_pending) return invalid('Two-factor authentication required', 'MCP: Two-factor authentication required');
    try {
      const { User } = getModels();
      const user = await User.findByPk(payload.id);
      if (!user || !user.active) return invalid('User inactive', 'MCP: User not found or inactive');
      setUser(req, user);
      return next();
    } catch (e) {
      console.error('[MCP] session token check failed:', e.message);
      return res.status(500).json({ error: 'MCP: Auth error' });
    }
  }

  // Option D: access token of the configured OIDC issuer (OAuth 2.1 resource server)
  if (!cfg) return invalid('Invalid or expired token');
  try {
    const claims = await oauth.verifyAccessToken(token, { issuer: cfg.issuer });
    const user = await userFromClaims(claims);
    setUser(req, user);
    return next();
  } catch (e) {
    if (e instanceof oauth.TokenError) {
      // Keine Token-Inhalte ins Log, nur der Grund.
      console.warn(`[MCP] OIDC access token rejected: ${e.description}`);
      if (e.code === 'insufficient_scope') {
        return deny(403, { error: 'MCP: Insufficient scope' }, {
          error: 'insufficient_scope', description: e.description, scope: oauth.getRequiredScope(),
        });
      }
      return invalid(e.description);
    }
    console.error('[MCP] OIDC token check failed:', e.message);
    return res.status(500).json({ error: 'MCP: Auth error' });
  }
}

/** Einmalige Startmeldung: welche Anmeldewege aktiv sind (ohne Werte). */
const describeAuthModes = async () => {
  const cfg = await loadOidcConfig();
  const modes = ['API token (isms_api_)', 'session JWT'];
  if (process.env.MCP_SECRET) modes.unshift(`MCP_SECRET (role ${getMcpSecretRole()})`);
  if (cfg) {
    modes.push(`OIDC access token (issuer ${String(cfg.issuer).replace(/\/$/, '')}, audience ${oauth.getAllowedAudiences().join(' | ')}` +
      `${oauth.getAllowedClients().length ? `, azp ${oauth.getAllowedClients().join(' | ')}` : ''})`);
  }
  return modes.join('; ');
};

module.exports = { mcpAuth, getTokenFromHeaders, describeAuthModes, userFromClaims, getMcpSecretRole };
