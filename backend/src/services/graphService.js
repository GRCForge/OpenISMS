'use strict';

// Zugang zum Graphen (Apache AGE).
//
// CYPHER-INJEKTION: DIE EINE REGEL
// Abfragetext wird NIE aus Werten zusammengesetzt. Er steht ausschliesslich als
// Literal im Quelltext; Werte gehen durch das dritte Argument von cypher() und
// werden von der Datenbank als Parameter gebunden.
//
// AGE erzwingt das sogar: Ein literaler Parameterstring wird mit "third
// argument of cypher function must be a parameter" abgelehnt - es MUSS ein
// Bind-Parameter sein. Nachgeprueft wurde beides, das Binden und die Wirkung:
// Ein Wert, der Cypher-Syntax enthaelt, kommt als Wert an und findet nichts,
// statt ausgefuehrt zu werden.
//
// Eine Grenze bleibt: Label und Kantentypen lassen Cypher als Parameter NICHT
// zu ("syntax error bei $label"). Wo ein Label aus einer Anfrage stammt, muss
// es deshalb ueber assertLabel() gegen die Positivliste aus graphProjection.js
// laufen, bevor es in den Abfragetext darf. Das ist die einzige Stelle, an der
// ueberhaupt etwas in den Text eingesetzt wird.

const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');
const spec = require('./graphProjection');

// Ohne Extension laeuft das ISMS weiter, nur die Graph-Auswertungen nicht.
// Die Alternative - Start verweigern - haette bedeutet, dass eine fehlende
// Erweiterung ein vollstaendig funktionierendes ISMS lahmlegt.
let verfuegbar = false;
let letzterFehler = null;

const istVerfuegbar = () => verfuegbar;
const statusText = () => letzterFehler;

// Der Graphname steht in jeder Abfrage im Text. Er kommt aus der Umgebung,
// also wird er hier einmal geprueft statt an jeder Einsetzstelle.
const GRAPH = spec.GRAPH_NAME;
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(GRAPH)) {
  throw new Error(`Ungueltiger GRAPH_NAME "${GRAPH}": erlaubt sind Kleinbuchstaben, Ziffern und _`);
}

const BEZEICHNER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** Label aus einer Anfrage gegen die Positivliste pruefen. Wirft bei Unbekanntem. */
const assertLabel = (label) => {
  if (!spec.ALL_LABELS.includes(label)) {
    throw new Error(`Unbekanntes Label "${label}"`);
  }
  return label;
};

/** Entitaetstyp einer Route -> Label. Wirft bei Unbekanntem. */
const labelFuerEntitaet = (typ) => {
  const label = spec.ENTITY_LABELS[String(typ || '').toLowerCase()];
  if (!label) {
    throw new Error(`Unbekannter Entitaetstyp "${typ}" `
      + `(bekannt: ${Object.keys(spec.ENTITY_LABELS).join(', ')})`);
  }
  return label;
};

/**
 * Eine Cypher-Abfrage ausfuehren.
 *
 * @param {string}   text     Cypher. MUSS ein Literal aus dem Quelltext sein.
 * @param {object}   params   Werte. Gehen gebunden als agtype an die Datenbank.
 * @param {string[]} columns  Spaltennamen der AS-Klausel - cypher() ist eine
 *                            Funktion mit unbestimmter Rueckgabe, Postgres
 *                            braucht die Form. Muessen zur RETURN-Liste passen.
 */
