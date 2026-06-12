const { getGeneral } = require('./settingsService');

const validate = async (password) => {
  const settings = await getGeneral();
  const policy = settings.passwordPolicy || {};
  const minLength = policy.minLength || 8;
  const requireUppercase = policy.requireUppercase !== false;
  const requireNumber = policy.requireNumber !== false;
  const requireSpecial = policy.requireSpecial !== false;

  const errors = [];
  if (!password || password.length < minLength) errors.push(`Mindestens ${minLength} Zeichen`);
  if (requireUppercase && !/[A-Z]/.test(password)) errors.push('Mindestens ein Großbuchstabe');
  if (requireNumber && !/[0-9]/.test(password)) errors.push('Mindestens eine Ziffer');
  if (requireSpecial && !/[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(password)) errors.push('Mindestens ein Sonderzeichen (!@#$…)');

  return { valid: errors.length === 0, errors };
};

module.exports = { validate };
