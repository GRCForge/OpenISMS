const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Nis2Measure, Nis2SelfCheckItem, Task, User, sequelize } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { getSetting, setSetting } = require('../services/settingsService');
const catalog = require('../services/nis2Catalog');
const selfCheckCatalog = require('../services/nis2SelfCheckCatalog');
const selfCheck = require('../services/nis2SelfCheckScoring');
const {
  PROFILES, OBLIGATIONS, normaliseApplicability, obligationFor, summarise,
} = require('../services/nis2Applicability');

const VIEW_ROLES = ['admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'];

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const PROFILE_KEY = 'nis2_profile';
const DEFAULT_PROFILE = { entity_type: 'unknown', sector: '', note: '' };

const readProfile = async () => {
  const raw = await getSetting(PROFILE_KEY);
  if (!raw) return { ...DEFAULT_PROFILE };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const entity_type = PROFILES.includes(parsed?.entity_type) ? parsed.entity_type : 'unknown';
    return {
      entity_type,
      sector: typeof parsed?.sector === 'string' ? parsed.sector.slice(0, 200) : '',
      note: typeof parsed?.note === 'string' ? parsed.note.slice(0, 2000) : '',
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
};

// ── Betroffenheitsprofil ─────────────────────────────────────────────────────

/**
 * Wer NIS-2 wie schuldet, entscheidet sich vor dem ersten Kriterium.
 *
 * Eine wesentliche Einrichtung nach Anhang I schuldet den vollen Katalog
 * einschliesslich der Meldepflichten aus Art. 23. Ein Zulieferer, der selbst
 * nicht in den Anwendungsbereich faellt, schuldet der Behoerde nichts — ihm
 * werden Anforderungen ueber Art. 21(2)(d) vertraglich durchgereicht, und zwar
 * nur ein Teil davon.
 *
 * Solange 'unknown' gesetzt ist, gilt der volle Katalog. Das ist die sichere
 * Annahme: Lieber zu viel pruefen als eine Pflicht uebersehen, die man hat.
 */
router.get('/profile', authenticate, requirePermission('nis2', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    res.json({ ...(await readProfile()), profiles: PROFILES, obligations: OBLIGATIONS });
  } catch (e) { serverError(res, e, 'nis2'); }
});

router.put('/profile', authenticate, requirePermission('nis2', 'edit', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const entity_type = req.body?.entity_type;
    if (!PROFILES.includes(entity_type)) {
      return res.status(400).json({ error: `Ungueltiges Profil. Erlaubt: ${PROFILES.join(', ')}` });
    }
    const profile = {
      entity_type,
      sector: typeof req.body?.sector === 'string' ? req.body.sector.slice(0, 200) : '',
      note: typeof req.body?.note === 'string' ? req.body.note.slice(0, 2000) : '',
    };
    await setSetting(PROFILE_KEY, profile);
    // Die Einstufung ist eine Managemententscheidung mit Haftungsfolge — sie
    // gehoert ins Audit-Log, nicht nur in die Einstellungstabelle.
    await auditFromReq(req, 'update', 'settings', null, 'NIS-2-Betroffenheitsprofil', profile);
    res.json(profile);
  } catch (e) { serverError(res, e, 'nis2'); }
});

// ── Kriterienkatalog ─────────────────────────────────────────────────────────

router.get('/', authenticate, requirePermission('nis2', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const profile = await readProfile();
    const items = await Nis2Measure.findAll({
      include: [{ model: User, as: 'responsible', attributes: ['id', 'name', 'email'] }],
      order: [['article_ref', 'ASC']],
    });
    // obligation ist abgeleitet, nicht gespeichert: Es haengt vom Profil ab und
    // muesste sonst bei jedem Profilwechsel ueber alle Zeilen geschrieben
    // werden — mit der Gefahr, dass eine davon zurueckbleibt.
    const withObligation = items.map((m) => ({
      ...m.toJSON(),
      applicability: normaliseApplicability(m.applicability),
      obligation: obligationFor(m.applicability, profile.entity_type),
    }));
    res.json(withObligation);
  } catch (e) { serverError(res, e, 'nis2'); }
});

/**
 * Kennzahlen, die nur ueber die anwendbaren Kriterien rechnen.
 *
 * Wer 'not_applicable' mitzaehlt, misst das Falsche: Ein indirekt Betroffener
 * stuende dauerhaft bei "nicht erfuellt", weil er die 24-Stunden-Fruehwarnung
 * ans CSIRT nicht leistet, die er gar nicht leisten muss.
 */
