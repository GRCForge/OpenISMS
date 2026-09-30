#!/usr/bin/env node
'use strict';

/**
 * Ablageort der Dokumente, Sicherung und Wiederherstellung.
 *
 * Bis 3.3.1 lagen Richtlinien auf jeder Installation, bei der UPLOAD_DIR nicht
 * auf <Arbeitsverzeichnis>/uploads zeigte, ausserhalb von UPLOAD_DIR — und
 * damit ausserhalb jeder Sicherung. Die Wiederherstellung loeschte ausserdem
 * UPLOAD_DIR vollstaendig, bevor sie Dateien zurueckschrieb.
 *
 * Geprueft wird hier vor allem, was NICHT passieren darf: dass eine Sicherung
 * einen Nachweis auslaesst, dass eine Wiederherstellung einen loescht, dass
 * ein Umzug etwas ueberschreibt, und dass ein Pfad oder Link aus UPLOAD_DIR
 * hinausfuehrt.
 *
 * Alles laeuft gegen echte temporaere Verzeichnisse.
 *
 * Run: node scripts/test-upload-storage.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SRC = path.join(__dirname, '..', 'backend', 'src');
const store = require(path.join(SRC, 'services/uploadStorage'));

let failures = 0;
const ok = (label, cond, detail) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}${cond || detail === undefined ? '' : ` → ${detail}`}`);
};
const eq = (label, actual, expected) => ok(label, JSON.stringify(actual) === JSON.stringify(expected),
  `${JSON.stringify(actual)}, erwartet ${JSON.stringify(expected)}`);

const leise = { log() {}, warn() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'isms-upload-'));
const schreibe = (f, inhalt) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, inhalt); };
const lies = (f) => fs.readFileSync(f, 'utf8');
const da = (f) => fs.existsSync(f);
const eintrag = (name, inhalt) => ({ name, lesen: () => Buffer.from(inhalt) });

const altesUploadDir = process.env.UPLOAD_DIR;
const altesCwd = process.cwd();

// ---------------------------------------------------------------------------
console.log('Ablageort:');
{
  const t = tmp();
  process.env.UPLOAD_DIR = t;
  eq('UPLOAD_DIR bestimmt die Wurzel', store.uploadRoot(), path.resolve(t));
  ok('Richtlinien liegen unter der Wurzel',
    store.uploadSubdir(store.POLICIES_SUBDIR).startsWith(path.resolve(t) + path.sep));

  process.env.UPLOAD_DIR = 'relativ/uploads';
  ok('ein relativer UPLOAD_DIR wird zu einem absoluten Pfad', path.isAbsolute(store.uploadRoot()));

  delete process.env.UPLOAD_DIR;
  // Derselbe Rueckfall, den index.js und alle Routen bis 3.3.1 einzeln hatten.
  eq('ohne UPLOAD_DIR: backend/uploads', store.uploadRoot(), path.resolve(SRC, '..', 'uploads'));
}

// ---------------------------------------------------------------------------
console.log('Niemand berechnet den Ablageort selbst:');
// Die Ursache des Fehlers war ein zweiter, eigener Weg zum Ablageort. Diese
// Pruefung haelt fest, dass es bei einem bleibt.
{
  const dateien = [];
  const gehe = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) gehe(p);
      else if (e.name.endsWith('.js')) dateien.push(p);
    }
  };
  gehe(SRC);
  // Nur Code pruefen, keine Kommentare — sonst verbietet der Test, den alten
  // Fehler je zu beschreiben. Grob, aber ausreichend: Blockkommentare und
  // Zeilenkommentare, die nicht Teil einer URL sind ("https://").
  const ohneKommentare = (f) => fs.readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const eigeneBerechnung = dateien.filter((f) => /process\.env\.UPLOAD_DIR/.test(ohneKommentare(f)))
    .map((f) => path.relative(SRC, f));
  eq('process.env.UPLOAD_DIR wird nur in uploadStorage gelesen', eigeneBerechnung, [path.join('services', 'uploadStorage.js')]);

  const relativ = dateien.filter((f) => {
    const s = ohneKommentare(f);
    return /path\.resolve\(\s*['"`]uploads/.test(s) || /destination\s*:\s*['"`]uploads/.test(s);
  }).map((f) => path.relative(SRC, f));
  eq('kein Upload-Pfad relativ zum Arbeitsverzeichnis', relativ, []);
}

// ---------------------------------------------------------------------------
console.log('Was in eine Sicherung gehoert:');
{
  ok('ein Dokument', store.wirdGesichert('1727-vertrag.pdf'));
  ok('eine Richtlinie im Unterordner', store.wirdGesichert('policies/1727-richtlinie.pdf'));
  ok('NICHT das einmalige Admin-Passwort', !store.wirdGesichert('INITIAL_ADMIN_PASSWORD.txt'));
  ok('auch nicht in einem Unterordner', !store.wirdGesichert('irgendwo/INITIAL_ADMIN_PASSWORD.txt'));
  ok('ein leerer Pfad nicht', !store.wirdGesichert(''));

  const wurzel = tmp();
  const draussen = tmp();
  process.env.UPLOAD_DIR = wurzel;
  schreibe(path.join(wurzel, 'vertrag.pdf'), 'V');
  schreibe(path.join(wurzel, 'policies', 'richtlinie.pdf'), 'R');
  schreibe(path.join(wurzel, 'INITIAL_ADMIN_PASSWORD.txt'), 'geheim');
  schreibe(path.join(draussen, 'fremd.txt'), 'F');
  fs.symlinkSync(draussen, path.join(wurzel, 'link-nach-draussen'));

  const liste = store.sicherungsDateien().map((d) => d.rel).sort();
  eq('Dokument und Richtlinie sind drin, sonst nichts', liste, ['policies/richtlinie.pdf', 'vertrag.pdf']);
  ok('das Passwort ist nicht drin', !liste.some((r) => r.includes('INITIAL_ADMIN_PASSWORD')));
  ok('ein Link aus UPLOAD_DIR hinaus holt nichts herein', !liste.some((r) => r.includes('fremd')));

  process.env.UPLOAD_DIR = path.join(tmp(), 'gibt-es-nicht');
  eq('ein fehlender UPLOAD_DIR ergibt eine leere Liste statt eines Fehlers', store.sicherungsDateien(), []);
}

// ---------------------------------------------------------------------------
console.log('Wiederherstellung ueberlagert und loescht nie:');
{
  const wurzel = tmp();
  process.env.UPLOAD_DIR = wurzel;
  schreibe(path.join(wurzel, 'policies', 'bestand.pdf'), 'BESTAND');
  schreibe(path.join(wurzel, 'schon-da.pdf'), 'ALT');

  const b = store.dateienEinspielen([
    eintrag('uploads/neu.pdf', 'NEU'),
    eintrag('uploads/schon-da.pdf', 'AUS-SICHERUNG'),
    eintrag('uploads/policies/aus-sicherung.pdf', 'R'),
    eintrag('database.json', '{}'),
  ], { log: leise });

  ok('eine Datei, die nicht in der Sicherung ist, bleibt erhalten', lies(path.join(wurzel, 'policies', 'bestand.pdf')) === 'BESTAND');
  ok('eine Datei aus der Sicherung wird geschrieben', lies(path.join(wurzel, 'neu.pdf')) === 'NEU');
  ok('eine gleichnamige Datei bekommt den Stand der Sicherung', lies(path.join(wurzel, 'schon-da.pdf')) === 'AUS-SICHERUNG');
  ok('Unterordner werden angelegt', lies(path.join(wurzel, 'policies', 'aus-sicherung.pdf')) === 'R');
  eq('Eintraege ausserhalb von uploads/ werden nicht angefasst', b.geschrieben, 3);
}

{
  // Der Fall, der ohne die Aenderung an der Wiederherstellung zum Datenverlust
  // gefuehrt haette: Richtlinien sind nach UPLOAD_DIR umgezogen, dann wird eine
  // Sicherung von vor 3.3.2 eingespielt — die enthaelt keine Richtlinien.
  const t = tmp();
  const wurzel = path.join(t, 'uploads');
  const arbeit = path.join(t, 'backend');
  process.env.UPLOAD_DIR = wurzel;
  schreibe(path.join(arbeit, 'uploads', 'policies', '1727-isms-leitlinie.pdf'), 'LEITLINIE');
  schreibe(path.join(wurzel, 'vertrag.pdf'), 'V');
  process.chdir(arbeit);
  try {
    store.altlastenUmziehen({ log: leise });
  } finally {
    process.chdir(altesCwd);
  }
  ok('Vorbedingung: die Richtlinie ist umgezogen', da(path.join(wurzel, 'policies', '1727-isms-leitlinie.pdf')));

  store.dateienEinspielen([eintrag('uploads/vertrag.pdf', 'V')], { log: leise });
  ok('eine alte Sicherung ohne Richtlinien loescht die umgezogene Richtlinie NICHT',
    lies(path.join(wurzel, 'policies', '1727-isms-leitlinie.pdf')) === 'LEITLINIE');
}

console.log('Kein Weg aus UPLOAD_DIR hinaus:');
{
  const t = tmp();
  const wurzel = path.join(t, 'uploads');
  const draussen = path.join(t, 'draussen');
  fs.mkdirSync(wurzel, { recursive: true });
  fs.mkdirSync(draussen, { recursive: true });
  process.env.UPLOAD_DIR = wurzel;

  const gelesen = [];
  const beobachtet = (name, inhalt) => ({ name, lesen: () => { gelesen.push(name); return Buffer.from(inhalt); } });

  const b1 = store.dateienEinspielen([
    beobachtet('uploads/../draussen/ausbruch.txt', 'X'),
    beobachtet('uploads//etc/ausbruch.txt', 'X'),
    beobachtet('uploads/', 'X'),
  ], { log: leise });
  ok('../ fuehrt nicht hinaus', !da(path.join(draussen, 'ausbruch.txt')));
  eq('beide Ausbrueche abgewiesen', b1.abgewiesen, 2);
  eq('abgewiesene Eintraege werden gar nicht erst entpackt', gelesen, []);

  const b2 = store.dateienEinspielen([eintrag('uploads/INITIAL_ADMIN_PASSWORD.txt', 'alt')], { log: leise });
  ok('ein Passwort aus einer alten Sicherung kommt nicht zurueck', !da(path.join(wurzel, 'INITIAL_ADMIN_PASSWORD.txt')));
  eq('und wird als ausgelassen gezaehlt', b2.ausgelassen, 1);

  // Vor 3.3.2 raeumte das Leeren von UPLOAD_DIR vorhandene Links mit ab. Das
  // Ueberlagern darf deshalb nie durch einen Link schreiben.
  schreibe(path.join(draussen, 'ziel.txt'), 'UNBERUEHRT');
  fs.symlinkSync(path.join(draussen, 'ziel.txt'), path.join(wurzel, 'datei-link.txt'));
  const b3 = store.dateienEinspielen([eintrag('uploads/datei-link.txt', 'UEBERSCHRIEBEN')], { log: leise });
  ok('durch einen Datei-Link wird nicht geschrieben', lies(path.join(draussen, 'ziel.txt')) === 'UNBERUEHRT');
  eq('und der Eintrag ist abgewiesen', b3.abgewiesen, 1);

  fs.symlinkSync(draussen, path.join(wurzel, 'ordner-link'));
  const b4 = store.dateienEinspielen([eintrag('uploads/ordner-link/durchgereicht.txt', 'X')], { log: leise });
  ok('durch einen Ordner-Link wird nicht geschrieben', !da(path.join(draussen, 'durchgereicht.txt')));
  eq('und der Eintrag ist abgewiesen', b4.abgewiesen, 1);
}

// ---------------------------------------------------------------------------
console.log('Umzug von alten Ablageorten:');
{
  const t = tmp();
  const alt = path.join(t, 'backend', 'uploads', 'policies');
  process.env.UPLOAD_DIR = path.join(t, 'uploads');
  const neu = store.uploadSubdir('policies');
  const altlasten = [{ quelle: alt, ziel: 'policies' }];

  schreibe(path.join(alt, 'a.pdf'), 'A');
  schreibe(path.join(alt, 'unter', 'b.pdf'), 'B');
  schreibe(path.join(alt, 'konflikt.pdf'), 'ALTER-STAND');
  schreibe(path.join(neu, 'konflikt.pdf'), 'SCHON-AM-ZIEL');

  const b = store.altlastenUmziehen({ log: leise, altlasten });
  eq('zwei Dateien umgezogen', b.verschoben, 2);
  ok('Inhalt unveraendert', lies(path.join(neu, 'a.pdf')) === 'A');
  ok('Unterordner bleiben erhalten', lies(path.join(neu, 'unter', 'b.pdf')) === 'B');
  ok('die Quelle ist danach weg', !da(path.join(alt, 'a.pdf')));
  ok('am Ziel wird NICHTS ueberschrieben', lies(path.join(neu, 'konflikt.pdf')) === 'SCHON-AM-ZIEL');
  ok('die Konfliktdatei bleibt am alten Ort', lies(path.join(alt, 'konflikt.pdf')) === 'ALTER-STAND');
  eq('und wird gemeldet', b.konflikte.length, 1);
  ok('ein Ordner mit Konflikt bleibt stehen', da(alt));
  ok('ein leer gewordener Unterordner wird abgebaut', !da(path.join(alt, 'unter')));

  const zweiter = store.altlastenUmziehen({ log: leise, altlasten });
  eq('ein zweiter Lauf zieht nichts mehr um', zweiter.verschoben, 0);
}

{
  const t = tmp();
  const alt = path.join(t, 'backend', 'uploads', 'policies');
  process.env.UPLOAD_DIR = path.join(t, 'uploads');
  schreibe(path.join(alt, 'a.pdf'), 'A');
  store.altlastenUmziehen({ log: leise, altlasten: [{ quelle: alt, ziel: 'policies' }] });
  ok('ohne Konflikt verschwindet der alte Ordner ganz', !da(alt));
  ok('auch das leere uploads darueber', !da(path.dirname(alt)));
  ok('die Upload-Wurzel bleibt', da(store.uploadRoot()));
}

{
  // Docker: Arbeitsverzeichnis /app, UPLOAD_DIR /app/uploads — derselbe Ort.
  const t = tmp();
  process.env.UPLOAD_DIR = path.join(t, 'uploads');
  schreibe(path.join(t, 'uploads', 'policies', 'a.pdf'), 'A');
  const b = store.altlastenUmziehen({ log: leise, altlasten: [{ quelle: path.join(t, 'uploads', 'policies'), ziel: 'policies' }] });
  eq('gleicher Ort (Docker) ist ein No-op', b.verschoben, 0);
  ok('und laesst die Datei, wo sie ist', lies(path.join(t, 'uploads', 'policies', 'a.pdf')) === 'A');
}

{
  const t = tmp();
  process.env.UPLOAD_DIR = path.join(t, 'uploads', 'policies');
  schreibe(path.join(t, 'uploads', 'policies', 'a.pdf'), 'A');
  const b = store.altlastenUmziehen({ log: leise, altlasten: [{ quelle: path.join(t, 'uploads', 'policies'), ziel: 'policies' }] });
  eq('ineinanderliegende Orte werden uebersprungen', b.uebersprungen.length, 1);
  ok('ohne etwas anzufassen', lies(path.join(t, 'uploads', 'policies', 'a.pdf')) === 'A');
}

{
  const t = tmp();
  const alt = path.join(t, 'alt');
  process.env.UPLOAD_DIR = path.join(t, 'uploads');
  schreibe(path.join(t, 'fremd.txt'), 'F');
  fs.mkdirSync(alt, { recursive: true });
  fs.symlinkSync(path.join(t, 'fremd.txt'), path.join(alt, 'link.txt'));
  store.altlastenUmziehen({ log: leise, altlasten: [{ quelle: alt, ziel: 'policies' }] });
  ok('ein Link wird nicht umgezogen', !da(path.join(store.uploadSubdir('policies'), 'link.txt')));
  ok('und sein Ziel nicht angefasst', lies(path.join(t, 'fremd.txt')) === 'F');

  const b = store.altlastenUmziehen({ log: leise, altlasten: [{ quelle: path.join(t, 'gibt-es-nicht'), ziel: 'policies' }] });
  eq('ein fehlender alter Ort ist kein Fehler', b.verschoben, 0);
}

{
  // Der eingebaute alte Ort ist relativ zum Arbeitsverzeichnis — genau so, wie
  // routes/policies.js bis 3.3.1 gespeichert hat.
  const t = tmp();
  const arbeit = path.join(t, 'backend');
  process.env.UPLOAD_DIR = path.join(t, 'uploads');
  schreibe(path.join(arbeit, 'uploads', 'policies', 'x.pdf'), 'X');
  process.chdir(arbeit);
  let b;
  try { b = store.altlastenUmziehen({ log: leise }); } finally { process.chdir(altesCwd); }
  eq('der eingebaute alte Ort ist <Arbeitsverzeichnis>/uploads/policies', b.verschoben, 1);
  ok('Ziel ist UPLOAD_DIR/policies', lies(path.join(t, 'uploads', 'policies', 'x.pdf')) === 'X');
}

console.log('Verschieben ueber Dateisystemgrenzen:');
{
  const t = tmp();
  const echterLink = fs.linkSync;
  fs.linkSync = () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; };
  try {
    schreibe(path.join(t, 'q.pdf'), 'Q');
    eq('EXDEV: Rueckfall auf Kopieren', store._verschieben(path.join(t, 'q.pdf'), path.join(t, 'z.pdf')), 'verschoben');
    ok('Inhalt angekommen', lies(path.join(t, 'z.pdf')) === 'Q');
    ok('Quelle entfernt', !da(path.join(t, 'q.pdf')));

    schreibe(path.join(t, 'q2.pdf'), 'NEU');
    schreibe(path.join(t, 'z2.pdf'), 'ALT');
    eq('EXDEV mit belegtem Ziel: Konflikt statt Ueberschreiben', store._verschieben(path.join(t, 'q2.pdf'), path.join(t, 'z2.pdf')), 'konflikt');
    ok('Ziel unveraendert', lies(path.join(t, 'z2.pdf')) === 'ALT');
    ok('Quelle erhalten', lies(path.join(t, 'q2.pdf')) === 'NEU');
  } finally {
    fs.linkSync = echterLink;
  }
}

// ---------------------------------------------------------------------------
console.log('Vollstaendigkeit:');
(async () => {
  const wurzel = tmp();
  process.env.UPLOAD_DIR = wurzel;
  schreibe(path.join(wurzel, 'da.pdf'), 'x');
  schreibe(path.join(wurzel, 'policies', 'r-da.pdf'), 'x');
  schreibe(path.join(wurzel, 'vorlage-da.docx'), 'x');

  const modell = (zeilen) => ({ findAll: async () => zeilen });
  const v = await store.verweisePruefen({
    Document: modell([{ id: 1, filename: 'da.pdf' }, { id: 2, filename: 'fehlt.pdf' }]),
    Template: modell([{ id: 3, filename: 'vorlage-da.docx' }]),
    // file_url traegt die relative Form — gelesen wird nur der Dateiname.
    Policy: modell([{ id: 4, file_url: 'uploads/policies/r-da.pdf' }, { id: 5, file_url: null }]),
    PolicyVersion: modell([{ id: 6, file_url: 'uploads/policies/r-fehlt.pdf' }]),
  });
  eq('vier Verweise geprueft (ohne leere)', v.geprueft, 5);
  eq('zwei fehlen', v.fehlend, 2);
  eq('je Art gezaehlt', { d: v.je_art.document.fehlend, pv: v.je_art.policy_version.fehlend }, { d: 1, pv: 1 });
  eq('Beispiele nennen Art, id und Datei', v.beispiele.map((b) => `${b.art}#${b.id}:${b.datei}`).sort(),
    ['document#2:fehlt.pdf', 'policy_version#6:r-fehlt.pdf']);

  const nurEins = await store.verweisePruefen({ Document: modell([{ id: 1, filename: 'da.pdf' }]) });
  eq('fehlende Modelle werden uebergangen', nurEins.geprueft, 1);

  const viele = await store.verweisePruefen({
    Document: modell(Array.from({ length: 30 }, (_, i) => ({ id: i, filename: `weg-${i}.pdf` }))),
  });
  eq('Beispiele sind begrenzt', viele.beispiele.length, 20);
  eq('gezaehlt wird trotzdem alles', viele.fehlend, 30);
})().catch((e) => { failures++; console.log('  FAIL  Vollstaendigkeit:', e.message); })
  .finally(() => {
    if (altesUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = altesUploadDir;
    console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen.` : '\nAlle Pruefungen bestanden.');
    process.exit(failures ? 1 : 0);
  });
