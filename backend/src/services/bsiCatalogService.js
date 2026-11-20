'use strict';

/**
 * Versionierte Grundschutz-Kataloge: speichern, vergleichen, aktivieren.
 *
 * Ablauf: import (-> status "preview") -> diff gegen den aktiven Katalog ->
 * activate. Erst activate gleicht bsi_requirements (den Umsetzungsstand) ab:
 *   - neue Anforderungen werden angelegt (Status not_started),
 *   - bestehende bekommen Titel, Baustein, Schicht und Stufe des neuen Katalogs,
 *     Status, Verantwortlicher, Notizen und Pruefdatum bleiben unberuehrt,
 *   - Anforderungen, die im neuen Katalog fehlen oder ENTFALLEN sind, werden
 *     "retired" markiert - nicht geloescht.
 * Neu angelegt wird nur im Standard-Informationsverbund; Zeilen anderer
 * Verbuende werden aktualisiert bzw. abgeloest, aber nicht vervollstaendigt.
 */

const crypto = require('crypto');
const seedCatalog = require('./bsiCatalog');
const { diffRequirements } = require('./bsiCatalogParsers');
const domains = require('./bsiDomainService');

const SEED_NAME = 'IT-Grundschutz-Kompendium 2023 (Auszug)';

const getModels = () => require('../models');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Seed-Eintraege (bsiCatalog.js) in die Form der Parser-Ergebnisse bringen. */
function seedAsParsed() {
  const modules = [];
  const seen = new Set();
  for (const e of seedCatalog) {
    if (seen.has(e.baustein_id)) continue;
    seen.add(e.baustein_id);
    modules.push({ module_id: e.baustein_id, title: e.baustein_name, layer: e.layer, kind: 'baustein', sort_order: modules.length });
  }
  const requirements = seedCatalog.map((e, i) => ({
    module_id: e.baustein_id, req_id: e.req_id, parent_req_id: null, title: e.title, layer: e.layer,
    requirement_level: e.requirement_level, modal_verb: null, effort_level: null,
    target_object_categories: null, roles: null, text: null, guidance: null, withdrawn: false, sort_order: i,
  }));
  return { format: 'seed', meta: { title: SEED_NAME, version: null, oscalVersion: null }, modules, requirements };
}

/**
 * Speichert ein Parser-Ergebnis als Katalog im Status "preview".
 * @param {object} parsed  Ergebnis von parseCatalog() bzw. seedAsParsed()
 * @param {object} info    { name, edition, source, source_url, source_filename, buffer, userId, status }
 */
async function storeCatalog(parsed, info) {
  const { sequelize, BsiCatalog, BsiCatalogModule, BsiCatalogRequirement } = getModels();
  return sequelize.transaction(async (transaction) => {
    const catalog = await BsiCatalog.create({
      name: info.name || parsed.meta.title,
      edition: info.edition || parsed.meta.version || null,
      format: parsed.format,
      source: info.source,
      source_url: info.source_url || null,
      source_filename: info.source_filename || null,
      source_sha256: info.buffer ? sha256(info.buffer) : null,
      source_version: parsed.meta.version,
      oscal_version: parsed.meta.oscalVersion,
      status: info.status || 'preview',
      module_count: parsed.modules.length,
      requirement_count: parsed.requirements.length,
      imported_by_id: info.userId || null,
    }, { transaction });
    await BsiCatalogModule.bulkCreate(parsed.modules.map(m => ({ ...m, catalog_id: catalog.id })), { transaction });
    // In Paketen, damit ein Katalog mit tausenden Anforderungen nicht an der
    // Parametergrenze einer einzelnen Anweisung scheitert.
    for (let i = 0; i < parsed.requirements.length; i += 500) {
      await BsiCatalogRequirement.bulkCreate(
        parsed.requirements.slice(i, i + 500).map(r => ({ ...r, catalog_id: catalog.id })),
        { transaction }
      );
    }
    return catalog;
  });
}

async function catalogRequirements(catalogId) {
  const { BsiCatalogRequirement } = getModels();
  return BsiCatalogRequirement.findAll({ where: { catalog_id: catalogId }, order: [['sort_order', 'ASC']], raw: true });
}

/** Diff eines Katalogs gegen den aktiven (bzw. leeren Stand, wenn keiner aktiv ist). */
async function diffAgainstActive(catalogId) {
  const { BsiCatalog } = getModels();
  const active = await BsiCatalog.findOne({ where: { status: 'active' } });
  const after = await catalogRequirements(catalogId);
  const before = active && active.id !== catalogId ? await catalogRequirements(active.id) : (active ? after : []);
  const d = diffRequirements(before, after);
  const brief = (r) => ({ req_id: r.req_id, module_id: r.module_id, title: r.title, requirement_level: r.requirement_level, withdrawn: r.withdrawn });
  return {
    against: active ? { id: active.id, name: active.name, edition: active.edition } : null,
    counts: { added: d.added.length, changed: d.changed.length, removed: d.removed.length, unchanged: d.unchanged },
    added: d.added.map(brief),
    changed: d.changed.map(c => ({ req_id: c.req_id, fields: c.fields, before: brief(c.before), after: brief(c.after) })),
    removed: d.removed.map(brief),
  };
}

/**
 * Aktiviert einen Katalog und gleicht bsi_requirements ab (siehe Kopf).
 * @returns {{created:number, updated:number, retired:number, reactivated:number}}
 */
