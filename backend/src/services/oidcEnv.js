// OIDC aus der Umgebung
//
// WARUM ES DIESE DATEI GIBT
// -------------------------
// Bis hierher lag die SSO-Konfiguration ausschliesslich in der Datenbank
// (Setting-Schluessel "oidc" plus Tabelle oidc_claim_mappings). Fuer eine
// Installation, die per Konfigurationsmanagement ausgerollt wird, ist das ein
// Bruch: Alles andere - Datenbank, JWT_SECRET, ENCRYPTION_KEY, APP_URL - kommt
// aus der .env und damit reproduzierbar aus einem Secret-Store. Ausgerechnet
// der Anmeldeweg musste nach jedem Neuaufbau von Hand in der Oberflaeche
// nachgetragen werden - ein undokumentierter Schritt, der in keiner
// Auditspur auftaucht.
//
// Mit den Variablen hier laesst sich SSO genauso ausrollen wie der Rest.
//
// VORRANG: DIE UMGEBUNG GEWINNT
// -----------------------------
// Ein per Umgebungsvariable gesetztes Feld ist die Wahrheit. Die Oberflaeche
// zeigt es schreibgeschuetzt, und PUT /api/admin/oidc lehnt eine Aenderung
// daran mit benannter Begruendung ab.
//
// Das ist bewusst die harte Variante. Die weiche - Umgebung uebersteuert beim
// Lesen, Oberflaeche bleibt bedienbar - erzeugt genau den Fehler, den niemand
// findet: Man speichert etwas, bekommt "gespeichert" zurueck, und es wirkt
// nicht. Und sie schafft eine zweite, unsichtbare Wahrheit in der Datenbank,
// die in dem Moment scharf wird, in dem jemand die Variable entfernt.
//
// Aus demselben Grund wird ein Wert aus der Umgebung NIE in die Datenbank
// geschrieben. Verschwindet die Variable, gilt wieder, was vorher in der
// Datenbank stand - nicht der zuletzt gesehene Umgebungswert.
//
// DAS CLIENT-SECRET
// -----------------
// In der Datenbank liegt es nur als Chiffrat (clientSecretEnc, verschluesselt
// mit ENCRYPTION_KEY). Kommt es aus der Umgebung, wird es NICHT verschluesselt
// abgelegt, sondern direkt verwendet. Es steht dann im Klartext in der .env -
// so wie DB_PASSWORD, JWT_SECRET und ENCRYPTION_KEY selbst. Wer diese Datei
// lesen kann, hat ohnehin den Schluessel, mit dem sich das Chiffrat aufmachen
// laesst; das Schutzniveau sinkt dadurch also nicht.

// Feldname im oidc-Setting -> Name der Umgebungsvariablen
const FELDER = {
  enabled: 'OIDC_ENABLED',
  displayName: 'OIDC_DISPLAY_NAME',
  issuer: 'OIDC_ISSUER',
  clientId: 'OIDC_CLIENT_ID',
  clientSecret: 'OIDC_CLIENT_SECRET',
  scopes: 'OIDC_SCOPES',
};

const MAPPING_VARIABLE = 'OIDC_CLAIM_MAPPINGS';

// Dieselbe Liste wie im ENUM von models/OidcClaimMapping.js. Bewusst hier
// wiederholt statt aus dem Modell gezogen: Diese Pruefung laeuft, bevor
// irgendeine Datenbankverbindung noetig ist, und soll auch dann eine
// verstaendliche Meldung liefern.
const BASIS_ROLLEN = [
  'admin', 'assessor', 'dpo', 'it-staff',
  'owner', 'viewer', 'employee', 'management',
];

// Leere Zeichenketten gelten als "nicht gesetzt". Sonst wuerde ein
// versehentlich leer gelassenes OIDC_ISSUER= in der .env die Konfiguration
// aus der Datenbank mit einem leeren Wert ueberschreiben und SSO stillegen.
const wert = (name) => {
  const v = process.env[name];
  if (typeof v !== 'string') return undefined;
  const g = v.trim();
  return g === '' ? undefined : g;
};

const alsBoolean = (v) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

/**
 * Liest die oidc-Felder aus der Umgebung.
 * @returns {{werte: object, felder: string[], secret: string|null}}
 *   werte  - nur die gesetzten Felder, ohne clientSecret
 *   felder - Namen der gesetzten Felder, inkl. 'clientSecret'
 *   secret - das Client-Secret aus der Umgebung oder null
 */
