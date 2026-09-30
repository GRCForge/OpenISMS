'use strict';

/**
 * Ein Ablageort fuer alle hochgeladenen Dokumente.
 *
 * Richtlinien, Vertraege, AV-Vertraege, Zertifikate, Risikoberichte und
 * Vorlagen sind die Nachweise eines ISMS. Sie gehoeren an genau einen Ort —
 * UPLOAD_DIR —, denn nur diesen Ort nimmt die eingebaute Sicherung mit.
 *
 * Bis 3.3.1 hat routes/policies.js das nicht getan: Es legte Richtlinien
 * relativ zum Arbeitsverzeichnis des Prozesses ab ('uploads/policies'). Das
 * trifft jede Installation, bei der UPLOAD_DIR nicht auf
 * <Arbeitsverzeichnis>/uploads zeigt. Im
 * Docker-Image fiel das nicht auf, weil das Arbeitsverzeichnis dort /app ist
 * und UPLOAD_DIR /app/uploads — beide Wege landeten zufaellig am selben Ort.
 * Auf einer Bare-Installation mit WorkingDirectory=/opt/isms/backend und
 * UPLOAD_DIR=/opt/isms/uploads lagen die Richtlinien dagegen unter
 * /opt/isms/backend/uploads/policies: ausserhalb der Sicherung. Eine
 * Wiederherstellung brachte die Datenbankzeilen samt Hash zurueck, aber keine
 * einzige Datei.
 *
 * Deshalb steht die Aufloesung jetzt hier und nur hier. Wer einen neuen
 * Dokumententyp speichert, holt sich den Pfad aus uploadSubdir() — dann ist er
 * automatisch in der Sicherung.
 */

const fs = require('fs');
const path = require('path');

/**
 * Wurzel aller hochgeladenen Dateien. Ohne UPLOAD_DIR: backend/uploads — derselbe
 * Rueckfall, den index.js und alle Routen bis 3.3.1 einzeln berechnet hatten.
 */
const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));

/** Unterordner fuer eine Dokumentart. Liegt immer innerhalb von uploadRoot(). */
const uploadSubdir = (name) => path.join(uploadRoot(), name);

const POLICIES_SUBDIR = 'policies';

/** Liegt `kind` in `eltern` oder ist es derselbe Pfad? Beide absolut. */
const liegtIn = (kind, eltern) => kind === eltern || kind.startsWith(eltern + path.sep);

// ---------------------------------------------------------------------------
// Was in eine Sicherung gehoert
// ---------------------------------------------------------------------------

// Das einmalige Admin-Passwort legt index.js beim ersten Start nach UPLOAD_DIR,
// weil das im Docker-Betrieb der einzige Ort ist, den der Betreiber von aussen
// erreicht. In eine Sicherung gehoert es nicht: Wer die Datei nach dem ersten
// Login nicht loeschte, hatte das Passwort sonst im Klartext in jedem
// Backup-ZIP. Und zurueckspielen darf eine Wiederherstellung es erst recht
// nicht — sonst taucht ein laengst geaendertes Passwort wieder auf.
const NICHT_SICHERN = new Set(['INITIAL_ADMIN_PASSWORD.txt']);

/** Gehoert diese Datei (Pfad relativ zu uploadRoot) in eine Sicherung? */
const wirdGesichert = (rel) => {
  const teile = String(rel).split(/[\\/]/).filter(Boolean);
  return teile.length > 0 && !NICHT_SICHERN.has(teile[teile.length - 1]);
};

/**
 * Alle Dateien, die eine Sicherung enthalten muss, als { abs, rel }.
 *
 * `rel` nutzt Schraegstriche, weil es direkt als Name im ZIP landet.
 * Symbolische Links werden nicht verfolgt: Ein Link unter UPLOAD_DIR, der
 * nach /etc zeigt, darf dessen Inhalt nicht ins Backup holen.
 */
