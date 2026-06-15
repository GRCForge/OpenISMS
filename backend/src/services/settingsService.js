const { Setting } = require('../models');
const { encrypt, decrypt } = require('./cryptoService');

const DEFAULT_PERMISSIONS = {
  assets:      { view: ['admin','assessor','it-staff','dpo','owner','management','viewer'], edit_basics: ['admin','assessor','it-staff','dpo'], edit_compliance: ['admin','assessor','dpo'], edit_security: ['admin','assessor','it-staff'], delete: ['admin'] },
  risks:       { view: ['admin','assessor','it-staff','dpo','owner','management','viewer'], create: ['admin','assessor'], edit: ['admin','assessor'], delete: ['admin'] },
  incidents:   { view: ['admin','assessor','it-staff','dpo','management','viewer'], create: ['admin','assessor','it-staff'], edit: ['admin','assessor','it-staff'], delete: ['admin'] },
  assessments: { view: ['admin','assessor','it-staff','dpo','owner','management','viewer'], create: ['admin','assessor'] },
  controls:    { view: ['admin','assessor','it-staff','dpo','management','viewer'], create: ['admin','assessor'], edit: ['admin','assessor'], delete: ['admin'] },
  policies:    { view: ['admin','assessor','it-staff','dpo','owner','management','viewer'], create: ['admin','assessor','dpo'], edit: ['admin','assessor','dpo'], delete: ['admin'] },
  reminders:   { view: ['admin','assessor','it-staff','dpo','owner','management','viewer'], create: ['admin','assessor'] },
  vendors:     { view: ['admin','assessor','it-staff','dpo','management','viewer'], create: ['admin','assessor'], edit: ['admin','assessor'], delete: ['admin'] },
  import:      { access: ['admin','assessor'] },
  reports:     { view: ['admin','assessor','dpo','owner','management'] },
  admin:       { access: ['admin'] },
};

const DEFAULTS = {
  general: {
    appName: 'OpenISMS',
    reviewIntervalMonths: 12,
    ssoAutoProvision: true,
    ssoDefaultRole: 'viewer',
    ssoAllowedDomains: '',
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

module.exports = { getGeneral, setGeneral, getOidcRaw, getOidcConfig, setOidc, getPermissions, setPermissions, DEFAULT_PERMISSIONS, getSetting, setSetting };
