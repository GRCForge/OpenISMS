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

// @@WEITERE_TESTS@@

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

documentTests()
  .catch((e) => { failures++; console.log('  FAIL  Dokument-Tests abgebrochen:', e.message); })
  .finally(() => {
    console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
    process.exit(failures ? 1 : 0);
  });
