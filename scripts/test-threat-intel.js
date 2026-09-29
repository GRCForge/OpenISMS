#!/usr/bin/env node
'use strict';

/**
 * Bedrohungslage — Feed-Parser, SSRF-Schranke, Faelligkeiten und Doubletten.
 *
 * Das Modul verarbeitet Inhalte, die jemand anders veroeffentlicht, und ruft
 * URLs ab, die ein Administrator eintraegt. Beides sind Stellen, an denen ein
 * Fehler nicht als falsche Zahl auffaellt, sondern als blockierter Prozess
 * (ReDoS), als Zugriff auf ein internes Ziel (SSRF) oder als stille Flut
 * doppelter Meldungen. Genau diese drei Faelle stehen hier.
 *
 * Ohne Datenbank: Die Modelle sind Attrappen, der Netzzugriff wird nicht
 * ausgefuehrt — geprueft wird die Schranke davor.
 *
 * Run: node scripts/test-threat-intel.js
 */

const path = require('path');
const SRC = path.join(__dirname, '..', 'backend', 'src');

const { parseFeed, extractCves, inferSeverity } = require(path.join(SRC, 'services/threatFeedParser'));
const { isBlockedAddress, assertPublicUrl } = require(path.join(SRC, 'utils/safeFetch'));
const { nextReviewDate, isOverdue, matchAssetsInIndex, ingestItems } = require(path.join(SRC, 'services/threatIntelService'));

let failures = 0;
const eq = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` → ${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`}`);
};
const ok = (label, condition) => eq(label, !!condition, true);

// ── Feed-Parser ──────────────────────────────────────────────────────────────

console.log('RSS (CERT-Bund-Form):');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>CERT-Bund</title>
  <item>
    <title><![CDATA[[CB-K26/0123] Kritisch: Apache HTTP Server - aktiv ausgenutzt]]></title>
    <link>https://wid.cert-bund.de/portal/wid/securityadvisory?name=WID-SEC-2026-0123</link>
    <description>Ein Angreifer kann CVE-2026-1234 und CVE-2026-1235 ausnutzen.</description>
    <pubDate>Mon, 29 Sep 2026 08:00:00 +0200</pubDate>
    <guid isPermaLink="false">WID-SEC-2026-0123</guid>
  </item>
  <item>
    <title>Hinweis auf eine niedrig eingestufte Meldung</title>
    <link>https://example.org/hinweis</link>
    <description>Ohne Schwachstellenbezug.</description>
    <pubDate>ungueltiges Datum</pubDate>
  </item>
</channel></rss>`;
const rssItems = parseFeed(rss, 'rss');
eq('beide Eintraege gelesen', rssItems.length, 2);
eq('CDATA im Titel wird ausgepackt', rssItems[0].title, '[CB-K26/0123] Kritisch: Apache HTTP Server - aktiv ausgenutzt');
eq('guid wird zur externen Kennung', rssItems[0].external_id, 'WID-SEC-2026-0123');
eq('CVE-Kennungen werden erkannt', rssItems[0].cve_ids, 'CVE-2026-1234, CVE-2026-1235');
eq('"aktiv ausgenutzt" wird kritisch eingestuft', rssItems[0].severity, 'critical');
eq('unlesbares Datum wird zu null statt zu einer Invalid Date', rssItems[1].published_at, null);
eq('ohne guid dient der Link als Kennung', rssItems[1].external_id, 'https://example.org/hinweis');

console.log('Atom:');
const atom = `<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Remote Code Execution in Beispielprodukt</title>
    <link rel="self" href="https://example.org/self"/>
    <link rel="alternate" href="https://example.org/meldung"/>
    <id>tag:example.org,2026:1</id>
    <updated>2026-09-28T10:00:00Z</updated>
    <summary>Betrifft CVE-2026-9999.</summary>
  </entry>
</feed>`;
const atomItems = parseFeed(atom, 'atom');
eq('Atom-Eintrag gelesen', atomItems.length, 1);
// Atom-Eintraege tragen mehrere <link>; der self-Link zeigt auf den Feed, nicht
// auf die Meldung. Wer den nimmt, verlinkt jede Meldung auf dieselbe Seite.
eq('alternate-Link gewinnt gegen self', atomItems[0].url, 'https://example.org/meldung');
eq('RCE wird hoch eingestuft', atomItems[0].severity, 'high');

// Manche Betreiber liefern unter einer als RSS bezeichneten URL Atom aus. Ein
// leeres Ergebnis waere hier nicht "keine neuen Meldungen", sondern ein
// unbemerkt abgeschaltetes Warnsystem.
eq('Atom unter rss-Format wird trotzdem gelesen', parseFeed(atom, 'rss').length, 1);

console.log('Maskiertes Markup:');
const escaped = `<rss><channel><item><title>T</title><link>https://a.example/c</link>
  <description>Text &lt;b&gt;fett&lt;/b&gt; und &lt;script&gt;alert(1)&lt;/script&gt; Ende</description>
  <guid>g1</guid></item></channel></rss>`;