router.get('/stats', authenticate, requirePermission('nis2', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const profile = await readProfile();
    const items = await Nis2Measure.findAll();
    res.json({ profile, ...summarise(items, profile.entity_type) });
  } catch (e) { serverError(res, e, 'nis2'); }
});

router.post('/seed', authenticate, requirePermission('nis2', 'seed', 'admin', 'assessor'), async (req, res) => {
  try {
    const count = await Nis2Measure.count();
    if (count > 0) return res.status(409).json({ error: 'Katalog bereits geladen.' });
    await Nis2Measure.bulkCreate(catalog);
    await auditFromReq(req, 'seed', 'nis2_measure', null, 'NIS-2-Katalog', { count: catalog.length });
    res.status(201).json({ ok: true, count: catalog.length });
  } catch (e) { serverError(res, e, 'nis2'); }
});

/**
 * Fehlende Kriterien nachziehen, ohne Bestehendes anzufassen.
 *
 * /seed verweigert sich, sobald ein Katalog existiert — zu Recht, sonst waere
 * ein Klick genug, um alle erfassten Nachweise zu ueberschreiben. Damit bekaeme
 * aber keine bestehende Installation je die Kriterien, die einer spaeteren
 * Version hinzugefuegt werden. Dieser Abgleich legt genau die an, deren
 * Artikelreferenz noch fehlt, und laesst Status, Nachweis, Verantwortliche und
 * eine angepasste Anwendbarkeit unberuehrt.
 */
router.post('/sync-catalog', authenticate, requirePermission('nis2', 'seed', 'admin', 'assessor'), async (req, res) => {
  try {
    const existing = await Nis2Measure.findAll({ attributes: ['article_ref'] });
    const known = new Set(existing.map((m) => m.article_ref));
    const missing = catalog.filter((c) => !known.has(c.article_ref));
    if (!missing.length) return res.json({ ok: true, added: 0, total: known.size });
    await Nis2Measure.bulkCreate(missing);
    await auditFromReq(req, 'seed', 'nis2_measure', null, 'NIS-2-Katalogabgleich', {
      added: missing.length, refs: missing.map((m) => m.article_ref),
    });
    res.status(201).json({ ok: true, added: missing.length, refs: missing.map((m) => m.article_ref), total: known.size + missing.length });
  } catch (e) { serverError(res, e, 'nis2'); }
});

/** Eigenes Kriterium ergaenzen — etwa eine Anforderung aus einem Kundenvertrag. */
router.post('/', authenticate, requirePermission('nis2', 'create', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const { article_ref, category, title, description, applicability } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Titel ist erforderlich.' });
    if (!article_ref) return res.status(400).json({ error: 'Artikelreferenz ist erforderlich.' });
    const duplicate = await Nis2Measure.findOne({ where: { article_ref } });
    if (duplicate) return res.status(409).json({ error: `Zu ${article_ref} existiert bereits ein Kriterium.` });

    const item = await Nis2Measure.create({
      article_ref: String(article_ref).slice(0, 30),
      category: category ? String(category).slice(0, 100) : 'Eigene Kriterien',
      title: String(title).slice(0, 255),
      description: description ? String(description).slice(0, 5000) : null,
      applicability: normaliseApplicability(applicability),
      custom: true,
    });
    await auditFromReq(req, 'create', 'nis2_measure', item.id, item.article_ref, { custom: true });
    res.status(201).json(item);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', authenticate, requirePermission('nis2', 'edit', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const item = await Nis2Measure.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });

    // Authorization is settled by the requirePermission guard on the route above.
    const { implementation_status, responsible_id, evidence, deadline, notes, last_review_date, applicability } = req.body;
    const patch = { implementation_status, responsible_id, evidence, deadline, notes, last_review_date };
    // Anwendbarkeit nur anfassen, wenn sie mitgeschickt wurde: Ein Formular, das
    // nur den Status setzt, darf eine angepasste Einstufung nicht auf die
    // Standardwerte zurueckdrehen.
    if (applicability !== undefined) patch.applicability = normaliseApplicability(applicability);
    // Titel und Text sind nur bei selbst angelegten Kriterien aenderbar — den
    // Wortlaut eines Gesetzesartikels umzuschreiben wuerde den Katalog als
    // Bezugsgroesse wertlos machen.
    if (item.custom) {
      if (typeof req.body.title === 'string' && req.body.title) patch.title = req.body.title.slice(0, 255);
      if (typeof req.body.description === 'string') patch.description = req.body.description.slice(0, 5000);
      if (typeof req.body.category === 'string' && req.body.category) patch.category = req.body.category.slice(0, 100);
    }
    await item.update(patch);
    await auditFromReq(req, 'update', 'nis2_measure', item.id, item.article_ref, applicability !== undefined ? { applicability: patch.applicability } : {});
    res.json(item);
  } catch (e) { serverError(res, e, 'nis2'); }
});

