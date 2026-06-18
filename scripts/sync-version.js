const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

if (changed) {
  console.log('[Version Sync] Updating package-lock.json files...');
  try {
    execSync('npm install --package-lock-only', { cwd: path.join(rootDir, 'frontend'), stdio: 'inherit' });
    execSync('npm install --package-lock-only', { cwd: path.join(rootDir, 'backend'), stdio: 'inherit' });
    console.log('[Version Sync] Synchronizing complete!');
  } catch (err) {
    console.error('[Version Sync] Error updating package-lock.json files:', err.message);
  }
} else {
  console.log('[Version Sync] All version numbers are already synchronized.');
}
