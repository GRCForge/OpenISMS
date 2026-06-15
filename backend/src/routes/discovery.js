'use strict';

const router  = require('express').Router();
const { heavyLimiter } = require('../middleware/rateLimiter');
router.use(heavyLimiter);
const net     = require('net');
const dns     = require('dns').promises;
const http    = require('http');
const https   = require('https');
const { Op }  = require('sequelize');
const { Asset, User, DiscoveredSoftware } = require('../models');
const { authenticate, requireRole, requireWriteAccess } = require('../middleware/auth');

// ── Port → service map ────────────────────────────────────────────────────────

const PORT_SERVICES = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS',
  80: 'HTTP', 110: 'POP3', 111: 'RPC', 135: 'MSRPC', 139: 'NetBIOS', 143: 'IMAP',
  161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 514: 'Syslog',
  587: 'SMTP-TLS', 636: 'LDAPS', 873: 'rsync',
  902: 'VMware', 993: 'IMAP-TLS', 995: 'POP3-TLS',
  1433: 'MSSQL', 1521: 'Oracle', 1883: 'MQTT', 2049: 'NFS',
  3000: 'Dev-HTTP', 3306: 'MySQL', 3389: 'RDP', 4848: 'GlassFish',
  5432: 'PostgreSQL', 5672: 'AMQP', 5900: 'VNC', 5985: 'WinRM-HTTP', 5986: 'WinRM-HTTPS',
  6379: 'Redis', 6443: 'K8s-API', 7001: 'WebLogic', 7474: 'Neo4j',
  8006: 'Proxmox-UI', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 8888: 'Jupyter', 9090: 'Prometheus',
  9200: 'Elasticsearch', 9300: 'ES-Transport', 15672: 'RabbitMQ-Mgmt',
  27017: 'MongoDB', 50000: 'SAP',
};

const DEFAULT_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 389, 443, 445, 636,
  993, 995, 1433, 1521, 2049, 3306, 3389, 5432, 5900, 5985, 5986,
  6379, 6443, 8006, 8080, 8443, 8888, 9090, 9200, 27017,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPrivateIP(ip) {
  if (typeof ip !== 'string' || !net.isIPv4(ip)) {
    return false;
  }
  const p = ip.split('.').map(Number);
  // RFC-1918 only. Loopback (127/8), link-local (169.254/16, incl. cloud
  // metadata) and all other ranges are intentionally excluded so the sweep
  // can never probe server-internal services or the metadata endpoint.
  return (p[0] === 10) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168);
}

// Escape LIKE metacharacters so a software/host name containing % or _ is
// matched literally instead of as a wildcard (default MySQL escape char: \).
function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, c => `\\${c}`);
}

const MAX_PORTS_PER_SCAN = 50;
const MAX_IMPORT_HOSTS   = 254;

function cidrToIPs(cidr) {
  if (typeof cidr !== 'string') {
    throw new Error('Ungültiger CIDR-Block');
  }
  const [base, prefix] = cidr.split('/');
  const plen = parseInt(prefix ?? '32', 10);
  if (isNaN(plen) || plen < 16 || plen > 32) {
    throw new Error('CIDR-Präfix muss /16 bis /32 sein');
  }
  if (!net.isIPv4(base)) {
    throw new Error('Ungültige IP-Adresse');
  }
  const parts = base.split('.').map(Number);
  const baseInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask    = plen === 32 ? 0xFFFFFFFF : (~(0xFFFFFFFF >>> plen)) >>> 0;
  const netInt  = (baseInt & mask) >>> 0;
  const count   = Math.pow(2, 32 - plen);
  const ips     = [];
  for (let i = 1; i < count - 1; i++) {
    const n = (netInt + i) >>> 0;
    ips.push(`${(n >>> 24) & 0xFF}.${(n >>> 16) & 0xFF}.${(n >>> 8) & 0xFF}.${n & 0xFF}`);
  }
  return ips;
}

async function tcpProbe(host, port, ms = 800) {
  if (typeof host !== 'string' || !net.isIPv4(host) || !isPrivateIP(host)) {
    return false;
  }
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return false;
  }
  const timeoutMs = Number(ms);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    return false;
  }
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (open) => { if (!done) { done = true; sock.destroy(); resolve(open); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout',  () => finish(false));
    sock.once('error',    () => finish(false));
    sock.connect(parsedPort, host);
  });
}

