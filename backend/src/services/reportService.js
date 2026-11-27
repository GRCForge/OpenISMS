'use strict';

/**
 * Report documents (3.10.0): risk report, risk treatment plan (ISO/IEC
 * 27001:2022 6.1.3 e) and the BSI reference documents A.1 - A.6 of an
 * information domain (BSI-Standard 200-2 / 200-3).
 *
 * Each builder reads through the same service functions as the respective
 * list in the UI and the API - and therefore with the same visibility rules
 * for the calling user - and returns the plain document model rendered by
 * services/reportRender.js. Nothing is made up: a part without data says so
 * ("Keine Daten") instead of being left out or filled.
 */

const rm = require('./riskMethodology');

const models = () => require('../models');

const REPORTS = Object.freeze({
  risk_report: { title: 'Risikobericht', scope: 'risks', file: 'risikobericht' },
  treatment_plan: { title: 'Risikobehandlungsplan (ISO/IEC 27001:2022, 6.1.3 e)', scope: 'risks', file: 'risikobehandlungsplan' },
});
const BSI_DOCS = Object.freeze({
  a1: { code: 'A.1', title: 'Strukturanalyse' },
  a2: { code: 'A.2', title: 'Schutzbedarfsfeststellung' },
  a3: { code: 'A.3', title: 'Modellierung' },
  a4: { code: 'A.4', title: 'IT-Grundschutz-Check' },
  a5: { code: 'A.5', title: 'Risikoanalyse' },
  a6: { code: 'A.6', title: 'Realisierungsplan' },
});
const BSI_DOC_KEYS = Object.freeze([...Object.keys(BSI_DOCS), 'all']);

const NO_DATA = 'Keine Daten erfasst.';
const TREATMENT_LABELS = Object.freeze({ mitigate: 'Reduzieren', accept: 'Akzeptieren', transfer: 'Übertragen', avoid: 'Vermeiden' });
const RISK_STATUS_LABELS = Object.freeze({ open: 'offen', in_treatment: 'in Behandlung', accepted: 'akzeptiert', closed: 'geschlossen' });
const ITEM_STATUS_LABELS = Object.freeze({ planned: 'geplant', in_progress: 'in Umsetzung', implemented: 'umgesetzt', discarded: 'verworfen' });
const TARGET_LABELS = Object.freeze({
  business_process: 'Geschäftsprozess', application: 'Anwendung', it_system: 'IT-System', ics: 'ICS-System',
  room: 'Raum', building: 'Gebäude', network: 'Netz/Kommunikationsverbindung',
});
const APPROACH_LABELS = Object.freeze({ basis: 'Basis-Absicherung', standard: 'Standard-Absicherung', kern: 'Kern-Absicherung' });
const PROTECTION_LABELS = Object.freeze({ normal: 'normal', high: 'hoch', very_high: 'sehr hoch' });
const COVERAGE_LABELS = Object.freeze({ unknown: 'nicht bewertet', covered: 'abgedeckt', partially: 'teilweise abgedeckt', not_covered: 'nicht abgedeckt' });
const REASON_LABELS = Object.freeze({
  high_protection_need: 'hoher oder sehr hoher Schutzbedarf',
  no_module: 'kein passender Baustein modelliert',
  scenario_not_covered: 'Einsatzszenario nicht abgedeckt',
});
const LEVEL_SHORT = Object.freeze({ basis: 'B', standard: 'S', erhoehter_schutzbedarf: 'H', normal_sdt: 'normal-SdT', erhoeht: 'erhöht' });

const day = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : '');
const eur = (v) => (v == null || v === '' ? '' : `${Number(v).toFixed(2)} EUR`);

async function header() {
  const { getGeneral } = require('./settingsService');
  const g = await getGeneral().catch(() => ({}));
  const org = typeof g.organizationName === 'string' && g.organizationName.trim() ? g.organizationName.trim() : null;
  return { app_name: typeof g.appName === 'string' && g.appName.trim() ? g.appName.trim() : 'OpenISMS', organization: org };
}

async function base(title, actor, extra = {}) {
  return { ...(await header()), title, generated_at: new Date().toISOString(), generated_by: actor?.name || null, sections: [], ...extra };
}

// ── Risk helpers ────────────────────────────────────────────────────────────

function levelLabeller(scale) {
  const by = new Map((scale.risk_levels || []).map(l => [l.key, l]));
  return (k) => (k ? (by.get(k)?.label_de || k) : '–');
}

/**
 * Heat map on the active scale: counts per likelihood x impact cell.
 * pickCell(risk) -> { likelihood, impact } or null.
 */
