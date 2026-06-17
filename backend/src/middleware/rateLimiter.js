'use strict';

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Rate-limit key: per authenticated user (hashed Bearer token) when present,
// otherwise per IP. Keying by user matters behind corporate NAT / a reverse
// proxy where many users share one egress IP — IP-only keying would make them
// share a single budget and trip the limit during normal concurrent use.
const userOrIpKey = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return 'u:' + crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 32);
  }
  return typeof rateLimit.ipKeyGenerator === 'function' ? rateLimit.ipKeyGenerator(req.ip) : req.ip;
};

// General limiter for authenticated API endpoints (CWE-770).
// Sized generously for a single-page app that fires many requests per page.
// Keyed per user (see userOrIpKey), so the cap is a per-user safety net against
// runaway scripts / scrapers, not a shared pool. Overridable via RATE_LIMIT_API_MAX.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX) || 5000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Anfragen. Bitte warte 15 Minuten.' },
});

// Limiter for expensive operations (DB dumps, bulk imports, network scans,
// report aggregations). Overridable via RATE_LIMIT_HEAVY_MAX.
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_HEAVY_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Zu viele Anfragen für diese Operation. Bitte warte 15 Minuten.' },
});

module.exports = { apiLimiter, heavyLimiter };
