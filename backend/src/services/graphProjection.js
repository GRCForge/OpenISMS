'use strict';

// Die Abbildung Tabellen -> Graph, an EINER Stelle.
//
// VARIANTE 1: TABELLEN FUEHREND, GRAPH ABGELEITET
// Die Beziehungen liegen weiterhin in Verknuepfungstabellen mit
// Fremdschluesseln. Der Graph ist eine Projektion davon, die Trigger in
// derselben Transaktion pflegen. Fuer ein ISMS ist das die richtige Richtung:
//
//   - Die Datenbank erzwingt die Integritaet. Eine Kante ins Leere kann gar
//     nicht entstehen, weil der Fremdschluessel sie vorher ablehnt.
//   - Das Audit-Log greift unveraendert. Wer wann eine Zuordnung angelegt hat,
//     steht in der Auditspur der Tabelle - fuer Kanten in einem Graphen haette
//     man dieselbe Nachweisfuehrung erst bauen muessen.
//   - Ein kaputter Graph ist kein Datenverlust. rebuild() stellt ihn aus den
//     Tabellen wieder her.
//
// Waere der Graph fuehrend, muesste die Anwendung all das selbst leisten - und
// bei einem Nachweis gegenueber einem Pruefer stuende die Aussage "die Zuordnung
// ist korrekt" auf Anwendungscode statt auf einer Datenbankzusage.
//
// DASS DIESE DATEI DIE EINZIGE QUELLE IST, IST DER PUNKT
// Aus denselben Angaben entstehen die Trigger UND der Neuaufbau. Waeren es zwei
// Listen, liefe ein per Trigger gepflegter Graph irgendwann von dem ausein-
// ander, den rebuild() erzeugt - und der Unterschied faellt erst auf, wenn
// jemand neu aufbaut und sich die Auswertung aendert.

const GRAPH_NAME = process.env.GRAPH_NAME || 'isms';

// ---------------------------------------------------------------------------
// Knoten
// ---------------------------------------------------------------------------
// `pk` traegt die id der Zeile. Sie heisst nicht `id`, weil AGE jedem Knoten
// selbst eine `id` gibt - zwei verschiedene Zahlen unter einem Namen waere eine
// Fehlerquelle, die sich erst in einer falschen Auswertung zeigt.
//
// `props` nennt die Spalten, die als Eigenschaften mitkommen. Bewusst wenige:
// Der Graph beantwortet Beziehungsfragen, die Sachdaten holt der Aufrufer
// anschliessend aus der Tabelle. Jede Spalte mehr ist eine Kopie, die
// veralten kann, und beim Label Requirement auch eine, die Katalogtexte
// dupliziert.
const NODES = [
  { label: 'Asset',       table: 'assets',         props: ['name', 'type', 'classification', 'status'] },
  { label: 'Vendor',      table: 'vendors',        props: ['name', 'type', 'risk_level'] },
  { label: 'Risk',        table: 'risks',          props: ['title', 'status', 'inherent_level', 'residual_level'] },
  { label: 'Control',     table: 'controls',       props: ['code', 'title', 'status', 'framework'] },
  { label: 'Threat',      table: 'threats',        props: ['code', 'title', 'source'] },
  { label: 'Incident',    table: 'incidents',      props: ['title', 'severity', 'status'] },
  { label: 'VvtEntry',    table: 'vvt_entries',    props: ['name', 'status'] },
  { label: 'BcmProcess',  table: 'bcm_processes',  props: ['name', 'criticality', 'rto_hours'] },
  { label: 'Policy',      table: 'policies',       props: ['title', 'status'] },
  { label: 'AiSystem',    table: 'ai_systems',     props: ['name', 'risk_category'] },
  { label: 'Dsfa',        table: 'dsfas',          props: ['status'] },
];

