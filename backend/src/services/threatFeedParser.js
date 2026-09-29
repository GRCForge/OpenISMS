'use strict';

/**
 * Minimaler Parser fuer RSS-, Atom- und CISA-KEV-Feeds.
 *
 * Bewusst ohne XML-Bibliothek: Der Parser verarbeitet Inhalte, die aus dem
 * Internet kommen, und jede zusaetzliche Abhaengigkeit an dieser Stelle ist
 * Angriffsflaeche, die gepflegt werden muss (XXE, Entity Expansion, Prototype
 * Pollution in der Attributbehandlung). Gebraucht wird ohnehin nur ein
 * Bruchteil von XML: eine Handvoll bekannter Elemente je Eintrag.
 *
 * Das Scannen laeuft ueber indexOf, nicht ueber Regex mit verschachtelten
 * Quantoren. Ein Feed ist Fremdinhalt beliebiger Form; ein Muster wie
 * /<item>(.*?)+<\/item>/s wuerde bei passendem Input in katastrophales
 * Backtracking laufen und den Node-Prozess blockieren — das waere ein
 * Denial-of-Service ueber eine Datenquelle, die jemand anders betreibt.
 *
 * Gegen dieselbe Klasse von Problemen begrenzen MAX_INPUT_BYTES,
 * MAX_ITEMS und die Feldlaengen, was ein Feed ueberhaupt anrichten kann.
 */

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 200;
const MAX_TITLE = 500;
const MAX_SUMMARY = 4000;
const MAX_URL = 1000;
const MAX_ID = 255;

// ── Textwerkzeuge ────────────────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (s) => String(s)
  .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d{1,7});/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
  .replace(/&([a-zA-Z]{2,6});/g, (m, name) => (Object.prototype.hasOwnProperty.call(ENTITIES, name) ? ENTITIES[name] : m));

const safeCodePoint = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
};

// Markup aus einem Textfeld entfernen. Feeds liefern Beschreibungen regelmaessig
// als HTML-Fragment; gespeichert wird reiner Text, damit die Oberflaeche ihn
// nicht als Markup interpretieren muss.
const stripTags = (s) => {
  let out = '';
  let depth = 0;
  for (const ch of String(s)) {
    if (ch === '<') depth++;
    else if (ch === '>') { if (depth > 0) depth--; }
    else if (depth === 0) out += ch;
  }
  return out;
};

// Erst entschluesseln, dann Markup entfernen — nicht umgekehrt. Feeds liefern
// ihre Beschreibungen haeufig als maskiertes HTML (&lt;b&gt;); wer zuerst Tags
// entfernt, findet dort keine und laesst das Markup als sichtbaren Text stehen.
// In dieser Reihenfolge faellt auch ein maskiertes <script> weg, statt als
// Zeichenkette im Datensatz zu landen.
const clean = (s, max) => stripTags(decodeEntities(String(s ?? '')))
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const unwrapCdata = (s) => {
  const t = String(s).trim();
  if (t.startsWith('<![CDATA[') && t.endsWith(']]>')) return t.slice(9, -3);
  return t;
};

// ── XML-Scanner ──────────────────────────────────────────────────────────────

// Inhalt des ersten <tag>…</tag> innerhalb von [from, to). Attribute am
// oeffnenden Tag werden toleriert, Namespaces (<dc:date>) nicht aufgeloest —
// gesucht wird immer der konkrete Name, den der jeweilige Feed verwendet.
function tagContent(xml, tag, from, to) {
  const open = `<${tag}`;
  let i = xml.indexOf(open, from);
  while (i >= 0 && i < to) {
    const after = xml[i + open.length];
    // <title> und <title type="html"> treffen, <titleFoo> nicht.
    if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r' || after === '/') {
      const gt = xml.indexOf('>', i);
      if (gt < 0 || gt >= to) return null;
      if (xml[gt - 1] === '/') return '';                 // <link/> — leer
      const close = xml.indexOf(`</${tag}`, gt);
      if (close < 0 || close > to) return null;
      return unwrapCdata(xml.slice(gt + 1, close));
    }
    i = xml.indexOf(open, i + 1);
  }
  return null;
}

