'use strict';

/**
 * Welche Web-Push-Endpunkte nimmt POST /api/push/subscribe an?
 *
 * Der Endpunkt ist eine URL, die der Browser liefert — fuer den Server aber
 * einfach ein Feld im Request-Body. Ohne Pruefung konnte jeder angemeldete
 * Benutzer eine beliebige URL eintragen (http://169.254.169.254/...,
 * http://interner-dienst:8080/admin), und bei jeder Benachrichtigung an ihn
 * schickte der Server einen POST dorthin (blinde SSRF; ob das Ziel mit 404/410
 * antwortet, verriet das Loeschen des Abos).
 *
 * Erlaubt sind nur die Push-Dienste der Browser-Hersteller, per HTTPS auf dem
 * Standardport. Weitere Hosts (z. B. ein eigener Push-Relay) ueber
 * PUSH_ENDPOINT_HOSTS (kommagetrennt; ein Eintrag erlaubt auch Subdomains).
 */
const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',           // Chrome, Edge (Chromium), Opera, Brave
  'android.googleapis.com',       // aeltere Chrome-Abos
  'push.services.mozilla.com',    // Firefox (updates.push.services.mozilla.com)
  'push.apple.com',               // Safari (web.push.apple.com)
  'notify.windows.com',           // Edge/Windows (*.notify.windows.com)
];

const allowedHosts = () => {
  const extra = String(process.env.PUSH_ENDPOINT_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_PUSH_HOSTS, ...extra];
};

const isAllowedPushEndpoint = (raw) => {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  return allowedHosts().some((h) => host === h || host.endsWith(`.${h}`));
};

module.exports = { isAllowedPushEndpoint, DEFAULT_PUSH_HOSTS };
