import React, { useEffect, useState, useMemo } from 'react';
import { Scale, Plus, Trash2, Pencil, ExternalLink, CalendarCheck } from 'lucide-react';
import { format } from 'date-fns';
import api from '../lib/api';
import type { LegalRequirement, LegalRequirementCategory, LegalRequirementStatus, User } from '../types';
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

const categoryLabels: Record<LegalRequirementCategory, string> = {
  data_protection: 'Datenschutz',
  information_security: 'Informationssicherheit',
  sector_specific: 'Branchenspezifisch',
  labor_law: 'Arbeitsrecht',
  commercial_law: 'Handels-/Steuerrecht',
  other: 'Sonstiges',
};

const statusLabels: Record<LegalRequirementStatus, string> = {
  identified: 'Identifiziert',
  assessed: 'Bewertet',
  implemented: 'Umgesetzt',
  obsolete: 'Veraltet',
};

const statusColors: Record<LegalRequirementStatus, string> = {
  identified: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  assessed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  obsolete: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',
};

const emptyForm: {
  title: string; category: LegalRequirementCategory; description: string;
  reference_url: string; applicable_since: string; review_date: string;
  owner_id: string; status: LegalRequirementStatus; notes: string;
} = {
  title: '', category: 'other', description: '', reference_url: '',
  applicable_since: '', review_date: '', owner_id: '', status: 'identified', notes: '',
};

