#!/usr/bin/env node
'use strict';

/**
 * Integrationstest gegen eine WEGWERF-Postgres-Datenbank: Risikomethodik.
 *
 *   1. Bestand wie in v3.5.1 (risks ohne methodology_id, keine Methodik-Tabelle,
 *      Risiken mit 5x5-Werten, einer Akzeptanz und einer Altlast aus dem
 *      MCP-Weg) -> Sync + Startmigration: Standardprofil v1, Zuordnung ohne
 *      Verlust (Werte, Stufen, updated_at), idempotent, genau eine aktive Version.
 *   2. Standardprofil ueber den Hook: 25 Kombinationen wie bis 3.5.1.
 *   3. Neue Version (3x3): alte bleibt lesbar, Risiken bleiben an ihrer Version,
 *      Freigabe erst nach Neubewertung, Neubewertung protokolliert.
 *   4. Uebernahme bei gleicher Matrixgroesse, Akzeptanzbefugnis, Hoechstdauer,
 *      Erloeschen der Akzeptanz bei steigender Stufe.
 *
 * Laeuft nur mit RISK_METHODOLOGY_TEST_DB=1 (oder BSI_CATALOG_TEST_DB=1) und
 * DB_*-Variablen auf eine leere Testdatenbank - das Schema public wird geloescht:
 *
 *   RISK_METHODOLOGY_TEST_DB=1 DB_HOST=/tmp DB_PORT=55432 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x node scripts/test-risk-methodology-db.js
 */