const cypher = async (text, params = {}, columns = ['result'], options = {}) => {
  for (const c of columns) {
    // Diese Namen kommen aus dem Quelltext, nie aus einer Anfrage. Die Pruefung
    // ist die Zusicherung, dass das so bleibt - ein aus Versehen durchgereichter
    // Anfragewert scheitert hier, statt im Abfragetext zu landen.
    if (!BEZEICHNER.test(c)) throw new Error(`Ungueltiger Spaltenname "${c}"`);
  }
  const asKlausel = columns.map(c => `"${c}" ag_catalog.agtype`).join(', ');

  // Der Abfragetext wird in $cy$...$cy$ gefasst. Dollar-Quoting braucht kein
  // Escaping und kann deshalb auch nicht falsch escapet werden - anders als ein
  // gewoehnliches Stringliteral, in dem jedes Anfuehrungszeichen des Cypher
  // richtig verdoppelt sein muesste.
  const sql = `SELECT * FROM ag_catalog.cypher('${GRAPH}', $cy$${text}$cy$, $1) AS (${asKlausel})`;

  // WARUM HIER NICHT sequelize.query() STEHT
  //
  // Sequelize schreibt bei Verwendung von `bind` das SQL vorher um und ersetzt
  // JEDES Vorkommen von $name - ohne zu unterscheiden, ob es innerhalb eines
  // Literals steht. Das trifft genau zwei Dinge, die hier unverzichtbar sind:
  // die Dollar-Quote-Marke $cy$ und jeden Cypher-Parameter ($pk, $from, ...).
  // Die Abfrage scheiterte dadurch an "Named bind parameter $cy has no value".
  //
  // Das $$-Escaping von Sequelize hilft nicht: Sein Muster verlangt \B vor dem
  // Dollar, sodass ein $$ direkt hinter einem Wortzeichen - also die schliessende
  // Marke in "...$cy$" - nicht zurueckverwandelt wird.
  //
  // Deshalb geht die Abfrage direkt an den pg-Client. Der kennt nur $1..$n als
  // Parameter und laesst den Rest des SQL unangetastet. Die Bindung selbst
  // bleibt davon unberuehrt: Der Wert geht weiterhin als Parameter an die
  // Datenbank und nie in den Abfragetext.
  const eigeneVerbindung = !options.transaction;
  const conn = options.transaction
    ? options.transaction.connection
    : await sequelize.connectionManager.getConnection();
  let ergebnis;
  try {
    ergebnis = await conn.query(sql, [JSON.stringify(params)]);
  } finally {
    // Eine selbst geholte Verbindung MUSS zurueck in den Pool. Ohne das ist
    // nach DB_POOL_MAX Graph-Abfragen keine Verbindung mehr frei und die
    // gesamte Anwendung steht - nicht nur der Graph.
    if (eigeneVerbindung) sequelize.connectionManager.releaseConnection(conn);
  }
  const rows = ergebnis.rows || [];

  // agtype kommt als Zeichenkette zurueck. Knoten und Kanten tragen ein
  // Typsuffix ("::vertex", "::edge"), das kein JSON ist und vor dem Parsen weg
  // muss - sonst scheitert jede Auswertung an genau den Zeilen, die Knoten
  // enthalten, also an den interessanten.
  return rows.map(zeile => {
    const out = {};
    for (const [k, v] of Object.entries(zeile)) out[k] = agtypeParsen(v);
    return out;
  });
};

const agtypeParsen = (wert) => {
  if (wert === null || wert === undefined) return null;
  if (typeof wert !== 'string') return wert;
  const ohneTyp = wert.replace(/::(vertex|edge|path)(?=\s*[,\]}]|\s*$)/g, '');
  try { return JSON.parse(ohneTyp); } catch { return wert; }
};

// ---------------------------------------------------------------------------
// Erzeugtes SQL: Trigger
// ---------------------------------------------------------------------------
// Die Trigger entstehen aus graphProjection.js, nicht von Hand. Handgeschrieben
// waeren es ueber dreissig fast gleiche Funktionen - und die eine, die beim
// Hinzufuegen einer Kante vergessen wird, faellt nie auf: Der Graph ist dann
// einfach unvollstaendig, ohne Fehlermeldung.