// Erst entschluesseln, dann Markup entfernen. In der anderen Reihenfolge bleibt
// das maskierte <script> als sichtbarer Text im Datensatz stehen.
eq('maskiertes HTML wird entfernt, nicht angezeigt', parseFeed(escaped, 'rss')[0].summary, 'Text fett und alert(1) Ende');

console.log('CISA KEV (JSON):');
const kev = JSON.stringify({
  vulnerabilities: [{
    cveID: 'CVE-2026-5555', vendorProject: 'Acme', product: 'Gateway',
    vulnerabilityName: 'Authentication Bypass', dateAdded: '2026-09-20',
    shortDescription: 'Umgehung der Anmeldung.', requiredAction: 'Patch einspielen.',
    dueDate: '2026-10-11', knownRansomwareCampaignUse: 'Known',
  }],
});
const kevItems = parseFeed(kev, 'cisa_kev');
eq('KEV-Eintrag gelesen', kevItems.length, 1);
eq('KEV traegt die CVE als Kennung', kevItems[0].external_id, 'CVE-2026-5555');
// Was im KEV-Katalog steht, wird nachweislich ausgenutzt — das ist keine
// Heuristik aus dem Wortlaut, sondern die Aussage der Quelle selbst.
eq('KEV ist immer kritisch', kevItems[0].severity, 'critical');
ok('KEV nennt die Frist im Text', kevItems[0].summary.includes('2026-10-11'));

console.log('Robustheit des Parsers:');
eq('leerer Feed ergibt keine Eintraege', parseFeed('', 'rss'), []);
eq('abgeschnittenes XML wirft nicht', parseFeed('<rss><channel><item><title>abgeschnitten', 'rss'), []);
let threw = false;
try { parseFeed('{kein json', 'cisa_kev'); } catch { threw = true; }
ok('kaputtes JSON wirft eine erklaerbare Meldung', threw);
threw = false;
try { parseFeed('x', 'unbekannt'); } catch { threw = true; }
ok('unbekanntes Format wirft', threw);

// Ein Muster wie /<item>(.*?)+<\/item>/s liefe hier in katastrophales
// Backtracking. Der Scanner arbeitet ueber indexOf und muss in Millisekunden
// fertig sein — sonst haette eine fremde Datenquelle den Node-Prozess in der
// Hand.
const nasty = '<item><title>' + '<'.repeat(20000) + 'a'.repeat(20000) + '</title></item>'.repeat(1);
const t0 = Date.now();
parseFeed(`<rss><channel>${nasty}</channel></rss>`, 'rss');
const elapsed = Date.now() - t0;
ok(`pathologische Eingabe bleibt schnell (${elapsed} ms)`, elapsed < 2000);

console.log('CVE-Erkennung und Ersteinschaetzung:');
eq('Gross-/Kleinschreibung egal, keine Doubletten', extractCves('cve-2026-1111 CVE-2026-1111 CVE-2026-2222'), 'CVE-2026-1111, CVE-2026-2222');
eq('kein Treffer ergibt leer', extractCves('nichts hier'), '');
eq('Ransomware gilt als kritisch', inferSeverity('Ransomware-Welle', ''), 'critical');
eq('ohne Hinweis bleibt es mittel', inferSeverity('Neue Version erschienen', ''), 'medium');

// ── SSRF-Schranke ────────────────────────────────────────────────────────────

console.log('Adressen, die nicht abgerufen werden duerfen:');
for (const [ip, expected] of [
  ['8.8.8.8', false], ['1.1.1.1', false], ['2606:4700:4700::1111', false], ['172.32.0.1', false],
  ['127.0.0.1', true], ['10.1.2.3', true], ['172.16.0.1', true], ['172.31.255.255', true],
  ['192.168.1.1', true], ['0.0.0.0', true], ['100.64.0.1', true], ['224.0.0.1', true],
  ['::1', true], ['fe80::1', true], ['fd00::1', true], ['::ffff:127.0.0.1', true],
  ['999.1.1.1', true], ['', true],
]) {
  eq(`${ip || '(leer)'} ${expected ? 'blockiert' : 'erlaubt'}`, isBlockedAddress(ip), expected);
}
// 169.254.169.254 ist der Metadatendienst der grossen Cloud-Anbieter. Ein
// Abruf dorthin gibt in vielen Umgebungen Zugangsdaten heraus — das ist der
// Grund, warum diese Pruefung ueberhaupt existiert.
eq('Cloud-Metadaten (169.254.169.254) blockiert', isBlockedAddress('169.254.169.254'), true);

