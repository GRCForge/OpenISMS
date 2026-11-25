#!/usr/bin/env node
'use strict';

/**
 * Integration test against a THROWAWAY Postgres database: deeper risk
 * assessment (3.7.0).
 *
 *   1. Risk category taxonomy: seed, takeover of free-text values, idempotent;
 *      appetite only on entries; inactive/unknown categories; key immutable.
 *   2. Impact dimensions from the methodology; overall impact = maximum.
 *   3. Mandatory rationale whenever values change; existing risks stay editable.
 *   4. Target risk; net-risk override with rationale, audit log, back to calculation.
 *   5. Vulnerabilities (manual, from asset CVE data by request), scenarios
 *      asset(s) x threat x vulnerability, deletion rules.
 *   6. Reassessment and carry-over with dimensions.
 *
 * Runs only with RISK_ASSESSMENT_TEST_DB=1 and DB_* pointing at an empty test
 * database - schema public is dropped:
 *
 *   RISK_ASSESSMENT_TEST_DB=1 DB_HOST=/tmp DB_PORT=55432 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x node scripts/test-risk-assessment-db.js
 */

if (process.env.RISK_ASSESSMENT_TEST_DB !== '1') {
  console.log('Skipped (set RISK_ASSESSMENT_TEST_DB=1 and DB_* for a throwaway database).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');

let failures = 0;
// Key order does not matter (JSONB stores keys sorted by length, then bytes).
const stable = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
};
const eq = (label, actual, expected) => {
  const ok = stable(actual) === stable(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await (typeof p === 'function' ? p() : p); return 'ok'; } catch (e) { if (process.env.DEBUG_TEST) console.log('   ', e.message); return e.status || e.name; } };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const rm = require(path.join(SRC, 'services', 'riskMethodology'));
  const svc = require(path.join(SRC, 'services', 'riskService'));
  const cats = require(path.join(SRC, 'services', 'riskCategoryService'));
  const vulns = require(path.join(SRC, 'services', 'vulnerabilityService'));

  await m.sequelize.sync({ alter: { drop: false } });
  await rm.ensureDefaultProfile();
  const mkUser = (name, role) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role });
  const admin = await mkUser('admin', 'admin');
  const owner = await mkUser('owner', 'owner');
  const other = await mkUser('other', 'owner');
  const it = await mkUser('it', 'it-staff');
  const req = (u) => ({ user: u });
  const lastAudit = async (type, id) => m.AuditLog.findOne({ where: { entity_type: type, entity_id: id }, order: [['id', 'DESC']] });

  console.log('Risk category taxonomy:');
  const c1 = await cats.ensureCategories();
  eq('first run: 10 entries seeded (9 former form values + Bedrohungslage)', [c1.seeded, c1.migrated, await m.RiskCategory.count()], [10, 0, 10]);
  await sequelize.query(`INSERT INTO risks (ref, title, category, likelihood, impact, inherent_level, treatment, status, methodology_id, created_at, updated_at) VALUES ('R-9001', 'Free text', 'Altwert Freitext', 2, 2, 'low', 'mitigate', 'open', 1, now(), now())`);
  const c2 = await cats.ensureCategories();
  const legacy = await m.RiskCategory.findOne({ where: { key: 'Altwert Freitext' } });
  eq('free-text value becomes an entry (origin migration), nothing seeded twice', [c2.seeded, c2.migrated, legacy?.origin, legacy?.active], [0, 1, 'migration', true]);
  eq('third run: nothing to do', Object.values(await cats.ensureCategories()), [0, 0]);
  eq('the risk keeps its value', (await m.Risk.findOne({ where: { ref: 'R-9001' } })).category, 'Altwert Freitext');
  const created = await cats.create({ label_de: 'Physische Sicherheit', label_en: 'Physical security' });
  eq('new entry: key derived from label_en', [created.key, created.origin], ['physical_security', 'manual']);
  eq('duplicate key → 409', await status(cats.create({ key: 'physical_security', label_de: 'x', label_en: 'x' })), 409);
  eq('invalid key → 400', await status(cats.create({ key: 'Bad Key!', label_de: 'x', label_en: 'x' })), 400);
  eq('key change → 400', await status(cats.update(await m.RiskCategory.findByPk(created.id), { key: 'other_key' })), 400);
  eq('slug without regex trimming', cats.slug('  --Größe & Ort__ '), 'groesse_ort');

  console.log('\nMethodology with impact dimensions (version 2):');
  const base = JSON.parse(JSON.stringify(rm.DEFAULT_PROFILE));
  eq('unknown dimension → 400', await status(rm.saveNewVersion({ ...base, impact_dimensions: [{ key: 'weather' }] }, admin)), 400);
  eq('appetite on a category not in the list → 400', await status(rm.saveNewVersion({ ...base, appetite: { default_max_level: null, categories: [{ category: 'nope', max_level: 'low' }] } }, admin)), 400);
  const v2 = await rm.saveNewVersion({
    ...base, name: 'With dimensions',
    impact_dimensions: [{ key: 'financial' }, { key: 'confidentiality', label_de: 'Vertraulichkeit (Kunden)' }, { key: 'availability' }],
    appetite: { default_max_level: null, categories: [{ category: 'privacy', max_level: 'medium' }] },
  }, admin, { changeNote: 'dimensions' });
  eq('version 2: dimensions in catalogue order, labels defaulted/kept', v2.profile.impact_dimensions.map(d => [d.key, d.label_de]), [['confidentiality', 'Vertraulichkeit (Kunden)'], ['availability', 'Verfügbarkeit'], ['financial', 'Finanziell']]);
  eq('scale info carries the dimensions', rm.scaleInfo(v2.profile).impact_dimensions.length, 3);
  eq('version 1 (stored before 3.7.0 style) reads as no dimensions', rm.dimensionsOf(await rm.getProfile(1)), []);
  const V2 = v2.profile.id;
  // The legacy risk is at version 1; carry it over so the next sections run on v2.
  await svc.carryOver([(await m.Risk.findOne({ where: { ref: 'R-9001' } })).id], req(admin));

  console.log('\nRationale and impact dimensions:');
  const R = { likelihood_rationale: 'Two incidents last year.', impact_rationale: 'Customer data affected.' };
  eq('create without rationale → 400', await status(svc.createRisk({ title: 'x', owner_id: owner.id, likelihood: 3, impact: 3 }, admin, req(admin))), 400);
  eq('create with only likelihood rationale → 400', await status(svc.createRisk({ title: 'x', likelihood: 3, impact: 3, likelihood_rationale: 'a' }, admin, req(admin))), 400);
  eq('blank rationale counts as missing → 400', await status(svc.createRisk({ title: 'x', likelihood: 3, impact: 3, likelihood_rationale: '  ', impact_rationale: 'b' }, admin, req(admin))), 400);
  const r1 = await svc.createRisk({ title: 'Data leak', category: 'privacy', owner_id: owner.id, likelihood: 3, impact: 1, impact_dimensions: { confidentiality: 4, availability: 2 }, ...R }, admin, req(admin));
  eq('overall impact = maximum of the rated dimensions (4), level 3x4', [r1.impact, r1.impact_dimensions, r1.inherent_level, r1.methodology_version], [4, { confidentiality: 4, availability: 2 }, 'high', 2]);
  eq('appetite on the category entry: high > medium → exceeded', [r1.appetite_max_level, r1.appetite_exceeded], ['medium', true]);
  eq('dimension not enabled in the version (legal) → 400', await status(svc.createRisk({ title: 'x', likelihood: 1, impact: 1, impact_dimensions: { legal: 2 }, ...R }, admin, req(admin))), 400);
  eq('unknown dimension key → 400', await status(svc.createRisk({ title: 'x', likelihood: 1, impact: 1, impact_dimensions: { weather: 2 }, ...R }, admin, req(admin))), 400);
  eq('dimension value beyond the scale → 400', await status(svc.createRisk({ title: 'x', likelihood: 1, impact: 1, impact_dimensions: { financial: 6 }, ...R }, admin, req(admin))), 400);
  eq('Risk.create bypassing the service: hook checks dimensions too', await status(m.Risk.create({ title: 'direct', likelihood: 1, impact: 1, impact_dimensions: { legal: 3 } })), 400);
  const noDims = await svc.createRisk({ title: 'Single value', owner_id: owner.id, likelihood: 2, impact: 3, ...R }, admin, req(admin));
  eq('without dimensions: impact is the single value, dimensions null', [noDims.impact, noDims.impact_dimensions], [3, null]);

  const upd = (risk, body, u = admin) => svc.updateRisk(risk, body, u, req(u), { partial: true });
  eq('change title only, no rationale needed', (await upd(await m.Risk.findByPk(r1.id), { title: 'Data leak (CRM)' })).title, 'Data leak (CRM)');
  eq('change likelihood without rationale → 400', await status(upd(await m.Risk.findByPk(r1.id), { likelihood: 4 })), 400);
  eq('change likelihood with only impact rationale → 400', await status(upd(await m.Risk.findByPk(r1.id), { likelihood: 4, impact_rationale: 'x' })), 400);
  eq('change likelihood with rationale → ok, impact unchanged needs none', (await upd(await m.Risk.findByPk(r1.id), { likelihood: 4, likelihood_rationale: 'Phishing wave.' })).likelihood, 4);
  eq('change a dimension without impact rationale → 400', await status(upd(await m.Risk.findByPk(r1.id), { impact_dimensions: { confidentiality: 4, availability: 3 } })), 400);
  const dimUpd = await upd(await m.Risk.findByPk(r1.id), { impact_dimensions: { confidentiality: 2, financial: 3 }, impact_rationale: 'Encrypted backups.' });
  eq('change dimensions with rationale: impact = new maximum 3', [dimUpd.impact, dimUpd.impact_dimensions, dimUpd.impact_rationale], [3, { confidentiality: 2, financial: 3 }, 'Encrypted backups.']);
  const log = await lastAudit('risk', r1.id);
  eq('audit log before/after with dimensions and rationale (signed)', [log.details.before.impact, log.details.after.impact, log.details.after.impact_rationale, !!log.integrity_hash], [4, 3, 'Encrypted backups.', true]);
  const legacyRisk = await m.Risk.findOne({ where: { ref: 'R-9001' } });
  eq('existing risk without rationale stays editable (title, treatment)', (await svc.updateRisk(legacyRisk, { title: 'Free text (renamed)', likelihood: 2, impact: 2, category: 'Altwert Freitext', treatment: 'transfer', status: 'open' }, admin, req(admin))).treatment, 'transfer');
  eq('full PUT without the new fields keeps rationale (no wipe by omission)', await (async () => {
    const x = await svc.updateRisk(await m.Risk.findByPk(r1.id), { title: 'Data leak (CRM)', category: 'privacy', owner_id: owner.id, likelihood: 4, impact: 3, treatment: 'mitigate', status: 'open' }, admin, req(admin));
    return [x.likelihood_rationale, x.impact_dimensions];
  })(), ['Phishing wave.', { confidentiality: 2, financial: 3 }]);

  console.log('\nCategories on risks:');
  await cats.update(await m.RiskCategory.findOne({ where: { key: 'other' } }), { active: false });
  eq('inactive category for a new risk → 400', await status(svc.createRisk({ title: 'x', category: 'other', likelihood: 1, impact: 1, ...R }, admin, req(admin))), 400);
  eq('unknown category → 400', await status(svc.createRisk({ title: 'x', category: 'free text', likelihood: 1, impact: 1, ...R }, admin, req(admin))), 400);
  await sequelize.query(`UPDATE risks SET category = 'other' WHERE id = ${noDims.id}`);
  eq('unchanged inactive category stays valid on update', (await upd(await m.Risk.findByPk(noDims.id), { title: 'Single value (2)', category: 'other' })).category, 'other');
  eq('category in use cannot be removed → 409', await status(cats.remove(await m.RiskCategory.findOne({ where: { key: 'privacy' } }))), 409);
  eq('unused category is removed', await status(cats.remove(await m.RiskCategory.findByPk(created.id))), 'ok');
  eq('import: label (any language, case-insensitive) resolves to the key', [await cats.resolveImportValue('it security'), await cats.resolveImportValue('Datenschutz')], ['it_security', 'privacy']);
  eq('import: unknown value fails the row', await status(cats.resolveImportValue('whatever')), 'Error');
  const list = await cats.list();
  eq('category list carries risk counts', list.find(c => c.key === 'privacy').risk_count, 1);

  console.log('\nTarget risk:');
  eq('only target likelihood → 400', await status(upd(await m.Risk.findByPk(r1.id), { target_likelihood: 2 })), 400);
  const tgt = await upd(await m.Risk.findByPk(r1.id), { target_likelihood: 1, target_impact: 2 });
  eq('target 1x2 = low, no rationale needed', [tgt.target_level, tgt.target_likelihood, tgt.target_impact], ['low', 1, 2]);
  eq('target beyond the scale → 400', await status(upd(await m.Risk.findByPk(r1.id), { target_likelihood: 6, target_impact: 1 })), 400);
  eq('clear target', (await upd(await m.Risk.findByPk(r1.id), { target_likelihood: null, target_impact: null })).target_level, null);

  console.log('\nNet risk: calculation and override:');
  const ctrl = await m.Control.create({ framework: 'custom', code: 'C-1', title: 'DLP', status: 'implemented' });
  const withCtrl = await upd(await m.Risk.findByPk(r1.id), { controls: [{ id: ctrl.id, effectiveness: 3 }] });
  eq('calculated net: likelihood 4 halved → 2, impact 3 → 2x3 medium', [withCtrl.residual_likelihood, withCtrl.residual_impact, withCtrl.residual_level, withCtrl.residual_override], [2, 3, 'medium', false]);
  eq('override without reason → 400', await status(svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: true, residual_likelihood: 1, residual_impact: 1 }, admin, req(admin))), 400);
  eq('override by a non-owner owner role → 403', await status(svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: true, residual_likelihood: 1, residual_impact: 1, reason: 'x' }, other, req(other))), 403);
  eq('override beyond the scale → 400', await status(svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: true, residual_likelihood: 6, residual_impact: 1, reason: 'x' }, admin, req(admin))), 400);
  const ov = await svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: true, residual_likelihood: 1, residual_impact: 3, reason: 'DLP verified by pentest.' }, admin, req(admin));
  eq('override: flag, values, level, who, calculated value reported', [ov.residual_override, ov.residual_likelihood, ov.residual_level, ov.residual_override_by_id, ov.residual_override_reason, ov.residual_calculated?.residual_likelihood], [true, 1, 'low', admin.id, 'DLP verified by pentest.', 2]);
  const ovLog = await lastAudit('risk', r1.id);
  eq('override in the audit log with calculated value and reason', [ovLog.details.action, ovLog.details.calculated.residual_level, ovLog.details.after.residual_level, ovLog.details.reason], ['residual_override', 'medium', 'low', 'DLP verified by pentest.']);
  const keep = await upd(await m.Risk.findByPk(r1.id), { controls: [{ id: ctrl.id, effectiveness: 1 }] });
  eq('control changes do not touch an overridden net risk', [keep.residual_likelihood, keep.residual_override, keep.residual_calculated.residual_likelihood], [1, true, 3]);
  const back = await svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: false }, admin, req(admin));
  eq('back to calculation: recalculated, reason cleared, logged', [back.residual_override, back.residual_likelihood, back.residual_override_reason, (await lastAudit('risk', r1.id)).details.action], [false, 3, null, 'residual_override_removed']);
  eq('remove override when none → 400', await status(svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: false }, admin, req(admin))), 400);

  console.log('\nVulnerabilities and scenarios:');
  const asset = await m.Asset.create({ name: 'CRM server', type: 'software', classification: 'internal', owner_id: owner.id, assessor_id: admin.id, cve_ids: [
    { id: 'CVE-2026-1111', severity: 'CRITICAL', score: 9.8, description: 'RCE in CRM' },
    { id: 'cve-2026-2222', severity: 'medium', score: 5 },
    { id: 'not-a-cve' },
  ] });
  const asset2 = await m.Asset.create({ name: 'CRM replica', type: 'software', classification: 'internal', owner_id: owner.id, assessor_id: admin.id, cve_ids: [{ id: 'CVE-2026-1111', severity: 'critical', score: 9.8 }] });
  const threat = await m.Threat.create({ source: 'custom', code: 'T-1', title: 'Exploit' });
  const listCves = await vulns.assetCves(asset.id);
  eq('asset CVEs: valid ids only, normalised, none registered yet', listCves.cves.map(c => [c.cve_id, c.severity, c.cvss_score, c.vulnerability]), [['CVE-2026-1111', 'critical', 9.8, null], ['CVE-2026-2222', 'medium', 5, null]]);
  eq('nothing is created automatically', await m.Vulnerability.count(), 0);
  const imp = await vulns.importAssetCves(asset.id, ['CVE-2026-1111'], it, req(it));
  eq('take over one CVE by request', [imp.created.length, imp.created[0].cve_id, imp.linked.length], [1, 'CVE-2026-1111', 0]);
  eq('again: unchanged', (await vulns.importAssetCves(asset.id, ['cve-2026-1111'], it, req(it))).unchanged.length, 1);
  eq('same CVE from a second asset: asset linked, no second entry', [(await vulns.importAssetCves(asset2.id, ['CVE-2026-1111'], it, req(it))).linked.length, await m.Vulnerability.count()], [1, 1]);
  eq('CVE not in the asset data → 400', await status(vulns.importAssetCves(asset2.id, ['CVE-2026-2222'], it, req(it))), 400);
  eq('malformed CVE id → 400', await status(vulns.importAssetCves(asset.id, ['CVE-1'], it, req(it))), 400);
  eq('unique index: one vulnerability per CVE', await status(async () => { await vulns.ensureIndexes(); await m.Vulnerability.create({ title: 'dup', source: 'cve', cve_id: 'CVE-2026-1111' }); }), 'SequelizeUniqueConstraintError');
  const cveV = await m.Vulnerability.findOne({ where: { cve_id: 'CVE-2026-1111' } });
  eq('CVE entry: ref, severity, score, source, audit', [cveV.ref, cveV.severity, Number(cveV.cvss_score), cveV.source, (await lastAudit('vulnerability', cveV.id)).details.action], [`V-${String(cveV.id).padStart(4, '0')}`, 'critical', 9.8, 'cve', 'asset_linked']);
  const manual = await vulns.createVulnerability({ title: 'Weak admin passwords', severity: 'high', asset_ids: [asset.id], source: 'cve', cve_id: 'CVE-2000-0001' }, admin, req(admin));
  eq('manual vulnerability: source/cve_id not settable by the client', [manual.source, manual.cve_id, manual.assets.map(a => a.id)], ['manual', null, [asset.id]]);
  eq('unknown asset → 400', await status(vulns.createVulnerability({ title: 'x', asset_ids: [999999] }, admin, req(admin))), 400);

  eq('scenario without asset, threat or vulnerability → 400', await status(upd(await m.Risk.findByPk(r1.id), { scenarios: [{ description: 'empty' }] })), 400);
  eq('scenario with unknown vulnerability → 400', await status(upd(await m.Risk.findByPk(r1.id), { scenarios: [{ vulnerability_id: 999999 }] })), 400);
  const withSc = await upd(await m.Risk.findByPk(r1.id), { scenarios: [
    { asset_ids: [asset.id, asset2.id], threat_id: threat.id, vulnerability_id: cveV.id, description: 'RCE on both CRM nodes' },
    { asset_ids: [asset.id], vulnerability_id: manual.id },
  ] });
  eq('scenarios stored: assets x threat x vulnerability, order kept', withSc.scenarios.map(s => [s.assets.map(a => a.id).sort(), s.threat?.id ?? null, s.vulnerability?.id]), [[[asset.id, asset2.id].sort(), threat.id, cveV.id], [[asset.id], null, manual.id]]);
  eq('scenario change in the audit log', (await lastAudit('risk', r1.id)).details.scenarios.after.length, 2);
  const regList = await m.Risk.findAll({ include: svc.includeAll() });
  eq('register list does not carry scenarios (detail only)', regList.every(r => r.scenarios === undefined), true);
  const vd = await vulns.getVulnerability(cveV.id, owner);
  eq('vulnerability detail: risks the user may see (owner of r1)', [vd.risks.map(r => r.id), vd.hidden_risk_count], [[r1.id], 0]);
  eq('… other owner: risk only counted', ((v) => [v.risks.length, v.hidden_risk_count])(await vulns.getVulnerability(cveV.id, other)), [0, 1]);
  eq('vulnerability list: risk count, asset filter', ((l) => [l.length, l[0].risk_count])(await vulns.listVulnerabilities({ asset_id: String(asset2.id) })), [1, 1]);
  eq('vulnerability used in a scenario cannot be deleted → 409', await status(vulns.deleteVulnerability(await m.Vulnerability.findByPk(manual.id), req(admin))), 409);
  const unused = await vulns.createVulnerability({ title: 'Temp' }, admin, req(admin));
  eq('unused vulnerability is deleted, logged', [await status(vulns.deleteVulnerability(await m.Vulnerability.findByPk(unused.id), req(admin))), (await lastAudit('vulnerability', unused.id)).action], ['ok', 'delete']);
  const tmpRisk = await svc.createRisk({ title: 'Temp risk', likelihood: 1, impact: 1, scenarios: [{ asset_ids: [asset.id] }], ...R }, admin, req(admin));
  await (await m.Risk.findByPk(tmpRisk.id)).destroy();
  eq('scenarios go with their risk', await m.RiskScenario.count({ where: { risk_id: tmpRisk.id } }), 0);

  console.log('\nReassessment and carry-over with dimensions:');
  await svc.overrideResidual(await m.Risk.findByPk(r1.id), { override: true, residual_likelihood: 1, residual_impact: 1, reason: 'test' }, admin, req(admin));
  await upd(await m.Risk.findByPk(r1.id), { target_likelihood: 1, target_impact: 1 });
  const v3 = await rm.saveNewVersion({ ...base, name: 'Without financial', impact_dimensions: [{ key: 'confidentiality' }, { key: 'availability' }] }, admin);
  const co = await svc.carryOver([r1.id, noDims.id], req(admin));
  eq('carry-over: risk with a dimension the version dropped is skipped', [co.carried.map(c => c.id), co.skipped.map(s => [s.id, s.reason])], [[noDims.id], [[r1.id, 'dimensions_changed']]]);
  eq('reassess without rationales → 400', await status(upd(await m.Risk.findByPk(r1.id), { reassess: true, likelihood: 2, impact: 2 })), 400);
  const re = await upd(await m.Risk.findByPk(r1.id), { reassess: true, likelihood: 2, impact: 2, ...R });
  eq('reassess: active version, old dimensions/override/target dropped, net recalculated', [re.methodology_version, re.impact_dimensions, re.residual_override, re.target_level, re.residual_likelihood], [v3.profile.version, null, false, null, 2]);
  const reLog = await lastAudit('risk', r1.id);
  eq('reassess audit: override cleared noted, rationale recorded', [reLog.details.action, reLog.details.override_cleared, reLog.details.impact_rationale], ['reassess', true, R.impact_rationale]);
  eq('version 2 stays readable with its dimensions', (await rm.getProfile(V2)).impact_dimensions.length, 3);

  await m.sequelize.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