// JEDE Triggerfunktion bringt ihren eigenen search_path mit.
//
// Ohne das haengt sie am Suchpfad des Aufrufers - und die Operatoren, die AGE
// intern fuer MERGE braucht (agtype @> agtype), liegen in ag_catalog. Ein
// INSERT aus einer Sitzung ohne ag_catalog im Suchpfad scheiterte deshalb mit
// "Operator existiert nicht: ag_catalog.agtype @> ag_catalog.agtype" - und weil
// ein fehlgeschlagener AFTER-Trigger die ganze Anweisung mitreisst, war nicht
// etwa nur der Graph unvollstaendig: Das INSERT selbst ging nicht mehr durch.
//
// Die Anwendung setzt den Suchpfad zwar an der Verbindung (config/database.js),
// aber sie ist nicht der einzige Zugang. Ein Administrator in psql, ein
// Wiederherstellungswerkzeug, ein Migrationslauf - alle haetten die Tabellen
// nicht mehr beschreiben koennen.
//
// Der feste Suchpfad ist zugleich die uebliche Haertung fuer Triggerfunktionen:
// Er nimmt einem Aufrufer die Moeglichkeit, ueber einen eigenen Suchpfad
// unterzuschieben, welche Funktion hier gemeint ist.
const FUNKTIONS_SUCHPFAD = 'SET search_path = public, ag_catalog';

/** Sicherer plpgsql-Ausdruck, der das Parameterobjekt als agtype baut. */
const jsonbAusdruck = (paare) =>
  `jsonb_build_object(${paare.join(', ')})::text::ag_catalog.agtype`;

/** Einen cypher()-Aufruf in plpgsql, mit der Variablen `params` als Parameter. */
const plpgsqlCypher = (text) =>
  `PERFORM * FROM ag_catalog.cypher('${GRAPH}', $cy$${text}$cy$, params) AS (r ag_catalog.agtype);`;

// Der Wachposten am Anfang jeder Triggerfunktion.
//
// Ein Massenimport schreibt tausende Zeilen; jede einzelne wuerde sonst eine
// Cypher-Abfrage ausloesen und den Import um ein Vielfaches verlangsamen. Mit
// "SET LOCAL isms.graph_sync = 'off'" laesst sich die Pflege fuer die Dauer
// einer Transaktion abschalten - danach stellt rebuild() den Graphen her.
//
// LOCAL ist wichtig: So endet die Abschaltung mit der Transaktion und kann
// nicht versehentlich fuer die ganze Verbindung stehen bleiben.
const WACHPOSTEN = `
  IF coalesce(current_setting('isms.graph_sync', true), 'on') = 'off' THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;`;

const knotenTrigger = (node) => {
  const fn = `isms_graph_node_${node.table}`;
  const setListe = node.props.map(p => `n.${p} = $${p}`).join(', ');
  const paareNeu = ["'pk'", 'NEW.id', ...node.props.flatMap(p => [`'${p}'`, `NEW.${p}`])];

  // MERGE statt CREATE: Ein erneutes INSERT derselben id kann es nach einem
  // Wiederherstellen geben, und ein UPDATE nutzt dieselbe Anweisung.
  const merge = setListe
    ? `MERGE (n:${node.label} {pk: $pk}) SET ${setListe}`
    : `MERGE (n:${node.label} {pk: $pk})`;

  return `
CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql
  ${FUNKTIONS_SUCHPFAD}
AS $fn$
DECLARE params ag_catalog.agtype;
BEGIN${WACHPOSTEN}
  IF TG_OP = 'DELETE' THEN
    params := ${jsonbAusdruck(["'pk'", 'OLD.id'])};
    ${plpgsqlCypher(`MATCH (n:${node.label} {pk: $pk}) DETACH DELETE n`)}
    RETURN OLD;
  END IF;
  params := ${jsonbAusdruck(paareNeu)};
  ${plpgsqlCypher(merge)}
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_${fn} ON "${node.table}";
CREATE TRIGGER trg_${fn}
  AFTER INSERT OR UPDATE OR DELETE ON "${node.table}"
  FOR EACH ROW EXECUTE FUNCTION ${fn}();
`;
};

