import React, { useEffect, useState, useCallback, useRef } from 'react';
import { UserCheck, Plus, Search, Clock, AlertTriangle, Edit2, Trash2, Shield, Filter, RotateCcw, CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useKeyShortcut } from '../hooks/useKeyShortcut';
import api from '../lib/api';
import { SubjectRequest, SubjectRequestType, SubjectRequestStatus, User } from '../types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';

const STATUS_COLORS: Record<SubjectRequestStatus, string> = {
  received: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  extended: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
};

function daysUntilDue(dueDateStr?: string, extendedUntil?: string): number | null {
  const target = extendedUntil || dueDateStr;
  if (!target) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(target);
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}

function DeadlineBadge({ request }: { request: SubjectRequest }) {
  const { t } = useTranslation('subjectrequests');
  if (request.status === 'completed' || request.status === 'rejected') return null;
  const days = daysUntilDue(request.due_date, request.extended_until);
  if (days === null) return null;
  if (days < 0) {
    return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"><AlertTriangle size={10} />{Math.abs(days)}d {t('deadline.overdue')}</span>;
  }
  if (days <= 7) {
    return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"><Clock size={10} />{days}d</span>;
  }
  if (days <= 14) {
    return <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"><Clock size={10} />{days}d</span>;
  }
  return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400"><Clock size={10} />{days}d</span>;
}

const emptyForm = {
  type: 'access' as SubjectRequestType,
  status: 'received' as SubjectRequestStatus,
  requester_name: '',
  requester_email: '',
  requester_id_verified: false,
  received_date: new Date().toISOString().split('T')[0],
  due_date: '',
  extended_until: '',
  extension_reason: '',
  description: '',
  decision: '',
  notes: '',
  handler_id: '',
};

