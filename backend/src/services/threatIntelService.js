'use strict';

/**
 * Bedrohungslage — Abruf, Abgleich und Faelligkeiten.
 *
 * NIS-2 Art. 21(2)(a) fragt zweiachsig, wie auch der uebliche Self-Check:
 *
 *   Umsetzung — "werden aktuelle Cyberbedrohungen regelmaessig verfolgt und
 *   bewertet?"  Dafuer sorgen das Quellenregister mit Review-Frequenz und, wo
 *   ein Feed existiert, der automatische Abruf.
 *
 *   Nachweis — "werden externe Warnmeldungen systematisch in das interne
 *   Risikomanagement einbezogen?"  Dafuer sorgen die Bewertung jeder Meldung
 *   (wer, wann, mit welchem Ergebnis) und die Verknuepfung in Risiko, Aufgabe
 *   oder Vorfall.
 *
 * Dieser Service haelt beide Achsen zusammen: er holt die Meldungen, ordnet sie
 * dem eigenen Inventar zu und rechnet aus, was faellig ist.
 */

const { Op } = require('sequelize');
const { fetchPublicText } = require('../utils/safeFetch');
const { parseFeed } = require('./threatFeedParser');

// ── Faelligkeiten ────────────────────────────────────────────────────────────

const FREQUENCY_DAYS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
};

const toDateOnly = (d) => d.toISOString().slice(0, 10);

/**
 * Naechster Review-Termin einer Quelle. Gerechnet wird ab dem Tag der
 * Durchsicht, nicht ab dem geplanten Termin: Wer eine woechentliche Quelle drei
 * Wochen liegen laesst, faengt danach wieder bei sieben Tagen an, statt sofort
 * zwei weitere Termine nachgereicht zu bekommen.
 */
const nextReviewDate = (frequency, from = new Date()) => {
  const days = FREQUENCY_DAYS[frequency] ?? FREQUENCY_DAYS.weekly;
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return toDateOnly(next);
};

const isOverdue = (source, today = toDateOnly(new Date())) => {
  if (!source.active) return false;
  // Eine Quelle, die noch nie durchgesehen wurde, ist ueberfaellig — nicht
  // "noch nicht faellig". Genau dieser Fall ist die Luecke, die ein Self-Check
  // findet: Quellen sind eingetragen, angesehen hat sie nie jemand.
  if (!source.last_reviewed_at) return true;
  return !!source.next_review_at && source.next_review_at < today;
};

// ── Abruf ────────────────────────────────────────────────────────────────────

const FEED_TIMEOUT_MS = 20_000;
const FEED_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Holt einen Feed und gibt die geparsten Eintraege zurueck. Wirft mit einer
 * Meldung, die direkt in last_fetch_status passt.
 */
const fetchSourceItems = async (source) => {
  if (!source.feed_url || source.feed_format === 'none') {
    throw new Error('Keine Feed-URL hinterlegt');
  }
  const { text } = await fetchPublicText(source.feed_url, {
    timeoutMs: FEED_TIMEOUT_MS,
    maxBytes: FEED_MAX_BYTES,
    accept: source.feed_format === 'cisa_kev'
      ? 'application/json'
      : 'application/rss+xml, application/atom+xml, application/xml, text/xml',
  });
  return parseFeed(text, source.feed_format);
};

// ── Abgleich mit dem eigenen Inventar ────────────────────────────────────────

const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;

const cveSet = (value) => {
  const found = String(value || '').match(CVE_RE);
  return new Set((found || []).map((c) => c.toUpperCase()));
};

/**
 * Index CVE-Kennung -> Asset-IDs, einmal je Lauf.
 *
 * assets.cve_ids ist JSONB und traegt Objekte ({ id, severity, score, ... }),
 * die der naechtliche CVE-Lauf schreibt. Geladen werden nur Assets, an denen
 * ueberhaupt eine Schwachstelle haengt — bei einem Inventar in vierstelliger
 * Groesse ist der Unterschied zwischen "alle Assets" und "die mit Treffern"
 * der zwischen einem Index und einem Speicherproblem.
 */
const buildAssetCveIndex = async (models) => {
  const { Asset } = models;
  const assets = await Asset.findAll({
    attributes: ['id', 'cve_ids'],
    where: {
      [Op.or]: [
        { cve_critical: { [Op.gt]: 0 } },
        { cve_high: { [Op.gt]: 0 } },
        { cve_medium: { [Op.gt]: 0 } },
        { cve_low: { [Op.gt]: 0 } },
      ],
    },
  });
  const index = new Map();
  for (const asset of assets) {
    const list = Array.isArray(asset.cve_ids) ? asset.cve_ids : [];
    for (const entry of list) {
      const id = String(entry?.id ?? entry ?? '').toUpperCase();
      if (!/^CVE-\d{4}-\d{4,7}$/.test(id)) continue;
      if (!index.has(id)) index.set(id, new Set());
      index.get(id).add(asset.id);
    }
  }
  return index;
};

/**
 * Welche Assets nennt diese Meldung?
 *
 * Der Abgleich laeuft ueber die CVE-Kennungen, die der naechtliche Lauf ohnehin
 * schon an den Assets fuehrt. Das ist der einzige Weg, der ohne Raten auskommt:
 * Ein Namensabgleich ueber "Apache" trifft jeden Webserver im Haus und waere
 * damit kein Hinweis, sondern Rauschen.
 *
 * Das Ergebnis ist ein Vorschlag, keine Feststellung — die Verknuepfung wird mit
 * confirmed: false angelegt und wartet auf einen Menschen.
 */
