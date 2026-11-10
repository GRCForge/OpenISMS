'use strict';

/**
 * Schutz vor Mass Assignment (OWASP API3:2023 / ASVS V8.2).
 *
 * `Model.create({ ...req.body })` und `instance.update({ ...req.body })` setzen
 * JEDES Attribut, das im Body steht — auch solche, die der Server selbst pflegt
 * (wer eine Aufgabe erledigt hat, CVE-Zaehler aus dem nachtlichen Abgleich,
 * Korrelationsschluessel einer Integration). Diese Felder stehen nicht im
 * Audit-Diff der Route und liessen sich so unbemerkt faelschen.
 */

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Nur die erlaubten Schluessel uebernehmen. */
const pick = (body, allowed) => {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const k of allowed) if (hasOwn(body, k)) out[k] = body[k];
  return out;
};

// JSON.parse legt "__proto__" als eigenen Schluessel an; eine Zuweisung
// out['__proto__'] = … setzte dann den Prototyp des Ergebnisobjekts.
// (CodeQL js/remote-property-injection, PR #295)

/** Alle Schluessel ausser den gesperrten uebernehmen (fuer grosse Formulare). */
const omit = (body, denied) => {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  const blocked = new Set(denied);
  for (const k of Object.keys(body)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (!blocked.has(k)) out[k] = body[k];
  }
  return out;
};

module.exports = { pick, omit };
