import React, { useEffect, useState, useMemo } from 'react';
import { GitFork, Plus, Pencil, Trash2, Lock, Unlock, Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { DataFlow, Asset } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
  flowchart: { curve: 'basis', nodeSpacing: 50, rankSpacing: 60 },
});

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  inactive: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
  planned: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const emptyForm = {
  name: '',
  description: '',
  source_id: '',
  target_id: '',
  data_categories: [] as string[],
  transfer_mechanism: 'api',
  encryption: false,
  frequency: '',
  contains_personal_data: false,
  notes: '',
  status: 'active',
};

const MermaidDiagram: React.FC<{ chart: string }> = ({ chart }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ref.current || !chart) return;
    const id = `df-${Date.now()}`;
    setError('');
    mermaid.render(id, chart).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg; // NOSONAR(typescript:S5247) - SVG from Mermaid with securityLevel:'strict'; htmlLabels:false
    }).catch(e => {
      setError(String(e));
    });
  }, [chart]);

  if (error) return <p className="text-red-500 text-sm p-4">{error}</p>;
  return <div ref={ref} className="flex justify-center overflow-x-auto p-4" />;
};

export const DataFlows: React.FC = () => {
  const { t } = useTranslation('dataflows');
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const canEdit = ['admin', 'assessor', 'it-staff'].includes(user?.role || '');
  const canDelete = user?.role === 'admin';

  const mechanismLabels: Record<string, string> = {
    api: t('mechanisms.api'),
    file: t('mechanisms.file'),
    database: t('mechanisms.database'),
    manual: t('mechanisms.manual'),
    email: t('mechanisms.email'),
    sftp: t('mechanisms.sftp'),
    message_queue: t('mechanisms.message_queue'),
    other: t('mechanisms.other'),
  };

  const [flows, setFlows] = useState<DataFlow[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [view, setView] = useState<'list' | 'diagram'>('list');

  const [modalOpen, setModalOpen] = useState(false);
  const [editFlow, setEditFlow] = useState<DataFlow | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([api.get('/dataflows'), api.get('/assets')]).then(([flowsRes, assetsRes]) => {
      setFlows(flowsRes.data);
      setAssets(assetsRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditFlow(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (f: DataFlow) => {
    setEditFlow(f);
    setForm({
      name: f.name,
      description: f.description || '',
      source_id: String(f.source_id || ''),
      target_id: String(f.target_id || ''),
      data_categories: f.data_categories || [],
      transfer_mechanism: f.transfer_mechanism,
      encryption: f.encryption,
      frequency: f.frequency || '',
      contains_personal_data: f.contains_personal_data,
      notes: f.notes || '',
      status: f.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        source_id: form.source_id ? Number(form.source_id) : null,
        target_id: form.target_id ? Number(form.target_id) : null,
      };
      if (editFlow) {
        await api.put(`/dataflows/${editFlow.id}`, payload);
      } else {
        await api.post('/dataflows', payload);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.saveError'));
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('confirm.delete'))) return;
    try {
      await api.delete(`/dataflows/${id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.deleteError'));
    }
  };

  const mermaidChart = useMemo(() => {
    const activeFlows = flows.filter(f => f.status === 'active' && f.source && f.target);
    if (!activeFlows.length) return '';
    const nodeId = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '_');
    const nodes = new Set<string>();
    let c = 'flowchart LR\n';
    c += '  classDef personal fill:#fef3c7,stroke:#f59e0b,color:#92400e\n';
    c += '  classDef encrypted fill:#d1fae5,stroke:#10b981,color:#065f46\n';
    c += '  classDef standard fill:#e0f2fe,stroke:#0ea5e9,color:#0c4a6e\n';
    activeFlows.forEach(f => {
      const srcId = nodeId(f.source!.name);
      const tgtId = nodeId(f.target!.name);
      if (!nodes.has(srcId)) { c += `  ${srcId}["${f.source!.name}"]\n`; nodes.add(srcId); }
      if (!nodes.has(tgtId)) { c += `  ${tgtId}["${f.target!.name}"]\n`; nodes.add(tgtId); }
      const label = mechanismLabels[f.transfer_mechanism] || f.transfer_mechanism;
      const encLabel = f.encryption ? ' 🔒' : '';
      c += `  ${srcId} -->|"${label}${encLabel}"| ${tgtId}\n`;
      if (f.contains_personal_data) c += `  class ${srcId} personal\n`;
      else if (f.encryption) c += `  class ${srcId} encrypted\n`;
      else c += `  class ${srcId} standard\n`;
    });
    return c;
  }, [flows, t]);

  const filtered = flows.filter(f => {
    if (statusFilter && f.status !== statusFilter) return false;
    if (search && !f.name.toLowerCase().includes(search.toLowerCase()) &&
        !(f.source?.name || '').toLowerCase().includes(search.toLowerCase()) &&
        !(f.target?.name || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <GitFork size={24} className="text-blue-600" />
            {t('title')}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', { count: flows.length })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-lg border dark:border-slate-700 overflow-hidden">
            <button onClick={() => setView('list')} className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 hover:bg-gray-50'}`}>{t('listView')}</button>
            <button onClick={() => setView('diagram')} className={`px-3 py-1.5 text-sm font-medium transition-colors ${view === 'diagram' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 hover:bg-gray-50'}`}>
              <Eye size={14} className="inline mr-1" />{t('diagramView')}
            </button>
          </div>
          {canEdit && <Button onClick={openCreate}><Plus size={16} />{t('new')}</Button>}
        </div>
      </div>

      {view === 'diagram' ? (
        <Card className="p-2 min-h-[400px]">
          {mermaidChart ? (
            <>
              <div className="flex items-center gap-4 px-4 py-2 border-b dark:border-slate-700 text-xs text-gray-500 dark:text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-400 inline-block" /> {t('diagram.personalData')}</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-100 border border-green-400 inline-block" /> {t('diagram.encrypted')}</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-100 border border-sky-400 inline-block" /> {t('diagram.standard')}</span>
                <span className="text-gray-400">{t('diagram.encryptedIcon')}</span>
              </div>
              <MermaidDiagram chart={mermaidChart} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <GitFork size={40} className="mb-3 text-gray-300 dark:text-slate-700" />
              <p>{t('diagram.noFlows')}</p>
            </div>
          )}
        </Card>
      ) : (
        <>
          <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('searchPlaceholder')}>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
              { value: '', label: t('filters.allStatus') },
              { value: 'active', label: t('status.active') },
              { value: 'inactive', label: t('status.inactive') },
              { value: 'planned', label: t('status.planned') },
            ]} />
          </FilterBar>

          {filtered.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl">
              <GitFork size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">{t('empty.title')}</p>
              <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">{t('empty.description')}</p>
              {canEdit && <Button onClick={openCreate} className="mt-4"><Plus size={16} />{t('empty.firstFlow')}</Button>}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(f => (
                <Card key={f.id} className="p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg shrink-0 mt-0.5">
                        <GitFork size={18} className="text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-gray-900 dark:text-white">{f.name}</h3>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusColors[f.status]}`}>
                            {t(`status.${f.status}`)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm">
                          <span className="font-medium text-gray-700 dark:text-slate-200">{f.source?.name || '?'}</span>
                          <span className="text-gray-400">→</span>
                          <span className="font-medium text-gray-700 dark:text-slate-200">{f.target?.name || '?'}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500 dark:text-slate-400">
                          <span>{mechanismLabels[f.transfer_mechanism] || f.transfer_mechanism}</span>
                          {f.encryption
                            ? <span className="flex items-center gap-1 text-green-600 dark:text-green-400"><Lock size={11} />{t('card.encrypted')}</span>
                            : <span className="flex items-center gap-1 text-orange-500"><Unlock size={11} />{t('card.unencrypted')}</span>
                          }
                          {f.contains_personal_data && <span className="text-amber-600 dark:text-amber-400 font-medium">{t('card.personalData')}</span>}
                          {f.frequency && <span>{t('card.frequency', { freq: f.frequency })}</span>}
                        </div>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(f)} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"><Pencil size={14} /></button>
                        {canDelete && <button onClick={() => handleDelete(f.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /></button>}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editFlow ? t('modal.editTitle') : t('modal.newTitle')} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('form.name')}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            required
            placeholder={t('form.namePlaceholder')}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SearchableSelect
              label={t('form.source')}
              value={form.source_id}
              onChange={val => setForm(f => ({ ...f, source_id: val }))}
              options={[{ value: '', label: t('form.externalSystem') }, ...assets.map(a => ({ value: String(a.id), label: a.name }))]}
            />
            <SearchableSelect
              label={t('form.target')}
              value={form.target_id}
              onChange={val => setForm(f => ({ ...f, target_id: val }))}
              options={[{ value: '', label: t('form.externalSystem') }, ...assets.map(a => ({ value: String(a.id), label: a.name }))]}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label={t('form.mechanism')}
              value={form.transfer_mechanism}
              onChange={e => setForm(f => ({ ...f, transfer_mechanism: e.target.value }))}
              options={Object.entries(mechanismLabels).map(([v, l]) => ({ value: v, label: l }))}
            />
            <Select
              label={t('form.status')}
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              options={[
                { value: 'active', label: t('status.active') },
                { value: 'inactive', label: t('status.inactive') },
                { value: 'planned', label: t('status.planned') },
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('form.dataCategoriesLabel')}</label>
            <input
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={form.data_categories.join(', ')}
              onChange={e => setForm(f => ({ ...f, data_categories: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
              placeholder={t('form.dataCategoriesPlaceholder')}
            />
          </div>

          <Input
            label={t('form.frequency')}
            value={form.frequency}
            onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
            placeholder={t('form.frequencyPlaceholder')}
          />

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.encryption} onChange={e => setForm(f => ({ ...f, encryption: e.target.checked }))} className="rounded" />
              <span className="dark:text-slate-300">{t('form.encryptionCheck')}</span>
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.contains_personal_data} onChange={e => setForm(f => ({ ...f, contains_personal_data: e.target.checked }))} className="rounded" />
              <span className="dark:text-slate-300">{t('form.personalDataCheck')}</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('form.notes')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-2 border-t dark:border-slate-700">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">{t('form.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? t('form.saving') : t('form.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
