import React, { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Plus, Trash2, Download, Pencil, Building, ShieldCheck, FileCheck, FileCode, Eye, Link2, Shield, Server, Search, FolderOpen, CheckCircle, Users } from 'lucide-react';
import { FilterBar } from '../components/ui/FilterBar';
import api from '../lib/api';
import type { Policy, Asset, Control, Template } from '../types';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { format } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

const categoryLabels = {
  policy: 'categoryLabels.policy',
  guideline: 'categoryLabels.guideline',
  procedure: 'categoryLabels.procedure',
  contract: 'categoryLabels.contract',
  other: 'categoryLabels.other'
};

const templateCategoryLabels = {
  general: 'templateCategoryLabels.general',
  asset: 'templateCategoryLabels.asset',
  risk: 'templateCategoryLabels.risk',
  assessment: 'templateCategoryLabels.assessment',
  incident: 'templateCategoryLabels.incident',
  policy: 'templateCategoryLabels.policy',
};

const categoryIcons = {
  policy: ShieldCheck,
  guideline: FileCheck,
  procedure: FileCode,
  contract: Building,
  other: FileText
};

const statusLabels = {
  draft: 'statusLabels.draft',
  active: 'statusLabels.active',
  retired: 'statusLabels.retired'
};

const fwLabels: Record<string, string> = {
  iso27001: 'fwLabels.iso27001',
  nis2: 'fwLabels.nis2',
  bsi: 'fwLabels.bsi',
  custom: 'fwLabels.custom'
};

const emptyForm = { 
  title: '', code: '', description: '', category: 'policy' as 'policy' | 'guideline' | 'procedure' | 'contract' | 'other', 
  status: 'active' as 'draft' | 'active' | 'retired', 
  version: '1.0', valid_from: '', valid_until: '', 
  asset_ids: [] as number[], control_ids: [] as number[] 
};

