const nodemailer = require('nodemailer');
const { getSetting } = require('./settingsService');
const { decrypt } = require('./cryptoService');

async function getSmtpConfig() {
  const raw = await getSetting('smtp');
  if (!raw) return null;
  const cfg = JSON.parse(raw);
  // Decrypt password if stored encrypted (prefixed with enc:)
  if (cfg.password?.startsWith('enc:')) {
    cfg.password = decrypt(cfg.password.slice(4)) ?? '';
  }
  return cfg;
}

function buildTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: Number(cfg.port) || 587,
    secure: cfg.secure === true || cfg.secure === 'true',
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    tls: { rejectUnauthorized: cfg.tls_reject_unauthorized !== false },
  });
}

async function sendEmail({ to, subject, html, text }) {
  const cfg = await getSmtpConfig();
  if (!cfg?.host) throw new Error('SMTP nicht konfiguriert');
  return buildTransport(cfg).sendMail({ from: cfg.from || 'ISMS <noreply@isms.local>', to, subject, html, text });
}

async function testSmtp(cfg) {
  await buildTransport(cfg).verify();
}

module.exports = { sendEmail, testSmtp, getSmtpConfig };
