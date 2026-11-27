#!/usr/bin/env node
'use strict';

/**
 * Integration test against a THROWAWAY Postgres database: risk analysis per
 * BSI-Standard 200-3, realisation plan and reports (3.10.0).
 *
 *   1. Selection: protection need from the CIA assessment, no module,
 *      scenario not covered; manual include/exclude with reason; visibility
 *      through the asset of the target object; progress.
 *   2. Threat overview: 47 elementary threats, relevance/coverage, additional
 *      threats (existing / new with threats.create), signed audit entries.
 *   3. Classification -> one risk (asset x threat), second run updates it,
 *      concurrent runs create one risk, record rights, risks.create, deleted
 *      risk -> new risk on the next classification.
 *   4. Consolidation: treatment items as additional requirements in the
 *      check; realisation plan (nein/teilweise + taken-over measures),
 *      priority, export rows, visibility.
 *   5. Reports: risk report, treatment plan, A.1-A.6 as DOCX and PDF -
 *      parsed back; "Keine Daten" where data is missing. Sample files are
 *      written to REPORT_SAMPLE_DIR when set.
 *   6. A target object with analysis data stays in its domain.
 *
 * Runs only with BSI_RISK_ANALYSIS_TEST_DB=1 and DB_* pointing at an empty
 * test database - schema public is dropped:
 *
 *   BSI_RISK_ANALYSIS_TEST_DB=1 DB_HOST=/tmp DB_PORT=55435 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x ENCRYPTION_KEY=x node scripts/test-bsi-risk-analysis-db.js
 */

