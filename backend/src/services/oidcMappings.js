// Claim-Mappings: aus der Umgebung oder aus der Datenbank
//
// Die Zuordnung beim SSO-Login lag bisher ausschliesslich in der Tabelle
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
//
// Since v3.8.0 a mapping grants membership in a group (roles reach users only
// through groups). An entry may still name a role or custom role; it then means
// the group that carries that role (services/accessService.js), created on
// demand.

const { OidcClaimMapping, CustomRole, Group } = require('../models');
const oidcEnv = require('./oidcEnv');

// Die Eintraege aus der Umgebung benennen Gruppe oder eigene Rolle ueber ihren
// NAMEN. Eine id waere in einer .env wertlos, weil sie je Installation anders
// lautet. Aufgeloest wird erst hier, wo die Modelle verfuegbar sind.
const namenAufloesen = async (mappings) => {
  const rollenNamen = [...new Set(mappings.map((m) => m.custom_role_name).filter(Boolean))];
  const gruppenNamen = [...new Set(mappings.map((m) => m.group_name).filter(Boolean))];
  const rollen = rollenNamen.length ? await CustomRole.findAll({ where: { name: rollenNamen } }) : [];
  const gruppen = gruppenNamen.length ? await Group.findAll({ where: { name: gruppenNamen } }) : [];
  const rolleNachName = new Map(rollen.map((r) => [r.name, r]));
  const gruppeNachName = new Map(gruppen.map((g) => [g.name, g]));

  return mappings.map((m) => {
    const out = { ...m, custom_role_id: null, customRole: null, group_id: null, group: null };
    if (m.group_name) {
      const g = gruppeNachName.get(m.group_name);
      if (!g) {
        // Laut statt still: Ein Tippfehler im Namen wuerde sonst einfach dazu
        // fuehren, dass dieser Eintrag nie greift.
        console.error(`[OIDC] ${oidcEnv.MAPPING_VARIABLE}: Gruppe "${m.group_name}" existiert nicht - `
          + `Eintrag ${m.claim_path}=${m.claim_value} bleibt wirkungslos`);
        return out;
      }
      return { ...out, group_id: g.id, group: g };
    }
    if (m.custom_role_name) {
      const r = rolleNachName.get(m.custom_role_name);
      if (!r) {
        console.error(`[OIDC] ${oidcEnv.MAPPING_VARIABLE}: eigene Rolle "${m.custom_role_name}" `
          + `existiert nicht - Eintrag ${m.claim_path}=${m.claim_value} bleibt wirkungslos`);
        return out;
      }
      return { ...out, custom_role_id: r.id, customRole: r };
    }
    return out;
  });
};

/**
 * Die beim Login anzuwendenden Mappings (hoechste Prioritaet zuerst). Die
 * zurueckgegebenen Objekte tragen dieselben Felder wie die Modellinstanzen,
 * damit der Login-Weg nicht zwei Formen auseinanderhalten muss.
 */
const geltendeMappings = async () => {
  const ausEnv = oidcEnv.mappingsAusUmgebung();
  if (!ausEnv.aktiv) {
    return OidcClaimMapping.findAll({
      include: [
        { model: CustomRole, as: 'customRole' },
        { model: Group, as: 'group', attributes: ['id', 'name'] },
      ],
      order: [['priority', 'DESC'], ['id', 'ASC']],
    });
  }
  // Bei einem Fehler in der Variablen ist die Liste leer - siehe die
  // Begruendung in oidcEnv.js: lieber keine Zuordnung als die falsche.
  return namenAufloesen(ausEnv.mappings);
};

// The group a mapping grants: its group, or the group carrying its role.
const gruppeDesMappings = async (mapping) => {
  const access = require('./accessService');
  if (mapping.group_id) return mapping.group_id;
  if (mapping.custom_role_id && mapping.customRole) {
    return (await access.groupForCustomRole(mapping.customRole))?.id || null;
  }
  if (mapping.role) return (await access.groupForSystemRole(mapping.role))?.id || null;
  return null;
};

module.exports = { geltendeMappings, gruppeDesMappings };
