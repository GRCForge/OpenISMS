'use strict';

// Zuordnung Massnahme -> Anforderung, ueber Regelwerksgrenzen hinweg.
//
// Die Tabelle ist fuehrend, der Graph folgt ihr per Trigger (siehe
// services/graphProjection.js). Deshalb passiert hier nichts Graph-Spezifisches:
// Ein INSERT genuegt, die Kante entsteht in derselben Transaktion.

const express = require('express');
const { Control, Iso27001Control, BsiRequirement, Nis2Measure, C5Criterion, TisaxRequirement, ControlRequirement } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');

// mergeParams: Ohne das kaeme :controlId aus dem uebergeordneten Pfad hier
// nie an - req.params.controlId waere undefined und jede Anfrage liefe in
// "Ungueltige Massnahmen-id".
const router = express.Router({ mergeParams: true });
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
router.use(authenticate);

// Regelwerk -> Modell und die Spalte, unter der ein Pruefer die Anforderung
// nennt. Dieselbe Zuordnung steht fachlich auch in graphProjection.js; dort
// als SQL-Ausdruck fuer die Trigger, hier als Modell fuer die Routen. Beide
// aus einer Quelle zu erzeugen haette die Projektion von den Modellen abhaengig
// gemacht - sie muss aber vor dem ersten Modellzugriff nutzbar sein.
const KATALOGE = {
  iso27001: { model: Iso27001Control,  refFeld: 'ref' },
  bsi:      { model: BsiRequirement,   refFeld: 'req_id' },
  nis2:     { model: Nis2Measure,      refFeld: 'article_ref' },
  c5:       { model: C5Criterion,      refFeld: 'criterion_id' },
  tisax:    { model: TisaxRequirement, refFeld: 'ref' },
};

const katalogOder400 = (framework, res) => {
  const k = KATALOGE[String(framework || '').toLowerCase()];
  if (!k) {
    res.status(400).json({
      error: `Unbekanntes Regelwerk "${framework}" (bekannt: ${Object.keys(KATALOGE).join(', ')})`,
    });
    return null;
  }
  return k;
};

// Die Anforderungen eines Regelwerks anreichern, damit die Oberflaeche nicht je
// Zuordnung einzeln nachschlagen muss.
const anforderungenLaden = async (eintraege) => {
  const nachFramework = {};
  for (const e of eintraege) (nachFramework[e.framework] = nachFramework[e.framework] || []).push(e.requirement_id);

  const gefunden = {};
  for (const [framework, ids] of Object.entries(nachFramework)) {
    const k = KATALOGE[framework];
    if (!k) continue;
    const rows = await k.model.findAll({ where: { id: [...new Set(ids)] } });
    for (const r of rows) {
      gefunden[`${framework}:${r.id}`] = {
        id: r.id,
        ref: r[k.refFeld],
        title: r.title,
        status: r.implementation_status ?? r.status ?? null,
      };
    }
  }

  return eintraege.map(e => ({
    id: e.id,
    control_id: e.control_id,
    framework: e.framework,
    requirement_id: e.requirement_id,
    coverage: e.coverage,
    note: e.note,
    // null, wenn der Katalogeintrag nicht mehr existiert. Das kann vorkommen,
    // weil requirement_id polymorph ist und deshalb kein Fremdschluessel sie
    // absichern kann (siehe models/ControlRequirement.js). Sichtbar zu machen,
    // DASS die Zuordnung ins Leere zeigt, ist besser, als sie wegzulassen -
    // sonst verschwindet sie aus der Oberflaeche und bleibt in der Tabelle.
    requirement: gefunden[`${e.framework}:${e.requirement_id}`] || null,
  }));
};

// GET /api/controls/:controlId/requirements
router.get('/', requirePermission('controls', 'view', 'admin', 'owner', 'assessor', 'viewer', 'it-staff', 'dpo', 'employee', 'management'), async (req, res) => {
  try {
    const controlId = Number.parseInt(req.params.controlId, 10);
    if (!Number.isInteger(controlId)) return res.status(400).json({ error: 'Ungueltige Massnahmen-id' });

    const eintraege = await ControlRequirement.findAll({
      where: { control_id: controlId },
      order: [['framework', 'ASC'], ['id', 'ASC']],
    });
    res.json(await anforderungenLaden(eintraege));
  } catch (e) { serverError(res, e, 'control-requirements'); }
});

