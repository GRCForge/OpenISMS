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
  if (fs.existsSync(file.path)) {
    const original = fs.readFileSync(file.path, 'utf8');
    const updated = file.updater(original);
    if (original !== updated) {
      fs.writeFileSync(file.path, updated, 'utf8');
      console.log(`[Version Sync] Updated ${path.relative(rootDir, file.path)}`);
      changed = true;
    }
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
