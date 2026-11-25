const jwt = require('jsonwebtoken');
const { User, ApiToken } = require('../models');
const { notify } = require('../services/notifyService');
const { hashToken } = require('../services/cryptoService');
const { tokenAudienceMatches } = require('../utils/oidcAudience');
const { isExplicitlyUnverified, emailDomainAllowed } = require('../services/oidcIdentity');
const { getQueryToken } = require('../utils/queryToken');
const { attachAccess, hasRole, isReadOnly, rolesOf } = require('../services/accessService');

const getTokenFromHeaders = (req) => {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader) {
    // Bounded prefix-match + slice instead of /^Bearer\s+(.+)$/i: the old regex had
    // two adjacent quantifiers (\s+ and .+) that overlap on whitespace, allowing
    // polynomial-time backtracking on a crafted Authorization header (CodeQL
    // js/polynomial-redos, alert #255). This form is equivalent and linear-time.
    const bearerPrefix = /^Bearer\s+/i.exec(authHeader);
    if (bearerPrefix) return authHeader.slice(bearerPrefix[0].length).trim();
    if (authHeader.startsWith('isms_api_') || !authHeader.includes(' ')) {
      return authHeader;
    }
  }
  const apiKeyHeader = String(
    req.headers['x-api-key'] ||
    req.headers['x-mcp-key'] ||
    req.headers['api-key'] ||
    ''
  ).trim();
  if (apiKeyHeader) return apiKeyHeader;

  // Query-string token fallback only for Server-Sent Events (Security-Review
  // 2026-11, OP-2; CodeQL alerts #253/#252): browser EventSource clients cannot set
  // custom headers, so for that one transport a short-lived token has to travel in
  // the URL. It used to apply to every GET route of the REST API, which let plain
  // links authenticate and put tokens into proxy/access logs. Now only a GET with
  // `Accept: text/event-stream` may use it (see utils/queryToken.js); every other
  // request must send the Authorization header. helmet's `Referrer-Policy:
  // no-referrer` (index.js) still keeps the token out of any Referer header.
  return getQueryToken(req);
};

const authenticate = async (req, res, next) => {
  const token = getTokenFromHeaders(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {

    if (token.startsWith('isms_api_')) {
      // Validate format before DB lookup: prefix + 64 lowercase hex chars
      if (!/^isms_api_[0-9a-f]{64}$/.test(token)) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const dbToken = await ApiToken.findOne({ where: { token_hash: hashToken(token) } });
      if (!dbToken) return res.status(401).json({ error: 'Invalid token' });

      // Check for expiration
      if (dbToken.expires_at && new Date(dbToken.expires_at) < new Date()) {
        const userId = dbToken.user_id;
        const tokenName = dbToken.name;
        await dbToken.destroy();
        await notify({
          userId: userId,
          title: 'API-Token abgelaufen',
          content: `Ihr API-Token "${tokenName}" für den Discovery-Agenten ist abgelaufen und wurde gelöscht.`,
          type: 'system'
        });
        return res.status(401).json({ error: 'API Token expired' });
      }

      const user = await User.findByPk(dbToken.user_id, { attributes: { exclude: ['password_hash'] } });
      if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });

      req.user = await attachAccess(user);
      return next();
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: 'Server misconfigured' });
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch (jwtErr) {
      // Fallback: check if valid OIDC access token when OIDC is configured
      try {
        const { buildConfig, client } = require('../services/oidcService');
        const { config, cfg } = await buildConfig();
        if (tokenAudienceMatches(token, cfg.clientId)) {
          const info = await client.fetchUserInfo(config, token, client.skipSubjectCheck);
          const email = String(info.email || info.preferred_username || '').toLowerCase();
          // Dieselben Regeln wie im interaktiven Callback (services/oidcIdentity.js),
          // plus: nur Konten, die schon per SSO gebunden sind. Vorher genuegte die
          // passende Adresse — auch fuer das lokale Admin-Konto, ohne dessen TOTP,
          // ohne email_verified- und ohne Domain-Pruefung.
          const { getGeneral } = require('../services/settingsService');
          const general = email ? await getGeneral() : {};
          if (email && !isExplicitlyUnverified(info.email_verified) && emailDomainAllowed(email, general.ssoAllowedDomains)) {
            const oidcUser = await User.findOne({
              where: { email },
              attributes: { exclude: ['password_hash', 'totp_secret', 'reset_password_token', 'reset_password_expires'] },
            });
            if (oidcUser && oidcUser.active && oidcUser.sso_user) {
              req.user = await attachAccess(oidcUser);
              return next();
            }
          }
        }
      } catch { /* not an OIDC token or OIDC disabled */ }
      return res.status(401).json({ error: 'Invalid token' });
    }
    // Block temp TOTP-pending tokens from being used as full session tokens
    if (decoded.totp_pending) return res.status(401).json({ error: 'MFA erforderlich' });
    // Never expose secrets on req.user (and thus on GET /auth/me).
    const user = await User.findByPk(decoded.id, {
      attributes: { exclude: ['password_hash', 'totp_secret', 'reset_password_token', 'reset_password_expires'] },
    });
    if (!user || !user.active) return res.status(401).json({ error: 'Unauthorized' });

    // Invalidate sessions issued before the last password change/reset. Tokens
    // predating password_changed_at are rejected (1s skew for the token minted by
    // the change itself). Legacy tokens without iat and users who never changed
    // their password are unaffected.
    if (user.password_changed_at && decoded.iat) {
      if (decoded.iat * 1000 < new Date(user.password_changed_at).getTime() - 1000) {
        return res.status(401).json({ error: 'Session abgelaufen — bitte neu anmelden.' });
      }
    }

    // Update last-seen, throttled to at most once per minute per user (async, don't
    // wait). Writing it on every authenticated request was a DB write per API call;
    // 1-minute granularity is plenty for the online indicator. `silent` avoids
    // bumping updated_at, and `fields` limits the UPDATE to the one column.
    const lastSeenMs = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeenMs > 60 * 1000) {
      user.last_seen_at = new Date();
      user.save({ fields: ['last_seen_at'], silent: true }).catch(e => console.error('Error updating last_seen_at:', e.message));
    }

    req.user = await attachAccess(user);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Roles come from the user's groups (services/accessService.js). A user can hold
