const { getSetting, setSetting } = require('./settingsService');

// Built-in analysis profiles. Each profile drives the coverage matrix for its
// document type. Admins can edit the requirements and add a free-text reference
// (baseline/example clauses) per profile via the admin GUI; stored overrides are
// merged over these defaults. `key` is the doc_type stored on a triage run.
const DEFAULT_PROFILES = {
  avv: {
    label: 'AVV / DPA (Auftragsverarbeitung)',
    requirements: [
      { ref: 'GDPR Art. 28(3)(a)', requirement: 'Processing only on documented instructions of the controller', mandatory: true },
      { ref: 'GDPR Art. 28(3)(b)', requirement: 'Confidentiality commitment of authorized persons', mandatory: true },
      { ref: 'GDPR Art. 28(3)(c)', requirement: 'Technical & organizational measures per Art. 32', mandatory: true },
      { ref: 'GDPR Art. 28(3)(d)', requirement: 'Sub-processor conditions (prior authorization, flow-down obligations)', mandatory: true },
      { ref: 'GDPR Art. 28(3)(e)', requirement: 'Assistance with data-subject rights requests', mandatory: true },
      { ref: 'GDPR Art. 28(3)(f)', requirement: 'Assistance with Art. 32-36 obligations (security, breach, DPIA)', mandatory: true },
      { ref: 'GDPR Art. 28(3)(g)', requirement: 'Deletion or return of personal data at end of provision', mandatory: true },
      { ref: 'GDPR Art. 28(3)(h)', requirement: 'Audit rights / provision of evidence & on-site inspections', mandatory: true },
      { ref: 'ISO 27001 A.5.20', requirement: 'Security requirements addressed in the supplier agreement', mandatory: false },
      { ref: 'ISO 27001 8.24', requirement: 'Use of cryptography / encryption of personal data', mandatory: false },
      { ref: 'DORA', requirement: 'ICT third-party risk: exit strategy / portability & sub-vendor disclosure', mandatory: false },
    ],
    reference: '',
  },
  tom: {
    label: 'TOM (Technische & organisatorische Maßnahmen)',
    requirements: [
      { ref: 'GDPR Art. 32(1)(a)', requirement: 'Pseudonymisation and encryption of personal data', mandatory: true },
      { ref: 'GDPR Art. 32(1)(b)', requirement: 'Ongoing confidentiality, integrity, availability and resilience of systems', mandatory: true },
      { ref: 'GDPR Art. 32(1)(c)', requirement: 'Ability to restore availability and access after an incident', mandatory: true },
      { ref: 'GDPR Art. 32(1)(d)', requirement: 'Process for regularly testing and evaluating the effectiveness of measures', mandatory: true },
      { ref: 'Access control', requirement: 'Physical and logical access control, least privilege, MFA', mandatory: true },
      { ref: 'Logging & monitoring', requirement: 'Audit logging, monitoring and incident detection', mandatory: false },
      { ref: 'Data segregation', requirement: 'Separation of data by purpose/tenant', mandatory: false },
    ],
    reference: '',
  },
  soc2: {
    label: 'SOC 2 Report',
    requirements: [
      { ref: 'Security', requirement: 'Common Criteria (CC) — security controls in scope and effective', mandatory: true },
      { ref: 'Availability', requirement: 'Availability commitments and monitoring', mandatory: false },
      { ref: 'Confidentiality', requirement: 'Confidential information protected per commitments', mandatory: false },
      { ref: 'Processing Integrity', requirement: 'Processing is complete, valid, accurate, timely, authorized', mandatory: false },
      { ref: 'Privacy', requirement: 'Personal information handled per privacy notice', mandatory: false },
      { ref: 'Report type/period', requirement: 'Type II report, recent period, no material exceptions/qualifications', mandatory: true },
    ],
    reference: '',
  },
  sla: {
    label: 'SLA (Service Level Agreement)',
    requirements: [
      { ref: 'Availability', requirement: 'Committed availability/uptime target (e.g. 99.9%) is defined', mandatory: true },
      { ref: 'Response times', requirement: 'Response and resolution times per severity/priority are defined', mandatory: true },
      { ref: 'Measurement', requirement: 'How service levels are measured and reported (metrics, calculation)', mandatory: true },
      { ref: 'Support hours', requirement: 'Support coverage window and channels are specified', mandatory: true },
      { ref: 'Maintenance', requirement: 'Planned maintenance windows and exclusions are defined', mandatory: false },
      { ref: 'Remedies', requirement: 'Service credits / penalties on breach are defined', mandatory: false },
      { ref: 'Escalation', requirement: 'Escalation path and contacts are defined', mandatory: false },
    ],
    reference: '',
  },
  ola: {
    label: 'OLA (Operational Level Agreement)',
    requirements: [
      { ref: 'Internal targets', requirement: 'Internal service targets that underpin the external SLA are defined', mandatory: true },
      { ref: 'Responsibilities', requirement: 'Responsibilities of each internal team/function are defined', mandatory: true },
      { ref: 'Interfaces', requirement: 'Hand-offs and interfaces between teams are defined', mandatory: true },
      { ref: 'Escalation', requirement: 'Internal escalation and on-call arrangements are defined', mandatory: false },
      { ref: 'Dependencies', requirement: 'Upstream/downstream dependencies are documented', mandatory: false },
    ],
    reference: '',
  },
  encryption: {
    label: 'Verschlüsselung / Encryption',
    requirements: [
      { ref: 'In transit', requirement: 'Encryption in transit with TLS 1.2+ (no weak protocols/ciphers)', mandatory: true },
      { ref: 'At rest', requirement: 'Encryption at rest with strong algorithms (e.g. AES-256)', mandatory: true },
      { ref: 'Key management', requirement: 'Key management, rotation and separation of duties are described', mandatory: true },
      { ref: 'Certificates', requirement: 'Certificate management and validity handling', mandatory: false },
      { ref: 'End-to-end', requirement: 'End-to-end encryption where applicable to the use case', mandatory: false },
    ],
    reference: '',
  },
  other: {
    label: 'Sonstiges Compliance-Dokument',
    requirements: [],
    reference: '',
  },
};