const matchAssetsInIndex = (index, advisoryCveIds) => {
  const hits = [];
  const seen = new Set();
  for (const cve of cveSet(advisoryCveIds)) {
    for (const assetId of index.get(cve) || []) {
      if (seen.has(assetId)) continue;
      seen.add(assetId);
      hits.push({ asset_id: assetId, cve });
    }
  }
  return hits;
};

/** Einzelabgleich fuer Aufrufer ausserhalb eines Ingest-Laufs. */
const matchAssetsByCve = async (models, advisoryCveIds) => {
  const wanted = cveSet(advisoryCveIds);
  if (!wanted.size) return [];
  return matchAssetsInIndex(await buildAssetCveIndex(models), advisoryCveIds);
};

// ── Aufnahme ins Register ────────────────────────────────────────────────────

/**
 * Traegt die Eintraege eines Feeds ins Register ein und meldet zurueck, was neu
 * war. Doubletten werden ueber (source_id, external_id) erkannt und
 * uebersprungen: Ein erneuter Abruf darf keine zweite Meldung erzeugen und vor
 * allem keine bereits getroffene Bewertung ueberschreiben.
 *
 * @returns {Promise<{created:number, skipped:number, matched:number}>}
 */
const ingestItems = async (models, source, items, { maxAgeDays = 90 } = {}) => {
  const { ThreatAdvisory, ThreatAdvisoryAsset } = models;
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const anyCve = items.some((i) => i.cve_ids);
  const cveIndex = anyCve ? await buildAssetCveIndex(models) : new Map();

  let created = 0;
  let skipped = 0;
  let matched = 0;

  for (const item of items) {
    // Beim ersten Abruf haengt in einem Feed oft ein Jahr Historie. Die gehoert
    // nicht als "neue Warnmeldung" ins Register, sonst steht der Betrieb vor
    // hunderten offenen Bewertungen, die niemand mehr nachholen kann.
    if (item.published_at && item.published_at.getTime() < cutoff) { skipped++; continue; }

    const externalId = item.external_id || null;
    if (externalId) {
      const exists = await ThreatAdvisory.findOne({
        where: { source_id: source.id, external_id: externalId },
        attributes: ['id'],
      });
      if (exists) { skipped++; continue; }
    }

    const advisory = await ThreatAdvisory.create({
      source_id: source.id,
      external_id: externalId,
      title: item.title,
      summary: item.summary,
      url: item.url,
      published_at: item.published_at,
      severity: item.severity,
      cve_ids: item.cve_ids,
      relevance: 'not_assessed',
      status: 'new',
      ingested_via: 'feed',
    });
    created++;

    const hits = matchAssetsInIndex(cveIndex, item.cve_ids);
    for (const hit of hits) {
      await ThreatAdvisoryAsset.findOrCreate({
        where: { advisory_id: advisory.id, asset_id: hit.asset_id },
        defaults: {
          advisory_id: advisory.id,
          asset_id: hit.asset_id,
          match_source: 'cve_match',
          confirmed: false,
          note: `Automatischer Treffer ueber ${hit.cve}`,
        },
      });
      matched++;
    }
  }

  return { created, skipped, matched };
};

/**
 * Ein Abruf inklusive Statusfortschreibung. Wirft nicht: Ein toter Feed darf
 * weder den naechtlichen Lauf noch einen Klick in der Oberflaeche abbrechen.
 * Der Fehler landet in last_fetch_status und wird dort sichtbar.
 */
const refreshSource = async (models, source, opts = {}) => {
  try {
    const items = await fetchSourceItems(source);
    const result = await ingestItems(models, source, items, opts);
    await source.update({
      last_fetch_at: new Date(),
      last_fetch_status: `OK — ${items.length} Eintraege gelesen, ${result.created} neu`.slice(0, 255),
    });
    return { ok: true, ...result, read: items.length };
  } catch (e) {
    await source.update({
      last_fetch_at: new Date(),
      last_fetch_status: `Fehler: ${e.message}`.slice(0, 255),
    });
    return { ok: false, error: e.message, created: 0, skipped: 0, matched: 0, read: 0 };
  }
};

/**
 * Naechtlicher Lauf: alle aktiven Quellen mit eingeschaltetem Abruf.
 */
const refreshAllSources = async (models) => {
  const { ThreatSource } = models;
  const sources = await ThreatSource.findAll({
    where: { active: true, auto_fetch: true, feed_format: { [Op.ne]: 'none' } },
  });
  const summary = { sources: sources.length, created: 0, skipped: 0, matched: 0, failed: 0 };
  for (const source of sources) {
    const r = await refreshSource(models, source);
    if (!r.ok) { summary.failed++; continue; }
    summary.created += r.created;
    summary.skipped += r.skipped;
    summary.matched += r.matched;
  }
  return summary;
};

module.exports = {
  FREQUENCY_DAYS,
  nextReviewDate,
  isOverdue,
  toDateOnly,
  fetchSourceItems,
  matchAssetsByCve,
  matchAssetsInIndex,
  buildAssetCveIndex,
  ingestItems,
  refreshSource,
  refreshAllSources,
};
