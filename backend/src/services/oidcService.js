const client = require('openid-client');
const { getOidcConfig } = require('./settingsService');

// Gecachte OIDC-Configuration (Discovery ist teuer). Der Cache wird invalidiert,
// wenn sich die Config-Signatur aendert bzw. via invalidate() aus der Admin-Route.
//
// openid-client v6 ersetzt die alte Issuer/Client-Klassen-API durch eine
// funktionale API: discovery() liefert ein Configuration-Objekt, das an die
// einzelnen Funktionen (buildAuthorizationUrl, authorizationCodeGrant,
// fetchUserInfo) uebergeben wird.
let cached = null;

const getCallbackUrl = () => {
  const appUrl = (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
  return `${appUrl}/api/auth/oidc/callback`;
};

const buildConfig = async () => {
  const cfg = await getOidcConfig();
  if (!cfg.enabled || !cfg.issuer || !cfg.clientId || !cfg.clientSecret) {
    throw new Error('OIDC ist nicht vollständig konfiguriert');
  }
  const sig = `${cfg.issuer}|${cfg.clientId}|${cfg.clientSecret}|${getCallbackUrl()}`;
  if (cached && cached.sig === sig) return { config: cached.config, cfg };

  const server = new URL(cfg.issuer);
  // v6 verlangt standardmaessig HTTPS-Issuer. Fuer self-hosted IdPs, die nur
  // ueber HTTP erreichbar sind, Discovery (und Folge-Requests) explizit erlauben.
  const options = server.protocol === 'http:'
    ? { execute: [client.allowInsecureRequests] }
    : undefined;
  const config = await client.discovery(server, cfg.clientId, cfg.clientSecret, undefined, options);
  cached = { sig, config };
  return { config, cfg };
};

const invalidate = () => { cached = null; };

// `client` exportiert die funktionalen openid-client-v6-Helfer
// (randomPKCECodeVerifier, buildAuthorizationUrl, authorizationCodeGrant, …).
module.exports = { buildConfig, invalidate, getCallbackUrl, client };