// Die Anforderungskataloge teilen sich EIN Label.
//
// Fuenf Label (IsoControl, BsiRequirement, ...) haetten die Frage, auf die es
// ankommt, unbeantwortbar gemacht: "Welche Regelwerke deckt diese Massnahme ab"
// waere ein MATCH je Regelwerk plus Vereinigung, und jede neue Norm haette jede
// dieser Abfragen angefasst. Mit einem Label ist es ein MATCH, und `framework`
// ist eine Eigenschaft wie jede andere.
//
// `ref` ist die fachliche Referenz, unter der ein Pruefer die Anforderung
// nennt ("A.5.15", "ORP.4.A1"). Sie ist je Katalog aus anderen Spalten
// zusammengesetzt, deshalb steht hier ein SQL-Ausdruck und keine Spalte.
const REQUIREMENT_LABEL = 'Requirement';
const REQUIREMENT_SOURCES = [
  { framework: 'iso27001', table: 'iso27001_controls', refExpr: 'ref',                               titleExpr: 'title', statusExpr: 'implementation_status' },
  { framework: 'bsi',      table: 'bsi_requirements',  refExpr: 'req_id',                            titleExpr: 'title', statusExpr: 'implementation_status' },
  { framework: 'nis2',     table: 'nis2_measures',     refExpr: 'article_ref',                       titleExpr: 'title', statusExpr: 'implementation_status' },
  { framework: 'c5',       table: 'c5_criteria',       refExpr: 'criterion_id',                      titleExpr: 'title', statusExpr: 'implementation_status' },
  { framework: 'tisax',    table: 'tisax_requirements', refExpr: 'ref',                              titleExpr: 'title', statusExpr: 'status' },
];

// ---------------------------------------------------------------------------
// Kanten
// ---------------------------------------------------------------------------
// Zwei Bauformen:
//
//   join   - eine Verknuepfungstabelle, eine Zeile = eine Kante.
//   fk     - eine nullbare Fremdschluesselspalte an der Quelltabelle. Die Kante
//            entsteht, wenn die Spalte gesetzt ist, und verschwindet, wenn sie
//            auf NULL gesetzt wird. Deshalb braucht diese Bauform auch einen
//            UPDATE-Trigger, die join-Bauform nicht.
//
// Die Richtung ist die fachliche Leserichtung, nicht die Reihenfolge der
// Spalten: (:Control)-[:MITIGATES]->(:Risk) liest sich "Massnahme mindert
// Risiko". Cypher laeuft ohnehin in beide Richtungen, aber eine Kante, deren
// Name in Leserichtung keinen Sinn ergibt, wird beim Schreiben von Abfragen
// immer wieder falsch herum gesetzt.
const EDGES = [
  // --- Verknuepfungstabellen ---
  { type: 'MITIGATES',    kind: 'join', table: 'risk_controls',    from: { label: 'Control',    column: 'control_id' },      to: { label: 'Risk',     column: 'risk_id' } },
  { type: 'AFFECTS',      kind: 'join', table: 'risk_assets',      from: { label: 'Risk',       column: 'risk_id' },         to: { label: 'Asset',    column: 'asset_id' } },
  { type: 'REALIZES',     kind: 'join', table: 'risk_threats',     from: { label: 'Threat',     column: 'threat_id' },       to: { label: 'Risk',     column: 'risk_id' } },
  { type: 'CONCERNS',     kind: 'join', table: 'risk_vvt',         from: { label: 'Risk',       column: 'risk_id' },         to: { label: 'VvtEntry', column: 'vvt_id' } },
  { type: 'IMPACTED',     kind: 'join', table: 'incident_assets',  from: { label: 'Incident',   column: 'incident_id' },     to: { label: 'Asset',    column: 'asset_id' } },
  { type: 'MATERIALIZES', kind: 'join', table: 'incident_risks',   from: { label: 'Incident',   column: 'incident_id' },     to: { label: 'Risk',     column: 'risk_id' } },
  { type: 'INVOLVES',     kind: 'join', table: 'incident_vendors', from: { label: 'Incident',   column: 'incident_id' },     to: { label: 'Vendor',   column: 'vendor_id' } },
  { type: 'TOUCHES',      kind: 'join', table: 'incident_vvt',     from: { label: 'Incident',   column: 'incident_id' },     to: { label: 'VvtEntry', column: 'vvt_id' } },
  { type: 'USES',         kind: 'join', table: 'vvt_assets',       from: { label: 'VvtEntry',   column: 'vvt_id' },          to: { label: 'Asset',    column: 'asset_id' } },
  { type: 'PROCESSED_BY', kind: 'join', table: 'vvt_vendors',      from: { label: 'VvtEntry',   column: 'vvt_id' },          to: { label: 'Vendor',   column: 'vendor_id' } },
  { type: 'GOVERNS',      kind: 'join', table: 'policy_assets',    from: { label: 'Policy',     column: 'policy_id' },       to: { label: 'Asset',    column: 'asset_id' } },
  { type: 'IMPLEMENTS',   kind: 'join', table: 'policy_controls',  from: { label: 'Policy',     column: 'policy_id' },       to: { label: 'Control',  column: 'control_id' } },
  { type: 'DEPENDS_ON',   kind: 'join', table: 'bcm_process_assets', from: { label: 'BcmProcess', column: 'bcm_process_id' }, to: { label: 'Asset',   column: 'asset_id' },
    props: ['criticality'] },

  // --- Fremdschluesselspalten ---
  { type: 'SUPPLIED_BY',  kind: 'fk', table: 'assets',      from: { label: 'Asset',    column: 'id' }, to: { label: 'Vendor',   column: 'vendor_id' } },
  { type: 'SUPPLIED_BY',  kind: 'fk', table: 'ai_systems',  from: { label: 'AiSystem', column: 'id' }, to: { label: 'Vendor',   column: 'vendor_id' } },
  { type: 'ASSESSES',     kind: 'fk', table: 'dsfas',       from: { label: 'Dsfa',     column: 'id' }, to: { label: 'VvtEntry', column: 'vvt_id' } },
  { type: 'FLOWS_TO',     kind: 'fk', table: 'data_flows',  from: { label: 'Asset',    column: 'source_id' }, to: { label: 'Asset', column: 'target_id' },
    // Bei data_flows ist KEINE der beiden Spalten die eigene id: Die Kante
    // verbindet zwei fremde Zeilen. Deshalb traegt sie zusaetzlich die id der
    // Flusszeile, sonst liesse sie sich beim Loeschen nicht wiederfinden.
    carriesOwnId: true },
];

