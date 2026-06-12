const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { Asset, User, Vendor, VendorContact, Risk } = require('../models');
const { authenticate, requireRole } = require('../middleware/auth');
const { auditFromReq } = require('../services/auditService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

const TYPE_MAP = {
  anwendung: 'application', application: 'application',
  software: 'software',
  hardware: 'hardware',
  dienst: 'service', service: 'service',
  daten: 'data', data: 'data',
  information: 'information',
  prozess: 'process', process: 'process',
  personal: 'personal',
  sonstiges: 'other', other: 'other',
};
const CLASS_MAP = {
  öffentlich: 'public', public: 'public',
  intern: 'internal', internal: 'internal',
  vertraulich: 'confidential', confidential: 'confidential',
  geheim: 'secret', secret: 'secret',
};
const HOSTING_MAP = {
  'on-premise': 'on-premise', 'on_premise': 'on-premise', 'onpremise': 'on-premise',
  cloud_public: 'cloud_public', 'cloud-public': 'cloud_public', 'cloud public': 'cloud_public',
  cloud_private: 'cloud_private', 'cloud-private': 'cloud_private', 'cloud private': 'cloud_private',
  hybrid: 'hybrid',
};
const LIFECYCLE_MAP = {
  evaluierung: 'evaluation', evaluation: 'evaluation',
  produktion: 'production', production: 'production',
  wartung: 'maintenance', maintenance: 'maintenance',
  archiviert: 'archived', archived: 'archived',
};
const PATCH_MAP = {
  'up-to-date': 'up-to-date', aktuell: 'up-to-date', konform: 'up-to-date',
  pending: 'pending', ausstehend: 'pending',
  critical: 'critical', kritisch: 'critical', veraltet: 'critical',
};
const STATUS_MAP = {
  aktiv: 'active', active: 'active',
  inaktiv: 'inactive', inactive: 'inactive',
  ausgemustert: 'decommissioned', decommissioned: 'decommissioned',
};
const VVT_MAP = {
  none: 'none', kein: 'none', 'nicht verzeichnet': 'none',
  pending: 'pending', 'in arbeit': 'pending',
  complete: 'complete', vollständig: 'complete',
};
const DATA_CAT_MAP = {
  none: 'none', unbekannt: 'none',
  normal: 'normal',
  special: 'special', besonders: 'special', 'art. 9': 'special',
};

const parseBool = (val) => {
  if (!val) return false;
  const v = val.toString().toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'ja' || v === 'yes';
};

const ENTITY_CONFIGS = {
  asset: {
    model: Asset,
    label: 'Assets',
    fields: [
      { key: 'name', label: 'Name', required: true, aliases: ['bezeichnung', 'asset'] },
      { key: 'type', label: 'Typ', map: TYPE_MAP, aliases: ['typ'] },
      { key: 'classification', label: 'Klassifizierung', map: CLASS_MAP, aliases: ['schutzbedarf'] },
      { key: 'description', label: 'Beschreibung' },
      { key: 'owner_email', label: 'Eigentümer-E-Mail', aliases: ['eigentümer', 'owner'] },
      { key: 'assessor_email', label: 'Bewerter-E-Mail', aliases: ['bewerter', 'assessor'] },
      { key: 'version', label: 'Version' },
      { key: 'vendor', label: 'Hersteller', aliases: ['vendor'] },
      { key: 'location', label: 'Standort', aliases: ['location'] },
      { key: 'frameworks', label: 'Frameworks (ISO, NIS2, GDPR)', type: 'array' },
      { key: 'hosting_type', label: 'Hosting', map: HOSTING_MAP },
      { key: 'lifecycle_status', label: 'Lifecycle', map: LIFECYCLE_MAP },
      { key: 'status', label: 'Status', map: STATUS_MAP },
      { key: 'nis2_relevant', label: 'NIS-2 relevant', type: 'bool' },
      { key: 'patch_status', label: 'Patch-Status', map: PATCH_MAP },
      { key: 'eol_date', label: 'EOL-Datum', type: 'date' },
      { key: 'tags', label: 'Tags', type: 'array' },
      { key: 'department', label: 'Abteilung', aliases: ['abteilung'] },
    ]
  },
  user: {
    model: User,
    label: 'Benutzer',
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'email', label: 'E-Mail', required: true },
      { key: 'role', label: 'Rolle', aliases: ['role'], default: 'viewer' },
      { key: 'department', label: 'Abteilung', aliases: ['abteilung'] },
      { key: 'active', label: 'Aktiv', type: 'bool', default: true },
    ]
  },
  vendor: {
    model: Vendor,
    label: 'Dienstleister',
    fields: [
      { key: 'name', label: 'Firmenname', required: true, aliases: ['firma', 'hersteller', 'vendor'] },
      { key: 'type', label: 'Typ (it_provider, cloud_provider, etc.)', aliases: ['typ'] },
      { key: 'website', label: 'Webseite' },
      { key: 'address', label: 'Anschrift' },
      { key: 'notes', label: 'Notizen' },
      { key: 'data_processor', label: 'Auftragsverarbeiter', type: 'bool' },
      { key: 'dpa_signed', label: 'AVV unterzeichnet', type: 'bool' },
    ]
  },
  risk: {
    model: Risk,
    label: 'Risiken',
    fields: [
      { key: 'title', label: 'Titel', required: true },
      { key: 'description', label: 'Beschreibung' },
      { key: 'category', label: 'Kategorie' },
      { key: 'likelihood', label: 'Wahrscheinlichkeit', type: 'int', default: 3 },
      { key: 'impact', label: 'Auswirkung', type: 'int', default: 3 },
      { key: 'treatment', label: 'Behandlung', default: 'mitigate' },
      { key: 'status', label: 'Status', default: 'open' },
    ]
  },
  vendor_contact: {
    label: 'Firmen + Kontakte (Outlook)',
    fields: [
      { key: 'company_name', label: 'Unternehmen / Firma', required: true, aliases: ['company', 'organisation', 'firma', 'arbeitgeber'] },
      { key: 'contact_name', label: 'Name (Kontakt)', required: true, aliases: ['nachname', 'vorname', 'name', 'full name', 'display name'] },
      { key: 'email', label: 'E-Mail', aliases: ['e-mail-adresse', 'email address', 'e-mail'] },
      { key: 'phone', label: 'Telefon', aliases: ['geschäftlich', 'business phone', 'telefon geschäftlich'] },
      { key: 'role', label: 'Position / Rolle', aliases: ['job title', 'position', 'berufsgruppe'] },
      { key: 'website', label: 'Webseite (Firma)', aliases: ['web page', 'webseite', 'homepage'] },
      { key: 'address', label: 'Anschrift (Firma)', aliases: ['business address', 'straße geschäftlich', 'ort geschäftlich'] },
    ]
  }
};

