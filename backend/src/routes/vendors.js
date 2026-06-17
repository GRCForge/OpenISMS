const router = require('express').Router();
const { apiLimiter } = require('../middleware/rateLimiter');
router.use(apiLimiter);
const { Vendor, VendorContact, Asset, User, Incident, VvtEntry } = require('../models');
const { authenticate, isItStaff, isAdmin, isDpo } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

router.get('/', authenticate, async (req, res) => {
  try {
    const vendors = await Vendor.findAll({
      include: [{ model: VendorContact, as: 'contacts' }],
      order: [['name', 'ASC']]
    });
    res.json(vendors);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single vendor
router.get('/:id', authenticate, async (req, res) => {
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
    
    // Authorization: only admin, assessor, it-staff, dpo can view vendor details
    if (!isAdmin(req) && !isItStaff(req) && !isDpo(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    res.json(vendor);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create vendor (admin/assessor/it-staff/dpo)
router.post('/', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req)) return res.status(403).json({ error: 'Forbidden' });
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
router.put('/:id', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req) && !isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
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
router.delete('/:id', authenticate, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
  const vendor = await Vendor.findByPk(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  const name = vendor.name;
  await vendor.destroy();
  await auditFromReq(req, 'delete', 'vendor', req.params.id, name, {});
  res.json({ ok: true });
});

// ── Contacts ──────────────────────────────────────────────────────────────────

// Add contact to vendor
router.post('/:id/contacts', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req)) return res.status(403).json({ error: 'Forbidden' });
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
router.put('/:id/contacts/:contactId', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req)) return res.status(403).json({ error: 'Forbidden' });
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
router.delete('/:id/contacts/:contactId', authenticate, async (req, res) => {
  if (!isItStaff(req) && !isDpo(req)) return res.status(403).json({ error: 'Forbidden' });
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
  if (!isItStaff(req) && !isDpo(req)) return res.status(403).json({ error: 'Forbidden' });
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

router.post('/:id/assess', authenticate, handleAssess);
router.patch('/:id/assessment', authenticate, handleAssess);

module.exports = router;
