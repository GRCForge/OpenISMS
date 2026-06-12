import React, { useEffect, useState, useMemo } from 'react';
import { Shield, ChevronDown, ChevronRight, RefreshCw, CheckCircle, Clock, XCircle, MinusCircle, Pencil, X, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { hasWriteAccess } from '../lib/permissions';
import api from '../lib/api';
import { ControlMappings } from '../components/ControlMappings';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';

interface C5Item {
  id: number;
  criterion_id: string;
  domain: string;
  domain_name: string;
  title: string;
  implementation_status: 'not_started' | 'in_progress' | 'implemented' | 'not_applicable';
  responsible_id: number | null;
  evidence: string | null;
  notes: string | null;
  last_review_date: string | null;
  pqc_relevant: boolean;
  cc_relevant: boolean;
  has_sharpen: boolean;
  responsible?: { id: number; name: string; email: string } | null;
}

interface User { id: number; name: string; email: string; }

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Nicht begonnen',
  in_progress: 'In Bearbeitung',
  implemented: 'Umgesetzt',
  not_applicable: 'Nicht anwendbar',
};

const STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  in_progress: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  implemented: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  not_applicable: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-500',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  not_started: <XCircle size={14} />,
  in_progress: <Clock size={14} />,
  implemented: <CheckCircle size={14} />,
  not_applicable: <MinusCircle size={14} />,
};

const DOMAIN_COLORS: Record<string, string> = {
  AM: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  BCM: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  COM: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400',
  COS: 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400',
  CRY: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
  DEV: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  GC: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400',
  HR: 'bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-400',
  IAM: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  INQ: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400',
  OIS: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400',
  OPS: 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400',
  PI: 'bg-stone-50 dark:bg-stone-900/20 text-stone-700 dark:text-stone-400',
  PS: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400',
  PSS: 'bg-fuchsia-50 dark:bg-fuchsia-900/20 text-fuchsia-700 dark:text-fuchsia-400',
  SIM: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400',
  SP: 'bg-lime-50 dark:bg-lime-900/20 text-lime-700 dark:text-lime-400',
  SSO: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
};

