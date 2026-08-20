const { Setting } = require('../models');
const { encrypt, decrypt } = require('./cryptoService');

// Baseline for the role matrix. Until now nothing read it — the routes carried
// hardcoded role checks — so the two had drifted apart and enabling enforcement
// against the old values would have taken access away from roles that have it
// today (owner/it-staff/dpo on risks, it-staff on import, and more). These lists
// were reconciled against the guards the routes actually apply, so switching
// enforcement on changes no access; tightening is now a deliberate admin edit.
const DEFAULT_PERMISSIONS = {
  // assets.js authorises on three levels and only the first is an endpoint
  // decision: the route guard (below), then a per-record check (owner/assessor of
  // that asset may edit it), then a per-field one (classification, nis2_relevant,
  // rto, rpo need assessor/dpo/admin). Only the route level moves into the matrix;
  // the other two stay in the handler, where they belong. edit_compliance names the
  // protected-field rule so it is at least visible and adjustable.
  assets:      { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','assessor','it-staff','dpo'], edit_basics: ['admin','owner','assessor','it-staff','dpo'], edit_compliance: ['admin','assessor','dpo'], edit_security: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin'], cve: ['admin','assessor','it-staff'] },
  risks:       { view: ['admin','assessor','it-staff','dpo','owner','management','viewer','employee'], create: ['admin','assessor','it-staff','dpo','owner'], edit: ['admin','assessor','it-staff','dpo','owner'], delete: ['admin'], sign_off: ['admin','assessor','owner'] },
  incidents:   { view: ['admin','assessor','it-staff','dpo','owner','management','viewer','employee'], create: ['admin','assessor','it-staff','dpo','owner'], edit: ['admin','assessor','it-staff','dpo','owner'], delete: ['admin','assessor'] },
  assessments: { view: ['admin','assessor','it-staff','dpo','owner','management','viewer','employee'], create: ['admin','assessor'] },
  controls:    { view: ['admin','assessor','it-staff','dpo','owner','management','viewer','employee'], create: ['admin'], edit: ['admin','assessor','it-staff'], delete: ['admin'] },
  policies:    { view: ['admin','assessor','it-staff','dpo','owner','management','viewer','employee'], create: ['admin','assessor','dpo'], edit: ['admin','assessor','dpo'], delete: ['admin'], acknowledgments: ['admin','assessor','dpo'] },
  // reminders had no 'create' route at all; what exists is acknowledging and
  // dismissing, both behind requireWriteAccess. Renamed to match reality, and view
  // reconciled to the eight roles the route actually admits.
  reminders:   { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], acknowledge: ['admin','owner','assessor','it-staff','dpo'] },
  tasks:       { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','owner','assessor','it-staff','dpo'], maintenance: ['admin'] },
  groups:      { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], manage: ['admin'] },
  threats:     { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin'] },
  review:      { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], sign_off: ['admin','assessor'] },
  modules:     { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], edit: ['admin'] },
  auditlog:    { view: ['admin','assessor'], verify: ['admin'] },
  comments:    { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','owner','assessor','it-staff','dpo'] },
  // vendors.js guarded inline with isItStaff()||isDpo(), which resolves to
  // admin/assessor/it-staff/dpo — wider than the create/edit lists shipped here.
  // Reconciled to what the handlers actually enforced. The two remaining inline
  // checks shape which fields come back, not who may call the route, so they stay.
  vendors:     { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], view_details: ['admin','assessor','it-staff','dpo'], create: ['admin','assessor','it-staff','dpo'], edit: ['admin','assessor','it-staff','dpo'], delete: ['admin'], contacts: ['admin','assessor','it-staff','dpo'], assess: ['admin','assessor','it-staff','dpo'] },
  // Compliance content areas. compliance.js serves three unrelated things behind one
  // path — KPIs, audits with their findings, and trainings — with different guards
  // each, so they get separate entries rather than one that flattens the difference.
  // Where a route combined requireRole with requireWriteAccess the list below is the
  // intersection, which is what actually applied.
  compliance:            { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'] },
  compliance_kpis:       { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','assessor'], measure: ['admin','owner','assessor','it-staff','dpo'] },
  compliance_audits:     { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','assessor'], edit: ['admin','assessor'], delete: ['admin'], create_findings: ['admin','assessor'], edit_findings: ['admin','owner','assessor','it-staff','dpo'], delete_findings: ['admin','assessor'] },
  compliance_trainings:  { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','assessor','dpo'], edit: ['admin','assessor','dpo'], delete: ['admin','assessor'], contest: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'] },

  // Compliance modules. requireModule() only says whether a module exists in this
  // installation — it never looks at the user — so until now "this role may read
  // the VVT but not edit it" could not be expressed. These entries mirror the
  // guards each route already applies, so enforcement changes no access. DSGVO is
  // one toggle but three areas, and each gets its own entry.
  vvt:              { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], view_details: ['admin','assessor','dpo'], create: ['admin','assessor','dpo'], edit: ['admin','assessor','dpo'], delete: ['admin'] },
  dataflows:        { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], view_details: ['admin','assessor','dpo'], create: ['admin','assessor'], edit: ['admin','assessor'], delete: ['admin'] },
  subject_requests: { view: ['admin','assessor','dpo'], create: ['admin','dpo'], edit: ['admin','dpo'], delete: ['admin'] },
  iso27001:         { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], seed: ['admin','assessor'], edit: ['admin','assessor','it-staff'], delete: ['admin','assessor'] },
  bsi_grundschutz:  { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], seed: ['admin','assessor'], edit: ['admin','assessor','it-staff'], delete: ['admin','assessor'] },
  c5:               { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], seed: ['admin','assessor'], edit: ['admin','assessor','it-staff'], delete: ['admin','assessor'] },
  nis2:             { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], seed: ['admin','assessor'], edit: ['admin','assessor','dpo'], delete: ['admin','assessor'] },
  tisax:            { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], seed: ['admin','assessor'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','assessor'] },
  dora:             { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','assessor'] },
  ai_act:           { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','assessor'] },
  bcm:              { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','assessor'], edit: ['admin','assessor'], delete: ['admin','assessor'] },
  pentests:         { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','assessor'], delete_findings: ['admin','assessor','it-staff'] },
  discovery:        { access: ['admin','it-staff'] },
  // Vendor contract triage. vendorTriage.js gated inline with
  // isItStaff()||isDpo()||isAdmin(), which resolves to the four roles below;
  // deleting a run was admin-only. Running an analysis costs LLM budget and
  // writes findings, so it is a separate action from reading the results.
  vendor_triage:    { view: ['admin','assessor','it-staff','dpo'], run: ['admin','assessor','it-staff','dpo'], delete: ['admin'] },
  // The triage profiles decide what every future analysis looks for, so editing
  // them is admin-only while the same four roles that see findings may read them.
  triage_profiles:  { view: ['admin','assessor','it-staff','dpo'], edit: ['admin'] },
  // Drittsystem-Anbindungen (CheckMK & Folgende). Getrennt von 'discovery',
  // weil das Konfigurieren einer Verbindung inkl. Zugangsdaten eine andere
  // Entscheidung ist als das Sichten ihrer Ergebnisse: 'sync' darf ausloesen,
  // 'configure' darf Endpunkt und Secret aendern.
  integrations:     { view: ['admin','assessor','it-staff'], sync: ['admin','it-staff'], configure: ['admin'] },
  import:      { access: ['admin','assessor','it-staff'] },
  reports:     { view: ['admin','assessor','it-staff','dpo','owner','management','viewer','employee'] },
  dashboard:   { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'] },
  // Uploaded files. documents.js guarded reads with authenticate alone and writes
  // with requireWriteAccess(), which excludes viewer/management/employee — that is
  // the split below. download is its own action because handing out the file is a
  // different decision from seeing that it exists.
  documents:   { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], upload: ['admin','owner','assessor','it-staff','dpo'], download: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], delete: ['admin','owner','assessor','it-staff','dpo'] },
  templates:   { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], upload: ['admin','owner','assessor','it-staff','dpo'], download: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], delete: ['admin','owner','assessor','it-staff','dpo'] },
  mappings:    { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'] },
  legal_requirements: { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','it-staff','dpo'], edit: ['admin','owner','assessor','it-staff','dpo'], delete: ['admin','assessor'] },
  // User administration was requireRole('admin') for every write; listing users was
  // open to any authenticated caller (the picker for owner/assessor fields needs it).
  users:       { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin'], edit: ['admin'], delete: ['admin'] },
  // API tokens authenticate as their owner, so a token is exactly as powerful as
  // the account that made it. Every role could mint one; exposing the action lets
  // an admin close that off without touching the rest of the account's access.
  tokens:      { view: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], create: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'], delete: ['admin','owner','assessor','viewer','it-staff','dpo','employee','management'] },
  // Backup is split by blast radius: info reads counts, export carries every row
  // in the installation out of the door, restore replaces what is in the database.
  backup:      { info: ['admin'], export: ['admin'], restore: ['admin'] },
  // admin.js sat behind one requireRole('admin') for all 25 endpoints, so 'access'
  // was the only thing the matrix could say about it — and nothing read it. The
  // areas below are the ones that differ in kind: reading the server log is not the
  // same decision as rewriting the permission matrix or the SSO configuration.
  // All default to admin, so nothing changes until an admin delegates one.
  admin:       { settings: ['admin'], permissions: ['admin'], roles: ['admin'], sso: ['admin'], smtp: ['admin'], llm: ['admin'], logs: ['admin'], maintenance: ['admin'] },
};

const DEFAULTS = {
  general: {
    appName: 'OpenISMS',
    reviewIntervalMonths: 12,
    ssoAutoProvision: true,
    ssoDefaultRole: 'viewer',
    ssoAllowedDomains: '',
    // Off by default: switching it on downgrades every SSO user who matches no
    // claim mapping, including ones an admin assigned manually. Opting in makes
    // the IdP authoritative for roles, so removing a group there revokes access.
    ssoStrictRoleSync: false,
    auditLogRetentionMonths: 15,
    passwordPolicy: {
      minLength: 10,
      requireUppercase: true,
      requireNumber: true,
      requireSpecial: true,
    },
    bruteForcePolicy: {
      maxAttempts: 5,
      lockoutMinutes: 15,
    },
  },
  oidc: {
    enabled: false,
    displayName: 'Single Sign-On',
    issuer: '',
    clientId: '',
    clientSecretEnc: null,
    scopes: 'openid profile email',
  },
  // CheckMK-Anbindung. Das Secret liegt wie das OIDC-Client-Secret nur
  // verschluesselt (secretEnc) und verlaesst das Backend nie im Klartext.
  checkmk: {
    enabled: false,
    url: '',            // z. B. https://checkmk.intern
    site: '',           // CheckMK-Site, z. B. 'cmk'
    username: '',       // Automationsbenutzer
    secretEnc: null,
    // Aus: eine unverifizierte TLS-Verbindung ins Monitoring muss eine
    // bewusste, sichtbare Entscheidung sein — kein stiller Fallback.
    allowSelfSigned: false,
    lastSyncAt: null,
    lastSyncSummary: null,
  },
};

const getRaw = async (key) => {
  const row = await Setting.findByPk(key);
  if (!row || !row.value) return {};
  // Sequelize handled JSON usually returns an object.
  // If it's a string (due to DB configuration), parse it.
  if (typeof row.value === 'string') {
    try {
      const parsed = JSON.parse(row.value);
      // Fallback: If it's still a string after one parse, try again (double serialization protection)
      if (typeof parsed === 'string') return JSON.parse(parsed);
      return parsed;
    } catch {
      return {};
    }
  }
  return row.value;
};

const saveSetting = async (key, value) => {
  // Ensure value is a clean object
  const cleanValue = JSON.parse(JSON.stringify(value));
  const [setting, created] = await Setting.findOrCreate({
    where: { key },
    defaults: { value: cleanValue }
  });
  
  if (!created) {
    setting.value = cleanValue;
    setting.changed('value', true);
    await setting.save();
  }
};

const getGeneral = async () => ({ ...DEFAULTS.general, ...(await getRaw('general')) });

const setGeneral = async (patch = {}) => {
  const merged = { ...DEFAULTS.general, ...(await getRaw('general')), ...patch };
  await saveSetting('general', merged);
  return merged;
};

const getOidcRaw = async () => ({ ...DEFAULTS.oidc, ...(await getRaw('oidc')) });

// Vollstaendige Config inkl. entschluesseltem Secret – nur backend-intern (Login-Flow).
const getOidcConfig = async () => {
  const o = await getOidcRaw();
  return { ...o, clientSecret: o.clientSecretEnc ? decrypt(o.clientSecretEnc) : null };
};

const setOidc = async (patch = {}) => {
  const current = await getOidcRaw();
  const next = { ...current, ...patch };
  // Secret nur ersetzen, wenn ein neues (nicht-leeres) uebergeben wurde.
  if (patch.clientSecret) next.clientSecretEnc = encrypt(patch.clientSecret);
  delete next.clientSecret;
  await saveSetting('oidc', next);
  return next;
};

// ─── CheckMK-Anbindung ───────────────────────────────────────────────────────

// Rohform inkl. secretEnc — nur backend-intern verwenden, nie an einen Client geben.
const getCheckmkRaw = async () => ({ ...DEFAULTS.checkmk, ...(await getRaw('checkmk')) });

// Vollstaendige Config inkl. entschluesseltem Secret — ausschliesslich fuer den
// Connector selbst. Analog zu getOidcConfig().
const getCheckmkConfig = async () => {
  const c = await getCheckmkRaw();
  return { ...c, secret: c.secretEnc ? decrypt(c.secretEnc) : null };
};

// Fuer die Anzeige: alles ausser dem Secret, plus ein Flag, ob eines hinterlegt ist.
const getCheckmkPublic = async () => {
  const { secretEnc, ...rest } = await getCheckmkRaw();
  return { ...rest, secretConfigured: Boolean(secretEnc) };
};

const setCheckmk = async (patch = {}) => {
  const current = await getCheckmkRaw();
  const next = { ...current, ...patch };
  // Secret nur ersetzen, wenn ein neues (nicht-leeres) uebergeben wurde —
  // sonst wuerde ein Speichern des Formulars ohne Secret-Eingabe es loeschen.
  if (patch.secret) next.secretEnc = encrypt(patch.secret);
  delete next.secret;
  await saveSetting('checkmk', next);
  const { secretEnc, ...rest } = next;
  return { ...rest, secretConfigured: Boolean(secretEnc) };
};

const getPermissions = async () => {
  const stored = await getRaw('permissions');
  const result = JSON.parse(JSON.stringify(DEFAULT_PERMISSIONS));
  for (const [module, actions] of Object.entries(stored)) {
    if (!result[module]) result[module] = {};
    Object.assign(result[module], actions);
  }
  return result;
};

const setPermissions = async (patch = {}) => {
  const current = await getRaw('permissions');
  await saveSetting('permissions', { ...current, ...patch });
  return getPermissions();
};

// Generic key-based accessors (for SMTP and other plain-value settings)
const getSetting = async (key) => {
  const row = await Setting.findByPk(key);
  if (!row || !row.value) return null;
  // If it's a string, return it; if it's an object, stringify it for consumer consistency
  // (though consumers should ideally handle objects)
  return typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
};

const setSetting = async (key, value) => {
  // Value should be stored as an object in the JSON column
  const valToStore = typeof value === 'string' ? JSON.parse(value) : value;
  const [setting, created] = await Setting.findOrCreate({
    where: { key },
    defaults: { value: valToStore }
  });
  if (!created) {
    setting.value = valToStore;
    setting.changed('value', true);
    await setting.save();
  }
};

module.exports = { getGeneral, setGeneral, getOidcRaw, getOidcConfig, setOidc, getPermissions, setPermissions, DEFAULT_PERMISSIONS, getSetting, setSetting, getCheckmkRaw, getCheckmkConfig, getCheckmkPublic, setCheckmk };
