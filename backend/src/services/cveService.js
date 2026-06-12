/**
 * CVE lookup service — three-tier matching strategy:
 *
 *   Phase 2  OSV.dev          package_name + package_ecosystem (open source, exact match)
 *   Phase 1  NVD CPE-based    asset.cpe + asset.version        (precise, version-aware)
 *   Phase 0  NVD keyword      asset.vendor / asset.name        (fallback, broad)
 *   Shodan   CVEDB            keyword fallback when NVD fails
 *
 * CPE format stored on asset: "cpe:2.3:a:vendor:product"  (no version — combined at query time)
 *
 * NVD API v2:   https://services.nvd.nist.gov/rest/json/cves/2.0
 *               https://services.nvd.nist.gov/rest/json/cpes/2.0
 * OSV.dev API:  https://api.osv.dev/v1/query  (no auth required)
 * Shodan CVEDB: https://cvedb.shodan.io       (no auth required)
 *
 * Optional env: NVD_API_KEY — increases NVD rate limit (50 req/30 s vs 10 req/30 s)
 */

'use strict';

const NVD_CVE_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const NVD_CPE_BASE = 'https://services.nvd.nist.gov/rest/json/cpes/2.0';
const OSV_BASE     = 'https://api.osv.dev/v1';
const SHODAN_BASE  = 'https://cvedb.shodan.io';

const MAX_CVES_STORED = 25;
const NVD_PAGE_SIZE   = 50;

const nvdInterval = () => (process.env.NVD_API_KEY ? 700 : 3200);
let _lastNvdCall = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}, ms = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function nvdThrottle() {
  const wait = nvdInterval() - (Date.now() - _lastNvdCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastNvdCall = Date.now();
}

function parseCvss(vuln) {
  const m = vuln.cve?.metrics || {};
  const src = m.cvssMetricV31?.[0]?.cvssData || m.cvssMetricV30?.[0]?.cvssData || m.cvssMetricV2?.[0]?.cvssData;
  if (!src) return { score: 0, severity: 'none' };
  return { score: src.baseScore || 0, severity: (src.baseSeverity || 'none').toLowerCase() };
}

function severityBucket(s) {
  if (s === 'critical') return 'critical';
  if (s === 'high')     return 'high';
  if (s === 'medium')   return 'medium';
  if (s === 'low')      return 'low';
  return null;
}

// ── Version comparison ────────────────────────────────────────────────────────

function parseVer(v) {
  return String(v || '0').split(/[.\-_+]/).map(s => parseInt(s, 10) || 0);
}

function cmpVer(a, b) {
  const pa = parseVer(a); const pb = parseVer(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Returns true if `version` is inside the version range described by a single
 * NVD cpeMatch object.  When no range bounds exist (criteria has an exact
 * version in field 5), an exact-equality check is performed.
 */
function cpeMatchAffects(match, version) {
  if (!match.vulnerable) return false;
  if (!version) return true;

  const { versionStartIncluding, versionStartExcluding, versionEndIncluding, versionEndExcluding } = match;
  const hasRange = versionStartIncluding || versionStartExcluding || versionEndIncluding || versionEndExcluding;

  if (!hasRange) {
    // Check the criteria string for an exact version at position [5]
    const parts = (match.criteria || '').split(':');
    const cpeVer = parts[5];
    if (cpeVer && cpeVer !== '*' && cpeVer !== '-') {
      return cmpVer(version, cpeVer) === 0;
    }
    return true; // wildcard version in criteria → product match only
  }

  if (versionStartIncluding && cmpVer(version, versionStartIncluding) < 0)  return false;
  if (versionStartExcluding && cmpVer(version, versionStartExcluding) <= 0) return false;
  if (versionEndIncluding   && cmpVer(version, versionEndIncluding)   > 0)  return false;
  if (versionEndExcluding   && cmpVer(version, versionEndExcluding)   >= 0) return false;
  return true;
}

function vulnAffectsVersion(vuln, version) {
  if (!version) return true;
  const configs = vuln.cve?.configurations || [];
  if (!configs.length) return true; // no config data → include (conservative)

  const checkNode = (node) => {
    for (const m of (node.cpeMatch || [])) {
      if (cpeMatchAffects(m, version)) return true;
    }
    for (const child of (node.children || [])) {
      if (checkNode(child)) return true;
    }
    return false;
  };

  for (const cfg of configs) {
    for (const node of (cfg.nodes || [])) {
      if (checkNode(node)) return true;
    }
  }
  return false;
}

// ── NVD — keyword search (Phase 0 / fallback) ─────────────────────────────

function buildSearchQuery(asset) {
  if (asset.cve_search_query?.trim().length >= 3) return asset.cve_search_query.trim();

  const vendor  = (asset.vendor  || '').trim();
  const name    = (asset.name    || '').trim();
  const version = (asset.version || '').trim();

  const skipTypes = new Set(['information', 'process', 'personal', 'data', 'other']);
  if (skipTypes.has(asset.type)) return null;

  if (vendor && version) return `${vendor} ${version}`;
  if (vendor)            return vendor;
  if (name   && version) return `${name} ${version}`;
  if (name   && name.length >= 4) return name;
  return null;
}

async function queryNVDKeyword(query) {
  await nvdThrottle();
  const url = new URL(NVD_CVE_BASE);
  url.searchParams.set('keywordSearch', query);
  url.searchParams.set('resultsPerPage', String(NVD_PAGE_SIZE));
  if (process.env.NVD_API_KEY) url.searchParams.set('apiKey', process.env.NVD_API_KEY);
  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`NVD HTTP ${res.status}`);
  return res.json();
}

function parseNVDResponse(data, query, source = 'nvd', version = null) {
  const counts  = { critical: 0, high: 0, medium: 0, low: 0 };
  const cveList = [];

  for (const v of (data.vulnerabilities || [])) {
    if (version && !vulnAffectsVersion(v, version)) continue;

    const id                 = v.cve?.id || '?';
    const { score, severity} = parseCvss(v);
    const bucket             = severityBucket(severity);
    if (bucket) counts[bucket]++;

    const description = v.cve?.descriptions?.find(d => d.lang === 'en')?.value || '';
    const published   = v.cve?.published?.slice(0, 10) || '';

    if (cveList.length < MAX_CVES_STORED) {
      cveList.push({ id, severity: bucket || 'none', score, description: description.slice(0, 300), published, source });
    }
  }

  cveList.sort((a, b) => b.score - a.score);
  return { counts, cveList, total: data.totalResults || 0, source, query };
}

// ── NVD — CPE resolution (Phase 1, step A) ───────────────────────────────────

/**
 * Queries NVD CPE dictionary and returns { cpe, title } for the best match.
 *   cpe   — base CPE without version: "cpe:2.3:a:vendor:product"
 *   title — human-readable name from NVD, e.g. "Notepad++"
 */
async function resolveCPEForAsset(asset) {
  const suggestions = await suggestCPEsForAsset(asset);
  return suggestions.length ? suggestions[0] : null;
}

/**
 * Returns up to 10 ranked CPE suggestions for an asset from the NVD CPE dictionary.
 * Each entry: { cpe, title }. Best match first.
 */
async function suggestCPEsForAsset(asset) {
  const terms = [asset.vendor, asset.name].filter(Boolean).join(' ').trim();
  if (terms.length < 3) return [];

  await nvdThrottle();

  const url = new URL(NVD_CPE_BASE);
  url.searchParams.set('keywordSearch', terms);
  url.searchParams.set('resultsPerPage', '10');
  if (process.env.NVD_API_KEY) url.searchParams.set('apiKey', process.env.NVD_API_KEY);

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`NVD CPE HTTP ${res.status}`);
  const data = await res.json();

  const products = data.products || [];
  if (!products.length) return [];

  const tokens = terms.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1);

  const scored = products.map(p => {
    const cpeName = p.cpe?.cpeName || '';
    const score = tokens.filter(t => cpeName.toLowerCase().includes(t)).length;
    const parts = cpeName.split(':');
    if (parts.length < 5) return null;
    const baseCpe = parts.slice(0, 5).join(':');
    const titles = p.cpe?.titles || [];
    const enTitle = titles.find(t => t.lang === 'en')?.title || titles[0]?.title;
    const rawTitle = enTitle || parts[4].replace(/[-_]/g, ' ');
    const cleanTitle = rawTitle.length <= 254 ? rawTitle.replace(/\s+\d+(?:\.\d+)*\s*$/, '') : rawTitle;
    const title = cleanTitle.trim() || rawTitle;
    return { cpe: baseCpe, title, score };
  }).filter(Boolean);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ cpe, title }) => ({ cpe, title }));
}

