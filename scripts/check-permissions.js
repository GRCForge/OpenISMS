#!/usr/bin/env node
'use strict';

/**
 * Guards the contract between the permission matrix and the routes.
 *
 * requirePermission(module, action, ...fallbackRoles) lets the matrix decide and
 * falls back to the role list the route carried before. That only stays honest
 * while the matrix DEFAULT for module.action lists exactly those fallback roles:
 * if the two drift apart, an installation that never touched the matrix behaves
 * differently from one that saved it once (saving writes the defaults, which then
 * become authoritative). This script fails when they disagree.
 *
 * It also reports:
 *   - requirePermission calls naming a module/action the matrix does not define
 *   - matrix entries no route uses (dead knobs in the admin UI)
 *
 * Run: node scripts/check-permissions.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'backend/src/routes');
const SETTINGS = path.join(ROOT, 'backend/src/services/settingsService.js');

// Endpoints that are deliberately not matrix-gated: authentication itself and
// self-service on the caller's own records. Gating these on a matrix an admin can
// edit would let an installation lock every user out of their own account.
const UNGATED_FILES = new Set(['auth.js', 'authOidc.js', 'passkey.js', 'me.js', 'notifications.js', 'push.js']);

function parseMatrix() {
  const src = fs.readFileSync(SETTINGS, 'utf8');
  const block = src.match(/const DEFAULT_PERMISSIONS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('DEFAULT_PERMISSIONS nicht gefunden');
  const matrix = {};
  const entryRe = /^\s{2}([a-z0-9_]+):\s*\{([\s\S]*?)\},\s*$/gm;
  let m;
  while ((m = entryRe.exec(block[1])) !== null) {
    const actions = {};
    const actionRe = /(\w+):\s*\[([^\]]*)\]/g;
    let a;
    while ((a = actionRe.exec(m[2])) !== null) {
      actions[a[1]] = a[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    }
    matrix[m[1]] = actions;
  }
  return matrix;
}

function parseRoutes() {
  const calls = [];
  for (const file of fs.readdirSync(ROUTES_DIR).sort()) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const re = /requirePermission\(\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*([^)]*)\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const tail = m[3];
      // Spread of a named constant (…TRIAGE_ROLES) — resolve it from the file.
      const spread = tail.match(/\.\.\.([A-Z_]+)/);
      let roles;
      if (spread) {
        const decl = src.match(new RegExp(`const ${spread[1]} = \\[([^\\]]*)\\]`));
        roles = decl ? decl[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null;
      } else {
        roles = (tail.match(/'([a-z-]+)'/g) || []).map(s => s.replace(/'/g, ''));
      }
      calls.push({ file, module: m[1], action: m[2], roles });
    }
  }
  return calls;
}

// Field- and record-level rules call permissionService.can() directly instead of
// mounting a guard — assets.edit_compliance and assets.edit_security do. Those
// count as used, otherwise the report would nag about knobs that do work.
function parseDirectChecks() {
  const out = new Set();
  for (const file of fs.readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    const re = /\bcan\(\s*[\w.]+\s*,\s*'([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) out.add(`${m[1]}.${m[2]}`);
  }
  return out;
}

const matrix = parseMatrix();
const calls = parseRoutes();
const directChecks = parseDirectChecks();
const problems = [];
const used = new Set();

for (const c of calls) {
  used.add(`${c.module}.${c.action}`);
  const defaults = matrix[c.module]?.[c.action];
  if (!defaults) {
    problems.push(`${c.file}: requirePermission('${c.module}','${c.action}') — kein Eintrag in DEFAULT_PERMISSIONS`);
    continue;
  }
  if (c.roles === null) continue; // konnte nicht aufgeloest werden
  const a = [...defaults].sort().join(',');
  const b = [...c.roles].sort().join(',');
  if (a !== b) {
    problems.push(
      `${c.file}: ${c.module}.${c.action} — Matrix-Default [${a}] weicht von den Fallback-Rollen [${b}] ab`
    );
  }
}

const unused = [];
for (const [mod, actions] of Object.entries(matrix)) {
  for (const action of Object.keys(actions)) {
    const key = `${mod}.${action}`;
    if (!used.has(key) && !directChecks.has(key)) unused.push(key);
  }
}

// Endpunkte ohne jeden Matrix-Bezug auflisten (nur informativ, ausser in
// Dateien, die bewusst ungegated sind).
const ungated = [];
for (const file of fs.readdirSync(ROUTES_DIR).sort()) {
  if (!file.endsWith('.js') || UNGATED_FILES.has(file)) continue;
  const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
  const routerLevel = /router\.use\([^)]*requirePermission/.test(src);
  if (routerLevel) continue;
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'([^\n]*)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[3].includes('requirePermission')) ungated.push(`${file} ${m[1].toUpperCase()} ${m[2]}`);
  }
}

console.log(`Permission-Check: ${calls.length} requirePermission-Aufrufe, ${directChecks.size} direkte can()-Prüfungen, ${Object.keys(matrix).length} Matrix-Module`);
if (unused.length) console.log(`\nMatrix-Einträge ohne Route (${unused.length}): ${unused.join(', ')}`);
if (ungated.length) console.log(`\nEndpunkte ohne Matrix-Bezug (${ungated.length}):\n  ${ungated.join('\n  ')}`);
if (problems.length) {
  console.error(`\nFEHLER (${problems.length}):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nOK — Matrix-Defaults und Routen-Fallbacks stimmen überein.');