function heatmap(scale, risks, pickCell, title) {
  const colorOf = new Map((scale.risk_levels || []).map(l => [l.key, l.color]));
  const L = scale.likelihood_size;
  const I = scale.impact_size;
  const counts = new Map();
  let counted = 0;
  for (const r of risks) {
    const c = pickCell(r);
    if (!c || !Number.isInteger(c.likelihood) || !Number.isInteger(c.impact) || c.likelihood > L || c.impact > I || c.likelihood < 1 || c.impact < 1) continue;
    const k = `${c.likelihood}x${c.impact}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    counted++;
  }
  const cells = scale.matrix.map(row => row.map(c => ({ count: counts.get(`${c.likelihood}x${c.impact}`) || 0, color: colorOf.get(c.level) })));
  return {
    block: {
      type: 'heatmap', title: `${title} (${counted} Risiken)`,
      x_label: 'Auswirkung', y_label: 'Wahrscheinlichkeit',
      x_labels: scale.impact_levels.map(l => `${l.value} ${l.label_de}`),
      y_labels: [...scale.likelihood_levels].sort((a, b) => b.value - a.value).map(l => `${l.value} ${l.label_de}`),
      cells,
    },
    counted,
  };
}

const score = (r) => {
  const l = r.residual_likelihood ?? r.likelihood;
  const i = r.residual_impact ?? r.impact;
  return Number(l || 0) * Number(i || 0);
};

// ── Risk report ─────────────────────────────────────────────────────────────

async function buildRiskReport(actor) {
  const { Risk } = models();
  const riskService = require('./riskService');
  const monitoring = require('./riskMonitoringService');
  const history = require('./riskHistoryService');
  const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
  const scale = rm.scaleInfo(active);
  const lvl = levelLabeller(scale);
  const doc = await base('Risikobericht', actor, { subtitle: 'Risikoregister nach ISO/IEC 27005:2022 und BSI-Standard 200-3' });

  // Methodology
  const m = [];
  m.push({ type: 'kv', rows: [
    ['Risikomethodik', scale.name],
    ['Version', scale.version == null ? 'Standardprofil' : String(scale.version)],
    ['Aktiv seit', day(scale.activated_at) || '–'],
    ['Matrix', `${scale.likelihood_size} × ${scale.impact_size}`],
    ['Risikoappetit (Standard)', scale.appetite?.default_max_level ? `bis ${lvl(scale.appetite.default_max_level)}` : 'nicht festgelegt'],
  ] });
  m.push({ type: 'h', text: 'Wahrscheinlichkeit' });
  m.push({ type: 'table', columns: ['Stufe', 'Bezeichnung', 'Beschreibung'], rows: scale.likelihood_levels.map(l => [l.value, l.label_de, l.description || '']) });
  m.push({ type: 'h', text: 'Auswirkung' });
  m.push({ type: 'table', columns: ['Stufe', 'Bezeichnung', 'Beschreibung'], rows: scale.impact_levels.map(l => [l.value, l.label_de, l.description || '']) });
  m.push({ type: 'h', text: 'Risikostufen' });
  m.push({ type: 'table', columns: ['Stufe', 'Punktwert (W × A)', 'Prüfzyklus (Monate)'], rows: scale.risk_levels.map(l => [l.label_de, `${l.min_score}–${l.max_score}`, (scale.review_cycles || []).find(c => c.level === l.key)?.months ?? '–']) });
  if ((scale.appetite?.categories || []).length) {
    m.push({ type: 'h', text: 'Risikoappetit je Kategorie' });
    m.push({ type: 'table', columns: ['Kategorie', 'Höchste tolerierte Stufe'], rows: scale.appetite.categories.map(c => [c.category, lvl(c.max_level)]) });
  }
  m.push({ type: 'h', text: 'Akzeptanzbefugnis' });
  m.push({ type: 'table', columns: ['Stufe', 'Rollen', 'Höchstdauer (Monate)'], rows: (scale.acceptance || []).map(a => [lvl(a.level), (a.roles || []).join(', '), a.max_months ?? 'unbegrenzt']) });
  doc.sections.push({ heading: '1. Methodik', blocks: m });

  const rows = await Risk.findAll({ include: riskService.includeAll(), order: [['id', 'ASC']] });
  const risks = await riskService.decorate(rows);
  const live = risks.filter(r => r.status !== 'closed');

  // Overview
  const byLevel = scale.risk_levels.map(l => [`Stufe ${l.label_de} (maßgeblich: netto vor brutto)`, String(live.filter(r => r.effective_level === l.key).length)]);
  doc.sections.push({ heading: '2. Überblick', blocks: risks.length ? [{ type: 'kv', rows: [
    ['Risiken gesamt', String(risks.length)],
    ...Object.entries(RISK_STATUS_LABELS).map(([k, v]) => [`Status ${v}`, String(risks.filter(r => r.status === k).length)]),
    ...byLevel,
    ['Über dem Risikoappetit', String(live.filter(r => r.appetite_exceeded).length)],
    ['Nach älterer Methodik-Version bewertet', String(risks.filter(r => r.needs_reassessment).length)],
  ] }] : [{ type: 'nodata', text: 'Keine Risiken im Register.' }] });

  // Heat maps on the active scale; risks assessed under another version are
  // not placed (their values belong to a different scale).
  const onScale = live.filter(r => !r.needs_reassessment);
  const hm = [];
  if (!onScale.length) hm.push({ type: 'nodata', text: 'Keine offenen Risiken nach der aktiven Methodik bewertet.' });
  else {
    hm.push(heatmap(scale, onScale, r => ({ likelihood: r.likelihood, impact: r.impact }), 'Brutto-Risiko').block);
    hm.push(heatmap(scale, onScale, r => (r.residual_likelihood != null && r.residual_impact != null ? { likelihood: r.residual_likelihood, impact: r.residual_impact } : null), 'Netto-Risiko').block);
    const target = heatmap(scale, onScale, r => (r.target_likelihood != null && r.target_impact != null ? { likelihood: r.target_likelihood, impact: r.target_impact } : null), 'Ziel-Risiko');
    hm.push(target.block);
    if (target.counted < onScale.length) hm.push({ type: 'note', text: `${onScale.length - target.counted} Risiko/Risiken ohne festgelegtes Ziel-Risiko.` });
  }
  hm.push({ type: 'note', text: `Geschlossene Risiken sind nicht enthalten.${live.length - onScale.length ? ` ${live.length - onScale.length} Risiko/Risiken nach einer älteren Methodik-Version bewertet und nicht eingetragen.` : ''}` });
  doc.sections.push({ heading: '3. Heatmaps (Brutto, Netto, Ziel)', blocks: hm });

  // Top risks
  const top = [...live].sort((a, b) => rm.rank(b.effective_level) - rm.rank(a.effective_level) || score(b) - score(a)).slice(0, 10);
  doc.sections.push({ heading: '4. Top-Risiken', blocks: [{ type: 'table', empty: 'Keine offenen Risiken.', columns: ['Ref.', 'Risiko', 'Kategorie', 'Owner', 'Brutto', 'Netto', 'Ziel', 'Status', 'Behandlung'],
    rows: top.map(r => [r.ref, r.title, r.category || '', r.owner?.name || '', lvl(r.inherent_level), lvl(r.residual_level), lvl(r.target_level), RISK_STATUS_LABELS[r.status] || r.status, TREATMENT_LABELS[r.treatment] || r.treatment]) }] });

  // Appetite
  const over = live.filter(r => r.appetite_exceeded);
  doc.sections.push({ heading: '5. Überschreitungen des Risikoappetits', blocks: [{ type: 'table', empty: 'Keine Überschreitungen.', columns: ['Ref.', 'Risiko', 'Kategorie', 'Maßgebliche Stufe', 'Appetit bis', 'Owner', 'Status'],
    rows: over.map(r => [r.ref, r.title, r.category || '', lvl(r.effective_level), lvl(r.appetite_max_level), r.owner?.name || '', RISK_STATUS_LABELS[r.status] || r.status]) }] });

  // Trend (90 days)
  const to = new Date().toISOString().slice(0, 10);
  const fromD = new Date(); fromD.setUTCDate(fromD.getUTCDate() - 90);
  const from = fromD.toISOString().slice(0, 10);
  const trend = await history.trendHeatmap({ from, to, basis: 'residual' });
  const t = trend.summary;
  doc.sections.push({ heading: '6. Trend (letzte 90 Tage, Netto-Risiko)', blocks: t.compared + t.new_since ? [
    { type: 'kv', rows: [['Zeitraum', `${from} bis ${to}`], ['Verglichen', String(t.compared)], ['Verbessert', String(t.improved)], ['Verschlechtert', String(t.worsened)], ['Unverändert', String(t.unchanged)], ['Neu im Zeitraum', String(t.new_since)]] },
    { type: 'table', columns: ['Von Stufe', 'Nach Stufe', 'Anzahl'], rows: trend.level_transitions.filter(x => x.from_level !== x.to_level).map(x => [lvl(x.from_level), lvl(x.to_level), x.count]), empty: 'Keine Stufenwechsel im Zeitraum.' },
  ] : [{ type: 'nodata', text: 'Keine Bewertungshistorie im Zeitraum.' }] });

  // Open reassessments
  const flags = await monitoring.listFlags(actor, { status: 'open' });
  const methodology = risks.filter(r => r.needs_reassessment);
  const overdue = live.filter(r => r.review_overdue);
  doc.sections.push({ heading: '7. Offene Neubewertungen', blocks: [
    { type: 'h', text: 'Neubewertungsanlässe' },
    { type: 'table', empty: 'Keine offenen Neubewertungsanlässe.', columns: ['Ref.', 'Risiko', 'Anlass', 'Seit', 'Owner'],
      rows: flags.map(f => [f.risk?.ref, f.risk?.title, monitoring.TYPE_LABEL[f.trigger_type] || f.trigger_type, day(f.created_at), f.risk?.owner?.name || '']) },
    { type: 'note', text: 'Neubewertungsanlässe zeigen die Risiken, die der Ersteller des Berichts im Detail sehen darf (admin, assessor, management: alle; sonst eigene).' },
    { type: 'h', text: 'Periodische Prüfung überfällig' },
    { type: 'table', empty: 'Keine überfälligen Prüfungen.', columns: ['Ref.', 'Risiko', 'Fällig seit', 'Owner'], rows: overdue.map(r => [r.ref, r.title, day(r.next_review_due), r.owner?.name || '']) },
    { type: 'h', text: 'Nach älterer Methodik-Version bewertet' },
    { type: 'table', empty: 'Keine.', columns: ['Ref.', 'Risiko', 'Methodik-Version', 'Owner'], rows: methodology.map(r => [r.ref, r.title, r.methodology_version ?? '–', r.owner?.name || '']) },
  ] });

  // Acceptances
  const accepted = risks.filter(r => r.status === 'accepted');
  doc.sections.push({ heading: '8. Akzeptierte Risiken', blocks: [{ type: 'table', empty: 'Keine akzeptierten Risiken.', columns: ['Ref.', 'Risiko', 'Stufe', 'Akzeptiert von', 'Am', 'Gültig bis', 'Hinweis'],
    rows: accepted.map(r => [r.ref, r.title, lvl(r.effective_level), r.acceptedBy?.name || '', day(r.accepted_at), day(r.accepted_until) || 'unbefristet',
      r.acceptance_expired ? 'abgelaufen' : r.acceptance_expiring ? `läuft in ${r.acceptance_days_left} Tagen ab` : '']) }] });
  return doc;
}

// ── Treatment plan ──────────────────────────────────────────────────────────

async function buildTreatmentPlanReport(actor) {
  const riskService = require('./riskService');
  const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
  const lvl = levelLabeller(rm.scaleInfo(active));
  const plan = await riskService.treatmentPlan(actor, {});
  const doc = await base('Risikobehandlungsplan', actor, { subtitle: 'ISO/IEC 27001:2022, Abschnitt 6.1.3 e', landscape: true });
  const s = plan.summary;
  doc.sections.push({ heading: '1. Grundlage und Zusammenfassung', blocks: [
    { type: 'p', text: 'Der Risikobehandlungsplan legt je Risiko die gewählten Behandlungsoptionen und Maßnahmen mit Verantwortlichen, Terminen und Kosten fest (ISO/IEC 27001:2022, 6.1.3 e; ISO/IEC 27005:2022, Abschnitt 9).' },
    { type: 'kv', rows: [
      ['Maßnahmen', String(s.items)], ['Risiken mit Maßnahmen', String(s.risks)], ['geplant', String(s.planned)], ['in Umsetzung', String(s.in_progress)],
      ['umgesetzt', String(s.implemented)], ['verworfen', String(s.discarded)], ['überfällig', String(s.overdue)],
      ['Kosten einmalig (ohne verworfene)', eur(s.cost_once_total)], ['Kosten laufend pro Jahr (ohne verworfene)', eur(s.cost_recurring_total)],
      ['Offene Risiken ohne aktive Maßnahme', String(s.risks_without_plan)],
    ] },
    { type: 'note', text: 'Enthalten sind die Maßnahmen, die der Ersteller des Berichts sehen darf (admin, assessor, management: alle; sonst eigene Risiken und Maßnahmen in eigener Verantwortung).' },
  ] });
  doc.sections.push({ heading: '2. Maßnahmen', blocks: [{ type: 'table', empty: 'Keine Maßnahmen erfasst.',
    columns: ['Ref.', 'Risiko', 'Stufe', 'Maßnahme', 'Option', 'Verantwortlich', 'Termin', 'Status', 'Kosten einmalig', 'Kosten laufend', 'Überfällig'],
    rows: plan.items.map(i => [i.risk.ref, i.risk.title, lvl(i.risk.effective_level), i.title, TREATMENT_LABELS[i.treatment_option] || i.treatment_option,
      i.responsibleUser?.name || i.responsibleGroup?.name || '', day(i.due_date), ITEM_STATUS_LABELS[i.status] || i.status, eur(i.cost_once), eur(i.cost_recurring), i.overdue ? 'ja' : '']) }] });
  doc.sections.push({ heading: '3. Offene Risiken ohne aktive Maßnahme', blocks: [{ type: 'table', empty: 'Keine.',
    columns: ['Ref.', 'Risiko', 'Stufe', 'Über Appetit', 'Owner', 'Behandlung'],
    rows: plan.risks_without_plan.map(r => [r.ref, r.title, lvl(r.effective_level), r.appetite_exceeded ? 'ja' : '', r.owner?.name || '', TREATMENT_LABELS[r.treatment] || r.treatment]) }] });
  return doc;
}

// ── BSI reference documents A.1 - A.6 ───────────────────────────────────────

const domainsSvc = () => require('./bsiDomainService');
const checkSvc = () => require('./bsiCheckService');
const analysisSvc = () => require('./bsiRiskAnalysisService');

async function sectionA1(domain, actor) {
  const { Asset, User } = models();
  const targets = await domainsSvc().listTargetObjects(domain.id, actor);
  const blocks = [{ type: 'kv', rows: [
    ['Informationsverbund', domain.name],
    ['Beschreibung', domain.description || '–'],
    ['Geltungsbereich', domain.scope || '–'],
    ['Absicherungsvariante', APPROACH_LABELS[domain.protection_approach] || domain.protection_approach],
    ['Katalog', domain.catalog ? `${domain.catalog.name}${domain.catalog.edition ? ` (${domain.catalog.edition})` : ''}` : '–'],
  ] }];
  if (!targets.length) { blocks.push({ type: 'nodata', text: 'Keine Zielobjekte erfasst.' }); return blocks; }
  const assets = await Asset.findAll({ where: { id: targets.map(t => t.asset_id) }, attributes: ['id', 'description', 'location', 'owner_id', 'parent_id'], include: [{ model: User, as: 'owner', attributes: ['id', 'name'] }] });
  const aBy = new Map(assets.map(a => [a.id, a]));
  const nameBy = new Map(targets.map(t => [t.asset_id, t.asset.name]));
  const sorted = [...targets].sort((a, b) => Object.keys(TARGET_LABELS).indexOf(a.target_type) - Object.keys(TARGET_LABELS).indexOf(b.target_type) || a.asset.name.localeCompare(b.asset.name));
  blocks.push({ type: 'table', columns: ['Zielobjekttyp', 'Zielobjekt', 'Asset-Typ', 'Beschreibung', 'Standort', 'Verantwortlich', 'Übergeordnet', 'Status'],
    rows: sorted.map(t => {
      const a = aBy.get(t.asset_id);
      return [TARGET_LABELS[t.target_type] || t.target_type, t.asset.name, t.asset.type, a?.description || '', a?.location || '', a?.owner?.name || '',
        a?.parent_id ? (nameBy.get(a.parent_id) || `Asset #${a.parent_id} (nicht im Verbund)`) : '', t.asset.status || ''];
    }) });
  blocks.push({ type: 'note', text: 'Zielobjekte sind Assets aus dem Assetregister. Enthalten sind die Zielobjekte, deren Asset der Ersteller des Berichts sehen darf.' });
  return blocks;
}

