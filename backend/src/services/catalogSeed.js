const { Control, Threat } = require('../models');

// ---- Bedrohungen: BSI Elementargefaehrdungen (G 0.1 - G 0.47) ----
const BSI_THREATS = [
  ['G 0.1', 'Feuer'], ['G 0.2', 'Ungünstige klimatische Bedingungen'], ['G 0.3', 'Wasser'],
  ['G 0.4', 'Verschmutzung, Staub, Korrosion'], ['G 0.5', 'Naturkatastrophen'], ['G 0.6', 'Katastrophen im Umfeld'],
  ['G 0.7', 'Großereignisse im Umfeld'], ['G 0.8', 'Ausfall oder Störung der Stromversorgung'],
  ['G 0.9', 'Ausfall oder Störung von Kommunikationsnetzen'], ['G 0.10', 'Ausfall oder Störung von Versorgungsnetzen'],
  ['G 0.11', 'Ausfall oder Störung von Dienstleistern'], ['G 0.12', 'Elektromagnetische Störstrahlung'],
  ['G 0.13', 'Abfangen kompromittierender Strahlung'], ['G 0.14', 'Ausspähen von Informationen (Spionage)'],
  ['G 0.15', 'Abhören'], ['G 0.16', 'Diebstahl von Geräten, Datenträgern oder Dokumenten'],
  ['G 0.17', 'Verlust von Geräten, Datenträgern oder Dokumenten'], ['G 0.18', 'Fehlplanung oder fehlende Anpassung'],
  ['G 0.19', 'Offenlegung schützenswerter Informationen'], ['G 0.20', 'Informationen oder Produkte aus unzuverlässiger Quelle'],
  ['G 0.21', 'Manipulation von Hard- oder Software'], ['G 0.22', 'Manipulation von Informationen'],
  ['G 0.23', 'Unbefugtes Eindringen in IT-Systeme'], ['G 0.24', 'Zerstörung von Geräten oder Datenträgern'],
  ['G 0.25', 'Ausfall von Geräten oder Systemen'], ['G 0.26', 'Fehlfunktion von Geräten oder Systemen'],
  ['G 0.27', 'Ressourcenmangel'], ['G 0.28', 'Software-Schwachstellen oder -Fehler'],
  ['G 0.29', 'Verstoß gegen Gesetze oder Regelungen'], ['G 0.30', 'Unberechtigte Nutzung oder Administration von Geräten und Systemen'],
  ['G 0.31', 'Fehlerhafte Nutzung oder Administration von Geräten und Systemen'], ['G 0.32', 'Missbrauch von Berechtigungen'],
  ['G 0.33', 'Personalausfall'], ['G 0.34', 'Anschlag'], ['G 0.35', 'Nötigung, Erpressung oder Korruption'],
  ['G 0.36', 'Identitätsdiebstahl'], ['G 0.37', 'Abstreiten von Handlungen'], ['G 0.38', 'Missbrauch personenbezogener Daten'],
  ['G 0.39', 'Schadprogramme'], ['G 0.40', 'Verhinderung von Diensten (Denial of Service)'], ['G 0.41', 'Sabotage'],
  ['G 0.42', 'Social Engineering'], ['G 0.43', 'Einspielen von Nachrichten'], ['G 0.44', 'Unbefugtes Eindringen in Räumlichkeiten'],
  ['G 0.45', 'Datenverlust'], ['G 0.46', 'Integritätsverlust schützenswerter Informationen'],
  ['G 0.47', 'Schädliche Seiteneffekte IT-gestützter Angriffe'],
].map(([code, title]) => ({ source: 'bsi_elementar', code, title }));

// ---- Gaengige IT-Bedrohungsszenarien ----
const COMMON_THREATS = [
  'Ransomware-Angriff', 'Phishing / Spear-Phishing', 'DDoS-Angriff', 'Insider-Bedrohung',
  'Datenleck / Datenexfiltration', 'Supply-Chain-Angriff', 'Zero-Day-Exploit',
  'Fehlkonfiguration (Cloud/System)', 'Kompromittierte Zugangsdaten', 'Advanced Persistent Threat (APT)',
].map(title => ({ source: 'common', code: null, title }));

