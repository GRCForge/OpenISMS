#!/usr/bin/env node
'use strict';

/**
 * MCP-Anmeldung als OAuth-2.1-Resource-Server (backend/src/mcp/auth.js,
 * backend/src/mcp/oauthResource.js).
 *
 * Geprueft wird mit echten, lokal signierten RS256-Tokens; Discovery und JWKS
 * des "Issuers" liefert ein gemocktes fetch, Models und Settings sind gemockt.
 * Keine Datenbank, kein Netz.
 *
 *  - Token mit aud = <APP_URL>/mcp           -> angemeldet
 *  - Token mit fremder aud (anderer Client)  -> 401 invalid_token
 *  - abgelaufener Token                      -> 401 invalid_token
 *  - falscher Issuer / fremder Schluessel    -> 401
 *  - HS256-Token mit JWKS-"Secret"           -> 401 (keine alg-Verwechslung)
 *  - ID-Token (typ ID) mit passender aud     -> 401
 *  - API-Token isms_api_...                  -> angemeldet
 *  - ohne Token                              -> 401 mit resource_metadata, ohne error
 *  - fehlender Pflicht-Scope                 -> 403 insufficient_scope
 *  - unbekannter Benutzer                    -> 401, kein Auto-Provisioning
 *
 * Run: node scripts/test-mcp-auth.js
 */

const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SRC = path.join(__dirname, '..', 'backend', 'src');
const ISSUER = 'https://idp.example.test/realms/test';
const APP_URL = 'https://isms.example.test';
const RESOURCE = `${APP_URL}/mcp`;

process.env.APP_URL = APP_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-mcp-auth-only';
delete process.env.MCP_SECRET;
delete process.env.MCP_OAUTH_AUDIENCES;
delete process.env.MCP_OAUTH_ALLOWED_CLIENTS;
delete process.env.MCP_OAUTH_REQUIRED_SCOPE;
delete process.env.MCP_OAUTH_AUTO_PROVISION;
delete process.env.MCP_OAUTH_SCOPES;

// ─── Mocks ───────────────────────────────────────────────────────────────────

const USERS = [
  { id: 1, name: 'Alice', email: 'alice@example.test', role: 'assessor', custom_role_id: null, active: true },
  { id: 2, name: 'Bob', email: 'bob@example.test', role: 'viewer', custom_role_id: null, active: false },
];
const API_TOKEN = `isms_api_${'a'.repeat(64)}`;
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
let created = 0;
let general = { ssoAutoProvision: true, ssoDefaultRole: 'viewer', ssoAllowedDomains: '' };
let oidcCfg = { enabled: true, issuer: ISSUER, clientId: 'openisms', scopes: 'openid profile email' };

const mock = (rel, exports) => {
  Module._cache[require.resolve(path.join(SRC, rel))] = { id: rel, loaded: true, exports };
};
mock('models', {
  User: {
    findOne: async ({ where }) => USERS.find((u) => u.email === where.email) || null,
    findByPk: async (id) => USERS.find((u) => u.id === id) || null,
    create: async () => { created++; return { id: 99, active: true }; },
    hashPassword: async () => 'x',
  },
  ApiToken: {
    findOne: async ({ where }) => (where.token_hash === sha(API_TOKEN) ? { user_id: 1, name: 't', expires_at: null } : null),
  },
});
mock('services/cryptoService', { hashToken: sha });
mock('services/settingsService', {
  getOidcConfig: async () => oidcCfg,
  getGeneral: async () => general,
});

let jose;
let keys;
let otherKeys;
const realFetch = globalThis.fetch;

const sign = async (claims, { key = keys.privateKey, kid = 'k1', exp = '5m', alg = 'RS256' } = {}) =>
  new jose.SignJWT({ typ: 'Bearer', email: 'alice@example.test', email_verified: true, ...claims })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuer(claims.iss || ISSUER)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);

const run = async (mcpAuth, headers) => {
  const req = { method: 'POST', headers, query: {}, originalUrl: '/mcp', path: '/' };
  const res = {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    type() { return this; },
    end() { return this; },
  };
  let passed = false;
  await mcpAuth(req, res, () => { passed = true; });
  return { passed, req, res };
};