async function sectionA2(domain, actor) {
  const targets = await domainsSvc().listTargetObjects(domain.id, actor);
  if (!targets.length) return [{ type: 'nodata', text: 'Keine Zielobjekte erfasst.' }];
  const assessments = await analysisSvc().currentAssessments(targets.map(t => t.asset_id));
  const p = (need, k) => (need ? `${PROTECTION_LABELS[need[k]] || '–'} (${need.values[k] ?? '–'})` : 'keine Daten');
  const rows = targets.map(t => {
    const need = analysisSvc().protectionNeed(assessments.get(t.asset_id) || null);
    return [TARGET_LABELS[t.target_type] || t.target_type, t.asset.name, p(need, 'confidentiality'), p(need, 'integrity'), p(need, 'availability'),
      need ? (PROTECTION_LABELS[need.overall] || '–') : 'keine Daten', need ? day(need.assessed_at) : '', need?.notes || ''];
  });
  const missing = rows.filter(r => r[5] === 'keine Daten').length;
  const blocks = [{ type: 'table', columns: ['Zielobjekttyp', 'Zielobjekt', 'Vertraulichkeit', 'Integrität', 'Verfügbarkeit', 'Schutzbedarf gesamt', 'Bewertet am', 'Begründung'], rows }];
  if (missing) blocks.push({ type: 'nodata', text: `Für ${missing} Zielobjekt(e) liegt keine Schutzbedarfsbewertung (Assetbewertung) vor.` });
  blocks.push({ type: 'note', text: 'Grundlage ist die aktuelle Assetbewertung (Skala 1–5). Zuordnung zu den Schutzbedarfskategorien nach BSI-Standard 200-2: 1–3 normal, 4 hoch, 5 sehr hoch; Gesamtschutzbedarf nach dem Maximumprinzip. Vererbung über Abhängigkeiten wird nicht berechnet.' });
  return blocks;
}

