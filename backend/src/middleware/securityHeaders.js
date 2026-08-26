'use strict';

/**
 * Permissions-Policy — Helmet setzt diesen Header nicht, und jeder externe
 * Scanner meldet sein Fehlen. OpenISMS braucht keine der maechtigen
 * Browser-Funktionen unten, also werden sie fuer diesen Origin UND fuer alles,
 * was er einbettet, abgeschaltet.
 *
 * Drei Ausnahmen sind bewusst gesetzt — ohne sie brechen bestehende Funktionen:
 *   publickey-credentials-get / -create  Passkey-Login (routes/passkey.js).
 *                                        Fehlt der Eintrag, schlaegt WebAuthn
 *                                        im iframe-Kontext still fehl.
 *   clipboard-write                      "API-Token kopieren", "Agent-Befehl
 *                                        kopieren" und aehnliche Buttons.
 *   fullscreen                           Vollbild fuer Topologie/Mermaid-
 *                                        Diagramme.
 *
 * Nicht gelistete Features fallen auf den Browser-Default zurueck; die Liste
 * deckt die ab, die Scanner tatsaechlich pruefen.
 */
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'battery=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'idle-detection=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
  'fullscreen=(self)',
  'clipboard-write=(self)',
  'publickey-credentials-create=(self)',
  'publickey-credentials-get=(self)',
].join(', ');

const permissionsPolicy = (req, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
};

module.exports = { permissionsPolicy, PERMISSIONS_POLICY };