// href eines Atom-<link>. Atom-Eintraege tragen mehrere Links; gewollt ist der
// alternate-Link auf die Meldung, nicht self oder enclosure.
function atomLink(xml, from, to) {
  let i = xml.indexOf('<link', from);
  let fallback = '';
  while (i >= 0 && i < to) {
    const gt = xml.indexOf('>', i);
    if (gt < 0 || gt > to) break;
    const tagText = xml.slice(i, gt);
    const href = attr(tagText, 'href');
    if (href) {
      const rel = attr(tagText, 'rel');
      if (!rel || rel === 'alternate') return href;
      if (!fallback) fallback = href;
    }
    i = xml.indexOf('<link', gt);
  }
  return fallback;
}

function attr(tagText, name) {
  const key = `${name}=`;
  const at = tagText.indexOf(key);
  if (at < 0) return '';
  const q = tagText[at + key.length];
  if (q !== '"' && q !== "'") return '';
  const end = tagText.indexOf(q, at + key.length + 1);
  if (end < 0) return '';
  return decodeEntities(tagText.slice(at + key.length + 1, end));
}

// Alle <tag>…</tag>-Bereiche als [start, end)-Paare.
function* blocks(xml, tag) {
  const open = `<${tag}`;
  const close = `</${tag}`;
  let i = xml.indexOf(open);
  let n = 0;
  while (i >= 0 && n < MAX_ITEMS) {
    const after = xml[i + open.length];
    if (after === '>' || after === ' ' || after === '\t' || after === '\n' || after === '\r') {
      const end = xml.indexOf(close, i);
      if (end < 0) return;
      yield [i, end];
      n++;
      i = xml.indexOf(open, end);
    } else {
      i = xml.indexOf(open, i + 1);
    }
  }
}

// ── Ableitungen aus dem Meldungstext ─────────────────────────────────────────

// CVE-Kennungen sind das verlaessliche Bindeglied zwischen einer Meldung und dem
// eigenen Inventar: Assets tragen bereits cve_ids aus dem naechtlichen Abgleich.
const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;

function extractCves(text) {
  const found = String(text).match(CVE_RE);
  if (!found) return '';
  const unique = [...new Set(found.map((c) => c.toUpperCase()))];
  return unique.slice(0, 40).join(', ');
}

// Grobe Ersteinschaetzung aus dem Wortlaut. Sie ersetzt keine Bewertung — sie
// sorgt nur dafuer, dass eine Meldung mit "aktiv ausgenutzt" im Titel nicht als
// 'medium' unter hundert anderen untergeht. Die Bewertung durch einen Menschen
// bleibt Pflicht; relevance startet immer auf 'not_assessed'.
const CRITICAL_HINTS = ['aktiv ausgenutzt', 'actively exploited', 'exploited in the wild', 'zero-day', 'zeroday', '0-day', 'notfall', 'emergency', 'kritische schwachstelle', 'kritisch', 'critical', 'ransomware'];
const HIGH_HINTS = ['hohe bedrohung', 'high severity', 'remote code execution', 'rce', 'privilege escalation', 'authentication bypass', 'hoch', 'severe'];
const LOW_HINTS = ['niedrig', 'low severity', 'informational', 'hinweis'];

function inferSeverity(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  if (CRITICAL_HINTS.some((h) => text.includes(h))) return 'critical';
  if (HIGH_HINTS.some((h) => text.includes(h))) return 'high';
  if (LOW_HINTS.some((h) => text.includes(h))) return 'low';
  return 'medium';
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value).trim());
  if (Number.isNaN(d.getTime())) return null;
  // Ein Feed mit falscher Zeitzone oder kaputtem Datum soll die Sortierung nicht
  // sprengen. Alles weiter als einen Tag in der Zukunft gilt als unbrauchbar.
  if (d.getTime() > Date.now() + 86_400_000) return null;
  return d;
}

// ── Formate ──────────────────────────────────────────────────────────────────

function parseRss(xml) {
  const items = [];
  for (const [from, to] of blocks(xml, 'item')) {
    const title = clean(tagContent(xml, 'title', from, to), MAX_TITLE);
    if (!title) continue;
    const summary = clean(tagContent(xml, 'description', from, to) ?? tagContent(xml, 'content:encoded', from, to), MAX_SUMMARY);
    const link = clean(tagContent(xml, 'link', from, to), MAX_URL);
    const guid = clean(tagContent(xml, 'guid', from, to), MAX_ID);
    const published = parseDate(tagContent(xml, 'pubDate', from, to) ?? tagContent(xml, 'dc:date', from, to));
    items.push(buildItem({ title, summary, link, guid, published }));
  }
  return items;
}

