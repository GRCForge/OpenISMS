const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);

const {
  ThreatSource, ThreatAdvisory, ThreatAdvisoryAsset,
  Asset, User, Risk, Task, Incident, sequelize,
} = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { setFilter, boundedInt } = require('../utils/queryFilters');
const { escapeLike } = require('../utils/sqlUtils');
const { auditFromReq } = require('../services/auditService');
const { computeLevel } = require('../services/riskScale');
const catalog = require('../services/threatSourceCatalog');
const {
  nextReviewDate, isOverdue, toDateOnly, refreshSource, refreshAllSources, matchAssetsByCve,
} = require('../services/threatIntelService');

const VIEW_ROLES = ['admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'];

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// Nur die Felder uebernehmen, die das Formular kennt. req.body direkt in
// update() zu reichen liesse einen Client Spalten setzen, die er nicht sehen
// darf — etwa assessed_by_id oder eine fremde risk_id.
const pick = (body, fields) => {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = body[f];
  return out;
};

const SOURCE_FIELDS = ['name', 'type', 'country', 'url', 'feed_url', 'feed_format', 'auto_fetch',
  'review_frequency', 'responsible_id', 'active', 'notes'];
const ADVISORY_FIELDS = ['source_id', 'external_id', 'title', 'summary', 'url', 'published_at',
  'severity', 'cve_ids', 'relevance', 'status', 'assessment_notes', 'risk_id', 'task_id', 'incident_id'];

const sourceView = (source, today) => {
  const json = source.toJSON ? source.toJSON() : source;
  return { ...json, overdue: isOverdue(source, today) };
};

// ── Quellenregister ──────────────────────────────────────────────────────────

