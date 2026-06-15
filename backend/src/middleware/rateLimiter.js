'use strict';

const rateLimit = require('express-rate-limit');

// General limiter for authenticated API endpoints (CWE-770)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte warte 15 Minuten.' },
});

// Limiter for expensive operations (DB dumps, bulk imports, network scans, report aggregations)
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen für diese Operation. Bitte warte 15 Minuten.' },
});

module.exports = { apiLimiter, heavyLimiter };
