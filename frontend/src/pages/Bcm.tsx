import React, { useEffect, useState, useMemo } from 'react';
import { LifeBuoy, Plus, Trash2, Pencil, CalendarCheck, ClipboardCheck } from 'lucide-react';
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

type BcmCriticality = 'critical' | 'important' | 'normal';
type BcmStatus = 'documented' | 'tested' | 'approved';

interface BcmItem {
  id: number;
  name: string;
  description: string;
  criticality: BcmCriticality;
  rto_hours: number | null;
  rpo_hours: number | null;
  owner_id: number | null;
  dependencies: string;
  recovery_strategy: string;
  status: BcmStatus;
  last_test_date: string;
  next_test_date: string;
  notes: string;
  owner?: { id: number; name: string };
}

const criticalityLabels: Record<BcmCriticality, string> = {
  critical: 'Kritisch',
  important: 'Wichtig',
  normal: 'Normal',
};

const criticalityColors: Record<BcmCriticality, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  important: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const statusLabels: Record<BcmStatus, string> = {
  documented: 'Dokumentiert',
  tested: 'Getestet',
  approved: 'Genehmigt',
};

const statusColors: Record<BcmStatus, string> = {
  documented: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
  tested: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

type BcmExerciseType = 'tabletop' | 'simulation' | 'technical_recovery' | 'full_failover';
type BcmExerciseResult = 'pending' | 'passed' | 'passed_with_findings' | 'failed';

interface BcmExercise {
  id: number;
  process_id?: number | null;
  process?: { id: number; name: string; criticality: string } | null;
  title: string;
  exercise_type: BcmExerciseType;
  exercise_date?: string;
  participants?: string;
  result: BcmExerciseResult;
  findings?: string;
  actions?: string;
  notes?: string;
}

const exerciseTypeLabels: Record<BcmExerciseType, string> = {
  tabletop: 'Tabletop-Übung',
  simulation: 'Simulation',
  technical_recovery: 'Technischer Wiederanlauf',
  full_failover: 'Voll-Failover',
};

const exerciseResultLabels: Record<BcmExerciseResult, string> = {
  pending: 'Ausstehend',
  passed: 'Bestanden',
  passed_with_findings: 'Bestanden mit Findings',
  failed: 'Nicht bestanden',
};

const exerciseResultColors: Record<BcmExerciseResult, string> = {
  pending: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
  passed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  passed_with_findings: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const emptyExerciseForm = {
  title: '',
  exercise_type: 'tabletop' as BcmExerciseType,
  process_id: '',
  exercise_date: '',
  participants: '',
  result: 'pending' as BcmExerciseResult,
  findings: '',
  actions: '',
  notes: '',
};

const emptyForm = {
  name: '',
  description: '',
  criticality: 'normal' as BcmCriticality,
  rto_hours: '',
  rpo_hours: '',
  owner_id: '',
  dependencies: '',
  recovery_strategy: '',
  status: 'documented' as BcmStatus,
  last_test_date: '',
  next_test_date: '',
  notes: '',
};

export const Bcm: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);
  const canDelete = user?.role === 'admin' || user?.role === 'assessor';

  const [tab, setTab] = useState<'processes' | 'exercises'>('processes');
  const [items, setItems] = useState<BcmItem[]>([]);
  const [exercises, setExercises] = useState<BcmExercise[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [critFilter, setCritFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [exerciseModalOpen, setExerciseModalOpen] = useState(false);
  const [exerciseEditId, setExerciseEditId] = useState<number | null>(null);
  const [exerciseForm, setExerciseForm] = useState({ ...emptyExerciseForm });
  const [exerciseSaving, setExerciseSaving] = useState(false);

  const load = () =>
    api.get('/bcm').then(r => setItems(r.data)).catch(() => setItems([])).finally(() => setLoading(false));

  const loadExercises = () =>
    api.get('/bcm/exercises').then(r => setExercises(r.data)).catch(() => setExercises([]));

  useEffect(() => {
    load();
    loadExercises();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const today = new Date();

  const filtered = useMemo(() => items.filter(i => {
    if (critFilter && i.criticality !== critFilter) return false;
    if (statusFilter && i.status !== statusFilter) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) &&
      !i.description?.toLowerCase().includes(search.toLowerCase()) &&
      !i.recovery_strategy?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, critFilter, statusFilter, search]);

  const stats = useMemo(() => ({
    total: items.length,
    critical: items.filter(i => i.criticality === 'critical').length,
    testOverdue: items.filter(i => i.next_test_date && new Date(i.next_test_date) < today).length,
    approved: items.filter(i => i.status === 'approved').length,
  }), [items]);

  const openNew = () => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); };
  const openEdit = (i: BcmItem) => {
    setEditId(i.id);
    setForm({
      name: i.name,
      description: i.description || '',
      criticality: i.criticality,
      rto_hours: i.rto_hours != null ? String(i.rto_hours) : '',
      rpo_hours: i.rpo_hours != null ? String(i.rpo_hours) : '',
      owner_id: i.owner_id ? String(i.owner_id) : '',
      dependencies: i.dependencies || '',
      recovery_strategy: i.recovery_strategy || '',
      status: i.status,
      last_test_date: i.last_test_date || '',
      next_test_date: i.next_test_date || '',
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
        rto_hours: form.rto_hours !== '' ? Number(form.rto_hours) : null,
        rpo_hours: form.rpo_hours !== '' ? Number(form.rpo_hours) : null,
      };
      if (editId) await api.put(`/bcm/${editId}`, payload);
      else await api.post('/bcm', payload);
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (i: BcmItem) => {
    if (!confirm(`„${i.name}" wirklich löschen?`)) return;
    try {
      await api.delete(`/bcm/${i.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const isTestOverdue = (item: BcmItem) =>
    item.next_test_date && new Date(item.next_test_date) < today;

  const exerciseStats = useMemo(() => ({
    total: exercises.length,
    passed: exercises.filter(e => e.result === 'passed').length,
    withFindings: exercises.filter(e => e.result === 'passed_with_findings').length,
    failed: exercises.filter(e => e.result === 'failed').length,
  }), [exercises]);

  const openNewExercise = () => { setExerciseEditId(null); setExerciseForm({ ...emptyExerciseForm }); setExerciseModalOpen(true); };
  const openEditExercise = (ex: BcmExercise) => {
    setExerciseEditId(ex.id);
    setExerciseForm({
      title: ex.title,
      exercise_type: ex.exercise_type,
      process_id: ex.process_id ? String(ex.process_id) : '',
      exercise_date: ex.exercise_date || '',
      participants: ex.participants || '',
      result: ex.result,
      findings: ex.findings || '',
      actions: ex.actions || '',
      notes: ex.notes || '',
    });
    setExerciseModalOpen(true);
  };

  const saveExercise = async (e: React.FormEvent) => {
    e.preventDefault();
    setExerciseSaving(true);
    try {
      const payload = {
        ...exerciseForm,
        process_id: exerciseForm.process_id !== '' ? Number(exerciseForm.process_id) : null,
      };
      if (exerciseEditId) await api.put(`/bcm/exercises/${exerciseEditId}`, payload);
      else await api.post('/bcm/exercises', payload);
      setExerciseModalOpen(false);
      loadExercises();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setExerciseSaving(false);
    }
  };

  const removeExercise = async (ex: BcmExercise) => {
    if (!confirm(`„${ex.title}" wirklich löschen?`)) return;
    try {
      await api.delete(`/bcm/exercises/${ex.id}`);
      loadExercises();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
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
            <LifeBuoy size={24} className="text-blue-600" />
            {tab === 'processes' ? 'BCM – Prozessregister' : 'BCM – Übungsprotokoll'}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {tab === 'processes'
              ? `Business Continuity Management – kritische Geschäftsprozesse und Wiederanlaufstrategien · ${items.length} Einträge`
              : `Notfall- und Wiederanlaufübungen · ${exercises.length} Einträge`}
          </p>
        </div>
        {canWrite && tab === 'processes' && <Button onClick={openNew}><Plus size={16} />Prozess erfassen</Button>}
        {canWrite && tab === 'exercises' && <Button onClick={openNewExercise}><Plus size={16} />Übung erfassen</Button>}
      </div>

      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar scroll-smooth">
          {([
            { key: 'processes' as const, label: 'Prozesse (BIA)', icon: LifeBuoy },
            { key: 'exercises' as const, label: 'Übungsprotokoll', icon: ClipboardCheck },
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

      {tab === 'processes' && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Gesamt', value: stats.total, color: 'bg-blue-500' },
          { label: 'Kritische Prozesse', value: stats.critical, color: 'bg-red-500' },
          { label: 'Test überfällig', value: stats.testOverdue, color: 'bg-orange-500' },
          { label: 'Genehmigt', value: stats.approved, color: 'bg-green-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <LifeBuoy className="text-white" size={18} />
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
        searchPlaceholder="Prozess oder Wiederanlaufstrategie suchen..."
        activeCount={[critFilter, statusFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setCritFilter(''); setStatusFilter(''); }}
      >
        <Select
          className="w-44"
          value={critFilter}
          onChange={e => setCritFilter(e.target.value)}
          options={[{ value: '', label: 'Alle Kritikalitäten' }, ...Object.entries(criticalityLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
        <Select
          className="w-40"
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
                <Th>Prozess</Th>
                <Th>Kritikalität</Th>
                <Th>RTO / RPO</Th>
                <Th>Status</Th>
                <Th>Verantwortlich</Th>
                <Th>Nächster Test</Th>
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
                    {i.description && <p className="text-[11px] text-gray-400 line-clamp-1">{i.description}</p>}
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${criticalityColors[i.criticality]}`}>
                      {criticalityLabels[i.criticality]}
                    </span>
                  </Td>
                  <Td>
                    {(i.rto_hours != null || i.rpo_hours != null) ? (
                      <span className="text-xs text-gray-500 font-mono">
                        {i.rto_hours != null ? `RTO ${i.rto_hours}h` : ''}
                        {i.rto_hours != null && i.rpo_hours != null ? ' / ' : ''}
                        {i.rpo_hours != null ? `RPO ${i.rpo_hours}h` : ''}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[i.status]}`}>
                      {statusLabels[i.status]}
                    </span>
                  </Td>
                  <Td className="text-gray-500">{i.owner?.name || '–'}</Td>
                  <Td>
                    {i.next_test_date ? (
                      <span className={`text-xs flex items-center gap-1 ${isTestOverdue(i) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                        <CalendarCheck size={11} />
                        {format(new Date(i.next_test_date), 'dd.MM.yyyy')}
                        {isTestOverdue(i) && ' ⚠'}
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
                      <LifeBuoy size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                      <p className="text-gray-500 dark:text-slate-400 font-medium">Keine BCM-Prozesse gefunden</p>
                      {canWrite && (
                        <button
                          onClick={openNew}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> Prozess erfassen
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
      </>)}

      {tab === 'exercises' && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Übungen gesamt', value: exerciseStats.total, color: 'bg-blue-500' },
          { label: 'Bestanden', value: exerciseStats.passed, color: 'bg-green-600' },
          { label: 'Mit Findings', value: exerciseStats.withFindings, color: 'bg-amber-500' },
          { label: 'Nicht bestanden', value: exerciseStats.failed, color: 'bg-red-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <ClipboardCheck className="text-white" size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead>
              <tr>
                <Th>Titel</Th>
                <Th>Übungsart</Th>
                <Th>Prozess</Th>
                <Th>Datum</Th>
                <Th>Ergebnis</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {exercises.map(ex => (
                <tr
                  key={ex.id}
                  className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => openEditExercise(ex)}
                >
                  <Td>
                    <p className="font-medium dark:text-slate-200">{ex.title}</p>
                    {ex.participants && <p className="text-[11px] text-gray-400 line-clamp-1">{ex.participants}</p>}
                  </Td>
                  <Td className="text-gray-600 dark:text-slate-300">{exerciseTypeLabels[ex.exercise_type]}</Td>
                  <Td className="text-gray-500">{ex.process?.name || '—'}</Td>
                  <Td className="text-gray-500">
                    {ex.exercise_date ? format(new Date(ex.exercise_date), 'dd.MM.yyyy') : '–'}
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${exerciseResultColors[ex.result]}`}>
                      {exerciseResultLabels[ex.result]}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {canWrite && (
                        <>
                          <button
                            onClick={() => openEditExercise(ex)}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => removeExercise(ex)}
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
              {exercises.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="py-16 text-center">
                      <ClipboardCheck size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                      <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Übungen gefunden</p>
                      {canWrite && (
                        <button
                          onClick={openNewExercise}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> Übung erfassen
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
      </>)}

      <Modal
        open={exerciseModalOpen}
        onClose={() => setExerciseModalOpen(false)}
        title={exerciseEditId ? 'Übung bearbeiten' : 'Übung erfassen'}
        size="lg"
      >
        <form onSubmit={saveExercise} className="space-y-4">
          <Input
            label="Titel *"
            value={exerciseForm.title}
            onChange={e => setExerciseForm({ ...exerciseForm, title: e.target.value })}
            required
            placeholder="z. B. Notfallübung Rechenzentrumsausfall"
            disabled={!canWrite}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Übungsart"
              value={exerciseForm.exercise_type}
              onChange={e => setExerciseForm({ ...exerciseForm, exercise_type: e.target.value as BcmExerciseType })}
              options={Object.entries(exerciseTypeLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label="Prozess"
              value={exerciseForm.process_id}
              onChange={e => setExerciseForm({ ...exerciseForm, process_id: e.target.value })}
              options={[{ value: '', label: '— Kein Prozess —' }, ...items.map(p => ({ value: String(p.id), label: p.name }))]}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Übungsdatum"
              type="date"
              value={exerciseForm.exercise_date}
              onChange={e => setExerciseForm({ ...exerciseForm, exercise_date: e.target.value })}
              disabled={!canWrite}
            />
            <Select
              label="Ergebnis"
              value={exerciseForm.result}
              onChange={e => setExerciseForm({ ...exerciseForm, result: e.target.value as BcmExerciseResult })}
              options={Object.entries(exerciseResultLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <Input
            label="Teilnehmer"
            value={exerciseForm.participants}
            onChange={e => setExerciseForm({ ...exerciseForm, participants: e.target.value })}
            placeholder="z. B. IT-Team, Notfallstab, Fachbereiche"
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Findings</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={exerciseForm.findings}
              onChange={e => setExerciseForm({ ...exerciseForm, findings: e.target.value })}
              placeholder="Festgestellte Schwachstellen und Auffälligkeiten"
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Maßnahmen</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={exerciseForm.actions}
              onChange={e => setExerciseForm({ ...exerciseForm, actions: e.target.value })}
              placeholder="Abgeleitete Verbesserungsmaßnahmen"
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notizen</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={exerciseForm.notes}
              onChange={e => setExerciseForm({ ...exerciseForm, notes: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setExerciseModalOpen(false)} className="flex-1 justify-center">
              Abbrechen
            </Button>
            {canWrite && (
              <Button type="submit" disabled={exerciseSaving} className="flex-1 justify-center">
                {exerciseSaving ? 'Speichern...' : (exerciseEditId ? 'Aktualisieren' : 'Anlegen')}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'BCM-Prozess bearbeiten' : 'BCM-Prozess erfassen'}
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <Input
            label="Prozessname *"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
            placeholder="z. B. Auftragsabwicklung, IT-Notfallbetrieb"
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Kurzbeschreibung des Geschäftsprozesses"
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Kritikalität"
              value={form.criticality}
              onChange={e => setForm({ ...form, criticality: e.target.value as BcmCriticality })}
              options={Object.entries(criticalityLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value as BcmStatus })}
              options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="RTO (Stunden)"
              type="number"
              min={0}
              value={form.rto_hours}
              onChange={e => setForm({ ...form, rto_hours: e.target.value })}
              placeholder="Recovery Time Objective in Stunden"
              disabled={!canWrite}
            />
            <Input
              label="RPO (Stunden)"
              type="number"
              min={0}
              value={form.rpo_hours}
              onChange={e => setForm({ ...form, rpo_hours: e.target.value })}
              placeholder="Recovery Point Objective in Stunden"
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
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Abhängigkeiten</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.dependencies}
              onChange={e => setForm({ ...form, dependencies: e.target.value })}
              placeholder="Systeme, Ressourcen und Prozesse, von denen dieser Prozess abhängt"
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Wiederanlaufstrategie</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.recovery_strategy}
              onChange={e => setForm({ ...form, recovery_strategy: e.target.value })}
              placeholder="Beschreibung der Notfall- und Wiederanlaufmaßnahmen"
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Letzter Test"
              type="date"
              value={form.last_test_date}
              onChange={e => setForm({ ...form, last_test_date: e.target.value })}
              disabled={!canWrite}
            />
            <Input
              label="Nächster Test"
              type="date"
              value={form.next_test_date}
              onChange={e => setForm({ ...form, next_test_date: e.target.value })}
              disabled={!canWrite}
            />
          </div>
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
    </div>
  );
};
