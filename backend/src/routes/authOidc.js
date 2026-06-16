const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { User, OidcClaimMapping, CustomRole } = require('../models');
const { auditFromReq } = require('../services/auditService');
const { getOidcRaw, getGeneral } = require('../services/settingsService');
const { buildConfig, getCallbackUrl, client } = require('../services/oidcService');

const frontendBase = (req) => {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  // Development fallback: only trust the Host header for loopback addresses.
  // Production deployments must set APP_URL — the OIDC callback URL must be fixed.
  const host = req.get('host') || 'localhost:8080';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    console.error('[OIDC] APP_URL is not set but request came from non-localhost host. Set APP_URL in production.');
    throw new Error('APP_URL is required for OIDC in production');
  }
  return `${req.protocol}://${host}`; // NOSONAR(javascript:S5146) - validated to loopback only above
};

// Short-lived one-time codes: code → { token, expires }
// Avoids putting the JWT in the redirect URL (browser history, server logs).
const ssoTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ssoTokens) { if (v.expires < now) ssoTokens.delete(k); }
}, 30_000);

// Status fuer die Login-Seite (zeigt SSO-Button + Beschriftung)
router.get('/status', async (req, res) => {
  try {
    const o = await getOidcRaw();
    const enabled = !!(o.enabled && o.issuer && o.clientId && o.clientSecretEnc);
    res.json({ ssoEnabled: enabled, name: o.displayName || 'Single Sign-On' });
  } catch (e) {
    console.error('[OIDC] status error:', e.message);
    res.json({ ssoEnabled: false });
  }
});

// Startet den Authorization-Code-Flow (mit PKCE + state in der Session)
router.get('/login', async (req, res) => {
  try {
    const { config, cfg } = await buildConfig();
    const code_verifier = client.randomPKCECodeVerifier();
    const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
    const state = client.randomState();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: getCallbackUrl(),
      scope: cfg.scopes || 'openid profile email',
      code_challenge,
      code_challenge_method: 'S256',
      state,
    });
    // Regenerate session before storing OIDC state to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('[OIDC] session regeneration failed:', err.message);
        return res.redirect(`${frontendBase(req)}/login?error=sso`);
      }
      req.session.oidc = { code_verifier, state };
      res.redirect(url.href);
    });
  } catch (e) {
    console.error('[OIDC] login error:', e.message);
    res.redirect(`${frontendBase(req)}/login?error=sso`);
  }
});

