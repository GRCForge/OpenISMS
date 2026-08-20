const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Vendor, VendorContact, Asset, User, Incident, VvtEntry } = require('../models');
const { authenticate, isItStaff, isDpo, requirePermission } = require('../middleware/auth');
const { serverError } = require('../utils/httpError');
const { auditFromReq } = require('../services/auditService');
const { can } = require('../services/permissionService');

router.get('/', authenticate, requirePermission('vendors','view','admin','owner','assessor','viewer','it-staff','dpo','employee','management'), async (req, res) => {
  try {
    // Staff (admin/assessor/it-staff/dpo) get the full vendor list with contacts —
    // the same roles allowed on the detail view. Other roles still need a vendor
    // list for reference/pickers (e.g. asset owners choosing a vendor), so they get
    // only non-sensitive base fields and no contact details.
    // Which fields come back is the same decision as who may open the detail
    // view, so it reads the same matrix entry instead of a second role list that
    // could drift away from it.
    const detailVerdict = await can(req.user, 'vendors', 'view_details');
    const staff = typeof detailVerdict === 'boolean' ? detailVerdict : (isItStaff(req) || isDpo(req));
    const vendors = staff
      ? await Vendor.findAll({ include: [{ model: VendorContact, as: 'contacts' }], order: [['name', 'ASC']] })
      : await Vendor.findAll({ attributes: ['id', 'name', 'type', 'criticality'], order: [['name', 'ASC']] });
    res.json(vendors);
  } catch (e) { serverError(res, e, 'vendors'); }
});

// Get single vendor
router.get('/:id', authenticate, requirePermission('vendors','view_details','admin','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const vendor = await Vendor.findByPk(req.params.id, {
      include: [
        { model: VendorContact, as: 'contacts' },
        { model: User, as: 'assessedBy', attributes: ['id', 'name'] },
        { model: Incident, as: 'incidents', through: { attributes: [] } },
        { model: VvtEntry, as: 'vvtEntries', through: { attributes: [] } },
      ],
    });
    if (!vendor) return res.status(404).json({ error: 'Not found' });
    res.json(vendor);
  } catch (e) {
    serverError(res, e, 'vendors');
  }
});

// Create vendor (admin/assessor/it-staff/dpo)
router.post('/', authenticate, requirePermission('vendors','create','admin','assessor','it-staff','dpo'), async (req, res) => {
  try {
    const { name, type, website, phone, address, notes } = req.body;
    const vendor = await Vendor.create({ name, type, website, phone, address, notes });
    await auditFromReq(req, 'create', 'vendor', vendor.id, vendor.name, { name, type, website, phone, address, notes });
    res.status(201).json(vendor);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update vendor
router.put('/:id', authenticate, requirePermission('vendors','edit','admin','assessor','it-staff','dpo'), async (req, res) => {
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  
  const fields = ['name', 'type', 'website', 'phone', 'address', 'notes'];
  const before = {};
  fields.forEach(f => before[f] = vendor[f]);
  
  const { name, type, website, phone, address, notes } = req.body;
  await vendor.update({ name, type, website, phone, address, notes });
  
  const after = {};
  fields.forEach(f => after[f] = vendor[f]);
  
  await auditFromReq(req, 'update', 'vendor', vendor.id, vendor.name, { before, after });
  res.json(vendor);
});

// Delete vendor (admin only)
router.delete('/:id', authenticate, requirePermission('vendors','delete','admin'), async (req, res) => {
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  const name = vendor.name;
  await vendor.destroy();
  await auditFromReq(req, 'delete', 'vendor', req.params.id, name, {});
  res.json({ ok: true });
});

// ── Contacts ──────────────────────────────────────────────────────────────────

// Add contact to vendor
router.post('/:id/contacts', authenticate, requirePermission('vendors','contacts','admin','assessor','it-staff','dpo'), async (req, res) => {
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  try {
    const { name, email, phone, role, notes } = req.body;
    const contact = await VendorContact.create({ name, email, phone, role, notes, vendor_id: vendor.id });
    await auditFromReq(req, 'create', 'vendor', vendor.id, vendor.name, { action: 'add_contact', contact_name: contact.name });
    res.status(201).json(contact);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update contact
router.put('/:id/contacts/:contactId', authenticate, requirePermission('vendors','contacts','admin','assessor','it-staff','dpo'), async (req, res) => {
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  const contact = await VendorContact.findOne({ where: { id: req.params.contactId, vendor_id: req.params.id } });
  if (!contact) return res.status(404).json({ error: 'Not found' });
  const before = { name: contact.name, email: contact.email, phone: contact.phone, role: contact.role };
  const { name, email, phone, role, notes } = req.body;
  await contact.update({ name, email, phone, role, notes });
  await auditFromReq(req, 'update', 'vendor', vendor.id, vendor.name, { action: 'update_contact', contact_name: contact.name, before, after: { name: contact.name, email: contact.email, phone: contact.phone, role: contact.role } });
  res.json(contact);
});

// Delete contact (admin/assessor/it-staff/dpo)
router.delete('/:id/contacts/:contactId', authenticate, requirePermission('vendors','contacts','admin','assessor','it-staff','dpo'), async (req, res) => {
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  const contact = await VendorContact.findOne({ where: { id: req.params.contactId, vendor_id: req.params.id } });
  if (!contact) return res.status(404).json({ error: 'Not found' });
  const contactName = contact.name;
  await contact.destroy();
  await auditFromReq(req, 'delete', 'vendor', vendor.id, vendor.name, { action: 'delete_contact', contact_name: contactName });
  res.json({ ok: true });
});

// Risk Assessment
const handleAssess = async (req, res) => {
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  try {
    const fields = [
      'risk_level', 'risk_score', 'data_processor', 'dpa_signed', 'dpa_signed_at',
      'iso27001_certified', 'soc2_certified', 'gdpr_compliant',
      'fourth_party_risks', 'assessment_notes', 'next_review_date'
    ];
    
    const before = {};
    fields.forEach(f => before[f] = vendor[f]);
    
    const {
      risk_level, risk_score, data_processor, dpa_signed, dpa_signed_at,
      iso27001_certified, soc2_certified, gdpr_compliant,
      fourth_party_risks, assessment_notes, next_review_date,
    } = req.body;
    
    const cleanDate = (val) => (val === '' || val === 'Invalid date') ? null : val;
    
    await vendor.update({
      risk_level,
      risk_score,
      data_processor,
      dpa_signed,
      dpa_signed_at: cleanDate(dpa_signed_at),
      iso27001_certified,
      soc2_certified,
      gdpr_compliant,
      fourth_party_risks,
      assessment_notes,
      next_review_date: cleanDate(next_review_date),
      last_assessed_at: new Date(),
      assessed_by_id: req.user.id,
    });
    
    const after = {};
    fields.forEach(f => after[f] = vendor[f]);
    
    await auditFromReq(req, 'update', 'vendor', vendor.id, vendor.name, {
      action: 'risk_assessment',
      before,
      after
    });
    res.json(vendor);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};

router.post('/:id/assess', authenticate, requirePermission('vendors','assess','admin','assessor','it-staff','dpo'), handleAssess);
router.patch('/:id/assessment', authenticate, requirePermission('vendors','assess','admin','assessor','it-staff','dpo'), handleAssess);

module.exports = router;