// ── NVD — CPE-based CVE query (Phase 1, step B) ──────────────────────────────

async function queryCVEsByCPE(cpe, version) {
  await nvdThrottle();

  // Append version if known, so NVD does server-side version filtering
  const cpeFull = version
    ? `${cpe}:${version}:*:*:*:*:*:*:*`
    : `${cpe}:*:*:*:*:*:*:*:*`;

  const url = new URL(NVD_CVE_BASE);
  url.searchParams.set('cpeName', cpeFull);
  url.searchParams.set('resultsPerPage', String(NVD_PAGE_SIZE));
  if (process.env.NVD_API_KEY) url.searchParams.set('apiKey', process.env.NVD_API_KEY);

  const res = await fetchWithTimeout(url.toString());
  if (!res.ok) throw new Error(`NVD CPE query HTTP ${res.status}`);
  return res.json();
}

// ── OSV.dev (Phase 2) ────────────────────────────────────────────────────────

function extractOSVScore(vuln) {
  // Prefer numeric CVSS from GitHub Advisory db_specific block
  const ghScore = vuln.database_specific?.cvss?.score;
  if (ghScore) return Number(ghScore);

  // Map string severity → approximate score
  const strSev = (
    vuln.database_specific?.severity ||
    vuln.affected?.[0]?.ecosystem_specific?.severity ||
    ''
  ).toUpperCase();
  if (strSev === 'CRITICAL') return 9.5;
  if (strSev === 'HIGH')     return 8.0;
  if (strSev === 'MODERATE') return 5.0;
  if (strSev === 'LOW')      return 2.0;
  return 0;
}

