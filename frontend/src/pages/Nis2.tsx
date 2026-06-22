import React, { useEffect, useState, useMemo } from 'react';
import { AlertOctagon, Download, CheckCircle2, Pencil, ListChecks, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { User } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

type ImplStatus = 'not_started' | 'in_progress' | 'implemented' | 'not_applicable';

interface Nis2Measure {
  id: number;
  article_ref: string;
  category: string;
  title: string;
  description?: string;
  implementation_status: ImplStatus;
  responsible?: { id: number; name: string };
  responsible_id?: number | null;
  evidence?: string;
  deadline?: string;
  notes?: string;
  last_review_date?: string;
}

const statusColors: Record<ImplStatus, string> = {
  not_started: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  not_applicable: 'bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500',
};

const CATEGORY_COLORS: Record<string, string> = {
  'Risikoanalyse & Sicherheitsrichtlinien': 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  'Vorfallbewältigung':                     'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  'Business Continuity':                    'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  'Lieferkettensicherheit':                 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  'Sicherheit im Erwerb':                   'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400',
  'Wirksamkeit von Maßnahmen':              'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400',
  'Cyberhygiene & Schulungen':              'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400',
  'Kryptografie':                           'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
  'Personalsicherheit & Zugangssteuerung':  'bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-400',
  'Multi-Faktor-Authentifizierung':         'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
  'Meldepflichten':                         'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400',
};

const emptyEditForm = {
  implementation_status: 'not_started' as ImplStatus,
  responsible_id: '',
  evidence: '',
  deadline: '',
  notes: '',
  last_review_date: '',
};

export const Nis2: React.FC = () => {
  const { t } = useTranslation('nis2');
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);
  const canManage = user?.role === 'admin' || user?.role === 'assessor';

  const statusLabels: Record<ImplStatus, string> = {
    not_started: t('status.not_started'),
    in_progress: t('status.in_progress'),
    implemented: t('status.implemented'),
    not_applicable: t('status.not_applicable'),
  };

  const [measures, setMeasures] = useState<Nis2Measure[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (cat: string) => setCollapsedCategories(prev => {
    const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next;
  });
  const [editMeasure, setEditMeasure] = useState<Nis2Measure | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/nis2').then(r => setMeasures(r.data)).catch(() => setMeasures([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/nis2/seed');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 409) await load();
      else toast.error(e.response?.data?.error || t('toast.loadError'));
    } finally {
      setSeeding(false);
    }
  };

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const openEdit = (m: Nis2Measure) => {
    setEditMeasure(m);
    setEditForm({
      implementation_status: m.implementation_status,
      responsible_id: m.responsible_id ? String(m.responsible_id) : '',
      evidence: m.evidence || '',
      deadline: m.deadline ? m.deadline.slice(0, 10) : '',
      notes: m.notes || '',
      last_review_date: m.last_review_date ? m.last_review_date.slice(0, 10) : '',
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMeasure) return;
    setSaving(true);
    try {
      const payload = { ...editForm, responsible_id: editForm.responsible_id ? Number(editForm.responsible_id) : null };
      await api.put(`/nis2/${editMeasure.id}`, payload);
      setMeasures(ms => ms.map(m => m.id === editMeasure.id ? { ...m, ...payload, responsible: editForm.responsible_id ? { id: Number(editForm.responsible_id), name: users.find(u => u.id === Number(editForm.responsible_id))?.name || '' } : undefined } : m));
      setEditMeasure(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    const total = measures.length;
    const implemented = measures.filter(m => m.implementation_status === 'implemented').length;
    const inProgress = measures.filter(m => m.implementation_status === 'in_progress').length;
    const open = measures.filter(m => m.implementation_status === 'not_started').length;
    return { total, implemented, inProgress, open };
  }, [measures]);

  const categories = useMemo(() => Array.from(new Set(measures.map(m => m.category))).sort((a, b) => a.localeCompare(b)), [measures]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = (m: Nis2Measure) => !!m.deadline && new Date(m.deadline) < today && m.implementation_status !== 'implemented';

  const filtered = useMemo(() => measures.filter(m => {
    if (statusFilter && m.implementation_status !== statusFilter) return false;
    if (categoryFilter && m.category !== categoryFilter) return false;
    if (search) { const q = search.toLowerCase(); if (!m.article_ref.toLowerCase().includes(q) && !m.title.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return false; }
    return true;
  }), [measures, statusFilter, categoryFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, Nis2Measure[]>();
    for (const m of filtered) { if (!map.has(m.category)) map.set(m.category, []); map.get(m.category)!.push(m); }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const activeFilterCount = [statusFilter, categoryFilter].filter(Boolean).length;

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  if (measures.length === 0) return (
    <Card><CardBody>
      <div className="py-16 text-center">
        <ListChecks size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
        <p className="text-gray-500 dark:text-slate-400 font-medium">{t('empty.title')}</p>
        <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">{t('empty.description')}</p>
        {canManage && <Button onClick={seed} disabled={seeding} className="mt-4"><Download size={16} />{seeding ? t('empty.loading') : t('empty.loadButton')}</Button>}
      </div>
    </CardBody></Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><AlertOctagon size={24} className="text-blue-600" />{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', { count: measures.length })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card><CardBody className="py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0"><AlertOctagon size={16} className="text-blue-600 dark:text-blue-400" /></div>
            <div>
              <p className="font-semibold text-sm dark:text-white">{t('entity.essential.title')}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t('entity.essential.description')}</p>
            </div>
          </div>
        </CardBody></Card>
        <Card><CardBody className="py-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 shrink-0"><AlertOctagon size={16} className="text-amber-600 dark:text-amber-400" /></div>
            <div>
              <p className="font-semibold text-sm dark:text-white">{t('entity.important.title')}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t('entity.important.description')}</p>
            </div>
          </div>
        </CardBody></Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('stats.total'), value: stats.total, color: 'bg-blue-500', icon: ListChecks },
          { label: t('stats.implemented'), value: stats.implemented, color: 'bg-green-600', icon: CheckCircle2 },
          { label: t('stats.inProgress'), value: stats.inProgress, color: 'bg-yellow-500', icon: AlertOctagon },
          { label: t('stats.open'), value: stats.open, color: 'bg-gray-500', icon: Pencil },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div><p className="text-2xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('filter.searchPlaceholder')} activeCount={activeFilterCount} onReset={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); }}>
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('filter.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-56" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} options={[{ value: '', label: t('filter.allCategories') }, ...categories.map(c => ({ value: c, label: c }))]} />
      </FilterBar>

      {grouped.map(([category, items]) => {
        const implementedCount = items.filter(m => m.implementation_status === 'implemented').length;
        const pct = items.length > 0 ? Math.round((implementedCount / items.length) * 100) : 0;
        const isCatExpanded = !collapsedCategories.has(category);
        const colorClass = CATEGORY_COLORS[category] || 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
        return (
          <Card key={category} className="overflow-hidden">
            <button onClick={() => toggleCategory(category)} className="w-full flex items-center gap-3 p-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors text-left">
              <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${colorClass}`}>{category}</span>
              <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{t('table.measureCount', { count: items.length })}</span>
              <div className="flex items-center gap-2 min-w-[80px] ml-auto">
                <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                <span className="text-xs font-bold text-gray-600 dark:text-slate-400">{pct}%</span>
              </div>
              {isCatExpanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
            </button>
            {isCatExpanded && (
              <div className="border-t dark:border-slate-700">
                <Table>
                  <Thead><tr>
                    <Th>{t('table.article')}</Th><Th>{t('table.measure')}</Th><Th>{t('table.status')}</Th><Th>{t('table.deadline')}</Th><Th>{t('table.lastReview')}</Th><Th>{''}</Th>
                  </tr></Thead>
                  <Tbody>
                    {items.map(m => {
                      const expanded = expandedIds.has(m.id);
                      const overdue = isOverdue(m);
                      return (
                        <React.Fragment key={m.id}>
                          <tr className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                            <Td><span className="font-mono text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">{m.article_ref}</span></Td>
                            <Td>
                              <div className="flex items-start gap-2">
                                {m.description && <button type="button" onClick={() => toggleExpanded(m.id)} className="mt-0.5 p-0.5 rounded text-gray-400 hover:text-blue-600 transition-colors shrink-0" title={expanded ? t('description.hide') : t('description.show')}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}
                                <div>
                                  <p className="font-medium text-sm dark:text-slate-200">{m.title}</p>
                                  {m.responsible && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{m.responsible.name}</p>}
                                </div>
                              </div>
                            </Td>
                            <Td><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColors[m.implementation_status]}`}>{statusLabels[m.implementation_status]}</span></Td>
                            <Td>{m.deadline ? <span className={`text-xs font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'}`}>{format(new Date(m.deadline), 'dd.MM.yyyy')}{overdue && ' ⚠'}</span> : <span className="text-gray-300 dark:text-slate-600">–</span>}</Td>
                            <Td className="text-gray-500 dark:text-slate-400 text-xs">{m.last_review_date ? format(new Date(m.last_review_date), 'dd.MM.yyyy') : '–'}</Td>
                            <Td>{canWrite && <button onClick={() => openEdit(m)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors" title={t('modal.edit')}><Pencil size={14} /></button>}</Td>
                          </tr>
                          {expanded && m.description && (
                            <tr className="bg-gray-50 dark:bg-slate-800/30">
                              <td />
                              <td colSpan={5} className="px-4 py-3">
                                <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">{m.description}</p>
                                {m.evidence && <div className="mt-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">{t('description.evidence')}</span><span className="text-xs text-gray-600 dark:text-slate-400">{m.evidence}</span></div>}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </Tbody>
                </Table>
              </div>
            )}
          </Card>
        );
      })}

      {grouped.length === 0 && (
        <Card><CardBody><div className="py-12 text-center"><AlertOctagon size={36} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" /><p className="text-gray-500 dark:text-slate-400">{t('filterEmpty')}</p></div></CardBody></Card>
      )}

      <Modal open={!!editMeasure} onClose={() => setEditMeasure(null)} title={editMeasure ? `${editMeasure.article_ref} – ${editMeasure.title}` : ''} size="lg">
        <form onSubmit={saveEdit} className="space-y-4">
          {editMeasure && <div className="flex gap-2 flex-wrap"><span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{editMeasure.category}</span></div>}
          <Select label={t('modal.status')} value={editForm.implementation_status} onChange={e => setEditForm({ ...editForm, implementation_status: e.target.value as ImplStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite} />
          <SearchableSelect label={t('modal.responsible')} value={editForm.responsible_id} onChange={val => setEditForm({ ...editForm, responsible_id: val })} options={[{ value: '', label: t('modal.nobody') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} disabled={!canWrite} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.evidence')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} placeholder={t('modal.evidencePlaceholder')} value={editForm.evidence} onChange={e => setEditForm({ ...editForm, evidence: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.deadline')}</label>
              <input type="date" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" value={editForm.deadline} onChange={e => setEditForm({ ...editForm, deadline: e.target.value })} disabled={!canWrite} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.lastReview')}</label>
              <input type="date" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" value={editForm.last_review_date} onChange={e => setEditForm({ ...editForm, last_review_date: e.target.value })} disabled={!canWrite} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notes')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditMeasure(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            {canWrite && <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
