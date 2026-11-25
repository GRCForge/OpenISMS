#!/usr/bin/env node
'use strict';

/**
 * Risikomethodik ohne Datenbank (Models gemockt):
 *
 *   1. Standardprofil = Skala bis 3.5.1: computeLevel, computeResidual und die
 *      Altfelder von /api/risks/scale liefern fuer alle 25 Kombinationen exakt
 *      dasselbe wie die fruehere feste Implementierung (unten woertlich kopiert).
 *   2. Validierung: Matrixgroesse 3-6, Schwellen lueckenlos/ueberschneidungsfrei,
 *      Farben, Rollen, Gueltigkeit, Appetit; keine Schluessel aus dem Request.
 *   3. Andere Matrixgroessen (3x3, 6x4), Appetit, Akzeptanzbefugnis, Gueltigkeit.
 *   4. riskService.buildFields: "accepted" nur ueber die Freigabe, Allowlist.
 *
 * Run: node scripts/test-risk-methodology.js
 */

const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'backend', 'src');

// Models mocken: aktive Version und Versionen kommen aus diesem Speicher.
const store = { rows: [] };
const asRow = (p) => ({ ...p, get: () => ({ ...p }) });
Module._cache[require.resolve(path.join(SRC, 'models'))] = {
  id: 'models', loaded: true,
  exports: {
    User: {},
    RiskMethodology: {
      findOne: async ({ where, order } = {}) => {
        if (where && where.status) { const r = store.rows.find(x => x.status === where.status); return r ? asRow(r) : null; }
        if (order) { const s = [...store.rows].sort((a, b) => a.version - b.version); return s.length ? asRow(s[0]) : null; }
        return null;
      },
      findByPk: async (id) => { const r = store.rows.find(x => x.id === id); return r ? asRow(r) : null; },
    },
  },
};
for (const svc of ['auditService', 'notifyService']) {
  Module._cache[require.resolve(path.join(SRC, 'services', svc))] = { id: svc, loaded: true, exports: { auditFromReq: async () => {}, notify: async () => {} } };
}