// Endpunkte werden mit MERGE geholt, nicht mit MATCH.
//
// Faende MATCH einen Endpunktknoten nicht, verschwaende die Kante lautlos - die
// Beziehung stuende in der Tabelle, aber nicht im Graphen, und keine Auswertung
// wuerde sie je zeigen. MERGE legt im Zweifel einen Knoten ohne Eigenschaften
// an: Die BEZIEHUNG bleibt damit vollstaendig, und die Eigenschaften traegt der
// naechste Knoten-Trigger oder rebuild() nach. Von zwei unvollstaendigen
// Zustaenden ist das der wiederherstellbare.
const kantenTrigger = (edge) => {
  const idTeil = edge.carriesOwnId ? '_' + edge.type.toLowerCase() : '';
  const fn = `isms_graph_edge_${edge.table}${idTeil}`;
  const propSet = (edge.props || []).map(p => `e.${p} = $${p}`).join(', ');

  const quelleSpalte = edge.kind === 'fk' && edge.from.column === 'id' ? 'id' : edge.from.column;
  const zielSpalte = edge.to.column;

  const kantenMuster = edge.carriesOwnId
    ? `MERGE (a)-[e:${edge.type} {pk: $pk}]->(b)`
    : `MERGE (a)-[e:${edge.type}]->(b)`;
  const anlegen = [
    `MERGE (a:${edge.from.label} {pk: $from})`,
    `MERGE (b:${edge.to.label} {pk: $to})`,
    kantenMuster,
    ...(propSet ? [`SET ${propSet}`] : []),
  ].join(' ');

  const entfernen = edge.carriesOwnId
    ? `MATCH (:${edge.from.label})-[e:${edge.type} {pk: $pk}]->(:${edge.to.label}) DELETE e`
    : `MATCH (:${edge.from.label} {pk: $from})-[e:${edge.type}]->(:${edge.to.label} {pk: $to}) DELETE e`;

  const paare = (praefix) => [
    "'from'", `${praefix}.${quelleSpalte}`,
    "'to'", `${praefix}.${zielSpalte}`,
    ...(edge.carriesOwnId ? ["'pk'", `${praefix}.id`] : []),
    ...(edge.props || []).flatMap(p => [`'${p}'`, `${praefix}.${p}`]),
  ];

  // Eine fk-Kante haengt an einer nullbaren Spalte: Ist sie NULL, gibt es keine
  // Kante. Deshalb die Pruefung - ohne sie entstuende eine Kante auf einen
  // Knoten mit pk null.
  const nullPruefungNeu = edge.kind === 'fk'
    ? `IF NEW.${zielSpalte} IS NULL OR NEW.${quelleSpalte} IS NULL THEN RETURN NEW; END IF;`
    : '';
  const nullPruefungAlt = edge.kind === 'fk'
    ? `IF OLD.${zielSpalte} IS NULL OR OLD.${quelleSpalte} IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;`
    : '';

  // Bei UPDATE einer fk-Spalte zuerst die alte Kante weg, dann die neue. Anders
  // herum bliebe bei gleichbleibendem Ziel am Ende keine Kante uebrig.
  const updateZweig = edge.kind === 'fk' ? `
  IF TG_OP = 'UPDATE' THEN
    IF OLD.${zielSpalte} IS DISTINCT FROM NEW.${zielSpalte}
       OR OLD.${quelleSpalte} IS DISTINCT FROM NEW.${quelleSpalte} THEN
      ${nullPruefungAlt ? `IF OLD.${zielSpalte} IS NOT NULL AND OLD.${quelleSpalte} IS NOT NULL THEN` : ''}
        params := ${jsonbAusdruck(paare('OLD'))};
        ${plpgsqlCypher(entfernen)}
      ${nullPruefungAlt ? 'END IF;' : ''}
    END IF;
  END IF;` : '';

  return `
CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql
  ${FUNKTIONS_SUCHPFAD}
AS $fn$
DECLARE params ag_catalog.agtype;
BEGIN${WACHPOSTEN}
  IF TG_OP = 'DELETE' THEN
    ${nullPruefungAlt}
    params := ${jsonbAusdruck(paare('OLD'))};
    ${plpgsqlCypher(entfernen)}
    RETURN OLD;
  END IF;
${updateZweig}
  ${nullPruefungNeu}
  params := ${jsonbAusdruck(paare('NEW'))};
  ${plpgsqlCypher(anlegen)}
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_${fn} ON "${edge.table}";
CREATE TRIGGER trg_${fn}
  AFTER INSERT OR UPDATE OR DELETE ON "${edge.table}"
  FOR EACH ROW EXECUTE FUNCTION ${fn}();
`;
};

