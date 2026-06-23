const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { TOTP, NobleCryptoPlugin, ScureBase32Plugin } = require('otplib');
const qrcode = require('qrcode');
const { User, AuditLog } = require('../models');
const { authenticate, requireWriteAccess } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');
const { validate: validatePassword } = require('../services/passwordPolicy');

const authenticator = new TOTP({
  crypto: new NobleCryptoPlugin(),
  base32: new ScureBase32Plugin(),
  window: 2,
});

const rateLimit = require('express-rate-limit');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.token ? String(req.body.token).slice(0, 64) + req.ip : req.ip,
  message: { error: 'Zu viele Anfragen. Bitte warten Sie 15 Minuten.' },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte warten Sie 15 Minuten.' },
});

const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const getClientIp = (req) => {
  return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
};

const genericLoginError = { error: 'Ungültige Anmeldedaten' };
const genericLockoutError = { error: 'Zu viele fehlgeschlagene Loginversuche. Bitte versuchen Sie es später erneut.' };
const genericServerError = { error: 'Interner Serverfehler' };

const isIpBlocked = async (ip) => {
  if (!ip) return false;
  const timeframe = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes
  const logs = await AuditLog.findAll({
    where: {
      action: 'login',
      entity_type: 'auth',
      ip_address: ip,
      created_at: { [Op.gt]: timeframe }
    }
  });
  
  const failedCount = logs.filter(log => log.details && log.details.success === false).length;
  return failedCount >= 10;
};

const handleFailedLoginForIp = async (req, email) => {
  const ip = getClientIp(req);
  if (!ip) return;

  const timeframe = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes
  const logs = await AuditLog.findAll({
    where: {
      action: 'login',
      entity_type: 'auth',
      ip_address: ip,
      created_at: { [Op.gt]: timeframe }
    }
  });

  const failedCount = logs.filter(log => log.details && log.details.success === false).length;
  
  if (failedCount >= 10) {
    const warningAlreadySent = logs.some(log => log.details && log.details.warning_sent === true);
    
    if (!warningAlreadySent) {
      await auditFromReq(req, 'login', 'auth', null, `IP-Sperre: ${ip}`, {
        success: false,
        warning_sent: true,
        reason: `IP-Adresse ${ip} vorübergehend gesperrt aufgrund von ${failedCount} Fehlversuchen.`
      });

      try {
        const admins = await User.findAll({ where: { role: 'admin', active: true } });
        const { notify } = require('../services/notifyService');
        const title = 'Sicherheitswarnung: Brute-Force-Verdacht';
        const content = `Die IP-Adresse ${ip} wurde vorübergehend gesperrt, da sie ${failedCount} fehlgeschlagene Loginversuche durchgeführt hat (letzter Versuch mit Benutzernamen/E-Mail: "${email}").`;

        for (const admin of admins) {
          await notify({
            userId: admin.id,
            type: 'system',
            title,
            content
          });
        }

        const { sendEmail } = require('../services/emailService');
        const safeIp = escapeHtml(ip);
        const safeEmail = escapeHtml(email);
        const emailHtml = `
          <h3>Sicherheitswarnung: Brute-Force-Verdacht</h3>
          <p>Hallo Admin,</p>
          <p>in OpenISMS wurden ungewöhnlich viele fehlgeschlagene Anmeldeversuche festgestellt:</p>
          <ul>
            <li><strong>IP-Adresse:</strong> ${safeIp}</li>
            <li><strong>Anzahl Fehlversuche:</strong> ${failedCount} (in den letzten 15 Minuten)</li>
            <li><strong>Letzter eingegebener Benutzer/E-Mail:</strong> ${safeEmail}</li>
            <li><strong>Status:</strong> Die IP-Adresse wird vorübergehend blockiert.</li>
          </ul>
          <p>Bitte überprüfen Sie die Audit-Logs für weitere Details.</p>
          <p>Ihr OpenISMS-System</p>
        `;
        const emailText = `Sicherheitswarnung: Brute-Force-Verdacht\n\nHallo Admin,\n\nin OpenISMS wurden ungewöhnlich viele fehlgeschlagene Anmeldeversuche von der IP-Adresse ${ip} festgestellt (${failedCount} Fehlversuche in 15 Minuten, letzter Benutzer: [siehe Audit-Log]). Die IP-Adresse wurde vorübergehend blockiert.\n\nIhr OpenISMS-System`;

        for (const admin of admins) {
          await sendEmail({
            to: admin.email,
            subject: 'Sicherheitswarnung: Brute-Force-Verdacht',
            html: emailHtml,
            text: emailText
          }).catch(err => console.error(`Failed to send security alert email to admin ${admin.email}:`, err.message));
        }
      } catch (err) {
        console.error('Error handling brute force alerting:', err.message);
      }
    }
  }
};

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'E-Mail und Passwort sind erforderlich' });

    const ip = getClientIp(req);
    if (ip && await isIpBlocked(ip)) {
      return res.status(403).json(genericLockoutError);
    }

    const user = await User.findOne({ where: { email, active: true } });
    if (!user) {
      await auditFromReq(req, 'login', 'auth', null, email, { success: false, email, reason: 'Benutzer nicht gefunden oder inaktiv' });
      await handleFailedLoginForIp(req, email);
      return res.status(401).json(genericLoginError);
    }
    if (user.lockout_until && new Date() < new Date(user.lockout_until)) {
      await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: false, email: user.email, reason: 'Konto gesperrt' });
      await handleFailedLoginForIp(req, user.email);
      return res.status(403).json(genericLockoutError);
    }
    if (user.sso_user) {
      await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: false, email: user.email, reason: 'SSO-Benutzer versucht Passwort-Login' });
      await handleFailedLoginForIp(req, user.email);
      return res.status(401).json(genericLoginError);
    }
    if (!(await user.validatePassword(password))) {
      user.failed_login_attempts += 1;
      const { getGeneral } = require('../services/settingsService');
      const settings = await getGeneral();
      const policy = settings.bruteForcePolicy || { maxAttempts: 5, lockoutMinutes: 15 };
      
      await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: false, email: user.email, reason: 'Ungültiges Passwort' });
      await handleFailedLoginForIp(req, user.email);

      if (user.failed_login_attempts >= policy.maxAttempts) {
        const lockoutUntil = new Date();
        lockoutUntil.setMinutes(lockoutUntil.getMinutes() + (policy.lockoutMinutes || 15));
        user.lockout_until = lockoutUntil;
        await user.save();
        return res.status(403).json(genericLockoutError);
      } else {
        await user.save();
        return res.status(401).json(genericLoginError);
      }
    }

    // Reset failed attempts upon successful login
    if (user.failed_login_attempts > 0 || user.lockout_until) {
      user.failed_login_attempts = 0;
      user.lockout_until = null;
      await user.save();
    }
    
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET not set');
      return res.status(500).json(genericServerError);
    }

    // If TOTP is enabled, return a temporary pending token instead of the full session token
    if (user.totp_enabled) {
      const temp_token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, totp_pending: true },
        jwtSecret,
        { expiresIn: '5m' }
      );
      return res.json({ requires_totp: true, temp_token });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: '24h' });
    req.user = user;
    await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: true, email: user.email });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department } });
  } catch (e) {
    console.error('[Login error]', e);
    res.status(500).json(genericServerError);
  }
});