function parseAtom(xml) {
  const items = [];
  for (const [from, to] of blocks(xml, 'entry')) {
    const title = clean(tagContent(xml, 'title', from, to), MAX_TITLE);
    if (!title) continue;
    const summary = clean(tagContent(xml, 'summary', from, to) ?? tagContent(xml, 'content', from, to), MAX_SUMMARY);
    const link = clean(atomLink(xml, from, to), MAX_URL);
    const guid = clean(tagContent(xml, 'id', from, to), MAX_ID);
    const published = parseDate(tagContent(xml, 'updated', from, to) ?? tagContent(xml, 'published', from, to));
    items.push(buildItem({ title, summary, link, guid, published }));
  }
  return items;
}

// CISA KEV liefert JSON und damit die einzige Quelle im Katalog, die ihre
// Dringlichkeit selbst mitbringt: Was im Katalog steht, wird nachweislich
// ausgenutzt. Deshalb 'critical' ohne Textheuristik.
function parseCisaKev(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('KEV-Katalog ist kein gueltiges JSON'); }
  const list = Array.isArray(data?.vulnerabilities) ? data.vulnerabilities : [];
  // Der Katalog enthaelt ueber tausend Eintraege und waechst nur am Ende; die
  // juengsten sind die, die eine Lagebewertung braucht.
  const recent = list.slice(-MAX_ITEMS);
  return recent.map((v) => {
    const cve = clean(v?.cveID, MAX_ID);
    const product = clean(`${v?.vendorProject ?? ''} ${v?.product ?? ''}`, 200);
    const name = clean(v?.vulnerabilityName, MAX_TITLE);
    const ransomware = String(v?.knownRansomwareCampaignUse ?? '').toLowerCase() === 'known';
    return {
      external_id: cve || null,
      title: clean(`${cve}${product ? ` — ${product}` : ''}${name ? `: ${name}` : ''}`, MAX_TITLE),
      summary: clean([v?.shortDescription, v?.requiredAction ? `Erforderliche Massnahme: ${v.requiredAction}` : '', v?.dueDate ? `Frist (CISA): ${v.dueDate}` : '', ransomware ? 'In Ransomware-Kampagnen eingesetzt.' : ''].filter(Boolean).join(' '), MAX_SUMMARY),
      url: cve ? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve)}` : '',
      published_at: parseDate(v?.dateAdded),
      severity: 'critical',
      cve_ids: cve || '',
    };
  }).filter((i) => i.title);
}

function buildItem({ title, summary, link, guid, published }) {
  return {
    // Ohne guid ist der Link die stabilste Kennung; ohne beides der Titel. Diese
    // Kennung entscheidet spaeter, ob eine Meldung schon im Register steht.
    external_id: (guid || link || title).slice(0, MAX_ID) || null,
    title,
    summary,
    url: /^https?:\/\//i.test(link) ? link : '',
    published_at: published,
    severity: inferSeverity(title, summary),
    cve_ids: extractCves(`${title} ${summary} ${guid}`),
  };
}

/**
 * @param {string} text   Rohinhalt des Feeds
 * @param {string} format 'rss' | 'atom' | 'cisa_kev'
 * @returns {Array<{external_id,title,summary,url,published_at,severity,cve_ids}>}
 */
function parseFeed(text, format) {
  const body = String(text ?? '');
  if (Buffer.byteLength(body, 'utf8') > MAX_INPUT_BYTES) {
    throw new Error('Feed ist groesser als das erlaubte Limit');
  }
  if (format === 'cisa_kev') return parseCisaKev(body);
  if (format === 'atom') return parseAtom(body);
  if (format === 'rss') {
    const items = parseRss(body);
    // Manche Betreiber liefern unter einer .rss-URL Atom aus. Eine leere Liste
    // waere hier ein stiller Fehlschlag, der als "keine neuen Meldungen" gelesen
    // wird — das Gegenteil dessen, was ein Warnsystem tun soll.
    return items.length ? items : parseAtom(body);
  }
  throw new Error(`Unbekanntes Feed-Format: ${format}`);
}

module.exports = { parseFeed, inferSeverity, extractCves, MAX_ITEMS };
