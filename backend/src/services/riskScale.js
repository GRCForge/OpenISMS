// Feste 5x5-Skala bis OpenISMS 3.5.1 - heute das Standardprofil der
// Risikomethodik (services/riskMethodology.js). Bleibt als duenne Huelle fuer
// Aufrufer, die ohne Profil rechnen; neue Stellen nutzen riskMethodology direkt,
// damit die Version des Risikos zaehlt.

const { DEFAULT_PROFILE, computeLevel: computeWithProfile, scaleInfo: scaleWithProfile } = require('./riskMethodology');

const LIKELIHOOD = [null, ...DEFAULT_PROFILE.likelihood_levels.map(l => l.label_de)];
const IMPACT = [null, ...DEFAULT_PROFILE.impact_levels.map(l => l.label_de)];

// Ohne Profil: Standardprofil (Score 1-4 low, 5-9 medium, 10-14 high, 15-25 critical).
const computeLevel = (likelihood, impact, profile = DEFAULT_PROFILE) => computeWithProfile(likelihood, impact, profile);

const scaleInfo = (profile = DEFAULT_PROFILE) => scaleWithProfile(profile);

module.exports = { LIKELIHOOD, IMPACT, computeLevel, scaleInfo };
