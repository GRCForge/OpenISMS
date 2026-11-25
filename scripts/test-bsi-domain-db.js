#!/usr/bin/env node
'use strict';

/**
 * Integrationstest gegen eine WEGWERF-Postgres-Datenbank: Informationsverbund,
 * Zielobjekte und Modellierung.
 *
 *   1. Bestand wie in v3.4.0 (bsi_requirements mit catalog_id/retired, ohne
 *      domain_id, mit Statusdaten) -> Sync + Startmigration: Standard-Verbund,
 *      Zuordnung ohne Verlust, idempotent.
 *   2. Zielobjekte: Typvorschlag, Dubletten, Sichtbarkeit (Rolle owner,
 *      Matrix assets.view = false), Verbundgrenzen.
 *   3. Modellierung: Systembausteine nur an Zielobjekten, Zielobjekt eines
 *      anderen Verbunds abgelehnt, Dubletten auch auf Verbundebene (NULL).
 *   4. Katalogwechsel: Verbuende folgen dem aktiven Katalog; angelegt wird nur
 *      im Standard-Verbund, Zeilen anderer Verbuende werden nur aktualisiert.
 *
 * Laeuft nur mit BSI_CATALOG_TEST_DB=1 und DB_*-Variablen auf eine leere
 * Testdatenbank - das Schema public wird geloescht und neu angelegt:
 *
 *   BSI_CATALOG_TEST_DB=1 DB_HOST=/tmp DB_PORT=55432 DB_NAME=openisms_test \
 *   DB_USER=oitest DB_PASSWORD=x JWT_SECRET=x node scripts/test-bsi-domain-db.js
 */

if (process.env.BSI_CATALOG_TEST_DB !== '1') {
  console.log('Uebersprungen (BSI_CATALOG_TEST_DB=1 und DB_* fuer eine Wegwerf-Datenbank setzen).');
  process.exit(0);
}

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');
const { DataTypes } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'sequelize'));
const { kompendiumXml } = require('./fixtures/bsi-catalog');

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const status = async (p) => { try { await p; return 'ok'; } catch (e) { if (process.env.DEBUG_TEST) console.log(e.message); return e.status || e.name; } };

