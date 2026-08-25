#!/usr/bin/env node
'use strict';

/**
 * Wenn OIDC konfiguriert ist, akzeptiert middleware/auth.js einen IdP-Access-Token
 * als Login, sobald der eigene HS256-JWT nicht verifiziert. Der userinfo-Endpunkt
 * prueft dabei nur, ob der Token beim Issuer noch gueltig ist — nicht, fuer WEN er
 * ausgestellt wurde. Ohne Audience-Bindung loggt sich damit jeder Token desselben
 * Issuers als der passende OpenISMS-Benutzer ein (CWE-863).
 *
 * Run: node scripts/test-oidc-audience.js
 */

const path = require('path');
const { tokenAudienceMatches } =
  require(path.join(__dirname, '..', 'backend', 'src', 'utils', 'oidcAudience'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
const jwtWith = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.signature-not-checked-here`;

const CLIENT = 'openisms';

console.log('Token fuer unseren Client wird akzeptiert:');
eq('Keycloak: azp = client id', tokenAudienceMatches(jwtWith({ azp: CLIENT, aud: 'account' }), CLIENT), true);
eq('Entra v1: appid = client id', tokenAudienceMatches(jwtWith({ appid: CLIENT, aud: 'https://graph.microsoft.com' }), CLIENT), true);
eq('client_id = client id', tokenAudienceMatches(jwtWith({ client_id: CLIENT }), CLIENT), true);
eq('aud als String', tokenAudienceMatches(jwtWith({ aud: CLIENT }), CLIENT), true);
eq('aud als Liste', tokenAudienceMatches(jwtWith({ aud: ['account', CLIENT] }), CLIENT), true);

console.log('\nToken fuer einen fremden Client wird abgelehnt:');
eq('azp = anderer Client', tokenAudienceMatches(jwtWith({ azp: 'grafana', aud: 'account' }), CLIENT), false);
eq('appid = anderer Client', tokenAudienceMatches(jwtWith({ appid: 'some-other-app' }), CLIENT), false);
eq('aud-Liste ohne uns', tokenAudienceMatches(jwtWith({ aud: ['account', 'grafana'] }), CLIENT), false);
// Der eigentliche Angriff: ein gueltiger Token desselben Issuers, ausgestellt
// fuer eine andere Anwendung, mit der E-Mail eines OpenISMS-Benutzers darin.
eq('fremder Token mit passender E-Mail', tokenAudienceMatches(jwtWith({ azp: 'grafana', email: 'admin@example.org' }), CLIENT), false);

console.log('\nWas hier nicht beurteilt werden kann, bleibt wie bisher (Issuer entscheidet):');
eq('opaker Token (kein JWT)', tokenAudienceMatches('gAAAAABm-opaque-reference-token', CLIENT), true);
eq('JWT ohne Audience-Claim', tokenAudienceMatches(jwtWith({ sub: 'abc', email: 'a@b.c' }), CLIENT), true);
eq('unlesbarer Payload', tokenAudienceMatches('aaa.###.bbb', CLIENT), true);
eq('Payload ist kein Objekt', tokenAudienceMatches(`${b64({})}.${b64(['a'])}.sig`, CLIENT), true);
eq('clientId noch nicht konfiguriert', tokenAudienceMatches(jwtWith({ azp: 'grafana' }), ''), true);

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(failures ? 1 : 0);
