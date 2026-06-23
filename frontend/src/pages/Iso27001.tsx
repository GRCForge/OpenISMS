import React, { useEffect, useState, useMemo } from 'react';
import { ShieldCheck, Download, CheckCircle2, Target, Gauge, Pencil, ListChecks, Filter, ChevronDown, ChevronRight } from 'lucide-react';
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
import { ControlMappings } from '../components/ControlMappings';
import { hasWriteAccess } from '../lib/permissions';

type ImplStatus = 'not_started' | 'in_progress' | 'implemented' | 'not_applicable';
type Theme = 'Organizational' | 'People' | 'Physical' | 'Technological';

interface Iso27001Control {
  id: number;
  ref: string;
  theme: Theme;
  title: string;
  description?: string;
  applicable: boolean;
  implementation_status: ImplStatus;
  justification?: string;
  owner?: { id: number; name: string };
  owner_id?: number | null;
  evidence?: string;
  notes?: string;
  last_review_date?: string;
}

const statusColors: Record<ImplStatus, string> = {
  not_started: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  not_applicable: 'bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500',
};

const THEME_ORDER: Theme[] = ['Organizational', 'People', 'Physical', 'Technological'];

const THEME_COLORS: Record<Theme, string> = {
  Organizational: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  People: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  Physical: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  Technological: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
};

const THEME_BADGES: Record<Theme, string> = {
  Organizational: 'ORG',
  People: 'PPL',
  Physical: 'PHY',
  Technological: 'TECH',
};

const emptyEditForm = {
  implementation_status: 'not_started' as ImplStatus,
  applicable: true,
  justification: '',
  evidence: '',
  owner_id: '',
  last_review_date: '',
  notes: '',
};

