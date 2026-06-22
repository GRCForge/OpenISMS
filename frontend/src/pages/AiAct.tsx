import React, { useEffect, useState, useMemo } from 'react';
import { Bot, Plus, Trash2, Pencil, CalendarCheck, ExternalLink, Paperclip, Download } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { User, Vendor, AiActItem, AiRiskCategory, AiConformityStatus } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

const riskCategoryColors: Record<AiRiskCategory, string> = {
  prohibited: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  high_risk: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  limited: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  minimal: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const conformityColors: Record<AiConformityStatus, string> = {
  not_assessed: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
  in_assessment: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  compliant: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  non_compliant: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const emptyForm = {
  name: '',
  description: '',
  risk_category: 'minimal' as AiRiskCategory,
  use_case: '',
  provider: '',
  vendor_id: '',
  location: '',
  deployed_since: '',
  owner_id: '',
  conformity_status: 'not_assessed' as AiConformityStatus,
  documentation_url: '',
  last_review_date: '',
  notes: '',
};

export const AiAct: React.FC = () => {
  const { t } = useTranslation('aiact');
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);

  const [items, setItems] = useState<AiActItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [conformityFilter, setConformityFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [selectedAiForDocs, setSelectedAiForDocs] = useState<AiActItem | null>(null);
  const [aiDocs, setAiDocs] = useState<any[]>([]);
  const [docForm, setDocForm] = useState({ category: 'ai_documentation', description: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const riskCategoryLabels: Record<AiRiskCategory, string> = {
    prohibited: t('riskCategory.prohibited'),
    high_risk: t('riskCategory.high_risk'),
    limited: t('riskCategory.limited'),
    minimal: t('riskCategory.minimal'),
  };

  const conformityLabels: Record<AiConformityStatus, string> = {
    not_assessed: t('conformityStatus.not_assessed'),
    in_assessment: t('conformityStatus.in_assessment'),
    compliant: t('conformityStatus.compliant'),
    non_compliant: t('conformityStatus.non_compliant'),
  };

  const loadDocs = (id: number) => {
    api.get(`/ai-act/${id}/documents`)
      .then(r => setAiDocs(r.data))
      .catch(() => setAiDocs([]));
  };

  const openDocs = (i: AiActItem) => {
    setSelectedAiForDocs(i);
    setDocForm({ category: 'ai_documentation', description: '' });
    setDocFile(null);
    setAiDocs([]);
    setDocsModalOpen(true);
    loadDocs(i.id);
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAiForDocs || !docFile) return;
    setUploadingDoc(true);
    const formData = new FormData();
    formData.append('file', docFile);
    formData.append('category', docForm.category);
    formData.append('description', docForm.description);

    try {
      await api.post(`/ai-act/${selectedAiForDocs.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success(t('toast.uploadSuccess'));
      setDocFile(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadDocs(selectedAiForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.uploadError'));
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDocDelete = async (docId: number) => {
    if (!selectedAiForDocs || !confirm(t('docs.deleteTitle'))) return;
    try {
      await api.delete(`/ai-act/${selectedAiForDocs.id}/documents/${docId}`);
      toast.success(t('toast.deleteSuccess'));
      loadDocs(selectedAiForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.deleteError'));
    }
  };

  const loadLocations = () => {
    api.get('/assets/locations').then(r => setLocations(r.data)).catch(() => setLocations([]));
  };

  const load = () =>
    api.get('/ai-act').then(r => setItems(r.data)).catch(() => setItems([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
    api.get('/vendors').then(r => setVendors(r.data)).catch(() => {});
    loadLocations();
  }, []);

  const filtered = useMemo(() => items.filter(i => {
    if (riskFilter && i.risk_category !== riskFilter) return false;
    if (conformityFilter && i.conformity_status !== conformityFilter) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) &&
      !i.use_case?.toLowerCase().includes(search.toLowerCase()) &&
      !i.provider?.toLowerCase().includes(search.toLowerCase()) &&
      !i.vendor?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, riskFilter, conformityFilter, search]);

  const stats = useMemo(() => ({
    total: items.length,
    prohibited: items.filter(i => i.risk_category === 'prohibited').length,
    highRisk: items.filter(i => i.risk_category === 'high_risk').length,
    nonCompliant: items.filter(i => i.conformity_status === 'non_compliant').length,
  }), [items]);

  const openNew = () => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); };
  const openEdit = (i: AiActItem) => {
    setEditId(i.id);
    setForm({
      name: i.name,
      description: i.description || '',
      risk_category: i.risk_category,
      use_case: i.use_case || '',
      provider: i.provider || '',
      vendor_id: i.vendor_id ? String(i.vendor_id) : '',
      location: i.location || '',
      deployed_since: i.deployed_since || '',
      owner_id: i.owner_id ? String(i.owner_id) : '',
      conformity_status: i.conformity_status,
      documentation_url: i.documentation_url || '',
      last_review_date: i.last_review_date || '',
      notes: i.notes || '',
    });
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        owner_id: form.owner_id || null,
        vendor_id: form.vendor_id || null
      };
      if (editId) await api.put(`/ai-act/${editId}`, payload);
      else await api.post('/ai-act', payload);
      setModalOpen(false);
      load();
      loadLocations();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (i: AiActItem) => {
    if (!confirm(t('confirm.delete', { name: i.name }))) return;
    try {
      await api.delete(`/ai-act/${i.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.removeError'));
    }
  };

  if (loading) return (
    <div className="flex justify-center pt-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Bot size={24} className="text-blue-600" />{t('title')}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {t('subtitle', { count: items.length })}
          </p>
        </div>
        {canWrite && <Button onClick={openNew}><Plus size={16} />{t('newButton')}</Button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('stats.total'), value: stats.total, color: 'bg-blue-500' },
          { label: t('stats.prohibited'), value: stats.prohibited, color: 'bg-red-600' },
          { label: t('stats.highRisk'), value: stats.highRisk, color: 'bg-orange-500' },
          { label: t('stats.nonCompliant'), value: stats.nonCompliant, color: 'bg-red-400' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <Bot className="text-white" size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={t('filter.searchPlaceholder')}
        activeCount={[riskFilter, conformityFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setRiskFilter(''); setConformityFilter(''); }}
      >
        <Select
          className="w-52"
          value={riskFilter}
          onChange={e => setRiskFilter(e.target.value)}
          options={[{ value: '', label: t('filter.allRiskCategories') }, ...Object.entries(riskCategoryLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
        <Select
          className="w-44"
          value={conformityFilter}
          onChange={e => setConformityFilter(e.target.value)}
          options={[{ value: '', label: t('filter.allConformity') }, ...Object.entries(conformityLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
      </FilterBar>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead>
              <tr>
                <Th>{t('table.name')}</Th>
                <Th>{t('table.riskCategory')}</Th>
                <Th>{t('table.conformity')}</Th>
                <Th>{t('table.provider')}</Th>
                <Th>{t('table.owner')}</Th>
                <Th>{t('table.lastReview')}</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.map(i => (
                <tr
                  key={i.id}
                  className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => openEdit(i)}
                >
                  <Td>
                    <p className="font-medium dark:text-slate-200">{i.name}</p>
                    {i.use_case && <p className="text-[11px] text-gray-400 line-clamp-1">{i.use_case}</p>}
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskCategoryColors[i.risk_category]}`}>
                      {riskCategoryLabels[i.risk_category]}
                    </span>
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${conformityColors[i.conformity_status]}`}>
                      {conformityLabels[i.conformity_status]}
                    </span>
                  </Td>
                  <Td className="text-gray-500">{i.vendor?.name || i.provider || '–'}</Td>
                  <Td className="text-gray-500">{i.owner?.name || '–'}</Td>
                  <Td>
                    {i.last_review_date ? (
                      <span className="text-xs flex items-center gap-1 text-gray-500">
                        <CalendarCheck size={11} />
                        {format(new Date(i.last_review_date), 'dd.MM.yyyy')}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </Td>
                  <Td>
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {i.documentation_url && /^https?:\/\//i.test(i.documentation_url) && (
                        <a
                          href={i.documentation_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                          title={t('docLink')}
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      {canWrite && (
                        <>
                          <button
                            onClick={() => openDocs(i)}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                            title={t('manageDocsTitle')}
                          >
                            <Paperclip size={14} />
                          </button>
                          <button
                            onClick={() => openEdit(i)}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {(user?.role === 'admin' || user?.role === 'assessor') && (
                            <button
                              onClick={() => remove(i)}
                              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="py-16 text-center">
                      <Bot size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                      <p className="text-gray-500 dark:text-slate-400 font-medium">{t('empty.title')}</p>
                      {canWrite && (
                        <button
                          onClick={openNew}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> {t('empty.createButton')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? t('modal.editTitle') : t('modal.newTitle')}
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <Input
            label={t('modal.nameLabel')}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
            placeholder={t('modal.namePlaceholder')}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.descriptionLabel')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder={t('modal.descriptionPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label={t('modal.riskCategoryLabel')}
              value={form.risk_category}
              onChange={e => setForm({ ...form, risk_category: e.target.value as AiRiskCategory })}
              options={Object.entries(riskCategoryLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label={t('modal.conformityLabel')}
              value={form.conformity_status}
              onChange={e => setForm({ ...form, conformity_status: e.target.value as AiConformityStatus })}
              options={Object.entries(conformityLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('modal.useCaseLabel')}
              value={form.use_case}
              onChange={e => setForm({ ...form, use_case: e.target.value })}
              placeholder={t('modal.useCasePlaceholder')}
              disabled={!canWrite}
            />
            <Input
              label={t('modal.providerLabel')}
              value={form.provider}
              onChange={e => setForm({ ...form, provider: e.target.value })}
              placeholder={t('modal.providerPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('modal.deployedSinceLabel')}
              type="date"
              value={form.deployed_since}
              onChange={e => setForm({ ...form, deployed_since: e.target.value })}
              disabled={!canWrite}
            />
            <div className="flex flex-col w-full relative">
              <Input
                label={t('modal.locationLabel')}
                value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })}
                placeholder={t('modal.locationPlaceholder')}
                list="ai-locations-datalist"
                disabled={!canWrite}
              />
              <datalist id="ai-locations-datalist">
                {locations.map(loc => (
                  <option key={loc} value={loc} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('modal.lastReviewLabel')}
              type="date"
              value={form.last_review_date}
              onChange={e => setForm({ ...form, last_review_date: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
            <Input
              label={t('modal.docsUrlLabel')}
              value={form.documentation_url}
              onChange={e => setForm({ ...form, documentation_url: e.target.value })}
              placeholder="https://..."
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SearchableSelect
              label={t('modal.ownerLabel')}
              value={form.owner_id}
              onChange={val => setForm({ ...form, owner_id: val })}
              options={[{ value: '', label: t('modal.noOwner') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]}
              disabled={!canWrite}
            />
            <SearchableSelect
              label={t('modal.vendorLabel')}
              value={form.vendor_id}
              onChange={val => {
                setForm(prev => {
                  const next = { ...prev, vendor_id: val };
                  if (!prev.provider && val) {
                    const selectedVendor = vendors.find(v => String(v.id) === val);
                    if (selectedVendor) {
                      next.provider = selectedVendor.name;
                    }
                  }
                  return next;
                });
              }}
              options={[{ value: '', label: t('modal.noVendor') }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notesLabel')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">
              {t('modal.cancel')}
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saving} className="flex-1 justify-center">
                {saving ? t('modal.save') : (editId ? t('modal.update') : t('modal.create'))}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      {/* Document Library Modal */}
      <Modal open={docsModalOpen} onClose={() => setDocsModalOpen(false)} title={t('docs.modalTitle', { name: selectedAiForDocs?.name })} size="lg">
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('docs.sectionTitle')}</h3>
            {aiDocs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 italic">{t('docs.empty')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {aiDocs.map((doc: any) => (
                  <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
                        <Paperclip size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={doc.original_name}>{doc.original_name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                          <span className="font-medium px-1.5 py-0.5 rounded-sm bg-gray-100 dark:bg-slate-700 uppercase tracking-wider">{doc.category}</span>
                          <span>{(doc.size / 1024).toFixed(0)} KB</span>
                          <span>• {new Date(doc.created_at).toLocaleDateString()}</span>
                          {doc.uploader && <span>• {doc.uploader.name}</span>}
                        </div>
                        {doc.description && <p className="text-xs text-gray-600 dark:text-slate-300 mt-1 line-clamp-2">{doc.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`${api.defaults.baseURL}/ai-act/${selectedAiForDocs?.id}/documents/${doc.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                        title={t('docs.downloadTitle')}
                      >
                        <Download size={16} />
                      </a>
                      {canWrite && (
                        <button
                          onClick={() => handleDocDelete(doc.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                          title={t('docs.deleteTitle')}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canWrite && (
            <form onSubmit={handleDocUpload} className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">{t('docs.uploadTitle')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label={t('docs.categoryLabel')}
                  value={docForm.category}
                  onChange={e => setDocForm({ ...docForm, category: e.target.value })}
                  options={[
                    { value: 'ai_documentation', label: t('docs.categories.ai_documentation') },
                    { value: 'risk_report', label: t('docs.categories.risk_report') },
                    { value: 'contract', label: t('docs.categories.contract') },
                    { value: 'certificate', label: t('docs.categories.certificate') },
                    { value: 'other', label: t('docs.categories.other') }
                  ]}
                />
                <div className="flex flex-col justify-end">
                  <input
                    type="file"
                    required
                    onChange={e => setDocFile(e.target.files ? e.target.files[0] : null)}
                    className="w-full text-sm text-gray-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-400 dark:hover:file:bg-blue-900/50 transition-all"
                  />
                </div>
              </div>
              <Input
                label={t('docs.descriptionLabel')}
                value={docForm.description}
                onChange={e => setDocForm({ ...docForm, description: e.target.value })}
                placeholder={t('docs.descriptionPlaceholder')}
              />
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={!docFile || uploadingDoc}>
                  {uploadingDoc ? t('docs.uploading') : t('docs.uploadButton')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </div>
  );
};
