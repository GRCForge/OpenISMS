const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Nis2Measure, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { getSetting, setSetting } = require('../services/settingsService');
const catalog = require('../services/nis2Catalog');
const {
  PROFILES, OBLIGATIONS, DEFAULT_APPLICABILITY,
  normaliseApplicability, obligationFor, summarise,
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

module.exports = router;
