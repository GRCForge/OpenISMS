import React, { useEffect, useMemo, useState } from 'react';
import { Plus, AlertOctagon, Flame, Trash2, Link2, ShieldAlert, Clock, ShieldCheck, Paperclip, Download, Search } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import api from '../lib/api';
import type { Incident, Asset, User as UserType, Risk, IncidentCategory, IncidentSeverity, IncidentStatus } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

const emptyForm = {
  title: '', description: '', category: 'other' as IncidentCategory, severity: 'medium' as IncidentSeverity, status: 'reported' as IncidentStatus, assignee_id: '',
  detected_at: '', occurred_at: '', resolved_at: '', nis2_reportable: false, early_warning_at: '', notification_at: '',
  is_security_incident: true, is_gdpr_incident: false,
  impact: '', root_cause: '', corrective_actions: '',
  lessons_learned: '', affected_systems: 0, data_breach_details: '', external_report_id: '',
  gdpr_breach_discovered_at: '', gdpr_notified_at: '',
  asset_ids: [] as number[], risk_ids: [] as number[],
};

const toLocalInput = (s?: string) => (s ? new Date(s).toISOString().slice(0, 16) : '');

const deadlineInfo = (inc: Incident, t: TFunc): { label: string; overdue: boolean } | null => {
  if (!inc.nis2_reportable || !inc.detected_at) return null;
  const base = new Date(inc.detected_at).getTime();
  const now = Date.now();
  if (!inc.early_warning_at) {
    const dl = base + 24 * 3600 * 1000;
    return { label: now > dl ? t('incidents:nis2.overdueWarning') : t('incidents:nis2.earlyWarningOpen'), overdue: now > dl };
  }
  if (!inc.notification_at) {
    const dl = base + 72 * 3600 * 1000;
    return { label: now > dl ? t('incidents:nis2.reportingOverdue') : t('incidents:nis2.reportingOpen'), overdue: now > dl };
  }
  return { label: t('incidents:nis2.reported'), overdue: false };
};

const gdprDeadlineInfo = (inc: Incident, t: TFunc): { label: string; overdue: boolean; hoursLeft?: number } | null => {
  if (!inc.is_gdpr_incident || !inc.gdpr_breach_discovered_at) return null;
  if (inc.gdpr_notified_at) return { label: t('incidents:gdpr.reported'), overdue: false };
  const deadline = new Date(inc.gdpr_breach_discovered_at).getTime() + 72 * 3600 * 1000;
  const now = Date.now();
  const hoursLeft = Math.ceil((deadline - now) / 3600000);
  return {
    label: now > deadline ? t('incidents:gdpr.overdue') : t('incidents:gdpr.remaining', { hours: hoursLeft }),
    overdue: now > deadline,
    hoursLeft,
  };
};

