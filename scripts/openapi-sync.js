#!/usr/bin/env node
'use strict';

/**
 * Keeps backend/src/openapi.json in step with the routes that actually exist.
 *
 * The spec was hand-written and had fallen a long way behind: two thirds of the
 * API was missing from it and a dozen entries described endpoints that had been
 * renamed or had changed method. A spec that incomplete is worse than none — it
 * looks authoritative while sending clients at paths that 404.
 *
 * This script reads the mounts in index.js and the router definitions in
 * backend/src/routes, and:
 *
 *   - adds an entry for every endpoint the spec does not describe, marked
 *     "x-generated": true, including its path parameters, the permission it
 *     enforces and the module toggle it sits behind
 *   - refreshes existing generated entries (hand-written ones are never touched,
 *     so curated schemas and examples survive)
 *   - reports entries that describe no existing route
 *
 * Modes:
 *   node scripts/openapi-sync.js           write the spec
 *   node scripts/openapi-sync.js --check   fail (exit 1) when it would change
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'backend', 'src');
const SPEC_PATH = path.join(SRC, 'openapi.json');
const CHECK = process.argv.includes('--check');

// Mount path prefix → OpenAPI tag. Anything unmatched falls back to the first
// path segment, so a new module shows up under its own heading instead of
// silently landing in a catch-all.
const TAG_BY_PREFIX = [
  ['/api/auth/passkey', 'Authentifizierung'], ['/api/auth/tokens', 'API-Token'],
  ['/api/auth/oidc', 'Authentifizierung'], ['/api/auth', 'Authentifizierung'],
  ['/api/admin/backup', 'Backup & Restore'], ['/api/admin', 'Administration'],
  ['/api/assets', 'Assets'], ['/api/assessments', 'Bewertungen'],
  ['/api/risks', 'Risiken'], ['/api/incidents', 'Vorfälle'],
  ['/api/controls', 'Maßnahmen & SoA'], ['/api/policies', 'Richtlinien'],
  ['/api/tasks', 'Aufgaben'], ['/api/groups', 'Gruppen'],
  ['/api/users', 'Benutzerverwaltung'], ['/api/me', 'Eigenes Profil'],
  ['/api/notifications', 'Benachrichtigungen'], ['/api/push', 'Push-Benachrichtigungen'],
  ['/api/audit-log', 'Audit-Log'], ['/api/dashboard', 'Dashboard'],
  ['/api/reminders', 'Erinnerungen'], ['/api/vendors', 'Dienstleister'],
  ['/api/import', 'Import'], ['/api/report', 'Berichte'],
  ['/api/compliance', 'Compliance'], ['/api/vvt', 'DSGVO'],
  ['/api/dataflows', 'DSGVO'], ['/api/subject-requests', 'DSGVO'],
  ['/api/discovery', 'Auto-Discovery'], ['/api/integrations', 'Integrationen'],
  ['/api/triage-profiles', 'Vertragsanalyse'], ['/api/templates', 'Vorlagen'],
  ['/api/mappings', 'Framework-Mappings'], ['/api/legal-requirements', 'Rechtliche Anforderungen'],
  ['/api/review', 'Management-Review'], ['/api/modules', 'Module'],
  ['/api/threats', 'Bedrohungen'], ['/api/pentests', 'Pentests'],
  ['/api/bcm', 'BCM'], ['/api/dora', 'DORA'], ['/api/ai-act', 'EU AI Act'],
  ['/api/tisax', 'TISAX'], ['/api/nis2', 'NIS-2'], ['/api/c5', 'BSI C5'],
  ['/api/iso27001', 'ISO 27001'], ['/api/bsi-grundschutz', 'BSI Grundschutz'],
];

const VERB_SUMMARY = {
  get: 'abrufen', post: 'anlegen', put: 'aktualisieren',
  patch: 'teilweise aktualisieren', delete: 'löschen',
};

function collectRoutes() {
  const indexSrc = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  // Middleware between the mount path and the router may itself contain
  // parentheses (requireModule('dsgvo')), so the gap is matched lazily rather
  // than as "anything but a closing paren".
  const mountRe = /app\.use\('(\/api\/[^']*)'\s*,\s*(.*?)require\('\.\/routes\/([a-zA-Z0-9_-]+)'\)\)/g;
  const routes = [];
  let mount;
  while ((mount = mountRe.exec(indexSrc)) !== null) {
    const [, base, middleware = '', file] = mount;
    const moduleGate = (middleware.match(/requireModule\('([a-z0-9_]+)'\)/) || [])[1] || null;
    const routeSrc = fs.readFileSync(path.join(SRC, 'routes', `${file}.js`), 'utf8');
    const routerLevelPerm = (routeSrc.match(/router\.use\([^)]*requirePermission\('([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'/) || []).slice(1);
    const epRe = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'([^\n]*)/g;
    let ep;
    while ((ep = epRe.exec(routeSrc)) !== null) {
      const [, method, sub, tail] = ep;
      const permMatch = tail.match(/requirePermission\('([a-z0-9_]+)'\s*,\s*'([a-z0-9_]+)'/);
      const perm = permMatch ? [permMatch[1], permMatch[2]] : (routerLevelPerm.length ? routerLevelPerm : null);
      const full = `${base.replace(/\/$/, '')}${sub}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      routes.push({ method, file, moduleGate, perm, specPath: full.replace(/^\/api/, '').replace(/:([a-zA-Z_]+)/g, '{$1}') || '/' });
    }
  }
  // Endpoints defined directly on the app rather than in a router — /api/health,
  // /api/version, /api/openapi.json and the Swagger UI shell.
  const directRe = /app\.(get|post|put|patch|delete)\('(\/api\/[^']*)'/g;
  let direct;
  while ((direct = directRe.exec(indexSrc)) !== null) {
    const [, method, full] = direct;
    routes.push({
      method, file: 'index.js', moduleGate: null, perm: null,
      specPath: full.replace(/^\/api/, '').replace(/:([a-zA-Z_]+)/g, '{$1}') || '/',
    });
  }

  return routes;
}

const tagFor = (specPath) => {
  const withApi = `/api${specPath}`;
  for (const [prefix, tag] of TAG_BY_PREFIX) if (withApi.startsWith(prefix)) return tag;
  return specPath.split('/')[1] || 'Sonstiges';
};

function buildOperation(route) {
  const params = [...route.specPath.matchAll(/\{([a-zA-Z_]+)\}/g)].map(m => ({
    name: m[1], in: 'path', required: true, schema: { type: 'string' },
    description: `Bezeichner (${m[1]})`,
  }));
  const tail = route.specPath.split('/').filter(Boolean).pop() || 'Ressource';
  const subject = tail.startsWith('{') ? route.specPath.split('/').filter(Boolean).slice(-2)[0] : tail;
  const op = {
    tags: [tagFor(route.specPath)],
    summary: `${subject.replace(/[-_]/g, ' ')} ${VERB_SUMMARY[route.method]}`,
    'x-generated': true,
    responses: {
      200: { description: 'Erfolg' },
      401: { description: 'Nicht authentifiziert' },
    },
  };
  if (route.perm) {
    op.description = `Erfordert die Berechtigung \`${route.perm[0]}.${route.perm[1]}\`` +
      (route.moduleGate ? ` und das aktivierte Modul \`${route.moduleGate}\`.` : '.');
    op.responses[403] = { description: 'Berechtigung fehlt' };
  } else if (route.moduleGate) {
    op.description = `Erfordert das aktivierte Modul \`${route.moduleGate}\`.`;
  }
  if (params.length) {
    op.parameters = params;
    op.responses[404] = { description: 'Nicht gefunden' };
  }
  if (['post', 'put', 'patch'].includes(route.method)) {
    op.requestBody = {
      required: true,
      content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
    };
    op.responses[400] = { description: 'Ungültige Eingabe' };
  }
  return op;
}

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const before = JSON.stringify(spec);
const routes = collectRoutes();

const seen = new Set();
let added = 0, refreshed = 0;
for (const route of routes) {
  seen.add(`${route.method} ${route.specPath}`);
  const entry = spec.paths[route.specPath] || (spec.paths[route.specPath] = {});
  const existing = entry[route.method];
  if (!existing) { entry[route.method] = buildOperation(route); added++; continue; }
  if (existing['x-generated']) {
    const rebuilt = buildOperation(route);
    if (JSON.stringify(rebuilt) !== JSON.stringify(existing)) { entry[route.method] = rebuilt; refreshed++; }
  }
}

// Entries describing nothing that exists: drop the generated ones, report the
// hand-written ones rather than deleting work someone did on purpose.
const stale = [];
let removed = 0;
for (const [p, ops] of Object.entries(spec.paths)) {
  for (const method of Object.keys(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    if (seen.has(`${method} ${p}`)) continue;
    if (ops[method]['x-generated']) { delete ops[method]; removed++; }
    else stale.push(`${method.toUpperCase()} ${p}`);
  }
  if (!Object.keys(ops).length) delete spec.paths[p];
}

// Tags: every tag actually used gets an entry, so the docs render grouped.
const usedTags = new Set();
for (const ops of Object.values(spec.paths)) {
  for (const op of Object.values(ops)) (op.tags || []).forEach(t => usedTags.add(t));
}
const knownTags = new Map((spec.tags || []).map(t => [t.name, t]));
spec.tags = [...usedTags].sort().map(name => knownTags.get(name) || { name });

const after = JSON.stringify(spec, null, 2) + '\n';
const changed = before !== JSON.stringify(spec);
const total = Object.values(spec.paths).reduce((n, ops) =>
  n + Object.keys(ops).filter(m => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);

console.log(`Routen im Code: ${routes.length} | Operationen in der Spec: ${total}`);
console.log(`  ergänzt: ${added}, aktualisiert: ${refreshed}, entfernt (generiert): ${removed}`);
if (stale.length) {
  console.log(`\nHandgepflegte Einträge ohne passende Route (${stale.length}) — bitte prüfen:`);
  for (const s of stale) console.log('   ' + s);
}

if (CHECK) {
  if (changed) {
    console.error('\nFEHLER: openapi.json ist nicht aktuell. `node scripts/openapi-sync.js` ausführen und das Ergebnis committen.');
    process.exit(1);
  }
  console.log('\nOK — openapi.json deckt alle Routen ab.');
} else {
  fs.writeFileSync(SPEC_PATH, after);
  console.log(changed ? '\nopenapi.json aktualisiert.' : '\nopenapi.json war bereits aktuell.');
}