// POST /api/controls/:controlId/requirements
router.post('/', requirePermission('controls', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const controlId = Number.parseInt(req.params.controlId, 10);
    if (!Number.isInteger(controlId)) return res.status(400).json({ error: 'Ungueltige Massnahmen-id' });

    const control = await Control.findByPk(controlId);
    if (!control) return res.status(404).json({ error: 'Massnahme nicht gefunden' });

    const { framework, requirement_id, coverage, note } = req.body || {};
    const katalog = katalogOder400(framework, res);
    if (!katalog) return undefined;

    const reqId = Number.parseInt(requirement_id, 10);
    if (!Number.isInteger(reqId)) return res.status(400).json({ error: 'requirement_id erforderlich' });

    // Die Existenz wird HIER geprueft, weil die Datenbank es nicht kann: Ein
    // polymorphes Ziel laesst sich nicht per Fremdschluessel absichern. Ohne
    // diese Pruefung entstuende eine Zuordnung auf eine Anforderung, die es
    // nicht gibt - und die im Nachweis als Abdeckung mitzaehlte.
    const ziel = await katalog.model.findByPk(reqId);
    if (!ziel) {
      return res.status(400).json({ error: `Anforderung ${reqId} existiert im Regelwerk ${framework} nicht` });
    }

    if (coverage !== undefined && !['full', 'partial'].includes(coverage)) {
      return res.status(400).json({ error: "coverage muss 'full' oder 'partial' sein" });
    }

    const vorhanden = await ControlRequirement.findOne({
      where: { control_id: controlId, framework, requirement_id: reqId },
    });
    if (vorhanden) {
      return res.status(409).json({ error: 'Diese Zuordnung besteht bereits.' });
    }

    const eintrag = await ControlRequirement.create({
      control_id: controlId,
      framework,
      requirement_id: reqId,
      coverage: coverage || 'full',
      note: note || null,
      created_by_id: req.user?.id ?? null,
    });

    // Eine Zuordnung ist eine Aussage ueber die Erfuellung einer normativen
    // Anforderung. Sie gehoert protokolliert wie jede andere Aussage, auf die
    // sich ein Nachweis stuetzt.
    await auditFromReq(req, 'create', 'control', controlId, control.code, {
      requirement: `${framework}:${ziel[katalog.refFeld]}`,
      coverage: eintrag.coverage,
    });

    const [angereichert] = await anforderungenLaden([eintrag]);
    res.status(201).json(angereichert);
  } catch (e) { serverError(res, e, 'control-requirements'); }
});

// DELETE /api/controls/:controlId/requirements/:id
router.delete('/:id', requirePermission('controls', 'edit', 'admin', 'assessor', 'it-staff'), async (req, res) => {
  try {
    const controlId = Number.parseInt(req.params.controlId, 10);
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(controlId) || !Number.isInteger(id)) {
      return res.status(400).json({ error: 'Ungueltige id' });
    }

    const eintrag = await ControlRequirement.findOne({ where: { id, control_id: controlId } });
    if (!eintrag) return res.status(404).json({ error: 'Zuordnung nicht gefunden' });

    const control = await Control.findByPk(controlId);
    const katalog = KATALOGE[eintrag.framework];
    const ziel = katalog ? await katalog.model.findByPk(eintrag.requirement_id) : null;

    await eintrag.destroy();
    await auditFromReq(req, 'delete', 'control', controlId, control?.code ?? String(controlId), {
      requirement: `${eintrag.framework}:${ziel ? ziel[katalog.refFeld] : eintrag.requirement_id}`,
    });
    res.status(204).end();
  } catch (e) { serverError(res, e, 'control-requirements'); }
});

module.exports = router;