const sicherungsDateien = () => {
  const liste = [];
  const gehe = (dir, rel) => {
    let eintraege;
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const d of eintraege) {
      const abs = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) gehe(abs, r);
      else if (d.isFile() && wirdGesichert(r)) liste.push({ abs, rel: r });
    }
  };
  gehe(uploadRoot(), '');
  return liste;
};

// ---------------------------------------------------------------------------
// Wiederherstellung
// ---------------------------------------------------------------------------

const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

/**
 * Dateien aus einer Sicherung einspielen — ueberlagernd, nie loeschend.
 *
 * Bis 3.3.1 hat die Wiederherstellung UPLOAD_DIR zuerst vollstaendig geloescht.
 * Mit dem Umzug der Richtlinien nach UPLOAD_DIR/policies wurde das gefaehrlich:
 * Eine Sicherung von vor diesem Release enthaelt keine Richtlinien, und ihr
 * Einspielen haette jede einzelne geloescht, waehrend die Datenbank sie
 * weiterhin fuehrt. Ausserdem ist UPLOAD_DIR im Docker-Betrieb ein Volume, und
 * das Entfernen eines Einhaengepunkts scheitert mit EBUSY (geprueft). Die alte
 * Wiederherstellung endete dort also mit einem Fehler — nachdem die Datenbank
 * bereits zurueckgespielt war, und ohne eine Datei zurueckzuschreiben.
 *
 * Deshalb wird jetzt nur geschrieben, was die Sicherung enthaelt. Dateien, die
 * nicht darin sind, bleiben liegen. Schlimmstenfalls bleibt so eine verwaiste
 * Datei zurueck — harmlos und in der Pruefung nach der Wiederherstellung
 * sichtbar. Umgekehrt waere eine fehlende Datei ein verlorener Nachweis.
 *
 * Das Loeschen hatte nebenbei vorhandene symbolische Links entfernt. Damit das
 * Ueberlagern keine Luecke oeffnet, wird nie durch einen Link geschrieben:
 * O_NOFOLLOW fuer die Datei selbst, und der tatsaechliche Elternordner muss
 * innerhalb von UPLOAD_DIR liegen.
 *
 * @param {{ name: string, lesen: () => Buffer }[]} eintraege  ZIP-Eintraege.
 *   `lesen` entpackt erst beim Schreiben: Die Sicherung liegt ohnehin schon
 *   vollstaendig im Speicher, alles vorab zu entpacken verdoppelte die Spitze.
 */
const dateienEinspielen = (eintraege, { log = console } = {}) => {
  const root = uploadRoot();
  fs.mkdirSync(root, { recursive: true });
  const echteWurzel = fs.realpathSync(root);
  const bericht = { geschrieben: 0, abgewiesen: 0, ausgelassen: 0 };

  for (const e of eintraege) {
    if (!e.name.startsWith('uploads/')) continue;
    const rel = e.name.slice('uploads/'.length);
    if (!rel) continue;
    if (!wirdGesichert(rel)) { bericht.ausgelassen++; continue; }

    const ziel = path.resolve(root, rel);
    if (ziel === root || !liegtIn(ziel, root)) {
      log.warn('[Backup restore] Pfad ausserhalb von UPLOAD_DIR abgewiesen:', e.name);
      bericht.abgewiesen++;
      continue;
    }
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    const echterOrdner = fs.realpathSync(path.dirname(ziel));
    if (!liegtIn(echterOrdner, echteWurzel)) {
      log.warn('[Backup restore] Zielordner fuehrt ueber einen Link aus UPLOAD_DIR hinaus, abgewiesen:', e.name);
      bericht.abgewiesen++;
      continue;
    }

    let fd;
    try {
      // eslint-disable-next-line no-bitwise
      fd = fs.openSync(ziel, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW, 0o640);
    } catch (err) {
      if (err.code === 'ELOOP') {
        log.warn('[Backup restore] Ziel ist ein symbolischer Link, abgewiesen:', e.name);
        bericht.abgewiesen++;
        continue;
      }
      throw err;
    }
    try {
      fs.writeSync(fd, e.lesen());
    } finally {
      fs.closeSync(fd);
    }
    bericht.geschrieben++;
  }
  return bericht;
};

