'use strict';

// Graph-Auswertungen (Apache AGE).
//
// Was der Graph hier leistet und die Tabellen nicht: Fragen mit UNBESTIMMTER
// TIEFE. "Welche Geschaeftsprozesse haengen an diesem Server" ist noch ein
// JOIN. "Was haengt alles daran, ueber beliebig viele Zwischenschritte" ist in
// SQL eine rekursive Abfrage je Beziehungsart - im Graphen ein Muster.
//
// ZUR SICHERHEIT
// Jeder Cypher-Text in dieser Datei ist ein Literal. Werte aus der Anfrage
// gehen ausschliesslich ueber das Parameterobjekt. Wo ein Label aus der
// Anfrage stammt (der Entitaetstyp in /impact/:type/:id), wird es vorher ueber
// labelFuerEntitaet() gegen die Positivliste in graphProjection.js aufgeloest -
// Cypher laesst Label nicht als Parameter zu, deshalb ist das der einzige
// gangbare Weg und zugleich die Stelle, an der es geprueft gehoert.

const router = require('express').Router();
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { boundedInt } = require('../utils/queryFilters');
const graph = require('../services/graphService');
const spec = require('../services/graphProjection');
const { auditFromReq } = require('../services/auditService');

router.use(authenticate);

// Ohne Extension gibt es keine Graph-Antworten. 503 statt 500: Das ist kein
// Programmfehler, sondern eine nicht eingerichtete Voraussetzung, und die
// Meldung sagt, welche.
const requireGraph = (req, res, next) => {
  if (!graph.istVerfuegbar()) {
    return res.status(503).json({
      error: 'Die Graph-Auswertung steht nicht bereit: Apache AGE ist in dieser '
        + 'Datenbank nicht eingerichtet.',
      detail: graph.statusText(),
    });
  }
  next();
};

