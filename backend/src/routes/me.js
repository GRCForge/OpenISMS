const router = require('express').Router();
const { Op } = require('sequelize');
const { authenticate } = require('../middleware/auth');
const { Asset, Assessment, Risk, VvtEntry, Vendor, Incident, Task, PasskeyCredential, User } = require('../models');

router.use(authenticate);

router.get('/overview', async (req, res) => {
  try {
    const { user } = req;
    const today = new Date().toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

    const result = {
      my_tasks: [],
      passkey_count: 0,
      sections: [],
    };

    // My open tasks (individual + role-based) and passkey count — run in parallel
    [result.my_tasks, result.passkey_count] = await Promise.all([
      Task.findAll({
        where: {
          status: { [Op.notIn]: ['done', 'cancelled'] },
          [Op.or]: [
            { assigned_to_id: user.id },
            { assigned_role: user.role }
          ]
        },
        order: [['due_date', 'ASC'], ['priority', 'DESC']],
        limit: 10,
      }),
      PasskeyCredential.count({ where: { user_id: user.id } }),
    ]);

    const addSection = (title, description, items, link, actionLabel) => {
      if (items.length > 0) result.sections.push({ title, description, items: items.slice(0, 8), total: items.length, link, actionLabel });
    };

    // Run all role-specific query blocks in parallel
    await Promise.all([

      // ── ASSESSOR / ADMIN ────────────────────────────────────────────────────
      ['admin', 'assessor'].includes(user.role) && (async () => {
        const [assessedAssetIds, overdueAssessments, unownedRisks] = await Promise.all([
          Assessment.findAll({ where: { is_current: true }, attributes: ['asset_id'] }),
          Assessment.findAll({
            where: { is_current: true, next_review_at: { [Op.lt]: new Date() } },
            include: [{ model: Asset, attributes: ['id', 'name'] }],
            order: [['next_review_at', 'ASC']], limit: 20,
          }),
          Risk.findAll({
            where: { status: { [Op.notIn]: ['closed', 'accepted'] }, owner_id: null },
            attributes: ['id', 'title', 'status'],
            order: [['created_at', 'DESC']], limit: 20,
          }),
        ]);

        const ids = assessedAssetIds.map(a => a.asset_id);
        const unassessedAssets = await Asset.findAll({
          where: { id: { [Op.notIn]: ids.length ? ids : [0] }, status: 'active' },
          attributes: ['id', 'name', 'type', 'classification'],
          order: [['name', 'ASC']], limit: 50,
        });

        addSection('Assets ohne Bewertung', 'Aktive Assets ohne aktuelle Schutzbedarfsfeststellung', unassessedAssets.map(a => ({ id: a.id, name: a.name, sub: `${a.type} · ${a.classification}`, link: `/assets/${a.id}` })), '/assessments', 'Bewertung starten');
        addSection('Fällige Reviews', 'Bewertungen deren Review-Datum überschritten ist', overdueAssessments.map(a => ({ id: a.id, name: a.Asset?.name || 'Unbekannt', sub: `Review fällig seit ${new Date(a.next_review_at).toLocaleDateString('de')}`, link: `/assets/${a.asset_id}` })), '/assessments', 'Review öffnen');
        addSection('Risiken ohne Verantwortlichen', 'Offene Risiken ohne zugewiesenen Owner', unownedRisks.map(r => ({ id: r.id, name: r.title, sub: r.status, link: '/risks' })), '/risks', 'Risiken öffnen');
      })(),

      // ── DPO / ADMIN ─────────────────────────────────────────────────────────
      ['admin', 'dpo'].includes(user.role) && (async () => {
        const [draftVvt, vendorsNoDpa, assetsVvtPending] = await Promise.all([
          VvtEntry.findAll({ where: { status: 'draft' }, attributes: ['id', 'name', 'legal_basis'], order: [['name', 'ASC']], limit: 20 }),
          Vendor.findAll({
            where: { data_processor: true, dpa_signed: false },
            attributes: ['id', 'name', 'type'],
            order: [['name', 'ASC']], limit: 20,
          }),
          Asset.findAll({ where: { vvt_status: 'pending' }, attributes: ['id', 'name', 'type'], order: [['name', 'ASC']], limit: 20 }),
        ]);

        addSection('VVT-Entwürfe', 'Verarbeitungsverzeichnis-Einträge im Entwurfsstatus', draftVvt.map(v => ({ id: v.id, name: v.name, sub: `Rechtsgrundlage: ${v.legal_basis}`, link: '/vvt' })), '/vvt', 'VVT öffnen');
        addSection('Fehlende Auftragsverarbeitungsverträge (AVV)', 'Dienstleister verarbeiten Daten in Ihrem Auftrag, aber kein AVV hinterlegt', vendorsNoDpa.map(v => ({ id: v.id, name: v.name, sub: v.type, link: '/vendors' })), '/vendors', 'Dienstleister öffnen');
        addSection('Assets mit ausstehendem VVT-Eintrag', 'Diese Assets sind als datenschutzrelevant markiert, haben aber keinen VVT-Eintrag', assetsVvtPending.map(a => ({ id: a.id, name: a.name, sub: a.type, link: `/assets/${a.id}` })), '/vvt', 'VVT anlegen');
      })(),

      // ── IT-STAFF / ADMIN ─────────────────────────────────────────────────────
      ['admin', 'it-staff'].includes(user.role) && (async () => {
        const [criticalPatch, eolAssets, criticalCve] = await Promise.all([
          Asset.findAll({ where: { patch_status: 'critical', status: 'active' }, attributes: ['id', 'name', 'type', 'patch_status'], order: [['name', 'ASC']], limit: 20 }),
          Asset.findAll({ where: { eol_date: { [Op.between]: [today, in90] }, status: 'active' }, attributes: ['id', 'name', 'type', 'eol_date'], order: [['eol_date', 'ASC']], limit: 20 }),
          Asset.findAll({ where: { cve_critical: { [Op.gt]: 0 }, status: 'active' }, attributes: ['id', 'name', 'cve_critical', 'cve_high'], order: [['cve_critical', 'DESC']], limit: 20 }),
        ]);

        addSection('Kritischer Patch-Status', 'Assets mit dringendem Handlungsbedarf bei Sicherheitsupdates', criticalPatch.map(a => ({ id: a.id, name: a.name, sub: a.type, link: `/assets/${a.id}` })), '/assets', 'Assets öffnen');
        addSection('End-of-Life in 90 Tagen', 'Assets erreichen bald das End-of-Support-Datum', eolAssets.map(a => ({ id: a.id, name: a.name, sub: `EOL: ${a.eol_date}`, link: `/assets/${a.id}` })), '/assets', 'Assets öffnen');
        addSection('Assets mit kritischen CVEs', 'Assets mit bekannten kritischen Sicherheitslücken', criticalCve.map(a => ({ id: a.id, name: a.name, sub: `${a.cve_critical} kritisch, ${a.cve_high} hoch`, link: `/assets/${a.id}` })), '/assets', 'Assets öffnen');
      })(),

      // ── OWNER ───────────────────────────────────────────────────────────────
      user.role === 'owner' && (async () => {
        const myAssets = await Asset.findAll({ where: { owner_id: user.id, status: 'active' }, attributes: ['id', 'name', 'type', 'patch_status', 'eol_date'], order: [['name', 'ASC']], limit: 30 });
        const needsAttention = myAssets.filter(a => a.patch_status === 'critical' || (a.eol_date && a.eol_date <= in90));
        addSection('Meine Assets mit Handlungsbedarf', 'Deine verantworteten Assets mit kritischem Status oder nahendem EOL', needsAttention.map(a => ({ id: a.id, name: a.name, sub: `${a.patch_status === 'critical' ? '⚠ Patch kritisch' : ''}${a.eol_date && a.eol_date <= in90 ? ` EOL ${a.eol_date}` : ''}`.trim(), link: `/assets/${a.id}` })), '/assets', 'Asset öffnen');
      })(),

      // ── ADMIN only ───────────────────────────────────────────────────────────
      user.role === 'admin' && (async () => {
        const [allUsers, passkeyRows, openIncidents] = await Promise.all([
          User.findAll({ where: { active: true }, attributes: ['id', 'name', 'email', 'totp_enabled', 'role', 'sso_user'] }),
          PasskeyCredential.findAll({ attributes: ['user_id'] }),
          Incident.findAll({ where: { status: { [Op.notIn]: ['resolved', 'closed'] }, severity: { [Op.in]: ['high', 'critical'] } }, attributes: ['id', 'title', 'severity', 'status'], order: [['created_at', 'DESC']], limit: 10 }),
        ]);

        const passkeyUserIds = passkeyRows.map(p => p.user_id);
        const noMfa = allUsers.filter(u => !u.totp_enabled && !passkeyUserIds.includes(u.id) && !u.sso_user);
        addSection('Benutzer ohne MFA', 'Aktive Benutzer ohne TOTP oder Passkey — Sicherheitsrisiko', noMfa.map(u => ({ id: u.id, name: u.name, sub: `${u.email} · ${u.role}`, link: '/admin' })), '/admin', 'Benutzerverwaltung');
        addSection('Offene Hochrisiko-Vorfälle', 'Sicherheitsvorfälle mit hoher oder kritischer Schwere', openIncidents.map(i => ({ id: i.id, name: i.title, sub: `${i.severity} · ${i.status}`, link: '/incidents' })), '/incidents', 'Vorfälle öffnen');
      })(),

    ]);

    res.json(result);
  } catch (e) {
    console.error('[Me overview]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
