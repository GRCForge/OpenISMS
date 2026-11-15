#!/usr/bin/env node
'use strict';

/**
 * Mass Assignment bei privilegierten Routen (Security-Review 2026-11, OP-4).
 *
 * POST/PUT in routes/ai-act.js, routes/subject-requests.js und
 * routes/compliance.js (Schulungszuweisungen) uebernahmen { ...req.body }.
 * Geprueft wird, was beim Modell ankommt: erlaubte Felder ja, id,
 * Zeitstempel, ref, completed_at (Betroffenenanfrage), status und
 * contested/contestation_comment (Schulung) nein.
 *
 * Die Handler werden direkt aus dem Express-Router aufgerufen; Models und
 * Audit-Service sind gemockt. Keine Datenbank, kein Netz.
 *
 * Run: node scripts/test-mass-assignment-op4.js
 */

const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-op4-only';
const backendSrc = path.join(__dirname, '..', 'backend', 'src');
const mock = (rel, exports) => {
  const file = require.resolve(path.join(backendSrc, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const calls = [];
const instance = (name, data) => ({
  id: 5, ...data, created_at: new Date('2026-11-15T10:00:00Z'),
  update: async (u) => { calls.push({ model: name, op: 'update', data: u }); Object.assign(instance, u); return instance; },
  toJSON() { return this; },
});
const model = (name) => ({
  create: async (data) => { calls.push({ model: name, op: 'create', data }); return instance(name, data); },
  findByPk: async (id) => (name === 'Training' ? { id, title: 'Awareness 2026' } : instance(name, { id })),
  findAll: async () => [],
  findOne: async () => null,
  update: async () => [0],
});
const names = ['AiSystem', 'User', 'Vendor', 'Task', 'SubjectRequest', 'UserTraining', 'Training',
  'Asset', 'Assessment', 'Kpi', 'KpiMeasurement', 'Audit', 'AuditFinding', 'ApiToken', 'Setting'];
mock('models/index.js', Object.fromEntries(names.map((n) => [n, model(n)])));
mock('services/auditService.js', { auditFromReq: async () => {} });
mock('services/notifyService.js', { notify: async () => {} });

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};

/** Letzten Handler einer Route aus dem Router holen (ohne authenticate/requirePermission). */
const handler = (router, method, routePath) => {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} nicht gefunden`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
};

const invoke = async (fn, { body, params = {} }) => {
  calls.length = 0;
  let status = 200;
  let payload;
  const res = {
    status(c) { status = c; return this; },
    json(b) { payload = b; return this; },
  };
  await fn({ body, params, user: { id: 1, role: 'admin' }, headers: {}, ip: '127.0.0.1' }, res);
  return { status, payload, calls: [...calls] };
};

const keys = (o) => Object.keys(o || {}).sort();
const attack = { id: 999, created_at: '2000-01-01', updated_at: '2000-01-01' };

(async () => {
  // ── AI Act ────────────────────────────────────────────────────────────────
  {
    const router = require(path.join(backendSrc, 'routes', 'ai-act.js'));
    console.log('ai-act — POST /:');
    const r = await invoke(handler(router, 'post', '/'), { body: { name: 'Copilot', risk_category: 'limited', owner_id: '', ...attack } });
    const created = r.calls.find((c) => c.model === 'AiSystem' && c.op === 'create');
    eq('Status 201', r.status, 201);
    eq('nur erlaubte Felder', keys(created && created.data), ['name', 'owner_id', 'risk_category']);
    eq('leere owner_id wird null', created && created.data.owner_id, null);

    console.log('\nai-act — PUT /:id:');
    const u = await invoke(handler(router, 'put', '/:id'), { params: { id: 5 }, body: { notes: 'x', ...attack } });
    const updated = u.calls.find((c) => c.model === 'AiSystem' && c.op === 'update');
    eq('nur erlaubte Felder', keys(updated && updated.data), ['notes']);
  }

  // ── Betroffenenanfragen ───────────────────────────────────────────────────
  {
    const router = require(path.join(backendSrc, 'routes', 'subject-requests.js'));
    console.log('\nsubject-requests — POST /:');
    const r = await invoke(handler(router, 'post', '/'), {
      body: { type: 'access', requester_name: 'A', received_date: '2026-11-01', ref: 'BSA-1999-001', completed_at: '2000-01-01', ...attack },
    });
    const created = r.calls.find((c) => c.model === 'SubjectRequest' && c.op === 'create');
    eq('Status 201', r.status, 201);
    eq('ref/completed_at/id nicht uebernommen', keys(created && created.data), ['due_date', 'received_date', 'requester_name', 'type']);
    eq('Frist 30 Tage aus Eingangsdatum', created && created.data.due_date, '2026-12-01');
    const refUpdate = r.calls.find((c) => c.model === 'SubjectRequest' && c.op === 'update');
    eq('ref vergibt der Server', refUpdate && /^BSA-\d{4}-005$/.test(refUpdate.data.ref), true);

    const done = await invoke(handler(router, 'post', '/'), { body: { type: 'erasure', requester_name: 'B', received_date: '2026-11-01', status: 'completed' } });
    const c2 = done.calls.find((c) => c.model === 'SubjectRequest' && c.op === 'create');
    eq('status=completed -> completed_at vom Server', c2 && c2.data.completed_at instanceof Date, true);
  }

  // ── Schulungszuweisungen ──────────────────────────────────────────────────
  {
    const router = require(path.join(backendSrc, 'routes', 'compliance.js'));
    console.log('\ncompliance — POST /trainings:');
    const r = await invoke(handler(router, 'post', '/trainings'), {
      body: { user_id: 3, training_id: 7, completed_at: '2026-11-01', status: 'valid', contested: true, contestation_comment: 'x', ...attack },
    });
    const created = r.calls.find((c) => c.model === 'UserTraining' && c.op === 'create');
    eq('Status 201', r.status, 201);
    eq('nur erlaubte Felder + Serverfelder', keys(created && created.data), ['completed_at', 'status', 'training_id', 'training_title', 'user_id']);
    eq('status aus completed_at abgeleitet', created && created.data.status, 'valid');
    eq('training_title aus Stammdaten', created && created.data.training_title, 'Awareness 2026');

    const p = await invoke(handler(router, 'post', '/trainings'), { body: { user_id: 3, training_title: 'T', status: 'valid' } });
    const c2 = p.calls.find((c) => c.model === 'UserTraining' && c.op === 'create');
    eq('status=valid ohne completed_at -> pending', c2 && c2.data.status, 'pending');

    console.log('\ncompliance — PUT /trainings/:id:');
    const u = await invoke(handler(router, 'put', '/trainings/:id'), {
      params: { id: 5 }, body: { expires_at: '2027-11-01', contested: false, contestation_comment: null, status: 'valid', ...attack },
    });
    const updated = u.calls.find((c) => c.model === 'UserTraining' && c.op === 'update');
    eq('contested/status/id nicht uebernommen', keys(updated && updated.data), ['expires_at']);
  }
})()
  .catch((e) => { failures++; console.log('  FAIL  Tests abgebrochen:', e.stack || e.message); })
  .finally(() => {
    console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
    process.exit(failures ? 1 : 0);
  });
