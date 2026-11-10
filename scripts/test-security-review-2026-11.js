#!/usr/bin/env node
'use strict';

/**
 * Regressionstests zum Security-Review 2026-11 (reine Funktionen, keine DB).
 *
 * Run: node scripts/test-security-review-2026-11.js
 */

const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'backend', 'src', ...p));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

// ── OIDC: Kontobindung per E-Mail ────────────────────────────────────────────
{
  const { isExplicitlyUnverified, emailDomainAllowed, mayLinkExistingAccount } = src('services', 'oidcIdentity');
  console.log('OIDC — email_verified:');
  eq('false blockiert', isExplicitlyUnverified(false), true);
  eq('"false" blockiert', isExplicitlyUnverified('false'), true);
  eq('fehlend blockiert nicht pauschal', isExplicitlyUnverified(undefined), false);

  console.log('\nOIDC — lokales Konto nur mit verifizierter Adresse uebernehmen:');
  delete process.env.OIDC_LINK_UNVERIFIED_EMAIL;
  const local = { sso_user: false };
  const linked = { sso_user: true };
  eq('neues Konto (kein Treffer)', mayLinkExistingAccount(null, undefined), true);
  eq('lokales Konto, email_verified fehlt', mayLinkExistingAccount(local, undefined), false);
  eq('lokales Konto, email_verified=false', mayLinkExistingAccount(local, false), false);
  eq('lokales Konto, email_verified=true', mayLinkExistingAccount(local, true), true);
  eq('bereits gebundenes SSO-Konto', mayLinkExistingAccount(linked, undefined), true);
  process.env.OIDC_LINK_UNVERIFIED_EMAIL = 'true';
  eq('Betreiber-Schalter OIDC_LINK_UNVERIFIED_EMAIL', mayLinkExistingAccount(local, undefined), true);
  delete process.env.OIDC_LINK_UNVERIFIED_EMAIL;

  console.log('\nOIDC — Domain-Allowlist:');
  eq('leer = alles erlaubt', emailDomainAllowed('a@x.de', ''), true);
  eq('erlaubte Domain', emailDomainAllowed('a@herz.dev', 'herz.dev, example.org'), true);
  eq('Gross-/Kleinschreibung egal', emailDomainAllowed('a@Herz.DEV', 'herz.dev'), true);
  eq('fremde Domain', emailDomainAllowed('a@evil.example', 'herz.dev'), false);
  eq('Subdomain ist nicht dieselbe Domain', emailDomainAllowed('a@x.herz.dev', 'herz.dev'), false);
}

// ── Mass Assignment ──────────────────────────────────────────────────────────
{
  const { pick, omit } = src('utils', 'massAssignment');
  console.log('\nMass Assignment:');
  const body = { title: 't', status: 'done', completed_by_id: 7, created_by_id: 9 };
  eq('pick behaelt nur erlaubte Felder', pick(body, ['title', 'status']), { title: 't', status: 'done' });
  eq('omit entfernt gesperrte Felder', omit({ name: 'a', external_id: 'x', cve_ids: [] }, ['external_id', 'cve_ids']), { name: 'a' });
  eq('pick mit null-Body', pick(null, ['a']), {});
  eq('pick uebernimmt keine Prototyp-Schluessel', pick(JSON.parse('{"__proto__":{"x":1}}'), ['x']), {});
}

// ── SSRF-Schutz: gesperrte Adressen ─────────────────────────────────────────
{
  const { isBlockedAddress } = src('utils', 'safeFetch');
  console.log('\nSSRF — gesperrte Adressen:');
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.10.103', '::1', '::', '::ffff:127.0.0.1',
    '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2001:0:4136:e378::1',
    'fe80::1', 'fd00::1', 'ff02::1', '::127.0.0.1', '198.18.0.1', 'kaputt', ':::1']) {
    eq(`${ip} gesperrt`, isBlockedAddress(ip), true);
  }
  for (const ip of ['1.1.1.1', '140.82.112.3', '2606:4700:4700::1111', '::ffff:1.1.1.1', '2a00:1450:4001:82a::200e']) {
    eq(`${ip} erlaubt`, isBlockedAddress(ip), false);
  }
}

