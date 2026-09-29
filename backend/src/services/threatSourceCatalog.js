'use strict';

/**
 * Startkatalog fuer das Quellenregister der Bedrohungslage.
 *
 * NIS-2 Art. 21(2)(a) und ISO 27001:2022 A.5.7 verlangen, dass die
 * Bedrohungslage systematisch verfolgt wird. Der erste Schritt dorthin ist die
 * Frage, die jeder Self-Check stellt: Sind die Warnmeldungen der nationalen
 * Cybersicherheitsbehoerde bzw. des nationalen CSIRT ueberhaupt abonniert?
 * Deshalb steht CERT-Bund hier an erster Stelle und ist als 'national_csirt'
 * markiert — die Statistik prueft genau diesen Typ.
 *
 * Die Feed-URLs sind Vorschlaege, keine Zusicherung: Betreiber aendern ihre
 * Feeds. Deshalb ist auto_fetch ueberall aus und jeder Abruf schreibt sein
 * Ergebnis nach last_fetch_status, wo ein Fehler sichtbar wird, statt still zu
 * bleiben. Eine Installation ausserhalb Deutschlands deaktiviert CERT-Bund und
 * traegt ihr eigenes nationales CSIRT ein — die Liste ist ein Startpunkt, kein
 * Regelwerk.
 */

