'use strict';

/**
 * CORS and Origin validation for the MCP endpoints (/mcp, /sse).
 *
 * Configuration: MCP_CORS_ORIGINS (comma-separated list of origins).
 *
 *   unset / empty   Same allow-list as the web UI (APP_URL). Browser-based MCP
 *                   clients on another origin are refused.
 *   "https://a,..." Exactly these origins (plus APP_URL).
 *   "*"             Any origin (explicit opt-in). Responses carry
 *                   Access-Control-Allow-Origin: * and never credentials.
 *
 * Requests WITHOUT an Origin header (Claude Desktop, Claude Code, claude.ai
 * connectors, curl - every non-browser MCP client) are always allowed; their
 * authentication is the bearer token / API key, never a cookie.
 *
 * Requests WITH an Origin header that is not allowed are answered with 403
 * before they reach the MCP transport. That is the Origin check the MCP
 * Streamable HTTP transport specification asks servers to perform against DNS
 * rebinding: a page on a foreign origin must not be able to drive the server
 * through the visitor's browser, even though no cookie is involved.
 */

const cors = require('cors');

const ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-API-Key',
  'x-api-key',
  'x-mcp-key',
  'mcp-session-id',
  'MCP-Session-Id',
  'last-event-id',
  'Last-Event-ID',
  'mcp-protocol-version',
  'MCP-Protocol-Version',
  'Accept',
  'Origin',
];

const EXPOSED_HEADERS = ['mcp-session-id', 'MCP-Session-Id', 'WWW-Authenticate'];

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/**
 * Resolve the effective MCP origin policy from the environment.
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ any: boolean, origins: string[], source: string }}
 */
function resolveMcpOriginPolicy(env = process.env) {
  const appOrigins = parseList(env.APP_URL || 'http://localhost:3000');
  const configured = parseList(env.MCP_CORS_ORIGINS);

  if (configured.includes('*')) {
    return { any: true, origins: [], source: 'MCP_CORS_ORIGINS=*' };
  }
  if (configured.length > 0) {
    return {
      any: false,
      origins: [...new Set([...configured, ...appOrigins])],
      source: 'MCP_CORS_ORIGINS + APP_URL',
    };
  }
  return { any: false, origins: appOrigins, source: 'APP_URL' };
}

/**
 * Express middleware: refuse disallowed Origins with 403, then apply CORS.
 * @param {NodeJS.ProcessEnv} env
 */
function createMcpCors(env = process.env) {
  const policy = resolveMcpOriginPolicy(env);

  const isAllowed = (origin) => policy.any || policy.origins.includes(origin.replace(/\/$/, ''));

  const corsMiddleware = cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, false); // no Origin: no CORS headers needed
      if (policy.any) return cb(null, '*');
      return cb(null, isAllowed(origin) ? origin : false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    credentials: false,
  });

  const middleware = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !isAllowed(origin)) {
      res.status(403).json({
        error: 'origin_not_allowed',
        message: 'This Origin may not access the MCP endpoint. Configure MCP_CORS_ORIGINS on the server.',
      });
      return;
    }
    corsMiddleware(req, res, next);
  };
  middleware.policy = policy;
  return middleware;
}

module.exports = { createMcpCors, resolveMcpOriginPolicy, ALLOWED_HEADERS, EXPOSED_HEADERS };