export const Incidents: React.FC = () => {
  const { t } = useTranslation(['incidents', 'common']);
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'security' | 'gdpr'>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [assetSearch, setAssetSearch] = useState('');
  const [riskSearch, setRiskSearch] = useState('');

  const sevLabels = useMemo<Record<string, string>>(() => ({
    low: t('incidents:severity.low'),
    medium: t('incidents:severity.medium'),
    high: t('incidents:severity.high'),
    critical: t('incidents:severity.critical'),
  }), [t]);

  const statusLabels = useMemo<Record<string, string>>(() => ({
    reported: t('incidents:status.reported'),
    investigating: t('incidents:status.investigating'),
    contained: t('incidents:status.contained'),
    resolved: t('incidents:status.resolved'),
    closed: t('incidents:status.closed'),
  }), [t]);

  const catLabels = useMemo<Record<string, string>>(() => ({
    malware: t('incidents:categories.malware'),
    phishing: t('incidents:categories.phishing'),
    data_breach: t('incidents:categories.data_breach'),
    dos: t('incidents:categories.dos'),
    unauthorized_access: t('incidents:categories.unauthorized_access'),
    misconfiguration: t('incidents:categories.misconfiguration'),
    loss_theft: t('incidents:categories.loss_theft'),
    social_engineering: t('incidents:categories.social_engineering'),
    other: t('incidents:categories.other'),
  }), [t]);

  const filteredAssets = useMemo(() => {
    return assets.filter(a => a.name.toLowerCase().includes(assetSearch.toLowerCase()));
  }, [assets, assetSearch]);

  const filteredRisks = useMemo(() => {
    return risks.filter(r => r.title.toLowerCase().includes(riskSearch.toLowerCase()));
  }, [risks, riskSearch]);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedIncidentForDelete, setSelectedIncidentForDelete] = useState<Incident | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [selectedIncidentForDocs, setSelectedIncidentForDocs] = useState<Incident | null>(null);
  const [incidentDocs, setIncidentDocs] = useState<any[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm, setDocForm] = useState({ category: 'other', description: '' });

  const openDelete = (i: Incident) => {
    setSelectedIncidentForDelete(i);
    setDeleteReason('');
    setDeleteModalOpen(true);
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncidentForDelete || !deleteReason.trim()) return;
    try {
      await api.delete(`/incidents/${selectedIncidentForDelete.id}`, {
        data: { deletion_reason: deleteReason }
      });
      toast.success(t('incidents:toast.deleted'));
      setDeleteModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('incidents:toast.errorDelete'));
    }
  };

  const loadDocs = (incidentId: number) => {
    api.get(`/incidents/${incidentId}/documents`)
      .then(r => setIncidentDocs(r.data))
      .catch(() => setIncidentDocs([]));
  };

  const openDocs = (i: Incident) => {
    setSelectedIncidentForDocs(i);
    setDocForm({ category: 'other', description: '' });
    setDocFile(null);
    setIncidentDocs([]);
    setDocsModalOpen(true);
    loadDocs(i.id);
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncidentForDocs || !docFile) return;
    setUploadingDoc(true);
    const formData = new FormData();
    formData.append('file', docFile);
    formData.append('category', docForm.category);
    formData.append('description', docForm.description);

    try {
      await api.post(`/incidents/${selectedIncidentForDocs.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success(t('incidents:toast.docUploaded'));
      setDocFile(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadDocs(selectedIncidentForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('incidents:toast.errorUpload'));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDocDelete = async (docId: number) => {
    if (!selectedIncidentForDocs || !confirm(t('incidents:confirm.deleteDoc'))) return;
    try {
      await api.delete(`/incidents/${selectedIncidentForDocs.id}/documents/${docId}`);
      toast.success(t('incidents:toast.docDeleted'));
      loadDocs(selectedIncidentForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('incidents:toast.errorDeleteDoc'));
    }
  };

  const load = () => api.get('/incidents').then(r => setIncidents(Array.isArray(r.data) ? r.data : [])).catch(() => setIncidents([])).finally(() => setLoading(false));
  useEffect(() => {
    load();
    api.get('/assets').then(r => setAssets(r.data)).catch(() => setAssets([]));
    api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([]));
    api.get('/risks').then(r => setRisks(r.data)).catch(() => setRisks([]));
  }, []);

  const filtered = useMemo(() => incidents.filter(i => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (sevFilter && i.severity !== sevFilter) return false;
    if (typeFilter === 'security' && !i.is_security_incident) return false;
    if (typeFilter === 'gdpr' && !i.is_gdpr_incident) return false;
    if (search && !`${i.ref} ${i.title}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [incidents, statusFilter, sevFilter, typeFilter, search]);

  const stats = useMemo(() => ({
    open: incidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length,
    critical: incidents.filter(i => i.severity === 'critical' || i.severity === 'high').length,
    gdpr: incidents.filter(i => i.is_gdpr_incident).length,
    total: incidents.length,
  }), [incidents]);

  const openNew = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setAssetSearch('');
    setRiskSearch('');
    setModalOpen(true);
  };
  const openEdit = (i: Incident) => {
    setEditId(i.id);
    setForm({
      title: i.title, description: i.description || '', category: i.category, severity: i.severity, status: i.status,
      assignee_id: i.assignee_id ? String(i.assignee_id) : '',
      detected_at: toLocalInput(i.detected_at), occurred_at: toLocalInput(i.occurred_at), resolved_at: toLocalInput(i.resolved_at),
      nis2_reportable: !!i.nis2_reportable, early_warning_at: toLocalInput(i.early_warning_at), notification_at: toLocalInput(i.notification_at),
      is_security_incident: !!i.is_security_incident, is_gdpr_incident: !!i.is_gdpr_incident,
      impact: i.impact || '', root_cause: i.root_cause || '', corrective_actions: i.corrective_actions || '',
      lessons_learned: i.lessons_learned || '', affected_systems: i.affected_systems || 0,
      data_breach_details: i.data_breach_details || '', external_report_id: i.external_report_id || '',
      gdpr_breach_discovered_at: toLocalInput(i.gdpr_breach_discovered_at),
      gdpr_notified_at: toLocalInput(i.gdpr_notified_at),
      asset_ids: (i.assets || []).map(a => a.id), risk_ids: (i.risks || []).map(r => r.id),
    });
    setAssetSearch('');
    setRiskSearch('');
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    if (!form.is_security_incident && !form.is_gdpr_incident) {
      toast.warning(t('incidents:toast.classificationRequired'));
      setSaving(false);
      return;
    }
    try {
      const payload = { ...form, assignee_id: form.assignee_id || null };
      if (editId) await api.put(`/incidents/${editId}`, payload);
      else await api.post('/incidents', payload);
      setModalOpen(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('incidents:toast.errorSaving')); }
    finally { setSaving(false); }
  };

  const toggle = (key: 'asset_ids' | 'risk_ids', id: number) =>
    setForm(f => ({ ...f, [key]: f[key].includes(id) ? f[key].filter(x => x !== id) : [...f[key], id] }));

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('incidents:title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('incidents:subtitle', { count: incidents.length })}</p>
        </div>
        {canWrite && <Button onClick={openNew}><Plus size={16} />{t('incidents:new')}</Button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: AlertOctagon, label: t('incidents:stats.open'), value: stats.open, color: 'bg-orange-500' },
          { icon: Flame, label: t('incidents:stats.criticalHigh'), value: stats.critical, color: 'bg-red-500' },
          { icon: ShieldAlert, label: t('incidents:stats.gdprRelevance'), value: stats.gdpr, color: 'bg-blue-600' },
          { icon: AlertOctagon, label: t('incidents:stats.total'), value: stats.total, color: 'bg-blue-500' },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div><p className="text-2xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder={t('incidents:searchPlaceholder')}
        activeCount={[statusFilter, sevFilter, typeFilter !== 'all'].filter(Boolean).length}
        onReset={() => { setSearch(''); setStatusFilter(''); setSevFilter(''); setTypeFilter('all'); }}>
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('incidents:filters.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-40" value={sevFilter} onChange={e => setSevFilter(e.target.value)} options={[{ value: '', label: t('incidents:filters.allSeverities') }, ...Object.entries(sevLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-40" value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} options={[
          { value: 'all', label: t('incidents:filters.allTypes') },
          { value: 'security', label: t('incidents:filters.security') },
          { value: 'gdpr', label: t('incidents:filters.gdpr') },
        ]} />
      </FilterBar>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead><tr>
              <Th>{t('incidents:table.ref')}</Th>
              <Th>{t('incidents:table.incident')}</Th>
              <Th>{t('incidents:table.type')}</Th>
              <Th>{t('incidents:table.severity')}</Th>
              <Th>{t('incidents:table.status')}</Th>
              <Th>{t('incidents:table.detected')}</Th>
              <Th>{t('incidents:table.deadline')}</Th>
              <Th>{''}</Th>
            </tr></Thead>
            <Tbody>
              {filtered.map(i => {
                const dl = deadlineInfo(i, t);
                const gdprDl = gdprDeadlineInfo(i, t);
                return (
                  <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => openEdit(i)}>
                    <Td className="font-mono text-xs text-gray-500">{i.ref || `#${i.id}`}</Td>
                    <Td>
                      <p className="font-medium dark:text-slate-200">{i.title}</p>
                      <p className="text-[11px] text-gray-400 flex items-center gap-2">
                        <span>{catLabels[i.category]}</span>
                        {(i.assets?.length || 0) > 0 && <span className="flex items-center gap-0.5"><Link2 size={10} />{i.assets!.length}</span>}
                      </p>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {i.is_security_incident && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Security</span>}
                        {i.is_gdpr_incident && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">GDPR</span>}
                      </div>
                    </Td>
                    <Td><Badge value={i.severity} label={sevLabels[i.severity]} /></Td>
                    <Td><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400">{statusLabels[i.status]}</span></Td>
                    <Td className="whitespace-nowrap">{i.detected_at ? format(new Date(i.detected_at), 'dd.MM.yy HH:mm') : '–'}</Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        {dl && <span className={`text-[11px] font-medium flex items-center gap-1 ${dl.overdue ? 'text-red-600 dark:text-red-400' : 'text-orange-500'}`}><Clock size={11} />{dl.label}</span>}
                        {gdprDl && <span className={`text-[11px] font-medium flex items-center gap-1 ${gdprDl.overdue ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}><ShieldAlert size={11} />{gdprDl.label}</span>}
                        {!dl && !gdprDl && <span className="text-xs text-gray-300">–</span>}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => openDocs(i)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors" title={t('incidents:docs.manageTitle')}>
                          <Paperclip size={14} />
                        </button>
                        {canWrite && (
                          <button onClick={() => openDelete(i)} className="text-gray-300 hover:text-red-500 p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors" title={t('incidents:delete.confirmButton')}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8}>
                  <div className="py-16 text-center">
                    <AlertOctagon size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                    <p className="text-gray-500 dark:text-slate-400 font-medium">{t('incidents:empty.title')}</p>
                    <button onClick={openNew} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors">
                      <Plus size={15} /> {t('incidents:new')}
                    </button>
                  </div>
                </td></tr>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('incidents:modal.editTitle') : t('incidents:modal.newTitle')} size="xl">
        <form onSubmit={save} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2 grid grid-cols-2 gap-4">
              <label className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all cursor-pointer ${form.is_security_incident ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-200 dark:border-slate-800 hover:border-orange-200'}`}>
                <input type="checkbox" checked={form.is_security_incident} onChange={e => setForm({ ...form, is_security_incident: e.target.checked })} className="hidden" />
                <Flame size={24} className={form.is_security_incident ? 'text-orange-600' : 'text-gray-400'} />
                <span className={`text-sm font-bold mt-2 ${form.is_security_incident ? 'text-orange-700 dark:text-orange-400' : 'text-gray-500'}`}>{t('incidents:form.securityIncident')}</span>
              </label>
              <label className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all cursor-pointer ${form.is_gdpr_incident ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-800 hover:border-blue-200'}`}>
                <input type="checkbox" checked={form.is_gdpr_incident} onChange={e => setForm({ ...form, is_gdpr_incident: e.target.checked })} className="hidden" />
                <ShieldCheck size={24} className={form.is_gdpr_incident ? 'text-blue-600' : 'text-gray-400'} />
                <span className={`text-sm font-bold mt-2 ${form.is_gdpr_incident ? 'text-blue-700 dark:text-blue-400' : 'text-gray-500'}`}>{t('incidents:form.gdprIncident')}</span>
              </label>
            </div>

            <div className="md:col-span-2">
              <Input label={t('incidents:form.title')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder={t('incidents:form.titlePlaceholder')} />
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:form.description')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('incidents:form.descriptionPlaceholder')} />
            </div>

            <Select label={t('incidents:form.category')} value={form.category} onChange={e => setForm({ ...form, category: e.target.value as any })} options={Object.entries(catLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Select label={t('incidents:form.severity')} value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value as any })} options={Object.entries(sevLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Select label={t('incidents:form.status')} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <SearchableSelect label={t('incidents:form.assignee')} value={form.assignee_id} onChange={val => setForm({ ...form, assignee_id: val })} options={[{ value: '', label: t('incidents:form.noAssignee') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))] } />

            <Input label={t('incidents:form.detectedAt')} type="datetime-local" value={form.detected_at} onChange={e => setForm({ ...form, detected_at: e.target.value })} />
            <Input label={t('incidents:form.occurredAt')} type="datetime-local" value={form.occurred_at} onChange={e => setForm({ ...form, occurred_at: e.target.value })} />

            <div className="md:col-span-2 p-4 rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-900/10 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.nis2_reportable} onChange={e => setForm({ ...form, nis2_reportable: e.target.checked })} className="w-4 h-4 rounded text-purple-600" />
                <span className="text-sm font-bold text-purple-700 dark:text-purple-300">{t('incidents:form.nis2Reportable')}</span>
              </label>
              {form.nis2_reportable && (
                <div className="grid grid-cols-2 gap-4">
                  <Input label={t('incidents:form.earlyWarning')} type="datetime-local" value={form.early_warning_at} onChange={e => setForm({ ...form, early_warning_at: e.target.value })} />
                  <Input label={t('incidents:form.notification72h')} type="datetime-local" value={form.notification_at} onChange={e => setForm({ ...form, notification_at: e.target.value })} />
                </div>
              )}
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:form.impact')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.impact} onChange={e => setForm({ ...form, impact: e.target.value })} placeholder={t('incidents:form.impactPlaceholder')} />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:form.rootCause')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.root_cause} onChange={e => setForm({ ...form, root_cause: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:form.correctiveActions')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.corrective_actions} onChange={e => setForm({ ...form, corrective_actions: e.target.value })} />
            </div>

            {(form.category === 'data_breach' || form.is_gdpr_incident || form.nis2_reportable) && (
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  {t('incidents:form.dataBreachDetails')}
                </label>
                <textarea className="bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/40 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} placeholder={t('incidents:form.dataBreachPlaceholder')} value={form.data_breach_details} onChange={e => setForm({ ...form, data_breach_details: e.target.value })} />
              </div>
            )}

            {form.is_gdpr_incident && (
              <div className="md:col-span-2 p-4 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
                <p className="text-sm font-bold text-blue-700 dark:text-blue-300 flex items-center gap-2">
                  <ShieldAlert size={15} />
                  {t('incidents:form.gdprArt33')}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <Input label={t('incidents:form.gdprDiscoveredAt')} type="datetime-local" value={form.gdpr_breach_discovered_at} onChange={e => setForm({ ...form, gdpr_breach_discovered_at: e.target.value })} />
                  <Input label={t('incidents:form.gdprNotifiedAt')} type="datetime-local" value={form.gdpr_notified_at} onChange={e => setForm({ ...form, gdpr_notified_at: e.target.value })} />
                </div>
                {form.gdpr_breach_discovered_at && !form.gdpr_notified_at && (() => {
                  const deadline = new Date(form.gdpr_breach_discovered_at).getTime() + 72 * 3600 * 1000;
                  const hoursLeft = Math.ceil((deadline - Date.now()) / 3600000);
                  const overdue = Date.now() > deadline;
                  return (
                    <p className={`text-xs font-medium flex items-center gap-1.5 ${overdue ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-300'}`}>
                      <Clock size={12} />
                      {overdue
                        ? t('incidents:form.gdprDeadlineOverdue', { hours: Math.abs(hoursLeft) })
                        : t('incidents:form.gdprDeadlineLeft', { hours: hoursLeft, deadline: new Date(deadline).toLocaleString(i18n.language === 'de' ? 'de-DE' : 'en-GB') })}
                    </p>
                  );
                })()}
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:form.affectedAssets')}</label>
              <div className="relative flex items-center mb-1">
                <Search className="absolute left-3 text-gray-400" size={14} />
                <input type="text" placeholder={t('incidents:form.assetFilter')} value={assetSearch} onChange={e => setAssetSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-40 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 space-y-1 bg-gray-50/30 dark:bg-slate-800/20 custom-scrollbar">
                {assets.length === 0 && <p className="text-xs text-gray-400 p-2">{t('incidents:form.noAssetsLoaded')}</p>}
                {assets.length > 0 && filteredAssets.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">{t('incidents:form.noAssetsFound')}</p>
                ) : (
                  filteredAssets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                      <input type="checkbox" checked={form.asset_ids.includes(a.id)} onChange={() => toggle('asset_ids', a.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 truncate">{a.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:form.linkedRisks')}</label>
              <div className="relative flex items-center mb-1">
                <Search className="absolute left-3 text-gray-400" size={14} />
                <input type="text" placeholder={t('incidents:form.riskFilter')} value={riskSearch} onChange={e => setRiskSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-40 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 space-y-1 bg-gray-50/30 dark:bg-slate-800/20 custom-scrollbar">
                {risks.length === 0 && <p className="text-xs text-gray-400 p-2">{t('incidents:form.noRisksLoaded')}</p>}
                {risks.length > 0 && filteredRisks.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">{t('incidents:form.noRisksFound')}</p>
                ) : (
                  filteredRisks.map(r => (
                    <label key={r.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                      <input type="checkbox" checked={form.risk_ids.includes(r.id)} onChange={() => toggle('risk_ids', r.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 truncate"><span className="font-mono text-xs text-gray-400 mr-1">{r.ref}</span>{r.title}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('incidents:buttons.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? t('incidents:buttons.saving') : t('incidents:buttons.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title={t('incidents:delete.modalTitle')} size="md">
        <form onSubmit={handleDelete} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            {t('incidents:delete.description')}
          </p>
          <Input
            label={t('incidents:delete.reasonLabel')}
            value={deleteReason}
            onChange={e => setDeleteReason(e.target.value)}
            required
            placeholder={t('incidents:delete.reasonPlaceholder')}
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteModalOpen(false)} className="flex-1 justify-center">{t('incidents:buttons.cancel')}</Button>
            <Button type="submit" variant="danger" disabled={!deleteReason.trim()} className="flex-1 justify-center">{t('incidents:delete.confirmButton')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={docsModalOpen} onClose={() => setDocsModalOpen(false)} title={t('incidents:modal.docsTitle', { ref: selectedIncidentForDocs?.ref || '' })} size="xl">
        <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <form onSubmit={handleDocUpload} className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 space-y-4">
            <h3 className="text-sm font-bold dark:text-white">{t('incidents:docs.uploadTitle')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label={t('incidents:docs.category')}
                value={docForm.category}
                onChange={e => setDocForm(f => ({ ...f, category: e.target.value }))}
                options={[
                  { value: 'risk_report', label: t('incidents:docs.catRiskReport') },
                  { value: 'risk_acceptance', label: t('incidents:docs.catRiskAcceptance') },
                  { value: 'other', label: t('incidents:docs.catOther') }
                ]}
              />
              <Input
                label={t('incidents:docs.description')}
                value={docForm.description}
                onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t('incidents:docs.descriptionPlaceholder')}
              />
              <div className="md:col-span-2 flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('incidents:docs.fileLabel')}</label>
                <input
                  type="file"
                  onChange={e => setDocFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-800 dark:file:text-slate-300"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={uploadingDoc} className="px-6">
                {uploadingDoc ? t('incidents:docs.uploading') : t('incidents:docs.addDocument')}
              </Button>
            </div>
          </form>

          <div className="space-y-3">
            <h3 className="text-sm font-bold dark:text-white">{t('incidents:docs.listTitle')}</h3>
            {incidentDocs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-6 border border-dashed dark:border-slate-800 rounded-xl">{t('incidents:docs.empty')}</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800 border dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                {incidentDocs.map(doc => (
                  <div key={doc.id} className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm dark:text-white truncate">{doc.original_name}</span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {doc.category === 'risk_report' ? t('incidents:docs.catReport') : doc.category === 'risk_acceptance' ? t('incidents:docs.catAcceptance') : t('incidents:docs.catOther')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{doc.description || t('incidents:docs.noDescription')}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {t('incidents:docs.uploadedAt', {
                          date: format(new Date(doc.created_at || Date.now()), 'dd.MM.yyyy HH:mm'),
                          uploader: doc.uploader?.name || t('incidents:docs.unknownUploader'),
                          size: (doc.size / 1024 / 1024).toFixed(2),
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`${api.defaults.baseURL}/incidents/${selectedIncidentForDocs?.id}/documents/${doc.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors"
                        title={t('incidents:docs.download')}
                      >
                        <Download size={18} />
                      </a>
                      {canWrite && (
                        <button
                          onClick={() => handleDocDelete(doc.id)}
                          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-red-600 transition-colors"
                          title={t('common:actions.delete')}
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};