// Complete login with TOTP code
router.post('/login/totp', async (req, res) => {
  try {
    const { temp_token, token } = req.body;
    if (!temp_token || !token) return res.status(400).json({ error: 'Temporärer Login-Token und TOTP-Code sind erforderlich' });

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('JWT_SECRET not set');
      return res.status(500).json(genericServerError);
    }

    let decoded;
    try {
      decoded = jwt.verify(temp_token, jwtSecret, { algorithms: ['HS256'] });
    } catch (e) {
      return res.status(401).json({ error: 'Ungültiges oder abgelaufenes Token' });
    }

    if (!decoded.totp_pending) return res.status(401).json({ error: 'Ungültige Anfrage' });

    const user = await User.findOne({ where: { id: decoded.id, active: true } });
    if (!user || !user.totp_enabled || !user.totp_secret) {
      return res.status(401).json({ error: 'Ungültige Anfrage' });
    }

    const cleanToken = String(token).replace(/\s+/g, '');
    const { valid } = await authenticator.verify(cleanToken, { secret: user.totp_secret });
    if (!valid) {
      await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: false, email: user.email, reason: 'Ungültiger TOTP-Code' });
      await handleFailedLoginForIp(req, user.email);
      return res.status(401).json({ error: 'Ungültiger TOTP-Code' });
    }

    // Replay prevention: store the 30s time-step so any code re-use within the same window is blocked
    const currentStep = String(Math.floor(Date.now() / 30000));
    if (user.totp_last_used === currentStep) {
      await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: false, email: user.email, reason: 'TOTP-Code bereits verwendet' });
      await handleFailedLoginForIp(req, user.email);
      return res.status(401).json({ error: 'TOTP-Code bereits verwendet' });
    }
    user.totp_last_used = currentStep;
    await user.save();

    const sessionToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: '24h' }
    );

    req.user = user;
    await auditFromReq(req, 'login', 'auth', user.id, user.name, { success: true, email: user.email, totp: true });
    res.json({ token: sessionToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department } });
  } catch (e) {
    console.error('[Login TOTP error]', e);
    res.status(500).json(genericServerError);
  }
});