// ---------------------------------------------------------------------------
// Umzug von Dateien, die bis 3.3.1 am falschen Ort landeten
// ---------------------------------------------------------------------------

const ALTLASTEN = [
  // routes/policies.js, bis 3.3.1: relativ zum Arbeitsverzeichnis.
  { quelle: () => path.resolve(process.cwd(), 'uploads', POLICIES_SUBDIR), ziel: POLICIES_SUBDIR },
];

// Fehlercodes, bei denen ein harter Link nicht moeglich ist und kopiert werden
// muss: anderes Dateisystem, oder ein Dateisystem ohne harte Links.
const KEIN_LINK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK']);

/**
 * Eine Datei verschieben, ohne je etwas zu ueberschreiben.
 *
 * Kein existsSync mit anschliessendem rename: rename ueberschreibt still, und
 * zwischen Pruefung und Umbenennen kann sich das Ziel aendern. Ein harter Link
 * scheitert dagegen atomar mit EEXIST, wenn das Ziel schon da ist — ebenso
 * copyFile mit COPYFILE_EXCL auf dem Rueckfallweg.
 *
 * @returns {'verschoben'|'konflikt'}
 */
const verschieben = (quelle, ziel) => {
  try {
    fs.linkSync(quelle, ziel);
  } catch (e) {
    if (e.code === 'EEXIST') return 'konflikt';
    if (!KEIN_LINK.has(e.code)) throw e;
    try {
      fs.copyFileSync(quelle, ziel, fs.constants.COPYFILE_EXCL);
    } catch (e2) {
      if (e2.code === 'EEXIST') return 'konflikt';
      throw e2;
    }
  }
  fs.unlinkSync(quelle);
  return 'verschoben';
};

/** Leere Ordner von innen nach aussen abbauen. rmdir scheitert an vollen — das ist gewollt. */
const leereOrdnerAbbauen = (dir) => {
  let eintraege;
  try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of eintraege) if (d.isDirectory()) leereOrdnerAbbauen(path.join(dir, d.name));
  try { fs.rmdirSync(dir); } catch { /* nicht leer oder nicht mehr da */ }
};

/**
 * Dateien von ihren alten Ablageorten nach UPLOAD_DIR umziehen.
 *
 * Laeuft bei jedem Start und ist danach ein No-op. Nie wird ueberschrieben:
 * Gibt es eine Datei am Ziel schon, bleibt die alte liegen und wird gemeldet.
 * Die Datenbank braucht keine Aenderung — Richtlinien werden ueber den
 * Dateinamen gegen den Ordner aufgeloest, nicht ueber einen gespeicherten Pfad.
 */