async function sectionA3(domain, actor) {
  const rows = await domainsSvc().listModeling(domain.id, actor);
  if (!rows.length) return [{ type: 'nodata', text: 'Keine Modellierung erfasst.' }];
  const sorted = [...rows].sort((a, b) => String(a.target_object?.asset?.name || '').localeCompare(String(b.target_object?.asset?.name || '')) || a.module_id.localeCompare(b.module_id));
  return [
    { type: 'table', columns: ['Zielobjekt', 'Zielobjekttyp', 'Baustein', 'Titel', 'Schicht', 'Im aktiven Katalog', 'Bemerkung'],
      rows: sorted.map(r => [r.target_object ? r.target_object.asset?.name : `Informationsverbund: ${domain.name}`,
        r.target_object ? (TARGET_LABELS[r.target_object.target_type] || r.target_object.target_type) : 'Informationsverbund',
        r.module_id, r.module?.title || '', r.module?.layer || '', r.in_active_catalog ? 'ja' : 'nein', r.notes || '']) },
  ];
}

async function sectionA4(domain, actor) {
  const check = await checkSvc().getCheck(domain.id, actor);
  if (!check.entries.length) return [{ type: 'nodata', text: 'Keine modellierten Anforderungen – der IT-Grundschutz-Check enthält keine Daten.' }];
  const sum = checkSvc().summarize(check.entries);
  const pct = (v) => (v == null ? '–' : `${v} %`);
  const labels = checkSvc().CHECK_LABELS;
  const blocks = [
    { type: 'h', text: 'Auswertung je Zielobjekt' },
    { type: 'table', columns: ['Zielobjekt', 'Anforderungen', 'ja', 'teilweise', 'nein', 'entbehrlich', 'offen', 'Erfüllungsgrad'],
      rows: [...sum.by_target.map(b => [b.target_object_id == null ? `Informationsverbund: ${domain.name}` : b.target_name, b.total, b.implemented, b.in_progress, b.not_implemented, b.not_applicable, b.not_started, pct(b.fulfillment)]),
        ['Gesamt', sum.total.total, sum.total.implemented, sum.total.in_progress, sum.total.not_implemented, sum.total.not_applicable, sum.total.not_started, pct(sum.total.fulfillment)]] },
    { type: 'note', text: 'Erfüllungsgrad = (ja + 0,5 × teilweise) / (alle − entbehrlich).' },
    { type: 'h', text: 'Anforderungen' },
    { type: 'table', columns: ['Zielobjekt', 'Anforderung', 'Titel', 'Stufe', 'Umsetzung', 'Begründung', 'Verantwortlich', 'Umsetzung bis', 'Kosten einmalig', 'Kosten laufend'],
      rows: check.entries.map(e => [e.target_object_id == null ? 'Informationsverbund' : e.target_name, e.req_id, e.title, LEVEL_SHORT[e.requirement_level] || '', labels[e.implementation_status],
        e.justification || '', [e.responsible?.name, e.responsible_group?.name].filter(Boolean).join(' / '), day(e.due_date), eur(e.cost_once), eur(e.cost_recurring)]) },
  ];
  const add = check.additional_requirements || [];
  blocks.push({ type: 'h', text: 'Zusätzliche Anforderungen aus der Risikoanalyse' });
  blocks.push({ type: 'table', empty: 'Keine zusätzlichen Maßnahmen aus der Risikoanalyse.', columns: ['Zielobjekt', 'Risiko', 'Maßnahme', 'Status', 'Verantwortlich', 'Termin'],
    rows: add.flatMap(t => t.measures.map(m => [t.target_name, m.risk_ref, m.title, ITEM_STATUS_LABELS[m.status] || m.status, m.responsible?.name || m.responsible_group?.name || '', day(m.due_date)])) });
  return blocks;
}

