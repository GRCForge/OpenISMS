import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Plus, Trash2, Download, Search } from 'lucide-react';
import api from '../lib/api';
import type { Asset, AssetCveEntry, Vulnerability, VulnerabilitySeverity, VulnerabilityStatus } from '../types';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { IconButton } from '../components/ui/IconButton';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../contexts/ToastContext';
import { hasRole } from '../lib/permissions';

const SEVERITIES: VulnerabilitySeverity[] = ['critical', 'high', 'medium', 'low', 'none'];
const STATUSES: VulnerabilityStatus[] = ['open', 'mitigated', 'closed'];
const SEV_CLASS: Record<VulnerabilitySeverity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  none: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

const emptyForm = { title: '', description: '', severity: '' as VulnerabilitySeverity | '', cvss_score: '', status: 'open' as VulnerabilityStatus, asset_ids: [] as number[] };

// Vulnerability register (ISO 27005:2022 8.2.4): recorded manually or taken
// over from the CVE data of an asset - by selection, never automatically.
export const Vulnerabilities: React.FC = () => {
  const { t } = useTranslation(['risks', 'common']);
  const { user } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const canManage = can('vulnerabilities', 'manage', hasRole(user, ['admin', 'assessor', 'it-staff']));
  const canDelete = can('vulnerabilities', 'delete', hasRole(user, ['admin', 'assessor']));

  const [rows, setRows] = useState<Vulnerability[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [severity, setSeverity] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editSource, setEditSource] = useState<'manual' | 'cve'>('manual');
  const [form, setForm] = useState({ ...emptyForm });
  const [detail, setDetail] = useState<Vulnerability | null>(null);
  const [assetFilter, setAssetFilter] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importAsset, setImportAsset] = useState('');
  const [cves, setCves] = useState<AssetCveEntry[]>([]);
  const [cveSel, setCveSel] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const load = () => api.get('/vulnerabilities').then(r => setRows(Array.isArray(r.data) ? r.data : [])).catch(() => setRows([])).finally(() => setLoading(false));
  useEffect(() => {
    load();
    api.get('/assets').then(r => setAssets(Array.isArray(r.data) ? r.data : [])).catch(() => setAssets([]));
  }, []);

  const filtered = useMemo(() => rows.filter(v => {
    if (status && v.status !== status) return false;
    if (source && v.source !== source) return false;
    if (severity && v.severity !== severity) return false;
    if (search && !`${v.ref || ''} ${v.cve_id || ''} ${v.title}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [rows, status, source, severity, search]);

  const openNew = () => { setEditId(null); setEditSource('manual'); setForm({ ...emptyForm }); setDetail(null); setAssetFilter(''); setModalOpen(true); };
  const openEdit = (v: Vulnerability) => {
    setEditId(v.id);
    setEditSource(v.source);
    setForm({ title: v.title, description: v.description || '', severity: v.severity || '', cvss_score: v.cvss_score == null ? '' : String(v.cvss_score), status: v.status, asset_ids: (v.assets || []).map(a => a.id) });
    setDetail(null);
    setAssetFilter('');
    api.get(`/vulnerabilities/${v.id}`).then(r => setDetail(r.data)).catch(() => setDetail(null));
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, severity: form.severity || null, cvss_score: form.cvss_score === '' ? null : Number(form.cvss_score) };
    try {
      if (editId) await api.put(`/vulnerabilities/${editId}`, body);
      else await api.post('/vulnerabilities', body);
      setModalOpen(false);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); }
  };

  const remove = async (v: Vulnerability) => {
    if (!confirm(t('risks:vulns.confirmDelete', { ref: v.ref || v.title }))) return;
    try { await api.delete(`/vulnerabilities/${v.id}`); load(); } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorDelete')); }
  };

  const pickAsset = async (id: string) => {
    setImportAsset(id);
    setCves([]);
    setCveSel([]);
    if (!id) return;
    try {
      const r = await api.get(`/vulnerabilities/asset-cves/${id}`);
      setCves(Array.isArray(r.data?.cves) ? r.data.cves : []);
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:vulns.loadCvesError')); }
  };

  const doImport = async () => {
    if (!importAsset || cveSel.length === 0) return;
    setImporting(true);
    try {
      const r = await api.post('/vulnerabilities/from-asset-cves', { asset_id: Number(importAsset), cve_ids: cveSel });
      toast.success(t('risks:vulns.imported', { created: r.data.created.length, linked: r.data.linked.length }));
      await pickAsset(importAsset);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); }
    finally { setImporting(false); }
  };

  const sevBadge = (s: VulnerabilitySeverity | null) => s
    ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEV_CLASS[s]}`}>{t(`risks:vulns.severity.${s}`)}</span>
    : <span className="text-xs text-gray-300">–</span>;

  const visibleAssets = assets.filter(a => a.name.toLowerCase().includes(assetFilter.toLowerCase()));

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><Bug size={22} className="text-red-500" />{t('risks:vulns.title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('risks:vulns.subtitle', { count: rows.length })}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setImportOpen(true); setImportAsset(''); setCves([]); setCveSel([]); }}><Download size={14} />{t('risks:vulns.importFromAsset')}</Button>
            <Button onClick={openNew}><Plus size={16} />{t('risks:vulns.new')}</Button>
          </div>
        )}
      </div>

      <Card className="space-y-4">
        <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('risks:vulns.searchPlaceholder')}
          activeCount={[status, source, severity].filter(Boolean).length} onReset={() => { setSearch(''); setStatus(''); setSource(''); setSeverity(''); }}>
          <Select className="w-36" value={status} onChange={e => setStatus(e.target.value)} options={[{ value: '', label: t('risks:filters.allStatus') }, ...STATUSES.map(s => ({ value: s, label: t(`risks:vulns.status.${s}`) }))]} />
          <Select className="w-36" value={source} onChange={e => setSource(e.target.value)} options={[{ value: '', label: t('risks:vulns.allSources') }, { value: 'manual', label: t('risks:vulns.source.manual') }, { value: 'cve', label: t('risks:vulns.source.cve') }]} />
          <Select className="w-36" value={severity} onChange={e => setSeverity(e.target.value)} options={[{ value: '', label: t('risks:vulns.allSeverities') }, ...SEVERITIES.map(s => ({ value: s, label: t(`risks:vulns.severity.${s}`) }))]} />
        </FilterBar>
        <Table>
          <Thead><tr><Th>{t('risks:table.ref')}</Th><Th>{t('risks:vulns.vulnerability')}</Th><Th>{t('risks:vulns.severityLabel')}</Th><Th>{t('risks:vulns.assets')}</Th><Th>{t('risks:vulns.risks')}</Th><Th>{t('risks:table.status')}</Th><Th>{''}</Th></tr></Thead>
          <Tbody>
            {filtered.map(v => (
              <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => openEdit(v)}>
                <Td className="font-mono text-xs text-gray-500">{v.ref}</Td>
                <Td>
                  <p className="text-sm font-medium dark:text-slate-200">{v.title}</p>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">{v.source === 'cve' ? `${t('risks:vulns.source.cve')} · ${v.cve_id}` : t('risks:vulns.source.manual')}{v.cvss_score != null ? ` · CVSS ${v.cvss_score}` : ''}</p>
                </Td>
                <Td>{sevBadge(v.severity)}</Td>
                <Td className="text-xs dark:text-slate-300">{(v.assets || []).map(a => a.name).join(', ') || '–'}</Td>
                <Td className="text-xs dark:text-slate-300">{v.risk_count || 0}</Td>
                <Td className="text-xs dark:text-slate-300">{t(`risks:vulns.status.${v.status}`)}</Td>
                <Td className="text-right">{canDelete && <IconButton label={t('common:actions.delete')} variant="danger" onClick={e => { e.stopPropagation(); remove(v); }}><Trash2 size={14} /></IconButton>}</Td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">{rows.length === 0 ? t('risks:vulns.empty') : t('risks:noFilter')}</td></tr>}
          </Tbody>
        </Table>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('risks:vulns.edit') : t('risks:vulns.new')} size="lg">
        <form onSubmit={save} className="space-y-4 max-h-[80vh] overflow-y-auto pr-2">
          {editSource === 'cve' && <p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:vulns.cveEntryHint')}</p>}
          <Input label={`${t('risks:vulns.titleLabel')} *`} value={form.title} required disabled={!canManage} onChange={e => setForm({ ...form, title: e.target.value })} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.description')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" rows={3} value={form.description} disabled={!canManage} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select label={t('risks:vulns.severityLabel')} value={form.severity} disabled={!canManage} onChange={e => setForm({ ...form, severity: e.target.value as VulnerabilitySeverity | '' })} options={[{ value: '', label: '–' }, ...SEVERITIES.map(s => ({ value: s, label: t(`risks:vulns.severity.${s}`) }))]} />
            <Input label="CVSS" type="number" min={0} max={10} step={0.1} value={form.cvss_score} disabled={!canManage} onChange={e => setForm({ ...form, cvss_score: e.target.value })} />
            <Select label={t('risks:table.status')} value={form.status} disabled={!canManage} onChange={e => setForm({ ...form, status: e.target.value as VulnerabilityStatus })} options={STATUSES.map(s => ({ value: s, label: t(`risks:vulns.status.${s}`) }))} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:vulns.assets')} ({form.asset_ids.length})</label>
            <div className="relative flex items-center">
              <Search className="absolute left-3 text-gray-500" size={14} />
              <input type="text" value={assetFilter} onChange={e => setAssetFilter(e.target.value)} placeholder={t('risks:form.assetFilter')} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg dark:text-white" />
            </div>
            <div className="max-h-36 overflow-y-auto border dark:border-slate-700 rounded-xl p-2">
              {visibleAssets.map(a => (
                <label key={a.id} className="flex items-center gap-2 px-2 py-0.5 text-sm dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 rounded text-blue-600" disabled={!canManage} checked={form.asset_ids.includes(a.id)}
                    onChange={() => setForm(f => ({ ...f, asset_ids: f.asset_ids.includes(a.id) ? f.asset_ids.filter(x => x !== a.id) : [...f.asset_ids, a.id] }))} />
                  <span className="truncate">{a.name}</span>
                </label>
              ))}
            </div>
          </div>
          {detail && (
            <div className="text-xs text-gray-600 dark:text-slate-400">
              <p className="font-semibold">{t('risks:vulns.usedIn')}</p>
              {(detail.risks || []).length === 0 && !detail.hidden_risk_count ? <p>–</p> : (
                <ul className="list-disc pl-4">
                  {(detail.risks || []).map(r => <li key={r.id}>{r.ref} {r.title}</li>)}
                  {(detail.hidden_risk_count || 0) > 0 && <li>{t('risks:vulns.hiddenRisks', { count: detail.hidden_risk_count })}</li>}
                </ul>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('risks:buttons.cancel')}</Button>
            {canManage && <Button type="submit" className="flex-1 justify-center">{t('risks:buttons.saveChanges')}</Button>}
          </div>
        </form>
      </Modal>

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t('risks:vulns.importFromAsset')} size="lg">
        <div className="space-y-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:vulns.importHint')}</p>
          <Select label={t('risks:vulns.asset')} value={importAsset} onChange={e => pickAsset(e.target.value)} options={[{ value: '', label: t('risks:form.select') }, ...assets.map(a => ({ value: String(a.id), label: a.name }))]} />
          {importAsset && (
            <Card>
              <CardHeader className="pb-2"><h3 className="text-sm font-semibold dark:text-white">{t('risks:vulns.cvesOfAsset', { count: cves.length })}</h3></CardHeader>
              <CardBody className="space-y-1 max-h-72 overflow-y-auto">
                {cves.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400 italic">{t('risks:vulns.noCves')}</p>}
                {cves.map(c => {
                  const done = !!c.vulnerability?.linked_to_asset;
                  return (
                    <label key={c.cve_id} className={`flex items-start gap-2 p-1.5 rounded ${done ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                      <input type="checkbox" className="mt-0.5 w-4 h-4 rounded text-blue-600" disabled={done} checked={done || cveSel.includes(c.cve_id)}
                        onChange={() => setCveSel(s => (s.includes(c.cve_id) ? s.filter(x => x !== c.cve_id) : [...s, c.cve_id]))} />
                      <span className="text-xs dark:text-slate-300">
                        <span className="font-mono font-semibold">{c.cve_id}</span> {sevBadge(c.severity)} {c.cvss_score != null && <span>CVSS {c.cvss_score}</span>}
                        {c.description && <span className="block text-gray-500 dark:text-slate-400 line-clamp-2">{c.description}</span>}
                        {c.vulnerability && <span className="block text-[10px] text-blue-700 dark:text-blue-300">{done ? t('risks:vulns.alreadyLinked', { ref: c.vulnerability.ref }) : t('risks:vulns.willLink', { ref: c.vulnerability.ref })}</span>}
                      </span>
                    </label>
                  );
                })}
              </CardBody>
            </Card>
          )}
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setImportOpen(false)} className="flex-1 justify-center">{t('risks:buttons.cancel')}</Button>
            <Button type="button" onClick={doImport} disabled={importing || cveSel.length === 0} className="flex-1 justify-center">{t('risks:vulns.importSelected', { count: cveSel.length })}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
