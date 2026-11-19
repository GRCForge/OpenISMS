'use strict';

// Schichten (Prozess- und Systembausteine) des IT-Grundschutz-Kompendiums.
//
// Die Reihenfolge ist die des Kompendiums: erst die Prozessbausteine (ISMS,
// ORP, CON, OPS, DER), dann die Systembausteine (APP, SYS, IND, NET, INF).
//
// "ORG" ist KEIN Kuerzel des Kompendiums - die Schicht "Organisation und
// Personal" heisst ORP. Die MCP-Beschreibung von isms_list_bsi_requirements
// nannte bis 3.3.12 trotzdem "ORG", und ein Client, der sich daran hielt,
// bekam eine leere Liste statt eines Fehlers. Damit bestehende Aufrufe weiter
// funktionieren, wird ORG als Alias fuer ORP angenommen.
const BSI_LAYERS = Object.freeze(['ISMS', 'ORP', 'CON', 'OPS', 'DER', 'APP', 'SYS', 'IND', 'NET', 'INF']);

const LAYER_ALIASES = Object.freeze({ ORG: 'ORP' });

/**
 * Normalisiert ein Schichtkuerzel: Gross-/Kleinschreibung egal, Alias ORG -> ORP.
 * Gibt null zurueck, wenn das Kuerzel keine Schicht des Kompendiums ist.
 */
function normalizeBsiLayer(value) {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  const mapped = LAYER_ALIASES[upper] || upper;
  return BSI_LAYERS.includes(mapped) ? mapped : null;
}

// Umsetzungsstatus, wie ihn das Modell BsiRequirement speichert. Die MCP-Tools
// nannten bis 3.3.12 die Werte des Grundschutz-Checks (ja/teilweise/nein/
// entbehrlich), die die ENUM-Spalte nicht kennt: ein Schreibversuch scheiterte
// in Postgres, ein Filter lieferte immer eine leere Liste. Die alten Werte
// werden auf die naechstliegenden Modellwerte abgebildet.
const BSI_STATUSES = Object.freeze(['not_started', 'in_progress', 'implemented', 'not_applicable']);

const STATUS_ALIASES = Object.freeze({
  ja: 'implemented',
  teilweise: 'in_progress',
  nein: 'not_started',
  entbehrlich: 'not_applicable',
});

function normalizeBsiStatus(value) {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  const mapped = STATUS_ALIASES[lower] || lower;
  return BSI_STATUSES.includes(mapped) ? mapped : null;
}

module.exports = {
  BSI_LAYERS,
  LAYER_ALIASES,
  normalizeBsiLayer,
  BSI_STATUSES,
  STATUS_ALIASES,
  normalizeBsiStatus,
};