const VALID_MANDATORY = (v) => v === true;

function sanitizeProfile(key, p, fallback) {
  const base = fallback || { label: key, requirements: [], reference: '' };
  const label = typeof p?.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 120) : base.label;
  const reference = typeof p?.reference === 'string' ? p.reference.slice(0, 20000) : (base.reference || '');
  const reqSource = Array.isArray(p?.requirements) ? p.requirements : base.requirements;
  const requirements = reqSource
    .filter(r => r && typeof r.ref === 'string' && r.ref.trim() && typeof r.requirement === 'string' && r.requirement.trim())
    .slice(0, 60)
    .map(r => ({ ref: r.ref.trim().slice(0, 120), requirement: r.requirement.trim().slice(0, 500), mandatory: VALID_MANDATORY(r.mandatory) }));
  return { label, requirements, reference };
}

// Returns merged profiles: stored overrides on top of built-in defaults, keyed by
// doc_type. Extra stored keys (should not occur with the fixed set) are dropped.
async function getProfiles() {
  let stored = {};
  try {
    const raw = await getSetting('triage_profiles');
    if (raw) stored = JSON.parse(raw);
  } catch { stored = {}; }

  const out = {};
  for (const key of Object.keys(DEFAULT_PROFILES)) {
    out[key] = sanitizeProfile(key, stored[key], DEFAULT_PROFILES[key]);
  }
  return out;
}

async function saveProfiles(patch) {
  const current = await getProfiles();
  const next = {};
  for (const key of Object.keys(DEFAULT_PROFILES)) {
    next[key] = sanitizeProfile(key, patch && patch[key] ? patch[key] : current[key], DEFAULT_PROFILES[key]);
  }
  await setSetting('triage_profiles', next);
  return next;
}

module.exports = { getProfiles, saveProfiles, DEFAULT_PROFILES };
