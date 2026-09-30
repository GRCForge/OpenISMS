const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const versionPath = path.join(rootDir, 'VERSION');

if (!fs.existsSync(versionPath)) {
  console.warn(`[Version Sync] VERSION file not found at ${versionPath}. Skipping sync.`);
  process.exit(0);
}

const version = fs.readFileSync(versionPath, 'utf8').trim();
console.log(`[Version Sync] Synchronizing version ${version}...`);

const filesToUpdate = [
  {
    path: path.join(rootDir, 'frontend/package.json'),
    updater: (content) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    }
  },
  {
    path: path.join(rootDir, 'backend/package.json'),
    updater: (content) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + '\n';
    }
  },
  {
    path: path.join(rootDir, 'backend/src/openapi.json'),
    updater: (content) => {
      const json = JSON.parse(content);
      if (json.info) {
        json.info.version = version;
      }
      return JSON.stringify(json, null, 2) + '\n';
    }
  }
];

let changed = false;
for (const file of filesToUpdate) {
  // Use a single open file descriptor for the entire read-compare-write cycle to
  // avoid the TOCTOU race between existsSync/readFileSync and writeFileSync
  // (CodeQL js/file-system-race).
  let fd;
  try {
    fd = fs.openSync(file.path, 'r+');
  } catch {
    continue; // file doesn't exist — skip
  }
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    const original = buf.toString('utf8');
    const updated = file.updater(original);
    if (original !== updated) {
      const out = Buffer.from(updated, 'utf8');
      fs.ftruncateSync(fd, 0);
      fs.writeSync(fd, out, 0, out.length, 0);
      console.log(`[Version Sync] Updated ${path.relative(rootDir, file.path)}`);
      changed = true;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Die Versionsnummer im Lockfile nachziehen — und sonst nichts.
 *
 * Hier stand frueher `npm install --package-lock-only`. Das loest den
 * gesamten Abhaengigkeitsbaum neu auf, mit der npm-Version, die gerade
 * lokal installiert ist. Weicht die von der in der CI ab, schreibt sie das
 * Lockfile um: Beim Bump auf 3.3.1 verschwanden so die libc-Felder der
 * plattformabhaengigen Pakete aus frontend/package-lock.json, weil npm 10
 * sie nicht kennt und npm 11 sie setzt. Ein Versionsbump darf keine
 * Abhaengigkeiten anfassen.
 *
 * Betroffen sind genau zwei Felder: die Wurzel und packages[""]. Ein
 * JSON-Round-Trip mit zwei Leerzeichen Einrueckung und abschliessendem
 * Zeilenumbruch gibt exakt das aus, was npm selbst schreibt — geprueft,
 * byte-identisch. Wer das hier wieder auf npm umstellt, holt sich den
 * Lockfile-Schaden zurueck.
 */
const syncLockfile = (dir) => {
  const lockPath = path.join(rootDir, dir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) return false;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.version === version && lock.packages?.['']?.version === version) return false;
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return true;
};

if (changed) {
  console.log('[Version Sync] Updating package-lock.json files...');
  try {
    for (const dir of ['frontend', 'backend']) {
      console.log(`[Version Sync]   ${dir}/package-lock.json: ${syncLockfile(dir) ? 'updated' : 'already current'}`);
    }
    console.log('[Version Sync] Synchronizing complete!');
  } catch (err) {
    console.error('[Version Sync] Error updating package-lock.json files:', err.message);
    process.exitCode = 1;
  }
} else {
  console.log('[Version Sync] All version numbers are already synchronized.');
}