const ausUmgebung = () => {
  const werte = {};
  const felder = [];
  let secret = null;

  for (const [feld, variable] of Object.entries(FELDER)) {
    const v = wert(variable);
    if (v === undefined) continue;
    felder.push(feld);
    if (feld === 'clientSecret') { secret = v; continue; }
    werte[feld] = feld === 'enabled' ? alsBoolean(v) : v;
  }

  return { werte, felder, secret };
};

/**
 * Liest die Claim-Mappings aus OIDC_CLAIM_MAPPINGS.
 *
 * Erwartet ein JSON-Array. Die Feldnamen sind bewusst dieselben wie die
 * Spalten der Tabelle - eine zweite Schreibweise fuer denselben Begriff waere
 * eine Fehlerquelle ohne Gegenwert:
 *
 *   [{"claim_path":"groups","claim_value":"isms-admins","role":"owner","priority":100},
 *    {"claim_path":"realm_access.roles","claim_value":"isms-ro","custom_role":"Revision"}]
 *
 * custom_role benennt eine eigene Rolle ueber ihren NAMEN, nicht ueber die id -
 * eine id aus einer anderen Installation waere in einer .env wertlos. Aufgeloest
 * wird sie beim Anmelden, wo die Modelle verfuegbar sind.
 *
 * FEHLERVERHALTEN: Ist die Variable gesetzt, aber unbrauchbar, gelten KEINE
 * Mappings - nicht die aus der Datenbank. Ein Tippfehler darf nicht dazu
 * fuehren, dass stillschweigend eine andere Rollenzuordnung greift als die
 * beabsichtigte. Ohne Mapping bekommt ein Anmeldender die Standardrolle, was
 * die harmlosere Richtung ist.
 *
 * @returns {{aktiv: boolean, mappings: object[], fehler: string|null}}
 */
const mappingsAusUmgebung = () => {
  const roh = wert(MAPPING_VARIABLE);
  if (roh === undefined) return { aktiv: false, mappings: [], fehler: null };

  let geparst;
  try {
    geparst = JSON.parse(roh);
  } catch (e) {
    const fehler = `${MAPPING_VARIABLE} ist kein gueltiges JSON: ${e.message}`;
    console.error(`[OIDC] ${fehler}`);
    return { aktiv: true, mappings: [], fehler };
  }

  if (!Array.isArray(geparst)) {
    const fehler = `${MAPPING_VARIABLE} muss ein JSON-Array sein, gefunden: ${typeof geparst}`;
    console.error(`[OIDC] ${fehler}`);
    return { aktiv: true, mappings: [], fehler };
  }

  const mappings = [];
  const maengel = [];

  geparst.forEach((eintrag, i) => {
    const pos = `Eintrag ${i + 1}`;
    if (!eintrag || typeof eintrag !== 'object') {
      maengel.push(`${pos}: kein Objekt`);
      return;
    }
    const claimPath = typeof eintrag.claim_path === 'string' ? eintrag.claim_path.trim() : '';
    const claimValue = typeof eintrag.claim_value === 'string' ? eintrag.claim_value.trim() : '';
    if (!claimPath || !claimValue) {
      maengel.push(`${pos}: claim_path und claim_value sind Pflicht`);
      return;
    }
    const rolle = typeof eintrag.role === 'string' ? eintrag.role.trim() : '';
    const eigeneRolle = typeof eintrag.custom_role === 'string' ? eintrag.custom_role.trim() : '';
    if (!rolle && !eigeneRolle) {
      maengel.push(`${pos}: entweder role oder custom_role angeben`);
      return;
    }
    if (rolle && !BASIS_ROLLEN.includes(rolle)) {
      maengel.push(`${pos}: unbekannte role "${rolle}" (erlaubt: ${BASIS_ROLLEN.join(', ')})`);
      return;
    }
    mappings.push({
      claim_path: claimPath,
      claim_value: claimValue,
      role: rolle || null,
      custom_role_name: eigeneRolle || null,
      priority: Number.isInteger(eintrag.priority) ? eintrag.priority : 0,
    });
  });

  if (maengel.length > 0) {
    const fehler = `${MAPPING_VARIABLE} enthaelt fehlerhafte Eintraege: ${maengel.join('; ')}`;
    console.error(`[OIDC] ${fehler}`);
    return { aktiv: true, mappings: [], fehler };
  }

  // Dieselbe Reihenfolge wie die Datenbankabfrage in authOidc.js:
  // hoechste Prioritaet zuerst, bei Gleichstand die Reihenfolge der Liste.
  mappings.sort((a, b) => b.priority - a.priority);

  return { aktiv: true, mappings, fehler: null };
};

module.exports = {
  FELDER,
  MAPPING_VARIABLE,
  BASIS_ROLLEN,
  ausUmgebung,
  mappingsAusUmgebung,
};
