'use strict';

/**
 * Anwendbarkeit der NIS-2-Kriterien nach Betroffenheitsprofil.
 *
 * NIS-2 trifft nicht alle gleich:
 *
 *   essential  Wesentliche Einrichtung (Anhang I) — voller Katalog, volle
 *              Aufsicht, Meldepflichten nach Art. 23.
 *   important  Wichtige Einrichtung (Anhang II) — dieselben Pflichten aus
 *              Art. 21 und 23, nur nachgelagerte Aufsicht.
 *   indirect   Selbst nicht im Anwendungsbereich, aber Lieferant oder
 *              Dienstleister einer betroffenen Einrichtung. Gegenueber der
 *              Behoerde besteht keine Pflicht; die Anforderungen kommen ueber
 *              Art. 21(2)(d) vertraglich vom Auftraggeber — und nur ein Teil
 *              davon.
 *   unknown    Noch nicht eingestuft.
 *
 * 'unknown' rechnet wie 'essential'. Das ist die sichere Richtung: Wer seine
 * Einstufung noch nicht kennt, soll den vollen Katalog sehen und nicht eine
 * beruhigende Quote, die auf einer Annahme beruht, die niemand getroffen hat.
 */

const PROFILES = ['essential', 'important', 'indirect', 'unknown'];
const OBLIGATIONS = ['required', 'recommended', 'not_applicable'];

const DEFAULT_APPLICABILITY = Object.freeze({
  essential: 'required',
  important: 'required',
  indirect: 'recommended',
});

/** Fremde oder unvollstaendige Eingaben auf die drei bekannten Schluessel bringen. */
const normaliseApplicability = (value) => {
  const source = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const out = {};
  for (const profile of ['essential', 'important', 'indirect']) {
    out[profile] = OBLIGATIONS.includes(source[profile]) ? source[profile] : DEFAULT_APPLICABILITY[profile];
  }
  return out;
};

/** Was schuldet dieses Profil bei diesem Kriterium? */
const obligationFor = (applicability, entityType) => {
  const map = normaliseApplicability(applicability);
  const key = entityType === 'unknown' || !PROFILES.includes(entityType) ? 'essential' : entityType;
  return map[key];
};

/**
 * Erfuellungsquote und Reifegrad ueber die anwendbaren Kriterien.
 *
 * Gezaehlt wird, was das Profil schuldet — 'required' voll, 'recommended'
 * ebenfalls (eine Empfehlung, die man umsetzt, zaehlt; eine, die man laesst,
 * faellt unter 'open'), 'not_applicable' gar nicht. Ein Kriterium, das jemand
 * von Hand auf implementation_status 'not_applicable' gesetzt hat, faellt
 * ebenfalls heraus: Die Entscheidung eines Menschen ueber den eigenen Betrieb
 * sticht die Voreinstellung des Katalogs.
 *
 * Der Reifegrad bildet die uebliche fuenfstufige Skala ab, damit sich das
 * Ergebnis gegen einen externen Self-Check halten laesst.
 */
// Reifegrad und Status kommen aus dem einstellbaren Bewertungsmodell — eine
// Skala fuer das ganze NIS-2-Modul, Kriterienkatalog wie Fragebogen. Zwei
// Skalen in einem Modul waeren eine Falle fuer jeden, der die Zahlen
// nebeneinander liest.
const { DEFAULT_SCORING, maturityFromRate, statusLabel } = require('./nis2ScoringModel');

const summarise = (measures, entityType, model = DEFAULT_SCORING) => {
  const rows = (measures || []).map((m) => (m.toJSON ? m.toJSON() : m));

  const applicable = [];
  let excludedByProfile = 0;
  let excludedManually = 0;

  for (const m of rows) {
    if (obligationFor(m.applicability, entityType) === 'not_applicable') { excludedByProfile++; continue; }
    if (m.implementation_status === 'not_applicable') { excludedManually++; continue; }
    applicable.push(m);
  }

  const implemented = applicable.filter((m) => m.implementation_status === 'implemented').length;
  const inProgress = applicable.filter((m) => m.implementation_status === 'in_progress').length;
  const open = applicable.filter((m) => m.implementation_status === 'not_started').length;

  // Angefangenes zaehlt anteilig. Es als "nicht erfuellt" zu fuehren macht jede
  // Zwischenmessung wertlos, es voll zu zaehlen waere geschoent. Der Anteil ist
  // derselbe Parameter, der im Fragebogen ueber "teilweise" entscheidet — sonst
  // haetten Katalog und Fragebogen zwei Begriffe von "halb fertig".
  const partly = model.partly_value;
  const score = applicable.length ? (implemented + inProgress * partly) / applicable.length : 0;

  const byCategory = {};
  for (const m of applicable) {
    const key = m.category || 'Ohne Kategorie';
    byCategory[key] ??= { total: 0, implemented: 0, in_progress: 0, open: 0 };
    byCategory[key].total++;
    if (m.implementation_status === 'implemented') byCategory[key].implemented++;
    else if (m.implementation_status === 'in_progress') byCategory[key].in_progress++;
    else byCategory[key].open++;
  }
  for (const entry of Object.values(byCategory)) {
    const rate = entry.total ? (entry.implemented + entry.in_progress * partly) / entry.total : 0;
    entry.rate = Math.round(rate * 100);
    entry.maturity = maturityFromRate(rate, model);
    entry.status = statusLabel(rate, model);
  }

  return {
    total: rows.length,
    applicable: applicable.length,
    excluded_by_profile: excludedByProfile,
    excluded_manually: excludedManually,
    required: applicable.filter((m) => obligationFor(m.applicability, entityType) === 'required').length,
    recommended: applicable.filter((m) => obligationFor(m.applicability, entityType) === 'recommended').length,
    implemented,
    in_progress: inProgress,
    open,
    rate: Math.round(score * 100),
    maturity: maturityFromRate(score, model),
    status: statusLabel(score, model),
    by_category: byCategory,
  };
};

module.exports = {
  PROFILES, OBLIGATIONS, DEFAULT_APPLICABILITY,
  normaliseApplicability, obligationFor, summarise, maturityFromRate, statusLabel,
};