// Die id einer Entitaet. Kommt aus der URL, geht als Parameter in die Abfrage -
// aber eine nicht-numerische id wuerde in agtype als Zeichenkette ankommen und
// dann nie etwas finden. Ein 400 ist verstaendlicher als ein leeres Ergebnis.
const parseId = (roh) => {
  const n = Number.parseInt(String(roh), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// GET /api/graph/meta — was es im Graphen gibt. Die Oberflaeche baut daraus
// ihre Legende und ihre Filter, statt die Label noch einmal zu fuehren.
router.get('/meta', requirePermission('graph', 'view', 'admin', 'assessor'), (req, res) => {
  res.json({
    available: graph.istVerfuegbar(),
    detail: graph.statusText(),
    labels: spec.ALL_LABELS,
    edgeTypes: spec.ALL_EDGE_TYPES,
    entityTypes: spec.ENTITY_LABELS,
    frameworks: spec.REQUIREMENT_SOURCES.map(q => q.framework),
  });
});

/**
 * GET /api/graph/impact/:type/:id
 *
 * Auswirkungsanalyse: Was haengt an dieser Entitaet, ueber bis zu `depth`
 * Schritte?
 *
 * Die Kanten werden BEIDSEITIG verfolgt (kein Pfeil im Muster). Das ist
 * Absicht: Die Richtung einer Kante ist die fachliche Leserichtung, nicht die
 * Richtung der Auswirkung. Ein Ausfall wirkt von einem Asset zu den Prozessen,
 * die darauf zeigen (BcmProcess)-[:DEPENDS_ON]->(Asset) - also gegen die
 * Kantenrichtung. Nur vorwaerts zu suchen haette die Auswirkungsanalyse genau
 * um die Antwort gebracht, fuer die es sie gibt.
 */
router.get('/impact/:type/:id', requireGraph, requirePermission('graph', 'view', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Ungueltige id' });

    let label;
    try {
      label = graph.labelFuerEntitaet(req.params.type);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Obergrenze 4: Bei einem dicht verknuepften ISMS waechst die Zahl der
    // Pfade mit jeder Stufe steil an, und jenseits von vier Schritten ist das
    // Ergebnis ohnehin "alles haengt mit allem zusammen" - eine Antwort, aus
    // der niemand etwas ableiten kann.
    const depth = boundedInt(req.query.depth, 3, 1, 4);

    // depth steht im Abfragetext, weil Cypher die Grenzen einer Pfadlaenge
    // nicht als Parameter zulaesst. boundedInt() hat daraus eine ganze Zahl
    // zwischen 1 und 4 gemacht - etwas anderes kann hier nicht ankommen.
    const rows = await graph.cypher(
      `MATCH p = (start:${label} {pk: $pk})-[*1..${depth}]-(ziel)
       WHERE ziel <> start
       RETURN DISTINCT ziel, length(p) AS distanz
       ORDER BY distanz
       LIMIT 500`,
      { pk: id },
      ['ziel', 'distanz'],
    );

    // Je Ziel nur den KUERZESTEN Weg behalten. Ohne das erschiene dasselbe
    // Asset mehrfach, einmal je Pfadlaenge, und die Oberflaeche zeigte eine
    // Liste, in der Wichtiges zwischen Wiederholungen verschwindet.
    const kuerzeste = new Map();
    for (const r of rows) {
      const knoten = r.ziel;
      if (!knoten || !knoten.label) continue;
      const schluessel = `${knoten.label}:${knoten.properties?.pk}:${knoten.properties?.framework || ''}`;
      const bisher = kuerzeste.get(schluessel);
      if (!bisher || r.distanz < bisher.distance) {
        kuerzeste.set(schluessel, {
          label: knoten.label,
          pk: knoten.properties?.pk ?? null,
          properties: knoten.properties || {},
          distance: r.distanz,
        });
      }
    }

    const treffer = [...kuerzeste.values()].sort(
      (a, b) => a.distance - b.distance || a.label.localeCompare(b.label),
    );

    // Nach Label gruppiert dazu: Die haeufigste Frage ist nicht "was haengt
    // dran", sondern "wie viele Prozesse haengen dran".
    const nachLabel = {};
    for (const t of treffer) nachLabel[t.label] = (nachLabel[t.label] || 0) + 1;

    res.json({
      origin: { type: req.params.type, label, pk: id },
      depth,
      total: treffer.length,
      byLabel: nachLabel,
      // Die Obergrenze wird benannt, statt das Ergebnis stillschweigend
      // abzuschneiden - sonst haelt der Betrachter 500 fuer die ganze Wahrheit.
      truncated: rows.length >= 500,
      items: treffer,
    });
  } catch (e) { serverError(res, e, 'graph'); }
});

/**
 * GET /api/graph/evidence/:framework/:ref
 *
 * Der Nachweis als Pfad: Warum gilt diese Anforderung als erfuellt?
 *
 * Geliefert werden die Massnahmen, die sie erfuellen, und was an diesen
 * Massnahmen haengt - Risiken, die sie mindern, und die Assets dahinter. Genau
 * diese Kette will ein Pruefer sehen, und sie stand bisher nirgends
 * zusammenhaengend, weil die Kataloge gar nicht mit den Massnahmen verbunden
 * waren.
 */
router.get('/evidence/:framework/:ref', requireGraph, requirePermission('graph', 'view', 'admin', 'assessor'), async (req, res) => {
  try {
    const framework = String(req.params.framework || '').toLowerCase();
    const bekannt = spec.REQUIREMENT_SOURCES.map(q => q.framework);
    if (!bekannt.includes(framework)) {
      return res.status(400).json({ error: `Unbekanntes Regelwerk "${framework}" (bekannt: ${bekannt.join(', ')})` });
    }
    const ref = String(req.params.ref || '').trim();
    if (!ref) return res.status(400).json({ error: 'Referenz fehlt' });

    const anforderung = await graph.cypher(
      `MATCH (r:${spec.REQUIREMENT_LABEL} {framework: $fw, ref: $ref}) RETURN r`,
      { fw: framework, ref },
      ['r'],
    );
    if (anforderung.length === 0) {
      return res.status(404).json({ error: `Anforderung ${ref} (${framework}) nicht gefunden` });
    }

    const massnahmen = await graph.cypher(
      `MATCH (r:${spec.REQUIREMENT_LABEL} {framework: $fw, ref: $ref})<-[s:SATISFIES]-(c:Control)
       RETURN c, s.coverage AS abdeckung`,
      { fw: framework, ref },
      ['c', 'abdeckung'],
    );

    // Je Massnahme die gemilderten Risiken und die davon betroffenen Assets.
    // Getrennt abgefragt statt in einem grossen Muster: Ein einziges MATCH
    // ueber alle drei Stufen liefert das Kreuzprodukt, und eine Massnahme ohne
    // Risiko fiele dabei ganz heraus (OPTIONAL MATCH ueber mehrere Stufen wird
    // schnell unlesbar).
    const belege = [];
    for (const m of massnahmen) {
      const pk = m.c?.properties?.pk;
      if (pk === undefined) continue;
      const risiken = await graph.cypher(
        `MATCH (c:Control {pk: $pk})-[:MITIGATES]->(risiko:Risk)
         OPTIONAL MATCH (risiko)-[:AFFECTS]->(asset:Asset)
         RETURN risiko, collect(asset) AS assets
         LIMIT 100`,
        { pk },
        ['risiko', 'assets'],
      );
      belege.push({
        control: { pk, properties: m.c.properties },
        coverage: m.abdeckung,
        risks: risiken.map(r => ({
          properties: r.risiko?.properties || {},
          assets: (Array.isArray(r.assets) ? r.assets : [])
            .filter(Boolean)
            .map(a => a.properties || {}),
        })),
      });
    }

    res.json({
      requirement: anforderung[0].r?.properties || {},
      framework,
      ref,
      // Ohne erfuellende Massnahme ist die Anforderung nicht belegt. Das
      // ausdruecklich zu sagen ist der halbe Zweck dieser Auswertung.
      covered: belege.length > 0,
      evidence: belege,
    });
  } catch (e) { serverError(res, e, 'graph'); }
});

/**
 * GET /api/graph/coverage/:controlId
 *
 * Die Gegenrichtung: Welche Regelwerke deckt DIESE Massnahme ab?
 *
 * Das ist die Frage, wegen der es control_requirements gibt. Bis v2.2.x trug
 * eine Massnahme genau ein `framework`, also war die Antwort immer "eins".
 */
router.get('/coverage/:controlId', requireGraph, requirePermission('graph', 'view', 'admin', 'assessor'), async (req, res) => {
  try {
    const pk = parseId(req.params.controlId);
    if (pk === null) return res.status(400).json({ error: 'Ungueltige id' });

    const rows = await graph.cypher(
      `MATCH (c:Control {pk: $pk})-[s:SATISFIES]->(r:${spec.REQUIREMENT_LABEL})
       RETURN r, s.coverage AS abdeckung
       ORDER BY r.framework, r.ref`,
      { pk },
      ['r', 'abdeckung'],
    );

    const nachRegelwerk = {};
    for (const row of rows) {
      const p = row.r?.properties || {};
      const fw = p.framework || 'unbekannt';
      (nachRegelwerk[fw] = nachRegelwerk[fw] || []).push({
        pk: p.pk, ref: p.ref, title: p.title, status: p.status, coverage: row.abdeckung,
      });
    }

    res.json({
      control_id: pk,
      frameworks: Object.keys(nachRegelwerk).sort(),
      total: rows.length,
      byFramework: nachRegelwerk,
    });
  } catch (e) { serverError(res, e, 'graph'); }
});

/**
 * GET /api/graph/path/:fromType/:fromId/:toType/:toId
 *
 * Der kuerzeste Weg zwischen zwei Entitaeten, als Kette von Knoten und Kanten.
 * Beantwortet "wie haengen diese beiden zusammen" - eine Frage, die in einer
 * Pruefungssituation regelmaessig gestellt und bisher von Hand rekonstruiert
 * wurde.
 */
router.get('/path/:fromType/:fromId/:toType/:toId', requireGraph, requirePermission('graph', 'view', 'admin', 'assessor'), async (req, res) => {
  try {
    const vonId = parseId(req.params.fromId);
    const nachId = parseId(req.params.toId);
    if (vonId === null || nachId === null) return res.status(400).json({ error: 'Ungueltige id' });

    let vonLabel; let nachLabel;
    try {
      vonLabel = graph.labelFuerEntitaet(req.params.fromType);
      nachLabel = graph.labelFuerEntitaet(req.params.toType);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const rows = await graph.cypher(
      `MATCH p = (a:${vonLabel} {pk: $von})-[*1..5]-(b:${nachLabel} {pk: $nach})
       RETURN nodes(p) AS knoten, relationships(p) AS kanten, length(p) AS laenge
       ORDER BY laenge
       LIMIT 1`,
      { von: vonId, nach: nachId },
      ['knoten', 'kanten', 'laenge'],
    );

    if (rows.length === 0) {
      return res.json({ found: false, hops: null, nodes: [], edges: [] });
    }

    res.json({
      found: true,
      hops: rows[0].laenge,
      nodes: (rows[0].knoten || []).map(n => ({ label: n.label, properties: n.properties || {} })),
      edges: (rows[0].kanten || []).map(e => ({ type: e.label, properties: e.properties || {} })),
    });
  } catch (e) { serverError(res, e, 'graph'); }
});

/**
 * POST /api/graph/rebuild
 *
 * Den Graphen aus den Tabellen neu aufbauen.
 *
 * Weil die Tabellen fuehrend sind, ist das ein vollstaendiger Weg zurueck und
 * kein Notbehelf: Ein abgewichener oder beschaedigter Graph kostet einen
 * Aufruf, keine Daten. Gebraucht wird er nach einem Massenimport (der die
 * Triggerpflege abschaltet) und wenn jemand an den Tabellen vorbei geschrieben
 * hat.
 *
 * Admin-only und im Audit-Log: Der Aufruf ist unkritisch fuer die Daten, aber
 * er laeuft ueber den gesamten Bestand und gehoert deshalb nachvollziehbar
 * protokolliert.
 */
router.post('/rebuild', requireGraph, requirePermission('graph', 'rebuild', 'admin'), async (req, res) => {
  try {
    const begonnen = Date.now();
    const zahlen = await graph.rebuild();
    const dauer = Date.now() - begonnen;
    await auditFromReq(req, 'update', 'settings', null, 'Graph-Neuaufbau', {
      nodes: zahlen.nodes, edges: zahlen.edges, duration_ms: dauer,
    });
    res.json({ ...zahlen, duration_ms: dauer });
  } catch (e) { serverError(res, e, 'graph'); }
});

module.exports = router;
