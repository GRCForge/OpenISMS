// Zentrale, standardisierte 5x5-Risikoskala (ISO 27005). Single Source of Truth
// fuer Backend (Level-Berechnung) und Frontend (Matrix-Heatmap via /api/risks/scale).

const LIKELIHOOD = [null, 'Selten', 'Unwahrscheinlich', 'Möglich', 'Wahrscheinlich', 'Fast sicher'];
const IMPACT = [null, 'Vernachlässigbar', 'Gering', 'Spürbar', 'Kritisch', 'Existenzbedrohend'];

// Risiko = Wahrscheinlichkeit (1-5) x Auswirkung (1-5) -> Score 1..25 -> Stufe
const computeLevel = (likelihood, impact) => {
  const s = (Number(likelihood) || 0) * (Number(impact) || 0);
  if (s <= 0) return null;
  if (s <= 4) return 'low';
  if (s <= 9) return 'medium';
  if (s <= 14) return 'high';
  return 'critical';
};

// Vollstaendige Matrix (fuer die Heatmap im Frontend)
const buildMatrix = () => {
  const rows = [];
  for (let l = 5; l >= 1; l--) {
    const row = [];
    for (let i = 1; i <= 5; i++) row.push({ likelihood: l, impact: i, score: l * i, level: computeLevel(l, i) });
    rows.push(row);
  }
  return rows;
};

const scaleInfo = () => ({
  size: 5,
  likelihood: LIKELIHOOD,
  impact: IMPACT,
  thresholds: { low: '1–4', medium: '5–9', high: '10–14', critical: '15–25' },
  matrix: buildMatrix(),
});

module.exports = { LIKELIHOOD, IMPACT, computeLevel, scaleInfo };