async function activateCatalog(catalogId, userId) {
  const { sequelize, BsiCatalog, BsiCatalogModule, BsiRequirement } = getModels();
  return sequelize.transaction(async (transaction) => {
    const catalog = await BsiCatalog.findByPk(catalogId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!catalog) { const e = new Error('Katalog nicht gefunden'); e.status = 404; throw e; }
    if (catalog.status === 'active') { const e = new Error('Katalog ist bereits aktiv'); e.status = 409; throw e; }

    const modules = await BsiCatalogModule.findAll({ where: { catalog_id: catalogId }, transaction, raw: true });
    const moduleTitle = new Map(modules.map(m => [m.module_id, m.title]));
    const reqs = (await catalogRequirements(catalogId)).filter(r => !r.withdrawn);
    const existing = await BsiRequirement.findAll({ transaction });
    // Angelegt wird nur der Bestand des Standard-Verbunds (die Liste, wie es sie
    // vor den Verbuenden gab). Zeilen anderer Verbuende entstehen erst durch die
    // Arbeit am Verbund; sie bekommen hier nur Titel/Stufe aus dem Katalog und
    // werden abgeloest, wenn der Katalog die Anforderung nicht mehr fuehrt.
    const defaultDomain = await domains.getDefaultDomain(transaction);
    const isBaseline = (r) => r.domain_id == null || (defaultDomain && r.domain_id === defaultDomain.id);
    const byReqId = new Map(existing.filter(isBaseline).map(r => [r.req_id, r]));
    const others = existing.filter(r => !isBaseline(r));
    const stats = { created: 0, updated: 0, retired: 0, reactivated: 0 };

    const toCreate = [];
    for (const r of reqs) {
      const values = {
        baustein_id: r.module_id.slice(0, 20),
        baustein_name: (moduleTitle.get(r.module_id) || r.module_id).slice(0, 255),
        layer: r.layer,
        title: r.title,
        requirement_level: r.requirement_level,
        catalog_id: catalogId,
        retired: false,
      };
      const row = byReqId.get(r.req_id);
      if (!row) {
        toCreate.push({ ...values, req_id: r.req_id.slice(0, 30), implementation_status: 'not_started', domain_id: defaultDomain ? defaultDomain.id : null });
        continue;
      }
      byReqId.delete(r.req_id);
      if (row.retired) stats.reactivated++;
      const changed = Object.keys(values).some(k => row[k] !== values[k]);
      if (changed) { await row.update(values, { transaction }); stats.updated++; }
    }
    for (let i = 0; i < toCreate.length; i += 500) {
      await BsiRequirement.bulkCreate(toCreate.slice(i, i + 500), { transaction });
    }
    stats.created = toCreate.length;

    // Zeilen der uebrigen Verbuende: gleiche Katalogwerte, kein Anlegen.
    const catalogByReqId = new Map(reqs.map(r => [r.req_id, r]));
    for (const row of others) {
      const r = catalogByReqId.get(row.req_id);
      if (!r) {
        if (!row.retired) { await row.update({ retired: true }, { transaction }); stats.retired++; }
        continue;
      }
      const values = {
        baustein_id: r.module_id.slice(0, 20),
        baustein_name: (moduleTitle.get(r.module_id) || r.module_id).slice(0, 255),
        layer: r.layer, title: r.title, requirement_level: r.requirement_level, catalog_id: catalogId, retired: false,
      };
      if (row.retired) stats.reactivated++;
      if (Object.keys(values).some(k => row[k] !== values[k])) { await row.update(values, { transaction }); stats.updated++; }
    }

    const leftover = [...byReqId.values()].filter(r => !r.retired).map(r => r.id);
    if (leftover.length) {
      await BsiRequirement.update({ retired: true }, { where: { id: leftover }, transaction });
      stats.retired = leftover.length;
    }

    await BsiCatalog.update({ status: 'archived' }, { where: { status: 'active' }, transaction });
    await catalog.update({ status: 'active', activated_by_id: userId || null, activated_at: new Date() }, { transaction });
    // Verbuende folgen dem aktiven Katalog (siehe models/BsiInformationDomain.js).
    await domains.followActiveCatalog(catalogId, transaction);
    return stats;
  });
}

/**
 * Startmigration (idempotent): Legt den mitgelieferten Seed als Katalog
 * "IT-Grundschutz-Kompendium 2023 (Auszug)" an, falls noch kein Katalog
 * existiert. Hat die Installation bereits BSI-Anforderungen (aus dem frueheren
 * "Katalog laden"), wird er sofort aktiv und die bestehenden Zeilen werden ihm
 * zugeordnet - ihr Status bleibt, wie er ist.
 */
async function ensureSeedCatalog() {
  const { BsiCatalog, BsiRequirement } = getModels();
  if (await BsiCatalog.count() > 0) return null;
  const hasRows = (await BsiRequirement.count()) > 0;
  const catalog = await storeCatalog(seedAsParsed(), {
    name: SEED_NAME, edition: '2023', source: 'seed', status: hasRows ? 'active' : 'preview',
  });
  if (hasRows) {
    await BsiRequirement.update({ catalog_id: catalog.id }, { where: { catalog_id: null } });
    await catalog.update({ activated_at: new Date() });
  }
  return catalog;
}

module.exports = {
  SEED_NAME,
  sha256,
  seedAsParsed,
  storeCatalog,
  catalogRequirements,
  diffAgainstActive,
  activateCatalog,
  ensureSeedCatalog,
};