export const C5: React.FC = () => {
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const [items, setItems] = useState<C5Item[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState('');
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [editItem, setEditItem] = useState<C5Item | null>(null);
  const [editForm, setEditForm] = useState<Partial<C5Item>>({});
  const [saving, setSaving] = useState(false);
  const [filterDomain, setFilterDomain] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [itemsRes, usersRes] = await Promise.all([api.get('/c5'), api.get('/users')]);
      setItems(itemsRes.data);
      setUsers(usersRes.data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const seed = async () => {
    setSeeding(true); setSeedError('');
    try {
      await api.post('/c5/seed');
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setSeedError(err.response?.data?.error || 'Fehler beim Laden des Katalogs');
    } finally {
      setSeeding(false); }
  };

  const grouped = useMemo(() => {
    let filtered = items;
    if (filterDomain) filtered = filtered.filter(i => i.domain === filterDomain);
    if (filterStatus) filtered = filtered.filter(i => i.implementation_status === filterStatus);
    const map = new Map<string, { domain_name: string; items: C5Item[] }>();
    for (const item of filtered) {
      if (!map.has(item.domain)) map.set(item.domain, { domain_name: item.domain_name, items: [] });
      map.get(item.domain)!.items.push(item);
    }
    return map;
  }, [items, filterDomain, filterStatus]);

  const domains = useMemo(() => [...new Set(items.map(i => i.domain))].sort(), [items]);

  const stats = useMemo(() => {
    const total = items.length;
    const implemented = items.filter(i => i.implementation_status === 'implemented').length;
    const inProgress = items.filter(i => i.implementation_status === 'in_progress').length;
    const na = items.filter(i => i.implementation_status === 'not_applicable').length;
    const applicable = total - na;
    const pct = applicable > 0 ? Math.round((implemented / applicable) * 100) : 0;
    const pqcItems = items.filter(i => i.pqc_relevant);
    const pqcDone = pqcItems.filter(i => i.implementation_status === 'implemented').length;
    const ccItems = items.filter(i => i.cc_relevant);
    const ccDone = ccItems.filter(i => i.implementation_status === 'implemented').length;
    const sharpenItems = items.filter(i => i.has_sharpen);
    return { total, implemented, inProgress, na, applicable, pct, pqcItems, pqcDone, ccItems, ccDone, sharpenItems };
  }, [items]);

  const toggleDomain = (domain: string) => {
    setExpandedDomains(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain); else next.add(domain);
      return next;
    });
  };

  const openEdit = (item: C5Item) => {
    setEditItem(item);
    setEditForm({
      implementation_status: item.implementation_status,
      responsible_id: item.responsible_id,
      evidence: item.evidence || '',
      notes: item.notes || '',
      last_review_date: item.last_review_date || '',
    });
  };

  const saveEdit = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await api.put(`/c5/${editItem.id}`, editForm);
      setItems(prev => prev.map(i => i.id === editItem.id ? { ...i, ...editForm } : i));
      setEditItem(null);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <RefreshCw className="animate-spin text-blue-500" size={28} />
    </div>
  );

  if (items.length === 0) return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">BSI C5:2026</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm">Cloud Computing Compliance Criteria Catalogue — 174 Kriterien in 18 Domains</p>
      </div>
      <Card>
        <CardBody className="text-center py-16 space-y-4">
          <Shield size={48} className="mx-auto text-cyan-400" />
          <p className="text-gray-500 dark:text-slate-400">Der C5:2026-Katalog wurde noch nicht geladen.</p>
          {seedError && <p className="text-red-500 text-sm">{seedError}</p>}
          {canWrite && <Button onClick={seed} disabled={seeding}>{seeding ? 'Lädt…' : 'Katalog laden (174 Kriterien)'}</Button>}
        </CardBody>
      </Card>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">BSI C5:2026</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">Cloud Computing Compliance Criteria Catalogue — {stats.total} Kriterien · 18 Domains</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardBody className="p-4 text-center">
            <p className="text-2xl font-extrabold dark:text-white">{stats.total}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 font-semibold uppercase tracking-wide">Kriterien gesamt</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 text-center">
            <p className="text-2xl font-extrabold text-green-600 dark:text-green-400">{stats.implemented}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 font-semibold uppercase tracking-wide">Umgesetzt</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 text-center">
            <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{stats.inProgress}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 font-semibold uppercase tracking-wide">In Bearbeitung</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 text-center">
            <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">{stats.pct}%</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 font-semibold uppercase tracking-wide">Compliance-Quote</p>
          </CardBody>
        </Card>
      </div>

      {/* PQC & CC KPI strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50 dark:bg-purple-900/10">
          <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
            <Shield size={16} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide">Post-Quantum Crypto (PQC)</p>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              <span className="font-bold text-purple-600 dark:text-purple-400">{stats.pqcDone}/{stats.pqcItems.length}</span> umgesetzt
              <span className="ml-1 text-xs text-gray-400">({stats.pqcItems.map(i => i.criterion_id).join(', ')})</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-cyan-200 dark:border-cyan-900/40 bg-cyan-50 dark:bg-cyan-900/10">
          <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/30 shrink-0">
            <Shield size={16} className="text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">Confidential Computing (CC)</p>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              <span className="font-bold text-cyan-600 dark:text-cyan-400">{stats.ccDone}/{stats.ccItems.length}</span> umgesetzt
              <span className="ml-1 text-xs text-gray-400">({stats.ccItems.map(i => i.criterion_id).join(', ')})</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 shrink-0">
            <Shield size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Verschärfte Anforderungen</p>
            <p className="text-sm text-gray-600 dark:text-slate-400">
              <span className="font-bold text-amber-600 dark:text-amber-400">{stats.sharpenItems.length}</span> Kriterien mit Sharpen-Variante
            </p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2.5">
        <div
          className="bg-gradient-to-r from-cyan-500 to-blue-600 h-2.5 rounded-full transition-all duration-500"
          style={{ width: `${stats.pct}%` }}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="w-56">
          <Select
            value={filterDomain}
            onChange={e => setFilterDomain(e.target.value)}
            options={[{ value: '', label: 'Alle Domains' }, ...domains.map(d => ({ value: d, label: `${d} — ${items.find(i => i.domain === d)?.domain_name || ''}` }))]}
          />
        </div>
        <div className="w-48">
          <Select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            options={[
              { value: '', label: 'Alle Status' },
              { value: 'not_started', label: 'Nicht begonnen' },
              { value: 'in_progress', label: 'In Bearbeitung' },
              { value: 'implemented', label: 'Umgesetzt' },
              { value: 'not_applicable', label: 'Nicht anwendbar' },
            ]}
          />
        </div>
        {(filterDomain || filterStatus) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterDomain(''); setFilterStatus(''); }}>
            <X size={14} /> Filter zurücksetzen
          </Button>
        )}
      </div>

      {/* Domain groups */}
      <div className="space-y-3">
        {[...grouped.entries()].map(([domain, { domain_name, items: domainItems }]) => {
          const expanded = expandedDomains.has(domain);
          const implCount = domainItems.filter(i => i.implementation_status === 'implemented').length;
          const naCount = domainItems.filter(i => i.implementation_status === 'not_applicable').length;
          const applicable = domainItems.length - naCount;
          const domainPct = applicable > 0 ? Math.round((implCount / applicable) * 100) : 100;
          const colorClass = DOMAIN_COLORS[domain] || 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400';

          return (
            <Card key={domain} className="overflow-hidden">
              <button
                onClick={() => toggleDomain(domain)}
                className="w-full flex items-center gap-3 p-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors text-left"
              >
                <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${colorClass}`}>{domain}</span>
                <span className="flex-1 font-semibold dark:text-white text-sm">{domain_name}</span>
                <span className="text-xs text-gray-500 dark:text-slate-400">{domainItems.length} Kriterien</span>
                <div className="flex items-center gap-2 min-w-[80px]">
                  <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
                    <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${domainPct}%` }} />
                  </div>
                  <span className="text-xs font-bold text-gray-600 dark:text-slate-400">{domainPct}%</span>
                </div>
                {expanded ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
              </button>

              {expanded && (
                <div className="border-t dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
                  {domainItems.map(item => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/30 dark:hover:bg-slate-800/20">
                      <span className="text-xs font-mono text-gray-500 dark:text-slate-500 w-16 shrink-0">{item.criterion_id}</span>
                      <span className="flex-1 text-sm dark:text-slate-200 min-w-0">{item.title}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.pqc_relevant && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300" title="Post-Quantum Cryptography relevant">PQC</span>
                        )}
                        {item.cc_relevant && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300" title="Confidential Computing relevant">CC</span>
                        )}
                        {item.has_sharpen && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" title="Verschärfte Anforderung verfügbar">⬆</span>
                        )}
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${STATUS_COLORS[item.implementation_status]}`}>
                        {STATUS_ICON[item.implementation_status]}
                        {STATUS_LABELS[item.implementation_status]}
                      </span>
                      {item.responsible && (
                        <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0 hidden md:block">{item.responsible.name}</span>
                      )}
                      {canWrite && (
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors shrink-0"
                          title="Bearbeiten"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Edit Modal */}
      {editItem && (
        <Modal open={!!editItem} onClose={() => setEditItem(null)} title={`${editItem.criterion_id} — ${editItem.title}`}>
          <div className="space-y-4">
            <Select
              label="Umsetzungsstatus"
              value={editForm.implementation_status || 'not_started'}
              onChange={e => setEditForm(f => ({ ...f, implementation_status: e.target.value as C5Item['implementation_status'] }))}
              options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))}
            />
            <Select
              label="Verantwortliche Person"
              value={String(editForm.responsible_id || '')}
              onChange={e => setEditForm(f => ({ ...f, responsible_id: e.target.value ? Number(e.target.value) : null }))}
              options={[{ value: '', label: '— Keine —' }, ...users.map(u => ({ value: String(u.id), label: u.name }))]}
            />
            <Input
              label="Nachweise / Evidence"
              value={editForm.evidence || ''}
              onChange={e => setEditForm(f => ({ ...f, evidence: e.target.value }))}
              placeholder="Dokumentenreferenzen, Links, Beschreibungen…"
            />
            <Input
              label="Letzte Prüfung"
              type="date"
              value={editForm.last_review_date || ''}
              onChange={e => setEditForm(f => ({ ...f, last_review_date: e.target.value }))}
            />
            <div>
              <label className="block text-sm font-medium dark:text-slate-200 mb-1">Notizen</label>
              <textarea
                value={editForm.notes || ''}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Interne Notizen, Hinweise…"
              />
            </div>

            {editItem && (
              <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
                <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Querverweise</p>
                <ControlMappings framework="c5" ref={editItem.criterion_id} />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={() => setEditItem(null)}><X size={14} /> Abbrechen</Button>
              <Button onClick={saveEdit} disabled={saving || !canWrite}><Save size={14} /> {saving ? 'Speichert…' : 'Speichern'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