if (process.env.BSI_RISK_ANALYSIS_TEST_DB !== '1') {
  console.log('Skipped (set BSI_RISK_ANALYSIS_TEST_DB=1 and DB_* for a throwaway database).');
  process.exit(0);
}

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const NM = path.join(SRC, '..', 'node_modules');
const { kompendiumXml } = require('./fixtures/bsi-catalog');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await (typeof p === 'function' ? p() : p); return 'ok'; } catch (e) { if (process.env.DEBUG_TEST) console.log('   ', e.message); return e.status || e.name; } };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const m = require(path.join(SRC, 'models'));
  const rm = require(path.join(SRC, 'services', 'riskMethodology'));
  const cats = require(path.join(SRC, 'services', 'riskCategoryService'));
  const acc = require(path.join(SRC, 'services', 'riskAcceptanceService'));
  const mon = require(path.join(SRC, 'services', 'riskMonitoringService'));
  const hist = require(path.join(SRC, 'services', 'riskHistoryService'));
  const catalogs = require(path.join(SRC, 'services', 'bsiCatalogService'));
  const { parseCatalog } = require(path.join(SRC, 'services', 'bsiCatalogParsers'));
  const domains = require(path.join(SRC, 'services', 'bsiDomainService'));
  const check = require(path.join(SRC, 'services', 'bsiCheckService'));
  const ra = require(path.join(SRC, 'services', 'bsiRiskAnalysisService'));
  const riskService = require(path.join(SRC, 'services', 'riskService'));
  const reports = require(path.join(SRC, 'services', 'reportService'));
  const render = require(path.join(SRC, 'services', 'reportRender'));
  const { seedCatalog } = require(path.join(SRC, 'services', 'catalogSeed'));

  await m.sequelize.sync({ alter: { drop: false } });
  await rm.ensureDefaultProfile();
  await cats.ensureCategories();
  await acc.ensureIndexes();
  await mon.ensureIndexes();
  await hist.ensureBaseline();
  await seedCatalog();
  const kBuf = Buffer.from(kompendiumXml());
  // Roles reach users only through groups (v3.10.0): every test user joins the
  // group carrying their role (custom role wins), as the migration would do.
  const access = require(path.join(SRC, 'services', 'accessService'));
  const mkUser = async (name, role, extra = {}) => {
    const u = await m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role, ...extra });
    const g = extra.custom_role_id
      ? await access.groupForCustomRole(await m.CustomRole.findByPk(extra.custom_role_id))
      : await access.groupForSystemRole(role);
    await m.GroupMember.create({ group_id: g.id, user_id: u.id, source: 'manual' });
    await access.syncUserRoles([u.id]);
    return u.reload();
  };
  const admin = await mkUser('admin', 'admin');
  const assessor = await mkUser('assessor', 'assessor');
  const owner = await mkUser('owner', 'owner');
  const other = await mkUser('other', 'owner');
  const dpo = await mkUser('dpo', 'dpo');
  const noCreate = await m.CustomRole.create({ name: 'no risk create', base_role: 'assessor', permissions: { risks: { create: false } } });
  const restricted = await mkUser('restricted', 'assessor', { custom_role_id: noCreate.id });
  const req = (u) => ({ user: { id: u.id, name: u.name, role: u.role, custom_role_id: u.custom_role_id ?? null }, ip: '127.0.0.1' });
  const actor = (u) => ({ id: u.id, name: u.name, role: u.role, custom_role_id: u.custom_role_id ?? null });
  const kCat = await catalogs.storeCatalog(parseCatalog(kBuf), { source: 'upload', buffer: kBuf });
  await catalogs.activateCatalog(kCat.id, admin.id);
  const { domain } = await domains.ensureDefaultDomain();
  const D = domain.id;
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_bsi_modelings_target_module ON bsi_modelings (domain_id, COALESCE(target_object_id, 0), module_id)');
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_bsi_requirements_domain_target_req ON bsi_requirements (domain_id, COALESCE(target_object_id, 0), req_id)');
  const mkAsset = (name, type, ownerId) => m.Asset.create({ name, type, classification: 'internal', owner_id: ownerId, assessor_id: admin.id });
  const srv = await mkAsset('srv-01', 'hardware', owner.id);
  const erp = await mkAsset('ERP', 'application', admin.id);
  const proc = await mkAsset('Einkauf', 'process', admin.id);
  const assess = (asset, c, i, a) => m.Assessment.create({ asset_id: asset.id, assessor_id: admin.id, confidentiality: c, integrity: i, availability: a, risk_score: 2, risk_level: 'low', next_review_at: new Date(Date.now() + 864e5), notes: `Begründung ${asset.name}` });
  await assess(srv, 4, 2, 3);
  await assess(erp, 2, 3, 2);
  const tSrv = (await domains.addTargetObject(D, { asset_id: srv.id }, admin)).targetObject;
  const tErp = (await domains.addTargetObject(D, { asset_id: erp.id }, admin)).targetObject;
  const tProc = (await domains.addTargetObject(D, { asset_id: proc.id }, admin)).targetObject;
  await domains.addModeling(D, { module_id: 'ORP.1', target_object_id: tSrv.id }, admin);
  await domains.addModeling(D, { module_id: 'ORP.1', target_object_id: tErp.id }, admin);
  await domains.addModeling(D, { module_id: 'ISMS.1' }, admin);

  console.log('Selection:');
  let ov = await ra.getAnalysis(D, actor(admin));
  const byId = (o, id) => o.targets.find(t => t.target_object_id === id);
  eq('srv: high protection need (C=4) -> selected', [byId(ov, tSrv.id).protection_need.overall, byId(ov, tSrv.id).reasons, byId(ov, tSrv.id).included], ['high', ['high_protection_need'], true]);
  eq('ERP: normal, modelled -> not selected', [byId(ov, tErp.id).protection_need.overall, byId(ov, tErp.id).reasons, byId(ov, tErp.id).included], ['normal', [], false]);
  eq('process: no assessment, no module -> selected (no_module)', [byId(ov, tProc.id).protection_need, byId(ov, tProc.id).reasons, byId(ov, tProc.id).included], [null, ['no_module'], true]);
  eq('47 elementary threats', byId(ov, tSrv.id).threats.elementary_total, 47);
  eq('summary', [ov.summary.target_objects, ov.summary.included, ov.summary.without_protection_need, ov.catalog_threat_mapping.available], [3, 2, 1, false]);
  eq('owner sees only the target object of his asset', (await ra.getAnalysis(D, actor(owner))).targets.map(t => t.asset.name), ['srv-01']);
  eq('owner: foreign target object -> 404', await status(ra.getTargetAnalysis(D, tErp.id, actor(owner))), 404);
  eq('include without reason -> 400', await status(ra.setTargetDecision(D, tErp.id, { decision: 'include' }, actor(assessor), req(assessor))), 400);
  await ra.setTargetDecision(D, tErp.id, { decision: 'include', decision_reason: 'Internet-facing, special scenario' }, actor(assessor), req(assessor));
  eq('ERP included by hand', (await ra.getTargetAnalysis(D, tErp.id, actor(admin))).included, true);
  const auditRow = await m.AuditLog.findOne({ where: { entity_type: 'bsi_risk_analysis_target' }, order: [['id', 'DESC']] });
  eq('audit: signed entry with before/after', [!!auditRow.integrity_hash, auditRow.actor_id, auditRow.details.after.decision], [true, assessor.id, 'include']);
  eq('scenario flag without note -> 400', await status(ra.setTargetDecision(D, tProc.id, { scenario_not_covered: true }, actor(admin), req(admin))), 400);
  await ra.setTargetDecision(D, tProc.id, { decision: 'exclude', decision_reason: 'Covered by the domain-wide modules' }, actor(admin), req(admin));
  eq('process excluded by hand despite no_module', [(await ra.getTargetAnalysis(D, tProc.id, actor(admin))).included, (await ra.getTargetAnalysis(D, tProc.id, actor(admin))).reasons], [false, ['no_module']]);
  eq('mass assignment: domain_id / target_object_id from the body ignored', await status(ra.setTargetDecision(D, tSrv.id, { status: 'in_progress', domain_id: 999, target_object_id: tErp.id }, actor(admin), req(admin))), 'ok');
  eq('srv row belongs to srv', (await m.BsiRiskAnalysisTarget.findOne({ where: { target_object_id: tSrv.id } })).domain_id, D);

  console.log('Threat overview:');
  const g01 = await m.Threat.findOne({ where: { source: 'bsi_elementar', code: 'G 0.1' } });
  const g18 = await m.Threat.findOne({ where: { source: 'bsi_elementar', code: 'G 0.18' } });
  const common = await m.Threat.findOne({ where: { source: 'common' } });
  eq('excluded target object -> 409', await status(ra.setThreatAssessment(D, tProc.id, g01.id, { relevant: true }, actor(admin), req(admin))), 409);
  await ra.setThreatAssessment(D, tSrv.id, g01.id, { relevant: true, relevance_note: 'Server room', coverage: 'partially', coverage_note: 'INF not modelled' }, actor(assessor), req(assessor));
  await ra.setThreatAssessment(D, tSrv.id, g18.id, { relevant: false, relevance_note: 'n/a' }, actor(assessor), req(assessor));
  let ta = await ra.getTargetAnalysis(D, tSrv.id, actor(admin));
  eq('overview: 47 lines, G 0.1 first, assessed values', [ta.threats.length, ta.threats[0].threat.code, ta.threats[0].relevant, ta.threats[0].coverage, ta.threats[0].assessed_by?.id], [47, 'G 0.1', true, 'partially', assessor.id]);
  eq('invalid coverage -> 400', await status(ra.setThreatAssessment(D, tSrv.id, g01.id, { coverage: 'mostly' }, actor(admin), req(admin))), 400);
  eq('non-elementary threat not in the overview -> 404', await status(ra.setThreatAssessment(D, tSrv.id, common.id, { relevant: true }, actor(admin), req(admin))), 404);
  await ra.addAdditionalThreat(D, tSrv.id, { threat_id: common.id, relevance_note: 'Seen in pen test' }, actor(assessor), req(assessor));
  eq('additional (existing) threat added, relevant, not covered', (await ra.getTargetAnalysis(D, tSrv.id, actor(admin))).threats.filter(t => t.additional).map(t => [t.threat.id, t.relevant, t.coverage]), [[common.id, true, 'not_covered']]);
  eq('elementary as additional -> 409; duplicate -> 409', [await status(ra.addAdditionalThreat(D, tSrv.id, { threat_id: g01.id }, actor(admin), req(admin))), await status(ra.addAdditionalThreat(D, tSrv.id, { threat_id: common.id }, actor(admin), req(admin)))], [409, 409]);
  eq('new threat without threats.create (assessor) -> 403', await status(ra.addAdditionalThreat(D, tSrv.id, { title: 'Insider sabotage' }, actor(assessor), req(assessor))), 403);
  const newRow = await ra.addAdditionalThreat(D, tSrv.id, { title: 'Insider sabotage', code: 'Z.1' }, actor(admin), req(admin));
  const created = await m.Threat.findByPk(newRow.threat_id);
  eq('new threat by admin: custom threat, audit', [created.source, created.code, !!(await m.AuditLog.findOne({ where: { entity_type: 'threat', entity_id: created.id } }))], ['custom', 'Z.1', true]);

  console.log('Classification:');
  const R = { likelihood_rationale: 'Twice in 5 years.', impact_rationale: 'Production stops.' };
  eq('not relevant threat -> 409', await status(ra.classifyThreat(D, tSrv.id, g18.id, { likelihood: 2, impact: 2, ...R }, actor(admin), req(admin))), 409);
  eq('missing rationale -> 400', await status(ra.classifyThreat(D, tSrv.id, g01.id, { likelihood: 2, impact: 4 }, actor(admin), req(admin))), 400);
  eq('missing likelihood -> 400', await status(ra.classifyThreat(D, tSrv.id, g01.id, { impact: 4, ...R }, actor(admin), req(admin))), 400);
  eq('value outside the active scale -> 400', await status(ra.classifyThreat(D, tSrv.id, g01.id, { likelihood: 6, impact: 4, ...R }, actor(admin), req(admin))), 400);
  eq('custom role without risks.create -> 403', await status(ra.classifyThreat(D, tSrv.id, g01.id, { likelihood: 2, impact: 4, ...R }, actor(restricted), req(restricted))), 403);
  const c1 = await ra.classifyThreat(D, tSrv.id, g01.id, { likelihood: 2, impact: 4, ...R }, actor(assessor), req(assessor));
  const risk1 = await m.Risk.findByPk(c1.risk.id, { include: riskService.includeDetail() });
  eq('first classification creates the risk: scenario asset x threat, owner = asset owner, level', [c1.created, risk1.scenarios.length, risk1.scenarios[0].threat_id, risk1.scenarios[0].assets.map(a => a.id), risk1.owner_id, risk1.likelihood, risk1.impact, risk1.inherent_level], [true, 1, g01.id, [srv.id], owner.id, 2, 4, 'medium']);
  eq('risk title names threat and target object', risk1.title, 'G 0.1 Feuer – srv-01');
  const count1 = await m.Risk.count();
  const c2 = await ra.classifyThreat(D, tSrv.id, g01.id, { likelihood: 3, impact: 4, likelihood_rationale: 'More often now.', impact_rationale: 'Production stops.' }, actor(assessor), req(assessor));
  eq('second classification updates the same risk, no new one', [c2.created, c2.risk.id, await m.Risk.count(), (await m.Risk.findByPk(c1.risk.id)).likelihood], [false, c1.risk.id, count1, 3]);
  eq('dpo (sees asset, not risk owner) changing the risk -> 403', await status(ra.classifyThreat(D, tSrv.id, g01.id, { likelihood: 1, impact: 1, ...R }, actor(dpo), req(dpo))), 403);
  const par = await Promise.all([1, 2, 3].map(() => ra.classifyThreat(D, tSrv.id, common.id, { likelihood: 2, impact: 2, ...R }, actor(admin), req(admin)).then(r => r.created, e => e.status || e.message)));
  eq('three concurrent classifications: one risk created, two updates', [par.filter(x => x === true).length, par.filter(x => x === false).length, await m.Risk.count()], [1, 2, count1 + 1]);
  const classifyAudit = await m.AuditLog.findOne({ where: { entity_type: 'bsi_risk_analysis_threat' }, order: [['id', 'DESC']] });
  eq('classification audit-logged and signed', [classifyAudit.details.action, !!classifyAudit.integrity_hash], ['classify', true]);
  ta = await ra.getTargetAnalysis(D, tSrv.id, actor(admin));
  eq('overview shows the risk', ta.threats.find(t => t.threat.id === g01.id).risk.id, c1.risk.id);
  const viewerNoRisks = await m.CustomRole.create({ name: 'no risks', base_role: 'assessor', permissions: { risks: { view: false } } });
  const blind = await mkUser('blind', 'assessor', { custom_role_id: viewerNoRisks.id });
  require(path.join(SRC, 'services', 'permissionService')).invalidatePermissionCache();
  const tb = await ra.getTargetAnalysis(D, tSrv.id, actor(blind));
  eq('without risks.view: no risk details, only has_risk', [tb.threats.find(t => t.threat.id === g01.id).risk, tb.threats.find(t => t.threat.id === g01.id).has_risk, tb.additional_measures.length], [null, true, 0]);

  console.log('Consolidation and realisation plan:');
  const risk1Row = await m.Risk.findByPk(c1.risk.id);
  const item = await riskService.createTreatmentItem(risk1Row, { title: 'Fire extinguisher in server room', treatment_option: 'mitigate', responsible_user_id: owner.id, due_date: '2027-03-01', cost_once: 450 }, actor(admin), req(admin));
  const item2 = await riskService.createTreatmentItem(risk1Row, { title: 'Old idea', status: 'discarded', status_reason: 'Too expensive' }, actor(admin), req(admin));
  ta = await ra.getTargetAnalysis(D, tSrv.id, actor(admin));
  eq('additional measures: active items of the risk, not discarded', ta.additional_measures.map(x => [x.title, x.in_realization_plan]), [['Fire extinguisher in server room', false]]);
  let c = await check.getCheck(D, actor(admin));
  eq('check: additional requirement at the target object', c.additional_requirements.map(a => [a.target_object_id, a.measures.map(x => x.title)]), [[tSrv.id, ['Fire extinguisher in server room']]]);
  eq('check of another user without rights on the item: none', (await check.getCheck(D, actor(dpo))).additional_requirements.length, 0);
  eq('discarded item into plan -> 409', await status(ra.addRealizationMeasure(D, { treatment_item_id: item2.id }, actor(admin), req(admin))), 409);
  const foreignRisk = await riskService.createRisk({ title: 'Other', likelihood: 2, impact: 2, ...R }, admin, req(admin));
  const foreignItem = await riskService.createTreatmentItem(await m.Risk.findByPk(foreignRisk.id), { title: 'Elsewhere' }, actor(admin), req(admin));
  eq('item of a risk outside the analysis -> 409', await status(ra.addRealizationMeasure(D, { treatment_item_id: foreignItem.id }, actor(admin), req(admin))), 409);
  eq('invalid priority -> 400', await status(ra.addRealizationMeasure(D, { treatment_item_id: item.id, priority: 'urgent' }, actor(admin), req(admin))), 400);
  const link = await ra.addRealizationMeasure(D, { treatment_item_id: item.id }, actor(assessor), req(assessor));
  eq('duplicate -> 409', await status(ra.addRealizationMeasure(D, { treatment_item_id: item.id }, actor(admin), req(admin))), 409);
  await check.setCheckEntry(D, { target_object_id: tErp.id, req_id: 'ORP.1.A1', implementation_status: 'not_implemented', justification: 'Not yet', realization_priority: 'low', due_date: '2027-06-30', cost_once: 1000 }, actor(admin));
  await check.setCheckEntry(D, { target_object_id: null, req_id: 'ISMS.1.A1', implementation_status: 'in_progress', responsible_id: owner.id }, actor(admin));
  await check.setCheckEntry(D, { target_object_id: null, req_id: 'ISMS.1.A3', implementation_status: 'implemented' }, actor(admin));
  eq('invalid realization_priority -> 400', await status(check.setCheckEntry(D, { req_id: 'ISMS.1.A1', realization_priority: 'x' }, actor(admin))), 400);
  let plan = await ra.getRealizationPlan(D, actor(admin));
  eq('plan: nein/teilweise + measure, sorted by priority then due date', plan.items.map(i => [i.kind, i.ref, i.priority, i.priority_source]), [
    ['measure', risk1.ref, 'high', 'suggested'], ['requirement', 'ISMS.1.A1', 'high', 'suggested'], ['requirement', 'ORP.1.A1', 'low', 'set']]);
  eq('plan summary: costs, without due date, not checked', [plan.summary.items, plan.summary.cost_once_total, plan.summary.without_due_date, plan.summary.not_checked_requirements > 0], [3, 1450, 1, true]);
  await ra.updateRealizationMeasure(D, link.id, { priority: 'high' }, actor(admin), req(admin));
  plan = await ra.getRealizationPlan(D, actor(admin));
  eq('measure priority set', plan.items.find(i => i.kind === 'measure').priority_source, 'set');
  await ra.updateRealizationMeasure(D, link.id, { priority: 'medium' }, actor(admin), req(admin));
  plan = await ra.getRealizationPlan(D, actor(admin));
  eq('set priority wins over the suggestion (risk high -> set medium)', plan.items.map(i => i.ref), ['ISMS.1.A1', risk1.ref, 'ORP.1.A1']);
  const a6 = ra.buildA6Rows(plan);
  eq('A.6 rows: one per item, costs numeric', [a6.rows.length, a6.rows.find(r => r[3] === 'ORP.1.A1')[10]], [3, 1000]);
  eq('owner sees the measure (risk owner, responsible) but only check entries of visible target objects', (await ra.getRealizationPlan(D, actor(owner))).items.map(i => i.ref).sort(), ['ISMS.1.A1', risk1.ref].sort());
  eq('other user: no measure', (await ra.getRealizationPlan(D, actor(other))).items.filter(i => i.kind === 'measure').length, 0);
  eq('other user cannot change the plan entry -> 404', await status(ra.updateRealizationMeasure(D, link.id, { priority: 'low' }, actor(other), req(other))), 404);

  console.log('Removal, deleted risk:');
  eq('target object with analysis data -> 409', await status(domains.removeTargetObject(D, tProc.id, actor(admin))), 409);
  await ra.removeRealizationMeasure(D, link.id, actor(admin), req(admin));
  eq('measure removed from plan, treatment item stays', [await m.BsiRealizationMeasure.count(), !!(await m.RiskTreatmentItem.findByPk(item.id))], [0, true]);
  const commonRow = await m.BsiRiskAnalysisThreat.findOne({ where: { target_object_id: tSrv.id, threat_id: common.id } });
  await (await m.Risk.findByPk(commonRow.risk_id)).destroy();
  eq('deleted risk: overview line without risk (SET NULL)', (await commonRow.reload()).risk_id, null);
  const c3 = await ra.classifyThreat(D, tSrv.id, common.id, { likelihood: 2, impact: 3, ...R }, actor(admin), req(admin));
  eq('next classification creates a new risk', [c3.created, (await commonRow.reload()).risk_id === c3.risk.id], [true, true]);

  console.log('Reports:');
  const AdmZip = require(path.join(NM, 'adm-zip'));
  const { PDFParse } = require(path.join(NM, 'pdf-parse'));
  const outDir = process.env.REPORT_SAMPLE_DIR || null;
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const both = async (label, doc, needles) => {
    const docx = await render.render(doc, 'docx');
    const xml = new AdmZip(docx).readAsText('word/document.xml');
    const pdf = await render.render(doc, 'pdf');
    const parser = new PDFParse({ data: pdf });
    const parsed = await parser.getText();
    await parser.destroy();
    const text = parsed.text.replace(/\s+/g, ' ');
    if (outDir) {
      fs.writeFileSync(path.join(outDir, `${label}.docx`), docx);
      fs.writeFileSync(path.join(outDir, `${label}.pdf`), pdf);
    }
    eq(`${label}: DOCX and PDF parse, contain ${needles.join(' | ')}`, [docx.slice(0, 2).toString(), pdf.slice(0, 5).toString(), needles.every(n => xml.includes(n)), needles.every(n => text.includes(n)), parsed.total > 0], ['PK', '%PDF-', true, true, true]);
  };
  await both('risikobericht', await reports.buildRiskReport(actor(admin)), ['Risikobericht', 'Heatmaps', 'G 0.1 Feuer', 'Akzeptierte Risiken', 'Keine akzeptierten Risiken.']);
  await both('risikobehandlungsplan', await reports.buildTreatmentPlanReport(actor(admin)), ['Risikobehandlungsplan', 'Fire extinguisher in server room', '450.00 EUR']);
  const all = await reports.buildBsiReport(D, 'all', actor(admin));
  eq('A.1-A.6: six sections in order', all.doc.sections.map(s => s.heading.slice(0, 3)), ['A.1', 'A.2', 'A.3', 'A.4', 'A.5', 'A.6']);
  await both('bsi-referenzdokumente', all.doc, ['Strukturanalyse', 'srv-01', 'hoch (4)', 'keine Daten', 'ORP.1', 'G 0.1 Feuer', 'Realisierungsplan', 'ORP.1.A1']);
  eq('A.2: missing assessment marked "keine Daten"', JSON.stringify(all.doc.sections[1]).includes('liegt keine Schutzbedarfsbewertung'), true);
  const a5owner = await reports.buildBsiReport(D, 'a5', actor(owner));
  eq('A.5 for the owner: only his target object', JSON.stringify(a5owner.doc).includes('ERP'), false);
  eq('unknown document -> 400', await status(reports.buildBsiReport(D, 'a7', actor(admin))), 400);
  eq('unknown domain -> 404', await status(reports.buildBsiReport(99999, 'a1', actor(admin))), 404);
  const emptyDomain = await domains.createDomain({ name: 'Leer' }, actor(admin));
  const empty = await reports.buildBsiReport(emptyDomain.id, 'all', actor(admin));
  eq('empty domain: every part says "Keine ..." instead of inventing data', empty.doc.sections.map(s => s.blocks.some(b => b.type === 'nodata')), [true, true, true, true, true, true]);
  await both('bsi-leerer-verbund', empty.doc, ['Keine Zielobjekte erfasst.']);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  await sequelize.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