// Die Cross-Framework-Kante. Eigene Funktion, weil ihr Ziel polymorph ist: Der
// Knotenschluessel ist framework + pk, nicht pk allein. Zwei Anforderungen aus
// verschiedenen Katalogen koennen dieselbe Zeilen-id haben.
const anforderungsKantenTrigger = () => {
  const e = spec.REQUIREMENT_EDGE;
  const fn = 'isms_graph_edge_control_requirements';
  const propSet = (e.props || []).map(p => `e.${p} = $${p}`).join(', ');
  const paare = (p) => [
    "'from'", `${p}.${e.from.column}`,
    "'to'", `${p}.${e.to.idColumn}`,
    "'fw'", `${p}.${e.to.frameworkColumn}::text`,
    ...(e.props || []).flatMap(x => [`'${x}'`, `${p}.${x}`]),
  ];
  const anlegen = `MERGE (a:${e.from.label} {pk: $from}) `
    + `MERGE (b:${e.to.label} {pk: $to, framework: $fw}) `
    + `MERGE (a)-[e:${e.type}]->(b)`
    + (propSet ? ` SET ${propSet}` : '');
  const entfernen = `MATCH (:${e.from.label} {pk: $from})-[e:${e.type}]->`
    + `(:${e.to.label} {pk: $to, framework: $fw}) DELETE e`;

  return `
CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql
  ${FUNKTIONS_SUCHPFAD}
AS $fn$
DECLARE params ag_catalog.agtype;
BEGIN${WACHPOSTEN}
  IF TG_OP = 'DELETE' THEN
    params := ${jsonbAusdruck(paare('OLD'))};
    ${plpgsqlCypher(entfernen)}
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    params := ${jsonbAusdruck(paare('OLD'))};
    ${plpgsqlCypher(entfernen)}
  END IF;
  params := ${jsonbAusdruck(paare('NEW'))};
  ${plpgsqlCypher(anlegen)}
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_${fn} ON "${e.table}";
CREATE TRIGGER trg_${fn}
  AFTER INSERT OR UPDATE OR DELETE ON "${e.table}"
  FOR EACH ROW EXECUTE FUNCTION ${fn}();
`;
};

// Die Katalogtabellen speisen alle dasselbe Label Requirement.
const anforderungsKnotenTrigger = (quelle) => {
  const fn = `isms_graph_req_${quelle.table}`;
  const paare = (p) => [
    "'pk'", `${p}.id`,
    "'fw'", `'${quelle.framework}'`,
    "'ref'", `${p}.${quelle.refExpr}`,
    "'title'", `${p}.${quelle.titleExpr}`,
    "'status'", `${p}.${quelle.statusExpr}::text`,
  ];
  const merge = `MERGE (n:${spec.REQUIREMENT_LABEL} {pk: $pk, framework: $fw}) `
    + `SET n.ref = $ref, n.title = $title, n.status = $status`;

  return `
CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql
  ${FUNKTIONS_SUCHPFAD}
AS $fn$
DECLARE params ag_catalog.agtype;
BEGIN${WACHPOSTEN}
  IF TG_OP = 'DELETE' THEN
    params := ${jsonbAusdruck(["'pk'", 'OLD.id', "'fw'", `'${quelle.framework}'`])};
    ${plpgsqlCypher(`MATCH (n:${spec.REQUIREMENT_LABEL} {pk: $pk, framework: $fw}) DETACH DELETE n`)}
    RETURN OLD;
  END IF;
  params := ${jsonbAusdruck(paare('NEW'))};
  ${plpgsqlCypher(merge)}
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_${fn} ON "${quelle.table}";
CREATE TRIGGER trg_${fn}
  AFTER INSERT OR UPDATE OR DELETE ON "${quelle.table}"
  FOR EACH ROW EXECUTE FUNCTION ${fn}();
`;
};

