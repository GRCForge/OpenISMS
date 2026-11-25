#!/usr/bin/env node
// Builds the GitHub wiki from the repository.
//
// The wiki is not edited on GitHub. Its sources live in the repository so that
// documentation changes are reviewed like code and never drift apart:
//
//   wiki/*.md              pages that exist only in the wiki (Home, FAQ, ...)
//   docs/*.md, SECURITY.md,
//   CONTRIBUTING.md        published as wiki pages under the names in PAGES
//   docs/RELEASE-NOTES-*   one page per release plus a generated index
//
// Links are rewritten for the wiki: a link to a published file becomes a link
// to its page (anchors included), a link to any other repository file becomes
// an absolute GitHub URL. A link to a file that does not exist, or to an anchor
// that does not exist on the target page, fails the build — this is what keeps
// the wiki honest when a document is renamed or restructured.
//
// Usage:
//   node scripts/build-wiki.js [outDir]   write the wiki to outDir (default build/wiki)
//   node scripts/build-wiki.js --check    validate only, write nothing

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = process.env.GITHUB_REPOSITORY || 'GRCForge/OpenISMS';
const BRANCH = 'main';
const BLOB = `https://github.com/${REPO}/blob/${BRANCH}/`;
const TREE = `https://github.com/${REPO}/tree/${BRANCH}/`;
const RAW = `https://github.com/${REPO}/raw/${BRANCH}/`;

// Repository file → wiki page name. Page names become URLs, so they use hyphens.
const PAGES = {
  'docs/FEATURES.md': 'Features',
  'docs/CONFIGURATION.md': 'Installation-and-Configuration',
  'docs/SECURITY-CONFIGURATION.md': 'Security-Configuration',
  'docs/MCP.md': 'MCP-Integration',
  'docs/TRANSLATION_STYLEGUIDE.md': 'Translation-Style-Guide',
  'SECURITY.md': 'Security-Policy',
  'CONTRIBUTING.md': 'Contributing',
};

const WIKI_DIR = path.join(ROOT, 'wiki');
const DOCS_DIR = path.join(ROOT, 'docs');
const RELEASE_RE = /^RELEASE-NOTES-v(.+)\.md$/;

const errors = [];

// GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens.
function slug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\- _]/gu, '')
    .replace(/ /g, '-');
}