async function reverseDNS(ip) {
  if (typeof ip !== 'string' || !net.isIPv4(ip) || !isPrivateIP(ip)) {
    return null;
  }
  try { const [name] = await dns.reverse(ip); return name; } catch { return null; }
}

async function getHttpSignature(ip, port, useHttps = false) {
  if (typeof ip !== 'string' || !net.isIPv4(ip) || !isPrivateIP(ip)) {
    return null;
  }
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return null;
  }
  return new Promise(resolve => {
    const lib = useHttps ? https : http;
    const req = lib.request({
      host: ip,
      port: parsedPort,
      path: '/',
      method: 'GET',
      timeout: 600,
      rejectUnauthorized: false, // intentional: LAN devices routinely use self-signed certs; probes are read-only fingerprinting of private IPs only
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 2000) req.destroy();
      });
      res.on('end', () => {
        resolve({
          headers: res.headers,
          body: body
        });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getSshBanner(ip, timeout = 600) {
  if (typeof ip !== 'string' || !net.isIPv4(ip) || !isPrivateIP(ip)) {
    return null;
  }
  const timeoutMs = Number(timeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    return null;
  }
  return new Promise(resolve => {
    const client = new net.Socket();
    let resolved = false;
    client.setTimeout(timeoutMs);
    client.on('data', data => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        resolve(data.toString('utf8').trim());
      }
    });
    client.on('error', () => { if (!resolved) { resolved = true; resolve(null); } });
    client.on('timeout', () => { if (!resolved) { resolved = true; client.destroy(); resolve(null); } });
    client.connect(22, ip);
  });
}

async function detectHostSystem(ip, openPorts) {
  let os = null;
  let version = null;
  let vendor = null;

  const ports = openPorts.map(p => p.port);

  // 1. Proxmox VE via Port 8006
  if (ports.includes(8006)) {
    const sig = await getHttpSignature(ip, 8006, true);
    if (sig && (sig.body.includes('Proxmox') || sig.body.includes('pve') || String(sig.headers.server).includes('pve'))) {
      os = 'Proxmox Virtual Environment';
      vendor = 'Proxmox Server Solutions GmbH';
      
      const verMatch = sig.body.match(/Virtual Environment\s+([0-9.]+)/i);
      if (verMatch) version = verMatch[1];
      
      return { os, version, vendor };
    }
  }

  // 2. UniFi Controller / Device via Port 8443 or 8080
  if (ports.includes(8443)) {
    const sig = await getHttpSignature(ip, 8443, true);
    if (sig && (sig.body.toLowerCase().includes('unifi') || sig.body.toLowerCase().includes('ubiquiti'))) {
      os = 'UniFi Controller';
      vendor = 'Ubiquiti Inc.';
      return { os, version, vendor };
    }
  }

  // 3. HTTP / HTTPS (80, 443)
  for (const port of [80, 443]) {
    if (ports.includes(port)) {
      const sig = await getHttpSignature(ip, port, port === 443);
      if (sig) {
        const bodyLower = sig.body.toLowerCase();
        const serverHeader = String(sig.headers.server || '').toLowerCase();

        if (bodyLower.includes('unraid')) {
          os = 'Unraid OS';
          vendor = 'Lime Technology, Inc.';
          
          const verMatch = sig.body.match(/unraid\s+os\s+([0-9.]+)/i);
          if (verMatch) version = verMatch[1];
          
          return { os, version, vendor };
        }
        if (bodyLower.includes('unifi') || bodyLower.includes('ubiquiti')) {
          os = 'UniFi Device / Controller';
          vendor = 'Ubiquiti Inc.';
          return { os, version, vendor };
        }
        if (serverHeader.includes('synology') || bodyLower.includes('synology')) {
          os = 'Synology DSM';
          vendor = 'Synology Inc.';
          return { os, version, vendor };
        }
        if (bodyLower.includes('opnsense')) {
          os = 'OPNsense';
          vendor = 'Deciso B.V.';
          return { os, version, vendor };
        }
        if (bodyLower.includes('pfsense')) {
          os = 'pfSense';
          vendor = 'Netgate';
          return { os, version, vendor };
        }
        if (bodyLower.includes('portainer')) {
          os = 'Portainer';
          vendor = 'Portainer.io';
          return { os, version, vendor };
        }
      }
    }
  }

  // 4. SSH Banner (22) fallback
  if (ports.includes(22)) {
    const banner = await getSshBanner(ip);
    if (banner) {
      if (banner.toLowerCase().includes('pve')) {
        os = 'Proxmox Virtual Environment';
        vendor = 'Proxmox Server Solutions GmbH';
      } else if (banner.toLowerCase().includes('slackware')) {
        os = 'Slackware Linux (Unraid)';
        vendor = 'Lime Technology, Inc.';
      } else if (banner.toLowerCase().includes('ubuntu')) {
        os = 'Ubuntu Linux';
      } else if (banner.toLowerCase().includes('debian')) {
        os = 'Debian GNU/Linux';
      }

      const match = banner.match(/OpenSSH_([a-zA-Z0-9.]+)/);
      if (match) {
        version = `SSH: OpenSSH ${match[1]}`;
      }
    }
  }

  return { os, version, vendor };
}

// ── Download discovery agent script ──────────────────────────────────────────

router.get('/agent', authenticate, requireRole('admin', 'it-staff'), (req, res) => {
  const platform = (req.query.platform || 'windows').toLowerCase();
  const appUrl   = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
  const date     = new Date().toISOString().split('T')[0];

  if (platform === 'linux') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="isms-discovery-agent.sh"');
    res.send(buildLinuxScript(appUrl, date));
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="isms-discovery-agent.ps1"');
    res.send(buildWindowsScript(appUrl, date));
  }
});

