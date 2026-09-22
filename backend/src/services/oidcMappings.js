// Claim-Mappings: aus der Umgebung oder aus der Datenbank
//
// Die Rollenzuordnung beim SSO-Login lag bisher ausschliesslich in der Tabelle
// oidc_claim_mappings. Wer eine Installation reproduzierbar ausrollt, musste
// sie nach jedem Neuaufbau von Hand nachtragen - und genau diese Zuordnung
// entscheidet, wer im ISMS welche Rechte bekommt. Ein Schritt, der Rechte
// vergibt und in keiner Konfiguration auftaucht, ist die unangenehmste Sorte
// undokumentierter Zustand.
//
// Ist OIDC_CLAIM_MAPPINGS gesetzt, gilt ausschliesslich diese Liste. Die
// Tabelle wird dann nicht gelesen und in der Oberflaeche gesperrt - dieselbe
// Vorrangregel wie bei den uebrigen OIDC-Feldern, aus denselben Gruenden
// (siehe services/oidcEnv.js).

const { OidcClaimMapping, CustomRole } = require('../models');
const oidcEnv = require('./oidcEnv');

// Die Eintraege aus der Umgebung benennen eine eigene Rolle ueber ihren NAMEN.
// Eine id waere in einer .env wertlos, weil sie je Installation anders lautet.
// Aufgeloest wird erst hier, wo die Modelle verfuegbar sind.
const eigeneRollenAufloesen = async (mappings) => {
  const namen = [...new Set(mappings.map((m) => m.custom_role_name).filter(Boolean))];
  if (namen.length === 0) {
    return mappings.map((m) => ({ ...m, custom_role_id: null, customRole: null }));
  }

  const gefunden = await CustomRole.findAll({ where: { name: namen } });
  const nachName = new Map(gefunden.map((r) => [r.name, r]));

  return mappings.map((m) => {
    if (!m.custom_role_name) return { ...m, custom_role_id: null, customRole: null };
    const rolle = nachName.get(m.custom_role_name);
    if (!rolle) {
      // Laut statt still: Ein Tippfehler im Rollennamen wuerde sonst einfach
      // dazu fuehren, dass dieser Eintrag nie greift.
      console.error(
        `[OIDC] ${oidcEnv.MAPPING_VARIABLE}: eigene Rolle "${m.custom_role_name}" `
        + `existiert nicht - Eintrag ${m.claim_path}=${m.claim_value} bleibt wirkungslos`,
      );
      return { ...m, custom_role_id: null, customRole: null };
    }
    return { ...m, custom_role_id: rolle.id, customRole: rolle };
  });
};

/**
 * Die beim Login anzuwendenden Mappings, bereits in der richtigen Reihenfolge
 * (hoechste Prioritaet zuerst). Die zurueckgegebenen Objekte tragen dieselben
 * Felder wie die Modellinstanzen, damit der Login-Weg nicht zwei Formen
 * auseinanderhalten muss.
 */
const geltendeMappings = async () => {
  const ausEnv = oidcEnv.mappingsAusUmgebung();
  if (!ausEnv.aktiv) {
    return OidcClaimMapping.findAll({
      include: [{ model: CustomRole, as: 'customRole' }],
      order: [['priority', 'DESC'], ['id', 'ASC']],
    });
  }
  // Bei einem Fehler in der Variablen ist die Liste leer - siehe die
  // Begruendung in oidcEnv.js: lieber keine Zuordnung als die falsche.
  return eigeneRollenAufloesen(ausEnv.mappings);
};

module.exports = { geltendeMappings };