// ---- ISO/IEC 27001:2022 Annex A (93 Controls) ----
const ISO = [
  // A.5 Organizational (37)
  ['5.1', 'Policies for information security', 'organizational'], ['5.2', 'Information security roles and responsibilities', 'organizational'],
  ['5.3', 'Segregation of duties', 'organizational'], ['5.4', 'Management responsibilities', 'organizational'],
  ['5.5', 'Contact with authorities', 'organizational'], ['5.6', 'Contact with special interest groups', 'organizational'],
  ['5.7', 'Threat intelligence', 'organizational'], ['5.8', 'Information security in project management', 'organizational'],
  ['5.9', 'Inventory of information and other associated assets', 'organizational'], ['5.10', 'Acceptable use of information and other associated assets', 'organizational'],
  ['5.11', 'Return of assets', 'organizational'], ['5.12', 'Classification of information', 'organizational'],
  ['5.13', 'Labelling of information', 'organizational'], ['5.14', 'Information transfer', 'organizational'],
  ['5.15', 'Access control', 'organizational'], ['5.16', 'Identity management', 'organizational'],
  ['5.17', 'Authentication information', 'organizational'], ['5.18', 'Access rights', 'organizational'],
  ['5.19', 'Information security in supplier relationships', 'organizational'], ['5.20', 'Addressing information security within supplier agreements', 'organizational'],
  ['5.21', 'Managing information security in the ICT supply chain', 'organizational'], ['5.22', 'Monitoring, review and change management of supplier services', 'organizational'],
  ['5.23', 'Information security for use of cloud services', 'organizational'], ['5.24', 'Information security incident management planning and preparation', 'organizational'],
  ['5.25', 'Assessment and decision on information security events', 'organizational'], ['5.26', 'Response to information security incidents', 'organizational'],
  ['5.27', 'Learning from information security incidents', 'organizational'], ['5.28', 'Collection of evidence', 'organizational'],
  ['5.29', 'Information security during disruption', 'organizational'], ['5.30', 'ICT readiness for business continuity', 'organizational'],
  ['5.31', 'Legal, statutory, regulatory and contractual requirements', 'organizational'], ['5.32', 'Intellectual property rights', 'organizational'],
  ['5.33', 'Protection of records', 'organizational'], ['5.34', 'Privacy and protection of PII', 'organizational'],
  ['5.35', 'Independent review of information security', 'organizational'], ['5.36', 'Compliance with policies, rules and standards for information security', 'organizational'],
  ['5.37', 'Documented operating procedures', 'organizational'],
  // A.6 People (8)
  ['6.1', 'Screening', 'people'], ['6.2', 'Terms and conditions of employment', 'people'],
  ['6.3', 'Information security awareness, education and training', 'people'], ['6.4', 'Disciplinary process', 'people'],
  ['6.5', 'Responsibilities after termination or change of employment', 'people'], ['6.6', 'Confidentiality or non-disclosure agreements', 'people'],
  ['6.7', 'Remote working', 'people'], ['6.8', 'Information security event reporting', 'people'],
  // A.7 Physical (14)
  ['7.1', 'Physical security perimeters', 'physical'], ['7.2', 'Physical entry', 'physical'],
  ['7.3', 'Securing offices, rooms and facilities', 'physical'], ['7.4', 'Physical security monitoring', 'physical'],
  ['7.5', 'Protecting against physical and environmental threats', 'physical'], ['7.6', 'Working in secure areas', 'physical'],
  ['7.7', 'Clear desk and clear screen', 'physical'], ['7.8', 'Equipment siting and protection', 'physical'],
  ['7.9', 'Security of assets off-premises', 'physical'], ['7.10', 'Storage media', 'physical'],
  ['7.11', 'Supporting utilities', 'physical'], ['7.12', 'Cabling security', 'physical'],
  ['7.13', 'Equipment maintenance', 'physical'], ['7.14', 'Secure disposal or re-use of equipment', 'physical'],
  // A.8 Technological (34)
  ['8.1', 'User endpoint devices', 'technological'], ['8.2', 'Privileged access rights', 'technological'],
  ['8.3', 'Information access restriction', 'technological'], ['8.4', 'Access to source code', 'technological'],
  ['8.5', 'Secure authentication', 'technological'], ['8.6', 'Capacity management', 'technological'],
  ['8.7', 'Protection against malware', 'technological'], ['8.8', 'Management of technical vulnerabilities', 'technological'],
  ['8.9', 'Configuration management', 'technological'], ['8.10', 'Information deletion', 'technological'],
  ['8.11', 'Data masking', 'technological'], ['8.12', 'Data leakage prevention', 'technological'],
  ['8.13', 'Information backup', 'technological'], ['8.14', 'Redundancy of information processing facilities', 'technological'],
  ['8.15', 'Logging', 'technological'], ['8.16', 'Monitoring activities', 'technological'],
  ['8.17', 'Clock synchronization', 'technological'], ['8.18', 'Use of privileged utility programs', 'technological'],
  ['8.19', 'Installation of software on operational systems', 'technological'], ['8.20', 'Networks security', 'technological'],
  ['8.21', 'Security of network services', 'technological'], ['8.22', 'Segregation of networks', 'technological'],
  ['8.23', 'Web filtering', 'technological'], ['8.24', 'Use of cryptography', 'technological'],
  ['8.25', 'Secure development life cycle', 'technological'], ['8.26', 'Application security requirements', 'technological'],
  ['8.27', 'Secure system architecture and engineering principles', 'technological'], ['8.28', 'Secure coding', 'technological'],
  ['8.29', 'Security testing in development and acceptance', 'technological'], ['8.30', 'Outsourced development', 'technological'],
  ['8.31', 'Separation of development, test and production environments', 'technological'], ['8.32', 'Change management', 'technological'],
  ['8.33', 'Test information', 'technological'], ['8.34', 'Protection of information systems during audit testing', 'technological'],
].map(([code, title, type]) => ({ framework: 'iso27001', code: `A.${code}`, title, type }));

