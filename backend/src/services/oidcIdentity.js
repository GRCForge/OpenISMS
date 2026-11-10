'use strict';

/**
 * Wann darf eine Identitaet vom Identity Provider ein OpenISMS-Konto bekommen?
 *
 * Beide SSO-Wege — der interaktive Callback (routes/authOidc.js) und der
 * Bearer-Fallback fuer IdP-Access-Tokens (middleware/auth.js) — finden das Konto
 * ueber die E-Mail-Adresse. Die Adresse ist aber nur so vertrauenswuerdig wie der
 * IdP sie macht: Bei vielen Anbietern kann ein Benutzer sie selbst setzen, und
 * Entra ID liefert im `email`-Claim einen frei aenderbaren, unverifizierten Wert
 * (bekannt als "nOAuth"). Ohne die Regeln hier konnte so eine IdP-Identitaet mit
 * der Adresse des lokalen Administrators dessen Konto uebernehmen — der Callback
 * schaltete dabei sogar TOTP ab und loeschte die Passkeys.
 *
 * Die Regeln sind bewusst an einer Stelle, damit beide Wege dasselbe pruefen
 * (genau diese Abweichung zwischen zwei Wegen zum selben Datensatz war die
 * Ursache).
 */

/** Ein ausdrueckliches "nicht verifiziert" vom IdP. */
const isExplicitlyUnverified = (v) => v === false || v === 'false';

/** Ein ausdrueckliches "verifiziert" vom IdP. Fehlt der Claim, ist das KEIN Ja. */
const isExplicitlyVerified = (v) => v === true || v === 'true';

/**
 * Domain-Allowlist aus den allgemeinen Einstellungen (ssoAllowedDomains,
 * kommagetrennt). Leer = keine Einschraenkung.
 */
const emailDomainAllowed = (email, allowedSetting) => {
  if (!allowedSetting) return true;
  const allowed = String(allowedSetting).split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return true;
  const domain = (String(email || '').split('@')[1] || '').toLowerCase();
  return allowed.includes(domain);
};

/**
 * Betreiber-Schalter fuer IdPs, die email_verified grundsaetzlich nicht liefern
 * (z. B. Entra ID im eigenen Mandanten), wenn lokale Konten trotzdem per SSO
 * uebernommen werden sollen. Nur setzen, wenn am IdP niemand seine Adresse
 * selbst waehlen kann.
 */
const trustUnverifiedEmailForLinking = () => process.env.OIDC_LINK_UNVERIFIED_EMAIL === 'true';

/**
 * Darf eine IdP-Identitaet mit dieser Adresse an ein bestehendes Konto gebunden
 * werden? Ein Konto, das bereits per SSO angemeldet war (sso_user), gilt als
 * gebunden. Ein lokales Konto (Passwort, ggf. TOTP/Passkey) wird nur mit
 * ausdruecklich verifizierter Adresse uebernommen.
 */
const mayLinkExistingAccount = (user, emailVerified) => {
  if (!user) return true;
  if (user.sso_user) return true;
  return isExplicitlyVerified(emailVerified) || trustUnverifiedEmailForLinking();
};

module.exports = {
  isExplicitlyUnverified,
  isExplicitlyVerified,
  emailDomainAllowed,
  mayLinkExistingAccount,
  trustUnverifiedEmailForLinking,
};