(async () => {
  const sequelize = require(path.join(SRC, 'config', 'database'));
  await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  // 1. Bestand wie in v3.4.0.
  const Old = sequelize.define('OldBsiRequirement', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    baustein_id: { type: DataTypes.STRING(20), allowNull: false },
    baustein_name: { type: DataTypes.STRING(255), allowNull: false },
    layer: { type: DataTypes.STRING(20), allowNull: false },
    req_id: { type: DataTypes.STRING(30), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    requirement_level: { type: DataTypes.ENUM('basis', 'standard', 'erhoehter_schutzbedarf', 'normal_sdt', 'erhoeht'), defaultValue: 'basis' },
    catalog_id: { type: DataTypes.INTEGER, allowNull: true },
    retired: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    implementation_status: { type: DataTypes.ENUM('not_started', 'in_progress', 'implemented', 'not_applicable'), defaultValue: 'not_started' },
    responsible_id: { type: DataTypes.INTEGER, allowNull: true },
    notes: { type: DataTypes.TEXT },
    last_review_date: { type: DataTypes.DATEONLY },
  }, { tableName: 'bsi_requirements', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' });
  await Old.sync();
  await Old.bulkCreate([
    { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A1', title: 'Alt A1', implementation_status: 'implemented', notes: 'Nachweis liegt vor', last_review_date: '2026-10-01' },
    { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A2', title: 'Alt A2', implementation_status: 'in_progress' },
    { baustein_id: 'ORP.1', baustein_name: 'Organisation', layer: 'ORP', req_id: 'ORP.1.A1', title: 'Alt ORP', implementation_status: 'not_applicable', notes: 'begruendet' },
    { baustein_id: 'SYS.1.1', baustein_name: 'Allgemeine Server', layer: 'SYS', req_id: 'SYS.1.1.A1', title: 'Alt SYS', implementation_status: 'not_started', retired: true, notes: 'abgeloest' },
  ]);
  sequelize.modelManager.removeModel(Old);

  const m = require(path.join(SRC, 'models'));
  await m.sequelize.sync({ alter: { drop: false } });
  const catalogs = require(path.join(SRC, 'services', 'bsiCatalogService'));
  const svc = require(path.join(SRC, 'services', 'bsiDomainService'));
  const { parseCatalog } = require(path.join(SRC, 'services', 'bsiCatalogParsers'));

  console.log('Startmigration (Seed-Katalog, dann Standard-Verbund):');
  // Stand v3.4.0: Der Seed-Katalog ist aktiv, die Zeilen haengen an ihm.
  const seed = await catalogs.ensureSeedCatalog();
  const before = await sequelize.query('SELECT req_id, implementation_status, notes, last_review_date, retired, updated_at FROM bsi_requirements ORDER BY req_id', { type: 'SELECT' });
  const mig = await svc.ensureDefaultDomain();
  eq('Standard-Verbund angelegt', [mig.created, mig.domain.name, mig.domain.is_default, mig.domain.protection_approach], [true, svc.DEFAULT_DOMAIN_NAME, true, 'standard']);
  eq('Verbund haengt am aktiven Seed-Katalog', mig.domain.catalog_id, seed.id);
  eq('alle vier Bestandszeilen zugeordnet', mig.attached, 4);
  const after = await sequelize.query('SELECT req_id, implementation_status, notes, last_review_date, retired, updated_at, domain_id FROM bsi_requirements ORDER BY req_id', { type: 'SELECT' });
  eq('Status, Notizen, Pruefdatum, retired und updated_at unveraendert',
    after.map(({ domain_id, ...r }) => r), before);
  eq('domain_id gesetzt', [...new Set(after.map(r => r.domain_id))], [mig.domain.id]);
  const again = await svc.ensureDefaultDomain();
  eq('zweiter Lauf: nichts angelegt, nichts zugeordnet', [again.created, again.attached, again.domain.id], [false, 0, mig.domain.id]);
  eq('genau ein Verbund', await m.BsiInformationDomain.count(), 1);
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_bsi_modelings_target_module ON bsi_modelings (domain_id, COALESCE(target_object_id, 0), module_id)');

  // Benutzer und Assets.
  const mkUser = (name, role, extra = {}) => m.User.create({ name, email: `${name}@test.invalid`, password_hash: 'x', role, ...extra });
  const admin = await mkUser('admin', 'admin');
  const owner = await mkUser('owner', 'owner');
  const noAssets = await m.CustomRole.create({ name: 'ohne Assets', base_role: 'assessor', permissions: { assets: { view: false } } });
  const blind = await mkUser('blind', 'assessor', { custom_role_id: noAssets.id });
  // Since 3.10.0 roles come from groups; the startup migration puts these
  // users into the groups of their roles, as it would on an upgrade.
  await require(path.join(SRC, 'services', 'accessMigration')).ensureGroupBasedAccess({ log: { log: () => {} } });
  const mkAsset = (name, type, ownerId) => m.Asset.create({ name, type, classification: 'internal', owner_id: ownerId, assessor_id: admin.id });
  const server = await mkAsset('srv-01', 'hardware', admin.id);
  const app = await mkAsset('ERP', 'application', owner.id);
  const data = await mkAsset('Kundendaten', 'information', admin.id);
  const D1 = mig.domain;

  console.log('\nZielobjekte:');
  const t1 = await svc.addTargetObject(D1.id, { asset_id: server.id }, admin);
  eq('Typ aus Asset-Typ vorgeschlagen (hardware → it_system)', t1.targetObject.target_type, 'it_system');
  eq('Dublette → 409', await status(svc.addTargetObject(D1.id, { asset_id: server.id, target_type: 'it_system' }, admin)), 409);
  eq('Information ohne Typ → 400', await status(svc.addTargetObject(D1.id, { asset_id: data.id }, admin)), 400);
  eq('ungueltiger Typ → 400', await status(svc.addTargetObject(D1.id, { asset_id: data.id, target_type: 'toaster' }, admin)), 400);
  eq('Massenzuweisung: domain_id/created_by aus dem Body ignoriert',
    await (async () => { const r = await svc.addTargetObject(D1.id, { asset_id: data.id, target_type: 'business_process', domain_id: 999, created_by_id: 999, id: 999 }, admin); return [r.targetObject.domain_id, r.targetObject.created_by_id, r.targetObject.id !== 999]; })(),
    [D1.id, admin.id, true]);
  eq('owner: fremdes Asset → 404', await status(svc.addTargetObject(D1.id, { asset_id: server.id }, owner)), 404);
  eq('unbekanntes Asset → 404', await status(svc.addTargetObject(D1.id, { asset_id: 999999 }, admin)), 404);
  const tApp = await svc.addTargetObject(D1.id, { asset_id: app.id }, admin);
  eq('application → application', tApp.targetObject.target_type, 'application');
  eq('admin sieht alle drei', (await svc.listTargetObjects(D1.id, admin)).length, 3);
  eq('owner sieht nur sein Asset', (await svc.listTargetObjects(D1.id, owner)).map(t => t.asset.name), ['ERP']);
  eq('Matrix assets.view = false: keine Zielobjekte', (await svc.listTargetObjects(D1.id, blind)).length, 0);
  eq('Matrix assets.view = false: Zuordnen → 404', await status(svc.addTargetObject(D1.id, { asset_id: server.id }, blind)), 404);
  eq('Typ aendern', (await svc.updateTargetObject(D1.id, tApp.targetObject.id, { target_type: 'it_system' }, admin)).changes, { target_type: 'it_system' });
  await svc.updateTargetObject(D1.id, tApp.targetObject.id, { target_type: 'application' }, admin);
  eq('unbekannter Verbund → 404', await status(svc.listTargetObjects(999, admin)), 404);

  console.log('\nZweiter Verbund, Verbundgrenzen:');
  const D2 = await svc.createDomain({ name: 'Verbund Produktion', protection_approach: 'kern', is_default: true, catalog_id: 999 }, admin);
  eq('angelegt mit aktivem Katalog, is_default/catalog_id nicht uebernommen', [D2.is_default, D2.catalog_id, D2.protection_approach], [false, seed.id, 'kern']);
  eq('ohne Name → 400', await status(svc.createDomain({ protection_approach: 'basis' }, admin)), 400);
  eq('falsche Variante → 400', await status(svc.createDomain({ name: 'x', protection_approach: 'hoch' }, admin)), 400);
  const t2 = await svc.addTargetObject(D2.id, { asset_id: server.id }, admin);
  eq('dasselbe Asset darf in einem anderen Verbund Zielobjekt sein', t2.targetObject.domain_id, D2.id);
  eq('Zielobjekt aus D2 in D1 bearbeiten → 404', await status(svc.updateTargetObject(D1.id, t2.targetObject.id, { notes: 'x' }, admin)), 404);

  console.log('\nModellierung:');
  eq('SYS.1.1 am IT-System', (await svc.addModeling(D1.id, { module_id: 'SYS.1.1', target_object_id: t1.targetObject.id }, admin)).modeling.module_id, 'SYS.1.1');
  eq('Dublette am Zielobjekt → 409', await status(svc.addModeling(D1.id, { module_id: 'SYS.1.1', target_object_id: t1.targetObject.id }, admin)), 409);
  eq('SYS.1.1 fuer den ganzen Verbund → 400', await status(svc.addModeling(D1.id, { module_id: 'SYS.1.1' }, admin)), 400);
  eq('Zielobjekt eines anderen Verbunds → 404', await status(svc.addModeling(D1.id, { module_id: 'SYS.2.1', target_object_id: t2.targetObject.id }, admin)), 404);
  eq('Modul nicht im Katalog → 404', await status(svc.addModeling(D1.id, { module_id: 'XYZ.9' }, admin)), 404);
  eq('ISMS.1 fuer den Verbund', (await svc.addModeling(D1.id, { module_id: 'ISMS.1' }, admin)).modeling.target_object_id, null);
  eq('ISMS.1 nochmal fuer den Verbund → 409 (NULL-Zielobjekt)', await status(svc.addModeling(D1.id, { module_id: 'ISMS.1' }, admin)), 409);
  eq('DB-Index verhindert Dublette auch am Dienst vorbei',
    await status(m.BsiModeling.create({ domain_id: D1.id, target_object_id: null, module_id: 'ISMS.1' })), 'SequelizeUniqueConstraintError');
  eq('owner sieht Modellierung des fremden Zielobjekts nicht', (await svc.listModeling(D1.id, owner)).map(r => r.module_id), ['ISMS.1']);
  const sug = await svc.suggestModeling(D1.id, t1.targetObject.id, admin);
  eq('Vorschlaege IT-System ohne bereits Modelliertes', sug.suggestions.map(s => s.module_id), ['SYS.2.1']);
  eq('Vorschlaege Verbund ohne ISMS.1', (await svc.suggestModeling(D1.id, undefined, admin)).suggestions.some(s => s.module_id === 'ISMS.1'), false);
  eq('Vorschlaege fuer fremdes Zielobjekt (owner) → 404', await status(svc.suggestModeling(D1.id, t1.targetObject.id, owner)), 404);

  console.log('\nEntfernen:');
  eq('Zielobjekt mit Modellierung → 409', await status(svc.removeTargetObject(D1.id, t1.targetObject.id, admin)), 409);
  const mod = (await svc.listModeling(D1.id, admin)).find(r => r.module_id === 'SYS.1.1');
  const removed = await svc.removeModeling(D1.id, mod.id, admin);
  eq('Modellierung entfernt, Snapshot fuer das Audit-Log', removed.snapshot.module_id, 'SYS.1.1');
  eq('danach Zielobjekt entfernbar', await status(svc.removeTargetObject(D1.id, t1.targetObject.id, admin)), 'ok');
  eq('Asset bleibt', !!(await m.Asset.findByPk(server.id)), true);
  eq('Asset mit Zielobjekt hart loeschen scheitert am Fremdschluessel (RESTRICT)',
    await m.Asset.destroy({ where: { id: app.id } }).then(() => 'geloescht', e => /foreign key constraint "bsi_target_objects_asset_id_fkey"/.test(e.message) ? 'fk' : e.message), 'fk');

  console.log('\nKatalogwechsel:');
  // Eine Zeile im zweiten Verbund, wie sie die Arbeit an D2 anlegt.
  await m.BsiRequirement.create({ baustein_id: 'ISMS.1', baustein_name: 'x', layer: 'ISMS', req_id: 'ISMS.1.A1', title: 'D2 alt', domain_id: D2.id, implementation_status: 'in_progress', notes: 'D2-Notiz' });
  const kBuf = Buffer.from(kompendiumXml());
  const kCat = await catalogs.storeCatalog(parseCatalog(kBuf), { source: 'upload', buffer: kBuf });
  await catalogs.activateCatalog(kCat.id, admin.id);
  eq('alle Verbuende folgen dem aktiven Katalog', (await m.BsiInformationDomain.findAll({ order: [['id', 'ASC']], raw: true })).map(d => d.catalog_id), [kCat.id, kCat.id]);
  const d2rows = await m.BsiRequirement.findAll({ where: { domain_id: D2.id }, raw: true });
  eq('D2: keine Zeilen angelegt, vorhandene aktualisiert, Status bleibt',
    d2rows.map(r => [r.req_id, r.title, r.implementation_status, r.notes, r.retired]), [['ISMS.1.A1', 'Testanforderung Eins', 'in_progress', 'D2-Notiz', false]]);
  const base = new Map((await m.BsiRequirement.findAll({ where: { domain_id: D1.id }, raw: true })).map(r => [r.req_id, r]));
  eq('Standard-Verbund: neue Anforderung angelegt und zugeordnet', base.get('ORP.1.A9')?.domain_id, D1.id);
  eq('Standard-Verbund: Status bleibt', [base.get('ISMS.1.A1').implementation_status, base.get('ISMS.1.A1').notes], ['implemented', 'Nachweis liegt vor']);
  eq('keine doppelte req_id im Standard-Verbund', (await m.BsiRequirement.count({ where: { domain_id: D1.id, req_id: 'ISMS.1.A1' } })), 1);
  eq('Modellierung nach Wechsel: ISMS.1 weiter im Katalog', (await svc.listModeling(D1.id, admin)).find(r => r.module_id === 'ISMS.1').in_active_catalog, true);

  console.log('\nBisherige Liste (baselineWhere):');
  const legacy = await m.BsiRequirement.findAll({ where: await svc.baselineWhere(), raw: true });
  eq('nur der Standard-Verbund', [...new Set(legacy.map(r => r.domain_id))], [D1.id]);

  // ── IT-Grundschutz-Check (Branch feat/bsi-grundschutz-check) ──────────────
  const check = require(path.join(SRC, 'services', 'bsiCheckService'));
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_bsi_requirements_domain_target_req ON bsi_requirements (domain_id, COALESCE(target_object_id, 0), req_id)');
  // Aktiver Katalog ist jetzt das Test-Kompendium: ISMS.1 (A1 B, A2 entfallen, A3 S), ORP.1 (A1 B, A9 H).
  await svc.addModeling(D2.id, { module_id: 'ISMS.1' }, admin);
  await svc.addModeling(D2.id, { module_id: 'ORP.1', target_object_id: t2.targetObject.id }, admin);
  const group = await m.Group.create({ name: 'ISB-Team' });
  const itStaff = await mkUser('it', 'it-staff');

  console.log('\nCheck lesen (Kern-Absicherung D2):');
  let c2 = await check.getCheck(D2.id, admin);
  eq('Kern: Verbund ISMS.1.A1+A3, Zielobjekt ORP.1.A1+A9 (H)', c2.entries.map(e => `${e.target_object_id ? 'T' : 'V'}:${e.req_id}`), ['V:ISMS.1.A1', 'V:ISMS.1.A3', 'T:ORP.1.A1', 'T:ORP.1.A9']);
  eq('vorhandene D2-Zeile ISMS.1.A1 (Verbund) wird angezeigt', c2.entries[0].implementation_status, 'in_progress');
  eq('ohne Zeile: offen', c2.entries[2].check_label, 'offen');
  await svc.updateDomain(D2.id, { protection_approach: 'standard' });
  eq('Standard: H faellt weg', (await check.getCheck(D2.id, admin)).entries.map(e => e.req_id), ['ISMS.1.A1', 'ISMS.1.A3', 'ORP.1.A1']);
  await svc.updateDomain(D2.id, { protection_approach: 'basis' });
  eq('Basis: nur B', (await check.getCheck(D2.id, admin)).entries.map(e => e.req_id), ['ISMS.1.A1', 'ORP.1.A1']);
  await svc.updateDomain(D2.id, { protection_approach: 'kern' });

  console.log('\nCheck setzen:');
  const T2 = t2.targetObject.id;
  eq('nein ohne Begruendung → 400', await status(check.setCheckEntry(D2.id, { target_object_id: T2, req_id: 'ORP.1.A9', implementation_status: 'not_implemented' }, admin)), 400);
  eq('keine Zeile angelegt', await m.BsiRequirement.count({ where: { target_object_id: T2 } }), 0);
  const doc = await m.Document.create({ asset_id: server.id, uploaded_by: admin.id, filename: 'x.pdf', original_name: 'Konzept.pdf' });
  const docOther = await m.Document.create({ asset_id: app.id, uploaded_by: admin.id, filename: 'y.pdf', original_name: 'ERP.pdf' });
  const ctrl = await m.Control.create({ framework: 'bsi', code: 'M-1', title: 'Org-Regel' });
  const set1 = await check.setCheckEntry(D2.id, {
    target_object_id: T2, req_id: 'ORP.1.A9', implementation_status: 'not_implemented', justification: 'Risiko vom Management uebernommen',
    responsible_id: itStaff.id, responsible_group_id: group.id, due_date: '2027-03-31', cost_once: '2500,00', cost_recurring: 120,
    document_ids: [doc.id], control_ids: [ctrl.id], domain_id: 999, catalog_id: 999,
  }, admin);
  eq('angelegt am Zielobjekt in D2', [set1.created, set1.row.domain_id, set1.row.target_object_id, set1.row.implementation_status], [true, D2.id, T2, 'not_implemented']);
  eq('Kosten, Termin, Gruppe gespeichert', [Number(set1.row.cost_once), Number(set1.row.cost_recurring), set1.row.due_date, set1.row.responsible_group_id], [2500, 120, '2027-03-31', group.id]);
  eq('Nachweis und Massnahme verknuepft', [set1.docsAdded, set1.controlsAdded], [[doc.id], [ctrl.id]]);
  eq('Massnahme ueber control_requirements (framework bsi)', await m.ControlRequirement.count({ where: { framework: 'bsi', requirement_id: set1.row.id, control_id: ctrl.id } }), 1);
  eq('nein in alter ENUM-Spalte speicherbar (Typ erweitert)', (await m.BsiRequirement.findByPk(set1.row.id, { raw: true })).implementation_status, 'not_implemented');
  eq('zweites Setzen aendert dieselbe Zeile', (await check.setCheckEntry(D2.id, { target_object_id: T2, req_id: 'ORP.1.A9', notes: 'Pruefung 2027' }, admin)).created, false);
  eq('ISMS.1.A1 am Zielobjekt (nicht modelliert) → 409', await status(check.setCheckEntry(D2.id, { target_object_id: T2, req_id: 'ISMS.1.A1', implementation_status: 'implemented' }, admin)), 409);
  eq('Zielobjekt eines anderen Verbunds → 404', await status(check.setCheckEntry(D1.id, { target_object_id: T2, req_id: 'ORP.1.A1', implementation_status: 'implemented' }, admin)), 404);
  eq('entfallene Anforderung → 404', await status(check.setCheckEntry(D2.id, { req_id: 'ISMS.1.A2', implementation_status: 'implemented' }, admin)), 404);
  eq('unbekannte Gruppe → 400', await status(check.setCheckEntry(D2.id, { target_object_id: T2, req_id: 'ORP.1.A1', responsible_group_id: 99999 }, admin)), 400);
  eq('owner sieht das Asset nicht → 404', await status(check.setCheckEntry(D2.id, { target_object_id: T2, req_id: 'ORP.1.A1', implementation_status: 'implemented' }, owner)), 404);
  eq('Massnahmen ohne controls.edit (owner, Verbundebene) → 403',
    await status(check.setCheckEntry(D2.id, { req_id: 'ISMS.1.A3', implementation_status: 'implemented', control_ids: [ctrl.id] }, owner)), 403);
  eq('fremdes Dokument (owner, Asset nicht sichtbar) → 404',
    await status(check.setCheckEntry(D2.id, { req_id: 'ISMS.1.A3', implementation_status: 'implemented', document_ids: [doc.id] }, owner)), 404);
  eq('owner: eigenes Dokument am Verbund ok', (await check.setCheckEntry(D2.id, { req_id: 'ISMS.1.A3', implementation_status: 'implemented', document_ids: [docOther.id] }, owner)).docsAdded, [docOther.id]);

  console.log('\nLesen mit Sichtbarkeit, Auswertung, Export:');
  c2 = await check.getCheck(D2.id, admin);
  const e9 = c2.entries.find(e => e.req_id === 'ORP.1.A9');
  eq('Eintrag mit allen Feldern', [e9.check_label, e9.justification, e9.responsible?.id, e9.responsible_group?.name, e9.documents.map(d => d.original_name), e9.controls.map(x => x.code)],
    ['nein', 'Risiko vom Management uebernommen', itStaff.id, 'ISB-Team', ['Konzept.pdf'], ['M-1']]);
  const cOwner = await check.getCheck(D2.id, owner);
  eq('owner: nur Verbundebene (Zielobjekt-Asset nicht sichtbar)', [...new Set(cOwner.entries.map(e => e.target_object_id))], [null]);
  eq('blind (assets.view=false): keine Zielobjekt-Eintraege', (await check.getCheck(D2.id, blind)).entries.every(e => e.target_object_id == null), true);
  eq('nur ein Zielobjekt', (await check.getCheck(D2.id, admin, { targetObjectId: T2 })).entries.map(e => e.req_id), ['ORP.1.A1', 'ORP.1.A9']);
  eq('nur Verbundebene', (await check.getCheck(D2.id, admin, { targetObjectId: 'domain' })).entries.map(e => e.req_id), ['ISMS.1.A1', 'ISMS.1.A3']);
  const s2 = check.summarize(c2.entries);
  const sOrp = s2.by_module.find(b => b.module_id === 'ORP.1');
  eq('ORP.1: 0 von 2 erfuellt, Kosten 2500 / 120', [sOrp.total, sOrp.fulfillment, sOrp.cost_once, sOrp.cost_recurring], [2, 0, 2500, 120]);
  eq('Verbundebene: A1 teilweise + A3 ja = 75 %', s2.by_target.find(b => b.target_object_id == null).fulfillment, 75);
  const a4 = check.buildA4Rows(c2);
  eq('A.4: eine Zeile je Eintrag', a4.rows.length, c2.entries.length);
  const docs = await check.linkableDocuments(D2.id, T2, admin);
  eq('verknuepfbare Dokumente des Zielobjekts', docs.map(d => d.original_name), ['Konzept.pdf']);
  eq('owner: Dokumente des fremden Zielobjekts → 404', await status(check.linkableDocuments(D2.id, T2, owner)), 404);

  console.log('\nStandard-Verbund: Verbundebene = bisherige Liste:');
  const baseRow = await m.BsiRequirement.findOne({ where: { domain_id: D1.id, target_object_id: null, req_id: 'ISMS.1.A1' } });
  const setBase = await check.setCheckEntry(D1.id, { req_id: 'ISMS.1.A1', justification: 'Nachweis im ISMS-Handbuch' }, admin);
  eq('trifft die bestehende Zeile, legt nichts an', [setBase.created, setBase.row.id], [false, baseRow.id]);
  eq('Status unveraendert (implemented)', setBase.row.implementation_status, 'implemented');
  eq('bisherige Liste enthaelt keine Zielobjekt-Zeilen', (await m.BsiRequirement.findAll({ where: await svc.baselineWhere(), raw: true })).some(r => r.target_object_id != null), false);

  console.log('\nNichts implizit verwerfen:');
  const modOrp = (await svc.listModeling(D2.id, admin)).find(r => r.module_id === 'ORP.1');
  await svc.removeModeling(D2.id, modOrp.id, admin);
  eq('Modellierung weg, Checkzeilen bleiben', await m.BsiRequirement.count({ where: { target_object_id: T2 } }), 1);
  eq('… und erscheinen als "ausserhalb der Modellierung"', (await check.getCheck(D2.id, admin)).unmodeled.map(u => u.req_id), ['ORP.1.A9']);
  eq('Zielobjekt mit Checkdaten → 409', await status(svc.removeTargetObject(D2.id, T2, admin)), 409);
  eq('DB-Index verhindert doppelte Checkzeile',
    await status(m.BsiRequirement.create({ domain_id: D2.id, target_object_id: T2, req_id: 'ORP.1.A9', baustein_id: 'ORP.1', baustein_name: 'x', layer: 'ORP', title: 'x' })), 'SequelizeUniqueConstraintError');
  await catalogs.activateCatalog(seed.id, admin.id);
  const t2rows = await m.BsiRequirement.findAll({ where: { target_object_id: T2 }, raw: true });
  eq('Katalogwechsel: Zielobjekt-Zeile nicht verdoppelt, abgeloest, Status bleibt', t2rows.map(r => [r.req_id, r.retired, r.implementation_status, r.justification]),
    [['ORP.1.A9', true, 'not_implemented', 'Risiko vom Management uebernommen']]);
  eq('Katalogwechsel: keine neuen Zeilen in D2', await m.BsiRequirement.count({ where: { domain_id: D2.id } }), 3);

  await m.sequelize.close();
  console.log(failures ? `\n${failures} Fehler` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
