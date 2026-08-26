'use strict';

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// Rate-limit key: per authenticated user (hashed Bearer token) when present,
// otherwise per IP. Keying by user matters behind corporate NAT / a reverse
// proxy where many users share one egress IP — IP-only keying would make them
// share a single budget and trip the limit during normal concurrent use.
// Both limiters below are mounted TWICE on most paths: once app-wide in
// index.js and once inside each router (the per-router mount is what CodeQL
// wants to see on the handler, CWE-770). express-rate-limit counts every pass
// through the middleware, so that duplication silently HALVED every budget —
// /api/discovery allowed 150 requests per window, not 300. Deleting 291 staged
// software entries could therefore never finish: it ran out mid-way and every
// later request, including the reload, came back 429.
//
// Marking the request on the first pass and skipping subsequent ones keeps both
// mounts in place (CodeQL still sees a limiter on the route) while counting each
// request exactly once. The marker is a Symbol so it cannot collide with
// anything else hung off `req`.
const countOncePerRequest = (marker) => (req) => {
  if (req[marker]) return true; // already counted and enforced earlier in the chain
  req[marker] = true;
  return false;
};

const API_COUNTED = Symbol('rateLimit:api');
const HEAVY_COUNTED = Symbol('rateLimit:heavy');

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
  skip: countOncePerRequest(API_COUNTED),
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
  skip: countOncePerRequest(HEAVY_COUNTED),
  message: { error: 'Zu viele Anfragen für diese Operation. Bitte warte 15 Minuten.' },
});

module.exports = { apiLimiter, heavyLimiter };
