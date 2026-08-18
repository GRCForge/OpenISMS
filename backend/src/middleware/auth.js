const jwt = require('jsonwebtoken');
const { User, ApiToken } = require('../models');
const { notify } = require('../services/notifyService');
const { hashToken } = require('../services/cryptoService');

const getTokenFromHeaders = (req) => {
  const authHeader = String(req.headers.authorization || '').trim();
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) return bearerMatch[1].trim();
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

  const queryToken = req.query?.token || req.query?.apiKey || req.query?.api_key || req.query?.access_token || req.query?.key;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
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

      req.user = user;
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
        const { config } = await buildConfig();
        const info = await client.fetchUserInfo(config, token, client.skipSubjectCheck);
        const email = String(info.email || info.preferred_username || '').toLowerCase();
        if (email) {
          const oidcUser = await User.findOne({
            where: { email },
            attributes: { exclude: ['password_hash', 'totp_secret', 'reset_password_token', 'reset_password_expires'] },
          });
          if (oidcUser && oidcUser.active) {
            req.user = oidcUser;
            return next();
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

    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Permission-matrix guard. Where the effective matrix defines module+action it is
// authoritative — that is the point of an editable matrix, and of letting a custom
// role carry its own. Where it defines nothing, fallbackRoles decides, which is the
// role list the route carried before, so behaviour is unchanged until an admin
// actually edits the matrix. Passing no fallbackRoles means "deny when undefined".
const requirePermission = (module, action, ...fallbackRoles) => async (req, res, next) => {
  try {
    const { can } = require('../services/permissionService');
    const verdict = await can(req.user, module, action);
    if (verdict === true) return next();
    if (verdict === false) return res.status(403).json({ error: 'Forbidden' });
    if (fallbackRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden' });
  } catch (e) {
    // Never fail open: a broken matrix lookup must not hand out access.
    console.error('[Permissions] check failed:', e.message);
    return res.status(500).json({ error: 'Permission check failed' });
  }
};

const requireWriteAccess = () => (req, res, next) => {
  if (req.user.role === 'viewer' || req.user.role === 'management' || req.user.role === 'employee') {
    return res.status(403).json({ error: 'Diese Rolle hat keine Berechtigung für schreibende Zugriffe.' });
  }
  next();
};

const isAdmin = (req) => req.user.role === 'admin';
const isAssessor = (req) => req.user.role === 'admin' || req.user.role === 'assessor';
const isDpo = (req) => req.user.role === 'admin' || req.user.role === 'dpo';
const isItStaff = (req) => req.user.role === 'admin' || req.user.role === 'assessor' || req.user.role === 'it-staff';

// Asset visibility scope, shared by the asset detail, asset list and asset
// comments so all three enforce the same rule: staff roles see every asset;
// everyone else only assets they own or assess.
const canViewAllAssets = (req) => ['admin', 'assessor', 'dpo', 'it-staff'].includes(req.user.role);
const canViewAsset = (req, asset) =>
  canViewAllAssets(req) || req.user.id === asset.owner_id || req.user.id === asset.assessor_id;

module.exports = { authenticate, requireRole, requirePermission, requireWriteAccess, isAdmin, isAssessor, isDpo, isItStaff, canViewAllAssets, canViewAsset };