async function queryOSV(packageName, ecosystem, version) {
  const body = version
    ? { version, package: { name: packageName, ecosystem } }
    : { package: { name: packageName, ecosystem } };

  const res = await fetchWithTimeout(`${OSV_BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
  return res.json();
}

function parseOSVResponse(data, query) {
  const counts  = { critical: 0, high: 0, medium: 0, low: 0 };
  const cveList = [];

  for (const vuln of (data.vulns || [])) {
    const score    = extractOSVScore(vuln);
    const severity = score >= 9.0 ? 'critical' : score >= 7.0 ? 'high' : score >= 4.0 ? 'medium' : score > 0 ? 'low' : null;
    if (severity) counts[severity]++;

    // Prefer the canonical CVE alias; fall back to OSV ID (GHSA-... etc.)
    const id          = vuln.aliases?.find(a => a.startsWith('CVE-')) || vuln.id || '?';
    const description = (vuln.details || vuln.summary || '').slice(0, 300);
    const published   = (vuln.published || '').slice(0, 10);

    if (cveList.length < MAX_CVES_STORED) {
      cveList.push({ id, severity: severity || 'none', score, description, published, source: 'osv' });
    }
  }

  cveList.sort((a, b) => b.score - a.score);
  return { counts, cveList, total: data.vulns?.length || 0, source: 'osv', query };
}

// ── Shodan CVEDB (last-resort fallback) ──────────────────────────────────────

async function queryShodan(query) {
  const product = query.split(' ')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (product.length < 3) throw new Error('product too short for Shodan');

  const url = `${SHODAN_BASE}/cves?product=${encodeURIComponent(product)}&count=true`;
  const res  = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Shodan HTTP ${res.status}`);
  const data = await res.json();

  const counts  = { critical: 0, high: 0, medium: 0, low: 0 };
  const cveList = [];

  for (const cve of (data.cves || []).slice(0, NVD_PAGE_SIZE)) {
    const score    = Number(cve.cvss || cve.cvss_v3 || 0);
    const severity = score >= 9.0 ? 'critical' : score >= 7.0 ? 'high' : score >= 4.0 ? 'medium' : score > 0 ? 'low' : null;
    if (severity) counts[severity]++;
    if (cveList.length < MAX_CVES_STORED) {
      cveList.push({ id: cve.cve_id || '?', severity: severity || 'none', score, description: (cve.summary || '').slice(0, 300), published: (cve.published_time || '').slice(0, 10), source: 'shodan' });
    }
  }

  cveList.sort((a, b) => b.score - a.score);
  return { counts, cveList, total: data.total || 0, source: 'shodan', query };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main entry point. Resolution priority:
 *   1. OSV.dev  — if package_name + package_ecosystem are set
 *   2. NVD CPE  — if asset.cpe is set (resolved or manually entered)
 *   3. NVD keyword — vendor/name/version text search
 *   4. Shodan   — fallback when NVD is unreachable
 *
 * Returns null when the asset type or data don't support a meaningful search.
 */
async function fetchCVEsForAsset(asset) {
  const skipTypes = new Set(['information', 'process', 'personal', 'data', 'other']);
  if (skipTypes.has(asset.type)) return null;

  // Phase 2: OSV.dev — open source package matching (most precise)
  if (asset.package_name && asset.package_ecosystem) {
    try {
      const data = await queryOSV(asset.package_name, asset.package_ecosystem, asset.version || null);
      if ((data.vulns || []).length > 0) {
        return parseOSVResponse(data, `${asset.package_ecosystem}:${asset.package_name}`);
      }
    } catch (e) {
      console.warn(`[CVE] OSV failed for ${asset.package_ecosystem}:${asset.package_name}: ${e.message}`);
    }
  }

  // Phase 1: NVD CPE-based matching
  if (asset.cpe) {
    try {
      const data = await queryCVEsByCPE(asset.cpe, asset.version || null);
      // Client-side version filter as belt-and-suspenders
      const parsed = parseNVDResponse(data, asset.cpe, 'nvd-cpe', asset.version || null);
      if (parsed.total > 0 || parsed.cveList.length > 0) return parsed;
    } catch (e) {
      console.warn(`[CVE] NVD CPE query failed for ${asset.cpe}: ${e.message}`);
    }
  }

  // Phase 0: NVD keyword search
  const query = buildSearchQuery(asset);
  if (!query) return null;

  try {
    const data = await queryNVDKeyword(query);
    return parseNVDResponse(data, query, 'nvd', asset.version || null);
  } catch (nvdErr) {
    console.warn(`[CVE] NVD keyword failed for "${query}": ${nvdErr.message}. Trying Shodan…`);
    try {
      return await queryShodan(query);
    } catch (shodanErr) {
      throw new Error(`NVD: ${nvdErr.message} | Shodan: ${shodanErr.message}`);
    }
  }
}

module.exports = { fetchCVEsForAsset, buildSearchQuery, resolveCPEForAsset, suggestCPEsForAsset };
