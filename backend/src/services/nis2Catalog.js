// NIS-2-Richtlinie (EU 2022/2555) — Sicherheitsmaßnahmen Art. 21 und Meldepflichten Art. 23
const catalog = [
  {
    article_ref: 'Art. 21(2)(a)',
    category: 'Risikoanalyse & Sicherheitsrichtlinien',
    title: 'Konzepte für Risikoanalyse und Sicherheit für Informationssysteme',
    description: 'Einrichtung und Umsetzung von Konzepten zur Risikoanalyse und zur Sicherheit von Informationssystemen (Informationssicherheitsmanagementsystem — ISMS).',
  },
  {
    article_ref: 'Art. 21(2)(b)',
    category: 'Vorfallbewältigung',
    title: 'Bewältigung von Sicherheitsvorfällen',
    description: 'Konzepte und Verfahren zur Bewältigung von Sicherheitsvorfällen, einschließlich Erkennung, Eskalation, Reaktion und Wiederherstellung.',
  },
  {
    article_ref: 'Art. 21(2)(c)',
    category: 'Business Continuity',
    title: 'Aufrechterhaltung des Betriebs, Backup-Management und Disaster Recovery',
    description: 'Maßnahmen zur Aufrechterhaltung des Betriebs, inkl. Backup-Management, Wiederherstellung im Katastrophenfall und Krisenmanagement.',
  },
  {
    article_ref: 'Art. 21(2)(d)',
    category: 'Lieferkettensicherheit',
    title: 'Sicherheit der Lieferkette',
    description: 'Sicherheit der Lieferkette einschließlich sicherheitsbezogener Aspekte der Beziehungen zwischen den einzelnen Einrichtungen und ihren unmittelbaren Anbietern oder Diensteanbietern.',
  },
  {
    article_ref: 'Art. 21(2)(e)',
    category: 'Sicherheit im Erwerb',
    title: 'Sicherheit beim Erwerb, bei der Entwicklung und Wartung von Netz- und Informationssystemen',
    description: 'Sicherheitsanforderungen beim Erwerb, bei der Entwicklung und Wartung von Netz- und Informationssystemen, einschließlich Schwachstellenmanagement und Offenlegung von Schwachstellen.',
  },
  {
    article_ref: 'Art. 21(2)(f)',
    category: 'Wirksamkeit von Maßnahmen',
    title: 'Bewertung der Wirksamkeit von Risikomanagementmaßnahmen',
    description: 'Konzepte und Verfahren zur Bewertung der Wirksamkeit der Maßnahmen zur Cybersicherheits-Risikomanagement, einschließlich interner Audits und Review-Prozesse.',
  },
  {
    article_ref: 'Art. 21(2)(g)',
    category: 'Cyberhygiene & Schulungen',
    title: 'Grundlegende Verfahren zur Cyberhygiene und Schulungen',
    description: 'Grundlegende Verfahren im Bereich Cyberhygiene sowie Cybersicherheitsschulungen für Mitarbeitende und Führungskräfte.',
  },
  {
    article_ref: 'Art. 21(2)(h)',
    category: 'Kryptografie',
    title: 'Konzepte und Verfahren für den Einsatz von Kryptografie',
    description: 'Konzepte und Verfahren für den Einsatz von Kryptografie und gegebenenfalls Verschlüsselung.',
  },
  {
    article_ref: 'Art. 21(2)(i)',
    category: 'Personalsicherheit & Zugangssteuerung',
    title: 'Sicherheit des Personals, Konzepte für die Zugangssteuerung und Asset Management',
    description: 'Maßnahmen zur Sicherheit des Personals, Konzepte für die Zugangssteuerung und das Asset Management, einschließlich Need-to-Know-Prinzip und Zero-Trust-Ansätze.',
  },
  {
    article_ref: 'Art. 21(2)(j)',
    category: 'Multi-Faktor-Authentifizierung',
    title: 'Verwendung von Multi-Faktor-Authentifizierung oder kontinuierlicher Authentifizierung',
    description: 'Verwendung von Multi-Faktor-Authentifizierungslösungen oder kontinuierlichen Authentifizierungslösungen sowie gesicherter Sprach-, Video- und Textkommunikation und gesicherter Notfallkommunikation.',
  },
  {
    article_ref: 'Art. 23(1)',
    category: 'Meldepflichten',
    title: 'Meldung erheblicher Sicherheitsvorfälle (Frühwarnung innerhalb 24h)',
    description: 'Erhebliche Sicherheitsvorfälle müssen der zuständigen Behörde unverzüglich, spätestens 24 Stunden nach Kenntnisnahme, als Frühwarnung gemeldet werden.',
  },
  {
    article_ref: 'Art. 23(2)',
    category: 'Meldepflichten',
    title: 'Aktualisierte Meldung innerhalb 72 Stunden',
    description: 'Unverzüglich, spätestens 72 Stunden nach Kenntnisnahme, muss eine aktualisierte Meldung mit erster Einschätzung des Vorfalls, Schweregrad und Indikatoren für Kompromittierung übermittelt werden.',
  },
  {
    article_ref: 'Art. 23(4)',
    category: 'Meldepflichten',
    title: 'Abschlussbericht spätestens einen Monat nach Vorfall',
    description: 'Spätestens einen Monat nach Übermittlung der Meldung gemäß Art. 23(2) ist ein Abschlussbericht mit Beschreibung des Vorfalls, Angabe der Ursachen und getroffenen Abhilfemaßnahmen zu übermitteln.',
  },
];

module.exports = catalog;