const rm = require(path.join(SRC, 'services', 'riskMethodology'));
const riskScale = require(path.join(SRC, 'services', 'riskScale'));
const { computeResidual } = require(path.join(SRC, 'services', 'residual'));
const riskService = require(path.join(SRC, 'services', 'riskService'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const throwsStatus = async (fn) => { try { await fn(); return 'ok'; } catch (e) { return e.status || e.message; } };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── Implementierung bis 3.5.1, woertlich (services/riskScale.js, residual.js) ──
const OLD_LIKELIHOOD = [null, 'Selten', 'Unwahrscheinlich', 'Möglich', 'Wahrscheinlich', 'Fast sicher'];
const OLD_IMPACT = [null, 'Vernachlässigbar', 'Gering', 'Spürbar', 'Kritisch', 'Existenzbedrohend'];
const oldComputeLevel = (likelihood, impact) => {
  const s = (Number(likelihood) || 0) * (Number(impact) || 0);
  if (s <= 0) return null;
  if (s <= 4) return 'low';
  if (s <= 9) return 'medium';
  if (s <= 14) return 'high';
  return 'critical';
};
const oldBuildMatrix = () => {
  const rows = [];
  for (let l = 5; l >= 1; l--) {
    const row = [];
    for (let i = 1; i <= 5; i++) row.push({ likelihood: l, impact: i, score: l * i, level: oldComputeLevel(l, i) });
    rows.push(row);
  }
  return rows;
};
const oldScaleInfo = () => ({ size: 5, likelihood: OLD_LIKELIHOOD, impact: OLD_IMPACT, thresholds: { low: '1–4', medium: '5–9', high: '10–14', critical: '15–25' }, matrix: oldBuildMatrix() });
const oldComputeResidual = (likelihood, impact, controlLinks = []) => {
  const implemented = controlLinks.filter(c => c.status === 'implemented' && Number(c.effectiveness) >= 1);
  let factor = 1;
  implemented.forEach(c => { factor *= (1 - Math.min(5, Number(c.effectiveness)) / 6); });
  const rl = Math.max(1, Math.round((Number(likelihood) || 1) * factor));
  const ri = Number(impact) || 1;
  return { residual_likelihood: rl, residual_impact: ri, residual_level: oldComputeLevel(rl, ri) };
};

(async () => {
  console.log('1. Standardprofil = Skala bis 3.5.1');
  const combos = [];
  for (let l = 1; l <= 5; l++) for (let i = 1; i <= 5; i++) combos.push([l, i]);
  const def = rm.DEFAULT_PROFILE;
  eq('computeLevel: alle 25 Kombinationen identisch', combos.map(([l, i]) => rm.computeLevel(l, i, def)), combos.map(([l, i]) => oldComputeLevel(l, i)));
  eq('riskScale.computeLevel ohne Profil identisch', combos.map(([l, i]) => riskScale.computeLevel(l, i)), combos.map(([l, i]) => oldComputeLevel(l, i)));
  eq('Randfaelle (0, null, Text, >25) identisch', [[0, 3], [null, 2], ['3', '4'], [6, 6], [2.5, 2]].map(([l, i]) => rm.computeLevel(l, i, def)), [[0, 3], [null, 2], ['3', '4'], [6, 6], [2.5, 2]].map(([l, i]) => oldComputeLevel(l, i)));
  const sets = [[], [{ status: 'implemented', effectiveness: 5 }], [{ status: 'implemented', effectiveness: 3 }, { status: 'planned', effectiveness: 5 }], [{ status: 'implemented', effectiveness: 2 }, { status: 'implemented', effectiveness: 4 }], [{ status: 'implemented', effectiveness: 9 }]];
  eq('computeResidual: 25 Kombinationen x 5 Massnahmen-Sets identisch',
    combos.flatMap(([l, i]) => sets.map(s => computeResidual(l, i, s))),
    combos.flatMap(([l, i]) => sets.map(s => oldComputeResidual(l, i, s))));
  const si = rm.scaleInfo(def);
  eq('scaleInfo: Altfelder size/likelihood/impact/thresholds/matrix identisch',
    { size: si.size, likelihood: si.likelihood, impact: si.impact, thresholds: si.thresholds, matrix: si.matrix }, oldScaleInfo());
  eq('Standardprofil ist gueltig', rm.validateProfile(clone(def)).errors, []);
  eq('Standardprofil: kein Appetit, Akzeptanz admin/assessor/owner ohne Hoechstdauer',
    [def.appetite, def.acceptance.map(a => [a.level, a.roles.join('+'), a.max_months])],
    [{ default_max_level: null, categories: [] }, [['low', 'admin+assessor+owner', null], ['medium', 'admin+assessor+owner', null], ['high', 'admin+assessor+owner', null], ['critical', 'admin+assessor+owner', null]]]);

  console.log('\n2. Validierung');
  const errs = (mutate) => { const p = clone(def); mutate(p); return rm.validateProfile(p).errors.map(e => e.message); };
  const has = (list, part) => list.some(m => m.includes(part));
  eq('2 Stufen Wahrscheinlichkeit → Fehler', has(errs(p => { p.likelihood_levels = p.likelihood_levels.slice(0, 2); }), '3 bis 6 Stufen'), true);
  eq('7 Stufen Auswirkung → Fehler', has(errs(p => { p.impact_levels.push({ label_de: 'a', label_en: 'a' }, { label_de: 'b', label_en: 'b' }); }), '3 bis 6 Stufen'), true);
  eq('Luecke 4 → 6', has(errs(p => { p.risk_levels[1].min_score = 6; }), 'Lücke'), true);
  eq('Ueberschneidung', has(errs(p => { p.risk_levels[2].min_score = 9; }), 'Überschneidung'), true);
  eq('Beginn nicht bei 1', has(errs(p => { p.risk_levels[0].min_score = 2; }), 'Score 1'), true);
  eq('Ende nicht beim hoechsten Score', has(errs(p => { p.risk_levels[3].max_score = 24; }), 'höchsten Score 25'), true);
  eq('von > bis', has(errs(p => { p.risk_levels[0].max_score = 0; p.risk_levels[0].min_score = 1; }), 'liegt über'), true);
  eq('Stufe fehlt', has(errs(p => { p.risk_levels = p.risk_levels.filter(r => r.key !== 'high'); }), '„high“ fehlt'), true);
  eq('Stufe doppelt', has(errs(p => { p.risk_levels.push({ ...p.risk_levels[0] }); }), 'mehrfach'), true);
  eq('fremde Stufe', has(errs(p => { p.risk_levels.push({ key: 'extreme', label_de: 'x', label_en: 'x', color: '#000000', min_score: 1, max_score: 1 }); }), 'Nur die Risikostufen'), true);
  eq('Farbe kein #RRGGBB', has(errs(p => { p.risk_levels[0].color = 'red'; }), '#RRGGBB'), true);
  eq('Bezeichnung (en) fehlt', has(errs(p => { p.likelihood_levels[2].label_en = ' '; }), 'Bezeichnung (en) fehlt'), true);
  eq('Bereich von > bis', has(errs(p => { p.impact_levels[0].range_min = 10; p.impact_levels[0].range_max = 1; }), 'größer als'), true);
  eq('unbekannte Rolle', has(errs(p => { p.acceptance[3].roles = ['admin', 'root']; }), 'unbekannte Rolle'), true);
  eq('keine Rolle', has(errs(p => { p.acceptance[2].roles = []; }), 'mindestens eine Rolle'), true);
  eq('Gueltigkeit 0 / 121 Monate', [has(errs(p => { p.acceptance[0].max_months = 0; }), 'Gültigkeit'), has(errs(p => { p.acceptance[0].max_months = 121; }), 'Gültigkeit')], [true, true]);
  eq('Akzeptanz fuer eine Stufe fehlt', has(errs(p => { p.acceptance = p.acceptance.slice(0, 3); }), '„critical“ fehlt'), true);
  eq('Appetit: Kategorie doppelt', has(errs(p => { p.appetite.categories = [{ category: 'a', max_level: 'low' }, { category: 'a', max_level: 'high' }]; }), 'doppelt'), true);
  eq('Appetit: unbekannte Stufe', has(errs(p => { p.appetite.default_max_level = 'extreme'; }), 'unbekannte Risikostufe'), true);
  const hostile = clone(def);
  hostile.appetite.categories = JSON.parse('[{"category":"__proto__","max_level":"low"},{"category":"constructor","max_level":"high"}]');
  hostile.likelihood_levels[0].value = 99;
  hostile.likelihood_levels[0].__proto__ = { polluted: true };
  hostile.extra_field = 'x';
  const hv = rm.validateProfile(hostile);
  eq('Kategorien bleiben Array-Eintraege, kein Prototyp beruehrt', [Array.isArray(hv.profile.appetite.categories), hv.profile.appetite.categories.length, ({}).polluted, Object.prototype.hasOwnProperty.call(hv.profile, 'extra_field')], [true, 2, undefined, false]);
  eq('Stufenwert = Position, nicht aus dem Request', hv.profile.likelihood_levels.map(l => l.value), [1, 2, 3, 4, 5]);
  eq('Rollen in fester Reihenfolge, Dubletten entfernt', rm.validateProfile({ ...clone(def), acceptance: def.acceptance.map(a => ({ ...a, roles: ['owner', 'admin', 'owner'] })) }).profile.acceptance[0].roles, ['admin', 'owner']);
  const warn = clone(def); warn.risk_levels[1].max_score = 7; warn.risk_levels[2].min_score = 8; warn.risk_levels[2].max_score = 8; warn.risk_levels[3].min_score = 9; // high = nur Score 8
  const wv = rm.validateProfile(warn);
  eq('Stufe ohne erreichbaren Score: Warnung, kein Fehler', [wv.errors.length, wv.warnings.length], [0, 0]);
  const warn2 = clone(def); warn2.risk_levels[1].max_score = 6; warn2.risk_levels[2].min_score = 7; warn2.risk_levels[2].max_score = 7; warn2.risk_levels[3].min_score = 8;
  const wv2 = rm.validateProfile(warn2);
  eq('… Score 7 ist bei 5x5 nicht erreichbar → Warnung', [wv2.errors.length, wv2.warnings.map(w => w.field)], [0, ['risk_levels.high']]);
  eq('Eingabe kein Objekt → Fehler statt Absturz', rm.validateProfile(null).errors.length > 0, true);

  console.log('\n3. Andere Matrixgroessen, Appetit, Akzeptanz');
  const p3 = rm.validateProfile({
    name: '3x3', likelihood_levels: [{ label_de: 'n', label_en: 'l' }, { label_de: 'm', label_en: 'm' }, { label_de: 'h', label_en: 'h', description: '> 1x/Monat', range_min: 12, range_max: null }],
    impact_levels: [{ label_de: 'g', label_en: 'l', range_min: 0, range_max: 10000 }, { label_de: 'm', label_en: 'm', range_min: 10000, range_max: 100000 }, { label_de: 'h', label_en: 'h', range_min: 100000 }],
    risk_levels: [
      { key: 'critical', label_de: 'K', label_en: 'C', color: '#DC2626', min_score: 9, max_score: 9 },
      { key: 'low', label_de: 'N', label_en: 'L', color: '#16a34a', min_score: 1, max_score: 2 },
      { key: 'medium', label_de: 'M', label_en: 'M', color: '#eab308', min_score: 3, max_score: 4 },
      { key: 'high', label_de: 'H', label_en: 'H', color: '#f97316', min_score: 5, max_score: 8 },
    ],
    appetite: { default_max_level: 'medium', categories: [{ category: 'privacy', max_level: 'low' }] },
    acceptance: [
      { level: 'low', roles: ['owner', 'assessor', 'admin'], max_months: 24 },
      { level: 'medium', roles: ['assessor', 'admin'], max_months: 12 },
      { level: 'high', roles: ['management', 'admin'], max_months: 6 },
      { level: 'critical', roles: ['management'], max_months: 3 },
    ],
  });
  eq('3x3 gueltig, Stufen sortiert, Farbe klein', [p3.errors, p3.profile.risk_levels.map(r => r.key), p3.profile.risk_levels[3].color], [[], ['low', 'medium', 'high', 'critical'], '#dc2626']);
  const P3 = { ...p3.profile, id: 2, version: 2 };
  eq('3x3 Matrix 3 Zeilen x 3 Spalten, oben Wahrscheinlichkeit 3', [rm.buildMatrix(P3).length, rm.buildMatrix(P3)[0].length, rm.buildMatrix(P3)[0][0].likelihood], [3, 3, 3]);
  eq('3x3 Stufen', [[1, 1], [1, 2], [2, 2], [3, 2], [3, 3]].map(([l, i]) => rm.computeLevel(l, i, P3)), ['low', 'low', 'medium', 'high', 'critical']);
  eq('3x3 Altfelder: size 3, thresholds', [rm.scaleInfo(P3).size, rm.scaleInfo(P3).thresholds], [3, { low: '1–2', medium: '3–4', high: '5–8', critical: '9–9' }]);
  const six4 = clone(def);
  six4.likelihood_levels.push({ label_de: 'Ständig', label_en: 'Constant' });
  six4.impact_levels = six4.impact_levels.slice(0, 4);
  six4.risk_levels[3].max_score = 24;
  const v64 = rm.validateProfile(six4);
  eq('6x4 gueltig (hoechster Score 24)', v64.errors, []);
  eq('6x4 Matrix 6 Zeilen x 4 Spalten', [rm.buildMatrix(v64.profile).length, rm.buildMatrix(v64.profile)[0].length], [6, 4]);

  // Appetit: Netto vor Brutto, Kategorie vor Standard.
  const own = { ...def, id: 1, version: 1 };
  const A = { ...P3, likelihood_levels: def.likelihood_levels, impact_levels: def.impact_levels, risk_levels: def.risk_levels, id: 3, version: 3 };
  eq('privacy (max low): Netto medium → ueberschritten', rm.assess({ category: 'privacy', likelihood: 4, impact: 4, residual_likelihood: 2, residual_impact: 3 }, A, A).appetite_exceeded, true);
  eq('ohne Kategorie (Standard medium): Netto medium → nicht ueberschritten', rm.assess({ category: 'it_security', likelihood: 4, impact: 4, residual_likelihood: 2, residual_impact: 3 }, A, A), { methodology_version: 3, needs_reassessment: false, matrix_changed: false, effective_level: 'medium', appetite_max_level: 'medium', appetite_exceeded: false });
  eq('ohne Netto: Brutto high > medium → ueberschritten', rm.assess({ category: 'x', likelihood: 3, impact: 4 }, A, A).appetite_exceeded, true);
  eq('Standardprofil: nie markiert', rm.assess({ category: 'privacy', likelihood: 5, impact: 5 }, own, own).appetite_exceeded, false);
  eq('Risiko an alter Version: neu zu bewerten, Matrixgroesse geaendert', (({ needs_reassessment, matrix_changed, methodology_version }) => [needs_reassessment, matrix_changed, methodology_version])(rm.assess({ likelihood: 2, impact: 2 }, own, P3)), [true, true, 1]);

  // Akzeptanzbefugnis gegen die gemockte aktive Version.
  store.rows = [{ ...clone(def), id: 1, version: 1, status: 'superseded' }, { ...clone(P3), id: 2, version: 2, status: 'active' }];
  rm.invalidate();
  const today = rm.todayStr();
  const r33 = { methodology_id: 2, likelihood: 3, impact: 3, residual_likelihood: 3, residual_impact: 3 };
  eq('critical: assessor → 403', await throwsStatus(() => rm.checkAcceptance(r33, { id: 1, role: 'assessor' }, null)), 403);
  eq('critical: management ohne Datum → hoechstens 3 Monate', (await rm.checkAcceptance(r33, { id: 1, role: 'management' }, null)).accepted_until, rm.addMonths(today, 3));
  eq('critical: Datum ueber 3 Monate → 400', await throwsStatus(() => rm.checkAcceptance(r33, { id: 1, role: 'management' }, rm.addMonths(today, 4))), 400);
  eq('Datum in der Vergangenheit → 400', await throwsStatus(() => rm.checkAcceptance(r33, { id: 1, role: 'management' }, '2020-01-01')), 400);
  eq('ungueltiges Datum → 400', await throwsStatus(() => rm.checkAcceptance(r33, { id: 1, role: 'management' }, '2027-02-30')), 400);
  eq('Netto zaehlt: Netto low → owner darf', (await rm.checkAcceptance({ methodology_id: 2, likelihood: 3, impact: 3, residual_likelihood: 1, residual_impact: 2 }, { id: 1, role: 'owner' }, null)).level, 'low');
  eq('Risiko an alter Version → 409 (erst neu bewerten)', await throwsStatus(() => rm.checkAcceptance({ methodology_id: 1, likelihood: 1, impact: 1 }, { id: 1, role: 'admin' }, null)), 409);
  eq('Risiko ohne Version = Version 1 → 409', await throwsStatus(() => rm.checkAcceptance({ methodology_id: null, likelihood: 1, impact: 1 }, { id: 1, role: 'admin' }, null)), 409);
  eq('addMonths kappt Monatsende', [rm.addMonths('2027-01-31', 1), rm.addMonths('2028-01-31', 1), rm.addMonths('2026-11-25', 12)], ['2027-02-28', '2028-02-29', '2027-11-25']);

  console.log('\n4. riskService.buildFields');
  eq('"accepted" per Formular → 400', await throwsStatus(() => riskService.buildFields({ title: 'x', status: 'accepted' })), 400);
  eq('"accepted" bleibt, wenn schon akzeptiert', riskService.buildFields({ title: 'x', status: 'accepted' }, { existing: { status: 'accepted' } }).status, 'accepted');
  const bf = riskService.buildFields({ title: 'x', likelihood: '2', impact: 4, methodology_id: 99, inherent_level: 'low', accepted_by_id: 5, residual_level: 'low', id: 7 });
  eq('Allowlist: Server-Felder aus dem Body ignoriert', ['methodology_id', 'inherent_level', 'accepted_by_id', 'residual_level', 'id'].filter(k => k in bf), []);
  eq('partial: nur gesendete Felder', Object.keys(riskService.buildFields({ impact: 2 }, { partial: true })), ['impact']);
  eq('unbekannte Behandlung → 400', await throwsStatus(() => riskService.buildFields({ title: 'x', treatment: 'ignore' })), 400);
  eq('Titel leer → 400', await throwsStatus(() => riskService.buildFields({ title: '  ' })), 400);
  eq('Freigabe-Datensatzrecht: management ja, it-staff fremd nein, owner eigen ja',
    [riskService.canSignoffRecord({ id: 1, role: 'management' }, { owner_id: 9 }), riskService.canSignoffRecord({ id: 1, role: 'it-staff' }, { owner_id: 9 }), riskService.canSignoffRecord({ id: 9, role: 'owner' }, { owner_id: 9 })],
    [true, false, true]);

  console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
