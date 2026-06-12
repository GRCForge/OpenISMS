const { computeLevel } = require('./riskScale');

// Automatische Netto-/Restrisiko-Berechnung nach Massnahmenwirksamkeit.
// Nur UMGESETZTE (implemented) Controls reduzieren das Risiko. Jede Massnahme
// senkt die Eintrittswahrscheinlichkeit multiplikativ um effectiveness/6
// (eff 5 ~ -83%, eff 1 ~ -17%); mehrere Controls wirken kumulativ.
const computeResidual = (likelihood, impact, controlLinks = []) => {
  const implemented = controlLinks.filter(c => c.status === 'implemented' && Number(c.effectiveness) >= 1);
  let factor = 1;
  implemented.forEach(c => { factor *= (1 - Math.min(5, Number(c.effectiveness)) / 6); });
  const rl = Math.max(1, Math.round((Number(likelihood) || 1) * factor));
  const ri = Number(impact) || 1; // Controls modellieren primaer eine Senkung der Wahrscheinlichkeit
  return {
    residual_likelihood: rl,
    residual_impact: ri,
    residual_level: computeLevel(rl, ri),
  };
};

module.exports = { computeResidual };