// ── Web-Push-Endpunkte ──────────────────────────────────────────────────────
{
  const { isAllowedPushEndpoint } = src('utils', 'pushEndpoint');
  console.log('\nWeb-Push — Endpunkt-Allowlist:');
  eq('FCM', isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'), true);
  eq('Mozilla', isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  eq('Apple', isAllowedPushEndpoint('https://web.push.apple.com/abc'), true);
  eq('WNS', isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc'), true);
  eq('Cloud-Metadaten', isAllowedPushEndpoint('http://169.254.169.254/latest/meta-data/'), false);
  eq('interner Dienst', isAllowedPushEndpoint('https://grafana.herz.dev/api/admin'), false);
  eq('http statt https', isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
  eq('fremder Port', isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x'), false);
  eq('Host-Suffix-Trick', isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x'), false);
  eq('Benutzerinfo', isAllowedPushEndpoint('https://a@fcm.googleapis.com/x'), false);
  eq('kein String', isAllowedPushEndpoint({ href: 'https://fcm.googleapis.com' }), false);
  process.env.PUSH_ENDPOINT_HOSTS = 'push.example.org';
  eq('PUSH_ENDPOINT_HOSTS', isAllowedPushEndpoint('https://relay.push.example.org/x'), true);
  delete process.env.PUSH_ENDPOINT_HOSTS;
}

// ── Log-Redaktion ───────────────────────────────────────────────────────────
{
  const { redactUrlSecrets } = src('utils', 'redact');
  console.log('\nLog — Geheimnisse in der URL:');
  eq('Query-Token', redactUrlSecrets('/api/assets?token=eyJabc.def&x=1'), '/api/assets?token=[REDACTED]&x=1');
  eq('Reset-Link', redactUrlSecrets('/reset-password?token=deadbeef'), '/reset-password?token=[REDACTED]');
  eq('api_key + access_token', redactUrlSecrets('/sse?api_key=isms_api_1&access_token=a'), '/sse?api_key=[REDACTED]&access_token=[REDACTED]');
  eq('OIDC-Code', redactUrlSecrets('/api/auth/oidc/callback?code=abc&state=s'), '/api/auth/oidc/callback?code=[REDACTED]&state=s');
  eq('Gross-/Kleinschreibung', redactUrlSecrets('/x?Token=a'), '/x?Token=[REDACTED]');
  eq('ohne Query unveraendert', redactUrlSecrets('/api/health'), '/api/health');
  eq('harmlose Parameter bleiben', redactUrlSecrets('/api/tasks?status=open&all=true'), '/api/tasks?status=open&all=true');
}


// ── Dokumente erben die Sichtbarkeit ihres Objekts (mit gemockten Models) ────
const documentTests = async () => {
  const os = require('os');
  const fs = require('fs');
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'openisms-sec-test-'));
  const backendSrc = path.join(__dirname, '..', 'backend', 'src');
  const mock = (rel, exports) => {
    const file = require.resolve(path.join(backendSrc, rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  };
  const rows = {
    Asset: { 10: { id: 10, owner_id: 1, assessor_id: null } },
    Incident: {
      20: { id: 20, deleted: false, is_security_incident: true, is_gdpr_incident: false },
      21: { id: 21, deleted: false, is_security_incident: false, is_gdpr_incident: true },
    },
    Vendor: { 30: { id: 30 } },
  };
  const model = (name) => ({ findByPk: async (id) => rows[name][id] || null, findAll: async () => [], findOne: async () => null });
  mock('models/index.js', { Asset: model('Asset'), Incident: model('Incident'), Vendor: model('Vendor'), Document: model('Asset'), User: model('Asset'), ApiToken: model('Asset') });
  mock('services/permissionService.js', { can: async () => undefined });
  const { canAccessDocumentParent } = require(path.join(backendSrc, 'routes', 'documents.js'));
  const req = (id, role) => ({ user: { id, role } });

  console.log('\nDokumente — Asset-Bezug:');
  eq('Owner des Assets', await canAccessDocumentParent(req(1, 'owner'), { asset_id: 10 }), true);
  eq('fremder Owner', await canAccessDocumentParent(req(2, 'owner'), { asset_id: 10 }), false);
  eq('viewer ohne Bezug', await canAccessDocumentParent(req(3, 'viewer'), { asset_id: 10 }), false);
  eq('it-staff sieht alle Assets', await canAccessDocumentParent(req(4, 'it-staff'), { asset_id: 10 }), true);
  console.log('\nDokumente — Vorfall-Bezug:');
  eq('dpo: Datenschutzvorfall', await canAccessDocumentParent(req(5, 'dpo'), { incident_id: 21 }), true);
  eq('dpo: reiner Sicherheitsvorfall', await canAccessDocumentParent(req(5, 'dpo'), { incident_id: 20 }), false);
  eq('it-staff: reiner Datenschutzvorfall', await canAccessDocumentParent(req(4, 'it-staff'), { incident_id: 21 }), false);
  console.log('\nDokumente — Lieferanten-Bezug (vendors.view_details):');
  eq('assessor', await canAccessDocumentParent(req(6, 'assessor'), { vendor_id: 30 }), true);
  eq('employee', await canAccessDocumentParent(req(7, 'employee'), { vendor_id: 30 }), false);
};

// ── CSV-Export: Formel-Neutralisierung (frontend/src/lib/csv.ts) ─────────────
// Node >= 23.6 entfernt TypeScript-Typen beim Import selbst; lib/csv.ts hat
// keine Abhaengigkeiten, der Test braucht also kein frontend/node_modules.
const csvTests = async () => {
  const { pathToFileURL } = require('url');
  const { csvCell } = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'csv.ts')).href);
  console.log('\nCSV — Formula Injection:');
  eq('=HYPERLINK neutralisiert', csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  eq('@SUM neutralisiert', csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  eq('+ neutralisiert', csvCell('+1+2'), '"\'+1+2"');
  eq('Tab am Anfang neutralisiert', csvCell('\tcmd'), '"\'\tcmd"');
  eq('-abc neutralisiert', csvCell('-abc'), '"\'-abc"');
  eq('negative Zahl bleibt', csvCell('-5'), '"-5"');
  eq('Dezimalzahl mit Komma bleibt', csvCell('-3,5'), '"-3,5"');
  eq('normaler Text bleibt', csvCell('Phishing-Welle'), '"Phishing-Welle"');
  eq('null wird leer', csvCell(null), '""');
};

csvTests()
  .then(documentTests)
  .catch((e) => { failures++; console.log('  FAIL  Tests abgebrochen:', e.message); })
  .finally(() => {
    console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
    process.exit(failures ? 1 : 0);
  });