function buildWindowsScript(appUrl, date) {
  return `# ISMS Discovery Agent fuer Windows
# Generiert: ${date}
# Ausfuehren: powershell -ExecutionPolicy Bypass -File isms-discovery-agent.ps1

$ApiUrl = "${appUrl}"
$Token  = "DEIN-JWT-TOKEN"  # Aus dem ISMS-Profil kopieren (oben rechts -> Profil -> Token kopieren)

# Installierte Software aus der Windows-Registry
$software = @()
$regPaths = @(
  "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
  "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
  "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
)
foreach ($path in $regPaths) {
  try {
    Get-ItemProperty $path -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -and $_.DisplayName.Trim().Length -gt 2 } |
      ForEach-Object {
        $software += [PSCustomObject]@{
          name    = $_.DisplayName.Trim()
          version = if ($_.DisplayVersion) { $_.DisplayVersion.Trim() } else { "" }
          vendor  = if ($_.Publisher)      { $_.Publisher.Trim()      } else { "" }
        }
      }
  } catch { }
}
$software = $software | Sort-Object name -Unique

# Netzwerk-IP ermitteln
try {
  $ifIdx = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" | Sort-Object RouteMetric | Select-Object -First 1).ifIndex
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $ifIdx -ErrorAction Stop).IPAddress
} catch {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127|169)\." } | Select-Object -First 1).IPAddress
}

$report = @{
  hostname = $env:COMPUTERNAME
  ip       = $ip
  os       = (Get-WmiObject Win32_OperatingSystem).Caption
  software = $software
} | ConvertTo-Json -Depth 3 -Compress

Write-Host "Sende $($software.Count) Eintraege von $($env:COMPUTERNAME) ($ip) ..."
try {
  $r = Invoke-RestMethod -Uri "$ApiUrl/api/discovery/report" -Method POST \`
       -Body $report -ContentType "application/json; charset=utf-8" \`
       -Headers @{ Authorization = "Bearer $Token" }
  Write-Host "OK: $($r.created) neu, $($r.updated) aktualisiert"
} catch {
  Write-Host "Fehler: $_" -ForegroundColor Red
}
`;
}

