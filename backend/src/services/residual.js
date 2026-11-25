const { computeLevel, DEFAULT_PROFILE } = require('./riskMethodology');

// Automatische Netto-/Restrisiko-Berechnung nach Massnahmenwirksamkeit.
// Nur UMGESETZTE (implemented) Controls reduzieren das Risiko. Jede Massnahme
// senkt die Eintrittswahrscheinlichkeit multiplikativ um effectiveness/6
// (eff 5 ~ -83%, eff 1 ~ -17%); mehrere Controls wirken kumulativ.
//
// Die Stufe kommt aus der Risikomethodik, nach der das Risiko bewertet ist
// (profile). Ohne Angabe gilt das Standardprofil - mit identischem Ergebnis wie
// bis 3.5.1. Die Formel selbst ist skalenunabhaengig: sie skaliert den Wert der
// Wahrscheinlichkeit und rundet auf eine Stufe derselben Skala (mindestens 1).
const computeResidual = (likelihood, impact, controlLinks = [], profile = DEFAULT_PROFILE) => {
  const implemented = controlLinks.filter(c => c.status === 'implemented' && Number(c.effectiveness) >= 1);
  let factor = 1;
  implemented.forEach(c => { factor *= (1 - Math.min(5, Number(c.effectiveness)) / 6); });
  const rl = Math.max(1, Math.round((Number(likelihood) || 1) * factor));
  const ri = Number(impact) || 1; // Controls modellieren primaer eine Senkung der Wahrscheinlichkeit
  return {
    residual_likelihood: rl,
    residual_impact: ri,
    residual_level: computeLevel(rl, ri, profile),
  };
};

module.exports = { computeResidual };
