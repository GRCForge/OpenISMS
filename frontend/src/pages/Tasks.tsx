import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Plus, Pencil, Trash2, Clock, AlertTriangle, CheckCircle2, Circle, Link2, Users, Square, Sparkles } from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import api from '../lib/api';
import type { Task, TaskStatus, TaskPriority, User, Group } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

const statusMeta: Record<TaskStatus, { color: string; icon: React.FC<any> }> = {
  open: { color: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300', icon: Circle },
  in_progress: { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Clock },
  done: { color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  cancelled: { color: 'bg-gray-100 text-gray-400 dark:bg-slate-900 dark:text-slate-600', icon: Circle },
};

const priorityMeta: Record<TaskPriority, { color: string }> = {
  low: { color: 'text-gray-400 dark:text-slate-600' },
  medium: { color: 'text-blue-500 dark:text-blue-400' },
  high: { color: 'text-orange-500 dark:text-orange-400' },
  critical: { color: 'text-red-600 dark:text-red-400' },
};

const emptyForm = {
  title: '',
  description: '',
  status: 'open' as TaskStatus,
  priority: 'medium' as TaskPriority,
  due_date: '',
  assigned_to_id: '',
  assigned_to_group_id: '',
};

export const Tasks: React.FC = () => {
  const { t } = useTranslation(['tasks', 'common']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();

  const statusLabels: Record<TaskStatus, string> = {
    open: t('tasks:status.open'),
    in_progress: t('tasks:status.in_progress'),
    done: t('tasks:status.done'),
    cancelled: t('tasks:status.cancelled'),
  };
  const priorityLabels: Record<TaskPriority, string> = {
    low: t('tasks:priority.low'),
    medium: t('tasks:priority.medium'),
    high: t('tasks:priority.high'),
    critical: t('tasks:priority.critical'),
  };
  const typeLabels: Record<string, string> = {
    asset: t('tasks:types.asset'),
    risk: t('tasks:types.risk'),
    incident: t('tasks:types.incident'),
    training: t('tasks:types.training'),
    subject_request: t('tasks:types.subject_request'),
    ai_system: t('tasks:types.ai_system'),
    _manual: t('tasks:types._manual'),
  };

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [myTasks, setMyTasks] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  const [orphanLoading, setOrphanLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = (all = showAll) => {
    const params: Record<string, string> = {};
    if (all) params.all = 'true';
    Promise.all([
      api.get('/tasks', { params }),
      api.get('/users'),
      api.get('/groups'),
    ]).then(([tasksRes, usersRes, groupsRes]) => {
      setTasks(tasksRes.data);
      setUsers(usersRes.data);
      setGroups(groupsRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(showAll); }, [showAll]);

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(value), 300);
  };

  const openCreate = () => {
    setEditTask(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditTask(task);
    setForm({
      title: task.title,
      description: task.description || '',
      status: task.status,
      priority: task.priority,
      due_date: task.due_date || '',
      assigned_to_id: task.assigned_to_group_id ? '' : String(task.assigned_to_id || ''),
      assigned_to_group_id: String(task.assigned_to_group_id || ''),
    });
    setModalOpen(true);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        title: form.title,
        description: form.description,
        status: form.status,
        priority: form.priority,
        due_date: form.due_date || null,
      };
      if (form.assigned_to_group_id) {
        payload.assigned_to_group_id = Number(form.assigned_to_group_id);
        payload.assigned_to_id = null;
      } else {
        payload.assigned_to_id = form.assigned_to_id ? Number(form.assigned_to_id) : null;
        payload.assigned_to_group_id = null;
      }

      if (editTask) {
        await api.put(`/tasks/${editTask.id}`, payload);
      } else {
        await api.post('/tasks', payload);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('tasks:saveError'));
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('tasks:deleteConfirm'))) return;
    try {
      await api.delete(`/tasks/${id}`);
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('tasks:deleteFailed'));
    }
  };

  const quickStatus = async (task: Task, newStatus: TaskStatus) => {
    try {
      await api.put(`/tasks/${task.id}`, { status: newStatus });
      load();
    } catch { }
  };

  // ── Multiselect ──────────────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size > 0 && selectedIds.size >= filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)));
    }
  };

  const bulkMarkDone = async () => {
    const ids = [...selectedIds];
    setBulkLoading(true);
    try {
      await Promise.all(ids.map(id => api.put(`/tasks/${id}`, { status: 'done' })));
      setSelectedIds(new Set());
      load();
      toast.success(t('tasks:markDoneSuccess', { count: ids.length }));
    } catch {
      toast.error(t('tasks:updateError'));
    } finally { setBulkLoading(false); }
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(t('tasks:deleteSelected', { count: ids.length }))) return;
    setBulkLoading(true);
    try {
      await Promise.all(ids.map(id => api.delete(`/tasks/${id}`)));
      setSelectedIds(new Set());
      load();
      toast.success(t('tasks:deleteSuccess', { count: ids.length }));
    } catch {
      toast.error(t('tasks:saveError'));
    } finally { setBulkLoading(false); }
  };

  // ── Orphan cleanup (admin only) ──────────────────────────────────
  const checkOrphans = async () => {
    setOrphanLoading(true);
    try {
      const { data } = await api.get('/tasks/orphaned-count');
      setOrphanCount(data.count);
      if (data.count === 0) {
        toast.success(t('tasks:orphan.noneFound'));
      }
    } catch { toast.error(t('tasks:orphan.checkError')); }
    finally { setOrphanLoading(false); }
  };

  const purgeOrphans = async () => {
    if (!confirm(t('tasks:orphan.confirmPurge', { count: orphanCount ?? 0 }))) return;
    setOrphanLoading(true);
    try {
      const { data } = await api.delete('/tasks/orphaned');
      toast.success(t('tasks:orphan.purgedSuccess', { count: data.purged }));
      setOrphanCount(null);
      load();
    } catch { toast.error(t('tasks:orphan.purgeError')); }
    finally { setOrphanLoading(false); }
  };

  // ── Filtering ────────────────────────────────────────────
  const filtered = tasks.filter(t => {
    if (!statusFilter && (t.status === 'cancelled' || t.status === 'done')) return false;
    if (myTasks && t.assigned_to_id !== user?.id && !t.assignedGroup?.members.some(m => m.id === user?.id)) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (priorityFilter && t.priority !== priorityFilter) return false;
    if (typeFilter === '_manual') {
      if (t.related_type) return false;
    } else if (typeFilter && t.related_type !== typeFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Derive type options from loaded tasks (only show types that actually exist)
  const typeOptions = (() => {
    const seen = new Set<string>();
    const hasManual = tasks.some(t => !t.related_type);
    tasks.forEach(t => { if (t.related_type) seen.add(t.related_type); });
    const opts = [{ value: '', label: t('tasks:filters.allTypes') }];
    if (hasManual) opts.push({ value: '_manual', label: typeLabels._manual });
    seen.forEach(type => opts.push({ value: type, label: typeLabels[type] ?? type }));
    return opts;
  })();

  const stats = {
    open: tasks.filter(t => t.status === 'open').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    done: tasks.filter(t => t.status === 'done').length,
    overdue: tasks.filter(t => t.due_date && isPast(parseISO(t.due_date)) && !['done', 'cancelled'].includes(t.status)).length,
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every(t => selectedIds.has(t.id));
  const someSelected = selectedIds.size > 0;

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <CheckSquare size={24} className="text-blue-600" />
            {t('tasks:title')}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('tasks:subtitle', { count: tasks.length })}</p>
        </div>
        <div className="flex gap-2">
          {user?.role === 'admin' && (
            orphanCount !== null && orphanCount > 0 ? (
              <Button variant="danger" size="sm" onClick={purgeOrphans} disabled={orphanLoading}>
                <Trash2 size={14} />
                {t('tasks:orphan.purge', { count: orphanCount })}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={checkOrphans} disabled={orphanLoading}>
                <Sparkles size={14} />
                {orphanLoading ? t('tasks:orphan.checking') : t('tasks:orphan.check')}
              </Button>
            )
          )}
          {canWrite && <Button onClick={openCreate}><Plus size={16} />{t('tasks:new')}</Button>}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: t('tasks:stats.open'), value: stats.open, color: 'text-gray-600 dark:text-slate-300' },
          { label: t('tasks:stats.inProgress'), value: stats.in_progress, color: 'text-blue-600 dark:text-blue-400' },
          { label: t('tasks:stats.done'), value: stats.done, color: 'text-green-600 dark:text-green-400' },
          { label: t('tasks:stats.overdue'), value: stats.overdue, color: 'text-red-600 dark:text-red-400' },
        ].map(s => (
          <Card key={s.label} className="p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5">{s.label}</p>
          </Card>
        ))}
      </div>

      <FilterBar
        search={inputValue}
        onSearch={handleSearchChange}
        searchPlaceholder={t('tasks:searchPlaceholder')}
        activeCount={[statusFilter, priorityFilter, typeFilter, myTasks, showAll].filter(Boolean).length}
        onReset={() => {
          setInputValue(''); setSearch('');
          setStatusFilter(''); setPriorityFilter(''); setTypeFilter('');
          setMyTasks(false); setShowAll(false);
          setSelectedIds(new Set());
        }}
      >
        <Select className="w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
          { value: '', label: t('tasks:filters.allStatus') },
          { value: 'open', label: t('tasks:status.open') },
          { value: 'in_progress', label: t('tasks:status.in_progress') },
          { value: 'done', label: t('tasks:status.done') },
          { value: 'cancelled', label: t('tasks:status.cancelled') },
        ]} />
        <Select className="w-44" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} options={[
          { value: '', label: t('tasks:filters.allPriorities') },
          { value: 'critical', label: t('tasks:priority.critical') },
          { value: 'high', label: t('tasks:priority.high') },
          { value: 'medium', label: t('tasks:priority.medium') },
          { value: 'low', label: t('tasks:priority.low') },
        ]} />
        {typeOptions.length > 1 && (
          <Select className="w-48" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} options={typeOptions} />
        )}
        <button
          onClick={() => setMyTasks(!myTasks)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${myTasks ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
        >
          {t('tasks:filters.myTasks')}
        </button>
        <button
          onClick={() => setShowAll(!showAll)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${showAll ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
          title={t('tasks:filters.showAllHint')}
        >
          {showAll ? t('tasks:filters.allFuture') : t('tasks:filters.next4Weeks')}
        </button>
      </FilterBar>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300 flex-1">
            {t('tasks:bulk.selected', { count: selectedIds.size })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={bulkMarkDone}
            disabled={bulkLoading}
          >
            <CheckCircle2 size={14} />
            {t('tasks:bulk.markDone')}
          </Button>
          {(user?.role === 'admin') && (
            <Button
              size="sm"
              variant="danger"
              onClick={bulkDelete}
              disabled={bulkLoading}
            >
              <Trash2 size={14} />
              {t('tasks:bulk.delete')}
            </Button>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-blue-500 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            {t('tasks:bulk.deselect')}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl">
          <CheckSquare size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3" />
          <p className="text-gray-500 dark:text-slate-400 font-medium">{t('tasks:empty.title')}</p>
          <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">{t('tasks:empty.subtitle')}</p>
          {canWrite && <Button onClick={openCreate} className="mt-4"><Plus size={16} />{t('tasks:empty.createFirst')}</Button>}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select-all header */}
          <div className="flex items-center gap-3 px-1 pb-1">
            <button
              onClick={toggleSelectAll}
              className="shrink-0 text-gray-400 hover:text-blue-600 transition-colors"
              title={allFilteredSelected ? t('tasks:deselectAll') : t('tasks:selectAll', { count: filtered.length })}
            >
              {allFilteredSelected
                ? <CheckSquare size={16} className="text-blue-600" />
                : <Square size={16} />}
            </button>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {allFilteredSelected ? t('tasks:deselectAll') : t('tasks:selectAll', { count: filtered.length })}
            </span>
          </div>

          {filtered.map(t2 => {
            const s = statusMeta[t2.status];
            const p = priorityMeta[t2.priority];
            const isOverdue = t2.due_date && isPast(parseISO(t2.due_date)) && !['done', 'cancelled'].includes(t2.status);
            const StatusIcon = s.icon;
            const isSelected = selectedIds.has(t2.id);
            const typeLabel = t2.related_type ? (typeLabels[t2.related_type] ?? t2.related_type) : null;
            return (
              <Card
                key={t2.id}
                className={`p-4 transition-all hover:shadow-md ${t2.status === 'done' ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {/* Multiselect checkbox */}
                  <button
                    onClick={() => toggleSelect(t2.id)}
                    className="shrink-0 text-gray-300 hover:text-blue-500 transition-colors"
                    title={t('tasks:selectTask')}
                  >
                    {isSelected
                      ? <CheckSquare size={18} className="text-blue-600" />
                      : <Square size={18} />}
                  </button>

                  {/* Quick-done toggle */}
                  <button
                    onClick={() => quickStatus(t2, t2.status === 'done' ? 'open' : 'done')}
                    className="shrink-0 text-gray-300 hover:text-green-500 transition-colors"
                    title={t('tasks:bulk.markDone')}
                  >
                    <StatusIcon size={20} className={t2.status === 'done' ? 'text-green-500' : ''} />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium text-gray-900 dark:text-white ${t2.status === 'done' ? 'line-through' : ''}`}>{t2.title}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${s.color}`}>{statusLabels[t2.status]}</span>
                      <span className={`text-xs font-semibold ${p.color}`}>{priorityLabels[t2.priority]}</span>
                      {typeLabel && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          {typeLabel}
                        </span>
                      )}
                    </div>
                    {t2.description && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-1">{t2.description}</p>}
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-400 dark:text-slate-500">
                      {t2.assignee && <span>→ {t2.assignee.name}</span>}
                      {t2.assignedGroup && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-[10px] font-semibold"
                          style={{ backgroundColor: t2.assignedGroup.color }}
                        >
                          <Users size={10} />
                          {t2.assignedGroup.name}
                        </span>
                      )}
                      {t2.status === 'done' && t2.completedBy && (
                        <span className="text-green-600 dark:text-green-400">✓ {t2.completedBy.name}</span>
                      )}
                      {t2.due_date && (
                        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-semibold' : ''}`}>
                          {isOverdue && <AlertTriangle size={11} />}
                          {t('tasks:overdue')} {format(parseISO(t2.due_date), 'd. MMM yyyy', { locale: dateFnsLocale })}
                        </span>
                      )}
                      {t2.related_type === 'asset' && t2.related_id && (
                        <Link to={`/assets/${t2.related_id}`} className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                          <Link2 size={11} /> {t('tasks:toAsset')}
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canWrite && <button onClick={() => openEdit(t2)} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"><Pencil size={14} /></button>}
                    {canWrite && (user?.role === 'admin' || t2.created_by_id === user?.id) && (
                      <button onClick={() => handleDelete(t2.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTask ? t('tasks:form.editTitle') : t('tasks:form.newTitle')} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('tasks:form.titleLabel')}
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            required
            autoFocus
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('tasks:form.description')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('tasks:form.descriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label={t('tasks:form.status')}
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as TaskStatus }))}
              options={(Object.keys(statusMeta) as TaskStatus[]).map(v => ({ value: v, label: statusLabels[v] }))}
            />
            <Select
              label={t('tasks:form.priority')}
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
              options={[
                { value: 'low', label: t('tasks:priority.low') },
                { value: 'medium', label: t('tasks:priority.medium') },
                { value: 'high', label: t('tasks:priority.high') },
                { value: 'critical', label: t('tasks:priority.critical') },
              ]}
            />
          </div>
          <Input
            label={t('tasks:form.dueDate')}
            type="date"
            value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
          />

          {/* Assignment: group OR individual user (mutually exclusive) */}
          <div className="space-y-3 p-3 rounded-lg border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">{t('tasks:form.assignmentSection')}</p>
            <Select
              label={t('tasks:form.assignGroup')}
              value={form.assigned_to_group_id}
              onChange={e => setForm(f => ({ ...f, assigned_to_group_id: e.target.value, assigned_to_id: e.target.value ? '' : f.assigned_to_id }))}
              options={[
                { value: '', label: t('tasks:form.noGroup') },
                ...groups.map(g => ({ value: String(g.id), label: `${g.name} (${g.members.length} ${t('tasks:form.members')})` })),
              ]}
            />
            {!form.assigned_to_group_id && (
              <Select
                label={t('tasks:form.assignPerson')}
                value={form.assigned_to_id}
                onChange={e => setForm(f => ({ ...f, assigned_to_id: e.target.value }))}
                options={[{ value: '', label: t('tasks:form.unassigned') }, ...users.map(u => ({ value: String(u.id), label: u.name }))]}
              />
            )}
            {form.assigned_to_group_id && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {t('tasks:form.groupNotice')}
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2 border-t dark:border-slate-700">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">{t('common:actions.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? t('tasks:form.saving') : t('tasks:form.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