// Die Cross-Framework-Kante. Eigene Bauform, weil ihr Ziel polymorph ist:
// framework entscheidet, welcher Katalog gemeint ist. Sie zeigt auf das Label
// Requirement, dessen pk die Zeilen-id im jeweiligen Katalog ist - deshalb ist
// der Knotenschluessel hier framework + pk und nicht pk allein.
const REQUIREMENT_EDGE = {
  type: 'SATISFIES',
  table: 'control_requirements',
  from: { label: 'Control', column: 'control_id' },
  to: { label: REQUIREMENT_LABEL, frameworkColumn: 'framework', idColumn: 'requirement_id' },
  props: ['coverage'],
};

// Alle Label, die es im Graphen gibt. Cypher laesst Label NICHT als Parameter
// zu (nachgeprueft: "syntax error bei $label"), ein Label aus einer Anfrage
// muesste also in den Abfragetext. Diese Liste ist die Positivliste, gegen die
// das geprueft wird - siehe graphService.assertLabel().
const ALL_LABELS = [...NODES.map(n => n.label), REQUIREMENT_LABEL];

// Ebenso fuer Kantentypen.
const ALL_EDGE_TYPES = [...new Set([...EDGES.map(e => e.type), REQUIREMENT_EDGE.type])];

// Entitaetstyp aus einer Anfrage -> Label. Die Schluessel sind die Namen, unter
// denen die REST-Routen ihre Entitaeten ohnehin fuehren; so muss kein Aufrufer
// die Label des Graphen kennen.
const ENTITY_LABELS = {
  asset: 'Asset',
  vendor: 'Vendor',
  risk: 'Risk',
  control: 'Control',
  threat: 'Threat',
  incident: 'Incident',
  vvt: 'VvtEntry',
  bcm_process: 'BcmProcess',
  policy: 'Policy',
  ai_system: 'AiSystem',
  dsfa: 'Dsfa',
  requirement: REQUIREMENT_LABEL,
};

module.exports = {
  GRAPH_NAME,
  NODES,
  REQUIREMENT_LABEL,
  REQUIREMENT_SOURCES,
  EDGES,
  REQUIREMENT_EDGE,
  ALL_LABELS,
  ALL_EDGE_TYPES,
  ENTITY_LABELS,
};
