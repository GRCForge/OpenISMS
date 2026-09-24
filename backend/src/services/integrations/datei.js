'use strict';

/**
 * Adapter Datei — Asset-Listen aus Excel/CSV.
 *
 * Eine hochgeladene Liste ist eine Quelle wie jede andere: jemand behauptet,
 * es gebe diese Systeme. Sie laeuft deshalb denselben Weg wie das Monitoring —
 * ueber das Discovery-Staging und die Freigabe — und legt keine Assets direkt an.
 *
 * Bis 3.0.0 tat /api/import genau das Gegenteil: jede Zeile wurde ungeprueft zu
 * einem Asset. Eine Tabelle aus einem Postfach war damit der einzige Weg, an
 * der dokumentierten Freigabe vorbei ins Inventar zu kommen.
 *
 * Kein `lesen()`: diese Quelle wird nicht abgerufen, sie liefert. Die
 * Normalisierung uebernimmt routes/import.js, der Abgleich danach ist derselbe.
 */

// Welche Asset-Felder eine Zeile vorschlagen darf. Alles ausserhalb dieser
// Liste wird verworfen — der Rest der Zeile wandert als payload durch die
// Datenbank bis in Asset.create, und dort haette ein mitgeschmuggeltes
// `id`, `owner_id` oder `status` Wirkung, die niemand freigegeben hat.
const PAYLOAD_FELDER = [
  'type', 'classification', 'description', 'hosting_type', 'lifecycle_status',
  'status', 'nis2_relevant', 'patch_status', 'eol_date', 'tags', 'department',
  'location', 'frameworks', 'owner_id', 'assessor_id',
];

/**
 * Filtert ein Objekt auf die erlaubten Felder.
 *
 * Wird an beiden Enden angewandt: beim Schreiben ins Staging und beim Lesen vor
 * der Freigabe. Die zweite Pruefung ist nicht doppelt gemoppelt — eine
 * Staging-Zeile kann aus einer aelteren Version stammen oder von Hand
 * veraendert worden sein, und die Freigabe ist der Punkt, an dem die Werte
 * Wirkung bekommen.
 */
function payloadFiltern(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const raus = {};
  for (const feld of PAYLOAD_FELDER) {
    if (obj[feld] !== undefined && obj[feld] !== null && obj[feld] !== '') raus[feld] = obj[feld];
  }
  return raus;
}

/** Liest die gespeicherte payload-Spalte eines Staging-Eintrags. */
function payloadLesen(roh) {
  if (!roh) return {};
  try {
    return payloadFiltern(typeof roh === 'string' ? JSON.parse(roh) : roh);
  } catch {
    // Unlesbare payload ist kein Grund, die Freigabe scheitern zu lassen —
    // die Kernfelder stehen in eigenen Spalten. Der Vorschlag wird dann eben
    // ohne die Zusatzangaben freigegeben.
    return {};
  }
}

module.exports = {
  id: 'excel',
  label: 'Excel-/CSV-Liste',
  beschreibung: 'Asset-Listen aus einer hochgeladenen Tabelle, ueber den Datenimport.',
  art: 'push',

  // Eine Datei ist ein Ausschnitt, den jemand geschickt hat, keine Aussage
  // ueber alles Uebrige. Aus dem Fehlen eines Assets in einer Liste folgt
  // nichts — der MISSING-Abgleich bleibt fuer diese Quelle aus.
  zaehltBestandVollstaendig: false,

  // Was ein erneuter Import NICHT tut: gepflegte Felder eines bereits
  // freigegebenen Assets ueberschreiben. Eine Zeile mit geaenderter
  // Klassifizierung aktualisiert nur external_last_seen_at, sonst nichts.
  //
  // Das ist eine Entscheidung, keine Luecke. Eine Tabelle aus einem Postfach
  // darf eine im ISMS getroffene Einstufung nicht kippen, und ein Abgleich,
  // der es doch taete, waere an der Oberflaeche nicht von einer regulaeren
  // Pflege zu unterscheiden. Aenderungen an bestehenden Assets gehoeren in
  // das Asset selbst — mit Protokoll und benanntem Bearbeiter.

  PAYLOAD_FELDER,
  payloadFiltern,
  payloadLesen,
};
