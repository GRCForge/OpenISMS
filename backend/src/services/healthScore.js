'use strict';

// Der ISMS-Health-Score - EINE Berechnung, zwei Aufrufer.
//
// WARUM DIESE DATEI EXISTIERT
// Die Kennzahl wurde an zwei Stellen unterschiedlich gerechnet: im
// Managementbericht (routes/report.js) mit den Gewichten 30/25/25/20 ueber
// Massnahmen, Bewertungen, Reviews und Risiken - im MCP-Werkzeug
// (mcp/server.js) mit 40/20/30/10 ueber Massnahmen, Aufgaben, Risiken und
// Reviews. Sogar "offene hohe Risiken" bedeutete Verschiedenes: im Bericht
// kam es aus den CIA-Bewertungen der Assets, im MCP aus dem Risikoregister.
//
// Dieselbe Installation lieferte damit je nach Zugang eine andere Zahl. Fuer
// einen Wert, der in einem Managementbericht landet und Grundlage einer
// Entscheidung sein soll, ist das ein Integritaetsproblem - nicht bloss eine
// Unsauberkeit.
//
// ABWESENHEIT IST KEINE LEISTUNG
// Zwei der vier Anteile messen, dass etwas NICHT da ist: keine ueberfaelligen
// Reviews, keine kritischen Risiken. Beide zahlten die volle Punktzahl, wenn
// es ueberhaupt keine Daten gab - eine blanke Neuinstallation kam so auf
// 45 von 100.
//
// Das ist die gefaehrliche Richtung: Der Wert ueberzeichnet Reife. "Keine
// ueberfaelligen Reviews" ist trivial wahr, solange kein Asset erfasst ist;
// "keine kritischen Risiken" ebenso, solange niemand eins eingetragen hat.
// Nichts erfasst sieht dann aus wie nichts im Argen.
//
// Deshalb verdient ein Abwesenheitsanteil nur Punkte, wenn es einen Bestand
// gibt, in dem etwas schieflaufen KOENNTE. Ohne Bestand traegt er null bei -
// und ein leeres ISMS bekommt ehrliche 0 von 100.

/**
 * @param {object} z Zaehlwerte
 * @param {number} z.totalAssets            Assets ausser ausgemusterten
 * @param {number} z.assessedAssets         Assets mit aktueller CIA-Bewertung
 * @param {number} z.totalControls          Massnahmen gesamt
 * @param {number} z.implementedControls    davon umgesetzt
 * @param {number} z.overdueReviews         ueberfaellige Reviews
 * @param {number} z.criticalRisks          Risiken mit Restrisiko kritisch
 * @param {number} z.highRisks              Risiken mit Restrisiko hoch
 * @param {number} z.totalRisks             Risiken gesamt (erfasst, offen wie geschlossen)
 * @returns {{score:number, parts:object}} Punktzahl 0-100 und die Einzelanteile
 */
const berechne = (z) => {
  const anteil = (zaehler, nenner) => (nenner > 0 ? zaehler / nenner : 0);

  // --- Leistungsanteile: messen, was getan wurde ------------------------
  const massnahmen = anteil(z.implementedControls, z.totalControls);   // 0..1
  const bewertungen = anteil(z.assessedAssets, z.totalAssets);         // 0..1

  // --- Abwesenheitsanteile: zaehlen nur mit Bestand ---------------------
  // Der Nenner ist der Bestand selbst. Ist er null, gibt es nichts zu
  // beurteilen, und der Anteil ist null - nicht voll.
  const reviews = z.totalAssets > 0
    ? Math.max(0, 1 - anteil(z.overdueReviews, z.totalAssets))
    : 0;

  // Risiken werden gewichtet: ein kritisches wiegt schwerer als ein hohes.
  // Die Faktoren stammen aus der bisherigen Berechnung im Bericht und sind
  // bewusst unveraendert - hier ging es um das Nullverhalten, nicht um eine
  // neue Bewertungslehre.
  const risiken = z.totalRisks > 0
    ? Math.max(0, 1 - (z.criticalRisks * 0.1 + z.highRisks * 0.03))
    : 0;

  const parts = {
    control_implementation: Math.round(massnahmen * 30),
    asset_assessment: Math.round(bewertungen * 25),
    review_currency: Math.round(reviews * 25),
    risk_exposure: Math.round(risiken * 20),
  };

  return {
    score: Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0)),
    parts,
    // Woran die Kennzahl ueberhaupt etwas messen konnte. Ohne diese Angabe
    // liesse sich eine 0 nicht von "alles schlecht" unterscheiden - und genau
    // diese Verwechslung war der Anlass fuer diese Datei.
    basis: {
      assets: z.totalAssets,
      controls: z.totalControls,
      risks: z.totalRisks,
    },
  };
};

module.exports = { berechne };
