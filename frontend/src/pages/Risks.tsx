import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShieldAlert, Grid3x3, Trash2, AlertTriangle, CheckCircle, ShieldCheck, Download, FileSpreadsheet, ChevronRight, Search, Shield, FolderOpen, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKeyShortcut } from '../hooks/useKeyShortcut';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import i18n from '../i18n';
import api from '../lib/api';
import type { Risk, Asset, User, Threat, Control, RiskLevel, RiskTreatment, RiskStatus, Template } from '../types';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { exportToCSV, exportToExcel } from '../lib/export';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

const emptyRisk = {
  title: '', description: '', category: 'it_security', owner_id: '',
  likelihood: 3, impact: 3, treatment: 'mitigate' as RiskTreatment, treatment_plan: '',
  status: 'open' as RiskStatus, review_date: '',
  asset_ids: [] as number[], threat_ids: [] as number[],
  controls: [] as { id: number; effectiveness: number }[],
};

export const Risks: React.FC = () => {
  const { t } = useTranslation(['risks', 'common']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  const levelLabels: Record<RiskLevel, string> = {
    low: t('risks:levels.low'),
    medium: t('risks:levels.medium'),
    high: t('risks:levels.high'),
    critical: t('risks:levels.critical'),
  };

  const categoryLabels: Record<string, string> = {
    it_security: t('risks:categories.it_security'),
    privacy: t('risks:categories.privacy'),
    compliance: t('risks:categories.compliance'),
    operational: t('risks:categories.operational'),
    financial: t('risks:categories.financial'),
    reputation: t('risks:categories.reputation'),
    ai_risk: t('risks:categories.ai_risk'),
    supply_chain: t('risks:categories.supply_chain'),
    other: t('risks:categories.other'),
  };

  const treatmentLabels: Record<RiskTreatment, string> = {
    mitigate: t('risks:treatment.mitigate'),
    accept: t('risks:treatment.accept'),
    transfer: t('risks:treatment.transfer'),
    avoid: t('risks:treatment.avoid'),
  };

  const statusLabels: Record<RiskStatus, string> = {
    open: t('risks:status.open'),
    in_treatment: t('risks:status.in_treatment'),
    accepted: t('risks:status.accepted'),
    closed: t('risks:status.closed'),
  };

  const ratingLabels = [
    '',
    t('risks:ratings.1'),
    t('risks:ratings.2'),
    t('risks:ratings.3'),
    t('risks:ratings.4'),
    t('risks:ratings.5'),
  ];

  const fwLabels: Record<string, string> = {
    iso27001: t('common:frameworks.iso27001'),
    nis2: t('common:frameworks.nis2'),
    bsi: t('common:frameworks.bsi'),
    custom: t('common:frameworks.custom'),
  };

  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const [risks, setRisks] = useState<Risk[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [allControls, setAllControls] = useState<Control[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyRisk });
  const [saving, setSaving] = useState(false);
  const [controlSearch, setControlSearch] = useState('');
  const [signoffUntil, setSignoffUntil] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);

  const [assetSearch, setAssetSearch] = useState('');
  const [threatSearch, setThreatSearch] = useState('');

  const filteredAssets = useMemo(() => {
    return assets.filter(a => a.name.toLowerCase().includes(assetSearch.toLowerCase()));
  }, [assets, assetSearch]);

  const filteredThreats = useMemo(() => {
    return threats.filter(t => t.title.toLowerCase().includes(threatSearch.toLowerCase()) || (t.code || '').toLowerCase().includes(threatSearch.toLowerCase()));
  }, [threats, threatSearch]);

  const handleDownload = async (id: number, origName: string) => {
    try {
      const response = await api.get(`/templates/${id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', origName);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t('risks:toast.downloadError'));
    }
  };

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return <FileSpreadsheet className="text-emerald-600 dark:text-emerald-400" size={18} />;
    if (ext === 'pdf') return <FileText className="text-rose-500" size={18} />;
    if (ext === 'docx' || ext === 'doc') return <FileText className="text-blue-600 dark:text-blue-400" size={18} />;
    if (ext === 'pptx' || ext === 'ppt') return <FileText className="text-orange-500 dark:text-orange-400" size={18} />;
    if (ext === 'zip') return <FileText className="text-amber-500 dark:text-amber-400" size={18} />;
    return <FileText className="text-slate-500" size={18} />;
  };

  const load = () => api.get('/risks').then(r => setRisks(Array.isArray(r.data) ? r.data : [])).catch(() => setRisks([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/assets').then(r => setAssets(r.data)).catch(() => setAssets([]));
    api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([]));
    api.get('/threats').then(r => setThreats(r.data)).catch(() => setThreats([]));
    api.get('/controls').then(r => setAllControls(r.data)).catch(() => setAllControls([]));
    api.get('/templates?category=risk').then(r => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  const stats = useMemo(() => {
    const total = risks.length;
    const critical = risks.filter(r => r.inherent_level === 'critical' || r.inherent_level === 'high').length;
    const inTreatment = risks.filter(r => r.status === 'in_treatment' || r.status === 'open').length;
    const accepted = risks.filter(r => r.status === 'accepted').length;
    return { total, critical, inTreatment, accepted };
  }, [risks]);

  const filtered = useMemo(() => risks.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (categoryFilter && r.category !== categoryFilter) return false;
    if (levelFilter && r.inherent_level !== levelFilter) return false;
    if (search && !`${r.ref} ${r.title}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [risks, statusFilter, categoryFilter, levelFilter, search]);

  const openNew = () => {
    setEditId(null);
    setForm({ ...emptyRisk });
    setAssetSearch('');
    setThreatSearch('');
    setModalOpen(true);
  };
  const openEdit = (r: Risk) => {
    setEditId(r.id);
    setForm({
      title: r.title, description: r.description || '', category: r.category || 'it_security',
      owner_id: r.owner_id ? String(r.owner_id) : '',
      likelihood: r.likelihood, impact: r.impact,
      treatment: r.treatment || 'mitigate', treatment_plan: r.treatment_plan || '',
      status: r.status, review_date: r.review_date ? r.review_date.split('T')[0] : '',
      asset_ids: (r.assets || []).map(a => a.id),
      threat_ids: (r.threats || []).map(t => t.id),
      controls: (r.controls || []).map(c => ({ id: c.id, effectiveness: (c as any).RiskControl?.effectiveness || 3 })),
    });
    setAssetSearch('');
    setThreatSearch('');
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.owner_id) {
      toast.error(t('risks:form.ownerRequired'));
      return;
    }
    setSaving(true);
    try {
      if (editId) await api.put(`/risks/${editId}`, form);
      else await api.post('/risks', form);
      setModalOpen(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); }
    finally { setSaving(false); }
  };

  const remove = async (r: Risk) => {
    if (!confirm(t('risks:confirm.delete', { ref: r.ref || r.title }))) return;
    try { await api.delete(`/risks/${r.id}`); load(); } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorDelete')); }
  };

  const doSignoff = async () => {
    if (!editId) return;
    try {
      await api.patch(`/risks/${editId}/signoff`, { valid_until: signoffUntil || null });
      setSignoffUntil(''); load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorSignoff')); }
  };

  const revokeSignoff = async () => {
    if (!editId || !confirm(t('risks:confirm.revokeSignoff'))) return;
    try { await api.patch(`/risks/${editId}/revoke`); load(); } catch { toast.error(t('risks:toast.errorDelete')); }
  };

  const toggleAsset = (id: number) => setForm(f => ({ ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id] }));
  const toggleThreat = (id: number) => setForm(f => ({ ...f, threat_ids: f.threat_ids.includes(id) ? f.threat_ids.filter(x => x !== id) : [...f.threat_ids, id] }));
  const toggleControl = (id: number) => setForm(f => ({ ...f, controls: f.controls.find(x => x.id === id) ? f.controls.filter(x => x.id !== id) : [...f.controls, { id, effectiveness: 3 }] }));
  const setControlEff = (id: number, val: number) => setForm(f => ({ ...f, controls: f.controls.map(x => x.id === id ? { ...x, effectiveness: val } : x) }));

  const visControls = useMemo(() => allControls.filter(c => {
    if (!controlSearch) return true;
    return `${c.code || ''} ${c.title}`.toLowerCase().includes(controlSearch.toLowerCase());
  }), [allControls, controlSearch]);

  const flattenForExport = (rows: Risk[]) => rows.map(r => ({
    [t('risks:table.ref')]: r.ref,
    [t('risks:table.risk')]: r.title,
    [t('risks:form.category')]: categoryLabels[r.category!] || r.category,
    [t('common:fields.owner')]: r.owner?.name || '',
    [t('risks:table.inherent')]: levelLabels[r.inherent_level!],
    [t('risks:form.likelihood')]: r.likelihood,
    [t('risks:form.impact')]: r.impact,
    [t('risks:form.treatment')]: treatmentLabels[r.treatment || 'mitigate'],
    [t('risks:table.status')]: statusLabels[r.status],
    [t('risks:form.acceptedBy', { name: '' }).trim()]: r.acceptedBy?.name || '',
    [t('risks:acceptedUntil')]: r.accepted_until ? format(new Date(r.accepted_until), 'dd.MM.yyyy', { locale: dateFnsLocale }) : '',
    [t('risks:form.nextReview')]: r.review_date ? format(new Date(r.review_date), 'dd.MM.yyyy', { locale: dateFnsLocale }) : '',
  }));

  useKeyShortcut('n', openNew, { disabled: loading || editId !== null });
  useKeyShortcut('/', () => {
    (document.querySelector(`input[placeholder="${t('risks:searchPlaceholder')}"]`) as HTMLInputElement)?.focus();
  }, { disabled: loading });

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  const editingRisk = risks.find(r => r.id === editId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('risks:registerTitle')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('risks:subtitle', { count: risks.length })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(flattenForExport(risks), `risks-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(flattenForExport(risks), `risks-${format(new Date(), 'yyyyMMdd')}`, 'Risiken')}><FileSpreadsheet size={14} />Excel</Button>
          {canWrite && <Button onClick={openNew}><Plus size={16} />{t('risks:new')}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-red-500 shrink-0"><ShieldAlert className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.critical}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.criticalHigh')}</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-orange-500 shrink-0"><AlertTriangle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.inTreatment}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.inTreatment')}</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-green-600 shrink-0"><CheckCircle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.accepted}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.accepted')}</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-blue-500 shrink-0"><Grid3x3 className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.total}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.total')}</p></div></CardBody></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
          <Card className="space-y-4">
            <FilterBar
              search={search} onSearch={setSearch} searchPlaceholder={t('risks:searchPlaceholder')}
              activeCount={[statusFilter, categoryFilter, levelFilter].filter(Boolean).length}
              onReset={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); setLevelFilter(''); }}>
              <Select className="w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
              <Select className="w-40" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allCategories') }, ...Object.entries(categoryLabels).map(([v, l]) => ({ value: v, label: l }))]} />
              <Select className="w-40" value={levelFilter} onChange={e => setLevelFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allLevels') }, ...Object.entries(levelLabels).map(([v, l]) => ({ value: v, label: l }))]} />
            </FilterBar>

            <Card className="!border-0 shadow-none">
              <CardBody className="p-0">
                {/* Mobile card list (< sm) */}
                <div className="sm:hidden">
                  {filtered.length === 0 && risks.length === 0 ? (
                    <div className="py-12 text-center px-6">
                      <p className="text-gray-500 dark:text-slate-400 font-medium">{t('risks:empty.title')}</p>
                      <p className="text-sm text-gray-400 dark:text-slate-500 mt-1 mb-4">{t('risks:empty.subtitle')}</p>
                      {canWrite && (
                        <button onClick={openNew}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                          <Plus size={15} />{t('risks:empty.createFirst')}
                        </button>
                      )}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="py-12 text-center px-6">
                      <p className="text-gray-400 dark:text-slate-500">{t('risks:noFilter')}</p>
                      <button onClick={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); setLevelFilter(''); }}
                        className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        {t('common:actions.reset')}
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y dark:divide-slate-800/50">
                      {filtered.map(r => (
                        <div key={r.id}
                          className="px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                          onClick={() => openEdit(r)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-[10px] text-gray-400 dark:text-slate-500">{r.ref}</p>
                              <p className="text-sm font-medium dark:text-slate-200 mt-0.5 leading-snug">{r.title}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5">{categoryLabels[r.category!] || r.category}</p>
                            </div>
                            {canWrite && (
                              <button onClick={e => { e.stopPropagation(); remove(r); }} className="text-gray-300 hover:text-red-500 transition-colors p-1 shrink-0">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <Badge value={r.inherent_level!} label={levelLabels[r.inherent_level!]} />
                            {r.residual_level && (
                              <>
                                <ChevronRight size={12} className="text-gray-300" />
                                <Badge value={r.residual_level} label={levelLabels[r.residual_level]} />
                              </>
                            )}
                            <span className="text-[10px] text-gray-400 dark:text-slate-500 ml-auto">{statusLabels[r.status]}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Desktop table (sm+) */}
                <div className="hidden sm:block">
                  <Table>
                    <Thead><tr><Th>{t('risks:table.ref')}</Th><Th>{t('risks:table.risk')}</Th><Th>{t('risks:table.inherent')}</Th><Th>{t('risks:table.residual')}</Th><Th>{t('risks:table.status')}</Th><Th>{''}</Th></tr></Thead>
                    <Tbody>
                      {filtered.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => openEdit(r)}>
                          <Td className="font-mono text-xs text-gray-500">{r.ref}</Td>
                          <Td>
                            <p className="text-sm font-medium dark:text-slate-200">{r.title}</p>
                            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                               <span>{categoryLabels[r.category!] || r.category}</span>
                               {(r.assets?.length || 0) > 0 && <span className="flex items-center gap-0.5"><Shield size={10} />{r.assets!.length}</span>}
                            </p>
                          </Td>
                          <Td><Badge value={r.inherent_level!} label={levelLabels[r.inherent_level!]} /></Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              {r.residual_level ? (
                                <>
                                  <Badge value={r.residual_level} label={levelLabels[r.residual_level]} />
                                  {(r.inherent_level !== r.residual_level) && <span className="text-[10px] text-green-600 font-bold">-{Math.round((r.inherent_likelihood * r.inherent_impact - (r.residual_likelihood || 0) * (r.residual_impact || 0)) / (r.inherent_likelihood * r.inherent_impact || 1) * 100)}%</span>}
                                </>
                              ) : <span className="text-xs text-gray-300 italic">{t('risks:notTreated')}</span>}
                            </div>
                          </Td>
                          <Td>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium dark:text-slate-400">{statusLabels[r.status]}</span>
                              {r.status === 'accepted' && r.accepted_until && (
                                <span className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1"><ShieldCheck size={10} />{t('risks:acceptedUntil')} {format(new Date(r.accepted_until), 'dd.MM.yy', { locale: dateFnsLocale })}</span>
                              )}
                            </div>
                          </Td>
                          <Td className="text-right">
                             {canWrite && <button onClick={(e) => { e.stopPropagation(); remove(r); }} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>}
                          </Td>
                        </tr>
                      ))}
                      {filtered.length === 0 && risks.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center">
                            <p className="text-gray-500 dark:text-slate-400 font-medium">{t('risks:empty.title')}</p>
                            <p className="text-sm text-gray-400 dark:text-slate-500 mt-1 mb-4">{t('risks:empty.subtitle')}</p>
                            {canWrite && (
                              <button onClick={openNew}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                                <Plus size={15} />{t('risks:empty.createFirst')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                      {filtered.length === 0 && risks.length > 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-12 text-center">
                            <p className="text-gray-400 dark:text-slate-500">{t('risks:noFilter')}</p>
                            <button onClick={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); setLevelFilter(''); }}
                              className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                              {t('common:actions.reset')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </Tbody>
                  </Table>
                </div>
              </CardBody>
            </Card>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b dark:border-slate-800">
              <div className="flex items-center gap-2">
                <FolderOpen className="text-orange-500 dark:text-orange-400" size={18} />
                <h2 className="text-sm font-semibold dark:text-white">{t('risks:templates.title')}</h2>
              </div>
              {user?.role !== 'viewer' && user?.role !== 'management' && ['admin', 'it-staff', 'assessor'].includes(user?.role || '') && (
                <Link to="/policies?tab=templates" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('risks:templates.manage')}</Link>
              )}
            </CardHeader>
            <CardBody className="pt-4 space-y-3">
              {templates.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-slate-500 italic">{t('risks:templates.empty')}</p>
              ) : (
                <div className="space-y-2">
                  {templates.map(t => (
                    <div key={t.id} className="flex items-start justify-between gap-2 p-2 rounded-lg border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 hover:bg-gray-100/50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="mt-0.5 shrink-0">
                          {getFileIcon(t.filename)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold dark:text-white truncate" title={t.title}>{t.title}</p>
                          <p className="text-[10px] text-gray-400 dark:text-slate-500 truncate" title={t.original_name}>{t.original_name}</p>
                          {t.description && <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{t.description}</p>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownload(t.id, t.original_name)}
                        className="p-1 rounded-md hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white shrink-0 cursor-pointer"
                        title="Download"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('risks:modal.editTitle') : t('risks:modal.newTitle')} size="xl">
        <form onSubmit={save} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label={t('risks:form.title')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder={t('risks:form.titlePlaceholder')} />
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.description')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('risks:form.descriptionPlaceholder')} />
            </div>

            <Select label={t('risks:form.category')} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={Object.entries(categoryLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <SearchableSelect label={t('risks:form.owner')} value={String(form.owner_id || '')} onChange={val => setForm({ ...form, owner_id: val })} options={[{ value: '', label: t('risks:form.select') }, ...users.map(u => ({ value: String(u.id), label: u.name }))]} />

            <section className="md:col-span-2 p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('risks:form.inherentSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select label={t('risks:form.likelihood')} value={String(form.likelihood)} onChange={e => setForm({ ...form, likelihood: parseInt(e.target.value) })} options={[1,2,3,4,5].map(n => ({ value: String(n), label: ratingLabels[n] }))} />
                <Select label={t('risks:form.impact')} value={String(form.impact)} onChange={e => setForm({ ...form, impact: parseInt(e.target.value) })} options={[1,2,3,4,5].map(n => ({ value: String(n), label: ratingLabels[n] }))} />
              </div>
            </section>

            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.affectedAssets', { count: form.asset_ids.length })}</label>
              <div className="relative flex items-center mb-1">
                <Search className="absolute left-3 text-gray-400" size={14} />
                <input type="text" placeholder={t('risks:form.assetFilter')} value={assetSearch} onChange={e => setAssetSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-32 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 bg-white dark:bg-slate-900/50 custom-scrollbar">
                {filteredAssets.length === 0 ? (
                   <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">{t('risks:form.noAssets')}</p>
                ) : (
                  filteredAssets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                      <input type="checkbox" checked={form.asset_ids.includes(a.id)} onChange={() => toggleAsset(a.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 truncate">{a.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.relevantThreats', { count: form.threat_ids.length })}</label>
              <div className="relative flex items-center mb-1">
                <Search className="absolute left-3 text-gray-400" size={14} />
                <input type="text" placeholder={t('risks:form.threatFilter')} value={threatSearch} onChange={e => setThreatSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-32 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 bg-white dark:bg-slate-900/50 custom-scrollbar">
                {filteredThreats.length === 0 ? (
                   <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">{t('risks:form.noThreats')}</p>
                ) : (
                  filteredThreats.map(t => (
                    <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                      <input type="checkbox" checked={form.threat_ids.includes(t.id)} onChange={() => toggleThreat(t.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 truncate"><span className="font-mono text-xs text-gray-400 mr-2">{t.code}</span>{t.title}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <Select label={t('risks:form.treatment')} value={form.treatment} onChange={e => setForm({ ...form, treatment: e.target.value as RiskTreatment })} options={Object.entries(treatmentLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Select label={t('risks:table.status')} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as RiskStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} />

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.treatmentPlan')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.treatment_plan} onChange={e => setForm({ ...form, treatment_plan: e.target.value })} />
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.linkedControls', { count: form.controls.length })}</label>
              <Input placeholder={t('risks:form.controlSearch')} value={controlSearch} onChange={e => setControlSearch(e.target.value)} />
              <div className="max-h-44 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 space-y-0.5 bg-white dark:bg-slate-900/50">
                {visControls.slice(0, 60).map(c => {
                  const sel = form.controls.find(x => x.id === c.id);
                  return (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={!!sel} onChange={() => toggleControl(c.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 flex-1 truncate">
                        <span className="text-[10px] font-bold uppercase text-gray-400 mr-1">{fwLabels[c.framework]}</span>
                        {c.code ? <span className="font-mono text-xs text-gray-400 mr-1">{c.code}</span> : null}{c.title}
                        <span className={`ml-1 text-[10px] ${c.status === 'implemented' ? 'text-green-600' : 'text-gray-400'}`}>({c.status === 'implemented' ? t('risks:controlStatus.implemented') : c.status === 'planned' ? t('risks:controlStatus.planned') : t('risks:controlStatus.na')})</span>
                      </span>
                      {sel && (
                        <select value={sel.effectiveness} onChange={e => setControlEff(c.id, parseInt(e.target.value))} title={t('risks:form.controlEffectiveness')} className="text-xs border dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 dark:text-slate-200 px-1 py-0.5">
                          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>W{n}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400" dangerouslySetInnerHTML={{ __html: t('risks:form.controlHint') }} />
            </div>

            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <section className="p-4 rounded-xl border dark:border-slate-800 bg-blue-50/30 dark:bg-blue-900/10 space-y-2">
                <h3 className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 tracking-wider">{t('risks:form.residualSection')}</h3>
                {editingRisk?.residual_level ? (
                  <div className="flex items-center gap-2">
                    <Badge value={editingRisk.residual_level} label={levelLabels[editingRisk.residual_level]} />
                    <span className="text-xs text-gray-500">W{editingRisk.residual_likelihood} × A{editingRisk.residual_impact}</span>
                  </div>
                ) : <p className="text-xs text-gray-400 italic">{t('risks:form.residualPending')}</p>}
              </section>
              <Input label={t('risks:form.nextReview')} type="date" value={form.review_date} onChange={e => setForm({ ...form, review_date: e.target.value })} />
            </div>

            {editId && (
              <div className="md:col-span-2 p-4 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50/50 dark:bg-green-900/10 space-y-3">
                <h3 className="text-xs font-bold uppercase text-green-700 dark:text-green-400 flex items-center gap-1.5"><ShieldCheck size={13} /> {t('risks:form.signoff')}</h3>
                {editingRisk?.acceptedBy ? (
                  <div className="flex items-center justify-between">
                    <div className="text-sm">
                      <p className="dark:text-slate-300 font-medium">{t('risks:form.acceptedBy', { name: editingRisk.acceptedBy.name })}</p>
                      <p className="text-xs text-gray-500">{t('risks:form.acceptedAt', { date: editingRisk.accepted_at ? new Date(editingRisk.accepted_at).toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-GB') : '–' })}{editingRisk.accepted_until ? ` ${t('risks:form.acceptedUntil', { date: new Date(editingRisk.accepted_until).toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-GB') })}` : ''}</p>
                    </div>
                    <button type="button" onClick={revokeSignoff} className="text-xs text-red-600 dark:text-red-400 hover:underline font-bold uppercase">{t('risks:form.revokeSignoff')}</button>
                  </div>
                ) : (
                  <div className="flex items-end gap-4">
                    <div className="flex-1"><Input label={t('risks:form.signoffDate')} type="date" value={signoffUntil} onChange={e => setSignoffUntil(e.target.value)} /></div>
                    <Button type="button" variant="secondary" className="bg-white dark:bg-slate-900" onClick={doSignoff}><ShieldCheck size={14} />{t('risks:form.digitalSignoff')}</Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('risks:buttons.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? t('risks:buttons.saving') : (editId ? t('risks:buttons.saveChanges') : t('risks:buttons.createRisk'))}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