export const SubjectRequests: React.FC = () => {
  const { t } = useTranslation('subjectrequests');
  const { user } = useAuth();
  const [requests, setRequests] = useState<SubjectRequest[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const searchRef = useRef<HTMLInputElement>(null);

  const typeLabels: Record<SubjectRequestType, string> = {
    access: t('type.access'),
    rectification: t('type.rectification'),
    erasure: t('type.erasure'),
    restriction: t('type.restriction'),
    portability: t('type.portability'),
    objection: t('type.objection'),
    withdraw_consent: t('type.withdraw_consent'),
  };

  const typeShortLabels: Record<SubjectRequestType, string> = {
    access: t('typeShort.access'),
    rectification: t('typeShort.rectification'),
    erasure: t('typeShort.erasure'),
    restriction: t('typeShort.restriction'),
    portability: t('typeShort.portability'),
    objection: t('typeShort.objection'),
    withdraw_consent: t('typeShort.withdraw_consent'),
  };

  const statusLabels: Record<SubjectRequestStatus, string> = {
    received: t('status.received'),
    in_progress: t('status.in_progress'),
    completed: t('status.completed'),
    rejected: t('status.rejected'),
    extended: t('status.extended'),
  };

  const canWrite = user?.role === 'admin' || user?.role === 'dpo';
  const canDelete = user?.role === 'admin';

  const load = useCallback(async () => {
    try {
      const [reqRes, usrRes] = await Promise.all([
        api.get('/subject-requests'),
        api.get('/users'),
      ]);
      setRequests(reqRes.data);
      setUsers(usrRes.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useKeyShortcut('n', () => {
    if (!canWrite) return;
    setEditId(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  }, { disabled: modalOpen });

  useKeyShortcut('/', () => {
    searchRef.current?.focus();
  }, { disabled: modalOpen });

  const openEdit = (r: SubjectRequest) => {
    setEditId(r.id);
    setForm({
      type: r.type,
      status: r.status,
      requester_name: r.requester_name,
      requester_email: r.requester_email || '',
      requester_id_verified: r.requester_id_verified,
      received_date: r.received_date,
      due_date: r.due_date || '',
      extended_until: r.extended_until || '',
      extension_reason: r.extension_reason || '',
      description: r.description || '',
      decision: r.decision || '',
      notes: r.notes || '',
      handler_id: r.handler_id ? String(r.handler_id) : '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: Record<string, any> = {
        ...form,
        handler_id: form.handler_id ? Number(form.handler_id) : null,
        due_date: form.due_date || null,
        extended_until: form.extended_until || null,
      };
      if (editId) {
        await api.put(`/subject-requests/${editId}`, payload);
      } else {
        await api.post('/subject-requests', payload);
      }
      setModalOpen(false);
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || t('alert.saveError'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('alert.deleteConfirm'))) return;
    try {
      await api.delete(`/subject-requests/${id}`);
      setRequests(r => r.filter(x => x.id !== id));
    } catch (e: any) {
      alert(e.response?.data?.error || t('alert.deleteError'));
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const stats = {
    open: requests.filter(r => r.status === 'received').length,
    inProgress: requests.filter(r => r.status === 'in_progress').length,
    overdue: requests.filter(r => {
      if (r.status === 'completed' || r.status === 'rejected') return false;
      const target = r.extended_until || r.due_date;
      if (!target) return false;
      return new Date(target) < today;
    }).length,
    completedMonth: requests.filter(r => r.status === 'completed' && r.completed_at && new Date(r.completed_at) >= thisMonthStart).length,
  };

  const filtered = requests.filter(r => {
    if (typeFilter && r.type !== typeFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.requester_name.toLowerCase().includes(q) && !(r.ref || '').toLowerCase().includes(q) && !(r.requester_email || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const hasFilter = !!typeFilter || !!statusFilter || !!search;

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UserCheck className="text-blue-600" size={24} />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{t('subtitle')}</p>
        </div>
        {canWrite && (
          <Button onClick={() => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); }} className="gap-2 shrink-0">
            <Plus size={16} />{t('newButton')}
            <kbd className="ml-1 font-mono text-[10px] px-1.5 py-0.5 bg-blue-500/20 rounded hidden sm:inline">N</kbd>
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
          <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('stats.received')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{stats.open}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
          <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('stats.inProgress')}</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{stats.inProgress}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
          <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('stats.overdue')}</p>
          <p className={`text-2xl font-bold mt-1 ${stats.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{stats.overdue}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
          <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('stats.completedMonth')}</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{stats.completedMonth}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder={t('filter.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <Select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">{t('filter.allTypes')}</option>
          {(Object.entries(typeShortLabels) as [SubjectRequestType, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">{t('filter.allStatus')}</option>
          {(Object.entries(statusLabels) as [SubjectRequestStatus, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        {hasFilter && (
          <button onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter(''); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 transition-colors">
            <RotateCcw size={13} />{t('filter.reset')}
          </button>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
          {hasFilter ? (
            <>
              <Filter size={32} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-gray-500 dark:text-slate-400">{t('empty.filterTitle')}</p>
              <button onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter(''); }}
                className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('empty.filterReset')}</button>
            </>
          ) : (
            <>
              <UserCheck size={40} className="mx-auto text-gray-300 dark:text-slate-600 mb-3" />
              <p className="text-lg font-semibold text-gray-700 dark:text-slate-300">{t('empty.title')}</p>
              <p className="text-sm text-gray-400 dark:text-slate-500 mt-1 mb-4">{t('empty.description')}</p>
              {canWrite && (
                <Button onClick={() => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); }} className="gap-2">
                  <Plus size={16} />{t('empty.createButton')}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {/* Mobile card list */}
      {filtered.length > 0 && (
        <div className="sm:hidden space-y-2">
          {filtered.map(r => (
            <div key={r.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-gray-400 dark:text-slate-500">{r.ref}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>{statusLabels[r.status]}</span>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white mt-1 truncate">{r.requester_name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{typeShortLabels[r.type]}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <DeadlineBadge request={r} />
                  {canWrite && (
                    <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                      <Edit2 size={14} />
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              {r.due_date && (
                <div className="mt-2 text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1">
                  <CalendarClock size={11} />{t('table.deadline')}: {new Date(r.extended_until || r.due_date).toLocaleDateString()}
                  {r.extended_until && <span className="text-purple-500">{t('deadline.extended')}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Desktop table */}
      {filtered.length > 0 && (
        <div className="hidden sm:block bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('table.ref')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('table.requester')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('table.type')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('table.status')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('table.deadline')}</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wide">{t('table.handler')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {filtered.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">{r.ref || `#${r.id}`}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-white">{r.requester_name}</p>
                    {r.requester_email && <p className="text-xs text-gray-400 dark:text-slate-500">{r.requester_email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-600 dark:text-slate-300">{typeShortLabels[r.type]}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status]}`}>{statusLabels[r.status]}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {(r.due_date || r.extended_until) && (
                        <span className="text-xs text-gray-500 dark:text-slate-400">
                          {new Date(r.extended_until || r.due_date!).toLocaleDateString()}
                        </span>
                      )}
                      <DeadlineBadge request={r} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                    {r.handler?.name || <span className="text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {canWrite && (
                        <button onClick={() => openEdit(r)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                          <Edit2 size={14} />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('modal.editTitle') : t('modal.newTitle')} size="lg">
        <form onSubmit={handleSave} className="space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label={t('modal.typeLabel')} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as SubjectRequestType }))} required>
              {(Object.entries(typeLabels) as [SubjectRequestType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
            <Select label={t('modal.statusLabel')} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as SubjectRequestStatus }))}>
              {(Object.entries(statusLabels) as [SubjectRequestStatus, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('modal.requesterName')} value={form.requester_name} onChange={e => setForm(f => ({ ...f, requester_name: e.target.value }))} required />
            <Input label={t('modal.requesterEmail')} type="email" value={form.requester_email} onChange={e => setForm(f => ({ ...f, requester_email: e.target.value }))} />
          </div>

          <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-slate-800/40 rounded-lg border dark:border-slate-700">
            <input type="checkbox" id="id_verified" checked={form.requester_id_verified} onChange={e => setForm(f => ({ ...f, requester_id_verified: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="id_verified" className="text-sm text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
              <Shield size={13} className="text-blue-500" />{t('modal.idVerified')}
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input label={t('modal.receivedDate')} type="date" value={form.received_date} onChange={e => setForm(f => ({ ...f, received_date: e.target.value }))} required />
            <Input label={t('modal.dueDate')} type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            <Input label={t('modal.extendedUntil')} type="date" value={form.extended_until} onChange={e => setForm(f => ({ ...f, extended_until: e.target.value }))} />
          </div>

          {form.extended_until && (
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{t('modal.extensionReason')}</label>
              <textarea value={form.extension_reason} onChange={e => setForm(f => ({ ...f, extension_reason: e.target.value }))} rows={2}
                className="w-full text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{t('modal.description')}</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3}
              className="w-full text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label={t('modal.handler')} value={form.handler_id} onChange={e => setForm(f => ({ ...f, handler_id: e.target.value }))}>
              <option value="">{t('modal.unassigned')}</option>
              {users.filter(u => ['admin', 'dpo', 'assessor'].includes(u.role)).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </Select>
            <div>
              <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{t('modal.decision')}</label>
              <textarea value={form.decision} onChange={e => setForm(f => ({ ...f, decision: e.target.value }))} rows={2}
                className="w-full text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-1">{t('modal.notes')}</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>{t('modal.cancel')}</Button>
            <Button type="submit">{editId ? t('modal.save') : t('modal.create')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