router.get('/me', authenticate, (req, res) => res.json(req.user));

router.post('/change-password', authenticate, async (req, res) => {
  if (req.user.sso_user) return res.status(403).json({ error: 'Passwortänderung ist für SSO-Benutzer deaktiviert.' });
  try {
    const { current_password, new_password } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!(await user.validatePassword(current_password))) return res.status(400).json({ error: 'Aktuelles Passwort ist falsch' });
    const check = await validatePassword(new_password);
    if (!check.valid) return res.status(400).json({ error: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` });
    user.password_hash = await User.hashPassword(new_password);
    await user.save();
    await auditFromReq(req, 'update', 'auth', user.id, user.name, { action: 'password_changed' });
    res.json({ message: 'Passwort geändert' });
  } catch (e) {
    console.error('[Change password error]', e);
    res.status(500).json(genericServerError);
  }
});

// --- 2FA / TOTP ---

// Setup: generate new TOTP secret, return QR code (not yet saved to DB)
router.get('/2fa/setup', authenticate, async (req, res) => {
  if (req.user.sso_user) return res.status(403).json({ error: 'MFA (2FA) kann für SSO-Benutzer nicht konfiguriert werden.' });
  try {
    const user = await User.findByPk(req.user.id);
    const secret = authenticator.generateSecret();
    const otpauth_url = authenticator.toURI({ label: user.email, issuer: 'OpenISMS', secret });
    const qr_data_url = await qrcode.toDataURL(otpauth_url);

    // Store temporarily in session until user verifies
    req.session.totp_setup = { secret };

    res.json({ secret, otpauth_url, qr_data_url });
  } catch (e) {
    console.error('[2FA setup error]', e);
    res.status(500).json(genericServerError);
  }
});

// Verify: confirm TOTP code and save secret to user
router.post('/2fa/verify', authenticate, async (req, res) => {
  if (req.user.sso_user) return res.status(403).json({ error: 'MFA (2FA) kann für SSO-Benutzer nicht konfiguriert werden.' });
  try {
    const { token, secret } = req.body;
    if (!token) return res.status(400).json({ error: 'token erforderlich' });

    const activeSecret = secret || req.session.totp_setup?.secret;
    if (!activeSecret) return res.status(400).json({ error: 'Kein Setup-Prozess aktiv. Bitte GET /2fa/setup aufrufen.' });

    const cleanToken = String(token).replace(/\s+/g, '');
    const { valid } = await authenticator.verify(cleanToken, { secret: activeSecret });
    if (!valid) return res.status(400).json({ error: 'Ungültiger TOTP-Code' });

    const user = await User.findByPk(req.user.id);
    user.totp_secret = activeSecret;
    user.totp_enabled = true;
    await user.save();

    delete req.session.totp_setup;

    await auditFromReq(req, 'update', 'auth', user.id, user.name, { action: '2fa_enabled' });
    res.json({ success: true });
  } catch (e) {
    console.error('[2FA verify error]', e);
    res.status(500).json(genericServerError);
  }
});

// Disable 2FA (requires current TOTP code as confirmation)
router.post('/2fa/disable', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token erforderlich' });

    const user = await User.findByPk(req.user.id);
    if (!user.totp_enabled || !user.totp_secret) {
      return res.status(400).json({ error: '2FA ist nicht aktiviert' });
    }

    const cleanToken = String(token).replace(/\s+/g, '');
    const { valid } = await authenticator.verify(cleanToken, { secret: user.totp_secret });
    if (!valid) return res.status(400).json({ error: 'Ungültiger TOTP-Code' });

    user.totp_enabled = false;
    user.totp_secret = null;
    await user.save();

    await auditFromReq(req, 'update', 'auth', user.id, user.name, { action: '2fa_disabled' });
    res.json({ success: true });
  } catch (e) {
    console.error('[2FA disable error]', e);
    res.status(500).json(genericServerError);
  }
});

// Request password reset (forgot-password) - fully anonymous response
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const genericResponse = { message: 'Wenn die E-Mail-Adresse registriert ist, wurde eine E-Mail mit Anweisungen zum Zurücksetzen des Passworts gesendet.' };
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-Mail-Adresse ist erforderlich' });

    const user = await User.findOne({ where: { email: email.toLowerCase().trim(), active: true } });
    if (!user) {
      await auditFromReq(req, 'request', 'auth', null, email.toLowerCase().trim(), { action: 'forgot_password_unknown' });
      // Return the generic response immediately, preventing user enumeration
      return res.json(genericResponse);
    }

    await auditFromReq(req, 'request', 'auth', user.id, user.name, { action: 'forgot_password_requested' });

    if (user.sso_user) {
      // Send OIDC reminder email instead of reset token
      const html = `<p>Hallo ${user.name},</p>
                    <p>Sie haben ein Zurücksetzen Ihres Passworts angefordert.</p>
                    <p>Ihr Account ist jedoch für Single Sign-On (SSO) konfiguriert. Bitte melden Sie sich stattdessen direkt über Ihren Identity Provider an.</p>
                    <p>Ihr ISMS Team</p>`;
      const text = `Hallo ${user.name},\n\nSie haben ein Zurücksetzen Ihres Passworts angefordert.\n\nIhr Account ist jedoch für Single Sign-On (SSO) konfiguriert. Bitte melden Sie sich stattdessen direkt über Ihren Identity Provider an.\n\nIhr ISMS Team`;
      
      const { sendEmail } = require('../services/emailService');
      await sendEmail({ to: user.email, subject: 'Passwort zurücksetzen (SSO-Account)', html, text })
        .catch(e => console.error('[Reset password SSO email error]', e.message));
        
      await auditFromReq(req, 'request', 'auth', user.id, user.name, { action: 'forgot_password_sso' });
      return res.json(genericResponse);
    }

    // Generate secure random token. In der DB liegt nur der SHA-256-Hash —
    // bei einem DB-Leak sind aktive Reset-Links damit nicht direkt verwertbar.
    const token = crypto.randomBytes(32).toString('hex');
    user.reset_password_token = crypto.createHash('sha256').update(token).digest('hex');
    user.reset_password_expires = new Date(Date.now() + 3600000); // 1 hour validity
    await user.save();

    const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
    const html = `<p>Hallo ${user.name},</p>
                  <p>Sie haben ein Zurücksetzen Ihres Passworts angefordert.</p>
                  <p>Bitte klicken Sie auf den folgenden Link, um ein neues Passwort zu vergeben:</p>
                  <p><a href="${resetUrl}">${resetUrl}</a></p>
                  <p>Dieser Link ist für 1 Stunde gültig. Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.</p>
                  <p>Ihr ISMS Team</p>`;
    const text = `Hallo ${user.name},\n\nSie haben ein Zurücksetzen Ihres Passworts angefordert.\n\nBitte klicken Sie auf den folgenden Link, um ein neues Passwort zu vergeben:\n\n${resetUrl}\n\nDieser Link ist für 1 Stunde gültig. Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese E-Mail.\n\nIhr ISMS Team`;

    const { sendEmail } = require('../services/emailService');
    await sendEmail({ to: user.email, subject: 'Passwort zurücksetzen', html, text })
      .catch(e => console.error('[Reset password email error]', e.message));

    res.json(genericResponse);
  } catch (e) {
    // Return generic response even on error to prevent leakage of details, but log it
    console.error('[Forgot password error]', e);
    res.json(genericResponse);
  }
});

// Perform password reset using token - fully anonymous response on invalid token
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: 'Token und neues Passwort sind erforderlich.' });

    // Token wird gehasht gespeichert — Lookup über den Hash des übergebenen Tokens
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
    const user = await User.findOne({
      where: {
        reset_password_token: tokenHash,
        reset_password_expires: { [Op.gt]: new Date() },
        active: true
      }
    });

    if (!user) {
      await auditFromReq(req, 'request', 'auth', null, null, { action: 'password_reset_invalid_token' });
      // Return generic error, preventing attacker from knowing if token exists but expired vs doesn't exist
      return res.status(400).json({ error: 'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen.' });
    }

    const check = await validatePassword(new_password);
    if (!check.valid) {
      return res.status(400).json({ error: `Passwort entspricht nicht der Richtlinie: ${check.errors.join(', ')}` });
    }

    user.password_hash = await User.hashPassword(new_password);
    user.reset_password_token = null;
    user.reset_password_expires = null;
    user.failed_login_attempts = 0; // reset lockout on password reset
    user.lockout_until = null;
    await user.save();

    await auditFromReq(req, 'update', 'auth', user.id, user.name, { action: 'password_reset_via_email' });
    res.json({ message: 'Ihr Passwort wurde erfolgreich zurückgesetzt. Sie können sich nun anmelden.' });
  } catch (e) {
    console.error('[Reset password error]', e);
    res.status(500).json({ error: 'Interner Serverfehler beim Zurücksetzen des Passworts.' });
  }
});

module.exports = router;
