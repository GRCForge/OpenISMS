import React, { useEffect, useRef, useState } from 'react';
import { Building2, Plus, Pencil, Trash2, Globe, ShieldCheck, ExternalLink, ShieldAlert, User, Clock, CheckCircle, Paperclip, Download, Bot, ChevronDown, ChevronRight, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { Vendor, RiskLevel } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { hasWriteAccess } from '../lib/permissions';

const emptyVendor = { name: '', type: 'software', website: '', phone: '', address: '', notes: '' };

export const Vendors: React.FC = () => {
  const { t, i18n } = useTranslation(['vendors', 'common']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  const typeLabels: Record<string, string> = {
    software: t('vendors:types.software'),
    cloud: t('vendors:types.cloud'),
    hardware: t('vendors:types.hardware'),
    consulting: t('vendors:types.consulting'),
    hosting: t('vendors:types.hosting'),
    logistics: t('vendors:types.logistics'),
    other: t('vendors:types.other'),
    it_provider: t('vendors:types.it_provider'),
  };

  const typeOptions = [
    { value: 'software', label: t('vendors:types.software') },
    { value: 'cloud', label: t('vendors:types.cloud') },
    { value: 'hardware', label: t('vendors:types.hardware') },
    { value: 'consulting', label: t('vendors:types.consulting') },
    { value: 'hosting', label: t('vendors:types.hosting') },
    { value: 'logistics', label: t('vendors:types.logistics') },
    { value: 'other', label: t('vendors:types.other') },
  ];

  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [dpaFilter, setDpaFilter] = useState('');
  const [certFilter, setCertFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState(emptyVendor);
  const [saving, setSaving] = useState(false);

  const [assessModalOpen, setAssessModalOpen] = useState(false);
  const [assessVendor, setAssessVendor] = useState<Vendor | null>(null);
  const [assessForm, setAssessForm] = useState({
    risk_level: 'medium' as RiskLevel,
    risk_score: '',
    next_review_date: '',
    dpa_signed: false,
    dpa_signed_at: '',
    iso27001_certified: false,
    soc2_certified: false,
    gdpr_compliant: false,
    data_processor: false,
    fourth_party_risks: '',
    assessment_notes: ''
  });
  const [assessing, setAssessing] = useState(false);

  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [selectedVendorForDocs, setSelectedVendorForDocs] = useState<Vendor | null>(null);

  const [triageModalOpen, setTriageModalOpen] = useState(false);
  const [triageVendor, setTriageVendor] = useState<Vendor | null>(null);
  const [triageDocs, setTriageDocs] = useState<any[]>([]);
  const [triageRuns, setTriageRuns] = useState<any[]>([]);
  const [triageForm, setTriageForm] = useState({ document_id: '', doc_type: 'avv' });
  const [triageStarting, setTriageStarting] = useState(false);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [runDetails, setRunDetails] = useState<Record<number, any>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [vendorDocs, setVendorDocs] = useState<any[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm, setDocForm] = useState({ category: 'dpa', description: '' });

  const loadDocs = (vendorId: number) => {
    api.get(`/vendors/${vendorId}/documents`)
      .then(r => setVendorDocs(r.data))
      .catch(() => setVendorDocs([]));
  };

  const openDocs = (v: Vendor) => {
    setSelectedVendorForDocs(v);
    setDocForm({ category: 'dpa', description: '' });
    setDocFile(null);
    setVendorDocs([]);
    setDocsModalOpen(true);
    loadDocs(v.id);
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForDocs || !docFile) return;
    setUploadingDoc(true);
    const formData = new FormData();
    formData.append('file', docFile);
    formData.append('category', docForm.category);
    formData.append('description', docForm.description);

    try {
      await api.post(`/vendors/${selectedVendorForDocs.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success(t('vendors:toast.docUploaded'));
      setDocFile(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadDocs(selectedVendorForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('vendors:toast.docUploadError'));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDocDelete = async (docId: number) => {
    if (!selectedVendorForDocs || !confirm(t('vendors:confirm.deleteDoc'))) return;
    try {
      await api.delete(`/vendors/${selectedVendorForDocs.id}/documents/${docId}`);
      toast.success(t('vendors:toast.docDeleted'));
      loadDocs(selectedVendorForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('vendors:toast.docDeleteError'));
    }
  };

  const loadTriageRuns = (vendorId: number) =>
    api.get(`/vendors/${vendorId}/triage`).then(r => setTriageRuns(r.data)).catch(() => setTriageRuns([]));

  const openTriage = (v: Vendor) => {
    setTriageVendor(v);
    setTriageRuns([]);
    setExpandedRun(null);
    setRunDetails({});
    setTriageForm({ document_id: '', doc_type: 'avv' });
    setTriageModalOpen(true);
    api.get(`/vendors/${v.id}/documents`).then(r => {
      const docs = r.data.filter((d: any) => ['pdf', 'docx', 'txt'].some(ext => d.original_name?.toLowerCase().endsWith(ext)) || ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'].includes(d.mimetype));
      setTriageDocs(docs);
      if (docs.length > 0) setTriageForm(f => ({ ...f, document_id: String(docs[0].id) }));
    }).catch(() => setTriageDocs([]));
    loadTriageRuns(v.id);
  };

  const startTriage = async () => {
    if (!triageVendor || !triageForm.document_id) return;
    setTriageStarting(true);
    try {
      await api.post(`/vendors/${triageVendor.id}/triage`, {
        document_id: parseInt(triageForm.document_id),
        doc_type: triageForm.doc_type,
      });
      toast.success(t('vendors:triage.triage_started'));
      loadTriageRuns(triageVendor.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        if (triageVendor) loadTriageRuns(triageVendor.id);
      }, 4000);
    } catch (err: any) {
      const msg = err.response?.data?.error || '';
      if (msg.toLowerCase().includes('not configured') || msg.toLowerCase().includes('api key')) {
        toast.error(t('vendors:triage.llm_not_configured'));
      } else {
        toast.error(t('vendors:triage.triage_error'));
      }
    } finally { setTriageStarting(false); }
  };

  const loadRunDetails = async (runId: number) => {
    if (runDetails[runId]) { setExpandedRun(expandedRun === runId ? null : runId); return; }
    try {
      const r = await api.get(`/vendors/${triageVendor?.id}/triage/${runId}`);
      setRunDetails(d => ({ ...d, [runId]: r.data }));
      setExpandedRun(runId);
    } catch { /* ignore */ }
  };

  const deleteTriage = async (runId: number) => {
    if (!triageVendor || !confirm(t('vendors:triage.delete_confirm'))) return;
    try {
      await api.delete(`/vendors/${triageVendor.id}/triage/${runId}`);
      setTriageRuns(rs => rs.filter(r => r.id !== runId));
      setRunDetails(d => { const nd = { ...d }; delete nd[runId]; return nd; });
      if (expandedRun === runId) setExpandedRun(null);
    } catch { /* ignore */ }
  };

  const retryTriage = async (runId: number) => {
    if (!triageVendor) return;
    try {
      await api.post(`/vendors/${triageVendor.id}/triage/${runId}/retry`);
      toast.success(t('vendors:triage.triage_started'));
      loadTriageRuns(triageVendor.id);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => { if (triageVendor) loadTriageRuns(triageVendor.id); }, 4000);
    } catch { toast.error(t('vendors:triage.triage_error')); }
  };

  useEffect(() => {
    const hasRunning = triageRuns.some(r => r.status === 'running' || r.status === 'pending');
    if (!hasRunning && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, [triageRuns]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const load = () => api.get('/vendors').then(r => setVendors(r.data)).catch(() => setVendors([])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const filtered = vendors.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || v.type === typeFilter;
    const matchRisk = !riskFilter || v.risk_level === riskFilter;
    const matchDpa = !dpaFilter || (dpaFilter === 'signed' ? v.dpa_signed : !v.dpa_signed);
    const matchCert = !certFilter ||
      (certFilter === 'iso' ? v.iso27001_certified :
       certFilter === 'soc2' ? v.soc2_certified :
       certFilter === 'any' ? (v.iso27001_certified || v.soc2_certified) : true);

    return matchSearch && matchType && matchRisk && matchDpa && matchCert;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editVendor) {
        await api.put(`/vendors/${editVendor.id}`, form);
      } else {
        await api.post('/vendors', form);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('vendors:toast.saveError'));
    } finally { setSaving(false); }
  };

  const openAssess = (v: Vendor) => {
    setAssessVendor(v);
    setAssessForm({
      risk_level: v.risk_level || 'medium',
      risk_score: v.risk_score ? String(v.risk_score) : '',
      next_review_date: v.next_review_date ? v.next_review_date.split('T')[0] : '',
      dpa_signed: !!v.dpa_signed,
      dpa_signed_at: v.dpa_signed_at ? v.dpa_signed_at.split('T')[0] : '',
      iso27001_certified: !!v.iso27001_certified,
      soc2_certified: !!v.soc2_certified,
      gdpr_compliant: !!v.gdpr_compliant,
      data_processor: !!v.data_processor,
      fourth_party_risks: v.fourth_party_risks || '',
      assessment_notes: v.assessment_notes || ''
    });
    setAssessModalOpen(true);
  };

  const handleAssess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessVendor) return;
    setAssessing(true);
    try {
      await api.patch(`/vendors/${assessVendor.id}/assessment`, {
        ...assessForm,
        risk_score: assessForm.risk_score ? parseInt(assessForm.risk_score) : null
      });
      setAssessModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('vendors:toast.assessError'));
    } finally { setAssessing(false); }
  };

  const remove = async (v: Vendor) => {
    if (!confirm(t('vendors:confirm.delete', { name: v.name }))) return;
    try {
      await api.delete(`/vendors/${v.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('vendors:toast.deleteError'));
    }
  };

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('vendors:title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('vendors:subtitle')}</p>
        </div>
        {canWrite && <Button onClick={() => { setEditVendor(null); setForm(emptyVendor); setModalOpen(true); }}><Plus size={16} />{t('vendors:new')}</Button>}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('vendors:searchPlaceholder')}
        activeCount={[typeFilter, riskFilter, dpaFilter, certFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setTypeFilter(''); setRiskFilter(''); setDpaFilter(''); setCertFilter(''); }}
      >
        <Select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          options={[
            { value: '', label: t('vendors:filters.allTypes') },
            ...Object.entries(typeLabels).map(([v, l]) => ({ value: v, label: l }))
          ]}
        />
        <Select
          value={riskFilter}
          onChange={e => setRiskFilter(e.target.value)}
          options={[
            { value: '', label: t('vendors:filters.allRisks') },
            { value: 'low', label: t('vendors:riskLevels.low') },
            { value: 'medium', label: t('vendors:riskLevels.medium') },
            { value: 'high', label: t('vendors:riskLevels.high') },
            { value: 'critical', label: t('vendors:riskLevels.critical') },
          ]}
        />
        <Select
          value={dpaFilter}
          onChange={e => setDpaFilter(e.target.value)}
          options={[
            { value: '', label: t('vendors:filters.allDpa') },
            { value: 'signed', label: t('vendors:filters.dpaSigned') },
            { value: 'unsigned', label: t('vendors:filters.dpaPending') },
          ]}
        />
        <Select
          value={certFilter}
          onChange={e => setCertFilter(e.target.value)}
          options={[
            { value: '', label: t('vendors:filters.allCerts') },
            { value: 'any', label: t('vendors:filters.certified') },
            { value: 'iso', label: t('vendors:filters.iso27001Cert') },
            { value: 'soc2', label: t('vendors:filters.soc2') },
          ]}
        />
      </FilterBar>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
        {filtered.map(v => (
          <Card key={v.id} className="group hover:border-blue-500 dark:hover:border-blue-400/50 transition-all duration-300 shadow-sm hover:shadow-lg overflow-hidden flex flex-col">
            <CardBody className="p-0 flex flex-col h-full">
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                    {(() => {
                      let host: string | null = null;
                      if (v.website) {
                        try {
                          const u = new URL(/^https?:\/\//i.test(v.website) ? v.website : `https://${v.website}`);
                          if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname;
                        } catch { /* invalid URL → fallback icon */ }
                      }
                      return host ? (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
                          alt=""
                          className="w-6 h-6 object-contain rounded-sm"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).parentElement?.querySelector('.fallback-icon');
                            if (fallback) (fallback as HTMLElement).style.display = 'block';
                          }}
                        />
                      ) : null;
                    })()}
                    <Building2 size={24} className={`fallback-icon ${v.website ? 'hidden' : ''}`} />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge value={v.risk_level || 'medium'} label={v.risk_level?.toUpperCase() || t('common:severity.medium').toUpperCase()} />
                    {v.data_processor && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{t('vendors:card.dataProcessor')}</span>}
                  </div>
                </div>

                <h3 className="text-lg font-bold dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate" title={v.name}>{v.name}</h3>
                <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-4">{typeLabels[v.type] || v.type}</p>

                <div className="space-y-2 mb-5">
                  {v.website && /^https?:\/\//i.test(v.website) && (
                    <a href={v.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 transition-colors">
                      <Globe size={14} className="text-gray-400" /> <span className="truncate">{v.website.replace(/^https?:\/\//, '')}</span>
                    </a>
                  )}
                  <Link to={`/contacts?vendor=${v.id}`} className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 transition-colors">
                    <User size={14} className="text-gray-400" />
                    <span>{t('vendors:card.contacts', { count: v.contacts?.length || 0 })}</span>
                    <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </div>

                <div className="flex items-center gap-3 pt-4 border-t dark:border-slate-800 mt-auto">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{t('vendors:card.audit')}</p>
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} className={v.next_review_date && new Date(v.next_review_date) < new Date() ? 'text-red-500' : 'text-gray-400'} />
                      <span className={`text-sm truncate ${v.next_review_date && new Date(v.next_review_date) < new Date() ? 'text-red-600 font-bold' : 'dark:text-slate-300'}`}>
                        {v.next_review_date ? format(new Date(v.next_review_date), 'P', { locale: dateFnsLocale }) : '–'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openAssess(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors" title={t('vendors:card.riskAssessmentTitle')}>
                      <ShieldCheck size={18} />
                    </button>
                    <button onClick={() => openDocs(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors" title={t('vendors:card.docsTitle')}>
                      <Paperclip size={18} />
                    </button>
                    <button onClick={() => openTriage(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-purple-600 transition-colors" title={t('vendors:triage.title', { name: v.name })}>
                      <Bot size={18} />
                    </button>
                    {canWrite && (
                      <button onClick={() => { setEditVendor(v); setForm({ name: v.name, type: v.type, website: v.website || '', phone: v.phone || '', address: v.address || '', notes: v.notes || '' }); setModalOpen(true); }} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors" title={t('vendors:card.editTitle')}>
                        <Pencil size={18} />
                      </button>
                    )}
                    {canWrite && (
                      <button onClick={() => remove(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-red-600 transition-colors" title={t('vendors:card.deleteTitle')}>
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Bar */}
              <div className="flex divide-x divide-gray-100 dark:divide-slate-800 border-t dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 mt-auto">
                <div className="flex-1 py-3 px-2 flex flex-col items-center gap-1" title={t('vendors:filters.dpaSigned')}>
                  <ShieldCheck size={16} className={v.dpa_signed ? 'text-green-500' : 'text-gray-300'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('vendors:card.dpaLabel')}</span>
                </div>
                <div className="flex-1 py-3 px-2 flex flex-col items-center gap-1" title="ISO 27001">
                  <ShieldAlert size={16} className={v.iso27001_certified ? 'text-blue-500' : 'text-gray-300'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('vendors:card.isoLabel')}</span>
                </div>
                <div className="flex-1 py-3 px-2 flex flex-col items-center gap-1" title={t('vendors:assess.gdprCompliantCheck')}>
                  <CheckCircle size={16} className={v.gdpr_compliant ? 'text-green-500' : 'text-gray-300'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t('vendors:card.gdprLabel')}</span>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editVendor ? t('vendors:modal.editTitle') : t('vendors:modal.newTitle')} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label={t('vendors:modal.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder={t('vendors:modal.namePlaceholder')} />
            </div>
            <Select label={t('vendors:modal.type')} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} options={typeOptions} />
            <Input label={t('vendors:modal.website')} value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder={t('vendors:modal.websitePlaceholder')} />

            <Input label={t('vendors:modal.phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder={t('vendors:modal.phonePlaceholder')} />
            <Input label={t('vendors:modal.address')} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder={t('vendors:modal.addressPlaceholder')} />

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('vendors:modal.notes')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t('vendors:modal.notesPlaceholder')} />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('vendors:modal.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? t('vendors:modal.saving') : t('vendors:modal.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Risk Assessment Modal */}
      <Modal open={assessModalOpen} onClose={() => setAssessModalOpen(false)} title={t('vendors:assess.title', { name: assessVendor?.name || '' })} size="xl">
        <form onSubmit={handleAssess} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">

            <section className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('vendors:assess.riskSection')}</h3>
              <div className="grid grid-cols-1 gap-4">
                <Select
                  label={t('vendors:assess.riskLevel')}
                  value={assessForm.risk_level}
                  onChange={e => setAssessForm(f => ({ ...f, risk_level: e.target.value as RiskLevel }))}
                  options={[
                    { value: 'low', label: t('vendors:assess.riskLow') },
                    { value: 'medium', label: t('vendors:assess.riskMedium') },
                    { value: 'high', label: t('vendors:assess.riskHigh') },
                    { value: 'critical', label: t('vendors:assess.riskCritical') },
                  ]}
                />
                <Input
                  label={t('vendors:assess.riskScore')}
                  type="number"
                  min="0" max="100"
                  value={assessForm.risk_score}
                  onChange={e => setAssessForm(f => ({ ...f, risk_score: e.target.value }))}
                  placeholder={t('vendors:assess.riskScorePlaceholder')}
                />
              </div>
            </section>

            <section className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('vendors:assess.datesSection')}</h3>
              <div className="grid grid-cols-1 gap-4">
                <Input label={t('vendors:assess.nextAudit')} type="date" value={assessForm.next_review_date} onChange={e => setAssessForm(f => ({ ...f, next_review_date: e.target.value }))} />
                <Input label={t('vendors:assess.dpaSignedAt')} type="date" value={assessForm.dpa_signed_at} onChange={e => setAssessForm(f => ({ ...f, dpa_signed_at: e.target.value }))} />
              </div>
            </section>

            <div className="md:col-span-2">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider mb-3">{t('vendors:assess.complianceSection')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { key: 'data_processor', label: t('vendors:assess.dataProcessorCheck') },
                  { key: 'dpa_signed', label: t('vendors:assess.dpaSignedCheck') },
                  { key: 'gdpr_compliant', label: t('vendors:assess.gdprCompliantCheck') },
                  { key: 'iso27001_certified', label: t('vendors:assess.iso27001Check') },
                  { key: 'soc2_certified', label: t('vendors:assess.soc2Check') },
                ].map(({key, label}) => (
                  <label key={key} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${assessForm[key as keyof typeof assessForm] ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-800 hover:border-gray-300'}`}>
                    <input
                      type="checkbox"
                      checked={assessForm[key as keyof typeof assessForm] as boolean}
                      onChange={e => setAssessForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="w-4 h-4 rounded text-blue-600"
                    />
                    <span className="text-xs font-medium dark:text-slate-300">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('vendors:assess.fourthPartyRisks')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={assessForm.fourth_party_risks} onChange={e => setAssessForm(f => ({ ...f, fourth_party_risks: e.target.value }))} placeholder={t('vendors:assess.fourthPartyPlaceholder')} />
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('vendors:assess.assessmentNotes')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={assessForm.assessment_notes} onChange={e => setAssessForm(f => ({ ...f, assessment_notes: e.target.value }))} placeholder={t('vendors:assess.assessmentNotesPlaceholder')} />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setAssessModalOpen(false)} className="flex-1 justify-center">{t('vendors:assess.cancel')}</Button>
            <Button type="submit" disabled={assessing || !canWrite} className="flex-1 justify-center">{assessing ? t('vendors:assess.saving') : t('vendors:assess.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* AI Triage Modal */}
      <Modal open={triageModalOpen} onClose={() => { setTriageModalOpen(false); if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } }} title={t('vendors:triage.title', { name: triageVendor?.name || '' })} size="xl">
        <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <p className="text-sm text-gray-500 dark:text-slate-400">{t('vendors:triage.description')}</p>

          {/* Start Triage Form */}
          {canWrite && (
            <div className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 space-y-4">
              {triageDocs.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2"><AlertTriangle size={15} />{t('vendors:triage.no_docs')}</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                      label={t('vendors:triage.select_doc')}
                      value={triageForm.document_id}
                      onChange={e => setTriageForm(f => ({ ...f, document_id: e.target.value }))}
                      options={triageDocs.map((d: any) => ({ value: String(d.id), label: d.original_name }))}
                    />
                    <Select
                      label={t('vendors:triage.doc_type_label')}
                      value={triageForm.doc_type}
                      onChange={e => setTriageForm(f => ({ ...f, doc_type: e.target.value }))}
                      options={[
                        { value: 'avv', label: t('vendors:triage.doc_type_avv') },
                        { value: 'tom', label: t('vendors:triage.doc_type_tom') },
                        { value: 'soc2', label: t('vendors:triage.doc_type_soc2') },
                        { value: 'other', label: t('vendors:triage.doc_type_other') },
                      ]}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={startTriage} disabled={triageStarting || !triageForm.document_id}>
                      {triageStarting ? <><Loader2 size={14} className="animate-spin mr-1" />{t('vendors:triage.running')}</> : <><Bot size={14} className="mr-1" />{t('vendors:triage.run_btn')}</>}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Triage Runs */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold dark:text-white">{t('vendors:triage.past_runs')}</h3>
            {triageRuns.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6 border border-dashed dark:border-slate-800 rounded-xl">{t('vendors:triage.no_runs')}</p>
            ) : (
              <div className="space-y-2">
                {triageRuns.map(run => {
                  const isExpanded = expandedRun === run.id;
                  const details = runDetails[run.id];
                  const severityColors: Record<string, string> = {
                    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                    gap: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
                  };
                  const riskColors: Record<string, string> = {
                    critical: 'text-red-600 dark:text-red-400',
                    high: 'text-orange-600 dark:text-orange-400',
                    medium: 'text-amber-600 dark:text-amber-400',
                    low: 'text-green-600 dark:text-green-400',
                  };
                  const coverageColors: Record<string, string> = {
                    met: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                    partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                    missing: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                    na: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
                  };
                  return (
                    <div key={run.id} className="border dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                      <div className="p-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              run.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                              run.status === 'running' || run.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                              'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            }`}>
                              {run.status === 'running' || run.status === 'pending' ? <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" />{t(`vendors:triage.status_${run.status}`)}</span> : t(`vendors:triage.status_${run.status}`)}
                            </span>
                            {run.risk_level && <span className={`text-xs font-semibold ${riskColors[run.risk_level] || ''}`}>{t(`vendors:riskLevels.${run.risk_level}`)}</span>}
                            <span className="text-xs text-gray-500 dark:text-slate-400">{run.document?.original_name}</span>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {format(new Date(run.created_at), 'Pp', { locale: dateFnsLocale })}
                            {run.llm_provider && ` · ${run.llm_provider} / ${run.llm_model}`}
                            {run.triggeredBy && ` · ${t('vendors:triage.triggered_by', { name: run.triggeredBy.name })}`}
                          </p>
                          {run.status === 'error' && run.error_message && (
                            <p className="text-xs text-red-500 mt-0.5">{t('vendors:triage.error_message', { message: run.error_message })}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {run.status === 'done' && (
                            <button onClick={() => loadRunDetails(run.id)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 transition-colors">
                              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                          )}
                          {run.status === 'error' && (
                            <button onClick={() => retryTriage(run.id)} title={t('vendors:triage.retry')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors">
                              <RefreshCw size={14} />
                            </button>
                          )}
                          {user?.role === 'admin' && (
                            <button onClick={() => deleteTriage(run.id)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-red-600 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {isExpanded && details && (
                        <div className="border-t dark:border-slate-700 p-4 bg-gray-50/50 dark:bg-slate-800/30 space-y-4">
                          {details.summary && (
                            <p className="text-sm text-gray-700 dark:text-slate-300 italic">{details.summary}</p>
                          )}
                          {details.truncated && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">{t('vendors:triage.truncated_warning')}</p>
                          )}
                          {Array.isArray(details.coverage) && details.coverage.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('vendors:triage.coverage_title')}</h4>
                              <div className="rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900 divide-y dark:divide-slate-800">
                                {details.coverage.map((c: any) => (
                                  <div key={c.ref} className="flex items-start gap-3 p-2.5">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${coverageColors[c.status] || ''}`}>
                                      {t(`vendors:triage.coverage_status.${c.status}`)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-xs font-semibold dark:text-slate-200">{c.ref}</span>
                                        {c.mandatory && <span className="text-[9px] uppercase text-gray-400">{t('vendors:triage.mandatory')}</span>}
                                      </div>
                                      <p className="text-[11px] text-gray-500 dark:text-slate-400">{c.requirement}</p>
                                      {c.note && <p className="text-[11px] text-gray-400 dark:text-slate-500 italic mt-0.5">{c.note}</p>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="space-y-2">
                            <h4 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('vendors:triage.findings')}</h4>
                            {!details.findings?.length ? (
                              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle size={14} />{t('vendors:triage.no_findings')}</p>
                            ) : (
                              <div className="space-y-2">
                                {details.findings.map((f: any) => (
                                  <div key={f.id} className="rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                                    <div className="p-3 flex items-start gap-3">
                                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${severityColors[f.severity] || ''}`}>
                                        {t(`vendors:triage.finding_${f.severity}`)}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-sm font-semibold dark:text-white">{f.finding_ref} — {f.title}</span>
                                          {f.control_ref && <span className="text-[10px] text-gray-500 dark:text-slate-400">{f.control_ref}</span>}
                                        </div>
                                        {f.description && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">{f.description}</p>}
                                        {f.quote && (
                                          <blockquote className="mt-2 pl-3 border-l-2 border-gray-300 dark:border-slate-600 text-xs text-gray-500 dark:text-slate-500 italic">"{f.quote}"</blockquote>
                                        )}
                                        {f.remediation && (
                                          <div className="mt-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-800 dark:text-blue-300">
                                            <span className="font-semibold">{t('vendors:triage.remediation_label')}:</span> {f.remediation}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Vendor Documents Modal */}
      <Modal open={docsModalOpen} onClose={() => setDocsModalOpen(false)} title={t('vendors:docs.title', { name: selectedVendorForDocs?.name || '' })} size="xl">
        <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          {/* Upload Form */}
          <form onSubmit={handleDocUpload} className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 space-y-4">
            <h3 className="text-sm font-bold dark:text-white">{t('vendors:docs.upload')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label={t('vendors:docs.category')}
                value={docForm.category}
                onChange={e => setDocForm(f => ({ ...f, category: e.target.value }))}
                options={[
                  { value: 'dpa', label: t('vendors:docs.catDpa') },
                  { value: 'contract', label: t('vendors:docs.catContract') },
                  { value: 'certificate', label: t('vendors:docs.catCertificate') },
                  { value: 'other', label: t('vendors:docs.catOther') }
                ]}
              />
              <Input
                label={t('vendors:docs.description')}
                value={docForm.description}
                onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))}
                placeholder={t('vendors:docs.descriptionPlaceholder')}
              />
              <div className="md:col-span-2 flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('vendors:docs.file')}</label>
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
                {uploadingDoc ? t('vendors:docs.uploading') : t('vendors:docs.add')}
              </Button>
            </div>
          </form>

          {/* List of Documents */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold dark:text-white">{t('vendors:docs.existing')}</h3>
            {vendorDocs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-6 border border-dashed dark:border-slate-800 rounded-xl">{t('vendors:docs.empty')}</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800 border dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                {vendorDocs.map(doc => (
                  <div key={doc.id} className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm dark:text-white truncate">{doc.original_name}</span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {doc.category === 'dpa' ? t('vendors:docs.catDpaShort') : doc.category === 'contract' ? t('vendors:docs.catContractShort') : doc.category === 'certificate' ? t('vendors:docs.catCertificateShort') : t('vendors:docs.catOtherShort')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{doc.description || t('vendors:docs.noDescription')}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {t('vendors:docs.uploadedAt', {
                          date: format(new Date(doc.created_at || Date.now()), 'Pp', { locale: dateFnsLocale }),
                          uploader: doc.uploader?.name || 'Unknown',
                          size: (doc.size / 1024 / 1024).toFixed(2)
                        })}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`${api.defaults.baseURL}/vendors/${selectedVendorForDocs?.id}/documents/${doc.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors"
                        title={t('vendors:docs.download')}
                      >
                        <Download size={18} />
                      </a>
                      {canWrite && (
                        <button
                          onClick={() => handleDocDelete(doc.id)}
                          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-red-600 transition-colors"
                          title={t('vendors:docs.delete')}
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