async function sectionA5(domain, actor) {
  const svc = analysisSvc();
  const overview = await svc.getAnalysis(domain.id, actor);
  const blocks = [];
  if (!overview.targets.length) return [{ type: 'nodata', text: 'Keine Zielobjekte erfasst.' }];
  blocks.push({ type: 'h', text: 'Auswahl der Zielobjekte (BSI-Standard 200-3, Kapitel 3)' });
  blocks.push({ type: 'table', columns: ['Zielobjekt', 'Schutzbedarf', 'Gründe', 'Entscheidung', 'Begründung', 'Risikoanalyse', 'Stand'],
    rows: overview.targets.map(t => [t.asset.name, t.protection_need ? (PROTECTION_LABELS[t.protection_need.overall] || '–') : 'keine Daten',
      t.reasons.map(r => REASON_LABELS[r] || r).join('; ') || '–',
      t.decision === 'auto' ? 'automatisch' : t.decision === 'include' ? 'manuell hinzugefügt' : 'manuell entfernt',
      [t.decision_reason, t.scenario_note].filter(Boolean).join(' | '), t.included ? 'erforderlich' : 'nicht erforderlich',
      t.status === 'completed' ? `abgeschlossen ${day(t.completed_at)}` : t.status === 'in_progress' ? 'in Bearbeitung' : 'offen']) });
  blocks.push({ type: 'note', text: 'Die importierten Kataloge enthalten keine Zuordnung der elementaren Gefährdungen zu Bausteinen; die Abdeckung durch die modellierten Bausteine ist manuell bewertet.' });
  const included = overview.targets.filter(t => t.included);
  if (!included.length) { blocks.push({ type: 'nodata', text: 'Kein Zielobjekt für die Risikoanalyse ausgewählt.' }); return blocks; }
  const active = (await rm.getActiveProfile()) || rm.DEFAULT_PROFILE;
  const lvl = levelLabeller(rm.scaleInfo(active));
  for (const t of included) {
    const a = await svc.getTargetAnalysis(domain.id, t.target_object_id, actor);
    blocks.push({ type: 'h', text: `Gefährdungsübersicht und Risikobewertung: ${t.asset.name}` });
    const shown = a.threats.filter(x => x.relevant === true || x.has_risk);
    const notRelevant = a.threats.filter(x => x.relevant === false).length;
    const open = a.threats.filter(x => x.relevant === null).length;
    blocks.push({ type: 'table', empty: 'Keine Gefährdung als relevant eingestuft.', columns: ['Gefährdung', 'Abdeckung', 'Begründung', 'Risiko', 'H', 'A', 'Brutto', 'Netto', 'Behandlung'],
      rows: shown.map(x => [`${x.threat.code ? `${x.threat.code} ` : ''}${x.threat.title}${x.additional ? ' (zusätzlich)' : ''}`, COVERAGE_LABELS[x.coverage] || x.coverage,
        [x.relevance_note, x.coverage_note].filter(Boolean).join(' | '),
        x.risk ? `${x.risk.ref} ${x.risk.title}` : (x.has_risk ? 'vorhanden (keine Berechtigung)' : 'nicht eingestuft'),
        x.risk?.likelihood ?? '', x.risk?.impact ?? '', x.risk ? lvl(x.risk.inherent_level) : '', x.risk ? lvl(x.risk.residual_level) : '',
        x.risk ? TREATMENT_LABELS[x.risk.treatment] || x.risk.treatment : '']) });
    blocks.push({ type: 'note', text: `${notRelevant} Gefährdung(en) als nicht relevant bewertet, ${open} noch nicht bewertet (von ${a.threats.length}). H = Häufigkeit, A = Auswirkung nach der Risikomethodik.` });
    if (a.additional_measures.length) {
      blocks.push({ type: 'table', columns: ['Risiko', 'Zusätzliche Maßnahme', 'Option', 'Status', 'Verantwortlich', 'Termin', 'Im Realisierungsplan'],
        rows: a.additional_measures.map(m => [m.risk_ref, m.title, TREATMENT_LABELS[m.treatment_option] || m.treatment_option, ITEM_STATUS_LABELS[m.status] || m.status,
          m.responsible?.name || m.responsible_group?.name || '', day(m.due_date), m.in_realization_plan ? 'ja' : 'nein']) });
    }
  }
  return blocks;
}