// Splits markdown into code and prose so that links inside fenced code blocks
// and inline code are left alone.
function mapProse(md, fn) {
  return md
    .split(/(^```[\s\S]*?^```[^\n]*$)/m)
    .map((block, i) => {
      if (i % 2 === 1) return block;
      return block
        .split(/(`[^`\n]*`)/)
        .map((part, j) => (j % 2 === 1 ? part : fn(part)))
        .join('');
    })
    .join('');
}

function anchorsOf(md) {
  const anchors = new Set();
  const counts = {};
  mapProse(md, (prose) => {
    for (const line of prose.split('\n')) {
      const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (!m) continue;
      const base = slug(m[1]);
      const n = counts[base] || 0;
      counts[base] = n + 1;
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    return prose;
  });
  return anchors;
}

function versionKey(v) {
  // "3.3.10" sorts after "3.3.9"; ranges such as "2.2.29-v2.2.31" use their first version.
  return v.split(/[^0-9]+/).filter(Boolean).slice(0, 3).map(Number);
}

function compareVersionsDesc(a, b) {
  const ka = versionKey(a);
  const kb = versionKey(b);
  for (let i = 0; i < 3; i++) {
    if ((kb[i] || 0) !== (ka[i] || 0)) return (kb[i] || 0) - (ka[i] || 0);
  }
  return 0;
}

function collectSources() {
  const pages = []; // { name, source (repo-relative or null), content }

  for (const [rel, name] of Object.entries(PAGES)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`${rel}: listed in PAGES but missing`);
      continue;
    }
    pages.push({ name, source: rel, content: fs.readFileSync(abs, 'utf8') });
  }

  const releases = fs
    .readdirSync(DOCS_DIR)
    .map((f) => ({ file: f, m: RELEASE_RE.exec(f) }))
    .filter((r) => r.m)
    .map((r) => ({ file: r.file, version: r.m[1] }))
    .sort((a, b) => compareVersionsDesc(a.version, b.version));

  const index = ['# Release Notes', '', 'Every release of OpenISMS, newest first. Each release is also published on the', `[GitHub releases page](https://github.com/${REPO}/releases) together with its packages and SBOMs.`, '', '| Version | Summary |', '|---|---|'];
  for (const r of releases) {
    const rel = `docs/${r.file}`;
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const title = (/^#\s+(.*)$/m.exec(content) || [, r.version])[1];
    // Table cell: escape backslashes first, then pipes, so "\|" in a title stays literal.
    const summary = title
      .replace(/^OpenISMS\s+v?[\w.-]+\s*[—–-]\s*/, '')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|');
    const name = `Release-Notes-v${r.version}`;
    PAGES[rel] = name;
    pages.push({ name, source: rel, content });
    index.push(`| [v${r.version}](${name}) | ${summary} |`);
  }
  pages.push({ name: 'Release-Notes', source: null, content: index.join('\n') + '\n' });

  for (const f of fs.readdirSync(WIKI_DIR).filter((x) => x.endsWith('.md')).sort()) {
    const name = f.replace(/\.md$/, '');
    if (pages.some((p) => p.name === name)) errors.push(`wiki/${f}: page name collides with a generated page`);
    pages.push({ name, source: `wiki/${f}`, content: fs.readFileSync(path.join(WIKI_DIR, f), 'utf8') });
  }
  return pages;
}

function rewrite(page, pageNames, anchorsByPage) {
  const where = page.source || page.name;
  const baseDir = page.source ? path.posix.dirname(page.source) : '.';

  return mapProse(page.content, (prose) =>
    prose.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (all, bang, text, target, title = '') => {
      if (/^(https?:|mailto:)/i.test(target)) return all;

      const [rawPath, anchor] = target.split('#');

      // Same-page anchor.
      if (!rawPath) {
        if (anchor && !anchorsByPage[page.name].has(anchor)) errors.push(`${where}: missing anchor #${anchor}`);
        return all;
      }

      // A wiki page referenced by name (only meaningful in wiki/ sources).
      if (page.source === null || page.source.startsWith('wiki/')) {
        if (pageNames.has(rawPath)) {
          if (anchor && !anchorsByPage[rawPath].has(anchor)) errors.push(`${where}: missing anchor ${rawPath}#${anchor}`);
          return all;
        }
      }

      const resolved = path.posix.normalize(path.posix.join(baseDir, rawPath)).replace(/\/$/, '');
      if (resolved.startsWith('..')) {
        // Repository-relative GitHub links such as ../../security/advisories/new.
        const url = `https://github.com/${REPO}/${resolved.replace(/^(\.\.\/)+/, '')}`;
        return `${bang}[${text}](${url}${anchor ? '#' + anchor : ''}${title})`;
      }

      if (PAGES[resolved]) {
        const target = PAGES[resolved];
        if (anchor && !anchorsByPage[target].has(anchor)) errors.push(`${where}: missing anchor ${resolved}#${anchor}`);
        // "CONFIGURATION.md" reads oddly in a wiki; show the page title instead.
        const label = /^[\w./-]+\.md$/.test(text) ? target.replace(/-/g, ' ') : text;
        return `${bang}[${label}](${target}${anchor ? '#' + anchor : ''}${title})`;
      }

      const abs = path.join(ROOT, resolved);
      if (!fs.existsSync(abs)) {
        errors.push(`${where}: link to missing file ${target}`);
        return all;
      }
      if (resolved === 'docs') return `${bang}[${text}](Release-Notes${title})`;
      const isDir = fs.statSync(abs).isDirectory();
      const base = bang ? RAW : isDir ? TREE : BLOB;
      return `${bang}[${text}](${base}${resolved}${anchor ? '#' + anchor : ''}${title})`;
    })
  );
}

function build() {
  const pages = collectSources();
  const pageNames = new Set(pages.map((p) => p.name));
  const anchorsByPage = Object.fromEntries(pages.map((p) => [p.name, anchorsOf(p.content)]));

  const out = pages.map((page) => {
    let content = rewrite(page, pageNames, anchorsByPage);
    if (page.source && !page.source.startsWith('wiki/')) {
      content = `<!-- Generated from ${page.source} by scripts/build-wiki.js. Edit the source file, not this page. -->\n\n${content}`;
    }
    return { name: page.name, content };
  });

  for (const required of ['Home', '_Sidebar', '_Footer']) {
    if (!pageNames.has(required)) errors.push(`wiki/${required}.md is missing`);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const outDir = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'build/wiki');

  const pages = build();

  if (errors.length) {
    console.error(`Wiki build failed with ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (check) {
    console.log(`Wiki OK: ${pages.length} pages, all links and anchors resolve.`);
    return;
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const p of pages) fs.writeFileSync(path.join(outDir, `${p.name}.md`), p.content);
  console.log(`Wiki written to ${path.relative(ROOT, outDir)}: ${pages.length} pages.`);
}

main();
