'use strict';

/**
 * Das Bewertungsmodell hinter allen NIS-2-Quoten — einstellbar.
 *
 * Es gibt keinen allgemein anerkannten Rechenweg dafuer, wie aus "teilweise
 * umgesetzt" eine Prozentzahl wird. Jedes Werkzeug entscheidet das fuer sich,
 * und die wenigsten legen offen, wie. Wer sein Ergebnis gegen einen externen
 * Bericht halten will, braucht deshalb Stellschrauben statt einer fest
 * verdrahteten Formel — und die Moeglichkeit, in einem Audit zu sagen, welche
 * gerade eingestellt sind.
 *
 * Die Voreinstellung ist die hergeleitete: Umsetzung zwei Drittel, Nachweis
 * ein Drittel, "teilweise" die Haelfte, und eine nicht umgesetzte Massnahme
 * ergibt 0, egal was in der Nachweisspalte steht.
 *
 * Was sich damit erreichen laesst, und was nicht: Gegen einen konkret
 * vorliegenden Bericht sank die mittlere Abweichung ueber 16 Kategorien von
 * rund 9 auf rund 5 Prozentpunkte, als 'partly_value' von 0,5 auf 0,29 gesetzt
 * wurde — die groesste Einzelabweichung blieb bei 14 Punkten. Ein fremdes
 * Modell exakt zu treffen ist also nicht moeglich; es ist offenbar kein
 * gewichtetes Mittel. Naeher herankommen geht.
 *
 * Alle Grenzen sind Untergrenzen: Eine Quote ab 'l4' ergibt Reifegrad 4.
 */

const DEFAULT_SCORING = Object.freeze({
  // Anteil der Umsetzung am Punktwert einer Frage; der Nachweis traegt den Rest.
  implementation_weight: 2 / 3,
  // Was "teilweise" wert ist, auf beiden Achsen.
  partly_value: 0.5,
  // Nicht umgesetzt ergibt 0, auch wenn ein Nachweis eingetragen ist. Ein
  // Nachweis fuer etwas, das es nicht gibt, ist ein Widerspruch, kein halber
  // Punkt. Abschaltbar fuer den Fall, dass ein Bezugsrahmen das anders sieht.
  zero_on_not_implemented: true,
  maturity_thresholds: Object.freeze({ l5: 0.95, l4: 0.75, l3: 0.50, l2: 0.25 }),
  status_thresholds: Object.freeze({ good: 0.80, improvable: 0.50 }),
});

const clamp01 = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
};

/**
 * Fremde Eingaben auf ein brauchbares Modell bringen.
 *
 * Unbrauchbare Einzelwerte fallen auf die Voreinstellung zurueck, statt das
 * ganze Modell zu verwerfen — ein vertippter Schwellwert soll nicht alle
 * anderen Einstellungen mitnehmen.
 *
 * Die Reifegradgrenzen werden zusaetzlich absteigend erzwungen. Ohne das
 * koennte l3 ueber l4 liegen, und dann waere eine hoehere Quote plotzlich ein
 * niedrigerer Reifegrad — eine Zahl, die niemand erklaeren kann.
 */
const normaliseScoring = (value) => {
  const src = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const mt = (src.maturity_thresholds && typeof src.maturity_thresholds === 'object') ? src.maturity_thresholds : {};
  const st = (src.status_thresholds && typeof src.status_thresholds === 'object') ? src.status_thresholds : {};

  const l5 = clamp01(mt.l5, DEFAULT_SCORING.maturity_thresholds.l5);
  const l4 = Math.min(clamp01(mt.l4, DEFAULT_SCORING.maturity_thresholds.l4), l5);
  const l3 = Math.min(clamp01(mt.l3, DEFAULT_SCORING.maturity_thresholds.l3), l4);
  const l2 = Math.min(clamp01(mt.l2, DEFAULT_SCORING.maturity_thresholds.l2), l3);

  const good = clamp01(st.good, DEFAULT_SCORING.status_thresholds.good);
  const improvable = Math.min(clamp01(st.improvable, DEFAULT_SCORING.status_thresholds.improvable), good);

  return {
    implementation_weight: clamp01(src.implementation_weight, DEFAULT_SCORING.implementation_weight),
    partly_value: clamp01(src.partly_value, DEFAULT_SCORING.partly_value),
    zero_on_not_implemented: typeof src.zero_on_not_implemented === 'boolean'
      ? src.zero_on_not_implemented
      : DEFAULT_SCORING.zero_on_not_implemented,
    maturity_thresholds: { l5, l4, l3, l2 },
    status_thresholds: { good, improvable },
  };
};

/** Zahlenwert einer einzelnen Antwort. */
const answerValue = (answer, model) => {
  if (answer === 'yes') return 1;
  if (answer === 'partly') return model.partly_value;
  return 0;
};

const maturityFromRate = (rate, model = DEFAULT_SCORING) => {
  const t = model.maturity_thresholds ?? DEFAULT_SCORING.maturity_thresholds;
  if (rate >= t.l5) return 5;
  if (rate >= t.l4) return 4;
  if (rate >= t.l3) return 3;
  if (rate >= t.l2) return 2;
  return 1;
};

const statusLabel = (rate, model = DEFAULT_SCORING) => {
  const t = model.status_thresholds ?? DEFAULT_SCORING.status_thresholds;
  if (rate >= t.good) return 'good';
  if (rate >= t.improvable) return 'improvable';
  return 'critical';
};

/**
 * Wie viel von dieser Frage ist erfuellt? 0 bis 1, oder null wenn unbeantwortet.
 *
 * Eine fehlende Nachweisangabe wird nicht als "kein Nachweis" gelesen — gefragt
 * wurde noch nicht. Die Frage zaehlt dann allein ueber die Umsetzung.
 */
const scoreAnswers = (implementation, evidence, model = DEFAULT_SCORING) => {
  if (!implementation || implementation === 'not_assessed') return null;
  if (implementation === 'no' && model.zero_on_not_implemented) return 0;
  const impl = answerValue(implementation, model);
  const evidenceGiven = evidence && evidence !== 'not_assessed';
  if (!evidenceGiven) return impl;
  const w = model.implementation_weight;
  return impl * w + answerValue(evidence, model) * (1 - w);
};

module.exports = {
  DEFAULT_SCORING,
  normaliseScoring,
  answerValue,
  maturityFromRate,
  statusLabel,
  scoreAnswers,
};