router.get('/sources', authenticate, requirePermission('threat_intel', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const where = {};
    setFilter(where, 'type', req.query.type);
    if (req.query.active === 'true') where.active = true;
    if (req.query.active === 'false') where.active = false;

    const sources = await ThreatSource.findAll({
      where,
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['active', 'DESC'], ['type', 'ASC'], ['name', 'ASC']],
    });
    const today = toDateOnly(new Date());
    res.json(sources.map((s) => sourceView(s, today)));
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

router.post('/sources', authenticate, requirePermission('threat_intel', 'create', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const data = pick(req.body, SOURCE_FIELDS);
    if (!data.name) return res.status(400).json({ error: 'Name ist erforderlich.' });
    const source = await ThreatSource.create(data);
    await auditFromReq(req, 'create', 'threat_source', source.id, source.name, { type: source.type });
    res.status(201).json(source);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/sources/seed', authenticate, requirePermission('threat_intel', 'seed', 'admin', 'assessor'), async (req, res) => {
  try {
    const count = await ThreatSource.count();
    if (count > 0) return res.status(409).json({ error: 'Quellenregister ist bereits befuellt.' });
    // Ohne last_reviewed_at gilt jede Quelle sofort als ueberfaellig. Das ist
    // beabsichtigt: Der Katalog behauptet nicht, dass schon jemand
    // hineingesehen hat — die erste Durchsicht ist die erste echte Aufgabe.
    await ThreatSource.bulkCreate(catalog.map((c) => ({ ...c, active: c.active !== false })));
    await auditFromReq(req, 'seed', 'threat_source', null, 'Quellenkatalog', { count: catalog.length });
    res.status(201).json({ ok: true, count: catalog.length });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

router.put('/sources/:id', authenticate, requirePermission('threat_intel', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const source = await ThreatSource.findByPk(id);
    if (!source) return res.status(404).json({ error: 'Nicht gefunden' });

    const data = pick(req.body, SOURCE_FIELDS);
    // Wird die Frequenz geaendert, muss der naechste Termin mitwandern —
    // sonst behaelt eine auf taeglich verschaerfte Quelle ihren alten
    // Quartalstermin und die Verschaerfung bleibt folgenlos.
    if (data.review_frequency && data.review_frequency !== source.review_frequency && source.last_reviewed_at) {
      data.next_review_at = nextReviewDate(data.review_frequency, new Date(source.last_reviewed_at));
    }
    await source.update(data);
    await auditFromReq(req, 'update', 'threat_source', source.id, source.name, {});
    res.json(source);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/sources/:id', authenticate, requirePermission('threat_intel', 'delete', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const source = await ThreatSource.findByPk(id);
    if (!source) return res.status(404).json({ error: 'Nicht gefunden' });

    const advisories = await ThreatAdvisory.count({ where: { source_id: source.id } });
    // Die Meldungen sind der Nachweis. Sie mit der Quelle zu loeschen wuerde
    // genau die Historie vernichten, die ein Audit sehen will — also bleibt
    // die Quelle stehen, bis jemand bewusst entscheidet.
    if (advisories > 0) {
      return res.status(409).json({
        error: `An dieser Quelle haengen ${advisories} Meldungen. Quelle deaktivieren statt loeschen, oder die Meldungen zuerst umhaengen.`,
      });
    }
    await auditFromReq(req, 'delete', 'threat_source', source.id, source.name, {});
    await source.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

/**
 * Durchsicht einer Quelle festhalten.
 *
 * Das ist der Nachweis fuer "regelmaessig verfolgt": ein datierter Eintrag mit
 * Person und Notiz, der zugleich den naechsten Termin setzt. Er landet auch im
 * Audit-Log, das signiert ist — eine nachtraeglich erfundene Durchsicht faellt
 * dort auf.
 */
router.post('/sources/:id/review', authenticate, requirePermission('threat_intel', 'review', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const source = await ThreatSource.findByPk(id);
    if (!source) return res.status(404).json({ error: 'Nicht gefunden' });

    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : null;
    const today = toDateOnly(new Date());
    await source.update({
      last_reviewed_at: today,
      next_review_at: nextReviewDate(source.review_frequency),
      last_review_note: note,
    });
    await auditFromReq(req, 'review', 'threat_source', source.id, source.name, {
      reviewed_at: today, next_review_at: source.next_review_at, note,
    });
    res.json(sourceView(source, today));
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

/** Feed einer einzelnen Quelle jetzt abrufen. */
router.post('/sources/:id/fetch', authenticate, requirePermission('threat_intel', 'fetch', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const source = await ThreatSource.findByPk(id);
    if (!source) return res.status(404).json({ error: 'Nicht gefunden' });

    const result = await refreshSource({ ThreatAdvisory, ThreatAdvisoryAsset, Asset }, source);
    await auditFromReq(req, 'fetch', 'threat_source', source.id, source.name, result);
    if (!result.ok) return res.status(502).json({ error: `Abruf fehlgeschlagen: ${result.error}`, ...result });
    res.json(result);
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

/** Alle Quellen mit eingeschaltetem Abruf. Entspricht dem naechtlichen Lauf. */
router.post('/fetch-all', authenticate, requirePermission('threat_intel', 'fetch', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const summary = await refreshAllSources({ ThreatSource, ThreatAdvisory, ThreatAdvisoryAsset, Asset });
    await auditFromReq(req, 'fetch', 'threat_source', null, 'Alle Quellen', summary);
    res.json(summary);
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

// ── Warnmeldungen ────────────────────────────────────────────────────────────

const advisoryIncludes = () => ([
  { model: ThreatSource, as: 'source', attributes: ['id', 'name', 'type', 'country'] },
  { model: User, as: 'assessedBy', attributes: ['id', 'name', 'email'] },
  { model: Risk, as: 'risk', attributes: ['id', 'ref', 'title', 'status'] },
  { model: Task, as: 'task', attributes: ['id', 'title', 'status'] },
  { model: Incident, as: 'incident', attributes: ['id', 'title', 'status'] },
]);

router.get('/advisories', authenticate, requirePermission('threat_intel', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const where = {};
    setFilter(where, 'status', req.query.status);
    setFilter(where, 'relevance', req.query.relevance);
    setFilter(where, 'severity', req.query.severity);
    setFilter(where, 'source_id', req.query.source_id);
    if (req.query.search) {
      const like = `%${escapeLike(req.query.search)}%`;
      where[Op.or] = [
        { title: { [Op.iLike]: like } },
        { summary: { [Op.iLike]: like } },
        { external_id: { [Op.iLike]: like } },
        { cve_ids: { [Op.iLike]: like } },
        { ref: { [Op.iLike]: like } },
      ];
    }
    // Ein Register mit Jahren an Meldungen darf die Oberflaeche nicht
    // erschlagen; die Seite laedt seitenweise nach.
    const limit = boundedInt(req.query.limit, 200, 1, 500);
    const offset = boundedInt(req.query.offset, 0, 0, 100000);

    const { rows, count } = await ThreatAdvisory.findAndCountAll({
      where,
      include: advisoryIncludes(),
      order: [['published_at', 'DESC NULLS LAST'], ['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
    });
    res.json({ items: rows, total: count, limit, offset });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

router.get('/advisories/:id', authenticate, requirePermission('threat_intel', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id, {
      include: [
        ...advisoryIncludes(),
        { model: Asset, as: 'assets', attributes: ['id', 'name', 'type', 'classification', 'nis2_relevant'], through: { attributes: ['match_source', 'confirmed', 'note'] } },
      ],
    });
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(advisory);
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

router.post('/advisories', authenticate, requirePermission('threat_intel', 'create', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const data = pick(req.body, ADVISORY_FIELDS);
    if (!data.title) return res.status(400).json({ error: 'Titel ist erforderlich.' });
    data.ingested_via = 'manual';
    const advisory = await ThreatAdvisory.create(data);
    await auditFromReq(req, 'create', 'threat_advisory', advisory.id, advisory.title, { severity: advisory.severity });
    res.status(201).json(advisory);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/advisories/:id', authenticate, requirePermission('threat_intel', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });
    await advisory.update(pick(req.body, ADVISORY_FIELDS));
    await auditFromReq(req, 'update', 'threat_advisory', advisory.id, advisory.title, {});
    res.json(advisory);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/**
 * Bewertung einer Meldung.
 *
 * Eigener Endpunkt statt eines PUT-Feldes, weil hier drei Dinge zusammen
 * passieren muessen: Einstufung, Zeitstempel und Person. Wer bewertet hat, darf
 * der Client nicht bestimmen — das kommt aus der Sitzung.
 */
const RELEVANCE = new Set(['not_assessed', 'not_relevant', 'monitor', 'relevant', 'critical']);
const ADVISORY_STATUS = new Set(['new', 'in_assessment', 'action_required', 'mitigated', 'closed']);

router.post('/advisories/:id/assess', authenticate, requirePermission('threat_intel', 'assess', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });

    const { relevance, status, assessment_notes } = req.body || {};
    if (!RELEVANCE.has(relevance)) return res.status(400).json({ error: 'Ungueltige Relevanz.' });
    if (status !== undefined && !ADVISORY_STATUS.has(status)) return res.status(400).json({ error: 'Ungueltiger Status.' });

    // Wer eine Meldung als nicht relevant einstuft, schliesst sie damit ab;
    // alles andere braucht eine Entscheidung darueber, was daraus folgt.
    const nextStatus = status || (relevance === 'not_relevant' ? 'closed' : 'in_assessment');

    await advisory.update({
      relevance,
      status: nextStatus,
      assessment_notes: typeof assessment_notes === 'string' ? assessment_notes.slice(0, 5000) : advisory.assessment_notes,
      assessed_by_id: req.user.id,
      assessed_at: new Date(),
    });
    await auditFromReq(req, 'assess', 'threat_advisory', advisory.id, advisory.title, { relevance, status: nextStatus });
    res.json(advisory);
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

router.delete('/advisories/:id', authenticate, requirePermission('threat_intel', 'delete', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });
    await sequelize.transaction(async (t) => {
      await ThreatAdvisoryAsset.destroy({ where: { advisory_id: advisory.id }, transaction: t });
      await advisory.destroy({ transaction: t });
    });
    await auditFromReq(req, 'delete', 'threat_advisory', advisory.id, advisory.title, {});
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

// ── Betroffene Assets ────────────────────────────────────────────────────────

router.post('/advisories/:id/assets', authenticate, requirePermission('threat_intel', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    const assetId = parsePositiveInt(req.body?.asset_id);
    if (!id || !assetId) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Meldung nicht gefunden' });
    const asset = await Asset.findByPk(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset nicht gefunden' });

    const [link] = await ThreatAdvisoryAsset.findOrCreate({
      where: { advisory_id: id, asset_id: assetId },
      defaults: { advisory_id: id, asset_id: assetId, match_source: 'manual', confirmed: true, note: req.body?.note || null },
    });
    // Ein automatischer Vorschlag, den jemand von Hand bestaetigt, ist ab jetzt
    // eine Feststellung.
    if (!link.confirmed) await link.update({ confirmed: true });
    await auditFromReq(req, 'update', 'threat_advisory', advisory.id, advisory.title, { linked_asset: asset.name });
    res.status(201).json(link);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/advisories/:id/assets/:assetId', authenticate, requirePermission('threat_intel', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    const assetId = parsePositiveInt(req.params.assetId);
    if (!id || !assetId) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const deleted = await ThreatAdvisoryAsset.destroy({ where: { advisory_id: id, asset_id: assetId } });
    if (!deleted) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

/** Assets vorschlagen, die diese Meldung ueber ihre CVE-Kennungen betrifft. */
router.post('/advisories/:id/match-assets', authenticate, requirePermission('threat_intel', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });

    const hits = await matchAssetsByCve({ Asset }, advisory.cve_ids);
    let added = 0;
    for (const hit of hits) {
      const [, created] = await ThreatAdvisoryAsset.findOrCreate({
        where: { advisory_id: advisory.id, asset_id: hit.asset_id },
        defaults: {
          advisory_id: advisory.id, asset_id: hit.asset_id,
          match_source: 'cve_match', confirmed: false, note: `Automatischer Treffer ueber ${hit.cve}`,
        },
      });
      if (created) added++;
    }
    res.json({ ok: true, matched: hits.length, added });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

// ── Uebergabe ins Risikomanagement ───────────────────────────────────────────

// Eine kritische Warnung soll nicht als mittleres Risiko im Register landen.
// Die Zuordnung ist ein Startwert, den die Bewertung ueberschreibt — aber ein
// Startwert in der richtigen Groessenordnung.
const severityToImpact = (severity) => ({ critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity] ?? 3);

/**
 * Aus einer Warnmeldung ein Risiko machen.
 *
 * Das ist die belastbare Antwort auf die zweite Frage des Self-Checks: "Werden
 * externe Warnmeldungen systematisch in das unternehmensinterne Risikomanagement
 * einbezogen?"  Ein Knopf, der aus der Meldung einen Eintrag im Risikoregister
 * erzeugt und beide Seiten verknuepft, macht aus einer Behauptung einen
 * nachvollziehbaren Vorgang.
 */
router.post('/advisories/:id/to-risk', authenticate, requirePermission('threat_intel', 'assess', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });
    if (advisory.risk_id) return res.status(409).json({ error: 'Zu dieser Meldung existiert bereits ein Risiko.', risk_id: advisory.risk_id });

    const likelihood = boundedInt(req.body?.likelihood, 3, 1, 5);
    const impact = boundedInt(req.body?.impact, severityToImpact(advisory.severity), 1, 5);
    const title = (req.body?.title || `Bedrohung: ${advisory.title}`).slice(0, 255);

    const risk = await Risk.create({
      title,
      description: [
        advisory.summary,
        advisory.cve_ids ? `Betroffene Schwachstellen: ${advisory.cve_ids}` : '',
        advisory.url ? `Quelle: ${advisory.url}` : '',
        `Hergeleitet aus Warnmeldung ${advisory.ref || advisory.id}.`,
      ].filter(Boolean).join('\n\n').slice(0, 5000),
      category: 'Bedrohungslage',
      owner_id: req.body?.owner_id || req.user.id,
      likelihood,
      impact,
      inherent_level: computeLevel(likelihood, impact),
      treatment: 'mitigate',
      status: 'open',
    });

    await advisory.update({ risk_id: risk.id, status: 'action_required' });
    await auditFromReq(req, 'create', 'risk', risk.id, risk.title, { from_advisory: advisory.ref || advisory.id });
    await auditFromReq(req, 'update', 'threat_advisory', advisory.id, advisory.title, { risk_id: risk.id });
    res.status(201).json({ risk, advisory });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

/** Aus einer Warnmeldung eine Aufgabe machen (Patch, Pruefung, Ruecksprache). */
router.post('/advisories/:id/to-task', authenticate, requirePermission('threat_intel', 'assess', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const advisory = await ThreatAdvisory.findByPk(id);
    if (!advisory) return res.status(404).json({ error: 'Nicht gefunden' });
    if (advisory.task_id) return res.status(409).json({ error: 'Zu dieser Meldung existiert bereits eine Aufgabe.', task_id: advisory.task_id });

    const priority = ['critical', 'high', 'medium', 'low'].includes(advisory.severity) ? advisory.severity : 'medium';
    const task = await Task.create({
      title: (req.body?.title || `Warnmeldung pruefen: ${advisory.title}`).slice(0, 255),
      description: [advisory.summary, advisory.url].filter(Boolean).join('\n\n').slice(0, 5000),
      status: 'open',
      priority,
      due_date: req.body?.due_date || null,
      assigned_to_id: req.body?.assigned_to_id || null,
      created_by_id: req.user.id,
      related_type: 'threat_advisory',
      related_id: advisory.id,
    });

    await advisory.update({ task_id: task.id, status: 'action_required' });
    await auditFromReq(req, 'create', 'task', task.id, task.title, { from_advisory: advisory.ref || advisory.id });
    res.status(201).json({ task, advisory });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

// ── Kennzahlen ───────────────────────────────────────────────────────────────

/**
 * Die Zahlen, mit denen sich NIS-2 Art. 21(2)(a) belegen laesst.
 *
 * Getrennt nach den beiden Achsen, die der Self-Check abfragt: 'monitoring'
 * beantwortet "wird verfolgt", 'handling' beantwortet "wird einbezogen". Die
 * Ampeln daraus stehen in der Oberflaeche direkt neben der Frage.
 */
router.get('/stats', authenticate, requirePermission('threat_intel', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const today = toDateOnly(new Date());
    const sources = await ThreatSource.findAll();
    const active = sources.filter((s) => s.active);
    const overdue = active.filter((s) => isOverdue(s, today));

    const [total, byStatus, byRelevance, bySeverity] = await Promise.all([
      ThreatAdvisory.count(),
      ThreatAdvisory.findAll({ attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['status'], raw: true }),
      ThreatAdvisory.findAll({ attributes: ['relevance', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['relevance'], raw: true }),
      ThreatAdvisory.findAll({ attributes: ['severity', [sequelize.fn('COUNT', sequelize.col('id')), 'n']], group: ['severity'], raw: true }),
    ]);

    const tally = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], Number(r.n)]));

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const [recent, unassessed, actionRequired, withRisk, withTask, withIncident] = await Promise.all([
      ThreatAdvisory.count({ where: { created_at: { [Op.gte]: thirtyDaysAgo } } }),
      ThreatAdvisory.count({ where: { relevance: 'not_assessed' } }),
      ThreatAdvisory.count({ where: { status: 'action_required' } }),
      ThreatAdvisory.count({ where: { risk_id: { [Op.ne]: null } } }),
      ThreatAdvisory.count({ where: { task_id: { [Op.ne]: null } } }),
      ThreatAdvisory.count({ where: { incident_id: { [Op.ne]: null } } }),
    ]);

    const assessed = total - unassessed;
    // Nur bewertete Meldungen, die tatsaechlich einschlaegig sind, muessen
    // irgendwo landen. Eine als 'not_relevant' abgeschlossene Meldung gegen die
    // Quote zu rechnen, wuerde den Wert beliebig machen.
    const needsHandling = await ThreatAdvisory.count({ where: { relevance: { [Op.in]: ['relevant', 'critical'] } } });
    const handled = await ThreatAdvisory.count({
      where: {
        relevance: { [Op.in]: ['relevant', 'critical'] },
        [Op.or]: [{ risk_id: { [Op.ne]: null } }, { task_id: { [Op.ne]: null } }, { incident_id: { [Op.ne]: null } }],
      },
    });

    res.json({
      monitoring: {
        sources_total: sources.length,
        sources_active: active.length,
        sources_overdue: overdue.length,
        sources_with_feed: active.filter((s) => s.feed_format !== 'none' && s.feed_url).length,
        sources_auto_fetch: active.filter((s) => s.auto_fetch).length,
        // Der Self-Check fragt ausdruecklich nach der nationalen Stelle. Ohne
        // sie ist die Frage nicht mit "ja" zu beantworten, egal wie viele
        // andere Quellen im Register stehen.
        national_csirt_covered: active.some((s) => s.type === 'national_csirt'),
        advisories_last_30d: recent,
        next_due: active
          .map((s) => s.next_review_at)
          .filter(Boolean)
          .sort()[0] || null,
      },
      handling: {
        advisories_total: total,
        assessed,
        unassessed,
        assessment_rate: total ? Math.round((assessed / total) * 100) : 0,
        action_required: actionRequired,
        needs_handling: needsHandling,
        handled,
        handling_rate: needsHandling ? Math.round((handled / needsHandling) * 100) : 0,
        linked_risks: withRisk,
        linked_tasks: withTask,
        linked_incidents: withIncident,
      },
      by_status: tally(byStatus, 'status'),
      by_relevance: tally(byRelevance, 'relevance'),
      by_severity: tally(bySeverity, 'severity'),
      overdue_sources: overdue.map((s) => ({ id: s.id, name: s.name, next_review_at: s.next_review_at, last_reviewed_at: s.last_reviewed_at })),
    });
  } catch (e) { serverError(res, e, 'threat-intel'); }
});

module.exports = router;
