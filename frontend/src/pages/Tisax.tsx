import React, { useEffect, useState, useMemo } from 'react';
import { Shield, Plus, Trash2, Pencil, CalendarCheck, ListChecks, Target, CheckCircle2, Gauge, Download } from 'lucide-react';
import { format } from 'date-fns';
import api from '../lib/api';
import type { User } from '../types';
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

type TisaxStatus = 'preparation' | 'requested' | 'scheduled' | 'audit_done' | 'label_received';
type AssessmentLevel = 'AL2' | 'AL3';

interface TisaxItem {
  id: number;
  scope_description: string;
  assessment_level: AssessmentLevel;
  label_requested: string;
  status: TisaxStatus;
  auditor_company: string;
  assessment_date: string;
  label_valid_until: string;
  owner_id: number | null;
  owner?: { name: string };
  notes: string;
}

const statusLabels: Record<TisaxStatus, string> = {
  preparation: 'Vorbereitung',
  requested: 'Angefragt',
  scheduled: 'Terminiert',
  audit_done: 'Audit abgeschlossen',
  label_received: 'Label erhalten',
};

const statusColors: Record<TisaxStatus, string> = {
  preparation: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  requested: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  scheduled: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  audit_done: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  label_received: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

type ReqStatus = 'open' | 'in_progress' | 'implemented' | 'not_applicable';

interface TisaxRequirement {
  id: number;
  ref: string;
  chapter: string;
  title: string;
  question?: string;
  maturity_level: number | null;
  target_level: number;
  status: ReqStatus;
  notes?: string;
}

const reqStatusLabels: Record<ReqStatus, string> = {
  open: 'Offen',
  in_progress: 'In Umsetzung',
  implemented: 'Umgesetzt',
  not_applicable: 'Nicht anwendbar',
};

const reqStatusColors: Record<ReqStatus, string> = {
  open: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  not_applicable: 'bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500',
};

const RequirementsTab: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);
  const canManage = user?.role === 'admin' || user?.role === 'assessor';

  const [reqs, setReqs] = useState<TisaxRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [editReq, setEditReq] = useState<TisaxRequirement | null>(null);
  const [editForm, setEditForm] = useState({ status: 'open' as ReqStatus, target_level: 3, notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/tisax/requirements')
      .then(r => setReqs(r.data))
      .catch(() => setReqs([]))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/tisax/requirements/seed');
      await load();
    } catch (err: any) {
      if (err.response?.status === 409) await load();
      else toast.error(err.response?.data?.error || 'Fehler beim Laden des Katalogs');
    } finally {
      setSeeding(false);
    }
  };

  const setLevel = (req: TisaxRequirement, level: number) => {
    if (!canWrite || req.status === 'not_applicable') return;
    const newLevel = req.maturity_level === level ? null : level;
    const prev = reqs;
    setReqs(rs => rs.map(r => (r.id === req.id ? { ...r, maturity_level: newLevel } : r)));
    api.put(`/tisax/requirements/${req.id}`, { maturity_level: newLevel }).catch((err: any) => {
      setReqs(prev);
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    });
  };

  const openEdit = (r: TisaxRequirement) => {
    setEditReq(r);
    setEditForm({ status: r.status, target_level: r.target_level, notes: r.notes || '' });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editReq) return;
    setSaving(true);
    try {
      await api.put(`/tisax/requirements/${editReq.id}`, editForm);
      setReqs(rs => rs.map(r => (r.id === editReq.id ? { ...r, ...editForm } : r)));
      setEditReq(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const removeReq = async (r: TisaxRequirement) => {
    if (!confirm(`Anforderung ${r.ref} „${r.title}" wirklich löschen?`)) return;
    try {
      await api.delete(`/tisax/requirements/${r.id}`);
      setReqs(rs => rs.filter(x => x.id !== r.id));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const stats = useMemo(() => {
    const relevant = reqs.filter(r => r.status !== 'not_applicable');
    const assessed = relevant.filter(r => r.maturity_level !== null);
    const reached = assessed.filter(r => (r.maturity_level as number) >= r.target_level);
    const avg = assessed.length
      ? (assessed.reduce((s, r) => s + (r.maturity_level || 0), 0) / assessed.length).toFixed(1)
      : '–';
    return { total: relevant.length, assessed: assessed.length, reached: reached.length, avg };
  }, [reqs]);

  const chapters = useMemo(() => {
    const map = new Map<string, TisaxRequirement[]>();
    for (const r of reqs) {
      if (!map.has(r.chapter)) map.set(r.chapter, []);
      map.get(r.chapter)!.push(r);
    }
    return Array.from(map.entries());
  }, [reqs]);

  if (loading) return (
    <div className="flex justify-center pt-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  if (reqs.length === 0) return (
    <Card>
      <CardBody>
        <div className="py-16 text-center">
          <ListChecks size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
          <p className="text-gray-500 dark:text-slate-400 font-medium">Noch keine VDA-ISA-Anforderungen vorhanden</p>
          <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
            Lade den integrierten VDA-ISA-Katalog, um mit der Reifegrad-Selbstbewertung zu starten.
          </p>
          {canManage && (
            <Button onClick={seed} disabled={seeding} className="mt-4">
              <Download size={16} />{seeding ? 'Lade Katalog...' : 'VDA-ISA-Katalog laden'}
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Anforderungen', value: stats.total, color: 'bg-blue-500', icon: ListChecks },
          { label: 'Bewertet', value: stats.assessed, color: 'bg-yellow-500', icon: CheckCircle2 },
          { label: 'Ziel erreicht', value: stats.reached, color: 'bg-green-600', icon: Target },
          { label: 'Ø Reifegrad', value: stats.avg, color: 'bg-purple-600', icon: Gauge },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <s.icon className="text-white" size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {chapters.map(([chapter, items]) => {
        const relevant = items.filter(r => r.status !== 'not_applicable');
        const reached = relevant.filter(r => r.maturity_level !== null && r.maturity_level >= r.target_level).length;
        return (
          <Card key={chapter}>
            <CardBody className="p-0">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                <h2 className="font-semibold text-sm dark:text-white">{chapter}</h2>
                <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">
                  {reached}/{relevant.length} Ziel erreicht
                </span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {items.map(r => {
                  const na = r.status === 'not_applicable';
                  return (
                    <div
                      key={r.id}
                      className={`px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3 ${na ? 'opacity-50' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-gray-500 dark:text-slate-400">{r.ref}</span>
                          <span className="font-medium text-sm dark:text-slate-200">{r.title}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${reqStatusColors[r.status]}`}>
                            {reqStatusLabels[r.status]}
                          </span>
                        </div>
                        {r.question && (
                          <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{r.question}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex gap-1">
                          {[0, 1, 2, 3, 4, 5].map(n => {
                            const selected = r.maturity_level === n;
                            return (
                              <button
                                key={n}
                                type="button"
                                disabled={!canWrite || na}
                                onClick={() => setLevel(r, n)}
                                title={selected ? 'Bewertung entfernen' : `Reifegrad ${n}`}
                                className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                                  selected
                                    ? n >= r.target_level
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-amber-500 text-white'
                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                                }`}
                              >
                                {n}
                              </button>
                            );
                          })}
                        </div>
                        <span className="text-[11px] text-gray-400 dark:text-slate-500 w-11">Ziel: {r.target_level}</span>
                        {canWrite && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEdit(r)}
                              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                            {canManage && (
                              <button
                                onClick={() => removeReq(r)}
                                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        );
      })}

      <Modal
        open={!!editReq}
        onClose={() => setEditReq(null)}
        title={editReq ? `${editReq.ref} – ${editReq.title}` : ''}
      >
        <form onSubmit={saveEdit} className="space-y-4">
          <Select
            label="Status"
            value={editForm.status}
            onChange={e => setEditForm({ ...editForm, status: e.target.value as ReqStatus })}
            options={Object.entries(reqStatusLabels).map(([v, l]) => ({ value: v, label: l }))}
            disabled={!canWrite}
          />
          <Input
            label="Ziel-Reifegrad"
            type="number"
            min={1}
            max={5}
            value={String(editForm.target_level)}
            onChange={e => setEditForm({ ...editForm, target_level: Number(e.target.value) })}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notizen</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={3}
              value={editForm.notes}
              onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditReq(null)} className="flex-1 justify-center">
              Abbrechen
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saving} className="flex-1 justify-center">
                {saving ? 'Speichern...' : 'Speichern'}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
};

const emptyForm = {
  scope_description: '',
  assessment_level: 'AL2' as AssessmentLevel,
  label_requested: '',
  status: 'preparation' as TisaxStatus,
  auditor_company: '',
  assessment_date: '',
  label_valid_until: '',
  owner_id: '',
  notes: '',
};

export const Tisax: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);

  const [tab, setTab] = useState<'assessments' | 'requirements'>('assessments');
  const [items, setItems] = useState<TisaxItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/tisax')
      .then(r => setItems(r.data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const today = new Date();

  const filtered = useMemo(() => items.filter(i => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (search && !i.scope_description.toLowerCase().includes(search.toLowerCase()) &&
      !i.auditor_company?.toLowerCase().includes(search.toLowerCase()) &&
      !i.label_requested?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, statusFilter, search]);

  const stats = useMemo(() => ({
    total: items.length,
    active: items.filter(i => ['preparation', 'requested', 'scheduled'].includes(i.status)).length,
    labelReceived: items.filter(i => i.status === 'label_received').length,
    overdue: items.filter(i =>
      i.status === 'label_received' && i.label_valid_until && new Date(i.label_valid_until) < today
    ).length,
  }), [items]);

  const openNew = () => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); };
  const openEdit = (i: TisaxItem) => {
    setEditId(i.id);
    setForm({
      scope_description: i.scope_description,
      assessment_level: i.assessment_level,
      label_requested: i.label_requested || '',
      status: i.status,
      auditor_company: i.auditor_company || '',
      assessment_date: i.assessment_date || '',
      label_valid_until: i.label_valid_until || '',
      owner_id: i.owner_id ? String(i.owner_id) : '',
      notes: i.notes || '',
    });
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, owner_id: form.owner_id || null };
      if (editId) await api.put(`/tisax/${editId}`, payload);
      else await api.post('/tisax', payload);
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (i: TisaxItem) => {
    if (!confirm(`„${i.scope_description}" wirklich löschen?`)) return;
    try {
      await api.delete(`/tisax/${i.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const isExpired = (item: TisaxItem) =>
    item.status === 'label_received' && item.label_valid_until && new Date(item.label_valid_until) < today;

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
            <Shield size={24} className="text-blue-600" />TISAX Assessments
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            Trusted Information Security Assessment Exchange · {items.length} Einträge
          </p>
        </div>
        {canWrite && tab === 'assessments' && <Button onClick={openNew}><Plus size={16} />Assessment erfassen</Button>}
      </div>

      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar scroll-smooth">
          {([
            { key: 'assessments' as const, label: 'Assessments', icon: Shield },
            { key: 'requirements' as const, label: 'VDA-ISA-Anforderungen', icon: ListChecks },
          ]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === key ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 hover:border-gray-300'
              }`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'requirements' && <RequirementsTab />}

      {tab === 'assessments' && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Gesamt', value: stats.total, color: 'bg-blue-500' },
          { label: 'Aktiv', value: stats.active, color: 'bg-yellow-500' },
          { label: 'Label erhalten', value: stats.labelReceived, color: 'bg-green-600' },
          { label: 'Überfällig', value: stats.overdue, color: 'bg-red-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <Shield className="text-white" size={18} />
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
        searchPlaceholder="Scope oder Prüfgesellschaft suchen..."
        activeCount={[statusFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setStatusFilter(''); }}
      >
        <Select
          className="w-44"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          options={[{ value: '', label: 'Alle Status' }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
      </FilterBar>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead>
              <tr>
                <Th>Scope</Th>
                <Th>Level</Th>
                <Th>Label</Th>
                <Th>Status</Th>
                <Th>Assessment-Datum</Th>
                <Th>Gültig bis</Th>
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
                    <p className="font-medium dark:text-slate-200 line-clamp-2">{i.scope_description}</p>
                    {i.auditor_company && (
                      <p className="text-[11px] text-gray-400">{i.auditor_company}</p>
                    )}
                  </Td>
                  <Td>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 font-mono">
                      {i.assessment_level}
                    </span>
                  </Td>
                  <Td className="text-gray-500 dark:text-slate-400">{i.label_requested || '–'}</Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[i.status]}`}>
                      {statusLabels[i.status]}
                    </span>
                  </Td>
                  <Td className="text-gray-500">
                    {i.assessment_date ? format(new Date(i.assessment_date), 'dd.MM.yyyy') : '–'}
                  </Td>
                  <Td>
                    {i.label_valid_until ? (
                      <span className={`text-xs flex items-center gap-1 ${isExpired(i) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                        <CalendarCheck size={11} />
                        {format(new Date(i.label_valid_until), 'dd.MM.yyyy')}
                        {isExpired(i) && ' ⚠'}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </Td>
                  <Td>
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {canWrite && (
                        <>
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
                      <Shield size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                      <p className="text-gray-500 dark:text-slate-400 font-medium">Keine TISAX-Assessments gefunden</p>
                      {canWrite && (
                        <button
                          onClick={openNew}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> Assessment erfassen
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
        title={editId ? 'TISAX Assessment bearbeiten' : 'TISAX Assessment erfassen'}
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Scope-Beschreibung *</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={3}
              value={form.scope_description}
              onChange={e => setForm({ ...form, scope_description: e.target.value })}
              placeholder="Beschreibung des TISAX-Scopes und der zu bewertenden Standorte / Bereiche"
              required
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Assessment Level"
              value={form.assessment_level}
              onChange={e => setForm({ ...form, assessment_level: e.target.value as AssessmentLevel })}
              options={[
                { value: 'AL2', label: 'AL2 – Hoher Schutzbedarf' },
                { value: 'AL3', label: 'AL3 – Sehr hoher Schutzbedarf' },
              ]}
              disabled={!canWrite}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value as TisaxStatus })}
              options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Angefordertes Label"
              value={form.label_requested}
              onChange={e => setForm({ ...form, label_requested: e.target.value })}
              placeholder="z. B. TISAX Label – Information High"
              disabled={!canWrite}
            />
            <Input
              label="Prüfgesellschaft"
              value={form.auditor_company}
              onChange={e => setForm({ ...form, auditor_company: e.target.value })}
              placeholder="Name des zugelassenen Prüfdienstleisters"
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Assessment-Datum"
              type="date"
              value={form.assessment_date}
              onChange={e => setForm({ ...form, assessment_date: e.target.value })}
              disabled={!canWrite}
            />
            <Input
              label="Label gültig bis"
              type="date"
              value={form.label_valid_until}
              onChange={e => setForm({ ...form, label_valid_until: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <SearchableSelect
            label="Verantwortliche Person"
            value={form.owner_id}
            onChange={val => setForm({ ...form, owner_id: val })}
            options={[{ value: '', label: '– niemand –' }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notizen</label>
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
              Abbrechen
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saving} className="flex-1 justify-center">
                {saving ? 'Speichern...' : (editId ? 'Aktualisieren' : 'Anlegen')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
      </>)}
    </div>
  );
};