if (process.env.RISK_METHODOLOGY_TEST_DB !== '1' && process.env.BSI_CATALOG_TEST_DB !== '1') {
  console.log('Uebersprungen (RISK_METHODOLOGY_TEST_DB=1 und DB_* fuer eine Wegwerf-Datenbank setzen).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await (typeof p === 'function' ? p() : p); return 'ok'; } catch (e) { if (process.env.DEBUG_TEST) console.log(e.message); return e.status || e.name; } };

const oldComputeLevel = (l, i) => { const s = l * i; return s <= 4 ? 'low' : s <= 9 ? 'medium' : s <= 14 ? 'high' : 'critical'; };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const rm = require(path.join(SRC, 'services', 'riskMethodology'));
  const svc = require(path.join(SRC, 'services', 'riskService'));
  // Since 3.7.0 every assessment carries a rationale (services/riskService.js).
  const R = { likelihood_rationale: 'Test', impact_rationale: 'Test' };

  // 1. Schema wie v3.5.1: volles Schema, dann die neuen Teile wieder entfernen.
  await m.sequelize.sync();
  await sequelize.query('ALTER TABLE risks DROP COLUMN methodology_id; DROP TABLE risk_methodologies CASCADE; DROP TYPE IF EXISTS enum_risk_methodologies_status;');
  const mkUser = (name, role) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role });
  const admin = await mkUser('admin', 'admin');
  const assessor = await mkUser('assessor', 'assessor');
  const owner = await mkUser('owner', 'owner');
  const boss = await mkUser('boss', 'management');
  const it = await mkUser('it', 'it-staff');
  await sequelize.query(`
    INSERT INTO risks (ref, title, category, owner_id, likelihood, impact, inherent_level, treatment, residual_likelihood, residual_impact, residual_level, status, accepted_by_id, accepted_at, accepted_until, created_at, updated_at) VALUES
    ('R-0001', 'Alt niedrig', 'it_security', ${owner.id}, 1, 2, 'low', 'mitigate', 1, 2, 'low', 'open', NULL, NULL, NULL, '2026-01-01', '2026-01-02'),
    ('R-0002', 'Alt akzeptiert', 'privacy', ${owner.id}, 3, 3, 'medium', 'accept', 2, 3, 'medium', 'accepted', ${assessor.id}, '2026-03-01', '2027-03-01', '2026-02-01', '2026-03-01'),
    ('R-0003', 'Alt kritisch', 'operational', ${admin.id}, 5, 5, 'critical', 'mitigate', 5, 5, 'critical', 'in_treatment', NULL, NULL, NULL, '2026-04-01', '2026-04-02'),
    ('R-0004', 'Altlast MCP 4x4', 'it_security', ${owner.id}, 4, 4, 'high', 'mitigate', 4, 4, 'high', 'open', NULL, NULL, NULL, '2026-05-01', '2026-05-02')
  `);
  const snap = () => sequelize.query('SELECT id, likelihood, impact, inherent_level, residual_likelihood, residual_impact, residual_level, status, accepted_by_id, accepted_until, updated_at FROM risks ORDER BY id', { type: 'SELECT' });
  const before = await snap();

  console.log('Startmigration:');
  await m.sequelize.sync({ alter: { drop: false } });
  const mig = await rm.ensureDefaultProfile();
  // Since 3.7.0 categories are a maintained list; the former values become entries.
  await require(path.join(SRC, 'services', 'riskCategoryService')).ensureCategories();
  eq('Standardprofil als Version 1 angelegt, aktiv', [mig.created, mig.active.version, mig.active.status, mig.active.likelihood_levels.length, mig.active.impact_levels.length], [true, 1, 'active', 5, 5]);
  eq('alle vier Bestandsrisiken zugeordnet', mig.attached, 4);
  const after = await snap();
  eq('Werte, Stufen, Akzeptanz und updated_at unveraendert (auch die Altlast 4x4 = high)', after, before);
  eq('methodology_id gesetzt', (await sequelize.query('SELECT DISTINCT methodology_id FROM risks', { type: 'SELECT' })).map(r => r.methodology_id), [mig.active.id]);
  const again = await rm.ensureDefaultProfile();
  eq('zweiter Lauf: nichts angelegt, nichts zugeordnet', [again.created, again.reactivated, again.attached, again.active.id], [false, false, 0, mig.active.id]);
  eq('DB-Index: keine zweite aktive Version', await status(m.RiskMethodology.create({ ...JSON.parse(JSON.stringify(rm.DEFAULT_PROFILE)), version: 99, status: 'active' })), 'SequelizeUniqueConstraintError');
  const V1 = mig.active.id;

  console.log('\nStandardprofil ueber den Hook (wie bis 3.5.1):');
  const levels = [];
  const expected = [];
  for (let l = 1; l <= 5; l++) {
    for (let i = 1; i <= 5; i++) {
      const r = await svc.createRisk({ ...R, title: `K ${l}x${i}`, owner_id: owner.id, likelihood: l, impact: i }, admin, { user: admin });
      levels.push([r.inherent_level, r.residual_level, r.methodology_id]);
      expected.push([oldComputeLevel(l, i), oldComputeLevel(l, i), V1]);
    }
  }
  eq('25 Kombinationen: Brutto/Netto-Stufe und Version', levels, expected);
  eq('Wahrscheinlichkeit 6 auf 5er-Skala → 400', await status(svc.createRisk({ ...R, title: 'x', likelihood: 6, impact: 1 }, admin, { user: admin })), 400);
  eq('Status accepted beim Anlegen → 400', await status(svc.createRisk({ ...R, title: 'x', status: 'accepted' }, admin, { user: admin })), 400);
  const ctrl = await m.Control.create({ framework: 'custom', code: 'C-1', title: 'Backup', status: 'implemented' });
  const withCtrl = await svc.createRisk({ ...R, title: 'mit Massnahme', owner_id: owner.id, likelihood: 4, impact: 4, controls: [{ id: ctrl.id, effectiveness: 3 }] }, admin, { user: admin });
  eq('Netto mit umgesetzter Massnahme (W3): 4 → 2, 2x4 = medium (brutto 4x4 = critical)', [withCtrl.residual_likelihood, withCtrl.residual_level, withCtrl.inherent_level], [2, 'medium', 'critical']);
  eq('Antwort traegt Methodik-Felder', [withCtrl.methodology_version, withCtrl.needs_reassessment, withCtrl.appetite_exceeded, withCtrl.effective_level], [1, false, false, 'medium']);

  console.log('\nFreigabe nach Standardprofil (wie bisher):');
  const r1 = await m.Risk.findByPk(1);
  eq('owner, eigenes Risiko → ok, keine Hoechstdauer', await (async () => { const x = await svc.signoffRisk(r1, owner, null, { user: owner }); return [x.status, x.accepted_until]; })(), ['accepted', null]);
  eq('it-staff → 403 (Datensatz)', await status(svc.signoffRisk(await m.Risk.findByPk(3), it, null, { user: it })), 403);
  eq('management → 403 (Standardprofil erlaubt nur admin/assessor/owner)', await status(svc.signoffRisk(await m.Risk.findByPk(3), boss, null, { user: boss })), 403);
  eq('Status accepted per Bearbeiten → 400', await status(svc.updateRisk(await m.Risk.findByPk(3), { ...R, title: 'Alt kritisch', status: 'accepted', likelihood: 5, impact: 5 }, admin, { user: admin })), 400);

  console.log('\nNeue Version 3x3:');
  const P3 = {
    name: 'Kompakt 3×3',
    likelihood_unit: 'pro Jahr', impact_unit: 'EUR',
    likelihood_levels: [{ label_de: 'Selten', label_en: 'Rare', description: '< 1x in 5 Jahren', range_max: 0.2 }, { label_de: 'Gelegentlich', label_en: 'Occasional', range_min: 0.2, range_max: 1 }, { label_de: 'Häufig', label_en: 'Frequent', range_min: 1 }],
    impact_levels: [{ label_de: 'Gering', label_en: 'Minor', range_max: 10000 }, { label_de: 'Erheblich', label_en: 'Major', range_min: 10000, range_max: 250000 }, { label_de: 'Existenziell', label_en: 'Severe', range_min: 250000 }],
    risk_levels: [
      { key: 'low', label_de: 'Niedrig', label_en: 'Low', color: '#16a34a', min_score: 1, max_score: 2 },
      { key: 'medium', label_de: 'Mittel', label_en: 'Medium', color: '#eab308', min_score: 3, max_score: 4 },
      { key: 'high', label_de: 'Hoch', label_en: 'High', color: '#f97316', min_score: 5, max_score: 6 },
      { key: 'critical', label_de: 'Kritisch', label_en: 'Critical', color: '#dc2626', min_score: 7, max_score: 9 },
    ],
    appetite: { default_max_level: 'high', categories: [{ category: 'privacy', max_level: 'low' }] },
    acceptance: [
      { level: 'low', roles: ['owner', 'assessor', 'admin'], max_months: 24 },
      { level: 'medium', roles: ['assessor', 'admin'], max_months: 12 },
      { level: 'high', roles: ['management', 'admin'], max_months: 6 },
      { level: 'critical', roles: ['management'], max_months: 3 },
    ],
  };
  eq('ungueltig (Luecke) → 400 mit Feldliste', await (async () => { try { await rm.saveNewVersion({ ...P3, risk_levels: P3.risk_levels.map(r => r.key === 'high' ? { ...r, min_score: 6 } : r) }, admin); return 'ok'; } catch (e) { return [e.status, Array.isArray(e.extra?.errors)]; } })(), [400, true]);
  eq('unveraendert speichern → 400', await status(rm.saveNewVersion(JSON.parse(JSON.stringify(rm.DEFAULT_PROFILE)), admin)), 400);
  const preSwitch = await snap();
  const s2 = await rm.saveNewVersion(P3, admin, { changeNote: 'Umstellung auf 3x3' });
  const V2 = s2.profile.id;
  eq('Version 2 aktiv, Version 1 superseded und lesbar', [s2.profile.version, s2.profile.status, s2.previous.version, (await rm.getProfile(V1)).likelihood_levels.length, (await m.RiskMethodology.findByPk(V1)).status], [2, 'active', 1, 5, 'superseded']);
  const versions = await rm.listVersions();
  eq('Versionsliste mit Zahl der Risiken', versions.map(v => [v.version, v.status, v.risk_count, v.created_by?.name ?? null]), [[2, 'active', 0, 'admin'], [1, 'superseded', 30, null]]);
  eq('genau eine aktive Version', await m.RiskMethodology.count({ where: { status: 'active' } }), 1);
  eq('Versionswechsel aendert kein Risiko (Werte, Stufen, updated_at)', await snap(), preSwitch);
  const list = await svc.listForReassessment();
  eq('Liste "neu zu bewerten": alle 30, Matrixgroesse geaendert', [list.length, list.every(r => r.needs_reassessment && r.matrix_changed && r.methodology_version === 1)], [30, true]);
  const r4 = (await rm.decorateRisks([await m.Risk.findByPk(4)]))[0];
  eq('Altlast 4x4 bleibt an Version 1 mit Stufe high', [r4.methodology_id, r4.inherent_level, r4.likelihood, r4.impact], [V1, 'high', 4, 4]);
  eq('Freigabe an alter Version → 409', await status(svc.signoffRisk(await m.Risk.findByPk(3), admin, null, { user: admin })), 409);
  const r3 = await m.Risk.findByPk(3);
  eq('Bearbeiten ohne Neubewertung: Werte nach Version 1 (5 erlaubt)', await (async () => { const x = await svc.updateRisk(r3, { ...R, title: 'Alt kritisch', likelihood: 5, impact: 4 }, admin, { user: admin }); return [x.methodology_version, x.inherent_level]; })(), [1, 'critical']);
  eq('Neubewertung ohne Werte → 400', await status(svc.updateRisk(await m.Risk.findByPk(3), { ...R, title: 'Alt kritisch', reassess: true }, admin, { user: admin })), 400);
  eq('Neubewertung mit Wert ausserhalb der neuen Skala (5) → 400, Version bleibt',
    [await status(svc.updateRisk(await m.Risk.findByPk(3), { ...R, title: 'Alt kritisch', reassess: true, likelihood: 5, impact: 3 }, admin, { user: admin })), (await m.Risk.findByPk(3)).methodology_id], [400, V1]);
  const re = await svc.updateRisk(await m.Risk.findByPk(3), { ...R, title: 'Alt kritisch', reassess: true, likelihood: 3, impact: 2 }, admin, { user: admin });
  eq('Neubewertung: Version 2, 3x2 = high', [re.methodology_version, re.inherent_level, re.needs_reassessment], [2, 'high', false]);
  const reLog = await m.AuditLog.findOne({ where: { entity_type: 'risk', entity_id: 3 }, order: [['id', 'DESC']] });
  eq('Neubewertung im Audit-Log (signiert)', [reLog.details.action, reLog.details.from_version, reLog.details.to_version, reLog.details.before.likelihood, reLog.details.after.inherent_level, !!reLog.integrity_hash], ['reassess', 1, 2, 5, 'high', true]);
  eq('Uebernahme 5x5 → 3x3 abgelehnt (Matrixgroesse)', (await svc.carryOver([1, 2], { user: admin })).skipped.map(s => s.reason), ['matrix_changed', 'matrix_changed']);

  console.log('\nAppetit (Version 2):');
  const priv = await svc.createRisk({ ...R, title: 'Datenschutz', category: 'privacy', owner_id: owner.id, likelihood: 2, impact: 2 }, admin, { user: admin });
  const ops = await svc.createRisk({ ...R, title: 'Betrieb', category: 'operational', owner_id: owner.id, likelihood: 3, impact: 3 }, admin, { user: admin });
  eq('privacy medium > low → markiert; operational critical > high (Standard) → markiert', [priv.methodology_version, priv.appetite_max_level, priv.appetite_exceeded, ops.inherent_level, ops.appetite_exceeded], [2, 'low', true, 'critical', true]);
  eq('Wahrscheinlichkeit 4 auf 3er-Skala → 400', await status(svc.createRisk({ ...R, title: 'x', likelihood: 4, impact: 1 }, admin, { user: admin })), 400);
  eq('Hook gilt auch am Dienst vorbei (Import/Warnmeldung): Risk.create 4x1 → 400', await status(m.Risk.create({ title: 'direkt', likelihood: 4, impact: 1 })), 400);
  const direct = await m.Risk.create({ title: 'direkt', likelihood: 3, impact: 1 });
  eq('… gueltig: Version 2, Stufe berechnet', [direct.methodology_id, direct.inherent_level], [V2, 'medium']);

  console.log('\nAkzeptanzbefugnis und Hoechstdauer (Version 2):');
  const opsRisk = await m.Risk.findByPk(ops.id);
  eq('critical: admin → 403 (nur management)', await status(svc.signoffRisk(opsRisk, admin, null, { user: admin })), 403);
  eq('critical: owner (eigenes Risiko) → 403', await status(svc.signoffRisk(opsRisk, owner, null, { user: owner })), 403);
  eq('critical: Datum ueber 3 Monate → 400', await status(svc.signoffRisk(opsRisk, boss, rm.addMonths(rm.todayStr(), 4), { user: boss })), 400);
  const acc = await svc.signoffRisk(opsRisk, boss, null, { user: boss });
  eq('critical: management ohne Datum → akzeptiert bis heute + 3 Monate', [acc.status, acc.accepted_by_id, acc.accepted_until], ['accepted', boss.id, rm.addMonths(rm.todayStr(), 3)]);
  const accLog = await m.AuditLog.findOne({ where: { entity_type: 'risk', entity_id: ops.id, action: 'acknowledge' }, order: [['id', 'DESC']] });
  eq('Freigabe im Audit-Log mit Stufe, Version, Regel', [accLog.details.level, accLog.details.methodology_version, accLog.details.allowed_roles, accLog.details.max_months], ['critical', 2, ['management'], 3]);
  eq('Zuruecknehmen durch it-staff → 403', await status(svc.revokeRisk(await m.Risk.findByPk(ops.id), it, { user: it })), 403);
  eq('Zuruecknehmen durch assessor (darf critical nicht akzeptieren) → 403', await status(svc.revokeRisk(await m.Risk.findByPk(ops.id), assessor, { user: assessor })), 403);
  eq('Zuruecknehmen durch den Akzeptierenden → ok', (await svc.revokeRisk(await m.Risk.findByPk(ops.id), boss, { user: boss })).status, 'in_treatment');
  const lowRisk = await svc.createRisk({ ...R, title: 'klein', category: 'it_security', owner_id: owner.id, likelihood: 1, impact: 2 }, admin, { user: admin });
  const lowAcc = await svc.signoffRisk(await m.Risk.findByPk(lowRisk.id), owner, null, { user: owner });
  eq('low: owner darf, 24 Monate', [lowAcc.status, lowAcc.accepted_until], ['accepted', rm.addMonths(rm.todayStr(), 24)]);
  const raised = await svc.updateRisk(await m.Risk.findByPk(lowRisk.id), { ...R, title: 'klein', status: 'accepted', likelihood: 3, impact: 2 }, owner, { user: owner });
  eq('Stufe steigt (low → high): Akzeptanz erlischt, protokolliert', [raised.status, raised.accepted_by_id, raised.accepted_until], ['in_treatment', null, null]);
  eq('… Audit-Eintrag acceptance_lapsed', !!(await m.AuditLog.findOne({ where: { entity_type: 'risk', entity_id: lowRisk.id }, order: [['id', 'DESC']] })).details.acceptance_lapsed, true);

  console.log('\nVersion 3 (gleiche Matrix, andere Schwellen) und Uebernahme:');
  const P3b = { ...P3, risk_levels: P3.risk_levels.map(r => ({ key: r.key, label_de: r.label_de, label_en: r.label_en, color: r.color, min_score: { low: 1, medium: 2, high: 4, critical: 9 }[r.key], max_score: { low: 1, medium: 3, high: 8, critical: 9 }[r.key] })) };
  const s3 = await rm.saveNewVersion(P3b, admin, { changeNote: 'Schwellen geschaerft' });
  const v2Risk = await m.Risk.findByPk(priv.id);
  const v2Before = [v2Risk.likelihood, v2Risk.impact, v2Risk.inherent_level];
  eq('Risiko an Version 2: neu zu bewerten, Matrixgroesse gleich', (({ needs_reassessment, matrix_changed }) => [needs_reassessment, matrix_changed])(await rm.decorateRisk(v2Risk)), [true, false]);
  const co = await svc.carryOver([priv.id, 1, 999999], { user: admin });
  eq('Uebernahme: Version-2-Risiko uebernommen, 5x5-Risiko und Unbekanntes uebersprungen', [co.to_version, co.carried.map(c => c.id), co.skipped.map(s => s.reason)], [3, [priv.id], ['not_found', 'matrix_changed']]);
  const v3Risk = await m.Risk.findByPk(priv.id);
  eq('Werte gleich, Stufe nach neuen Schwellen (2x2 = 4 → high), Version 3', [v3Risk.likelihood, v3Risk.impact, v2Before[2], v3Risk.inherent_level, v3Risk.methodology_id], [2, 2, 'medium', 'high', s3.profile.id]);
  const coLog = await m.AuditLog.findOne({ where: { entity_type: 'risk', entity_id: priv.id }, order: [['id', 'DESC']] });
  eq('Uebernahme im Audit-Log', [coLog.details.action, coLog.details.mode, coLog.details.from_version, coLog.details.to_version, coLog.details.before.inherent_level, coLog.details.after.inherent_level], ['reassess', 'carry_over', 2, 3, 'medium', 'high']);
  eq('Versionen 1 und 2 bleiben lesbar', [(await rm.getProfile(V1)).version, (await rm.getProfile(V2)).risk_levels[2].min_score], [1, 5]);

  await m.sequelize.close();
  console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