async function sectionA6(domain, actor) {
  const svc = analysisSvc();
  const plan = await svc.getRealizationPlan(domain.id, actor);
  if (!plan.items.length) return [{ type: 'nodata', text: 'Keine offenen Anforderungen (Status nein/teilweise) und keine übernommenen Maßnahmen.' }];
  const { rows } = svc.buildA6Rows(plan);
  const s = plan.summary;
  return [
    { type: 'kv', rows: [['Einträge', String(s.items)], ['davon Anforderungen', String(s.requirements)], ['davon zusätzliche Maßnahmen', String(s.measures)],
      ['Priorität hoch / mittel / niedrig', `${s.by_priority.high} / ${s.by_priority.medium} / ${s.by_priority.low}`], ['überfällig', String(s.overdue)],
      ['ohne Verantwortlichen', String(s.without_responsible)], ['ohne Termin', String(s.without_due_date)],
      ['Kosten einmalig', eur(s.cost_once_total)], ['Kosten laufend pro Jahr', eur(s.cost_recurring_total)],
      ['Noch nicht geprüfte Anforderungen (nicht enthalten)', String(s.not_checked_requirements)]] },
    // Columns as in the Excel export, without the reference/level columns to fit the page.
    { type: 'table', columns: ['Priorität', 'Zielobjekt', 'Referenz', 'Anforderung / Maßnahme', 'Status', 'Verantwortlich', 'Umsetzung bis', 'Kosten einmalig', 'Kosten laufend'],
      rows: rows.map(r => [r[0], r[2], r[3], r[4], r[7], r[8], r[9], eur(r[10]), eur(r[11])]) },
    { type: 'note', text: 'Priorität „(Vorschlag)“: nicht gesetzt, abgeleitet aus der Anforderungsstufe (B hoch, S mittel, H niedrig) bzw. der Stufe des Risikos.' },
  ];
}