// Callback: Code -> Token -> Userinfo -> User provisionieren -> JWT an Frontend
router.get('/callback', async (req, res) => {
  try {
    const { config } = await buildConfig();
    const saved = req.session.oidc || {};

    // Session ging zwischen /login und /callback verloren (haeufigste Ursache:
    // SameSite-Cookie wurde beim Ruecksprung vom IdP nicht mitgesendet, oder
    // APP_URL/Host stimmt nicht mit der Domain des Cookies ueberein). Klar
    // signalisieren statt generischem Token-Fehler.
    if (!saved.state || !saved.code_verifier) {
      console.error('[OIDC] callback ohne Session-State — Cookie kam nicht zurueck. ' +
        'Pruefe SameSite=lax und ob APP_URL exakt der aufgerufenen Domain entspricht.');
      return res.redirect(`${frontendBase(req)}/login?error=sso_session`);
    }

    // v6 erwartet die vollstaendige Callback-URL inkl. Authorization-Response-
    // Parameter (?code=…&state=…). Aus der konfigurierten Callback-Basis +
    // eingehendem Query-String rekonstruieren (proxy-unabhaengig).
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const currentUrl = new URL(getCallbackUrl() + qs);

    const tokenSet = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: saved.code_verifier,
      expectedState: saved.state,
    });
    delete req.session.oidc;

    const claims = tokenSet.claims() || {};
    // Userinfo abrufen (mit Subject-Validierung); bei Fehler auf die ID-Token-
    // Claims zurueckfallen.
    let info = claims;
    try {
      if (claims.sub) info = await client.fetchUserInfo(config, tokenSet.access_token, claims.sub);
    } catch { info = claims; }
    const email = String(info.email || claims.email || info.preferred_username || '').toLowerCase();
    if (!email) throw new Error('Kein E-Mail-Claim im Token');
    const name = info.name || claims.name || email;

    // Try standard OIDC picture claim first; fall back to MS Graph for Azure/Entra
    let avatar_url = info.picture || claims.picture || null;
    if (!avatar_url && tokenSet.access_token) {
      try {
        const photoRes = await fetch('https://graph.microsoft.com/v1.0/me/photos/48x48/$value', {
          headers: { Authorization: `Bearer ${tokenSet.access_token}` },
          signal: AbortSignal.timeout(4000),
        });
        if (photoRes.ok) {
          const buf = await photoRes.arrayBuffer();
          const ct  = photoRes.headers.get('content-type') || 'image/jpeg';
          avatar_url = `data:${ct};base64,${Buffer.from(buf).toString('base64')}`;
        }
      } catch { /* Graph not available or no photo — ignore */ }
    }

    const general = await getGeneral();

    // Domain allowlist: if ssoAllowedDomains is set, reject emails from unlisted domains.
    if (general.ssoAllowedDomains) {
      const allowed = general.ssoAllowedDomains.split(',').map(d => d.trim()).filter(Boolean);
      const domain = email.split('@')[1] || '';
      if (!allowed.includes(domain)) throw new Error(`E-Mail-Domain @${domain} ist nicht für SSO zugelassen`);
    }

    let user = await User.findOne({ where: { email } });
    if (!user) {
      if (!general.ssoAutoProvision) throw new Error('Auto-Provisioning ist deaktiviert');
      user = await User.create({
        name,
        email,
        password_hash: await User.hashPassword(crypto.randomBytes(24).toString('hex')),
        role: general.ssoDefaultRole || 'viewer',
        active: true,
        avatar_url,
        sso_user: true,
      });
    } else {
      // Refresh name, avatar, and ensure sso_user is true on each SSO login.
      // Also disable TOTP as MFA is handled by the identity provider.
      const updates = { sso_user: true };
      if (user.totp_enabled) {
        updates.totp_enabled = false;
        updates.totp_secret = null;
      }
      if (name && name !== user.name) updates.name = name;
      if (avatar_url !== undefined && avatar_url !== user.avatar_url) updates.avatar_url = avatar_url;
      await user.update(updates);

      // Clean up passkeys as login must happen exclusively via SSO
      const { PasskeyCredential } = require('../models');
      await PasskeyCredential.destroy({ where: { user_id: user.id } });
    }
    if (!user.active) {
      throw new Error('Account ist deaktiviert');
    }

    // Apply OIDC claim → role mappings (highest priority wins)
    try {
      const mappings = await OidcClaimMapping.findAll({
        include: [{ model: CustomRole, as: 'customRole' }],
        order: [['priority', 'DESC'], ['id', 'ASC']],
      });
      let mappedRole = null;
      let mappedCustomRoleId = null;
      for (const mapping of mappings) {
        let claimVal = info[mapping.claim_path] ?? claims[mapping.claim_path];
        // Support dot-notation for nested claims (e.g. "realm_access.roles")
        if (claimVal === undefined && mapping.claim_path.includes('.')) {
          const parts = mapping.claim_path.split('.');
          let obj = { ...info, ...claims };
          for (const p of parts) { obj = obj?.[p]; }
          claimVal = obj;
        }
        const matches = Array.isArray(claimVal)
          ? claimVal.map(String).includes(mapping.claim_value)
          : String(claimVal ?? '') === mapping.claim_value;
        if (matches) {
          if (mapping.custom_role_id && mapping.customRole) {
            mappedRole = mapping.customRole.base_role;
            mappedCustomRoleId = mapping.custom_role_id;
          } else if (mapping.role) {
            mappedRole = mapping.role;
            mappedCustomRoleId = null;
          }
          break;
        }
      }
      if (mappedRole && (user.role !== mappedRole || user.custom_role_id !== mappedCustomRoleId)) {
        await user.update({ role: mappedRole, custom_role_id: mappedCustomRoleId });
      }
    } catch (e) {
      console.error('[OIDC] claim mapping error (non-fatal):', e.message);
    }

    req.user = user;
    await auditFromReq(req, 'login', 'auth', user.id, user.name, { method: 'oidc' });
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) { console.error('[OIDC] JWT_SECRET not set'); return res.redirect(`${frontendBase(req)}/login?error=sso`); }
    
    // Add sso_login: true to the token. This allows the system to recognize
    // that MFA was already handled by the Identity Provider.
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, sso_login: true }, jwtSecret, { expiresIn: '24h' });
    // Use a one-time code instead of embedding the JWT in the redirect URL
    const ssoCode = crypto.randomBytes(24).toString('hex');
    ssoTokens.set(ssoCode, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department }, expires: Date.now() + 30_000 });
    res.redirect(`${frontendBase(req)}/auth/callback?code=${ssoCode}`);
  } catch (e) {
    console.error('[OIDC] callback error:', e.message);
    console.error('[OIDC] callback error details:', e);
    res.redirect(`${frontendBase(req)}/login?error=sso`);
  }
});

// Exchange endpoint: frontend trades one-time code for the JWT
router.get('/exchange', (req, res) => {
  const { code } = req.query;
  // Validate format: exactly 48 lowercase hex chars (24 random bytes)
  if (!code || typeof code !== 'string' || !/^[0-9a-f]{48}$/.test(code)) {
    return res.status(400).json({ error: 'code erforderlich' });
  }
  const entry = ssoTokens.get(code);
  if (!entry || entry.expires < Date.now()) {
    ssoTokens.delete(code);
    return res.status(401).json({ error: 'Ungültiger oder abgelaufener Code' });
  }
  ssoTokens.delete(code);
  res.json({ token: entry.token, user: entry.user });
});

module.exports = router;