// several; every role-based rule below asks whether ANY of them qualifies.
const requireRole = (...roles) => (req, res, next) => {
  if (!hasRole(req.user, roles)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Permission guard. Each role of the user is asked in turn and access is granted
// as soon as one allows (allow-only union across roles): its permission set says
// true, or says nothing about module+action while its base role is among
// fallbackRoles — the role list the route carried before, so behaviour is
// unchanged until an admin actually edits the matrix. Passing no fallbackRoles
// means "deny when undefined".
const requirePermission = (module, action, ...fallbackRoles) => async (req, res, next) => {
  try {
    const { decide } = require('../services/permissionService');
    if (await decide(req.user, module, action, fallbackRoles)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  } catch (e) {
    // Never fail open: a broken matrix lookup must not hand out access.
    console.error('[Permissions] check failed:', e.message);
    return res.status(500).json({ error: 'Permission check failed' });
  }
};

// viewer, management and employee are read-only roles. A user may write as soon
// as one of their roles may; a user without any role may not.
const requireWriteAccess = () => (req, res, next) => {
  if (isReadOnly(rolesOf(req.user))) {
    return res.status(403).json({ error: 'Diese Rolle hat keine Berechtigung für schreibende Zugriffe.' });
  }
  next();
};

const isAdmin = (req) => hasRole(req.user, 'admin');
const isAssessor = (req) => hasRole(req.user, 'admin', 'assessor');
const isDpo = (req) => hasRole(req.user, 'admin', 'dpo');
const isItStaff = (req) => hasRole(req.user, 'admin', 'assessor', 'it-staff');

// Asset visibility scope, shared by the asset detail, asset list and asset
// comments so all three enforce the same rule: staff roles see every asset;
// everyone else only assets they own or assess.
const canViewAllAssets = (req) => hasRole(req.user, 'admin', 'assessor', 'dpo', 'it-staff');
const canViewAsset = (req, asset) =>
  canViewAllAssets(req) || req.user.id === asset.owner_id || req.user.id === asset.assessor_id;

module.exports = { authenticate, getTokenFromHeaders, requireRole, requirePermission, requireWriteAccess, isAdmin, isAssessor, isDpo, isItStaff, canViewAllAssets, canViewAsset, hasRole };