// ---- NIS-2 Art. 21 (2) Mindestmassnahmen ----
const NIS2 = [
  ['NIS2-a', 'Risikoanalyse und Sicherheit für Informationssysteme'], ['NIS2-b', 'Bewältigung von Sicherheitsvorfällen'],
  ['NIS2-c', 'Aufrechterhaltung des Betriebs (Backup, Krisenmanagement)'], ['NIS2-d', 'Sicherheit der Lieferkette'],
  ['NIS2-e', 'Sicherheit bei Erwerb, Entwicklung und Wartung'], ['NIS2-f', 'Bewertung der Wirksamkeit der Risikomaßnahmen'],
  ['NIS2-g', 'Grundlegende Cyberhygiene und Schulungen'], ['NIS2-h', 'Kryptografie und Verschlüsselung'],
  ['NIS2-i', 'Personalsicherheit, Zugriffskontrolle, Asset-Management'], ['NIS2-j', 'Multi-Faktor-Authentifizierung und gesicherte Kommunikation'],
].map(([code, title]) => ({ framework: 'nis2', code, title, type: 'organizational' }));

// ---- BSI IT-Grundschutz (Auswahl gaengiger Bausteine) ----
const BSI = [
  ['ISMS.1', 'Sicherheitsmanagement', 'organizational'], ['ORP.1', 'Organisation', 'organizational'],
  ['ORP.2', 'Personal', 'people'], ['ORP.3', 'Sensibilisierung und Schulung', 'people'],
  ['ORP.4', 'Identitäts- und Berechtigungsmanagement', 'organizational'], ['CON.3', 'Datensicherungskonzept', 'organizational'],
  ['CON.6', 'Löschen und Vernichten', 'organizational'], ['CON.8', 'Software-Entwicklung', 'technological'],
  ['OPS.1.1.3', 'Patch- und Änderungsmanagement', 'technological'], ['OPS.1.1.4', 'Schutz vor Schadprogrammen', 'technological'],
  ['DER.1', 'Detektion von sicherheitsrelevanten Ereignissen', 'technological'], ['DER.2.1', 'Behandlung von Sicherheitsvorfällen', 'organizational'],
  ['SYS.1.1', 'Allgemeiner Server', 'technological'], ['NET.1.1', 'Netzarchitektur und -design', 'technological'],
  ['APP.3.1', 'Webanwendungen und Webservices', 'technological'], ['INF.1', 'Allgemeines Gebäude', 'physical'],
].map(([code, title, type]) => ({ framework: 'bsi', code, title, type }));

const seedCatalog = async () => {
  try {
    if ((await Control.count()) === 0) {
      await Control.bulkCreate([...ISO, ...NIS2, ...BSI]);
      console.log(`[Seed] ${ISO.length + NIS2.length + BSI.length} Controls angelegt (ISO 27001 / NIS-2 / BSI)`);
    }
    if ((await Threat.count()) === 0) {
      await Threat.bulkCreate([...BSI_THREATS, ...COMMON_THREATS]);
      console.log(`[Seed] ${BSI_THREATS.length + COMMON_THREATS.length} Bedrohungen angelegt`);
    }
  } catch (e) {
    console.error('[Seed] Katalog-Seed fehlgeschlagen:', e.message);
  }
};

module.exports = { seedCatalog };
