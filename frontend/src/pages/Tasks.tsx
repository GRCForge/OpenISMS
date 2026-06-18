import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, Plus, Pencil, Trash2, Clock, AlertTriangle, CheckCircle2, Circle, Link2, Users, Square, Sparkles } from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
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

const statusConfig: Record<TaskStatus, { label: string; color: string; icon: React.FC<any> }> = {
  open: { label: 'Offen', color: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300', icon: Circle },
  in_progress: { label: 'In Bearbeitung', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: Clock },
  done: { label: 'Erledigt', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle2 },
  cancelled: { label: 'Abgebrochen', color: 'bg-gray-100 text-gray-400 dark:bg-slate-900 dark:text-slate-600', icon: Circle },
};

const priorityConfig: Record<TaskPriority, { label: string; color: string }> = {
  low: { label: 'Niedrig', color: 'text-gray-400 dark:text-slate-600' },
  medium: { label: 'Mittel', color: 'text-blue-500 dark:text-blue-400' },
  high: { label: 'Hoch', color: 'text-orange-500 dark:text-orange-400' },
  critical: { label: 'Kritisch', color: 'text-red-600 dark:text-red-400' },
};

const TYPE_LABELS: Record<string, string> = {
  asset: 'Asset',
  risk: 'Risiko',
  incident: 'Vorfall',
  training: 'Schulung',
  subject_request: 'Betroffenenanfrage',
  ai_system: 'KI-System',
  _manual: 'Manuell',
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
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();

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

  const openEdit = (t: Task) => {
    setEditTask(t);
    setForm({
      title: t.title,
      description: t.description || '',
      status: t.status,
      priority: t.priority,
      due_date: t.due_date || '',
      assigned_to_id: t.assigned_to_group_id ? '' : String(t.assigned_to_id || ''),
      assigned_to_group_id: String(t.assigned_to_group_id || ''),
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
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Aufgabe wirklich löschen?')) return;
    try {
      await api.delete(`/tasks/${id}`);
      setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Löschen fehlgeschlagen');
    }
  };

  const quickStatus = async (task: Task, newStatus: TaskStatus) => {
    try {
      await api.put(`/tasks/${task.id}`, { status: newStatus });
      load();
    } catch { }
  };

  // ── Multiselect ─────────────────────────────────────────────────────────
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
      toast.success(`${ids.length} Aufgabe${ids.length !== 1 ? 'n' : ''} als erledigt markiert`);
    } catch {
      toast.error('Fehler beim Aktualisieren');
    } finally { setBulkLoading(false); }
  };

  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(`${ids.length} Aufgabe${ids.length !== 1 ? 'n' : ''} wirklich löschen?`)) return;
    setBulkLoading(true);
    try {
      await Promise.all(ids.map(id => api.delete(`/tasks/${id}`)));
      setSelectedIds(new Set());
      load();
      toast.success(`${ids.length} Aufgabe${ids.length !== 1 ? 'n' : ''} gelöscht`);
    } catch {
      toast.error('Fehler beim Löschen');
    } finally { setBulkLoading(false); }
  };

  // ── Orphan cleanup (admin only) ──────────────────────────────────────────────
  const checkOrphans = async () => {
    setOrphanLoading(true);
    try {
      const { data } = await api.get('/tasks/orphaned-count');
      setOrphanCount(data.count);
      if (data.count === 0) {
        toast.success('Keine verwaisten Aufgaben gefunden.');
      }
    } catch { toast.error('Fehler beim Prüfen'); }
    finally { setOrphanLoading(false); }
  };

  const purgeOrphans = async () => {
    if (!confirm(`${orphanCount} verwaiste Aufgabe${orphanCount !== 1 ? 'n' : ''} löschen? Diese Aufgaben zeigen auf nicht mehr existierende Objekte.`)) return;
    setOrphanLoading(true);
    try {
      const { data } = await api.delete('/tasks/orphaned');
      toast.success(`${data.purged} verwaiste Aufgabe${data.purged !== 1 ? 'n' : ''} gelöscht.`);
      setOrphanCount(null);
      load();
    } catch { toast.error('Fehler beim Löschen'); }
    finally { setOrphanLoading(false); }
  };

  // ── Filtering ───────────────────────────────────────────────────────────
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
    const opts = [{ value: '', label: 'Alle Typen' }];
    if (hasManual) opts.push({ value: '_manual', label: 'Manuell' });
    seen.forEach(type => opts.push({ value: type, label: TYPE_LABELS[type] ?? type }));
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
            Aufgaben & Maßnahmen
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{tasks.length} Aufgaben insgesamt</p>
        </div>
        <div className="flex gap-2">
          {user?.role === 'admin' && (
            orphanCount !== null && orphanCount > 0 ? (
              <Button variant="danger" size="sm" onClick={purgeOrphans} disabled={orphanLoading}>
                <Trash2 size={14} />
                {orphanCount} verwaiste löschen
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={checkOrphans} disabled={orphanLoading}>
                <Sparkles size={14} />
                {orphanLoading ? 'Prüfe...' : 'Aufräumen'}
              </Button>
            )
          )}
          {canWrite && <Button onClick={openCreate}><Plus size={16} />Neue Aufgabe</Button>}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Offen', value: stats.open, color: 'text-gray-600 dark:text-slate-300' },
          { label: 'In Bearbeitung', value: stats.in_progress, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Erledigt', value: stats.done, color: 'text-green-600 dark:text-green-400' },
          { label: 'Überfällig', value: stats.overdue, color: 'text-red-600 dark:text-red-400' },
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
        searchPlaceholder="Aufgabe suchen..."
        activeCount={[statusFilter, priorityFilter, typeFilter, myTasks, showAll].filter(Boolean).length}
        onReset={() => {
          setInputValue(''); setSearch('');
          setStatusFilter(''); setPriorityFilter(''); setTypeFilter('');
          setMyTasks(false); setShowAll(false);
          setSelectedIds(new Set());
        }}
      >
        <Select className="w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
          { value: '', label: 'Alle Status' },
          { value: 'open', label: 'Offen' },
          { value: 'in_progress', label: 'In Bearbeitung' },
          { value: 'done', label: 'Erledigt' },
          { value: 'cancelled', label: 'Abgebrochen' },
        ]} />
        <Select className="w-44" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} options={[
          { value: '', label: 'Alle Prioritäten' },
          { value: 'critical', label: 'Kritisch' },
          { value: 'high', label: 'Hoch' },
          { value: 'medium', label: 'Mittel' },
          { value: 'low', label: 'Niedrig' },
        ]} />
        {typeOptions.length > 1 && (
          <Select className="w-48" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} options={typeOptions} />
        )}
        <button
          onClick={() => setMyTasks(!myTasks)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${myTasks ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
        >
          Meine Aufgaben
        </button>
        <button
          onClick={() => setShowAll(!showAll)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${showAll ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
          title="Standardmäßig werden nur Aufgaben der nächsten 4 Wochen angezeigt"
        >
          {showAll ? 'Alle (inkl. Zukunft)' : 'Nächste 4 Wochen'}
        </button>
      </FilterBar>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <span className="text-sm font-medium text-blue-700 dark:text-blue-300 flex-1">
            {selectedIds.size} Aufgabe{selectedIds.size !== 1 ? 'n' : ''} ausgewählt
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={bulkMarkDone}
            disabled={bulkLoading}
          >
            <CheckCircle2 size={14} />
            Als erledigt markieren
          </Button>
          {(user?.role === 'admin') && (
            <Button
              size="sm"
              variant="danger"
              onClick={bulkDelete}
              disabled={bulkLoading}
            >
              <Trash2 size={14} />
              Löschen
            </Button>
          )}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-blue-500 dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            Aufheben
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl">
          <CheckSquare size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3" />
          <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Aufgaben gefunden</p>
          <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">Erstelle Aufgaben für Sicherheitsmaßnahmen und Verbesserungen.</p>
          {canWrite && <Button onClick={openCreate} className="mt-4"><Plus size={16} />Erste Aufgabe erstellen</Button>}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select-all header */}
          <div className="flex items-center gap-3 px-1 pb-1">
            <button
              onClick={toggleSelectAll}
              className="shrink-0 text-gray-400 hover:text-blue-600 transition-colors"
              title={allFilteredSelected ? 'Alle abwählen' : 'Alle auswählen'}
            >
              {allFilteredSelected
                ? <CheckSquare size={16} className="text-blue-600" />
                : <Square size={16} />}
            </button>
            <span className="text-xs text-gray-400 dark:text-slate-500">
              {allFilteredSelected ? 'Alle abwählen' : `Alle ${filtered.length} auswählen`}
            </span>
          </div>

          {filtered.map(t => {
            const s = statusConfig[t.status];
            const p = priorityConfig[t.priority];
            const isOverdue = t.due_date && isPast(parseISO(t.due_date)) && !['done', 'cancelled'].includes(t.status);
            const StatusIcon = s.icon;
            const isSelected = selectedIds.has(t.id);
            const typeLabel = t.related_type ? (TYPE_LABELS[t.related_type] ?? t.related_type) : null;
            return (
              <Card
                key={t.id}
                className={`p-4 transition-all hover:shadow-md ${t.status === 'done' ? 'opacity-60' : ''} ${isSelected ? 'ring-2 ring-blue-500 dark:ring-blue-400' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {/* Multiselect checkbox */}
                  <button
                    onClick={() => toggleSelect(t.id)}
                    className="shrink-0 text-gray-300 hover:text-blue-500 transition-colors"
                    title="Auswählen"
                  >
                    {isSelected
                      ? <CheckSquare size={18} className="text-blue-600" />
                      : <Square size={18} />}
                  </button>

                  {/* Quick-done toggle */}
                  <button
                    onClick={() => quickStatus(t, t.status === 'done' ? 'open' : 'done')}
                    className="shrink-0 text-gray-300 hover:text-green-500 transition-colors"
                    title="Als erledigt markieren"
                  >
                    <StatusIcon size={20} className={t.status === 'done' ? 'text-green-500' : ''} />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium text-gray-900 dark:text-white ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                      <span className={`text-xs font-semibold ${p.color}`}>{p.label}</span>
                      {typeLabel && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          {typeLabel}
                        </span>
                      )}
                    </div>
                    {t.description && <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-1">{t.description}</p>}
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-gray-400 dark:text-slate-500">
                      {t.assignee && <span>→ {t.assignee.name}</span>}
                      {t.assignedGroup && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-white text-[10px] font-semibold"
                          style={{ backgroundColor: t.assignedGroup.color }}
                        >
                          <Users size={10} />
                          {t.assignedGroup.name}
                        </span>
                      )}
                      {t.status === 'done' && t.completedBy && (
                        <span className="text-green-600 dark:text-green-400">✓ {t.completedBy.name}</span>
                      )}
                      {t.due_date && (
                        <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-500 font-semibold' : ''}`}>
                          {isOverdue && <AlertTriangle size={11} />}
                          Fällig: {format(parseISO(t.due_date), 'd. MMM yyyy', { locale: de })}
                        </span>
                      )}
                      {t.related_type === 'asset' && t.related_id && (
                        <Link to={`/assets/${t.related_id}`} className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline">
                          <Link2 size={11} /> Zum Asset
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canWrite && <button onClick={() => openEdit(t)} className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"><Pencil size={14} /></button>}
                    {canWrite && (user?.role === 'admin' || t.created_by_id === user?.id) && (
                      <button onClick={() => handleDelete(t.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTask ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Titel *"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            required
            autoFocus
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Beschreibung</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Details zur Aufgabe..."
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Status"
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value as TaskStatus }))}
              options={Object.entries(statusConfig).map(([v, c]) => ({ value: v, label: c.label }))}
            />
            <Select
              label="Priorität"
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
              options={[
                { value: 'low', label: 'Niedrig' },
                { value: 'medium', label: 'Mittel' },
                { value: 'high', label: 'Hoch' },
                { value: 'critical', label: 'Kritisch' },
              ]}
            />
          </div>
          <Input
            label="Fälligkeitsdatum"
            type="date"
            value={form.due_date}
            onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
          />

          {/* Assignment: group OR individual user (mutually exclusive) */}
          <div className="space-y-3 p-3 rounded-lg border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Zuweisung</p>
            <Select
              label="Gruppe zuweisen"
              value={form.assigned_to_group_id}
              onChange={e => setForm(f => ({ ...f, assigned_to_group_id: e.target.value, assigned_to_id: e.target.value ? '' : f.assigned_to_id }))}
              options={[
                { value: '', label: 'Keine Gruppe' },
                ...groups.map(g => ({ value: String(g.id), label: `${g.name} (${g.members.length} Mitglieder)` })),
              ]}
            />
            {!form.assigned_to_group_id && (
              <Select
                label="Einzelperson zuweisen"
                value={form.assigned_to_id}
                onChange={e => setForm(f => ({ ...f, assigned_to_id: e.target.value }))}
                options={[{ value: '', label: 'Nicht zugewiesen' }, ...users.map(u => ({ value: String(u.id), label: u.name }))]}
              />
            )}
            {form.assigned_to_group_id && (
              <p className="text-xs text-blue-600 dark:text-blue-400">
                Alle Gruppenmitglieder erhalten eine Benachrichtigung. Wer zuerst erledigt, schließt die Aufgabe für alle ab.
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2 border-t dark:border-slate-700">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Abbrechen</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? 'Speichern...' : 'Speichern'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
