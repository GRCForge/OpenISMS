import React, { useState } from 'react';
import { Radar, Download, Play, CheckSquare, Square, Server, Wifi, Terminal, AlertTriangle, CheckCircle, Info, ChevronRight, Package, Inbox, Trash2, Check, X, RefreshCw } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import api from '../lib/api';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useToast } from '../contexts/ToastContext';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';

type Tab = 'scan' | 'agent' | 'staged';

interface DiscoveredSoftware {
  id: number;
  name: string;
  version: string | null;
  vendor: string | null;
  hostname: string;
  ip: string | null;
  os: string | null;
  status: 'pending' | 'approved' | 'ignored';
  source: 'agent' | 'network-scan';
  asset_type: 'software' | 'hardware';
  open_ports: string | null; // JSON-encoded port array
  created_at: string;
}

interface ScanHost {
  ip: string;
  hostname: string | null;
  openPorts: { port: number; service: string }[];
  os?: string | null;
  version?: string | null;
  vendor?: string | null;
}

interface ScanResult {
  hosts: ScanHost[];
  scanned: number;
  found: number;
}

export const NetworkDiscovery: React.FC = () => {
  const toast = useToast();
  const { t } = useTranslation('networkdiscovery');
  const [tab, setTab] = useState<Tab>('scan');

  // Network scan state
  const [cidr, setCidr] = useState('192.168.1.0/24');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Agent state
  const [platform, setPlatform] = useState<'windows' | 'linux'>('windows');
  // Staged software state
  const [stagedSoftware, setStagedSoftware] = useState<DiscoveredSoftware[]>([]);
  const [loadingStaged, setLoadingStaged] = useState(false);
  const [stagedFilter, setStagedFilter] = useState<'pending' | 'approved' | 'ignored' | 'all'>('pending');
  const [stagedSearch, setStagedSearch] = useState('');
  const [selectedStaged, setSelectedStaged] = useState<Set<number>>(new Set());

  const loadStaged = async () => {
    setLoadingStaged(true);
    try {
      const { data } = await api.get('/discovery/staged');
      setStagedSoftware(data);
    } catch {
      toast.error(t('messages.loadFailed'));
    } finally {
      setLoadingStaged(false);
    }
  };

  const approveSoftware = async (id: number) => {
    try {
      await api.post(`/discovery/staged/${id}/approve`);
      toast.success(t('messages.approveSuccess'));
      loadStaged();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('messages.approveFailed'));
    }
  };

  const ignoreSoftware = async (id: number) => {
    try {
      await api.post(`/discovery/staged/${id}/ignore`);
      toast.success(t('messages.ignoreSuccess'));
      loadStaged();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('messages.actionFailed'));
    }
  };

  const deleteStaged = async (id: number) => {
    if (!confirm(t('messages.confirmDeleteSingle'))) return;
    try {
      await api.delete(`/discovery/staged/${id}`);
      toast.success(t('messages.deleteSuccessSingle'));
      loadStaged();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('messages.deleteFailedSingle'));
    }
  };

  const bulkApprove = async () => {
    if (selectedStaged.size === 0) return;
    const ids = Array.from(selectedStaged);
    let successCount = 0;
    let failCount = 0;
    for (const id of ids) {
      try {
        await api.post(`/discovery/staged/${id}/approve`);
        successCount++;
      } catch {
        failCount++;
      }
    }
    toast.success(t('messages.bulkApproveSuccess', { successCount, failedText: failCount > 0 ? ` ${t('messages.bulkApproveFailedCount', { failCount })}` : '' }));
    setSelectedStaged(new Set());
    loadStaged();
  };

  const bulkIgnore = async () => {
    if (selectedStaged.size === 0) return;
    const ids = Array.from(selectedStaged);
    let successCount = 0;
    for (const id of ids) {
      try {
        await api.post(`/discovery/staged/${id}/ignore`);
        successCount++;
      } catch {}
    }
    toast.success(t('messages.bulkIgnoreSuccess', { count: successCount }));
    setSelectedStaged(new Set());
    loadStaged();
  };

  const bulkDelete = async () => {
    if (selectedStaged.size === 0 || !confirm(t('messages.bulkDeleteConfirm', { count: selectedStaged.size }))) return;
    const ids = Array.from(selectedStaged);
    let successCount = 0;
    for (const id of ids) {
      try {
        await api.delete(`/discovery/staged/${id}`);
        successCount++;
      } catch {}
    }
    toast.success(t('messages.bulkDeleteSuccess', { count: successCount }));
    setSelectedStaged(new Set());
    loadStaged();
  };

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    if (newTab === 'staged') {
      loadStaged();
    }
  };

  const runScan = async () => {
    setScanning(true);
    setScanResult(null);
    setSelected(new Set());
    try {
      const { data } = await api.post('/discovery/network-scan', { cidr });
      setScanResult(data);
      if (data.found === 0) toast.error(t('scan.noActiveHosts'));
      else toast.success(t('messages.scanSuccess', { found: data.found, scanned: data.scanned }));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('messages.scanFailed'));
    } finally { setScanning(false); }
  };

  const toggleSelect = (ip: string) => {
    const next = new Set(selected);
    if (next.has(ip)) next.delete(ip); else next.add(ip);
    setSelected(next);
  };

  const selectAll = () => {
    if (!scanResult) return;
    if (selected.size === scanResult.hosts.length) setSelected(new Set());
    else setSelected(new Set(scanResult.hosts.map(h => h.ip)));
  };

  const importSelected = async () => {
    if (!scanResult || selected.size === 0) return;
    setImporting(true);
    try {
      const hosts = scanResult.hosts.filter(h => selected.has(h.ip));
      const { data } = await api.post('/discovery/import', { hosts });
      const msg = data.skipped > 0
        ? t('messages.importSuccessWithSkipped', { created: data.created, skipped: data.skipped })
        : t('messages.importSuccess', { created: data.created });
      toast.success(msg);
      setSelected(new Set());
      // Switch to staging tab automatically
      handleTabChange('staged');
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('messages.importFailed'));
    } finally { setImporting(false); }
  };

  const downloadAgent = async () => {
    try {
      const response = await api.get(`/discovery/agent?platform=${platform}`, { responseType: 'blob' });
      const fname = platform === 'windows' ? 'isms-discovery-agent.ps1' : 'isms-discovery-agent.sh';
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch { toast.error(t('messages.downloadFailed')); }
  };

  const SERVICE_COLORS: Record<string, string> = {
    'SSH': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    'HTTP': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'HTTPS': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    'RDP': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    'SMB': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    'MySQL': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    'PostgreSQL': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    'RDP-Alt': 'bg-orange-100 text-orange-700',
  };

  const getServiceColor = (service: string) =>
    SERVICE_COLORS[service] || 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Radar size={24} className="text-blue-500" /> {t('title')}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle')}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b dark:border-slate-800">
        {([
          ['scan', Wifi, t('tabs.scan')],
          ['agent', Terminal, t('tabs.agent')],
          ['staged', Inbox, t('tabs.staged')]
        ] as const).map(([t, Icon, label]) => (
          <button key={t} onClick={() => handleTabChange(t)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── Network Scan Tab ─────────────────────────────────────────────────── */}
      {tab === 'scan' && (
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-4">
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Input
                    label={t('scan.ipRangeLabel')}
                    value={cidr}
                    onChange={e => setCidr(e.target.value)}
                    placeholder="192.168.1.0/24"
                  />
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                    {t('scan.ipRangeHelp')}
                  </p>
                </div>
                <Button onClick={runScan} disabled={scanning} className="gap-2 mb-5">
                  <Play size={14} />{scanning ? t('scan.scanning') : t('scan.startScan')}
                </Button>
              </div>

              {scanning && (
                <div className="flex items-center gap-3 text-sm text-blue-600 dark:text-blue-400 py-2">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  {t('scan.scanProgress')}
                </div>
              )}

              <div className="flex items-start gap-2 text-xs text-gray-400 dark:text-slate-500 bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
                <Info size={13} className="mt-0.5 flex-shrink-0" />
                <span>{t('scan.scanInfo')}</span>
              </div>
            </CardBody>
          </Card>

          {scanResult && scanResult.hosts.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server size={16} className="text-blue-500" />
                    <h2 className="font-bold dark:text-white">
                      {t('scan.hostsFound', { found: scanResult.found, scanned: scanResult.scanned })}
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={selectAll} className="text-xs text-blue-500 dark:text-blue-400 hover:underline flex items-center gap-1">
                      {selected.size === scanResult.hosts.length
                        ? <><Square size={12} />{t('scan.deselectAll')}</>
                        : <><CheckSquare size={12} />{t('scan.selectAll')}</>}
                    </button>
                    {selected.size > 0 && (
                      <Button size="sm" onClick={importSelected} disabled={importing}>
                        {importing ? t('scan.staging') : t('scan.submitForApproval', { count: selected.size })}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y dark:divide-slate-800">
                  {scanResult.hosts.map(host => (
                    <div
                      key={host.ip}
                      onClick={() => toggleSelect(host.ip)}
                      className={`flex items-start gap-3 p-4 cursor-pointer transition-colors ${
                        selected.has(host.ip)
                          ? 'bg-blue-50 dark:bg-blue-900/10'
                          : 'hover:bg-gray-50/50 dark:hover:bg-slate-800/30'
                      }`}>
                      <div className="mt-0.5">
                        {selected.has(host.ip)
                          ? <CheckSquare size={16} className="text-blue-500" />
                          : <Square size={16} className="text-gray-300 dark:text-slate-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-sm dark:text-slate-200">{host.ip}</span>
                          {host.hostname && (
                            <span className="text-xs text-gray-500 dark:text-slate-400">({host.hostname})</span>
                          )}
                          {host.os && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ml-2">
                              {host.os} {host.version ? `(${host.version})` : ''}
                            </span>
                          )}
                          {host.vendor && (
                            <span className="text-xs font-medium text-gray-400 dark:text-slate-500 ml-2">
                              {t('scan.vendor', { vendor: host.vendor })}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {host.openPorts.map(p => (
                            <span key={p.port} className={`text-xs px-2 py-0.5 rounded-full font-medium ${getServiceColor(p.service)}`}>
                              {p.service} :{p.port}
                            </span>
                          ))}
                        </div>
                      </div>
                      {/* Risk hint for sensitive ports */}
                      {host.openPorts.some(p => [23, 445, 3389, 5900].includes(p.port)) && (
                        <span title={t('scan.criticalPortsOpen')}><AlertTriangle size={14} className="text-orange-400 mt-1 flex-shrink-0" /></span>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Discovery Agent Tab ──────────────────────────────────────────────── */}
      {tab === 'agent' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Download panel */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Download size={16} className="text-green-500" />
                <h2 className="font-bold dark:text-white">{t('agent.downloadTitle')}</h2>
              </div>
            </CardHeader>
            <CardBody className="space-y-5">
              {/* Platform picker */}
              <div className="grid grid-cols-2 gap-3">
                {(['windows', 'linux'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPlatform(p)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                      platform === p
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-slate-700 hover:border-blue-300'
                    }`}>
                    <Terminal size={24} className={platform === p ? 'text-blue-500' : 'text-gray-400'} />
                    <span className={`text-sm font-bold ${platform === p ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500'}`}>
                      {p === 'windows' ? t('agent.windowsPowerShell') : t('agent.linuxBash')}
                    </span>
                  </button>
                ))}
              </div>

              <Button onClick={downloadAgent} className="w-full justify-center gap-2">
                <Download size={15} />
                {t('agent.downloadButton', { filename: platform === 'windows' ? 'isms-discovery-agent.ps1' : 'isms-discovery-agent.sh' })}
              </Button>

              <div className="space-y-3 pt-2 border-t dark:border-slate-800">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">{t('agent.setupSteps')}</p>
                {[
                  {
                    n: 1,
                    title: t('agent.step1Title'),
                    desc: t('agent.step1Desc'),
                  },
                  {
                    n: 2,
                    title: t('agent.step2Title'),
                    desc: t('agent.step2Desc'),
                  },
                  {
                    n: 3,
                    title: t('agent.step3Title'),
                    desc: platform === 'windows'
                      ? t('agent.step3DescWindows')
                      : t('agent.step3DescLinux'),
                  },
                ].map(s => (
                  <div key={s.n} className="flex gap-3 items-start">
                    <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {s.n}
                    </div>
                    <div>
                      <p className="text-sm font-medium dark:text-slate-200">{s.title}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{s.desc}</p>
                      {s.n === 3 && (
                        <code className="block mt-1 text-[11px] bg-gray-900 dark:bg-black text-green-400 px-3 py-1.5 rounded font-mono">
                          {platform === 'windows'
                            ? 'powershell -ExecutionPolicy Bypass -File .\\isms-discovery-agent.ps1'
                            : 'chmod +x isms-discovery-agent.sh && ./isms-discovery-agent.sh'}
                        </code>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Info panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Package size={16} className="text-purple-500" />
                  <h2 className="font-bold dark:text-white">{t('agent.whatIsDetected')}</h2>
                </div>
              </CardHeader>
              <CardBody className="space-y-3">
                {[
                  { icon: '🪟', label: t('agent.windows'), desc: t('agent.windowsDetected') },
                  { icon: '🐧', label: t('agent.linuxDeb'), desc: t('agent.linuxDebDetected') },
                  { icon: '🐧', label: t('agent.linuxRpm'), desc: t('agent.linuxRpmDetected') },
                ].map(item => (
                  <div key={item.label} className="flex gap-3 items-start">
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <p className="text-sm font-medium dark:text-slate-200">{item.label}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <div className="flex gap-3 items-start">
                  <CheckCircle size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold dark:text-slate-200">{t('agent.assetMatchingTitle')}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      <Trans i18nKey="agent.assetMatchingDesc" components={{ strong: <strong /> }} />
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardBody>
                <div className="flex gap-3 items-start">
                  <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold dark:text-slate-200">{t('agent.cveMatchingTitle')}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {t('agent.cveMatchingDesc')}
                    </p>
                    <div className="flex items-center gap-1 text-xs text-blue-500 dark:text-blue-400 mt-1">
                      <ChevronRight size={12} />{t('agent.cveMatchingHint')}
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* ── Freigabe-Queue Tab ──────────────────────────────────────────────── */}
      {tab === 'staged' && (() => {
        const filteredStaged = stagedSoftware.filter(item => {
          const matchesStatus = stagedFilter === 'all' || item.status === stagedFilter;
          const matchesSearch = !stagedSearch ||
            item.name.toLowerCase().includes(stagedSearch.toLowerCase()) ||
            item.hostname.toLowerCase().includes(stagedSearch.toLowerCase()) ||
            (item.vendor && item.vendor.toLowerCase().includes(stagedSearch.toLowerCase()));
          return matchesStatus && matchesSearch;
        });

        return (
          <div className="space-y-6">
            {/* Filters card */}
            <Card>
              <CardBody className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex flex-wrap gap-2">
                  {(['pending', 'approved', 'ignored', 'all'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => {
                        setStagedFilter(f);
                        setSelectedStaged(new Set());
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        stagedFilter === f
                          ? 'bg-blue-500 text-white dark:bg-blue-600'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {f === 'pending' ? t('staged.pending') : f === 'approved' ? t('staged.approved') : f === 'ignored' ? t('staged.ignored') : t('staged.all')}
                    </button>
                  ))}
                </div>
                
                <div className="flex gap-2 items-center flex-1 max-w-md w-full">
                  <Input
                    placeholder={t('staged.searchPlaceholder')}
                    value={stagedSearch}
                    onChange={e => setStagedSearch(e.target.value)}
                    className="w-full !py-1.5"
                  />
                  <Button size="sm" onClick={loadStaged} disabled={loadingStaged} className="shrink-0 p-2.5">
                    <RefreshCw size={14} className={loadingStaged ? 'animate-spin' : ''} />
                  </Button>
                </div>
              </CardBody>
            </Card>

            {/* Bulk actions */}
            {selectedStaged.size > 0 && (
              <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 rounded-xl animate-fade-in">
                <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  {t('staged.itemsSelected', { count: selectedStaged.size })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={bulkApprove} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                    <Check size={14} /> {t('staged.approveSelected')}
                  </Button>
                  <Button size="sm" onClick={bulkIgnore} className="gap-1">
                    <X size={14} /> {t('staged.ignoreSelected')}
                  </Button>
                  <Button size="sm" onClick={bulkDelete} className="gap-1 bg-red-600 hover:bg-red-700 text-white">
                    <Trash2 size={14} /> {t('staged.deleteSelected')}
                  </Button>
                </div>
              </div>
            )}

            {/* Table card */}
            <Card>
              {loadingStaged ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-slate-400">
                  <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                  {t('staged.loading')}
                </div>
              ) : (
                <div className="p-0">
                  <Table>
                    <Thead>
                      <tr>
                        <Th className="w-10">
                          <button
                            onClick={() => {
                              if (selectedStaged.size === filteredStaged.length) {
                                setSelectedStaged(new Set());
                              } else {
                                setSelectedStaged(new Set(filteredStaged.map(x => x.id)));
                              }
                            }}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-white mt-1"
                          >
                            {filteredStaged.length > 0 && selectedStaged.size === filteredStaged.length ? (
                              <CheckSquare size={16} className="text-blue-500" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </Th>
                        <Th>{t('staged.table.nameType')}</Th>
                        <Th>{t('staged.table.version')}</Th>
                        <Th>{t('staged.table.vendor')}</Th>
                        <Th>{t('staged.table.hostIp')}</Th>
                        <Th>{t('staged.table.servicesOs')}</Th>
                        <Th>{t('staged.table.status')}</Th>
                        <Th className="text-right">{t('staged.table.actions')}</Th>
                      </tr>
                    </Thead>
                    <Tbody>
                      {filteredStaged.map(item => (
                        <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                          <Td>
                            <button
                              onClick={() => {
                                const next = new Set(selectedStaged);
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                setSelectedStaged(next);
                              }}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-white mt-1"
                            >
                              {selectedStaged.has(item.id) ? (
                                <CheckSquare size={16} className="text-blue-500" />
                              ) : (
                                <Square size={16} />
                              )}
                            </button>
                          </Td>
                          <Td>
                            <div className="space-y-1">
                              <div className="font-semibold text-gray-900 dark:text-slate-100 text-sm">{item.name}</div>
                              <div className="flex gap-1 flex-wrap">
                                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                  item.source === 'network-scan'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                }`}>
                                  {item.source === 'network-scan' ? t('staged.sourceNetworkScan') : t('staged.sourceAgent')}
                                </span>
                                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                  item.asset_type === 'hardware'
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                    : 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
                                }`}>
                                  {item.asset_type === 'hardware' ? t('staged.hardware') : t('staged.software')}
                                </span>
                              </div>
                            </div>
                          </Td>
                          <Td className="font-mono text-xs">{item.version || '—'}</Td>
                          <Td className="text-gray-500 dark:text-slate-400 text-sm">{item.vendor || '—'}</Td>
                          <Td>
                            <div className="text-xs">
                              <div className="font-semibold font-mono dark:text-slate-200">{item.hostname}</div>
                              {item.ip && item.ip !== item.hostname && (
                                <div className="font-mono text-gray-400 dark:text-slate-500">{item.ip}</div>
                              )}
                            </div>
                          </Td>
                          <Td>
                            <div className="text-xs space-y-1">
                              {item.source === 'network-scan' && item.open_ports ? (
                                <div className="flex flex-wrap gap-1">
                                  {(JSON.parse(item.open_ports) as {port: number; service: string}[]).slice(0, 4).map(p => (
                                    <span key={p.port} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getServiceColor(p.service)}`}>
                                      {p.service}
                                    </span>
                                  ))}
                                  {JSON.parse(item.open_ports).length > 4 && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] text-gray-400 dark:text-slate-500">
                                      +{JSON.parse(item.open_ports).length - 4}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="text-gray-400 dark:text-slate-500 truncate max-w-[150px]" title={item.os || ''}>
                                  {item.os || '—'}
                                </div>
                              )}
                            </div>
                          </Td>
                          <Td>
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              item.status === 'pending'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400'
                                : item.status === 'approved'
                                ? 'bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400'
                            }`}>
                              {item.status === 'pending' ? t('staged.pending') : item.status === 'approved' ? t('staged.approved') : t('staged.ignored')}
                            </span>
                          </Td>
                          <Td className="text-right">
                            <div className="flex justify-end gap-1">
                              {item.status === 'pending' && (
                                <>
                                  <button
                                    onClick={() => approveSoftware(item.id)}
                                    className="p-1 hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg transition-colors"
                                    title={t('staged.tooltips.approveAndAdd')}
                                  >
                                    <Check size={16} />
                                  </button>
                                  <button
                                    onClick={() => ignoreSoftware(item.id)}
                                    className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 rounded-lg transition-colors"
                                    title={t('staged.tooltips.ignore')}
                                  >
                                    <X size={16} />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => deleteStaged(item.id)}
                                className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg transition-colors"
                                title={t('staged.tooltips.delete')}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                      {filteredStaged.length === 0 && (
                        <tr>
                          <Td colSpan={8} className="text-center py-12 text-gray-400 italic">
                            {t('staged.noItems')}
                          </Td>
                        </tr>
                      )}
                    </Tbody>
                  </Table>
                </div>
              )}
            </Card>
          </div>
        );
      })()}
    </div>
  );
};
