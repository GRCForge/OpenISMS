const router = require('express').Router();
const jwt = require('jsonwebtoken');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { User, PasskeyCredential } = require('../models');
const { authenticate } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

const RP_NAME = process.env.APP_NAME || 'OpenISMS';

// Erwarteter Origin darf NICHT frei aus Request-Headern übernommen werden —
// sonst bestimmt ein Phishing-Proxy selbst, welchen Origin der Server beim
// Verify akzeptiert, und die Phishing-Resistenz von WebAuthn ist ausgehebelt.
// Browser-Origin wird daher gegen die APP_URL-Allowlist (wie CORS) geprüft.
const ALLOWED_WEBAUTHN_ORIGINS = (process.env.APP_URL || 'http://localhost:3000').split(',').map(s => s.trim());

const getRpConfig = (req) => {
  let origin = process.env.WEBAUTHN_ORIGIN;
  let rpID = process.env.WEBAUTHN_RP_ID;

  if (!origin) {
    let requested = req.headers.origin || null;
    if (!requested && req.headers.referer) {
      try { requested = new URL(req.headers.referer).origin; } catch { /* invalid referer */ }
    }
    origin = (requested && ALLOWED_WEBAUTHN_ORIGINS.includes(requested))
      ? requested
      : ALLOWED_WEBAUTHN_ORIGINS[0];
  }

  if (!rpID) {
    try {
      const parsedOrigin = new URL(origin);
      rpID = parsedOrigin.hostname;
    } catch (e) {
      rpID = 'localhost';
    }
  }

  return { origin, rpID };
};

// ── Registration (authenticated user adds a passkey) ──────────────────────────

router.get('/register-options', authenticate, async (req, res) => {
  if (req.user.sso_user) return res.status(403).json({ error: 'Passkeys können für SSO-Benutzer nicht konfiguriert werden.' });
  try {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: PasskeyCredential, as: 'passkeys' }],
    });

    const { rpID } = getRpConfig(req);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      // v13: userID is a Uint8Array (was a string in v8)
      userID: new TextEncoder().encode(String(user.id)),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      // v13: credential id is a base64url string (was a Buffer); no `type`
      excludeCredentials: (user.passkeys || []).map(pk => ({
        id: pk.credential_id,
        transports: pk.transports || [],
      })),
    });

    req.session.passkey_challenge = options.challenge;
    res.json(options);
  } catch (e) {
    console.error('[Passkey register-options]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/register-verify', authenticate, async (req, res) => {
  if (req.user.sso_user) return res.status(403).json({ error: 'Passkeys können für SSO-Benutzer nicht konfiguriert werden.' });
  try {
    const expectedChallenge = req.session.passkey_challenge;
    if (!expectedChallenge) return res.status(400).json({ error: 'Keine aktive Challenge — bitte neu starten.' });

    const { origin, rpID } = getRpConfig(req);
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verifizierung fehlgeschlagen.' });
    }

    delete req.session.passkey_challenge;

    // v13: registration data moved under `credential` ({ id, publicKey, counter }).
    // `credential.id` is already a base64url string; `publicKey` is a Uint8Array.
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    const name = req.body.name || 'Passkey';
    const created = await PasskeyCredential.create({
      user_id: req.user.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      transports: credential.transports || req.body.response?.transports || [],
      name,
    });

    await auditFromReq(req, 'create', 'auth', req.user.id, req.user.name || req.user.email, { action: 'passkey_registered', name });
    res.json({ ok: true, id: created.id, name });
  } catch (e) {
    console.error('[Passkey register-verify]', e);
    res.status(400).json({ error: e.message });
  }
});

// ── Authentication (login with passkey) ──────────────────────────────────────

router.post('/login-options', async (req, res) => {
  try {
    const { email } = req.body || {};
    let allowCredentials = [];

    if (email) {
      const user = await User.findOne({ where: { email, active: true }, include: [{ model: PasskeyCredential, as: 'passkeys' }] });
      if (user?.sso_user) {
        return res.status(403).json({ error: 'Login für SSO-Benutzer nicht über Passkey erlaubt.' });
      }
      if (user?.passkeys?.length) {
        // v13: credential id is a base64url string (was a Buffer); no `type`
        allowCredentials = user.passkeys.map(pk => ({
          id: pk.credential_id,
          transports: pk.transports || [],
        }));
      }
    }

    const { rpID } = getRpConfig(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials,
    });

    req.session.passkey_auth_challenge = options.challenge;
    res.json(options);
  } catch (e) {
    console.error('[Passkey login-options]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/login-verify', async (req, res) => {
  try {
    const expectedChallenge = req.session.passkey_auth_challenge;
    if (!expectedChallenge) return res.status(400).json({ error: 'Keine aktive Challenge.' });

    const credentialIdBase64 = req.body.id;
    const pkCred = await PasskeyCredential.findOne({ where: { credential_id: credentialIdBase64 } });
    if (!pkCred) return res.status(401).json({ error: 'Unbekannter Passkey.' });

    const user = await User.findOne({ where: { id: pkCred.user_id, active: true } });
    if (!user) return res.status(401).json({ error: 'Benutzer inaktiv oder nicht gefunden.' });
    if (user.sso_user) return res.status(403).json({ error: 'Login für SSO-Benutzer nicht über Passkey erlaubt.' });

    const { origin, rpID } = getRpConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      // v13: `authenticator` renamed to `credential`; id is a base64url string,
      // publicKey a Uint8Array (was credentialID/credentialPublicKey Buffers).
      credential: {
        id: pkCred.credential_id,
        publicKey: Buffer.from(pkCred.public_key, 'base64url'),
        counter: Number(pkCred.counter),
        transports: pkCred.transports || [],
      },
    });

    if (!verification.verified) return res.status(401).json({ error: 'Passkey-Verifizierung fehlgeschlagen.' });

    delete req.session.passkey_auth_challenge;
    pkCred.counter = verification.authenticationInfo.newCounter;
    await pkCred.save();

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) return res.status(500).json({ error: 'Server misconfigured' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '24h' });
    await auditFromReq({ ...req, user }, 'login', 'auth', user.id, user.name, { method: 'passkey' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department } });
  } catch (e) {
    console.error('[Passkey login-verify]', e);
    res.status(400).json({ error: e.message });
  }
});

// ── Manage passkeys (list + delete) ─────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  const passkeys = await PasskeyCredential.findAll({
    where: { user_id: req.user.id },
    attributes: ['id', 'name', 'device_type', 'backed_up', 'created_at'],
    order: [['created_at', 'DESC']],
  });
  res.json(passkeys);
});

router.delete('/:id', authenticate, async (req, res) => {
  const pk = await PasskeyCredential.findOne({ where: { id: req.params.id, user_id: req.user.id } });
  if (!pk) return res.status(404).json({ error: 'Not found' });
  await pk.destroy();
  await auditFromReq(req, 'delete', 'auth', req.user.id, req.user.name || req.user.email, { action: 'passkey_removed', name: pk.name });
  res.json({ ok: true });
});

module.exports = router;