const altlastenUmziehen = ({ log = console, altlasten = ALTLASTEN } = {}) => {
  const bericht = { verschoben: 0, konflikte: [], uebersprungen: [], quellen: [] };
  const root = uploadRoot();

  for (const a of altlasten) {
    const quelle = path.resolve(typeof a.quelle === 'function' ? a.quelle() : a.quelle);
    const ziel = path.resolve(uploadSubdir(a.ziel));

    // Im Docker-Image sind beide Wege derselbe Ordner.
    if (quelle === ziel) continue;

    // Liegt einer im anderen, wuerde das Verschieben in sich selbst hineinlaufen.
    if (liegtIn(quelle, ziel) || liegtIn(ziel, quelle)) {
      log.warn(`[Uploads] Alter Ablageort ${quelle} und Ziel ${ziel} liegen ineinander — nicht umgezogen.`);
      bericht.uebersprungen.push(quelle);
      continue;
    }

    let st;
    try { st = fs.lstatSync(quelle); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (!st.isDirectory()) {
      bericht.uebersprungen.push(quelle);
      continue;
    }
    bericht.quellen.push(quelle);

    const gehe = (dir, rel) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, d.name);
        const r = rel ? path.join(rel, d.name) : d.name;
        if (d.isSymbolicLink()) { bericht.uebersprungen.push(abs); continue; }
        if (d.isDirectory()) { gehe(abs, r); continue; }
        if (!d.isFile()) continue;
        const nach = path.join(ziel, r);
        fs.mkdirSync(path.dirname(nach), { recursive: true });
        if (verschieben(abs, nach) === 'verschoben') bericht.verschoben++;
        else bericht.konflikte.push(abs);
      }
    };
    gehe(quelle, '');

    leereOrdnerAbbauen(quelle);
    // Den Elternordner (".../uploads") ebenfalls, wenn er leer ist — aber nie
    // die Upload-Wurzel selbst oder einen Ordner, der sie enthaelt.
    const eltern = path.dirname(quelle);
    if (!liegtIn(root, eltern)) {
      try { fs.rmdirSync(eltern); } catch { /* nicht leer — dann bleibt er */ }
    }
  }

  if (bericht.verschoben || bericht.konflikte.length) {
    log.log(`[Uploads] ${bericht.verschoben} Datei(en) von einem alten Ablageort nach ${root} umgezogen`
      + (bericht.konflikte.length ? `, ${bericht.konflikte.length} Konflikt(e) am alten Ort belassen` : '') + '.');
  }
  for (const k of bericht.konflikte) {
    log.warn(`[Uploads] Nicht umgezogen, am Ziel existiert bereits eine gleichnamige Datei: ${k}`);
  }
  return bericht;
};

// ---------------------------------------------------------------------------
// Vollstaendigkeit
// ---------------------------------------------------------------------------

/**
 * Welche Datenbankzeilen verweisen auf eine Datei, die es nicht gibt?
 *
 * Genau diese Frage haette den Fehler bis 3.3.1 sichtbar gemacht: Nach einer
 * Wiederherstellung standen alle Richtlinien in der Datenbank, keine auf der
 * Platte, und niemand merkte es, bis jemand eine herunterladen wollte.
 */
const verweisePruefen = async (models) => {
  const root = uploadRoot();
  const policies = uploadSubdir(POLICIES_SUBDIR);
  const quellen = [
    { art: 'document', model: models.Document, feld: 'filename', dir: root },
    { art: 'template', model: models.Template, feld: 'filename', dir: root },
    { art: 'policy', model: models.Policy, feld: 'file_url', dir: policies },
    { art: 'policy_version', model: models.PolicyVersion, feld: 'file_url', dir: policies },
  ];
  const ergebnis = { geprueft: 0, fehlend: 0, je_art: {}, beispiele: [] };
  for (const q of quellen) {
    if (!q.model) continue;
    const zeilen = await q.model.findAll({ attributes: ['id', q.feld], raw: true });
    const zaehler = { geprueft: 0, fehlend: 0 };
    for (const z of zeilen) {
      const wert = z[q.feld];
      if (!wert) continue;
      zaehler.geprueft++;
      const name = path.basename(String(wert));
      if (!fs.existsSync(path.join(q.dir, name))) {
        zaehler.fehlend++;
        if (ergebnis.beispiele.length < 20) ergebnis.beispiele.push({ art: q.art, id: z.id, datei: name });
      }
    }
    ergebnis.je_art[q.art] = zaehler;
    ergebnis.geprueft += zaehler.geprueft;
    ergebnis.fehlend += zaehler.fehlend;
  }
  return ergebnis;
};

module.exports = {
  uploadRoot,
  uploadSubdir,
  POLICIES_SUBDIR,
  NICHT_SICHERN,
  wirdGesichert,
  sicherungsDateien,
  dateienEinspielen,
  altlastenUmziehen,
  verweisePruefen,
  // fuer die Tests
  _verschieben: verschieben,
  _liegtIn: liegtIn,
};
