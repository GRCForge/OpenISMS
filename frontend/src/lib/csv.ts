// CSV/Formula Injection (CWE-1236): Excel und LibreOffice werten eine Zelle,
// die mit = + - @ oder einem Tab/CR beginnt, als Formel aus — auch in einer
// CSV-Datei. Inhalte wie Advisory-Titel aus externen Threat-Feeds oder
// Freitext anderer Benutzer landen so als =HYPERLINK(...)/DDE-Ausdruck auf dem
// Rechner dessen, der den Export oeffnet. Solche Werte bekommen ein
// fuehrendes Apostroph; reine Zahlen (auch negative) bleiben unveraendert.
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^[+-]?\d+([.,]\d+)?$/;
export const neutralizeFormula = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return FORMULA_START.test(s) && !NUMERIC.test(s) ? `'${s}` : s;
};

/** Eine CSV-Zelle (Trennzeichen ;), formel-neutralisiert und immer in Anfuehrungszeichen. */
export const csvCell = (v: unknown): string => `"${neutralizeFormula(v).replace(/"/g, '""')}"`;
