#!/usr/bin/env node
'use strict';

/**
 * MCP_CORS_ORIGINS: Origin-Pruefung und CORS fuer /mcp und /sse.
 *
 * Geprueft wird das Verhalten am echten Express-Stack: Anfragen ohne Origin
 * (native MCP-Clients) gehen durch, eine fremde Origin bekommt 403 vor der
 * Route, erlaubte Origins bekommen ihre eigene Origin zurueck, nie Credentials,
 * "*" ist ein ausdrueckliches Opt-in.
 *
 * Run: node scripts/test-mcp-cors.js
 */

const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
// Die Skripte laufen aus dem Repo-Root, die Abhaengigkeiten liegen unter
// backend/node_modules — daher der explizite Pfad.
const express = require(path.join(__dirname, '..', 'backend', 'node_modules', 'express'));
const { createMcpCors, resolveMcpOriginPolicy } =
  require(path.join(__dirname, '..', 'backend', 'src', 'mcp', 'cors'));

async function withServer(env, fn) {
  const app = express();
  app.use(createMcpCors(env));
  app.all('/', (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('default policy is the APP_URL allow-list', () => {
  const p = resolveMcpOriginPolicy({ APP_URL: 'https://isms.example.com/' });
  assert.equal(p.any, false);
  assert.deepEqual(p.origins, ['https://isms.example.com']);
  assert.equal(p.source, 'APP_URL');
});

test('MCP_CORS_ORIGINS adds origins on top of APP_URL', () => {
  const p = resolveMcpOriginPolicy({
    APP_URL: 'https://isms.example.com',
    MCP_CORS_ORIGINS: 'https://inspector.example.com, https://isms.example.com',
  });
  assert.equal(p.any, false);
  assert.deepEqual(p.origins, ['https://inspector.example.com', 'https://isms.example.com']);
});

test('"*" is an explicit opt-in for any origin', () => {
  const p = resolveMcpOriginPolicy({ APP_URL: 'https://isms.example.com', MCP_CORS_ORIGINS: '*' });
  assert.equal(p.any, true);
});

test('request without Origin (native MCP client) passes, no CORS headers', async () => {
  await withServer({ APP_URL: 'https://isms.example.com' }, async (base) => {
    const res = await fetch(base, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

test('foreign Origin is refused with 403 before the route', async () => {
  await withServer({ APP_URL: 'https://isms.example.com' }, async (base) => {
    const res = await fetch(base, { method: 'POST', headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'origin_not_allowed');
  });
});

test('allowed Origin gets its own origin reflected, never credentials', async () => {
  await withServer({ APP_URL: 'https://isms.example.com' }, async (base) => {
    const res = await fetch(base, { method: 'POST', headers: { Origin: 'https://isms.example.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://isms.example.com');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  });
});

test('preflight from an allowed origin returns 204 with MCP headers', async () => {
  await withServer({ APP_URL: 'https://isms.example.com', MCP_CORS_ORIGINS: 'https://inspector.example.com' }, async (base) => {
    const res = await fetch(base, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://inspector.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'mcp-session-id, authorization',
      },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://inspector.example.com');
    assert.match(res.headers.get('access-control-allow-headers'), /mcp-session-id/i);
  });
});

test('"*" answers any origin with a literal wildcard', async () => {
  await withServer({ APP_URL: 'https://isms.example.com', MCP_CORS_ORIGINS: '*' }, async (base) => {
    const res = await fetch(base, { method: 'POST', headers: { Origin: 'https://anything.example' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
