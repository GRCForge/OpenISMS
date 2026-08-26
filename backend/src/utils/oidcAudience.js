'use strict';

/**
 * Audience binding for the OIDC access-token login fallback.
 *
 * Requests are normally authenticated with our own HS256 JWT. When that fails
 * and OIDC is configured, `middleware/auth.js` falls back to treating the
 * bearer as an IdP access token and resolving the user from the userinfo
 * endpoint. Userinfo, however, validates only that the token is live at that
 * issuer — not who it was issued to. Without an audience check, a token a user
 * granted to an unrelated client at the same IdP logs in as the matching
 * OpenISMS account (OAuth audience confusion, CWE-863).
 *
 * Deliberately permissive in one direction: opaque (non-JWT) tokens and tokens
 * carrying none of the claims below cannot be judged here and keep relying on
 * the issuer's own validation, exactly as before. Only a token that DOES name
 * an audience, and names someone else, is rejected.
 *
 * The claim list covers what the IdPs OpenISMS is deployed against actually
 * emit: Keycloak sets `azp` (and an `aud` that is often just `account`),
 * Entra ID v1 sets `appid`, v2 sets `azp`, and several smaller providers set
 * `client_id`.
 */
const AUDIENCE_CLAIMS = ['azp', 'appid', 'client_id', 'aud'];

/** Decode a JWT payload without verifying it — callers must not trust the result. */
const readClaims = (token) => {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null; // opaque token — nothing to read
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null; // not a readable JWT payload
  }
};

/**
 * @param {string} token    the bearer presented by the client
 * @param {string} clientId the OIDC client id OpenISMS is registered under
 * @returns {boolean} false only when the token names an audience that is not us
 */
const tokenAudienceMatches = (token, clientId) => {
  if (!clientId) return true; // OIDC not configured far enough to judge
  const claims = readClaims(token);
  if (!claims) return true;

  const named = [];
  for (const key of AUDIENCE_CLAIMS) {
    const value = claims[key];
    if (Array.isArray(value)) named.push(...value.map(String));
    else if (value) named.push(String(value));
  }
  if (!named.length) return true;
  return named.includes(String(clientId));
};

module.exports = { tokenAudienceMatches, AUDIENCE_CLAIMS };