router.delete('/:id', authenticate, requirePermission('nis2', 'delete', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const item = await Nis2Measure.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });

    // Authorization is settled by the requirePermission guard on the route above.
    await auditFromReq(req, 'delete', 'nis2_measure', item.id, item.article_ref, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'nis2'); }
});

// ── Fragenkatalog / Standortbestimmung ───────────────────────────────────────

/**
 * Der Fragebogen beantwortet die Frage, die vor dem Kriterienkatalog steht:
 * Wo stehen wir? Der Katalog fuehrt die Pflichten, der Fragebogen misst die
 * Abdeckung — und die Differenz zwischen beiden ist die Gap-Liste.
 */

const ANSWER_VALUES = new Set(['not_assessed', 'yes', 'partly', 'no']);
const SELF_CHECK_FIELDS = ['answer_implementation', 'answer_evidence', 'evidence_source',
  'notes', 'responsible_id', 'due_date'];

const selfCheckIncludes = () => ([
  { model: User, as: 'responsible', attributes: ['id', 'name', 'email'] },
  { model: User, as: 'answeredBy', attributes: ['id', 'name'] },
  { model: Task, as: 'task', attributes: ['id', 'title', 'status'] },
]);

router.get('/self-check', authenticate, requirePermission('nis2', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const profile = await readProfile();
    const items = await Nis2SelfCheckItem.findAll({
      include: selfCheckIncludes(),
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
    });
    res.json(items.map((i) => ({
      ...i.toJSON(),
      applicability: normaliseApplicability(i.applicability),
      obligation: obligationFor(i.applicability, profile.entity_type),
    })));
  } catch (e) { serverError(res, e, 'nis2'); }
});

/** Auswertung: Quoten je Kategorie, Sicht je NIS-2-Element, Lueckenliste. */
router.get('/self-check/stats', authenticate, requirePermission('nis2', 'view', ...VIEW_ROLES), async (req, res) => {
  try {
    const profile = await readProfile();
    const [items, measures] = await Promise.all([
      Nis2SelfCheckItem.findAll(),
      Nis2Measure.findAll(),
    ]);
    res.json({ profile, ...selfCheck.summarise(items, profile.entity_type, measures) });
  } catch (e) { serverError(res, e, 'nis2'); }
});

router.post('/self-check/seed', authenticate, requirePermission('nis2', 'seed', 'admin', 'assessor'), async (req, res) => {
  try {
    const count = await Nis2SelfCheckItem.count();
    if (count > 0) return res.status(409).json({ error: 'Fragenkatalog ist bereits geladen.' });
    await Nis2SelfCheckItem.bulkCreate(selfCheckCatalog);
    await auditFromReq(req, 'seed', 'nis2_self_check', null, 'NIS-2-Fragenkatalog', { count: selfCheckCatalog.length });
    res.status(201).json({ ok: true, count: selfCheckCatalog.length });
  } catch (e) { serverError(res, e, 'nis2'); }
});

/** Fehlende Fragen nachziehen, ohne bestehende Antworten anzufassen. */
router.post('/self-check/sync-catalog', authenticate, requirePermission('nis2', 'seed', 'admin', 'assessor'), async (req, res) => {
  try {
    const existing = await Nis2SelfCheckItem.findAll({ attributes: ['question_ref'] });
    const known = new Set(existing.map((i) => i.question_ref));
    const missing = selfCheckCatalog.filter((q) => !known.has(q.question_ref));
    if (!missing.length) return res.json({ ok: true, added: 0, total: known.size });
    await Nis2SelfCheckItem.bulkCreate(missing);
    await auditFromReq(req, 'seed', 'nis2_self_check', null, 'NIS-2-Fragenabgleich', {
      added: missing.length, refs: missing.map((q) => q.question_ref),
    });
    res.status(201).json({ ok: true, added: missing.length, refs: missing.map((q) => q.question_ref), total: known.size + missing.length });
  } catch (e) { serverError(res, e, 'nis2'); }
});