export const PolicyLibrary: React.FC = () => {
  const { t } = useTranslation('policylibrary');
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const canEdit = user?.role === 'admin' || user?.role === 'assessor' || user?.role === 'dpo';

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'templates' ? 'templates' : 'documents';
  const [activeTab, setActiveTab] = useState<'documents' | 'templates'>(initialTab);

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editPolicy, setEditPolicy] = useState<Policy | null>(null);
  const [docType, setDocType] = useState<'document' | 'template'>('document');
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [templateForm, setTemplateForm] = useState({
    title: '',
    description: '',
    category: 'general' as Template['category'],
  });
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [controlSearch, setControlSearch] = useState('');
  const [myAcks, setMyAcks] = useState<{ policy_id: number; acknowledged_at: string }[]>([]);
  const [ackModalOpen, setAckModalOpen] = useState(false);
  const [ackPolicy, setAckPolicy] = useState<Policy | null>(null);
  const [ackList, setAckList] = useState<{ user?: { name: string; email: string }; acknowledged_at: string }[]>([]);
  const [ackLoading, setAckLoading] = useState(false);

  const handleTabChange = (tab: 'documents' | 'templates') => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setCatFilter('');
  };

  const handleViewPdf = async (url: string) => {
    try {
      const response = await api.get(url, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      setPdfUrl(blobUrl);
    } catch (err: any) {
      const status = err?.response?.status;
      let detail = '';
      try { if (err?.response?.data instanceof Blob) detail = JSON.parse(await err.response.data.text())?.error || ''; } catch { /* ignore */ }
      toast.error(`${t('toast.pdfLoadError')}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
    }
  };

  const handleDownloadTemplate = async (id: number, origName: string) => {
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
      toast.error(t('toast.downloadFailed'));
    }
  };

  const deleteTemplate = async (id: number, tTitle: string) => {
    if (!confirm(t('confirm.deleteTemplate', { title: tTitle }))) return;
    try {
      await api.delete(`/templates/${id}`);
      toast.success(t('toast.templateDeleted'));
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.deleteError'));
    }
  };

  const load = async () => {
    try {
      const [pRes, aRes, cRes, tRes, ackRes] = await Promise.all([
        api.get('/policies'),
        api.get('/assets'),
        api.get('/controls'),
        api.get('/templates'),
        api.get('/policies/acknowledgments/me').catch(() => ({ data: [] })),
      ]);
      setPolicies(pRes.data);
      setAssets(aRes.data);
      setControls(cRes.data);
      setTemplates(tRes.data);
      setMyAcks(ackRes.data);
    } catch {
      toast.error(t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAcknowledge = async (p: Policy) => {
    try {
      await api.post(`/policies/${p.id}/acknowledge`);
      toast.success(t('toast.acknowledged', { title: p.title }));
      const ackRes = await api.get('/policies/acknowledgments/me');
      setMyAcks(ackRes.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.acknowledgeError'));
    }
  };

  const openAckList = async (p: Policy) => {
    setAckPolicy(p);
    setAckList([]);
    setAckLoading(true);
    setAckModalOpen(true);
    try {
      const res = await api.get(`/policies/${p.id}/acknowledgments`);
      setAckList(res.data);
    } catch {
      toast.error(t('toast.acknowledgmentsLoadError'));
    } finally {
      setAckLoading(false);
    }
  };

  const openNew = () => {
    setEditPolicy(null);
    setForm(emptyForm);
    setTemplateForm({ title: '', description: '', category: 'general' });
    setDocType(activeTab === 'templates' ? 'template' : 'document');
    setFile(null);
    setModalOpen(true);
  };

  const openEdit = (p: Policy) => {
    setEditPolicy(p);
    setDocType('document');
    setForm({
      title: p.title,
      code: p.code || '',
      description: p.description || '',
      category: p.category,
      status: p.status,
      version: p.version,
      valid_from: p.valid_from ? p.valid_from.split('T')[0] : '',
      valid_until: p.valid_until ? p.valid_until.split('T')[0] : '',
      asset_ids: (p.assets || []).map(a => a.id),
      control_ids: (p as any).controls?.map((c: any) => c.id) || []
    });
    setFile(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const formData = new FormData();
      
      if (docType === 'template') {
        if (!file) {
          toast.error(t('toast.selectFileError'));
          setSaving(false);
          return;
        }
        formData.append('title', templateForm.title);
        formData.append('description', templateForm.description);
        formData.append('category', templateForm.category);
        formData.append('file', file);
        await api.post('/templates', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success(t('toast.templateUploaded'));
      } else {
        // Filter out empty dates and handle arrays
        Object.entries(form).forEach(([key, value]) => {
          if (key === 'asset_ids' || key === 'control_ids') {
            formData.append(key, JSON.stringify(value));
          } else if ((key === 'valid_from' || key === 'valid_until') && !value) {
            // Skip empty date strings so they are sent as null/undefined
          } else {
            formData.append(key, value as string);
          }
        });
        
        if (file) formData.append('file', file);

        if (editPolicy) {
          await api.put(`/policies/${editPolicy.id}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
          toast.success(t('toast.documentUpdated'));
        } else {
          await api.post('/policies', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
          toast.success(t('toast.documentCreated'));
        }
      }
      
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const deletePolicy = async (id: number) => {
    if (!confirm(t('confirm.deletePolicy'))) return;
    try {
      await api.delete(`/policies/${id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.deletePolicyFailed'));
    }
  };

  const filteredControls = useMemo(() => controls.filter(c => 
    !controlSearch || `${c.code || ''} ${c.title}`.toLowerCase().includes(controlSearch.toLowerCase())
  ), [controls, controlSearch]);

  const isRestricted = user?.role === 'it-staff' || (user?.role === 'viewer' || user?.role === 'management');

  const filtered = policies.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(search.toLowerCase()) || p.code?.toLowerCase().includes(search.toLowerCase());
    const matchesCat = !catFilter || p.category === catFilter;
    const matchesStatus = !statusFilter || p.status === statusFilter;
    const matchesVisibility = !isRestricted || p.category !== 'contract';
    return matchesSearch && matchesCat && matchesStatus && matchesVisibility;
  });

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase()) || t.original_name.toLowerCase().includes(search.toLowerCase()) || t.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCat = !catFilter || t.category === catFilter;
    return matchesSearch && matchesCat;
  });

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {activeTab === 'documents' 
              ? t('documentsCount', { count: filtered.length, total: policies.length }) 
              : t('templatesCount', { count: filteredTemplates.length, total: templates.length })}
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew}>
            <Plus size={16} /> {activeTab === 'documents' ? t('addDocument') : t('uploadTemplate')}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b dark:border-slate-800">
        <button
          onClick={() => handleTabChange('documents')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'documents'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {t('documents')}
        </button>
        <button
          onClick={() => handleTabChange('templates')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'templates'
              ? 'border-purple-500 text-purple-600 dark:text-purple-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {t('templates')}
        </button>
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder={activeTab === 'documents' ? t('searchPlaceholder.documents') : t('searchPlaceholder.templates')}
        activeCount={activeTab === 'documents' ? [catFilter, statusFilter].filter(Boolean).length : [catFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setCatFilter(''); setStatusFilter(''); }}>
        <Select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="w-44"
          options={[
            { value: '', label: t('filter.allCategories') },
            ...Object.entries(activeTab === 'documents' ? categoryLabels : templateCategoryLabels).map(([v, l]) => ({ value: v, label: t(l) }))
          ]}
        />
        {activeTab === 'documents' && (
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-44"
            options={[{ value: '', label: t('filter.allStatuses') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: t(l) }))]} />
        )}
      </FilterBar>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {activeTab === 'documents' ? (
          filtered.map(policy => {
            const Icon = categoryIcons[policy.category as keyof typeof categoryIcons] || FileText;
            return (
              <Card key={policy.id} className="flex flex-col h-full hover:shadow-md transition-all border-l-4 border-l-blue-500 group">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
                      <Icon size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{policy.code || t('noAbbreviation')}</p>
                      <h3 className="font-bold dark:text-white leading-tight group-hover:text-blue-600 transition-colors">{policy.title}</h3>
                    </div>
                  </div>
                  <Badge value={policy.status} label={t(statusLabels[policy.status as keyof typeof statusLabels])} />
                </CardHeader>
                <CardBody className="flex-1 flex flex-col pt-0">
                  <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2 mb-4 h-10">{policy.description || t('noDescription')}</p>
                  
                  <div className="mt-auto space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                       <div className="space-y-1">
                          <p className="text-[9px] font-bold text-gray-400 uppercase">{t('assetsLabel')}</p>
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                             <Server size={12}/> {policy.assets?.length || 0}
                          </div>
                       </div>
                       <div className="space-y-1 text-right">
                          <p className="text-[9px] font-bold text-gray-400 uppercase text-right">{t('tomReference')}</p>
                          <div className="flex items-center justify-end gap-1.5 text-xs text-gray-500">
                             <Shield size={12}/> {(policy as any).controls?.length || 0}
                          </div>
                       </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t dark:border-slate-800">
                      <div className="flex flex-col">
                         <span className="font-bold text-blue-600 dark:text-blue-400">Version {policy.version}</span>
                         {policy.category === 'contract' ? (
                            <span>{policy.valid_until ? t('validUntil', { date: format(new Date(policy.valid_until), 'dd.MM.yyyy') }) : t('noExpirationDate')}</span>
                         ) : (
                            <span>{policy.valid_from ? t('validFrom', { date: format(new Date(policy.valid_from), 'dd.MM.yyyy') }) : t('noDateSet')}</span>
                         )}
                      </div>
                      <div className="flex gap-1 flex-wrap">
                        {(() => {
                          const ack = myAcks.find(a => a.policy_id === policy.id);
                          return ack ? (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-400 px-2 py-1 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-900/40" title={t('acknowledgedAt', { date: format(new Date(ack.acknowledged_at), 'dd.MM.yyyy HH:mm') })}>
                              <CheckCircle size={11} /> {t('acknowledgedStatus')}
                            </span>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => handleAcknowledge(policy)} title={t('acknowledgeTooltip')} className="text-xs">
                              <CheckCircle size={12} /> {t('acknowledgeAction')}
                            </Button>
                          );
                        })()}
                        {canEdit && (
                          <Button size="sm" variant="secondary" onClick={() => openAckList(policy)} title={t('ackOverviewTooltip')}>
                            <Users size={12} />
                          </Button>
                        )}
                        {policy.file_url && (
                          <div className="flex gap-1">
                            {policy.original_filename?.toLowerCase().endsWith('.pdf') && (
                               <Button size="sm" variant="secondary" onClick={() => handleViewPdf(`/policies/${policy.id}/download?inline=true`)} title={t('viewTooltip')}><Eye size={14} /></Button>
                            )}
                            <a href={`/api/policies/${policy.id}/download`} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="secondary" title={t('downloadTooltip')}><Download size={14} /></Button>
                            </a>
                          </div>
                        )}
                        {canEdit && (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => openEdit(policy)} title={t('editTooltip')}><Pencil size={14} /></Button>
                            {user?.role === 'admin' && <Button size="sm" variant="secondary" onClick={() => deletePolicy(policy.id)} className="text-red-500 hover:bg-red-50" title={t('deleteTooltip')}><Trash2 size={14} /></Button>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })
        ) : (
          filteredTemplates.map(template => {
            return (
              <Card key={template.id} className="flex flex-col h-full hover:shadow-md transition-all border-l-4 border-l-purple-500 group">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg text-purple-600 dark:text-purple-400 shrink-0">
                      <FolderOpen size={20} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold dark:text-white leading-tight group-hover:text-purple-600 transition-colors truncate" title={template.title}>{template.title}</h3>
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 truncate" title={template.original_name}>{template.original_name}</p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <Badge value={template.category} label={templateCategoryLabels[template.category] ? t(templateCategoryLabels[template.category]) : template.category} />
                  </div>
                </CardHeader>
                <CardBody className="flex-1 flex flex-col pt-0">
                  <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-3 mb-2 h-15">{template.description || t('noDescription')}</p>
                  
                  <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-4">
                    {t('uploadedBy', { uploader: template.uploader?.name || t('unknown'), date: format(new Date(template.created_at), 'dd.MM.yyyy') })}
                  </p>

                  <div className="mt-auto space-y-4">
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t dark:border-slate-800">
                      <div>
                        {template.category !== 'general' ? (
                          <Link 
                            to={template.category === 'asset' ? '/assets' : template.category === 'risk' ? '/risks' : template.category === 'assessment' ? '/assessments' : template.category === 'incident' ? '/incidents' : '/policies?tab=documents'}
                            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            {t('area', { category: templateCategoryLabels[template.category] ? t(templateCategoryLabels[template.category]) : template.category })} <Link2 size={10} />
                          </Link>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('area', { category: t(templateCategoryLabels.general) })}</span>
                        )}
                      </div>
                      
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleDownloadTemplate(template.id, template.original_name)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
                          title={t('downloadTooltip')}
                        >
                          <Download size={14} />
                        </button>
                        {user?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={() => deleteTemplate(template.id, template.title)}
                            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                            title={t('deleteTooltip')}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editPolicy ? t('updateDocument') : (docType === 'template' ? t('uploadTemplate') : t('createDocument'))} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {!editPolicy && (
              <div className="flex gap-4 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-2xl md:col-span-2 justify-center">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm dark:text-white">
                  <input 
                    type="radio" 
                    name="docType" 
                    checked={docType === 'document'} 
                    onChange={() => setDocType('document')} 
                    className="w-4 h-4 text-blue-600" 
                  />
                  {t('document')}
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-sm dark:text-white">
                  <input 
                    type="radio" 
                    name="docType" 
                    checked={docType === 'template'} 
                    onChange={() => setDocType('template')} 
                    className="w-4 h-4 text-purple-600" 
                  />
                  {t('template')}
                </label>
              </div>
            )}

            {docType === 'template' ? (
              <>
                <div className="md:col-span-2">
                  <Input 
                    label={t('templateTitleLabel')} 
                    value={templateForm.title} 
                    onChange={e => setTemplateForm({ ...templateForm, title: e.target.value })} 
                    required 
                    placeholder={t('templateTitlePlaceholder')} 
                  />
                </div>
                <Select 
                  label={t('assignedAreaLabel')} 
                  value={templateForm.category} 
                  onChange={e => setTemplateForm({ ...templateForm, category: e.target.value as any })} 
                  options={Object.entries(templateCategoryLabels).map(([v, l]) => ({ value: v, label: t(l) }))} 
                />
                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('descriptionPurposeLabel')}</label>
                  <textarea 
                    className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" 
                    rows={3} 
                    value={templateForm.description} 
                    onChange={e => setTemplateForm({ ...templateForm, description: e.target.value })} 
                    placeholder={t('descriptionPurposePlaceholder')}
                  />
                </div>
                <div className="md:col-span-2 p-4 bg-purple-50 dark:bg-purple-900/10 rounded-2xl border-2 border-dashed border-purple-200 dark:border-purple-800">
                  <label className="text-sm font-bold text-purple-800 dark:text-purple-300 block mb-3">{t('uploadFileLabel')}</label>
                  <input 
                    type="file" 
                    onChange={e => setFile(e.target.files?.[0] || null)} 
                    required 
                    className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:uppercase file:bg-purple-600 file:text-white hover:file:bg-purple-700 cursor-pointer" 
                  />
                </div>
              </>
            ) : (
              <>
                <div className="md:col-span-2">
                  <Input label={t('documentTitleLabel')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder={t('documentTitlePlaceholder')} />
                </div>
                <Input label={t('codeLabel')} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder={t('codePlaceholder')} />
                <Input label={t('versionLabel')} value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="1.0" />
                
                <Select label={t('categoryLabel')} value={form.category} onChange={e => {
                  const newCat = e.target.value as any;
                  setForm({ 
                    ...form, 
                    category: newCat,
                    valid_until: newCat === 'contract' ? form.valid_until : '',
                    valid_from: newCat === 'contract' ? '' : form.valid_from
                  });
                }} 
                  options={Object.entries(categoryLabels).map(([v, l]) => ({ value: v, label: t(l) }))} />
                <Select label={t('statusLabel')} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as any })} 
                  options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: t(l) }))} />

                <div className="md:col-span-2">
                   {form.category === 'contract' ? (
                      <Input label={t('validUntilLabel')} type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} />
                   ) : (
                      <Input label={t('validFromLabel')} type="date" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} />
                   )}
                </div>

                <div className="md:col-span-2 flex flex-col gap-1">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('shortDescriptionLabel')}</label>
                  <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>

                <div className="md:col-span-2 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border-2 border-dashed border-blue-200 dark:border-blue-800">
                  <label className="text-sm font-bold text-blue-800 dark:text-blue-300 block mb-3">{editPolicy ? t('uploadNewFileLabel') : t('uploadFileLabel')}</label>
                  <input type="file" onChange={e => setFile(e.target.files?.[0] || null)} required={!editPolicy} className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:uppercase file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer" />
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-2"><Server size={14}/> {t('scopeAssetsLabel', { count: form.asset_ids.length })}</label>
                  <div className="max-h-48 overflow-y-auto p-2 border dark:border-slate-700 rounded-xl bg-gray-50/30 dark:bg-slate-800/20 space-y-1">
                    {assets.map(a => (
                      <label key={a.id} className="flex items-center gap-2 p-1.5 hover:bg-white dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-all border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                        <input type="checkbox" checked={form.asset_ids.includes(a.id)} 
                          onChange={e => setForm(f => ({ ...f, asset_ids: e.target.checked ? [...f.asset_ids, a.id] : f.asset_ids.filter(id => id !== a.id) }))} 
                          className="w-4 h-4 rounded text-blue-600" />
                        <span className="text-xs dark:text-slate-300 truncate">{a.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-2"><Shield size={14}/> {t('coveredControlsLabel', { count: form.control_ids.length })}</label>
                  <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={12} />
                     <input type="text" placeholder={t('searchControlPlaceholder')} value={controlSearch} onChange={e => setControlSearch(e.target.value)} className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-hidden" />
                  </div>
                  <div className="max-h-40 overflow-y-auto p-2 border dark:border-slate-700 rounded-xl bg-gray-50/30 dark:bg-slate-800/20 space-y-1">
                    {filteredControls.map(c => (
                      <label key={c.id} className="flex items-center gap-2 p-1.5 hover:bg-white dark:hover:bg-slate-800 rounded-lg cursor-pointer transition-all border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                        <input type="checkbox" checked={form.control_ids.includes(c.id)} 
                          onChange={e => setForm(f => ({ ...f, control_ids: e.target.checked ? [...f.control_ids, c.id] : f.control_ids.filter(id => id !== c.id) }))} 
                          className="w-4 h-4 rounded text-blue-600" />
                        <div className="min-w-0 flex-1">
                           <p className="text-[10px] font-bold text-gray-400 uppercase leading-none">{t(fwLabels[c.framework]) || c.framework} {c.code}</p>
                           <p className="text-xs dark:text-slate-300 truncate">{c.title}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('cancelBtn')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? t('savingStatus') : (editPolicy ? t('updateBtn') : (docType === 'template' ? t('uploadTemplate') : t('createBtn')))}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!pdfUrl} onClose={() => setPdfUrl(null)} title={t('documentView')} size="xl">
         <div className="w-full h-[75vh] bg-gray-100 dark:bg-slate-900 rounded-lg overflow-hidden border dark:border-slate-800 relative">
            {!pdfUrl ? null : (
               <iframe src={pdfUrl} className="w-full h-full border-0" title="PDF Viewer" />
            )}
         </div>
      </Modal>

      <Modal open={ackModalOpen} onClose={() => setAckModalOpen(false)} title={t('acknowledgmentsTitle', { title: ackPolicy?.title || '' })} size="md">
        <div className="space-y-3">
          {ackLoading ? (
            <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
          ) : ackList.length === 0 ? (
            <p className="text-center text-gray-400 dark:text-slate-500 py-8">{t('noAcknowledgments')}</p>
          ) : (
            <div className="divide-y dark:divide-slate-800">
              {ackList.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium dark:text-slate-200">{a.user?.name || '–'}</p>
                    <p className="text-xs text-gray-400">{a.user?.email}</p>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1">
                    <CheckCircle size={12} className="text-green-500" />
                    {format(new Date(a.acknowledged_at), 'dd.MM.yyyy HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 dark:text-slate-500 text-center pt-2">{t('acknowledgmentsCount', { count: ackList.length })}</p>
        </div>
      </Modal>
    </div>
  );
};
