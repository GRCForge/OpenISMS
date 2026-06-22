import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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



const criticalityColors: Record<BcmCriticality, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  important: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  normal: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
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
  const { t } = useTranslation('bcm');
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);

  const criticalityLabels = useMemo<Record<BcmCriticality, string>>(() => ({
    critical: t('criticality.critical'),
    important: t('criticality.important'),
    normal: t('criticality.normal'),
  }), [t]);

  const statusLabels = useMemo<Record<BcmStatus, string>>(() => ({
    documented: t('status.documented'),
    tested: t('status.tested'),
    approved: t('status.approved'),
  }), [t]);

  const exerciseTypeLabels = useMemo<Record<BcmExerciseType, string>>(() => ({
    tabletop: t('exerciseType.tabletop'),
    simulation: t('exerciseType.simulation'),
    technical_recovery: t('exerciseType.technical_recovery'),
    full_failover: t('exerciseType.full_failover'),
  }), [t]);

  const exerciseResultLabels = useMemo<Record<BcmExerciseResult, string>>(() => ({
    pending: t('exerciseResult.pending'),
    passed: t('exerciseResult.passed'),
    passed_with_findings: t('exerciseResult.passed_with_findings'),
    failed: t('exerciseResult.failed'),
  }), [t]);
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
      toast.error(err.response?.data?.error || t('errors.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (i: BcmItem) => {
    if (!confirm(t('confirm.deleteProcess', { name: i.name }))) return;
    try {
      await api.delete(`/bcm/${i.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('errors.generic'));
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
      toast.error(err.response?.data?.error || t('errors.saveError'));
    } finally {
      setExerciseSaving(false);
    }
  };

  const removeExercise = async (ex: BcmExercise) => {
    if (!confirm(t('confirm.deleteExercise', { title: ex.title }))) return;
    try {
      await api.delete(`/bcm/exercises/${ex.id}`);
      loadExercises();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('errors.generic'));
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
            {tab === 'processes' ? t('title.processes') : t('title.exercises')}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {tab === 'processes'
              ? t('subtitle.processes', { count: items.length })
              : t('subtitle.exercises', { count: exercises.length })}
          </p>
        </div>
        {canWrite && tab === 'processes' && <Button onClick={openNew}><Plus size={16} />{t('button.addProcess')}</Button>}
        {canWrite && tab === 'exercises' && <Button onClick={openNewExercise}><Plus size={16} />{t('button.addExercise')}</Button>}
      </div>

      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar scroll-smooth">
          {([
            { key: 'processes' as const, label: t('tab.processes'), icon: LifeBuoy },
            { key: 'exercises' as const, label: t('tab.exercises'), icon: ClipboardCheck },
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
          { label: t('stats.total'), value: stats.total, color: 'bg-blue-500' },
          { label: t('stats.critical'), value: stats.critical, color: 'bg-red-500' },
          { label: t('stats.testOverdue'), value: stats.testOverdue, color: 'bg-orange-500' },
          { label: t('stats.approved'), value: stats.approved, color: 'bg-green-600' },
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
        searchPlaceholder={t('filter.searchPlaceholder')}
        activeCount={[critFilter, statusFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setCritFilter(''); setStatusFilter(''); }}
      >
        <Select
          className="w-44"
          value={critFilter}
          onChange={e => setCritFilter(e.target.value)}
          options={[{ value: '', label: t('filter.allCriticalities') }, ...Object.entries(criticalityLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
        <Select
          className="w-40"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          options={[{ value: '', label: t('filter.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
      </FilterBar>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead>
              <tr>
                <Th>{t('table.process')}</Th>
                <Th>{t('table.criticality')}</Th>
                <Th>{t('table.rto_rpo')}</Th>
                <Th>{t('table.status')}</Th>
                <Th>{t('table.owner')}</Th>
                <Th>{t('table.nextTest')}</Th>
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
                        {i.rto_hours != null ? t('rtoFormat', { count: i.rto_hours }) : ''}
                        {i.rto_hours != null && i.rpo_hours != null ? ' / ' : ''}
                        {i.rpo_hours != null ? t('rpoFormat', { count: i.rpo_hours }) : ''}
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
                      <p className="text-gray-500 dark:text-slate-400 font-medium">{t('noProcesses')}</p>
                      {canWrite && (
                        <button
                          onClick={openNew}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> {t('button.addProcess')}
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
          { label: t('stats.exercisesTotal'), value: exerciseStats.total, color: 'bg-blue-500' },
          { label: t('stats.passed'), value: exerciseStats.passed, color: 'bg-green-600' },
          { label: t('stats.withFindings'), value: exerciseStats.withFindings, color: 'bg-amber-500' },
          { label: t('stats.failed'), value: exerciseStats.failed, color: 'bg-red-500' },
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
                <Th>{t('table.title')}</Th>
                <Th>{t('table.exerciseType')}</Th>
                <Th>{t('table.process')}</Th>
                <Th>{t('table.date')}</Th>
                <Th>{t('table.result')}</Th>
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
                      <p className="text-gray-500 dark:text-slate-400 font-medium">{t('noExercises')}</p>
                      {canWrite && (
                        <button
                          onClick={openNewExercise}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> {t('button.addExercise')}
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
        title={exerciseEditId ? t('modal.editExercise') : t('modal.addExercise')}
        size="lg"
      >
        <form onSubmit={saveExercise} className="space-y-4">
          <Input
            label={t('form.titleRequired')}
            value={exerciseForm.title}
            onChange={e => setExerciseForm({ ...exerciseForm, title: e.target.value })}
            required
            placeholder={t('form.titlePlaceholder')}
            disabled={!canWrite}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label={t('form.exerciseType')}
              value={exerciseForm.exercise_type}
              onChange={e => setExerciseForm({ ...exerciseForm, exercise_type: e.target.value as BcmExerciseType })}
              options={Object.entries(exerciseTypeLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label={t('form.process')}
              value={exerciseForm.process_id}
              onChange={e => setExerciseForm({ ...exerciseForm, process_id: e.target.value })}
              options={[{ value: '', label: t('form.noProcess') }, ...items.map(p => ({ value: String(p.id), label: p.name }))]}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('form.exerciseDate')}
              type="date"
              value={exerciseForm.exercise_date}
              onChange={e => setExerciseForm({ ...exerciseForm, exercise_date: e.target.value })}
              disabled={!canWrite}
            />
            <Select
              label={t('form.result')}
              value={exerciseForm.result}
              onChange={e => setExerciseForm({ ...exerciseForm, result: e.target.value as BcmExerciseResult })}
              options={Object.entries(exerciseResultLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <Input
            label={t('form.participants')}
            value={exerciseForm.participants}
            onChange={e => setExerciseForm({ ...exerciseForm, participants: e.target.value })}
            placeholder={t('form.participantsPlaceholder')}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.findings')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={exerciseForm.findings}
              onChange={e => setExerciseForm({ ...exerciseForm, findings: e.target.value })}
              placeholder={t('form.findingsPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.actions')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={exerciseForm.actions}
              onChange={e => setExerciseForm({ ...exerciseForm, actions: e.target.value })}
              placeholder={t('form.actionsPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.notes')}</label>
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
              {t('button.cancel')}
            </Button>
            {canWrite && (
              <Button type="submit" disabled={exerciseSaving} className="flex-1 justify-center">
                {exerciseSaving ? t('button.saving') : (exerciseEditId ? t('button.update') : t('button.create'))}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? t('modal.editProcess') : t('modal.addProcess')}
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <Input
            label={t('form.processNameRequired')}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            required
            placeholder={t('form.processNamePlaceholder')}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.description')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder={t('form.descriptionPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label={t('form.criticality')}
              value={form.criticality}
              onChange={e => setForm({ ...form, criticality: e.target.value as BcmCriticality })}
              options={Object.entries(criticalityLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label={t('form.status')}
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value as BcmStatus })}
              options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('form.rto')}
              type="number"
              min={0}
              value={form.rto_hours}
              onChange={e => setForm({ ...form, rto_hours: e.target.value })}
              placeholder={t('form.rtoPlaceholder')}
              disabled={!canWrite}
            />
            <Input
              label={t('form.rpo')}
              type="number"
              min={0}
              value={form.rpo_hours}
              onChange={e => setForm({ ...form, rpo_hours: e.target.value })}
              placeholder={t('form.rpoPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <SearchableSelect
            label={t('form.owner')}
            value={form.owner_id}
            onChange={val => setForm({ ...form, owner_id: val })}
            options={[{ value: '', label: t('form.noOwner') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.dependencies')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.dependencies}
              onChange={e => setForm({ ...form, dependencies: e.target.value })}
              placeholder={t('form.dependenciesPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.recoveryStrategy')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.recovery_strategy}
              onChange={e => setForm({ ...form, recovery_strategy: e.target.value })}
              placeholder={t('form.recoveryStrategyPlaceholder')}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('form.lastTest')}
              type="date"
              value={form.last_test_date}
              onChange={e => setForm({ ...form, last_test_date: e.target.value })}
              disabled={!canWrite}
            />
            <Input
              label={t('form.nextTest')}
              type="date"
              value={form.next_test_date}
              onChange={e => setForm({ ...form, next_test_date: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.notes')}</label>
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
              {t('button.cancel')}
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saving} className="flex-1 justify-center">
                {saving ? t('button.saving') : (editId ? t('button.update') : t('button.create'))}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
};