router.put('/self-check/:id', authenticate, requirePermission('nis2', 'edit', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const item = await Nis2SelfCheckItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });

    const patch = {};
    for (const field of SELF_CHECK_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(req.body, field)) continue;
      const value = req.body[field];
      if (field.startsWith('answer_')) {
        if (!ANSWER_VALUES.has(value)) return res.status(400).json({ error: `Ungueltige Antwort fuer ${field}.` });
      }
      patch[field] = value;
    }
    if (req.body.applicability !== undefined) patch.applicability = normaliseApplicability(req.body.applicability);
    if (item.custom) {
      if (typeof req.body.question === 'string' && req.body.question) patch.question = req.body.question.slice(0, 2000);
      if (typeof req.body.recommendation === 'string') patch.recommendation = req.body.recommendation.slice(0, 2000);
      if (typeof req.body.category === 'string' && req.body.category) patch.category = req.body.category.slice(0, 100);
    }
    // Wer geantwortet hat, kommt aus der Sitzung. Der Zeitstempel wird nur
    // gesetzt, wenn tatsaechlich eine Antwort kam — eine reine Notiz macht aus
    // einer offenen Frage keine beantwortete.
    if (patch.answer_implementation !== undefined || patch.answer_evidence !== undefined) {
      patch.answered_by_id = req.user.id;
      patch.answered_at = new Date();
    }
    await item.update(patch);
    await auditFromReq(req, 'update', 'nis2_self_check', item.id, item.question_ref, {
      answer_implementation: patch.answer_implementation, answer_evidence: patch.answer_evidence,
    });
    res.json(item);
  } catch (e) { serverError(res, e, 'nis2'); }
});

/**
 * Antwortsatz am Stueck uebernehmen.
 *
 * Wer die Standortbestimmung schon einmal ausserhalb gemacht hat, soll sie
 * nicht 37-mal abtippen muessen. Zugeordnet wird ueber question_ref; was nicht
 * zugeordnet werden kann, wird gemeldet statt still verworfen.
 */
router.post('/self-check/bulk-answer', authenticate, requirePermission('nis2', 'edit', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const rows = req.body?.answers;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'answers muss ein Array sein.' });
    if (rows.length === 0) return res.status(400).json({ error: 'Keine Antworten uebergeben.' });
    if (rows.length > 500) return res.status(400).json({ error: 'Zu viele Antworten auf einmal (max. 500).' });

    const items = await Nis2SelfCheckItem.findAll();
    const byRef = new Map(items.map((i) => [i.question_ref, i]));

    const unknown = [];
    const invalid = [];
    const updates = [];
    for (const row of rows) {
      const ref = typeof row?.question_ref === 'string' ? row.question_ref.trim() : '';
      const item = byRef.get(ref);
      if (!item) { unknown.push(ref || '(ohne Kennung)'); continue; }
      const impl = row.answer_implementation;
      const evid = row.answer_evidence;
      if (impl !== undefined && !ANSWER_VALUES.has(impl)) { invalid.push(ref); continue; }
      if (evid !== undefined && !ANSWER_VALUES.has(evid)) { invalid.push(ref); continue; }
      const patch = { answered_by_id: req.user.id, answered_at: new Date() };
      if (impl !== undefined) patch.answer_implementation = impl;
      if (evid !== undefined) patch.answer_evidence = evid;
      if (typeof row.evidence_source === 'string') patch.evidence_source = row.evidence_source.slice(0, 2000);
      if (typeof row.notes === 'string') patch.notes = row.notes.slice(0, 5000);
      updates.push({ item, patch });
    }
    // Alles oder nichts: Ein halb eingespielter Antwortsatz waere schlimmer als
    // gar keiner, weil niemand mehr sieht, welche Haelfte alt ist.
    await sequelize.transaction(async (t) => {
      for (const { item, patch } of updates) await item.update(patch, { transaction: t });
    });
    await auditFromReq(req, 'update', 'nis2_self_check', null, 'Antwortsatz importiert', {
      applied: updates.length, unknown: unknown.length, invalid: invalid.length,
    });
    res.json({ ok: true, applied: updates.length, unknown, invalid });
  } catch (e) { serverError(res, e, 'nis2'); }
});