const BSI_SECTIONS = Object.freeze({ a1: sectionA1, a2: sectionA2, a3: sectionA3, a4: sectionA4, a5: sectionA5, a6: sectionA6 });

async function buildBsiReport(domainId, docKey, actor) {
  const key = BSI_DOC_KEYS.find(k => k === docKey);
  if (!key) {
    const e = new Error(`Dokument muss eines von ${BSI_DOC_KEYS.join(', ')} sein`);
    e.status = 400;
    throw e;
  }
  const domain = await domainsSvc().getDomain(domainId);
  const keys = key === 'all' ? Object.keys(BSI_DOCS) : [key];
  const title = key === 'all' ? 'Referenzdokumente A.1–A.6' : `Referenzdokument ${BSI_DOCS[key].code} ${BSI_DOCS[key].title}`;
  const doc = await base(title, actor, { subtitle: `Informationsverbund „${domain.name}“ (BSI-Standard 200-2/200-3)`, landscape: keys.some(k => ['a1', 'a2', 'a4', 'a5', 'a6'].includes(k)) });
  for (const k of keys) {
    // Each section reads under its own name - the builder is chosen from a fixed table, never from the input.
    const blocks = await BSI_SECTIONS[k](domain, actor);
    doc.sections.push({ heading: `${BSI_DOCS[k].code} ${BSI_DOCS[k].title}`, blocks });
  }
  return { doc, domain, keys };
}

