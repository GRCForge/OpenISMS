import React, { useEffect, useState, useMemo } from 'react';
import { BookOpen, Download, CheckCircle2, Pencil, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
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
type RequirementLevel = 'basis' | 'standard' | 'erhoehter_schutzbedarf';

interface BsiRequirement {
  id: number;
  baustein_id: string;
  baustein_name: string;
  layer: string;
  req_id: string;
  title: string;
  requirement_level: RequirementLevel;
  implementation_status: ImplStatus;
  responsible?: { id: number; name: string };
  responsible_id?: number | null;
  notes?: string;
  last_review_date?: string;
}

const LAYER_ORDER = ['ISMS', 'ORP', 'CON', 'OPS', 'DER', 'APP', 'SYS', 'NET', 'INF'];

const LAYER_COLORS: Record<string, string> = {
  ISMS: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  ORP:  'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  CON:  'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400',
  OPS:  'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400',
  DER:  'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  APP:  'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  SYS:  'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
  NET:  'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400',
  INF:  'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
};

const statusColors: Record<ImplStatus, string> = {
  not_started: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  not_applicable: 'bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500',
};

const levelColors: Record<RequirementLevel, string> = {
  basis: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
  standard: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  erhoehter_schutzbedarf: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

const emptyEditForm = {
  implementation_status: 'not_started' as ImplStatus,
  responsible_id: '',
  notes: '',
  last_review_date: '',
};

export const BsiGrundschutz: React.FC = () => {
  const { t } = useTranslation('bsigrundschutz');
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

  const levelLabels: Record<RequirementLevel, string> = {
    basis: t('level.basis'),
    standard: t('level.standard'),
    erhoehter_schutzbedarf: t('level.erhoehter_schutzbedarf'),
  };

  const [requirements, setRequirements] = useState<BsiRequirement[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [layerFilter, setLayerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [collapsedBausteine, setCollapsedBausteine] = useState<Set<string>>(new Set());
  const toggleBaustein = (id: string) => setCollapsedBausteine(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const [editReq, setEditReq] = useState<BsiRequirement | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/bsi-grundschutz')
      .then(r => setRequirements(r.data))
      .catch(() => setRequirements([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/bsi-grundschutz/seed');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 409) await load();
      else toast.error(e.response?.data?.error || t('toast.loadError'));
    } finally {
      setSeeding(false);
    }
  };

  const openEdit = (req: BsiRequirement) => {
    setEditReq(req);
    setEditForm({
      implementation_status: req.implementation_status,
      responsible_id: req.responsible_id ? String(req.responsible_id) : '',
      notes: req.notes || '',
      last_review_date: req.last_review_date ? req.last_review_date.slice(0, 10) : '',
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editReq) return;
    setSaving(true);
    try {
      const payload = { ...editForm, responsible_id: editForm.responsible_id ? Number(editForm.responsible_id) : null };
      await api.put(`/bsi-grundschutz/${editReq.id}`, payload);
      setRequirements(rs => rs.map(r => r.id === editReq.id ? { ...r, ...payload, responsible: editForm.responsible_id ? { id: Number(editForm.responsible_id), name: users.find(u => u.id === Number(editForm.responsible_id))?.name || '' } : undefined } : r));
      setEditReq(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    const total = requirements.length;
    const implemented = requirements.filter(r => r.implementation_status === 'implemented').length;
    const inProgress = requirements.filter(r => r.implementation_status === 'in_progress').length;
    const open = requirements.filter(r => r.implementation_status === 'not_started').length;
    return { total, implemented, inProgress, open };
  }, [requirements]);

  const availableLayers = useMemo(() => {
    const layers = new Set(requirements.map(r => r.layer));
    return LAYER_ORDER.filter(l => layers.has(l));
  }, [requirements]);

  const filtered = useMemo(() => requirements.filter(r => {
    if (statusFilter && r.implementation_status !== statusFilter) return false;
    if (levelFilter && r.requirement_level !== levelFilter) return false;
    if (layerFilter && r.layer !== layerFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.req_id.toLowerCase().includes(q) && !r.title.toLowerCase().includes(q) && !r.baustein_name.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [requirements, statusFilter, levelFilter, layerFilter, search]);

  const grouped = useMemo(() => {
    const layerMap = new Map<string, Map<string, BsiRequirement[]>>();
    for (const l of LAYER_ORDER) layerMap.set(l, new Map());
    for (const r of filtered) {
      if (!layerMap.has(r.layer)) layerMap.set(r.layer, new Map());
      const bm = layerMap.get(r.layer)!;
      if (!bm.has(r.baustein_id)) bm.set(r.baustein_id, []);
      bm.get(r.baustein_id)!.push(r);
    }
    return Array.from(layerMap.entries()).filter(([, bm]) => bm.size > 0).map(([layer, bm]) => ({ layer, bausteine: Array.from(bm.entries()).map(([baustein_id, reqs]) => ({ baustein_id, baustein_name: reqs[0].baustein_name, reqs })) }));
  }, [filtered]);

  const activeFilterCount = [statusFilter, levelFilter, layerFilter].filter(Boolean).length;

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  if (requirements.length === 0) return (
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
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><BookOpen size={24} className="text-blue-600" />{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', { count: requirements.length })}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('stats.total'), value: stats.total, color: 'bg-blue-500', icon: ListChecks },
          { label: t('stats.implemented'), value: stats.implemented, color: 'bg-green-600', icon: CheckCircle2 },
          { label: t('stats.inProgress'), value: stats.inProgress, color: 'bg-yellow-500', icon: BookOpen },
          { label: t('stats.open'), value: stats.open, color: 'bg-gray-500', icon: Pencil },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div><p className="text-2xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('filter.searchPlaceholder')} activeCount={activeFilterCount} onReset={() => { setSearch(''); setStatusFilter(''); setLevelFilter(''); setLayerFilter(''); }}>
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('filter.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-48" value={levelFilter} onChange={e => setLevelFilter(e.target.value)} options={[{ value: '', label: t('filter.allLevels') }, ...Object.entries(levelLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-36" value={layerFilter} onChange={e => setLayerFilter(e.target.value)} options={[{ value: '', label: t('filter.allLayers') }, ...availableLayers.map(l => ({ value: l, label: l }))]} />
      </FilterBar>

      {grouped.map(({ layer, bausteine }) => {
        const layerColor = LAYER_COLORS[layer] || 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
        return (
          <div key={layer} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${layerColor}`}>{layer}</span>
              <div className="flex-1 h-px bg-gray-100 dark:bg-slate-800" />
            </div>
            {bausteine.map(({ baustein_id, baustein_name, reqs }) => {
              const implementedCount = reqs.filter(r => r.implementation_status === 'implemented').length;
              const pct = reqs.length > 0 ? Math.round((implementedCount / reqs.length) * 100) : 0;
              const isExpanded = !collapsedBausteine.has(baustein_id);
              return (
                <Card key={baustein_id} className="overflow-hidden">
                  <button onClick={() => toggleBaustein(baustein_id)} className="w-full flex items-center gap-3 p-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors text-left">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono shrink-0 ${layerColor}`}>{baustein_id}</span>
                    <span className="flex-1 font-semibold dark:text-white text-sm">{baustein_name}</span>
                    <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{t('table.reqCount', { count: reqs.length })}</span>
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
                          <Th>{t('table.reqId')}</Th><Th>{t('table.title')}</Th><Th>{t('table.level')}</Th><Th>{t('table.status')}</Th><Th>{t('table.lastReview')}</Th><Th>{''}</Th>
                        </tr></Thead>
                        <Tbody>
                          {reqs.map(req => (
                            <tr key={req.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                              <Td><span className="font-mono text-xs text-gray-600 dark:text-slate-400">{req.req_id}</span></Td>
                              <Td><p className="font-medium text-sm dark:text-slate-200">{req.title}</p>{req.responsible && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{req.responsible.name}</p>}</Td>
                              <Td><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${levelColors[req.requirement_level]}`}>{levelLabels[req.requirement_level]}</span></Td>
                              <Td><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColors[req.implementation_status]}`}>{statusLabels[req.implementation_status]}</span></Td>
                              <Td className="text-gray-500 dark:text-slate-400 text-xs">{req.last_review_date ? format(new Date(req.last_review_date), 'dd.MM.yyyy') : '–'}</Td>
                              <Td>{canWrite && <button onClick={() => openEdit(req)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors" title={t('editTitle')}><Pencil size={14} /></button>}</Td>
                            </tr>
                          ))}
                        </Tbody>
                      </Table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        );
      })}

      {grouped.length === 0 && (
        <Card><CardBody><div className="py-12 text-center"><BookOpen size={36} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" /><p className="text-gray-500 dark:text-slate-400">{t('filterEmpty')}</p></div></CardBody></Card>
      )}

      <Modal open={!!editReq} onClose={() => setEditReq(null)} title={editReq ? `${editReq.req_id} – ${editReq.title}` : ''} size="lg">
        <form onSubmit={saveEdit} className="space-y-4">
          {editReq && (
            <div className="flex gap-2 flex-wrap">
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${levelColors[editReq.requirement_level]}`}>{levelLabels[editReq.requirement_level]}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400">{editReq.baustein_id} · {editReq.baustein_name}</span>
            </div>
          )}
          <Select label={t('modal.status')} value={editForm.implementation_status} onChange={e => setEditForm({ ...editForm, implementation_status: e.target.value as ImplStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite} />
          <SearchableSelect label={t('modal.responsible')} value={editForm.responsible_id} onChange={val => setEditForm({ ...editForm, responsible_id: val })} options={[{ value: '', label: t('modal.nobody') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} disabled={!canWrite} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.lastReview')}</label>
            <input type="date" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" value={editForm.last_review_date} onChange={e => setEditForm({ ...editForm, last_review_date: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notes')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} disabled={!canWrite} />
          </div>
          {editReq && (
            <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
              <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">{t('modal.crossRefs')}</p>
              <ControlMappings framework="bsi_grundschutz" ref={editReq.req_id} />
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditReq(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            {canWrite && <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