export const Iso27001: React.FC = () => {
  const { t } = useTranslation('iso27001');
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

  const themeLabels: Record<Theme, string> = {
    Organizational: t('theme.Organizational'),
    People: t('theme.People'),
    Physical: t('theme.Physical'),
    Technological: t('theme.Technological'),
  };

  const [controls, setControls] = useState<Iso27001Control[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [applicableFilter, setApplicableFilter] = useState<'all' | 'applicable'>('all');
  const [search, setSearch] = useState('');
  const [collapsedThemes, setCollapsedThemes] = useState<Set<Theme>>(new Set());
  const toggleTheme = (theme: Theme) => setCollapsedThemes(prev => {
    const next = new Set(prev); next.has(theme) ? next.delete(theme) : next.add(theme); return next;
  });
  const [editControl, setEditControl] = useState<Iso27001Control | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/iso27001').then(r => setControls(r.data)).catch(() => setControls([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/iso27001/seed');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 409) await load();
      else toast.error(e.response?.data?.error || t('toast.loadError'));
    } finally {
      setSeeding(false);
    }
  };

  const toggleApplicable = async (ctrl: Iso27001Control) => {
    if (!canWrite) return;
    const newApplicable = !ctrl.applicable;
    const newStatus: ImplStatus = newApplicable ? 'not_started' : 'not_applicable';
    const prev = controls;
    setControls(cs => cs.map(c => c.id === ctrl.id ? { ...c, applicable: newApplicable, implementation_status: newStatus } : c));
    try {
      await api.put(`/iso27001/${ctrl.id}`, { applicable: newApplicable, implementation_status: newStatus });
    } catch (err: unknown) {
      setControls(prev);
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    }
  };

  const openEdit = (ctrl: Iso27001Control) => {
    setEditControl(ctrl);
    setEditForm({
      implementation_status: ctrl.implementation_status,
      applicable: ctrl.applicable,
      justification: ctrl.justification || '',
      evidence: ctrl.evidence || '',
      owner_id: ctrl.owner_id ? String(ctrl.owner_id) : '',
      last_review_date: ctrl.last_review_date ? ctrl.last_review_date.slice(0, 10) : '',
      notes: ctrl.notes || '',
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editControl) return;
    setSaving(true);
    try {
      const payload = { ...editForm, owner_id: editForm.owner_id ? Number(editForm.owner_id) : null };
      await api.put(`/iso27001/${editControl.id}`, payload);
      setControls(cs => cs.map(c => c.id === editControl.id ? { ...c, ...payload, owner: editForm.owner_id ? { id: Number(editForm.owner_id), name: users.find(u => u.id === Number(editForm.owner_id))?.name || '' } : undefined } : c));
      setEditControl(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    const total = controls.length;
    const applicable = controls.filter(c => c.applicable).length;
    const implemented = controls.filter(c => c.implementation_status === 'implemented').length;
    const compliance = applicable > 0 ? Math.round((implemented / applicable) * 100) : 0;
    return { total, applicable, implemented, compliance };
  }, [controls]);

  const filtered = useMemo(() => controls.filter(c => {
    if (statusFilter && c.implementation_status !== statusFilter) return false;
    if (applicableFilter === 'applicable' && !c.applicable) return false;
    if (search) { const q = search.toLowerCase(); if (!c.ref.toLowerCase().includes(q) && !c.title.toLowerCase().includes(q)) return false; }
    return true;
  }), [controls, statusFilter, applicableFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<Theme, Iso27001Control[]>();
    for (const theme of THEME_ORDER) map.set(theme, []);
    for (const c of filtered) { if (map.has(c.theme)) map.get(c.theme)!.push(c); }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [filtered]);

  const activeFilterCount = [statusFilter, applicableFilter !== 'all' ? applicableFilter : ''].filter(Boolean).length;

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  if (controls.length === 0) return (
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
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><ShieldCheck size={24} className="text-blue-600" />{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', { count: controls.length })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('stats.total'), value: stats.total, color: 'bg-blue-500', icon: ListChecks },
          { label: t('stats.applicable'), value: stats.applicable, color: 'bg-yellow-500', icon: Filter },
          { label: t('stats.implemented'), value: stats.implemented, color: 'bg-green-600', icon: CheckCircle2 },
          { label: t('stats.compliance'), value: `${stats.compliance}%`, color: 'bg-purple-600', icon: Gauge },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div><p className="text-2xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('filter.searchPlaceholder')} activeCount={activeFilterCount} onReset={() => { setSearch(''); setStatusFilter(''); setApplicableFilter('all'); }}>
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('filter.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-44" value={applicableFilter} onChange={e => setApplicableFilter(e.target.value as 'all' | 'applicable')} options={[{ value: 'all', label: t('filter.allControls') }, { value: 'applicable', label: t('filter.applicableOnly') }]} />
      </FilterBar>

      {grouped.map(([theme, items]) => {
        const implemented = items.filter(c => c.implementation_status === 'implemented').length;
        const applicable = items.filter(c => c.applicable).length;
        const pct = applicable > 0 ? Math.round((implemented / applicable) * 100) : 0;
        const isExpanded = !collapsedThemes.has(theme);
        const colorClass = THEME_COLORS[theme];
        return (
          <Card key={theme} className="overflow-hidden">
            <button onClick={() => toggleTheme(theme)} className="w-full flex items-center gap-3 p-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors text-left">
              <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono shrink-0 ${colorClass}`}>{THEME_BADGES[theme]}</span>
              <span className="flex-1 font-semibold dark:text-white text-sm">{themeLabels[theme]}</span>
              <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{t('table.controlCount', { count: items.length })}</span>
              <div className="flex items-center gap-2 min-w-[80px]">
                <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                <span className="text-xs font-bold text-gray-600 dark:text-slate-400">{pct}%</span>
              </div>
              {isExpanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
            </button>
            {isExpanded && (
              <div className="border-t dark:border-slate-700">
                <Table>
                  <Thead><tr>
                    <Th>{t('table.ref')}</Th><Th>{t('table.control')}</Th><Th>{t('table.applicable')}</Th><Th>{t('table.status')}</Th><Th>{t('table.lastReview')}</Th><Th>{''}</Th>
                  </tr></Thead>
                  <Tbody>
                    {items.map(ctrl => (
                      <tr key={ctrl.id} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${!ctrl.applicable ? 'opacity-50' : ''}`}>
                        <Td><span className="font-mono text-xs text-gray-500 dark:text-slate-400">{ctrl.ref}</span></Td>
                        <Td><p className="font-medium text-sm dark:text-slate-200">{t('controls.' + ctrl.ref + '.title', { defaultValue: ctrl.title })}</p>{ctrl.owner && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{ctrl.owner.name}</p>}</Td>
                        <Td><input type="checkbox" checked={ctrl.applicable} disabled={!canWrite} onChange={() => toggleApplicable(ctrl)} className="w-4 h-4 rounded accent-blue-600 cursor-pointer disabled:cursor-not-allowed" /></Td>
                        <Td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[ctrl.implementation_status]}`}>{statusLabels[ctrl.implementation_status]}</span></Td>
                        <Td className="text-gray-500 dark:text-slate-400 text-xs">{ctrl.last_review_date ? format(new Date(ctrl.last_review_date), 'dd.MM.yyyy') : '–'}</Td>
                        <Td>{canWrite && <button onClick={() => openEdit(ctrl)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>}</Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            )}
          </Card>
        );
      })}

      {grouped.length === 0 && (
        <Card><CardBody><div className="py-12 text-center"><Target size={36} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" /><p className="text-gray-500 dark:text-slate-400">{t('filterEmpty')}</p></div></CardBody></Card>
      )}

      <Modal open={!!editControl} onClose={() => setEditControl(null)} title={editControl ? `${editControl.ref} – ${t('controls.' + editControl.ref + '.title', { defaultValue: editControl.title })}` : ''} size="xl">
        <form onSubmit={saveEdit} className="space-y-4">
          {/* Description — full width */}
          {editControl?.description && (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-4 py-3">
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">{t('modal.description')}</p>
              <p className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed">{t('controls.' + editControl.ref + '.description', { defaultValue: editControl.description })}</p>
            </div>
          )}

          {/* 3-column grid: left 1/3 = controls, right 2/3 = text areas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Left column — compact controls */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 pt-1">
                <input type="checkbox" id="edit-applicable" checked={editForm.applicable} onChange={e => setEditForm({ ...editForm, applicable: e.target.checked, implementation_status: e.target.checked ? editForm.implementation_status : 'not_applicable' })} disabled={!canWrite} className="w-4 h-4 rounded accent-blue-600 disabled:cursor-not-allowed" />
                <label htmlFor="edit-applicable" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.applicable')}</label>
              </div>
              <Select label={t('modal.status')} value={editForm.implementation_status} onChange={e => setEditForm({ ...editForm, implementation_status: e.target.value as ImplStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite || !editForm.applicable} />
              <SearchableSelect label={t('modal.responsible')} value={editForm.owner_id} onChange={val => setEditForm({ ...editForm, owner_id: val })} options={[{ value: '', label: t('modal.nobody') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} disabled={!canWrite} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.lastReview')}</label>
                <input type="date" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" value={editForm.last_review_date} onChange={e => setEditForm({ ...editForm, last_review_date: e.target.value })} disabled={!canWrite} />
              </div>
            </div>

            {/* Right 2 columns — text areas (span 2 on xl) */}
            <div className="xl:col-span-2 space-y-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.justification')}</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden resize-y" rows={3} value={editForm.justification} onChange={e => setEditForm({ ...editForm, justification: e.target.value })} disabled={!canWrite} placeholder={t('modal.justificationPlaceholder')} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.evidence')}</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden resize-y" rows={3} value={editForm.evidence} onChange={e => setEditForm({ ...editForm, evidence: e.target.value })} disabled={!canWrite} placeholder={t('modal.evidencePlaceholder')} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notes')}</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden resize-y" rows={2} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} disabled={!canWrite} />
              </div>
            </div>
          </div>

          {/* Cross-references — full width */}
          {editControl && (
            <div className="border-t dark:border-slate-700 pt-3">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t('modal.crossRefs')}</p>
              <ControlMappings framework="iso27001" ref={editControl.ref} />
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditControl(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            {canWrite && <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