const readRows = async (file) => {
  const rows = [];
  if (file.originalname.endsWith('.csv')) {
    const text = file.buffer.toString('utf-8').replace(/\r/g, '');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const sep = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim());
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(sep).map(v => v.replace(/^"|"$/g, '').trim());
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
      rows.push(row);
    }
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const worksheet = workbook.getWorksheet(1);
    const headers = [];
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = cell.text.trim();
    });
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const dataRow = {};
      row.eachCell((cell, colNumber) => {
        dataRow[headers[colNumber]] = cell.text.trim();
      });
      rows.push(dataRow);
    });
  }
  return rows;
};

router.post('/preview', authenticate, requireRole('admin', 'assessor', 'it-staff'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const type = req.body.type || 'asset';
  const config = ENTITY_CONFIGS[type];
  if (!config) return res.status(400).json({ error: 'Ungültiger Import-Typ' });

  try {
    const rows = await readRows(req.file);
    if (rows.length === 0) return res.status(400).json({ error: 'Datei ist leer' });
    
    const headers = Object.keys(rows[0]);
    
    // Intelligent mapping
    const mapping = {};
    config.fields.forEach(f => {
      const match = headers.find(h => {
        const lh = h.toLowerCase();
        return lh === f.key.toLowerCase() || lh === f.label.toLowerCase() || (f.aliases && f.aliases.includes(lh));
      });
      if (match) mapping[f.key] = match;
    });

    res.json({
      headers,
      preview: rows.slice(0, 5),
      mapping,
      totalRows: rows.length,
      fields: config.fields.map(f => ({ key: f.key, label: f.label, required: f.required }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/process', authenticate, requireRole('admin', 'assessor', 'it-staff'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const type = req.body.type || 'asset';
  const mapping = JSON.parse(req.body.mapping || '{}');
  const config = ENTITY_CONFIGS[type];
  if (!config) return res.status(400).json({ error: 'Ungültiger Import-Typ' });

  try {
    const rows = await readRows(req.file);
    const results = { created: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const data = {};
        for (const field of config.fields) {
          const colName = mapping[field.key];
          let val = colName ? row[colName] : field.default;
          
          if (field.required && !val) throw new Error(`${field.label} fehlt`);
          
          if (field.map && val) val = field.map[val.toLowerCase()] || field.default || val;
          if (field.type === 'int') val = parseInt(val) || field.default || 0;
          if (field.type === 'bool') val = parseBool(val);
          if (field.type === 'array') val = (val || '').split(',').map(v => v.trim()).filter(Boolean);
          if (field.type === 'date' && val) {
            const d = new Date(val.split('.').reverse().join('-')); // DD.MM.YYYY to YYYY-MM-DD
            val = isNaN(d.getTime()) ? null : d;
          }

          data[field.key] = val;
        }

        // Special handling for foreign keys or complex entity types
        if (type === 'vendor_contact') {
          // 1. Find or create vendor
          let vendor = await Vendor.findOne({ where: { name: data.company_name } });
          if (!vendor) {
            vendor = await Vendor.create({
              name: data.company_name,
              website: data.website || '',
              address: data.address || '',
              type: 'other'
            });
          }

          // 2. Create contact
          await VendorContact.create({
            vendor_id: vendor.id,
            name: data.contact_name,
            email: data.email || '',
            phone: data.phone || '',
            role: data.role || ''
          });
        } else if (type === 'asset') {
          data.owner_id = req.user.id;
          if (data.owner_email) {
            const owner = await User.findOne({ where: { email: data.owner_email, active: true } });
            if (owner) data.owner_id = owner.id;
          }
          data.assessor_id = data.owner_id;
          if (data.assessor_email) {
            const assessor = await User.findOne({ where: { email: data.assessor_email, active: true } });
            if (assessor) data.assessor_id = assessor.id;
          }
        }

        await config.model.create(data);
        results.created++;
      } catch (e) {
        results.errors.push({ row: i + 2, error: e.message });
      }
    }

    await auditFromReq(req, 'create', type, null, `Bulk-Import (${results.created} ${config.label})`, {
      filename: req.file.originalname, created: results.created, errors: results.errors.length,
    });
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/template', authenticate, (req, res) => {
  const type = req.query.type || 'asset';
  const config = ENTITY_CONFIGS[type];
  if (!config) return res.status(400).json({ error: 'Invalid type' });

  const headers = config.fields.map(f => f.key).join(';');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="isms-${type}-vorlage.csv"`);
  res.send('﻿' + headers + '\n');
});

module.exports = router;