function buildLinuxScript(appUrl, date) {
  return `#!/bin/bash
# ISMS Discovery Agent fuer Linux
# Generiert: ${date}
# Ausfuehren: chmod +x isms-discovery-agent.sh && ./isms-discovery-agent.sh

API_URL="${appUrl}"
TOKEN="DEIN-JWT-TOKEN"  # Aus dem ISMS-Profil kopieren

HNAME=$(hostname -f 2>/dev/null || hostname)
IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \\K[^ ]+' || hostname -I 2>/dev/null | awk '{print $1}')
OS=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d'"' -f2 || uname -sr)

if command -v pveversion &>/dev/null; then
  OS="Proxmox VE ($(pveversion))"
elif [ -f /etc/unraid-version ]; then
  OS="Unraid OS ($(cat /etc/unraid-version))"
fi

collect_dpkg() {
  dpkg-query -W -f='\${Package}\\t\${Version}\\t\${Maintainer}\\n' 2>/dev/null | \
  awk -F'\\t' '{gsub(/"/, "\\\\\""); printf "{\\\"name\\\":\\\"%s\\\",\\\"version\\\":\\\"%s\\\",\\\"vendor\\\":\\\"%s\\\"},\\n", $1, $2, $3}'
}
collect_rpm() {
  rpm -qa --queryformat '%{NAME}\\t%{VERSION}\\t%{VENDOR}\\n' 2>/dev/null | \
  awk -F'\\t' '{gsub(/"/, "\\\\\""); printf "{\\\"name\\\":\\\"%s\\\",\\\"version\\\":\\\"%s\\\",\\\"vendor\\\":\\\"%s\\\"},\\n", $1, $2, $3}'
}

if command -v dpkg-query &>/dev/null; then
  SW_RAW=$(collect_dpkg)
elif command -v rpm &>/dev/null; then
  SW_RAW=$(collect_rpm)
fi
SOFTWARE="[$(echo "$SW_RAW" | sed 's/,$//')]"

echo "Sende Daten von $HNAME ($IP) ..."
PAYLOAD="{\\\"hostname\\\":\\\"$HNAME\\\",\\\"ip\\\":\\\"$IP\\\",\\\"os\\\":\\\"$OS\\\",\\\"software\\\":$SOFTWARE}"

RESP=$(curl -s -o /tmp/isms_resp.json -w "%{http_code}" -X POST "$API_URL/api/discovery/report" \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  --data-binary "$PAYLOAD")

if [ "$RESP" = "200" ]; then
  echo "OK: $(cat /tmp/isms_resp.json)"
else
  echo "Fehler HTTP $RESP: $(cat /tmp/isms_resp.json)"
fi
`;
}

// ── Process agent report ──────────────────────────────────────────────────────