export const LegalRequirements: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);

  const [items, setItems] = useState<LegalRequirement[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/legal-requirements').then(r => setItems(r.data)).catch(() => setItems([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const filtered = useMemo(() => items.filter(i => {
    if (catFilter && i.category !== catFilter) return false;
    if (statusFilter && i.status !== statusFilter) return false;
    if (search && !i.title.toLowerCase().includes(search.toLowerCase()) && !i.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, catFilter, statusFilter, search]);

  const stats = useMemo(() => ({
    total: items.length,
    implemented: items.filter(i => i.status === 'implemented').length,
    assessed: items.filter(i => i.status === 'assessed').length,
    identified: items.filter(i => i.status === 'identified').length,
  }), [items]);

  const openNew = () => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); };
  const openEdit = (i: LegalRequirement) => {
    setEditId(i.id);
    setForm({
      title: i.title, category: i.category, description: i.description || '',
      reference_url: i.reference_url || '', applicable_since: i.applicable_since || '',
      review_date: i.review_date || '', owner_id: i.owner_id ? String(i.owner_id) : '',
      status: i.status, notes: i.notes || '',
    });
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, owner_id: form.owner_id || null };
      if (editId) await api.put(`/legal-requirements/${editId}`, payload);
      else await api.post('/legal-requirements', payload);
      setModalOpen(false);
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler beim Speichern'); }
    finally { setSaving(false); }
  };

  const remove = async (i: LegalRequirement) => {
    if (!confirm(`„${i.title}" wirklich löschen?`)) return;
    try { await api.delete(`/legal-requirements/${i.id}`); load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const today = new Date();
  const isOverdueReview = (item: LegalRequirement) => item.review_date && new Date(item.review_date) < today && item.status !== 'obsolete';

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><Scale size={24} className="text-blue-600" />Gesetzliches Pflichten-Register</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">Rechtliche Anforderungen an Datenschutz, Informationssicherheit und Compliance · {items.length} Einträge</p>
        </div>
        {canWrite && <Button onClick={openNew}><Plus size={16} />Pflicht erfassen</Button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Gesamt', value: stats.total, color: 'bg-blue-500' },
          { label: 'Identifiziert', value: stats.identified, color: 'bg-gray-500' },
          { label: 'Bewertet', value: stats.assessed, color: 'bg-blue-600' },
          { label: 'Umgesetzt', value: stats.implemented, color: 'bg-green-600' },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><Scale className="text-white" size={18} /></div>
            <div><p className="text-2xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Titel oder Beschreibung suchen..."
        activeCount={[catFilter, statusFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setCatFilter(''); setStatusFilter(''); }}>
        <Select className="w-48" value={catFilter} onChange={e => setCatFilter(e.target.value)}
          options={[{ value: '', label: 'Alle Kategorien' }, ...Object.entries(categoryLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          options={[{ value: '', label: 'Alle Status' }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
      </FilterBar>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead><tr><Th>Titel</Th><Th>Kategorie</Th><Th>Status</Th><Th>Gilt ab</Th><Th>Review</Th><Th>Verantwortlich</Th><Th>{''}</Th></tr></Thead>
            <Tbody>
              {filtered.map(i => (
                <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => openEdit(i)}>
                  <Td>
                    <p className="font-medium dark:text-slate-200">{i.title}</p>
                    {i.description && <p className="text-[11px] text-gray-400 line-clamp-1">{i.description}</p>}
                  </Td>
                  <Td><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400">{categoryLabels[i.category]}</span></Td>
                  <Td><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[i.status]}`}>{statusLabels[i.status]}</span></Td>
                  <Td className="text-gray-500">{i.applicable_since ? format(new Date(i.applicable_since), 'dd.MM.yyyy') : '–'}</Td>
                  <Td>
                    {i.review_date ? (
                      <span className={`text-xs flex items-center gap-1 ${isOverdueReview(i) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                        <CalendarCheck size={11} />
                        {format(new Date(i.review_date), 'dd.MM.yyyy')}
                        {isOverdueReview(i) && ' ⚠'}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </Td>
                  <Td className="text-gray-500">{i.owner?.name || '–'}</Td>
                  <Td>
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {i.reference_url && /^https?:\/\//i.test(i.reference_url) && (
                        <a href={i.reference_url} target="_blank" rel="noreferrer" className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors" title="Quelle öffnen">
                          <ExternalLink size={14} />
                        </a>
                      )}
                      {canWrite && (
                        <>
                          <button onClick={() => openEdit(i)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"><Pencil size={14} /></button>
                          {(user?.role === 'admin' || user?.role === 'assessor') && (
                            <button onClick={() => remove(i)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7}>
                  <div className="py-16 text-center">
                    <Scale size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                    <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Einträge gefunden</p>
                    {canWrite && <button onClick={openNew} className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"><Plus size={15} /> Pflicht erfassen</button>}
                  </div>
                </td></tr>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Rechtliche Pflicht bearbeiten' : 'Rechtliche Pflicht erfassen'} size="lg">
        <form onSubmit={save} className="space-y-4">
          <Input label="Titel / Bezeichnung *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="z. B. DSGVO Art. 30 – Verzeichnis von Verarbeitungstätigkeiten" disabled={!canWrite} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="Kategorie" value={form.category} onChange={e => setForm({ ...form, category: e.target.value as LegalRequirementCategory })} options={Object.entries(categoryLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite} />
            <Select label="Status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as LegalRequirementStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung / Anforderung</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Was ist konkret gefordert? Welche Maßnahmen sind zu treffen?" disabled={!canWrite} />
          </div>
          <Input label="Quellenlink / Gesetzestext URL" value={form.reference_url} onChange={e => setForm({ ...form, reference_url: e.target.value })} placeholder="https://..." disabled={!canWrite} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Gilt ab (Datum)" type="date" value={form.applicable_since} onChange={e => setForm({ ...form, applicable_since: e.target.value })} disabled={!canWrite} />
            <Input label="Nächste Überprüfung" type="date" value={form.review_date} onChange={e => setForm({ ...form, review_date: e.target.value })} disabled={!canWrite} />
          </div>
          <SearchableSelect label="Verantwortliche Person" value={form.owner_id} onChange={val => setForm({ ...form, owner_id: val })} options={[{ value: '', label: '– niemand –' }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} disabled={!canWrite} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notizen / Umsetzungsstand</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            {canWrite && <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? 'Speichern...' : (editId ? 'Aktualisieren' : 'Anlegen')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
