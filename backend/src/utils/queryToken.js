'use strict';

/**
 * Token im Query-String nur fuer Server-Sent Events (Security-Review 2026-11, OP-2).
 *
 * Ein Browser-EventSource kann keine eigenen Header setzen; fuer diesen einen
 * Transport muss ein kurzlebiger Token deshalb in der URL stehen. Vorher galt der
 * Fallback fuer JEDE GET-Route der REST-API: ein Link wie
 * `/api/assets?token=eyJ...` meldete an, und der Token landete in Proxy- und
 * Access-Logs, Browser-Verlauf und Lesezeichen. Das Frontend nutzt den Weg nicht
 * (es sendet immer `Authorization: Bearer`).
 *
 * Jetzt gilt der Query-Token nur noch, wenn die Anfrage ein Event-Stream ist:
 * GET und `Accept: text/event-stream` — das sendet jedes EventSource von selbst,
 * ein normaler Link, ein <img>, ein Download oder ein fetch() ohne diesen Header
 * dagegen nicht. Fuer alle anderen Anfragen wird der Parameter ignoriert (401).
 */

const QUERY_TOKEN_PARAMS = ['token', 'apiKey', 'api_key', 'access_token', 'key'];

/** GET mit `Accept: text/event-stream` (auch in einer Liste mit q-Werten). */
const isEventStreamRequest = (req) => {
  if (!req || req.method !== 'GET') return false;
  const accept = req.headers?.accept;
  const value = Array.isArray(accept) ? accept.join(',') : String(accept || '');
  return value
    .toLowerCase()
    .split(',')
    .some((part) => part.split(';')[0].trim() === 'text/event-stream');
};

/** Token aus dem Query-String — nur fuer Event-Stream-Anfragen, sonst null. */
const getQueryToken = (req) => {
  if (!isEventStreamRequest(req)) return null;
  for (const name of QUERY_TOKEN_PARAMS) {
    const v = req.query?.[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
};

module.exports = { isEventStreamRequest, getQueryToken, QUERY_TOKEN_PARAMS };