/** Das gesamte Trigger-DDL, in der Reihenfolge, in der es angewandt wird. */
const triggerDDL = () => [
  ...spec.NODES.map(knotenTrigger),
  ...spec.REQUIREMENT_SOURCES.map(anforderungsKnotenTrigger),
  ...spec.EDGES.map(kantenTrigger),
  anforderungsKantenTrigger(),
];

// ---------------------------------------------------------------------------
// Einrichten
// ---------------------------------------------------------------------------

const ensureGraph = async () => {
  try {
    // AGE ist keine "trusted extension": Das Anlegen verlangt Superuser-Rechte.
    // In der mitgelieferten compose-Datei ist der Anwendungsbenutzer der
    // Eigentuemer der Datenbank und darf das; bei einer extern betriebenen
    // Datenbank muss der Betreiber die Erweiterung vorher anlegen. Genau das
    // sagt die Fehlermeldung weiter unten dann auch.
    await sequelize.query('CREATE EXTENSION IF NOT EXISTS age');

    // ag_graph.name ist vom Typ `name`, nicht text - ohne die Umwandlung
    // findet der Vergleich mit einem Textparameter nichts.
    const zeilen = await sequelize.query(
      `SELECT count(*)::int AS n FROM ag_catalog.ag_graph WHERE name::text = $1`,
      { bind: [GRAPH], type: QueryTypes.SELECT },
    );
    let graphFehlte = Number(zeilen?.[0]?.n || 0) === 0;
    if (graphFehlte) {
      try {
        await sequelize.query(`SELECT ag_catalog.create_graph('${GRAPH}')`);
        console.log(`[Graph] Graph "${GRAPH}" angelegt`);
      } catch (e) {
        // Zwei Anwendungsinstanzen auf derselben Datenbank koennen gleichzeitig
        // starten; dann gewinnt eine das Anlegen und die andere darf daran nicht
        // scheitern. Ohne diesen Zweig blieben die Graph-Auswertungen auf der
        // zweiten Instanz dauerhaft abgeschaltet - wegen eines Zustands, der
        // genau der gewuenschte ist.
        if (!/already exists/i.test(e.message)) throw e;
        graphFehlte = false;
      }
    }

    // Label vorab anlegen. AGE legt sie sonst beim ersten Schreiben an - aber
    // ein MATCH auf ein noch nie beschriebenes Label ist dann eine Abfrage auf
    // etwas, das es nicht gibt. Vorab angelegt liefert sie schlicht nichts,
    // was die richtige Antwort auf "zeige alle Risiken" in einem leeren ISMS ist.
    for (const label of spec.ALL_LABELS) {
      await sequelize.query(
        `SELECT ag_catalog.create_vlabel('${GRAPH}', $1)`, { bind: [label] },
      ).catch(() => { /* existiert bereits */ });
    }
    for (const typ of spec.ALL_EDGE_TYPES) {
      await sequelize.query(
        `SELECT ag_catalog.create_elabel('${GRAPH}', $1)`, { bind: [typ] },
      ).catch(() => { /* existiert bereits */ });
    }

    for (const ddl of triggerDDL()) {
      await sequelize.query(ddl);
    }

    verfuegbar = true;
    letzterFehler = null;
    console.log(`[Graph] AGE bereit (${spec.ALL_LABELS.length} Label, `
      + `${spec.ALL_EDGE_TYPES.length} Kantentypen, ${triggerDDL().length} Trigger)`);

    // Nach einem Neuanlegen des Graphen ist er leer, die Tabellen sind es
    // vielleicht nicht. GRAPH_REBUILD_ON_START erzwingt den Neuaufbau auch
    // sonst - der Weg zurueck, wenn der Graph je von den Tabellen abweicht.
    if (graphFehlte || process.env.GRAPH_REBUILD_ON_START === 'true') {
      const zahlen = await rebuild();
      console.log(`[Graph] Neu aufgebaut: ${zahlen.nodes} Knoten, ${zahlen.edges} Kanten`);
    }
  } catch (e) {
    verfuegbar = false;
    letzterFehler = e.message;
    console.error(
      '[Graph] Apache AGE steht nicht bereit — die Graph-Auswertungen bleiben abgeschaltet, '
      + 'das uebrige ISMS laeuft normal weiter.\n'
      + `        Grund: ${e.message}\n`
      + '        Bei einer extern betriebenen Datenbank einmalig als Superuser ausfuehren:\n'
      + '          CREATE EXTENSION age;\n'
      + `          GRANT USAGE ON SCHEMA ag_catalog TO <anwendungsbenutzer>;\n`
      + '        und sicherstellen, dass die Bibliothek geladen wird:\n'
      + "          ALTER SYSTEM SET shared_preload_libraries = 'age';   (danach Neustart)",
    );
  }
};

