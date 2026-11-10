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

// @@WEITERE_TESTS@@

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
process.exit(failures ? 1 : 0);