test('MCP auth', async (t) => {
  // Abhaengigkeiten liegen unter backend/node_modules, das Skript laeuft aus dem Repo-Root.
  const { pathToFileURL } = require('url');
  jose = await import(pathToFileURL(require.resolve('jose', { paths: [path.join(SRC, '..')] })).href);
  keys = await jose.generateKeyPair('RS256');
  otherKeys = await jose.generateKeyPair('RS256');
  const jwk = { ...(await jose.exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u === `${ISSUER}/.well-known/openid-configuration`
      ? { issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` }
      : u === `${ISSUER}/protocol/openid-connect/certs` ? { keys: [jwk] } : null;
    if (!body) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const { mcpAuth } = require(path.join(SRC, 'mcp', 'auth'));
  const oauth = require(path.join(SRC, 'mcp', 'oauthResource'));
  const bearer = (tok) => ({ authorization: `Bearer ${tok}` });

  await t.test('token with aud = resource URL is accepted', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: [RESOURCE, 'account'], azp: 'some-dcr-client' })));
    assert.equal(r.passed, true);
    assert.equal(r.req.mcpUser.id, 1);
    assert.equal(r.req.mcpUser.role, 'assessor');
  });

  await t.test('token for another client (foreign aud) is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: 'account', azp: 'grafana' })));
    assert.equal(r.passed, false);
    assert.equal(r.res.statusCode, 401);
    assert.match(r.res.headers['www-authenticate'], /error="invalid_token"/);
    assert.match(r.res.headers['www-authenticate'], /resource_metadata="https:\/\/isms\.example\.test\/\.well-known\/oauth-protected-resource"/);
  });

  await t.test('token without aud is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ azp: 'openisms' })));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('expired token is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE }, { exp: Math.floor(Date.now() / 1000) - 120 })));
    assert.equal(r.res.statusCode, 401);
    assert.match(r.res.headers['www-authenticate'], /Token expired/);
  });

  await t.test('wrong issuer is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, iss: 'https://evil.example.test/realms/test' })));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('token signed by a foreign key is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE }, { key: otherKeys.privateKey })));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('HS256 token is never checked against the IdP keys', async () => {
    const hs = await sign({ aud: RESOURCE }, { key: new TextEncoder().encode('guess'), alg: 'HS256' });
    const r = await run(mcpAuth, bearer(hs));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('ID token (typ ID) is not an access token', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, typ: 'ID' })));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('explicitly allowed client id (azp) is accepted', async () => {
    process.env.MCP_OAUTH_ALLOWED_CLIENTS = 'claude-desktop';
    try {
      const r = await run(mcpAuth, bearer(await sign({ aud: 'account', azp: 'claude-desktop' })));
      assert.equal(r.passed, true);
    } finally { delete process.env.MCP_OAUTH_ALLOWED_CLIENTS; }
  });

  await t.test('missing required scope gives 403 insufficient_scope', async () => {
    process.env.MCP_OAUTH_REQUIRED_SCOPE = 'isms-mcp';
    try {
      const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, scope: 'openid email' })));
      assert.equal(r.res.statusCode, 403);
      assert.match(r.res.headers['www-authenticate'], /error="insufficient_scope"/);
      assert.match(r.res.headers['www-authenticate'], /scope="isms-mcp"/);
      const ok = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, scope: 'openid email isms-mcp' })));
      assert.equal(ok.passed, true);
    } finally { delete process.env.MCP_OAUTH_REQUIRED_SCOPE; }
  });

  await t.test('unverified email is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, email_verified: false })));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('inactive user is rejected', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, email: 'bob@example.test' })));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('unknown user is not auto-provisioned by default', async () => {
    const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE, email: 'new@example.test' })));
    assert.equal(r.res.statusCode, 401);
    assert.equal(created, 0);
  });

  await t.test('API token (isms_api_) is accepted', async () => {
    const r = await run(mcpAuth, bearer(API_TOKEN));
    assert.equal(r.passed, true);
    assert.equal(r.req.mcpUser.id, 1);
  });

  await t.test('unknown API token is rejected', async () => {
    const r = await run(mcpAuth, bearer(`isms_api_${'b'.repeat(64)}`));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('opaque garbage is rejected without contacting the IdP userinfo', async () => {
    const r = await run(mcpAuth, bearer('opaque-reference-token'));
    assert.equal(r.res.statusCode, 401);
  });

  await t.test('no token: 401 with resource_metadata and scope, no error attribute', async () => {
    const r = await run(mcpAuth, {});
    assert.equal(r.res.statusCode, 401);
    const h = r.res.headers['www-authenticate'];
    assert.match(h, /^Bearer resource_metadata="/);
    assert.match(h, /scope="openid profile email"/);
    assert.doesNotMatch(h, /error=/);
  });

  await t.test('MCP_SECRET keeps admin by default, MCP_SECRET_ROLE lowers it', async () => {
    process.env.MCP_SECRET = 'static-secret-value-for-test';
    try {
      let r = await run(mcpAuth, bearer('static-secret-value-for-test'));
      assert.equal(r.req.mcpUser.role, 'admin');
      process.env.MCP_SECRET_ROLE = 'viewer';
      r = await run(mcpAuth, bearer('static-secret-value-for-test'));
      assert.equal(r.req.mcpUser.role, 'viewer');
      process.env.MCP_SECRET_ROLE = 'superuser';
      r = await run(mcpAuth, bearer('static-secret-value-for-test'));
      assert.equal(r.req.mcpUser.role, 'viewer', 'unknown role falls back to viewer');
    } finally { delete process.env.MCP_SECRET; delete process.env.MCP_SECRET_ROLE; }
  });

  await t.test('protected resource metadata', () => {
    process.env.MCP_OAUTH_REQUIRED_SCOPE = 'isms-mcp';
    try {
      const m = oauth.buildProtectedResourceMetadata(oidcCfg);
      assert.equal(m.resource, RESOURCE);
      assert.deepEqual(m.authorization_servers, [ISSUER]);
      assert.deepEqual(m.scopes_supported, ['openid', 'profile', 'email', 'isms-mcp']);
      assert.deepEqual(m.bearer_methods_supported, ['header']);
      assert.equal(oauth.buildProtectedResourceMetadata({ enabled: false, issuer: ISSUER }), null);
    } finally { delete process.env.MCP_OAUTH_REQUIRED_SCOPE; }
  });

  await t.test('without OIDC an IdP token is rejected and no resource_metadata is announced', async () => {
    const saved = oidcCfg;
    oidcCfg = { enabled: false };
    try {
      const r = await run(mcpAuth, bearer(await sign({ aud: RESOURCE })));
      assert.equal(r.res.statusCode, 401);
      assert.match(r.res.headers['www-authenticate'], /realm="OpenISMS MCP"/);
    } finally { oidcCfg = saved; }
  });

  globalThis.fetch = realFetch;
});