console.log('Schema-Pruefung vor dem Abruf:');
(async () => {
  for (const [url, reason] of [
    ['file:///etc/passwd', 'file'],
    ['gopher://example.org/', 'gopher'],
    ['nicht-einmal-eine-url', 'kein URL-Format'],
  ]) {
    let rejected = false;
    try { await assertPublicUrl(url); } catch { rejected = true; }
    ok(`${reason} wird abgelehnt`, rejected);
  }

  // ── Faelligkeiten ──────────────────────────────────────────────────────────

  console.log('Review-Termine:');
  const base = new Date('2026-09-29T00:00:00Z');
  eq('taeglich → +1 Tag', nextReviewDate('daily', base), '2026-09-30');
  eq('woechentlich → +7 Tage', nextReviewDate('weekly', base), '2026-10-06');
  eq('monatlich → +30 Tage', nextReviewDate('monthly', base), '2026-10-29');
  eq('quartalsweise → +91 Tage', nextReviewDate('quarterly', base), '2026-12-29');
  eq('unbekannte Frequenz faellt auf woechentlich zurueck', nextReviewDate('gelegentlich', base), '2026-10-06');

  console.log('Ueberfaelligkeit:');
  // Eine nie durchgesehene Quelle ist ueberfaellig, nicht "noch nicht faellig".
  // Das ist genau die Luecke, die ein Self-Check findet: Quellen sind
  // eingetragen, hineingesehen hat nie jemand.
  eq('nie durchgesehen → ueberfaellig', isOverdue({ active: true, last_reviewed_at: null }), true);
  eq('inaktive Quelle nie ueberfaellig', isOverdue({ active: false, last_reviewed_at: null }), false);
  eq('Termin in der Zukunft → nicht ueberfaellig', isOverdue({ active: true, last_reviewed_at: '2026-09-28', next_review_at: '2026-10-05' }, '2026-09-29'), false);
  eq('Termin in der Vergangenheit → ueberfaellig', isOverdue({ active: true, last_reviewed_at: '2026-08-01', next_review_at: '2026-08-08' }, '2026-09-29'), true);
  eq('Termin heute → noch nicht ueberfaellig', isOverdue({ active: true, last_reviewed_at: '2026-09-22', next_review_at: '2026-09-29' }, '2026-09-29'), false);

  // ── Aufnahme ins Register ──────────────────────────────────────────────────

  console.log('Doubletten und Altlasten beim Abruf:');
  const stored = [];
  const links = [];
  const models = {
    ThreatAdvisory: {
      findOne: async ({ where }) => stored.find(a => a.source_id === where.source_id && a.external_id === where.external_id) || null,
      create: async (data) => { const row = { id: stored.length + 1, ...data }; stored.push(row); return row; },
    },
    ThreatAdvisoryAsset: {
      findOrCreate: async ({ where, defaults }) => {
        const found = links.find(l => l.advisory_id === where.advisory_id && l.asset_id === where.asset_id);
        if (found) return [found, false];
        links.push({ ...defaults });
        return [defaults, true];
      },
    },
    Asset: {
      findAll: async () => ([{ id: 7, cve_ids: [{ id: 'CVE-2026-1234', severity: 'high' }] }]),
    },
  };
  const source = { id: 1 };
  const items = [
    { external_id: 'A-1', title: 'Meldung A', summary: '', url: '', published_at: new Date(), severity: 'high', cve_ids: 'CVE-2026-1234' },
    { external_id: 'A-2', title: 'Meldung B', summary: '', url: '', published_at: new Date(), severity: 'low', cve_ids: '' },
    // Ein Feed traegt beim ersten Abruf oft ein Jahr Historie. Die gehoert nicht
    // als "neue Warnmeldung" ins Register — sonst stehen hunderte offene
    // Bewertungen da, die niemand mehr nachholen kann.
    { external_id: 'A-alt', title: 'Uralte Meldung', summary: '', url: '', published_at: new Date(Date.now() - 400 * 86400000), severity: 'medium', cve_ids: '' },
  ];

  const first = await ingestItems(models, source, items);
  eq('zwei neue Meldungen aufgenommen', first.created, 2);
  eq('zu alte Meldung uebersprungen', first.skipped, 1);
  // Der Treffer kommt aus den CVE-Kennungen, die der naechtliche Lauf ohnehin
  // an den Assets fuehrt — Namensabgleich waere Rauschen.
  eq('Asset ueber die CVE-Kennung zugeordnet', first.matched, 1);
  eq('Zuordnung wartet auf Bestaetigung', links[0].confirmed, false);
  eq('Zuordnung ist als automatisch gekennzeichnet', links[0].match_source, 'cve_match');

  // Ein erneuter Abruf darf keine zweite Meldung erzeugen und vor allem keine
  // bereits getroffene Bewertung ueberschreiben.
  const second = await ingestItems(models, source, items);
  eq('zweiter Abruf legt nichts neu an', second.created, 0);
  eq('alles als Doublette erkannt', second.skipped, 3);
  eq('Register unveraendert', stored.length, 2);

  console.log('Asset-Abgleich:');
  const index = new Map([['CVE-2026-1234', new Set([1, 2])], ['CVE-2026-9999', new Set([2])]]);
  eq('ein Asset erscheint nur einmal, auch bei zwei Treffern',
    matchAssetsInIndex(index, 'CVE-2026-1234, CVE-2026-9999').map(h => h.asset_id), [1, 2]);
  eq('unbekannte CVE trifft nichts', matchAssetsInIndex(index, 'CVE-2000-0001'), []);
  eq('ohne CVE-Angabe kein Treffer', matchAssetsInIndex(index, ''), []);

  console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
  process.exit(failures ? 1 : 0);
})();