// ---------------------------------------------------------------------------
// Neuaufbau aus den Tabellen
// ---------------------------------------------------------------------------
// Der Weg zurueck. Weil die Tabellen fuehrend sind, ist ein beschaedigter oder
// abgewichener Graph kein Datenverlust, sondern eine Frage von einem Aufruf.
//
// Laeuft in EINER Transaktion mit abgeschalteter Triggerpflege: Die Trigger
// wuerden sonst nichts Falsches tun, aber jede Zeile doppelt verarbeiten.
const rebuild = async () => {
  let nodes = 0;
  let edges = 0;

  await sequelize.transaction(async (t) => {
    await sequelize.query("SET LOCAL isms.graph_sync = 'off'", { transaction: t });

    // Den Graphen leeren, statt ihn zu ergaenzen: Ein Neuaufbau soll auch das
    // loswerden, was in den Tabellen nicht mehr steht. Die Label bleiben.
    for (const label of spec.ALL_LABELS) {
      await cypher(
        `MATCH (n:${assertLabel(label)}) DETACH DELETE n`, {}, ['r'], { transaction: t },
      );
    }

    for (const node of spec.NODES) {
      const spalten = ['id', ...node.props].map(c => `"${c}"`).join(', ');
      const rows = await sequelize.query(
        `SELECT ${spalten} FROM "${node.table}"`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      const setListe = node.props.map(p => `n.${p} = $${p}`).join(', ');
      const text = setListe
        ? `MERGE (n:${node.label} {pk: $pk}) SET ${setListe}`
        : `MERGE (n:${node.label} {pk: $pk})`;
      for (const r of rows) {
        const params = { pk: r.id };
        for (const p of node.props) params[p] = normalisieren(r[p]);
        await cypher(text, params, ['r'], { transaction: t });
        nodes++;
      }
    }

    for (const q of spec.REQUIREMENT_SOURCES) {
      const rows = await sequelize.query(
        `SELECT id, "${q.refExpr}" AS ref, "${q.titleExpr}" AS title, `
        + `"${q.statusExpr}"::text AS status FROM "${q.table}"`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      for (const r of rows) {
        await cypher(
          `MERGE (n:${spec.REQUIREMENT_LABEL} {pk: $pk, framework: $fw}) `
          + `SET n.ref = $ref, n.title = $title, n.status = $status`,
          { pk: r.id, fw: q.framework, ref: normalisieren(r.ref), title: normalisieren(r.title), status: normalisieren(r.status) },
          ['r'], { transaction: t },
        );
        nodes++;
      }
    }

    for (const e of spec.EDGES) {
      const quelleSpalte = e.kind === 'fk' && e.from.column === 'id' ? 'id' : e.from.column;
      const spalten = [
        `"${quelleSpalte}" AS von`,
        `"${e.to.column}" AS nach`,
        ...(e.carriesOwnId ? ['id AS eigene_id'] : []),
        ...(e.props || []).map(p => `"${p}" AS "p_${p}"`),
      ].join(', ');
      // Kanten ins Leere ueberspringen: Bei fk-Spalten ist NULL der Normalfall
      // ("kein Lieferant hinterlegt"), keine Stoerung.
      const rows = await sequelize.query(
        `SELECT ${spalten} FROM "${e.table}" `
        + `WHERE "${quelleSpalte}" IS NOT NULL AND "${e.to.column}" IS NOT NULL`,
        { type: QueryTypes.SELECT, transaction: t },
      );
      const propSet = (e.props || []).map(p => `e.${p} = $${p}`).join(', ');
      const muster = e.carriesOwnId
        ? `MERGE (a)-[e:${e.type} {pk: $pk}]->(b)`
        : `MERGE (a)-[e:${e.type}]->(b)`;
      const text = `MERGE (a:${e.from.label} {pk: $from}) MERGE (b:${e.to.label} {pk: $to}) `
        + muster + (propSet ? ` SET ${propSet}` : '');
      for (const r of rows) {
        const params = { from: r.von, to: r.nach };
        if (e.carriesOwnId) params.pk = r.eigene_id;
        for (const p of (e.props || [])) params[p] = normalisieren(r[`p_${p}`]);
        await cypher(text, params, ['r'], { transaction: t });
        edges++;
      }
    }

    // Die Cross-Framework-Kanten. Hier wird zusaetzlich geprueft, ob die
    // Zielanforderung ueberhaupt noch existiert: requirement_id kann wegen der
    // polymorphen Ablage nicht per Fremdschluessel abgesichert werden (siehe
    // models/ControlRequirement.js). Ein verwaister Eintrag wird beim Neuaufbau
    // verworfen statt als Kante ins Nichts uebernommen.
    const re = spec.REQUIREMENT_EDGE;
    for (const q of spec.REQUIREMENT_SOURCES) {
      const rows = await sequelize.query(
        `SELECT cr."${re.from.column}" AS von, cr."${re.to.idColumn}" AS nach`
        + (re.props || []).map(p => `, cr."${p}" AS "p_${p}"`).join('')
        + ` FROM "${re.table}" cr `
        + `JOIN "${q.table}" ziel ON ziel.id = cr."${re.to.idColumn}" `
        + `WHERE cr."${re.to.frameworkColumn}" = $1`,
        { bind: [q.framework], type: QueryTypes.SELECT, transaction: t },
      );
      const propSet = (re.props || []).map(p => `e.${p} = $${p}`).join(', ');
      for (const r of rows) {
        const params = { from: r.von, to: r.nach, fw: q.framework };
        for (const p of (re.props || [])) params[p] = normalisieren(r[`p_${p}`]);
        await cypher(
          `MERGE (a:${re.from.label} {pk: $from}) `
          + `MERGE (b:${re.to.label} {pk: $to, framework: $fw}) `
          + `MERGE (a)-[e:${re.type}]->(b)` + (propSet ? ` SET ${propSet}` : ''),
          params, ['r'], { transaction: t },
        );
        edges++;
      }
    }
  });

  return { nodes, edges };
};

// agtype kennt kein Date und kein undefined. Ohne diese Umwandlung landete ein
// Datum als "{}" im Graphen - also als leeres Objekt, das jede Abfrage darauf
// stillschweigend ins Leere laufen liesse.
const normalisieren = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

module.exports = {
  GRAPH,
  cypher,
  ensureGraph,
  rebuild,
  istVerfuegbar,
  statusText,
  assertLabel,
  labelFuerEntitaet,
  triggerDDL,
};
