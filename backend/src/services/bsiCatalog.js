// BSI IT-Grundschutz-Kompendium (Auswahl ISMS-relevanter Bausteine)
// Quelle: BSI IT-Grundschutz-Kompendium Edition 2023
const catalog = [
  // ── ISMS ──────────────────────────────────────────────────────────
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A1', title: 'Übernahme der Gesamtverantwortung für Informationssicherheit durch die Leitung', requirement_level: 'basis' },
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A2', title: 'Festlegen von Sicherheitszielen und -strategie', requirement_level: 'basis' },
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A3', title: 'Erstellen einer Leitlinie zur Informationssicherheit', requirement_level: 'basis' },
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A4', title: 'Benennung eines Informationssicherheitsbeauftragten', requirement_level: 'basis' },
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A6', title: 'Erstellung eines Sicherheitskonzepts', requirement_level: 'basis' },
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A8', title: 'Integration der Mitarbeiter in den Sicherheitsprozess', requirement_level: 'basis' },
  { baustein_id: 'ISMS.1', baustein_name: 'Sicherheitsmanagement', layer: 'ISMS', req_id: 'ISMS.1.A11', title: 'Aufrechterhaltung der Informationssicherheit', requirement_level: 'standard' },
  // ── ORP ──────────────────────────────────────────────────────────
  { baustein_id: 'ORP.1', baustein_name: 'Organisation', layer: 'ORP', req_id: 'ORP.1.A1', title: 'Festlegung von Verantwortlichkeiten und Regelungen', requirement_level: 'basis' },
  { baustein_id: 'ORP.1', baustein_name: 'Organisation', layer: 'ORP', req_id: 'ORP.1.A2', title: 'Zuweisung der Zuständigkeiten', requirement_level: 'basis' },
  { baustein_id: 'ORP.1', baustein_name: 'Organisation', layer: 'ORP', req_id: 'ORP.1.A3', title: 'Beaufsichtigung oder Begleitung von Fremdpersonen', requirement_level: 'basis' },
  { baustein_id: 'ORP.2', baustein_name: 'Personal', layer: 'ORP', req_id: 'ORP.2.A1', title: 'Geregelte Einarbeitung neuer Mitarbeiter', requirement_level: 'basis' },
  { baustein_id: 'ORP.2', baustein_name: 'Personal', layer: 'ORP', req_id: 'ORP.2.A2', title: 'Geregelte Verfahrensweise beim Weggang von Mitarbeitern', requirement_level: 'basis' },
  { baustein_id: 'ORP.2', baustein_name: 'Personal', layer: 'ORP', req_id: 'ORP.2.A4', title: 'Festlegung von Regelungen für den Einsatz von Fremdpersonal', requirement_level: 'basis' },
  { baustein_id: 'ORP.3', baustein_name: 'Sensibilisierung und Schulung', layer: 'ORP', req_id: 'ORP.3.A1', title: 'Sensibilisierung der Führungskräfte für Informationssicherheit', requirement_level: 'basis' },
  { baustein_id: 'ORP.3', baustein_name: 'Sensibilisierung und Schulung', layer: 'ORP', req_id: 'ORP.3.A3', title: 'Einweisung des Personals in den sicheren Umgang mit IT', requirement_level: 'basis' },
  { baustein_id: 'ORP.3', baustein_name: 'Sensibilisierung und Schulung', layer: 'ORP', req_id: 'ORP.3.A4', title: 'Konzeption und Planung eines Sensibilisierungs- und Schulungsprogramms', requirement_level: 'standard' },
  { baustein_id: 'ORP.4', baustein_name: 'Identitäts- und Berechtigungsmanagement', layer: 'ORP', req_id: 'ORP.4.A1', title: 'Regelung für die Einrichtung und Löschung von Benutzern und Benutzergruppen', requirement_level: 'basis' },
  { baustein_id: 'ORP.4', baustein_name: 'Identitäts- und Berechtigungsmanagement', layer: 'ORP', req_id: 'ORP.4.A2', title: 'Einrichtung, Änderung und Entzug von Berechtigungen', requirement_level: 'basis' },
  { baustein_id: 'ORP.4', baustein_name: 'Identitäts- und Berechtigungsmanagement', layer: 'ORP', req_id: 'ORP.4.A4', title: 'Aufgabenverteilung und Funktionstrennung', requirement_level: 'basis' },
  // ── CON ──────────────────────────────────────────────────────────
  { baustein_id: 'CON.1', baustein_name: 'Kryptokonzept', layer: 'CON', req_id: 'CON.1.A1', title: 'Auswahl geeigneter kryptografischer Verfahren', requirement_level: 'basis' },
  { baustein_id: 'CON.1', baustein_name: 'Kryptokonzept', layer: 'CON', req_id: 'CON.1.A2', title: 'Datenverschlüsselung', requirement_level: 'basis' },
  { baustein_id: 'CON.3', baustein_name: 'Datensicherungskonzept', layer: 'CON', req_id: 'CON.3.A1', title: 'Erhebung der Einflussfaktoren der Datensicherung', requirement_level: 'basis' },
  { baustein_id: 'CON.3', baustein_name: 'Datensicherungskonzept', layer: 'CON', req_id: 'CON.3.A2', title: 'Festlegung der Verfahrensweise für die Datensicherung', requirement_level: 'basis' },
  { baustein_id: 'CON.3', baustein_name: 'Datensicherungskonzept', layer: 'CON', req_id: 'CON.3.A4', title: 'Erstellung eines Datensicherungskonzepts', requirement_level: 'standard' },
  { baustein_id: 'CON.6', baustein_name: 'Löschen und Vernichten', layer: 'CON', req_id: 'CON.6.A1', title: 'Regelung für das Löschen und Vernichten von Informationen', requirement_level: 'basis' },
  { baustein_id: 'CON.6', baustein_name: 'Löschen und Vernichten', layer: 'CON', req_id: 'CON.6.A2', title: 'Ordnungsgemäße Entsorgung von schutzbedürftigen Betriebsmitteln', requirement_level: 'basis' },
  // ── OPS ──────────────────────────────────────────────────────────
  { baustein_id: 'OPS.1.1.2', baustein_name: 'Ordnungsgemäße IT-Administration', layer: 'OPS', req_id: 'OPS.1.1.2.A1', title: 'Personalauswahl für administrative Tätigkeiten', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.2', baustein_name: 'Ordnungsgemäße IT-Administration', layer: 'OPS', req_id: 'OPS.1.1.2.A2', title: 'Vertretungsregelungen und Notfallvorsorge', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.2', baustein_name: 'Ordnungsgemäße IT-Administration', layer: 'OPS', req_id: 'OPS.1.1.2.A4', title: 'Beendigung der Tätigkeit als Administrator', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.3', baustein_name: 'Patch- und Änderungsmanagement', layer: 'OPS', req_id: 'OPS.1.1.3.A1', title: 'Konzept für das Patch- und Änderungsmanagement', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.3', baustein_name: 'Patch- und Änderungsmanagement', layer: 'OPS', req_id: 'OPS.1.1.3.A2', title: 'Festlegung der Zuständigkeiten', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.3', baustein_name: 'Patch- und Änderungsmanagement', layer: 'OPS', req_id: 'OPS.1.1.3.A3', title: 'Konfiguration von Autoupdate-Mechanismen', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.4', baustein_name: 'Schutz vor Schadprogrammen', layer: 'OPS', req_id: 'OPS.1.1.4.A1', title: 'Erstellung eines Konzepts für den Schutz vor Schadprogrammen', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.4', baustein_name: 'Schutz vor Schadprogrammen', layer: 'OPS', req_id: 'OPS.1.1.4.A2', title: 'Nutzung systemspezifischer Schutzmechanismen', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.5', baustein_name: 'Protokollierung', layer: 'OPS', req_id: 'OPS.1.1.5.A1', title: 'Erstellung einer Sicherheitsrichtlinie für die Protokollierung', requirement_level: 'basis' },
  { baustein_id: 'OPS.1.1.5', baustein_name: 'Protokollierung', layer: 'OPS', req_id: 'OPS.1.1.5.A2', title: 'Konfiguration der Protokollierung auf System- und Netzebene', requirement_level: 'basis' },
  // ── DER ──────────────────────────────────────────────────────────
  { baustein_id: 'DER.1', baustein_name: 'Detektion von sicherheitsrelevanten Ereignissen', layer: 'DER', req_id: 'DER.1.A1', title: 'Erstellung einer Sicherheitsrichtlinie für die Detektion', requirement_level: 'basis' },
  { baustein_id: 'DER.1', baustein_name: 'Detektion von sicherheitsrelevanten Ereignissen', layer: 'DER', req_id: 'DER.1.A2', title: 'Einhaltung rechtlicher Bedingungen bei der Auswertung von Protokolldaten', requirement_level: 'basis' },
  { baustein_id: 'DER.2.1', baustein_name: 'Behandlung von Sicherheitsvorfällen', layer: 'DER', req_id: 'DER.2.1.A1', title: 'Definition eines Sicherheitsvorfalls', requirement_level: 'basis' },
  { baustein_id: 'DER.2.1', baustein_name: 'Behandlung von Sicherheitsvorfällen', layer: 'DER', req_id: 'DER.2.1.A2', title: 'Erstellung einer Richtlinie zur Behandlung von Sicherheitsvorfällen', requirement_level: 'basis' },
  { baustein_id: 'DER.2.1', baustein_name: 'Behandlung von Sicherheitsvorfällen', layer: 'DER', req_id: 'DER.2.1.A3', title: 'Festlegung von Verantwortlichkeiten und Ansprechpartnern bei Sicherheitsvorfällen', requirement_level: 'basis' },
  { baustein_id: 'DER.3.1', baustein_name: 'Audits und Revisionen', layer: 'DER', req_id: 'DER.3.1.A1', title: 'Definition der Grundanforderungen an Audits', requirement_level: 'basis' },
  { baustein_id: 'DER.3.1', baustein_name: 'Audits und Revisionen', layer: 'DER', req_id: 'DER.3.1.A2', title: 'Initiierung von Audits', requirement_level: 'basis' },
  { baustein_id: 'DER.4', baustein_name: 'Notfallmanagement', layer: 'DER', req_id: 'DER.4.A1', title: 'Erstellung eines Notfallhandbuchs', requirement_level: 'basis' },
  { baustein_id: 'DER.4', baustein_name: 'Notfallmanagement', layer: 'DER', req_id: 'DER.4.A2', title: 'Integration von Notfallmanagement in organisationsweite Abläufe und Prozesse', requirement_level: 'standard' },
  // ── APP ──────────────────────────────────────────────────────────
  { baustein_id: 'APP.1.1', baustein_name: 'Office-Produkte', layer: 'APP', req_id: 'APP.1.1.A1', title: 'Sicherstellen der Integrität von Office-Produkten', requirement_level: 'basis' },
  { baustein_id: 'APP.1.1', baustein_name: 'Office-Produkte', layer: 'APP', req_id: 'APP.1.1.A2', title: 'Einschränken von Aktiven Inhalten', requirement_level: 'basis' },
  { baustein_id: 'APP.3.1', baustein_name: 'Webanwendungen und Webservices', layer: 'APP', req_id: 'APP.3.1.A1', title: 'Authentisierung bei Webanwendungen', requirement_level: 'basis' },
  { baustein_id: 'APP.3.1', baustein_name: 'Webanwendungen und Webservices', layer: 'APP', req_id: 'APP.3.1.A3', title: 'Sicheres Session-Management', requirement_level: 'basis' },
  // ── SYS ──────────────────────────────────────────────────────────
  { baustein_id: 'SYS.1.1', baustein_name: 'Allgemeine Server', layer: 'SYS', req_id: 'SYS.1.1.A1', title: 'Geeignete Aufstellung', requirement_level: 'basis' },
  { baustein_id: 'SYS.1.1', baustein_name: 'Allgemeine Server', layer: 'SYS', req_id: 'SYS.1.1.A2', title: 'Benutzerauthentisierung an Servern', requirement_level: 'basis' },
  { baustein_id: 'SYS.1.1', baustein_name: 'Allgemeine Server', layer: 'SYS', req_id: 'SYS.1.1.A3', title: 'Restriktive Rechtevergabe', requirement_level: 'basis' },
  { baustein_id: 'SYS.2.1', baustein_name: 'Allgemeiner Client', layer: 'SYS', req_id: 'SYS.2.1.A1', title: 'Sichere Benutzerkonten', requirement_level: 'basis' },
  { baustein_id: 'SYS.2.1', baustein_name: 'Allgemeiner Client', layer: 'SYS', req_id: 'SYS.2.1.A3', title: 'Aktivieren von Autoupdate-Mechanismen', requirement_level: 'basis' },
  // ── NET ──────────────────────────────────────────────────────────
  { baustein_id: 'NET.1.1', baustein_name: 'Netzarchitektur und -design', layer: 'NET', req_id: 'NET.1.1.A1', title: 'Sicherheitsrichtlinie für die Netz-Segmentierung', requirement_level: 'basis' },
  { baustein_id: 'NET.1.1', baustein_name: 'Netzarchitektur und -design', layer: 'NET', req_id: 'NET.1.1.A2', title: 'Dokumentation des Netzes', requirement_level: 'basis' },
  { baustein_id: 'NET.1.2', baustein_name: 'Netzwerk-Management', layer: 'NET', req_id: 'NET.1.2.A1', title: 'Planung des Netzwerk-Managements', requirement_level: 'basis' },
  { baustein_id: 'NET.1.2', baustein_name: 'Netzwerk-Management', layer: 'NET', req_id: 'NET.1.2.A2', title: 'Planung der Netztrennung des Management-Netzes', requirement_level: 'basis' },
  { baustein_id: 'NET.3.2', baustein_name: 'VPN', layer: 'NET', req_id: 'NET.3.2.A1', title: 'Planung des VPN-Einsatzes', requirement_level: 'basis' },
  { baustein_id: 'NET.3.2', baustein_name: 'VPN', layer: 'NET', req_id: 'NET.3.2.A2', title: 'Auswahl eines VPN-Produkts', requirement_level: 'basis' },
  // ── INF ──────────────────────────────────────────────────────────
  { baustein_id: 'INF.1', baustein_name: 'Allgemeines Gebäude', layer: 'INF', req_id: 'INF.1.A1', title: 'Planung der Gebäudesicherheit', requirement_level: 'basis' },
  { baustein_id: 'INF.1', baustein_name: 'Allgemeines Gebäude', layer: 'INF', req_id: 'INF.1.A2', title: 'Angepasste Aufteilung der Stromversorgung', requirement_level: 'basis' },
  { baustein_id: 'INF.2', baustein_name: 'Rechenzentrum sowie Serverraum', layer: 'INF', req_id: 'INF.2.A1', title: 'Festlegung der Anforderungen an einen Serverraum', requirement_level: 'basis' },
  { baustein_id: 'INF.2', baustein_name: 'Rechenzentrum sowie Serverraum', layer: 'INF', req_id: 'INF.2.A2', title: 'Geeignete Aufstellung und Ausrüstung', requirement_level: 'basis' },
];

module.exports = catalog;