router.post('/report', authenticate, requireRole('admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  try {
    const { hostname, ip, os, software = [] } = req.body;
    if (!hostname || !Array.isArray(software)) {
      return res.status(400).json({ error: 'hostname und software[] erforderlich' });
    }
    if (software.length > 500) {
      return res.status(400).json({ error: 'Maximal 500 Software-Einträge pro Report erlaubt.' });
    }

    let created = 0; let updated = 0;
    const errors = [];

    for (const sw of software) {
      const name = (sw.name || '').trim();
      if (name.length < 3) continue;

      try {
        const existingAsset = await Asset.findOne({
          where: { name: { [Op.like]: escapeLike(name) }, status: { [Op.ne]: 'decommissioned' } }
        });

        if (existingAsset) {
          const patch = {};
          if (sw.version && sw.version !== existingAsset.version) patch.version = sw.version.trim();
          if (sw.vendor  && !existingAsset.vendor)                patch.vendor  = sw.vendor.trim();
          if (Object.keys(patch).length) { await existingAsset.update(patch); updated++; }
        } else {
          const existingStaged = await DiscoveredSoftware.findOne({
            where: {
              name: { [Op.like]: escapeLike(name) },
              hostname: hostname,
              version: sw.version?.trim() || null
            }
          });

          if (existingStaged) {
            const patch = {};
            if (ip && ip !== existingStaged.ip) patch.ip = ip;
            if (os && os !== existingStaged.os) patch.os = os;
            if (sw.vendor && sw.vendor !== existingStaged.vendor) patch.vendor = sw.vendor.trim();
            // If it was ignored or approved, but now re-reported, we can keep its state or reset if it's ignored? 
            // Usually we just leave status as is.
            if (Object.keys(patch).length) {
              await existingStaged.update(patch);
              updated++;
            }
          } else {
            await DiscoveredSoftware.create({
              name,
              version: sw.version?.trim() || null,
              vendor: sw.vendor?.trim() || null,
              hostname,
              ip: ip || null,
              os: os || null,
              status: 'pending'
            });
            created++;
          }
        }
      } catch (e) {
        if (errors.length < 10) errors.push({ name, error: e.message });
      }
    }

    res.json({ created, updated, errors, total: software.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET all staged software
router.get('/staged', authenticate, requireRole('admin', 'it-staff'), async (req, res) => {
  try {
    const list = await DiscoveredSoftware.findAll({
      order: [['created_at', 'DESC']]
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Approve a staged item -> create Asset
router.post('/staged/:id/approve', authenticate, requireRole('admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  const { id } = req.params;
  try {
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
    if (item.status === 'approved') return res.status(400).json({ error: 'Eintrag bereits freigegeben' });

    const isNetworkScan = item.source === 'network-scan';
    const searchWhere = isNetworkScan && item.ip
      ? { name: { [Op.like]: `%${escapeLike(item.ip)}%` } }
      : { name: { [Op.like]: escapeLike(item.name) } };

    const existing = await Asset.findOne({
      where: { ...searchWhere, status: { [Op.ne]: 'decommissioned' } }
    });

    if (!existing) {
      let tags, description;
      const today = new Date().toISOString().split('T')[0];

      if (isNetworkScan) {
        const openPorts = item.open_ports ? JSON.parse(item.open_ports) : [];
        const portTags = openPorts.map(p => `port:${p.port}`);
        tags = ['network-scan', `ip:${item.ip}`, ...portTags];
        if (item.os) tags.push(`os:${item.os.replace(/\s+/g, '_')}`);
        const services = openPorts.map(p => p.service).join(', ');
        description = `Netzwerk-Scan: ${item.ip}${item.hostname !== item.ip ? ` (${item.hostname})` : ''}${item.os ? ` · System: ${item.os}${item.version ? ` ${item.version}` : ''}` : ''}${services ? ` · Dienste: ${services}` : ''} — freigegeben am ${today}`;
      } else {
        tags = ['auto-discovered', `host:${item.hostname}`];
        if (item.ip) tags.push(`ip:${item.ip}`);
        description = `Automatisch erkannt auf ${item.hostname}${item.ip ? ` (${item.ip})` : ''}${item.os ? ` · ${item.os}` : ''} und am ${today} freigegeben.`;
      }

      await Asset.create({
        name:             item.name,
        type:             item.asset_type || 'software',
        classification:   'internal',
        lifecycle_status: 'evaluation',
        location:         item.ip || null,
        version:          item.version || null,
        vendor:           item.vendor  || null,
        owner_id:         req.user.id,
        assessor_id:      req.user.id,
        tags,
        description,
        status:           'active',
      });
    }

    await item.update({ status: 'approved' });
    const label = item.asset_type === 'hardware' ? 'Hardware-Asset' : 'Software-Asset';
    res.json({ success: true, message: `${label} freigegeben und zu Assets hinzugefügt.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ignore a staged software
router.post('/staged/:id/ignore', authenticate, requireRole('admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  const { id } = req.params;
  try {
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    await item.update({ status: 'ignored' });
    res.json({ success: true, message: 'Software ignoriert.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a staged software record
router.delete('/staged/:id', authenticate, requireRole('admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  const { id } = req.params;
  try {
    const item = await DiscoveredSoftware.findByPk(id);
    if (!item) return res.status(404).json({ error: 'Eintrag nicht gefunden' });

    await item.destroy();
    res.json({ success: true, message: 'Eintrag gelöscht.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── Network sweep ─────────────────────────────────────────────────────────────

router.post('/network-scan', authenticate, requireRole('admin', 'it-staff'), async (req, res) => {
  try {
    const { cidr, ports: customPorts } = req.body;
    if (typeof cidr !== 'string' || !/^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([1-2][0-9]|3[0-2]|[1-9]))?$/.test(cidr)) {
      return res.status(400).json({ error: 'Ungültiges CIDR-Format (z. B. 192.168.1.0/24)' });
    }

    const ips = cidrToIPs(cidr);
    if (ips.length > 254) {
      return res.status(400).json({ error: 'Maximal /24 erlaubt (254 Hosts). Bitte kleineren Bereich wählen.' });
    }
    if (!ips.every(isPrivateIP)) {
      return res.status(400).json({ error: 'Nur private RFC-1918-Bereiche erlaubt (10.x, 172.16-31.x, 192.168.x).' });
    }

    const rawPorts = Array.isArray(customPorts) && customPorts.length ? customPorts : DEFAULT_PORTS;
    const ports = [...new Set(rawPorts.map(Number).filter(p => Number.isInteger(p) && p >= 1 && p <= 65535))];
    if (!ports.length) return res.status(400).json({ error: 'Keine gültigen Ports angegeben (1–65535).' });
    if (ports.length > MAX_PORTS_PER_SCAN) {
      return res.status(400).json({ error: `Maximal ${MAX_PORTS_PER_SCAN} Ports pro Scan erlaubt.` });
    }
    const results = [];
    const BATCH   = 30; // concurrent hosts

    for (let i = 0; i < ips.length; i += BATCH) {
      const slice = ips.slice(i, i + BATCH);
      const batch = await Promise.all(slice.map(async ip => {
        const portHits = await Promise.all(ports.map(async port => {
          const open = await tcpProbe(ip, port);
          return open ? { port, service: PORT_SERVICES[port] || `TCP/${port}` } : null;
        }));
        const openPorts = portHits.filter(Boolean);
        if (!openPorts.length) return null;
        const hostname = await reverseDNS(ip);
        const detection = await detectHostSystem(ip, openPorts);
        return { ip, hostname, openPorts, ...detection };
      }));
      results.push(...batch.filter(Boolean));
    }

    res.json({ hosts: results, scanned: ips.length, found: results.length });
  } catch (e) {
    res.status(e.message.includes('CIDR') || e.message.includes('Maximal') || e.message.includes('private') ? 400 : 500)
       .json({ error: e.message });
  }
});

// ── Stage selected scan results for review ────────────────────────────────────

router.post('/import', authenticate, requireRole('admin', 'it-staff'), requireWriteAccess(), async (req, res) => {
  try {
    const { hosts } = req.body;
    if (!Array.isArray(hosts) || !hosts.length) {
      return res.status(400).json({ error: 'hosts[] erforderlich' });
    }
    if (hosts.length > MAX_IMPORT_HOSTS) {
      return res.status(400).json({ error: `Maximal ${MAX_IMPORT_HOSTS} Hosts pro Import erlaubt.` });
    }

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const host of hosts) {
      try {
        if (typeof host?.ip !== 'string' || !isPrivateIP(host.ip)) {
          if (errors.length < 10) errors.push({ ip: host?.ip, error: 'Ungültige oder nicht-private IP' });
          continue;
        }

        // Skip if already in staging (pending) for this IP
        const existingStaged = await DiscoveredSoftware.findOne({
          where: { ip: host.ip, source: 'network-scan', status: 'pending' }
        });
        if (existingStaged) { skipped++; continue; }

        // Skip if already exists as a non-decommissioned asset
        const existingAsset = await Asset.findOne({
          where: { name: { [Op.like]: `%${escapeLike(host.ip)}%` }, status: { [Op.ne]: 'decommissioned' } }
        });
        if (existingAsset) { skipped++; continue; }

        let name = host.hostname || host.ip;
        if (host.os) name = `${host.os} (${host.hostname || host.ip})`;

        await DiscoveredSoftware.create({
          name,
          version:    host.version || null,
          vendor:     host.vendor  || null,
          hostname:   host.hostname || host.ip,
          ip:         host.ip,
          os:         host.os || null,
          source:     'network-scan',
          asset_type: 'hardware',
          open_ports: JSON.stringify(host.openPorts || []),
          status:     'pending',
        });
        created++;
      } catch (e) {
        if (errors.length < 10) errors.push({ ip: host.ip, error: e.message });
      }
    }

    res.json({ created, skipped, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