/** Metadata for MCP and the UI: which reports exist and where to download them. */
function reportCatalog(domainList = []) {
  const formats = ['docx', 'pdf'];
  return {
    formats,
    risk_reports: [
      { key: 'risk_report', title: REPORTS.risk_report.title, permission: 'risks.view', path: '/api/risks/reports/risk-report' },
      { key: 'treatment_plan', title: REPORTS.treatment_plan.title, permission: 'risks.view', path: '/api/risks/reports/treatment-plan' },
    ],
    bsi_reference_documents: domainList.map(d => ({
      domain_id: d.id, domain_name: d.name,
      documents: BSI_DOC_KEYS.map(k => ({ key: k, title: k === 'all' ? 'Referenzdokumente A.1–A.6' : `${BSI_DOCS[k].code} ${BSI_DOCS[k].title}`, permission: 'bsi_grundschutz.view', path: `/api/bsi-grundschutz/domains/${d.id}/reports/${k}` })),
    })),
    usage: 'GET <path>?format=docx|pdf with the same authentication as the REST API (session or API token); every download is written to the audit log.',
  };
}

module.exports = {
  REPORTS, BSI_DOCS, BSI_DOC_KEYS, NO_DATA,
  heatmap, buildRiskReport, buildTreatmentPlanReport, buildBsiReport, reportCatalog,
};
