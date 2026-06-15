'use strict';

const rateLimit = require('express-rate-limit');

// General limiter for authenticated API endpoints (CWE-770).
// Sized generously for a single-page app that fires many requests per page and
// for multiple users sharing one egress IP (corporate NAT). The cap still stops
// runaway scripts / scrapers while never getting in the way of normal use.
// Overridable via RATE_LIMIT_API_MAX.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX) || 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte warte 15 Minuten.' },
});

// Limiter for expensive operations (DB dumps, bulk imports, network scans,
// report aggregations). Overridable via RATE_LIMIT_HEAVY_MAX.
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_HEAVY_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen für diese Operation. Bitte warte 15 Minuten.' },
});

module.exports = { apiLimiter, heavyLimiter };