const catalog = [
  {
    name: 'BSI CERT-Bund — Warn- und Informationsdienst (WID)',
    type: 'national_csirt',
    country: 'DE',
    url: 'https://wid.cert-bund.de/portal/wid/securityadvisory',
    feed_url: 'https://wid.cert-bund.de/content/public/securityAdvisory/rss',
    feed_format: 'rss',
    review_frequency: 'daily',
    notes: 'Nationales CSIRT (Deutschland). Technische Sicherheitswarnungen zu Produkten und Schwachstellen. Pflichtquelle fuer NIS-2 Art. 21(2)(a).',
  },
  {
    name: 'BSI — Buerger-CERT / Sicherheitshinweise',
    type: 'authority',
    country: 'DE',
    url: 'https://www.bsi.bund.de/DE/Service-Navi/Abonnements/Newsletter/Buerger-CERT-Abo/buerger-cert-abo.html',
    feed_url: 'https://www.bsi.bund.de/SiteGlobals/Functions/RSSFeed/RSSNewsfeed/RSSNewsfeed_Buerger_CERT.xml',
    feed_format: 'rss',
    review_frequency: 'weekly',
    notes: 'Allgemein verstaendliche Warnungen des BSI — geeignet fuer die Weitergabe an Fachbereiche und Sensibilisierung.',
  },
  {
    name: 'CISA — Known Exploited Vulnerabilities (KEV)',
    type: 'authority',
    country: 'US',
    url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    feed_url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    feed_format: 'cisa_kev',
    review_frequency: 'daily',
    notes: 'Katalog nachweislich aktiv ausgenutzter Schwachstellen. Die schaerfste Priorisierungshilfe im Patch-Management: was hier steht, wird bereits angegriffen.',
  },
  {
    name: 'CISA — Cybersecurity Advisories',
    type: 'authority',
    country: 'US',
    url: 'https://www.cisa.gov/news-events/cybersecurity-advisories',
    feed_url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    feed_format: 'rss',
    review_frequency: 'weekly',
    notes: 'Advisories, Alerts und ICS-Meldungen der US-Behoerde — oft Tage vor der europaeischen Berichterstattung.',
  },
  {
    name: 'CERT-EU — Security Advisories',
    type: 'cert',
    country: 'EU',
    url: 'https://cert.europa.eu/publications/security-advisories',
    feed_url: 'https://cert.europa.eu/publications/security-advisories-rss',
    feed_format: 'rss',
    review_frequency: 'weekly',
    notes: 'CERT der EU-Institutionen. Bewertet Meldungen bereits nach Dringlichkeit fuer europaeische Organisationen.',
  },
  {
    name: 'ENISA — News und Threat Landscape',
    type: 'authority',
    country: 'EU',
    url: 'https://www.enisa.europa.eu/news',
    feed_url: '',
    feed_format: 'none',
    review_frequency: 'monthly',
    notes: 'Lagebilder und Jahresberichte der EU-Agentur fuer Cybersicherheit. Quelle fuer die strategische Bedrohungsanalyse, nicht fuer tagesaktuelle Warnungen.',
  },
  {
    name: 'CERT.at / GovCERT Austria',
    type: 'national_csirt',
    country: 'AT',
    url: 'https://www.cert.at/de/warnungen/',
    feed_url: 'https://www.cert.at/de/warnungen/feed/',
    feed_format: 'rss',
    review_frequency: 'weekly',
    active: false,
    notes: 'Nationales CSIRT Oesterreich. Aktivieren, wenn die Organisation in Oesterreich taetig ist.',
  },
  {
    name: 'NCSC Schweiz — Aktuelle Meldungen',
    type: 'national_csirt',
    country: 'CH',
    url: 'https://www.ncsc.admin.ch/ncsc/de/home/aktuell.html',
    feed_url: '',
    feed_format: 'none',
    review_frequency: 'weekly',
    active: false,
    notes: 'Nationales Zentrum fuer Cybersicherheit (Schweiz). Aktivieren, wenn die Organisation in der Schweiz taetig ist.',
  },
  {
    name: 'CERT-FR (ANSSI) — Avis de securite',
    type: 'national_csirt',
    country: 'FR',
    url: 'https://www.cert.ssi.gouv.fr/avis/',
    feed_url: 'https://www.cert.ssi.gouv.fr/avis/feed/',
    feed_format: 'rss',
    review_frequency: 'weekly',
    active: false,
    notes: 'Nationales CSIRT Frankreich. Aktivieren, wenn die Organisation in Frankreich taetig ist.',
  },
  {
    name: 'Microsoft Security Response Center (MSRC)',
    type: 'vendor',
    country: 'INT',
    url: 'https://msrc.microsoft.com/update-guide',
    feed_url: '',
    feed_format: 'none',
    review_frequency: 'monthly',
    notes: 'Patchday-Meldungen und Out-of-Band-Updates. Monatlicher Review deckt den Patch Tuesday ab; kritische Meldungen kommen ueber CERT-Bund frueher an.',
  },
  {
    name: 'Herstelleradvisories der eingesetzten Produkte',
    type: 'vendor',
    country: 'INT',
    url: '',
    feed_url: '',
    feed_format: 'none',
    review_frequency: 'monthly',
    notes: 'Sammelposition: Advisories der Hersteller aus dem eigenen Asset-Register (Firewall, Hypervisor, Backup, ERP). Konkrete Quellen hier oder als eigene Eintraege pflegen.',
  },
  {
    name: 'heise Security',
    type: 'news',
    country: 'DE',
    url: 'https://www.heise.de/security/',
    feed_url: 'https://www.heise.de/security/rss/news-atom.xml',
    feed_format: 'atom',
    review_frequency: 'weekly',
    notes: 'Deutschsprachige Security-News. Deckt die im Self-Check genannten "Sicherheitsnews" ab und meldet Vorfaelle oft vor den Behoerdenkanaelen.',
  },
  {
    name: 'BleepingComputer',
    type: 'news',
    country: 'INT',
    url: 'https://www.bleepingcomputer.com/',
    feed_url: 'https://www.bleepingcomputer.com/feed/',
    feed_format: 'rss',
    review_frequency: 'weekly',
    active: false,
    notes: 'Internationale Security-News mit Schwerpunkt Ransomware und aktiv ausgenutzte Schwachstellen.',
  },
  {
    name: 'Branchen-ISAC / Austauschkreis',
    type: 'isac',
    country: 'DE',
    url: '',
    feed_url: '',
    feed_format: 'none',
    review_frequency: 'quarterly',
    active: false,
    notes: 'Platzhalter fuer den branchenspezifischen Informationsaustausch (UP KRITIS, ISAC, Verbandsarbeit). NIS-2 Art. 29 empfiehlt diesen Austausch ausdruecklich.',
  },
  {
    name: 'Interne Quellen (SIEM, EDR, Netzwerk-Erkennung)',
    type: 'internal',
    country: 'DE',
    url: '',
    feed_url: '',
    feed_format: 'none',
    review_frequency: 'weekly',
    notes: 'Eigene Beobachtungen aus Monitoring und Erkennung. Gehoeren in dieselbe Lagebewertung wie externe Meldungen, sonst entsteht ein zweiter, unverbundener Prozess.',
  },
];

module.exports = catalog;
