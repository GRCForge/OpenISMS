// Vereinfachter VDA-ISA-Katalog (ISA 6, Modul Informationssicherheit).
// Referenzen folgen der VDA-ISA-Nummerierung; Fragen sind komprimierte
// deutsche Zusammenfassungen der Control Questions. Zielreifegrad: 3.
module.exports = [
  // 1 — IS-Richtlinien und Organisation
  { ref: '1.1.1', chapter: 'IS-Richtlinien und Organisation', title: 'Informationssicherheitsrichtlinien', question: 'Inwieweit sind Richtlinien zur Informationssicherheit vorhanden, freigegeben und kommuniziert?' },
  { ref: '1.2.1', chapter: 'IS-Richtlinien und Organisation', title: 'Verantwortlichkeiten der Organisation', question: 'Inwieweit ist Informationssicherheit in der Organisation verankert (Rollen, Verantwortlichkeiten, ISB)?' },
  { ref: '1.2.2', chapter: 'IS-Richtlinien und Organisation', title: 'Informationssicherheit in Projekten', question: 'Inwieweit werden Anforderungen der Informationssicherheit in Projekten berücksichtigt?' },
  { ref: '1.2.3', chapter: 'IS-Richtlinien und Organisation', title: 'Verantwortlichkeiten externer IT-Dienstleister', question: 'Inwieweit sind die Verantwortlichkeiten zwischen externen IT-Dienstleistern und der eigenen Organisation definiert?' },
  { ref: '1.3.1', chapter: 'IS-Richtlinien und Organisation', title: 'Inventarisierung der Assets', question: 'Inwieweit werden Informationswerte (Assets) identifiziert und erfasst?' },
  { ref: '1.3.2', chapter: 'IS-Richtlinien und Organisation', title: 'Klassifizierung von Informationen', question: 'Inwieweit werden Informationswerte hinsichtlich ihres Schutzbedarfs klassifiziert?' },
  { ref: '1.3.3', chapter: 'IS-Richtlinien und Organisation', title: 'Externe IT-Dienste (Cloud)', question: 'Inwieweit ist sichergestellt, dass nur freigegebene externe IT-Dienste zur Verarbeitung von Informationswerten genutzt werden?' },
  { ref: '1.4.1', chapter: 'IS-Richtlinien und Organisation', title: 'Risikomanagement', question: 'Inwieweit werden Informationssicherheitsrisiken identifiziert, bewertet und behandelt?' },
  { ref: '1.5.1', chapter: 'IS-Richtlinien und Organisation', title: 'Bewertung der Richtlinien-Einhaltung', question: 'Inwieweit wird die Einhaltung der Informationssicherheit in Verfahren und Prozessen überprüft?' },
  { ref: '1.5.2', chapter: 'IS-Richtlinien und Organisation', title: 'Unabhängige Überprüfung des ISMS', question: 'Inwieweit wird das ISMS durch eine unabhängige Stelle überprüft (interne Audits)?' },
  { ref: '1.6.1', chapter: 'IS-Richtlinien und Organisation', title: 'Meldung und Behandlung von Sicherheitsereignissen', question: 'Inwieweit werden Informationssicherheitsereignisse gemeldet, bewertet und bearbeitet?' },

  // 2 — Personal (Human Resources)
  { ref: '2.1.1', chapter: 'Personal', title: 'Eignung des Personals', question: 'Inwieweit wird die Eignung von Mitarbeitenden für sensible Tätigkeitsbereiche sichergestellt (Screening)?' },
  { ref: '2.1.2', chapter: 'Personal', title: 'Verpflichtung auf Vertraulichkeit', question: 'Inwieweit wird das Personal vertraglich zur Einhaltung der Informationssicherheit verpflichtet (NDA)?' },
  { ref: '2.1.3', chapter: 'Personal', title: 'Schulung und Sensibilisierung', question: 'Inwieweit wird das Personal zur Informationssicherheit geschult und sensibilisiert (Awareness)?' },
  { ref: '2.1.4', chapter: 'Personal', title: 'Mobiles Arbeiten / Telearbeit', question: 'Inwieweit ist mobiles Arbeiten geregelt und abgesichert?' },

  // 3 — Physische Sicherheit
  { ref: '3.1.1', chapter: 'Physische Sicherheit', title: 'Sicherheitszonen', question: 'Inwieweit werden Sicherheitszonen zum Schutz von Informationswerten verwaltet?' },
  { ref: '3.1.2', chapter: 'Physische Sicherheit', title: 'Ausnahmesituationen', question: 'Inwieweit ist die Informationssicherheit in Ausnahmesituationen (z.B. Notfälle) gewährleistet?' },
  { ref: '3.1.3', chapter: 'Physische Sicherheit', title: 'Umgang mit Datenträgern', question: 'Inwieweit ist der Umgang mit mobilen Datenträgern geregelt (Verschlüsselung, Entsorgung)?' },
  { ref: '3.1.4', chapter: 'Physische Sicherheit', title: 'Umgang mit mobilen IT-Geräten', question: 'Inwieweit ist der Umgang mit mobilen IT-Geräten (Laptops, Smartphones) geregelt?' },

  // 4 — Identitäts- und Berechtigungsmanagement
  { ref: '4.1.1', chapter: 'Identitäts- und Berechtigungsmanagement', title: 'Identitätsmanagement', question: 'Inwieweit ist die Verwaltung von Identitäten über den gesamten Lebenszyklus sichergestellt (Joiner/Mover/Leaver)?' },
  { ref: '4.1.2', chapter: 'Identitäts- und Berechtigungsmanagement', title: 'Sichere Authentisierung', question: 'Inwieweit ist der Benutzerzugang über sichere Verfahren geschützt (Passwortrichtlinie, MFA)?' },
  { ref: '4.1.3', chapter: 'Identitäts- und Berechtigungsmanagement', title: 'Berechtigungsvergabe', question: 'Inwieweit werden Zugriffsrechte nach dem Need-to-know-/Least-Privilege-Prinzip vergeben und regelmäßig überprüft?' },

  // 5 — IT-Sicherheit / Cyber Security
  { ref: '5.1.1', chapter: 'IT-Sicherheit', title: 'Kryptographie', question: 'Inwieweit wird der Einsatz von Kryptographie geregelt (Verschlüsselung, Schlüsselverwaltung)?' },
  { ref: '5.1.2', chapter: 'IT-Sicherheit', title: 'Schutz von Informationen bei Übertragung', question: 'Inwieweit werden Informationen bei der Übertragung über Netzwerke geschützt?' },
  { ref: '5.2.1', chapter: 'IT-Sicherheit', title: 'Änderungsmanagement', question: 'Inwieweit werden Änderungen an IT-Systemen gesteuert (Change Management)?' },
  { ref: '5.2.2', chapter: 'IT-Sicherheit', title: 'Trennung von Umgebungen', question: 'Inwieweit sind Entwicklungs-, Test- und Produktivumgebungen getrennt?' },
  { ref: '5.2.3', chapter: 'IT-Sicherheit', title: 'Schutz vor Schadsoftware', question: 'Inwieweit sind IT-Systeme vor Schadsoftware geschützt (Malware-Schutz)?' },
  { ref: '5.2.4', chapter: 'IT-Sicherheit', title: 'Datensicherung (Backup)', question: 'Inwieweit werden Datensicherungen erstellt, geschützt und Wiederherstellungen getestet?' },
  { ref: '5.2.5', chapter: 'IT-Sicherheit', title: 'Protokollierung und Überwachung', question: 'Inwieweit werden sicherheitsrelevante Ereignisse protokolliert und ausgewertet (Logging/Monitoring)?' },
  { ref: '5.2.6', chapter: 'IT-Sicherheit', title: 'Schwachstellenmanagement', question: 'Inwieweit werden technische Schwachstellen identifiziert, bewertet und behoben (Patch Management)?' },
  { ref: '5.2.7', chapter: 'IT-Sicherheit', title: 'Technische Überprüfung (Audit) von IT-Systemen', question: 'Inwieweit werden IT-Systeme technisch überprüft (z.B. Penetrationstests)?' },
  { ref: '5.2.8', chapter: 'IT-Sicherheit', title: 'Netzwerksicherheit', question: 'Inwieweit wird das Netzwerk der Organisation verwaltet, segmentiert und geschützt?' },
  { ref: '5.3.1', chapter: 'IT-Sicherheit', title: 'Sichere Entwicklung', question: 'Inwieweit wird Informationssicherheit in der Software-Entwicklung berücksichtigt (Secure SDLC)?' },
  { ref: '5.3.2', chapter: 'IT-Sicherheit', title: 'Anforderungen an IT-Beschaffung', question: 'Inwieweit werden Sicherheitsanforderungen bei der Beschaffung von IT-Systemen berücksichtigt?' },

  // 6 — Lieferantenbeziehungen
  { ref: '6.1.1', chapter: 'Lieferantenbeziehungen', title: 'Informationssicherheit bei Lieferanten', question: 'Inwieweit wird Informationssicherheit in Vereinbarungen mit Lieferanten und Kooperationspartnern sichergestellt?' },
  { ref: '6.1.2', chapter: 'Lieferantenbeziehungen', title: 'Geheimhaltungsvereinbarungen', question: 'Inwieweit wird Vertraulichkeit beim Austausch von Informationen vertraglich vereinbart (NDAs)?' },

  // 7 — Compliance
  { ref: '7.1.1', chapter: 'Compliance', title: 'Einhaltung rechtlicher Anforderungen', question: 'Inwieweit wird die Einhaltung regulatorischer und vertraglicher Bestimmungen sichergestellt?' },
  { ref: '7.1.2', chapter: 'Compliance', title: 'Schutz personenbezogener Daten', question: 'Inwieweit wird der Schutz personenbezogener Daten bei der Umsetzung der Informationssicherheit berücksichtigt?' },
];
