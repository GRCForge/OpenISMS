# OpenISMS – Information Security Management System

![Build & Publish](https://github.com/grcforge/openisms/actions/workflows/docker-publish.yml/badge.svg)
![Security & Quality](https://github.com/grcforge/openisms/actions/workflows/security.yml/badge.svg)
![Version](https://img.shields.io/badge/version-2.2.1-blue)
![License](https://img.shields.io/badge/license-Source--Available-red)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Docker](https://img.shields.io/badge/docker-ghcr.io-blue?logo=docker)
![ISO 27001](https://img.shields.io/badge/ISO%2027001-konform-4CAF50)
![NIS-2](https://img.shields.io/badge/NIS--2-unterst%C3%BCtzt-orange)
![DSGVO](https://img.shields.io/badge/DSGVO%2FGDPR-unterst%C3%BCtzt-purple)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FGRCForge%2FOpenISMS.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2FGRCForge%2FOpenISMS?ref=badge_shield)

OpenISMS ist ein vollständiges, praxisorientiertes Information Security Management System (ISMS) auf Basis von Node.js, React und MySQL – ein Projekt von GRCForge, entwickelt zur Unterstützung von **ISO 27001**, **NIS-2**, **DSGVO/GDPR**, **EU AI Act**, **TISAX**, **DORA** und **BSI C5**.

> **Standard-Login nach Erstinstallation:** `admin@isms.local` / `Admin1234!` — bitte sofort ändern.  
> Der Benutzername und das Passwort befinden sich **nur** in dieser README. Aus Sicherheitsgründen sind sie **nicht** auf dem Login-Bildschirm der Anwendung vorausgefüllt.

---

## Inhaltsverzeichnis

1. [Features](#features)
2. [Tech Stack](#tech-stack)
3. [Installation](#installation)
4. [Umgebungsvariablen](#umgebungsvariablen)
5. [Single Sign-On (OIDC)](#single-sign-on-oidc)
6. [Rollen & Berechtigungen](#rollen--berechtigungen)
7. [API-Dokumentation](#api-dokumentation)
8. [MCP Server (KI-Integration)](#mcp-server-ki-integration)
9. [Datenbankschema](#datenbankschema)
10. [Verzeichnisstruktur](#verzeichnisstruktur)
11. [Compliance-Module](#compliance-module)
12. [Compliance-Unterstützung](#compliance-unterstützung)
13. [Sicherheitshinweise](#sicherheitshinweise)

---

## Features

### Dashboard & Onboarding
- Kennzahlen-Karten: Assets gesamt/aktiv, Hoch/Kritisch-Risiken, überfällige Reviews, Compliance-Abdeckung
- Risikoverteilung und Klassifizierungsverteilung als Balkendiagramme
- Compliance-Framework-Abdeckung (ISO 27001, NIS-2, DSGVO) mit Fortschrittsbalken
- Live-Aktivitätsfeed aus dem Audit Log
- **„Erste Schritte"-Karte** für neue Nutzer mit geführtem 4-Schritt-Workflow
- Alle leeren Zustände mit erklärenden Hilfetexten und direkten Einstiegs-Buttons

### Asset-Management
- Vollständiges Asset-Register nach ISO 27001 Annex A.8
- **Asset-Typen:** Hardware · Software · Anwendung · Dienst · Information/Daten · Prozess · Personal · **KI-Anwendung (AI Act)** · **KI-Agent** · Sonstiges
- **Klassifizierung:** Öffentlich · Intern · Vertraulich · Geheim
- **Hosting-Typ:** On-Premise · Public Cloud · Private Cloud · Hybrid
- **Lifecycle-Status:** Evaluation · Produktion · Wartung · Archiviert
- Patch-Status, CVE-Zähler (kritisch/hoch/mittel/gering), EOL-Datum, Härtungsstatus
- Backup-Plan, letzter Wiederherstellungstest
- RTO (Wiederanlaufzeit) und RPO (Datenverlust-Toleranz) pro Asset
- NIS-2-Relevanz-Kennzeichnung
- Parent/Child-Abhängigkeitsstruktur (hierarchische Beziehungen)
- Business Owner und Assessor zuweisbar; externer Dienstleister verknüpfbar
- Compliance-Frameworks und Tags pro Asset
- **Tab-kontextueller Bearbeitungsmodus**: Bearbeiten-Button öffnet je nach aktivem Tab den passenden Teilbereich (Stammdaten / Compliance / Security) mit granularen Rollenberechtigungen
- Filter nach Typ, Klassifizierung, Hosting, Status, Lifecycle, Freitext

### Asset-Topologie
- Interaktiver Abhängigkeitsgraph aller Assets (Mermaid-basiert)
- **Typenspezifische Knotenformen**: Hardware=Rechteck, Software/App=Abgerundet, Daten=Zylinder, Dienst=Raute, KI=Kreis, Prozess=Schräg
- **Subgraph-Clustering**: Parent und Kind-Assets werden visuell als Gruppe dargestellt
- Risiko-Farbcodierung; KI-Assets lila hervorgehoben
- **Klickbare Knoten** (direkter Sprung zum Asset via SVG-Post-Processing), Typ-Filter, horizontal/vertikal
- Pro Asset: eigener Abhängigkeitsgraph (Großeltern → Eltern → Aktuell → Kinder → Enkel) mit farbcodierten Ebenen und Legende
- **Reverse-Verbindungen**: Liste aller abhängigen Assets (Child-Assets) direkt im Topologie-Tab sichtbar und klickbar

### Risikobewertung (CIA-Triad)
- Bewertung nach **Vertraulichkeit (C)**, **Integrität (I)**, **Verfügbarkeit (A)** auf Skala 1–5
- Automatische Risikoberechnung: Score + Level (Gering / Mittel / Hoch / Kritisch)
- Vollständiger Bewertungsverlauf pro Asset mit Trend-Indikatoren (↑ ↓ =)
- Notizen, Maßnahmen, Risk Treatment Workflow (Reduzieren / Akzeptieren / Übertragen / Vermeiden)
- Nächste Bewertung automatisch vorberechnet; Erinnerung wird automatisch erstellt

### Risikoregister (ISO 27005)
- Vollständiges Risikoregister mit 5×5-Risikomatrix (Wahrscheinlichkeit × Auswirkung)
- Inhärentes Risiko und Restrisiko separat bewertet
- **Risk Acceptance Tracking**: Freigabe durch Management mit Ablaufdatum, Frühwarnung bei ≤ 30 Tagen, roter Hinweis bei abgelaufener Akzeptanz
- Risikobehandlungsplan, zugewiesener Risiko-Owner
- Verknüpfung mit Assets, Bedrohungen und Maßnahmen (Controls)
- Interaktive Risikomatrix als Klick-Filter
- CSV- und Excel-Export

### Vorfallsmanagement
- Vollständige Vorfall-Dokumentation nach NIS-2 Art. 23
- **Kategorien**: Schadsoftware · Phishing · Datenschutzverletzung · DoS/DDoS · Unbefugter Zugriff · Fehlkonfiguration · Verlust/Diebstahl · Social Engineering
- Schweregrad (Gering bis Kritisch) und Statusverlauf (Gemeldet → In Untersuchung → Eingedämmt → Behoben → Geschlossen)
- **NIS-2-Meldefristen**: automatische Berechnung 24h-Frühwarnung und 72h-Vollmeldung ab Erkennung, Fristanzeige mit Überfälligkeitswarnung
- Zusatzfelder: Auswirkung, Ursachenanalyse, Korrekturmaßnahmen, **Lessons Learned**, Anzahl betroffener Systeme
- **Datenschutzverletzungs-Details** (sichtbar bei Kategorie „Datenpanne" oder NIS-2-Meldepflicht)
- **Externes Aktenzeichen** für Behördenmeldungen (BSI, LfDI etc.)
- Verknüpfung mit betroffenen Assets und Risiken
- Severity-Statistikkarten, CSV/Excel-Export

### Maßnahmen & Statement of Applicability (SoA)
- Vollständige Kontrolldatenbank: ISO 27001 (Annex A), NIS-2, BSI-Grundschutz, eigene Maßnahmen
- **Maßnahmentypen**: Organisatorisch · Personell · Physisch · Technisch
- Status: Umgesetzt · Geplant · Nicht anwendbar (mit Begründung)
- Verknüpfung mit Risiken inkl. Effektivitätsbewertung (1–5)
- SoA-Übersicht nach Framework gefiltert

### Richtlinien-Bibliothek
- Zentrale Verwaltung von Policies, Leitlinien, Verfahrensanweisungen, Verträgen
- Versionierung mit Verlauf (jede gespeicherte Version downloadbar)
- Gültigkeitszeitraum (`valid_from` / `valid_until`), Status (Entwurf / Aktiv / Zurückgezogen)
- Verknüpfung mit Assets
- Datei-Upload (PDF, Word, etc.)

### Compliance-Übersicht
- Detailseite pro Framework (ISO 27001 · NIS-2 · DSGVO) mit Coverage-Ring
- Liste zugeordneter und nicht zugeordneter Assets
- Warnung bei Assets ohne Framework-Zuordnung
- Schnellzuordnung direkt aus der Übersicht
- **DSGVO-Lückenanzeige**: Automatische Erkennung und Auflistung aller Assets, die personenbezogene Daten verarbeiten (Art. 6/9), aber keinen vollständigen VVT-Eintrag haben

### Management Report & KPI-Dashboards
- Konsolidierter Bericht für die Geschäftsführung (druckoptimiert / PDF-Export)
- **ISMS Health Score** (0–100): Gauge-Diagramm aus Maßnahmen-Abdeckung, Bewertungsgrad, überfälligen Reviews und kritischen Risiken
- **9 Auto-KPI-Karten** mit Sparklines und Trend-Pfeilen (↑/↓/→): Health Score, Control-Coverage, Bewertungs-Coverage, offene Hoch-Risiken, überfällige Erinnerungen, Aufgaben-Abschlussrate, MTTR (90-Tage), Gesamtassets, offene Incidents
- **Drei Tabs:**
  - *Übersicht*: KPI-Karten, Donut-Charts (Risikoverteilung, Control-Status, Aufgaben-Status), Alert-Zeilen, manuelle KPIs
  - *Entwicklung*: 12-Monats-Verlaufscharts (Vorfälle, Risiken, Assets, Aufgaben) mit recharts; KPI-Ziellinien
  - *Details*: NIS-2-Assets, DSGVO-Übersicht, Risikoakzeptanzen, überfällige Reviews
- **Manuelle KPIs** (Name, Zielwert, Einheit, Messfrequenz) mit Messwert-Verlauf und Ziel-Referenzlinie
- Ablaufende Akzeptanzen (≤ 60 Tage), kritische/hohe Risiken, offene Vorfälle
- Excel-Export inkl. VVT-Register (Art. 30)

### Jährliche Review-Erinnerungen
- Automatischer Reminder 1 Jahr nach jeder Bewertung
- Täglicher Cron-Job markiert überfällige Reviews als `overdue`
- Rotes Badge in der Navigation, Glocken-Menü mit Detailübersicht
- Bestätigung mit Zeitstempel

### Dokumente pro Asset
- Datei-Upload (Drag & Drop): PDF, Word, Excel, PowerPoint, Bilder – max. 25 MB
- **Kategorien**: Vertrag · AVV/DPA · Richtlinie · Zertifikat · Risikobericht · Risikoakzeptanz · Sonstiges
- Download, Löschen, Anzeige von Uploader und Datum

### Kommentarfunktion
- Kommentare/Meeting-Notizen pro Asset mit optionalem Terminbezug
- Markdown-Formatierung (Fett, Kursiv, Links, Dateilinks)
- Nur Autor oder Administrator kann eigene Kommentare löschen

### Externe Dienstleister & Lieferkette
- Verwaltung externer Unternehmen (IT-Dienstleister, Cloud-Anbieter, Softwarehersteller, Support, Berater)
- Mehrere Ansprechpartner pro Unternehmen (Name, E-Mail, Telefon, Funktion)
- Asset → Dienstleister-Verknüpfung für NIS-2 Supply-Chain-Dokumentation
- Klappbare Listenansicht mit Direktlink (mailto:)

### Export & Import
- **Export**: CSV (UTF-8/BOM, Excel-kompatibel) und Excel (`.xlsx`) auf allen Listenseiten
- **Import**: CSV- und **Excel-Import** (`.xlsx`) für Assets, Benutzer, Dienstleister, Risiken und eine kombinierte „Firmen + Kontakte"-Ansicht
- Microsoft 365 Quickstart: typische M365-Dienste als vorgefertigte Importvorlage

### Netzwerk-Discovery & Staging
- **Netzwerk-Scan-Import**: Erkannte Hosts landen zunächst in einer **Freigabe-Queue** (Staging) statt direkt als Asset
- **Agent-Discovery**: Lokal installierter Agent meldet installierte Software → ebenfalls Staging
- Übersichtstabelle mit Quelle-Badge (Netzwerk-Scan / Agent), Typ (Hardware/Software), offene Ports
- Pro Eintrag: **Freigeben** (Asset wird erstellt), **Ignorieren** oder ablehnen
- Deduplizierung: bereits bekannte IPs werden nicht erneut gestagt

### VVT – Verarbeitungsverzeichnis (Art. 30 DSGVO)
- Vollständiges VVT-Register mit allen Art.-30-Pflichtfeldern
- **DSFA-Pflicht-Kennzeichnung** (Art. 35) mit Warnbanner im Formular und violettem Badge in der Liste
- **Letzte Überprüfung** (Datum) pro Eintrag mit Chip in der Liste
- 8 vorgefertigte Vorlagen (inkl. CCTV, Zugangskontrolle, Mitarbeitermonitoring)
- Statistik-Karten: Gesamt, Aktiv, Entwurf, Art.-9-Verarbeitungen, DSFA-pflichtig

### Benachrichtigungen
- Glocken-Menü: überfällige, bald fällige und noch nie bewertete Assets
- Optionale native Browser-Benachrichtigungen (Web Notifications API)

### Audit Log
- Lückenlose Protokollierung: Assets, Bewertungen, Risiken, Controls, Incidents, Benutzer, Dienstleister, Dokumente, Einstellungen, Logins
- Filter nach Entitätstyp, Aktion, Datum, Name; Pagination; aufklappbare Before/After-Details
- Konfigurierbare Aufbewahrungsdauer (automatische Bereinigung via Cron)
- CSV/Excel-Export

### Benutzerverwaltung & Authentifizierung
- **Rollen (8)**: Administrator · Assessor · IT-Mitarbeiter · DPO · Asset Owner · Management · Mitarbeiter · Gast (Viewer)
- **Custom Roles**: eigene Rollen anlegen (Name, Beschreibung, Basisrolle) und direkt Benutzern zuweisen — zusätzlich zum OIDC-Gruppen-Mapping
- Benutzer anlegen, bearbeiten, deaktivieren (kein hartes Löschen)
- Lokales Login (E-Mail + Passwort, JWT 24 h) mit Passwortrichtlinien-Enforcement
- **Zwei-Faktor-Authentifizierung (TOTP)**: TOTP-Authenticator-App (RFC 6238) mit Replay-Schutz
- **Passkeys (WebAuthn)**: Hardware-Keys, Touch ID, Face ID; FIDO2 / WebAuthn Level 2
- **SSO (OIDC)**: generisch für jeden OIDC-Provider (Authentik, Keycloak, Entra, Google, Zitadel …)
  - Konfiguration in der App unter *Administration → Single Sign-On* (kein Neustart)
  - Authorization Code Flow mit PKCE; Client-Secret AES-256-GCM verschlüsselt in DB
  - **Profilbild** aus dem `picture`-Claim wird automatisch übernommen und bei jedem Login aktualisiert
  - Auto-Provisioning mit konfigurierbarer Standardrolle; OIDC-Gruppen → Rollen-Mapping
- Brute-Force-Schutz: IP-Rate-Limiting + konto-basierte Sperrung nach konfigurierbaren Fehlversuchen
- SSO-Exklusivität: SSO-Konten sperren lokale Anmeldewege (Passkey, TOTP) automatisch aus

### RBAC – Rollen- & Rechte-Editor
- Konfigurierbares Berechtigungsmatrix pro Modul und Aktion (z. B. `assets.edit_security` nur für Assessor und IT-Mitarbeiter)
- **Module**: Assets (Stammdaten/Compliance/Security getrennt), Risiken, Incidents, Bewertungen, Controls, Richtlinien, Erinnerungen, Dienstleister, Import, Reports, Administration
- Änderungen direkt in der App unter *Administration → Rollen & Rechte*
- Reset auf Werkseinstellungen jederzeit möglich

### Gruppen & Teams
- **Gruppen anlegen** (Name, Beschreibung, Farbe) und Benutzer zuordnen
- **Gruppen-Aufgaben**: Aufgabe wird einer Gruppe statt einem einzelnen Benutzer zugewiesen; sobald ein Mitglied die Aufgabe abschließt, gilt sie für alle als erledigt (**„First-to-complete"**-Semantik)
- Wer eine Gruppenaufgabe abgeschlossen hat, wird in der Aufgabe angezeigt
- **@Gruppen-Erwähnungen** in Kommentaren: alle Mitglieder der Gruppe erhalten eine Benachrichtigung
- Gruppen-Verwaltung unter *Gruppen* (nur Administratoren)

### API-Dokumentation
- **OpenAPI 3.0 Spezifikation** unter `/api/openapi.json`
- **Swagger UI** unter `/api/docs` – interaktiv mit JWT-Authentifizierung aus dem Browser
- Alle Endpunkte dokumentiert: Assets, Risiken, Incidents, Bewertungen, Controls, Richtlinien, Benutzer, Admin, Dashboard, Audit Log, Dienstleister, Import, System

### Administration
- Konsolidierter Admin-Bereich (`/admin`, nur Administratoren):
  - **Benutzer** – anlegen, Rollen vergeben, deaktivieren, letzte Aktivität
  - **Audit Log** – gefiltert mit konfigurierbarer Aufbewahrungsdauer
  - **Single Sign-On** – OIDC-Konfiguration mit Verbindungstest
  - **Einstellungen** – App-Name, Review-Intervall, Passwortrichtlinien, SSO-Optionen
  - **Security** – Passwort-Policy, Session-Konfiguration
  - **Rollen & Rechte** – RBAC-Matrix-Editor
  - **API-Dokumentation** – Links + Auth-Anleitung

---

## Tech Stack

| Komponente | Technologie |
|---|---|
| Backend | Node.js 22 · Express 5 · Sequelize ORM |
| Datenbank | MySQL 8.0 |
| Frontend | React 19 · TypeScript · Vite · Tailwind CSS 4 |
| Authentifizierung | JWT (24 h) · OIDC SSO (openid-client, PKCE) |
| Sicherheit | helmet · rate-limit · CORS · AES-256-GCM |
| Datei-Upload | multer (Disk Storage, max. 25 MB) |
| Visualisierung | Mermaid.js (Topologie) · recharts (KPI-Charts, Trend-Verläufe) |
| Scheduling | node-cron (Overdue-Job, Audit-Retention) |
| Export | SheetJS (xlsx) · CSV |
| API-Docs | OpenAPI 3.0 · Swagger UI (CDN) |
| Deployment | Docker (Single-Container, GHCR) · systemd · install.sh |

---

## Installation

### Option A: Install-Script (empfohlen)

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
sudo bash install.sh
```

Interaktiver Dialog wählt zwischen:
- **Docker Compose** – alles als Container (empfohlen)
- **Systemd** – Backend als `openisms.service`, Frontend via nginx

### Option B: Vorgefertigtes GHCR-Image (kein lokaler Build)

```bash
cp .env.example .env
# DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY, APP_URL setzen

export ISMS_VERSION=latest   # oder z. B. v1.6.0
docker compose -f docker-compose.ghcr.single.yml up -d
```

Verfügbare Image-Tags: `latest` (main) · semantische Versionen (`v1.6.0`, `1.6`, `1`)

### Option C: Selbst bauen (aus Quellcode)

```bash
git clone https://github.com/grcforge/openisms.git
cd openisms
cp .env.example .env
docker compose -f docker-compose.single.yml up -d --build
```

### Option D: `docker run` direkt (z. B. Unraid)

```bash
docker run -d --name isms --restart unless-stopped \
  -p 8080:3001 \
  -e DATABASE_URL="mysql://isms_user:PASS@192.168.1.100:3306/isms" \
  -e JWT_SECRET="<min-32-zeichen-zufallswert>" \
  -e ENCRYPTION_KEY="<min-32-zeichen-zufallswert>" \
  -e APP_URL="http://192.168.1.50:8080" \
  -v /mnt/user/appdata/isms/uploads:/app/uploads \
  ghcr.io/grcforge/openisms-app:latest
```

| URL | Beschreibung |
|---|---|
| `http://localhost:8080` | Web-UI und REST-API (gleiche Origin) |
| `http://localhost:8080/api/health` | Health Check |
| `http://localhost:8080/api/docs` | Swagger UI (API-Dokumentation) |

**Beim ersten Start** legt die App alle Tabellen an, befüllt den ISO-27001/NIS-2/BSI-Controls-Katalog und erstellt einen Standard-Administrator.

#### Unraid (Schritt für Schritt)

1. Docker → **Add Container** → Repository: `ghcr.io/grcforge/openisms-app:latest`
2. Network Type: `bridge` · Port: Host `8080` → Container `3001`
3. Path: Container `/app/uploads` → Host `/mnt/user/appdata/isms/uploads`
4. Variablen hinzufügen:

| Key | Beispiel |
|---|---|
| `DATABASE_URL` | `mysql://isms_user:PASS@192.168.1.100:3306/isms` |
| `JWT_SECRET` | langer Zufallswert |
| `ENCRYPTION_KEY` | langer Zufallswert |
| `APP_URL` | `http://<UNRAID-IP>:8080` |
| `SECURE_COOKIES` | `true` nur hinter HTTPS-Proxy |

5. **Apply** → `http://<UNRAID-IP>:8080` aufrufen.

---

## Umgebungsvariablen

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `DATABASE_URL` | ✓¹ | `mysql://user:pass@host:3306/isms` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | ✓¹ | Alternativ zu `DATABASE_URL` |
| `JWT_SECRET` | ✓ | Token-Signatur (≥ 32 Zeichen) |
| `ENCRYPTION_KEY` | empfohlen | AES-256-Schlüssel für OIDC-Secret-Verschlüsselung |
| `SESSION_SECRET` | empfohlen | Express-Session (OIDC-Flow) |
| `APP_URL` | ✓² | Öffentliche URL (für OIDC-Callback und CORS) |
| `SECURE_COOKIES` | – | `true` hinter HTTPS-Reverse-Proxy |
| `PORT` | – | Standard: `3001` |
| `UPLOAD_DIR` | – | Standard: `/app/uploads` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | – | Überschreiben des Seed-Administrators |

¹ Eines von beiden. ² Für lokales Login optional, für OIDC zwingend.

---

## Single Sign-On (OIDC)

SSO wird **in der App** konfiguriert — kein Neustart, keine `.env`-Änderung.

Unterstützte Provider (generisch OIDC): Authentik · Keycloak · Microsoft Entra · Google · Zitadel · Okta · Auth0 · beliebige OIDC-kompatible IdPs.

**Einrichtung:**
1. Als Administrator: *Administration → Single Sign-On*
2. Die **Redirect-URI** (`<APP_URL>/api/auth/oidc/callback`) im IdP eintragen
3. Issuer-URL, Client-ID, Client-Secret und Scopes (`openid profile email`) eintragen
4. *Verbindung testen* → **SSO aktivieren**

**Funktionsweise:**
- Authorization Code Flow mit PKCE
- Client-Secret wird AES-256-GCM-verschlüsselt in der DB gespeichert
- Beim ersten SSO-Login wird automatisch ein lokaler Benutzer angelegt (Standardrolle konfigurierbar, Auto-Provisioning abschaltbar)
- **Profilbild** aus dem `picture`-Claim wird automatisch gespeichert und bei jedem Login aktualisiert
- Lokales Login bleibt immer verfügbar

---

## Rollen & Berechtigungen

| Rolle | Beschreibung |
|---|---|
| `admin` | Vollzugriff; Benutzerverwaltung, RBAC-Editor, Systemeinstellungen |
| `assessor` | Bewertungen, Risiken, Incidents, Controls, Richtlinien erstellen und bearbeiten |
| `it-staff` | Assets und Security-Felder bearbeiten; keine Compliance-/Klassifizierungsänderungen |
| `dpo` | Compliance- und Datenschutzfelder (VVT, DSFA, Klassifizierung) bearbeiten |
| `owner` | Eigene Assets einsehen; Berichte lesen |
| `management` | Nur-Lesen auf alle freigegebenen Bereiche (Management-Ebene) |
| `employee` | Schulungs-Tab und eigene Trainingsübersicht; keine Schreibrechte |
| `viewer` | Nur-Lesen auf alle freigegebenen Bereiche |

**Custom Roles**: Unter *Administration → Custom Roles* können eigene Rollen mit Name, Beschreibung und einer Basisrolle angelegt und direkt Benutzern zugewiesen werden. Die effektiven Berechtigungen entsprechen der Basisrolle. Custom Roles können auch über OIDC-Gruppen-Mapping automatisch zugewiesen werden.

Die **Berechtigungsmatrix** ist pro Modul und Aktion frei konfigurierbar unter *Administration → Rollen & Rechte* — ohne Neustart der Anwendung.

---

## API-Dokumentation

Die REST-API ist vollständig nach **OpenAPI 3.0** dokumentiert.

| Endpunkt | Beschreibung |
|---|---|
| `GET /api/docs` | Swagger UI (interaktiv, JWT-Authentifizierung im Browser) |
| `GET /api/openapi.json` | OpenAPI 3.0 Spezifikation (JSON) |

**Authentifizierung:**
```bash
# Token holen
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@isms.local","password":"Admin1234!"}' | jq -r .token)

# Token verwenden
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/assets
```

In der Swagger UI wird der Token nach dem Login automatisch aus dem Browser-LocalStorage injiziert.

---

## MCP Server (KI-Integration)

Das ISMS stellt einen **Model Context Protocol (MCP) Server** bereit, über den KI-Assistenten wie Claude direkt mit dem System interagieren können — Assets abfragen, Risiken anlegen, Vorfälle melden und Reports abrufen, ohne den Browser zu öffnen.

### Endpoint

```
POST   <APP_URL>/mcp    ← Anfragen senden (JSON-RPC, auch SSE-Upgrade)
GET    <APP_URL>/mcp    ← SSE-Eventstream (Server → Client)
DELETE <APP_URL>/mcp    ← Session beenden
```

Transport: **Streamable HTTP/SSE** (MCP Spec 2025-03-26), kompatibel mit Claude Desktop, Claude Code CLI und allen MCP-fähigen Clients.

### Authentifizierung

Drei Optionen (alle über `Authorization: Bearer <token>`):

| Option | Konfiguration | Einsatz |
|---|---|---|
| **API-Token** ⭐ | Im App-Profil generieren → „API-Tokens" | Empfohlen: langlebig, benutzerspezifisch, widerrufbar |
| **MCP_SECRET** | `MCP_SECRET=<geheim>` in `.env` | Statischer Admin-Schlüssel für Automatisierungen/CI |
| **JWT-Token** | Token aus `POST /api/auth/login` | Kurzlebig (24 h) — nur für Tests geeignet |

#### API-Token erstellen (empfohlen)

1. Im ISMS einloggen → Profilbild (rechts oben) → **„API-Tokens"**
2. **„Neuen Token erstellen"** → Name vergeben (z. B. `Claude Desktop`) → optional Ablaufdatum setzen
3. Token einmalig kopieren — er wird nur einmal vollständig angezeigt
4. Token hat das Format `isms_api_<64-Hex-Zeichen>`

Der Token ist dem angemeldeten Benutzer zugeordnet — Berechtigungen richten sich nach dessen Rolle. Tokens können jederzeit in der Oberfläche widerrufen werden.

### Verfügbare Tools (18)

| Kategorie | Tool | Beschreibung |
|---|---|---|
| **Assets** | `isms_list_assets` | Assets mit Filtern abrufen (Typ, Status, Klassifizierung, Freitext) |
| | `isms_get_asset` | Asset-Details inkl. letzter CIA-Bewertung und verknüpfter Risiken |
| | `isms_create_asset` | Neues Asset anlegen |
| **Risiken** | `isms_list_risks` | Risikoregister abfragen (Status, Level, Freitext) |
| | `isms_create_risk` | Risiko mit Likelihood × Impact anlegen (Level wird automatisch berechnet) |
| **Vorfälle** | `isms_list_incidents` | Vorfälle abfragen (Status, Schweregrad) |
| | `isms_create_incident` | Sicherheitsvorfall melden |
| | `isms_update_incident_status` | Status, Resolution und Lessons Learned setzen |
| **Aufgaben** | `isms_list_tasks` | Aufgaben abfragen inkl. Gruppen-Aufgaben |
| | `isms_create_task` | Aufgabe erstellen — Zuweisung an Benutzer oder Gruppe |
| | `isms_complete_task` | Aufgabe als erledigt markieren |
| **Controls** | `isms_list_controls` | SoA-Controls nach Framework und Status filtern |
| | `isms_update_control_status` | Umsetzungsstatus einer Maßnahme setzen |
| **Reports** | `isms_get_dashboard` | Dashboard-KPIs: Assets, Risiken, Incidents, Reviews, Coverage |
| | `isms_get_management_report` | Management-Report: Health Score, MTTR, KPIs |
| | `isms_get_compliance_overview` | Abdeckungsgrad je Compliance-Framework |
| **Admin** | `isms_list_users` | Benutzerliste mit Rollen |
| | `isms_list_groups` | Gruppen mit Mitgliedern |
| **Suche** | `isms_search` | Übergreifende Suche in Assets, Risiken, Vorfällen und Aufgaben |

### Einbindung in Claude Desktop

`~/.config/claude/claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "isms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": {
        "Authorization": "Bearer isms_api_<dein-token>"
      }
    }
  }
}
```

### Einbindung in Claude Code CLI

`.claude/settings.json` im Projektverzeichnis oder `~/.claude/settings.json` global:

```json
{
  "mcpServers": {
    "isms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": {
        "Authorization": "Bearer isms_api_<dein-token>"
      }
    }
  }
}
```

### Verbindung testen

```bash
# API-Token testen
curl -X POST https://isms.example.com/mcp \
  -H "Authorization: Bearer isms_api_<dein-token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Die Antwort listet alle 18 verfügbaren Tools auf.

### MCP_SECRET (für Automatisierungen / CI)

Statischer Admin-Schlüssel ohne Ablaufzeit — sinnvoll für Server-zu-Server-Automatisierungen:

```env
# In .env (oder Docker-Compose-Umgebungsvariablen):
MCP_SECRET=<min-32-zufällige-Zeichen>   # openssl rand -hex 32
```

```json
{
  "mcpServers": {
    "isms": {
      "type": "http",
      "url": "https://isms.example.com/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_SECRET-Wert>"
      }
    }
  }
}
```

Wird weder `MCP_SECRET` gesetzt noch ein gültiger API-Token oder JWT verwendet, lehnt der Server alle Anfragen mit `401` ab.

---

## Datenbankschema

| Tabelle | Beschreibung |
|---|---|
| `users` | Benutzer mit 6 Rollen, avatar_url, last_seen_at |
| `assets` | Asset-Register (Typ, Klassifizierung, Hosting, Lifecycle, CVE, RTO/RPO, NIS-2, VVT, DSFA, Parent/Child) |
| `assessments` | CIA-Bewertungen pro Asset (Verlauf, is_current, Risk Treatment, Akzeptanz-Dokument) |
| `risks` | Risikoregister (Wahrscheinlichkeit × Auswirkung, inhärent/residual, Treatment, Acceptance mit Ablaufdatum) |
| `risk_assets` | N:M-Verknüpfung Risiken ↔ Assets |
| `risk_threats` | N:M-Verknüpfung Risiken ↔ Bedrohungen |
| `risk_controls` | N:M-Verknüpfung Risiken ↔ Controls (mit Effektivität) |
| `controls` | Maßnahmen-Katalog (ISO 27001, NIS-2, BSI, Custom) mit Status und SoA |
| `threats` | Bedrohungskatalog (BSI-Elementargefahren, Common, Custom) |
| `incidents` | Vorfälle (Kategorie, Schweregrad, NIS-2-Fristen, Lessons Learned, Aktenzeichen) |
| `incident_assets` | N:M-Verknüpfung Incidents ↔ Assets |
| `incident_risks` | N:M-Verknüpfung Incidents ↔ Risiken |
| `reminders` | Jährliche Review-Erinnerungen (auto-overdue via Cron) |
| `documents` | Datei-Anhänge pro Asset (Disk via Docker Volume) |
| `comments` | Kommentare/Notizen pro Asset |
| `policies` | Richtlinien (Titel, Kategorie, Version, Gültigkeit, Datei-Upload) |
| `policy_versions` | Versionsverlauf pro Richtlinie |
| `policy_assets` | N:M-Verknüpfung Richtlinien ↔ Assets |
| `vendors` | Externe Dienstleister (Typ, Website, NIS-2 Supply Chain) |
| `vendor_contacts` | Ansprechpartner pro Dienstleister |
| `audit_logs` | Lückenloses Änderungsprotokoll aller Aktionen |
| `settings` | Systemeinstellungen, OIDC-Konfiguration (Secret verschlüsselt), RBAC-Matrix |
| `tasks` | Aufgaben (Status, Priorität, Fälligkeitsdatum, related_type/related_id, assigned_to_group_id, completed_by_id) |
| `groups` | Gruppen/Teams (Name, Beschreibung, Farbe) |
| `group_members` | N:M-Verknüpfung Gruppen ↔ Benutzer |
| `notifications` | In-App-Benachrichtigungen (Typ, gelesen, Entity-Ref, Link) |
| `vvt_entries` | VVT-Einträge (Art. 30 DSGVO) mit DSFA-Pflicht und Überprüfungsdatum |
| `subject_requests` | Betroffenenrechte-Anfragen (Art. 15–22 DSGVO) mit Frist und Statusverlauf |
| `discovered_softwares` | Discovery-Staging: erkannte Netzwerk-Hosts und Agenten-Software vor der Freigabe |
| `custom_roles` | Benutzerdefinierte Rollen mit Basisrolle und Beschreibung |
| `training_sessions` | Schulungen/Trainings mit Titel, Datum, Typ und Teilnehmerliste |
| `training_participants` | N:M-Verknüpfung Trainings ↔ Benutzer/Mitarbeiter |
| `passkey_credentials` | WebAuthn-/Passkey-Credentials pro Benutzer |

---

## Verzeichnisstruktur

```
ISMS/
├── install.sh                          # Interaktives Install-Script (Docker/systemd)
├── VERSION                             # Aktuelle Versionsnummer (triggert CI-Release)
├── Dockerfile                          # Single-Container (Backend liefert Frontend mit aus)
├── docker-compose.single.yml           # Single-Container (lokaler Build), externe DB
├── docker-compose.ghcr.single.yml      # Single-Container (GHCR-Image), externe DB
├── .env.example
├── .github/workflows/
│   ├── release.yml                     # Erstellt GitHub Release + Tag bei VERSION-Änderung
│   └── docker-publish.yml              # Baut und pusht GHCR-Image bei neuem Tag
├── backend/
│   └── src/
│       ├── index.js                    # App-Einstieg, DB-Sync, Static-Serving, Swagger
│       ├── openapi.json                # OpenAPI 3.0 Spezifikation
│       ├── config/database.js          # Sequelize (DATABASE_URL oder DB_* vars)
│       ├── models/                     # User, Asset, Assessment, Risk, Control, Threat,
│       │                               #   Incident, Reminder, Document, Comment,
│       │                               #   AuditLog, Vendor, VendorContact, Policy,
│       │                               #   PolicyVersion, Setting, Group, GroupMember,
│       │                               #   Notification, CustomRole, PasskeyCredential,
│       │                               #   Task, VvtEntry, SubjectRequest
│       ├── routes/                     # auth, authOidc, admin, users, assets,
│       │                               #   assessments, risks, controls, threats,
│       │                               #   incidents, reminders, notifications,
│       │                               #   documents, comments, dashboard, compliance,
│       │                               #   report, groups, import, auditlog, vendors,
│       │                               #   policies, vvt, subject-requests, tasks,
│       │                               #   tisax, dora, ai-act, bcm, pentests
│       ├── middleware/auth.js           # JWT authenticate + requireRole
│       └── services/
│           ├── reminderService.js      # node-cron: Overdue-Job + Audit-Retention
│           ├── auditService.js         # Audit-Log-Helper
│           ├── settingsService.js      # Settings, OIDC-Config, RBAC-Permissions (DB)
│           ├── cryptoService.js        # AES-256-GCM für sensible Settings
│           ├── oidcService.js          # openid-client Discovery + Client-Cache
│           └── catalogSeed.js          # ISO/NIS-2/BSI Controls + Bedrohungskatalog
└── frontend/
    └── src/
        ├── App.tsx                     # Router, Auth-Guard
        ├── components/
        │   ├── Layout.tsx              # Sidebar-Navigation mit Beschreibungen
        │   ├── BottomNav.tsx           # Mobile Bottom Tab Bar
        │   ├── CommandPalette.tsx      # ⌘K Schnellsuche
        │   ├── NotificationBell.tsx
        │   └── ui/                     # Card, Button, Input, Select, Modal, Badge,
        │                               #   Table, FilterBar, Mermaid, InfoTooltip
        ├── pages/                      # Dashboard, Assets, AssetDetail, Topology,
        │                               #   Assessments, Risks, Incidents, Controls,
        │                               #   Reminders, Compliance, PolicyLibrary,
        │                               #   ManagementReport, Import, AuditLog, Admin,
        │                               #   Vendors, Contacts, Groups, Tasks, MyArea,
        │                               #   VVT, SubjectRequests, Training,
        │                               #   Tisax, Dora, AiAct, Bcm, Pentests,
        │                               #   Login, AuthCallback
        ├── contexts/AuthContext.tsx
        ├── lib/api.ts
        ├── lib/export.ts               # CSV + Excel Export
        └── types/index.ts
```

---

## Compliance-Module

Module werden im Admin-Bereich unter *Administration → Module* aktiviert/deaktiviert — ohne Neustart. DSGVO ist standardmäßig aktiv, alle anderen Module sind optional.

| Modul-Key | Name | Inhalt |
|---|---|---|
| `dsgvo` | DSGVO/GDPR | VVT (Art. 30), DSFA, Betroffenenrechte (Art. 15–22), Datenpannen |
| `iso27001` | ISO 27001:2022 | Controls Annex A, SoA, Bewertungen, Konformitätsstatus |
| `nis2` | NIS-2 | Risikomanagement Art. 21, Meldepflichten Art. 23, Management-Haftung |
| `bsi_grundschutz` | BSI IT-Grundschutz | Grundschutz-Maßnahmen-Katalog, Umsetzungsstatus |
| `c5` | BSI C5:2026 | Cloud-Criteria-Katalog für Cloud-Dienstleister |
| `tisax` | TISAX (VDA ISA 6) | Anforderungskatalog, Bewertungen, Reifegradmessung |
| `dora` | DORA | IKT-Vorfälle, Resilienztests, Drittanbieter-Risiko |
| `ai_act` | EU AI Act | KI-Inventar, Risikoeinstufung, Verbotene Praktiken, Konformitätsbewertung |
| `bcm` | BCM | Business-Continuity-Pläne, BIA, Übungsprotokoll |
| `pentest` | Penetration Testing | Pentest-Berichte, Findings, Maßnahmen-Tracking |
| `discovery` | Netzwerk-Discovery | Netzwerk-Scan-Import, Agent-Discovery, Staging-Queue |

---

## Compliance-Unterstützung

| Framework | Abgedeckte Anforderungen |
|---|---|
| **ISO 27001:2022** | Asset-Register (A.8), CIA-Bewertung & Risikoregister (ISO 27005), Statement of Applicability (SoA), Maßnahmen-Katalog (Annex A), jährliche Reviews, Klassifizierung, Dokumentenmanagement, Richtlinien-Bibliothek, Audit Log, Cross-Framework Control Mapping |
| **NIS-2** | Risikomanagement (Art. 21), Meldepflichten (Art. 23, 24h/72h-Fristen), Lieferkettensicherheit via Dienstleister-Modul, Incident-Dokumentation mit Aktenzeichen, Management-Haftungsnachweis (Report), NIS-2-Asset-Kennzeichnung |
| **DSGVO / GDPR** | Verarbeitungsverzeichnis (Art. 30), DSFA-Workflow (Art. 35), Betroffenenrechte-Tracker (Art. 15–22) mit Fristberechnung, Datenkategorie (Art. 9), AVV-Dokumente (Art. 28), Datenpannen-Dokumentation mit Behörden-Aktenzeichen |
| **EU AI Act** | Asset-Typen „KI-Anwendung" und „KI-Agent"; Risikoeinstufung (verboten/hoch/niedrig/minimal), Governance-Felder, technische Dokumentation, Konformitätsbewertungs-Workflow |
| **TISAX** | VDA ISA 6 Anforderungskatalog, Bewertungen mit Reifegrad (0–3), Maßnahmen-Tracking |
| **DORA** | IKT-Vorfallsklassifikation und -meldung, Resilienztests (TLPT), IKT-Drittanbieter-Register |
| **BSI IT-Grundschutz** | Grundschutz-Maßnahmen-Katalog, Umsetzungsstatus, Verknüpfung mit Assets |
| **BSI C5:2026** | Cloud-Criteria-Katalog, Konformitätsstatus pro Kriterium |
| **BCM** | Business-Continuity-Pläne, Business-Impact-Analyse (BIA), Übungsprotokoll, Wiederanlaufzeiten (RTO/RPO) direkt aus Asset-Register |
| **Pentest** | Pentest-Berichte hochladen, Findings dokumentieren (CVSS, Status), Maßnahmen-Tracking bis zur Behebung |

---

### Schulungen & Sicherheitsbewusstsein
- Schulungen anlegen (Titel, Typ, Datum, Beschreibung, Pflichtschulung-Kennzeichnung)
- **Teilnehmerlisten-Upload** per CSV oder Excel (`.xlsx`): Spalten `name`, `email`, `department`, `completed` (true/false)
- Mitarbeiter-Rolle hat eigenen Schulungs-Tab mit Übersicht eigener Schulungen
- Verknüpfung mit Compliance-Anforderungen (ISO 27001 A.6.3, NIS-2 Art. 20)

### Betroffenenrechte (Art. 15–22 DSGVO)
- Anfragen anlegen und verwalten (Auskunft, Löschung, Berichtigung, Einschränkung, Portabilität, Widerspruch)
- Automatische Fristberechnung (30 Tage, verlängerbar auf 60 Tage) mit Überfälligkeitswarnung
- Statusverlauf (Offen → In Bearbeitung → Abgeschlossen / Abgelehnt) mit Audit-Trail

### Mobile & UX
- **Progressive Web App (PWA)**: installierbar als Home-Screen-App (Android/iOS/Desktop), `manifest.webmanifest` + Apple-Meta-Tags
- **Bottom Navigation**: feste Tab-Leiste auf Mobile mit den 5 meistgenutzten Bereichen (Dashboard, Assets, Risiken, Aufgaben, Reports)
- **Command Palette** (`Strg+K` / `⌘K`): Schnellsuche über Assets, Risiken, Aufgaben und Dokumente mit Tastaturnavigation
- **Keyboard Shortcuts**: `N` = neuer Eintrag, `/` = Suche fokussieren, `ESC` = Modal schließen
- **Mobile Card Layout**: Tabellen (Assets, Risiken) wechseln auf kleinen Bildschirmen automatisch zu gestapelten Karten
- Leere Zustände mit kontextuellen Einstiegs-CTAs auf allen wichtigen Seiten

## Lokale Entwicklung

Voraussetzungen: Node.js 22+, MySQL 8.0

```bash
# Backend
cd backend && cp .env.example .env
npm install && npm run dev    # Port 3001

# Frontend (neues Terminal)
cd frontend
npm install && npm run dev    # Vite Dev-Server: http://localhost:5173
```

---

## Sicherheitshinweise für den Produktionsbetrieb

- `JWT_SECRET` auf mindestens 32 zufällige Zeichen setzen
- `ENCRYPTION_KEY` setzen (AES-256-GCM für OIDC-Secret) — bei Änderung muss das Secret neu hinterlegt werden
- Alle Datenbankpasswörter in `.env` ändern
- HTTPS via Reverse-Proxy vorschalten (nginx, Traefik, Caddy) und `SECURE_COOKIES=true` setzen
- Docker Volume `uploads` in Backup-Strategie einschließen
- **Standard-Admin-Passwort sofort nach dem ersten Login ändern**
- Regelmäßige MySQL-Backups des `isms`-Schemas einrichten
- Rate-Limiting auf Login-Endpoint aktiv (20 Versuche / 15 min pro IP)
- **Brute-Force-Schutz:** Lokale Benutzerkonten werden nach konfigurierbarer Anzahl von Fehlversuchen vorübergehend gesperrt (einstellbar im Admin-Bereich).
- **SSO-Login-Exklusivität:** Accounts, die über Single Sign-On (SSO) angemeldet wurden, sperren lokale Anmeldeversuche (Passwort, Passkey) und lokale Zwei-Faktor-Authentifizierungen (TOTP) automatisch aus.
- Security-Header via `helmet` aktiv (XSS, Clickjacking, MIME-Sniff)
- CORS auf `APP_URL` eingeschränkt

## Browser-Push-Benachrichtigungen & PWA

OpenISMS unterstützt Browser-Push-Benachrichtigungen und kann als Progressive Web App (PWA) direkt auf mobilen Endgeräten oder dem Desktop installiert werden:

- **Push-Benachrichtigungen**: Die Aktivierung erfolgt über das Glockensymbol in der Kopfzeile. Die erforderlichen VAPID-Schlüsselpaare werden beim ersten Serverstart automatisch generiert. Optional kann eine Kontakt-E-Mail über die Umgebungsvariable `VAPID_EMAIL` konfiguriert werden.
- **PWA-Installation**: Die Installation erfolgt einfach über die PWA-Installationsfunktion des Webbrowsers. Nach der Installation stehen praktische App-Shortcuts (z. B. direkter Einstieg ins Risikoregister oder Assets) zur Verfügung.

---
## Lizenz

OpenISMS ist **Source-Available-Software**. Der Quellcode ist öffentlich einsehbar, die Nutzung ist für private und nicht-kommerzielle Zwecke kostenfrei. Jede kommerzielle bzw. Enterprise-Nutzung sowie jede Weiterverbreitung erfordert eine kommerzielle Lizenz. Details siehe [LICENSE](./LICENSE). Lizenzanfragen: maximilian@herz.dev

© 2026 Maximilian Herz. Alle Rechte vorbehalten.


## License
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2FGRCForge%2FOpenISMS.svg?type=large)](https://app.fossa.com/projects/git%2Bgithub.com%2FGRCForge%2FOpenISMS?ref=badge_large)