/** Aus einer Luecke eine Aufgabe machen — mit der Empfehlung als Beschreibung. */
router.post('/self-check/:id/to-task', authenticate, requirePermission('nis2', 'create', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const item = await Nis2SelfCheckItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    if (item.task_id) return res.status(409).json({ error: 'Zu dieser Frage existiert bereits eine Aufgabe.', task_id: item.task_id });

    // Nicht umgesetzt wiegt schwerer als nicht belegt: das eine ist eine
    // fehlende Massnahme, das andere eine fehlende Seite Papier.
    const priority = item.answer_implementation === 'no' ? 'high'
      : item.answer_implementation === 'partly' ? 'medium' : 'low';
    const task = await Task.create({
      title: (req.body?.title || `NIS-2 ${item.article_ref}: ${item.category}`).slice(0, 255),
      description: [
        `Frage (${item.question_ref}): ${item.question}`,
        item.recommendation ? `Empfehlung: ${item.recommendation}` : '',
        item.notes ? `Notiz: ${item.notes}` : '',
      ].filter(Boolean).join('\n\n').slice(0, 5000),
      status: 'open',
      priority,
      due_date: req.body?.due_date || item.due_date || null,
      assigned_to_id: req.body?.assigned_to_id || item.responsible_id || null,
      created_by_id: req.user.id,
      related_type: 'nis2_self_check',
      related_id: item.id,
    });
    await item.update({ task_id: task.id });
    await auditFromReq(req, 'create', 'task', task.id, task.title, { from_self_check: item.question_ref });
    res.status(201).json({ task, item });
  } catch (e) { serverError(res, e, 'nis2'); }
});

/** Eigene Frage ergaenzen — etwa eine Anforderung aus einem Kundenfragebogen. */
router.post('/self-check', authenticate, requirePermission('nis2', 'create', 'admin', 'assessor', 'dpo'), async (req, res) => {
  try {
    const { question_ref, category, article_ref, question, recommendation, applicability } = req.body || {};
    if (!question) return res.status(400).json({ error: 'Frage ist erforderlich.' });
    if (!question_ref) return res.status(400).json({ error: 'Fragekennung ist erforderlich.' });
    const duplicate = await Nis2SelfCheckItem.findOne({ where: { question_ref } });
    if (duplicate) return res.status(409).json({ error: `Zu ${question_ref} existiert bereits eine Frage.` });

    const last = await Nis2SelfCheckItem.max('sort_order');
    const item = await Nis2SelfCheckItem.create({
      question_ref: String(question_ref).slice(0, 20),
      category: category ? String(category).slice(0, 100) : 'Eigene Fragen',
      article_ref: article_ref ? String(article_ref).slice(0, 30) : 'Eigene',
      question: String(question).slice(0, 2000),
      recommendation: recommendation ? String(recommendation).slice(0, 2000) : null,
      applicability: normaliseApplicability(applicability),
      custom: true,
      sort_order: (Number.isFinite(last) ? last : 0) + 1,
    });
    await auditFromReq(req, 'create', 'nis2_self_check', item.id, item.question_ref, { custom: true });
    res.status(201).json(item);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/self-check/:id', authenticate, requirePermission('nis2', 'delete', 'admin', 'assessor'), async (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Ungueltige Kennung.' });
    const item = await Nis2SelfCheckItem.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Nicht gefunden' });
    // Katalogfragen bleiben stehen. Wer eine Frage nicht beantworten will,
    // setzt ihre Anwendbarkeit auf "nicht anwendbar" — dann ist nachvollziehbar,
    // dass sie bewusst ausgenommen wurde, statt spurlos zu fehlen.
    if (!item.custom) {
      return res.status(409).json({ error: 'Katalogfragen koennen nicht geloescht werden. Stattdessen die Anwendbarkeit auf "nicht anwendbar" setzen.' });
    }
    await auditFromReq(req, 'delete', 'nis2_self_check', item.id, item.question_ref, {});
    await item.destroy();
    res.json({ ok: true });
  } catch (e) { serverError(res, e, 'nis2'); }
});

module.exports = router;
