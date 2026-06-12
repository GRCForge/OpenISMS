import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, CheckCircle2, Clock, MinusCircle, Plus, Trash2, FileText, Link2, Info } from 'lucide-react';
import api from '../lib/api';
import type { Control, ControlStatus, Policy } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useModules } from '../contexts/ModulesContext';
import { hasWriteAccess } from '../lib/permissions';

const fwLabels: Record<string, string> = { iso27001: 'ISO 27001', nis2: 'NIS-2', bsi: 'BSI', custom: 'Eigen' };

// Maps controls.framework value → module key in ModulesContext
const FW_TO_MODULE: Record<string, string> = { iso27001: 'iso27001', nis2: 'nis2', bsi: 'bsi_grundschutz' };
const typeLabels: Record<string, string> = { organizational: 'Organisatorisch', people: 'Personell', physical: 'Physisch', technological: 'Technisch' };
const statusLabels: Record<string, string> = { implemented: 'Umgesetzt', planned: 'Geplant', not_applicable: 'Nicht anwendbar' };
const statusColor: Record<string, string> = {
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  planned: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  not_applicable: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-500',
};

export const Controls: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const { isEnabled } = useModules();
  const canWrite = hasWriteAccess(user?.role);
  const [controls, setControls] = useState<Control[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [fw, setFw] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newCtrl, setNewCtrl] = useState({ code: '', title: '', description: '', type: 'organizational', policy_ids: [] as number[] });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const load = () => {
    setSelectedIds([]);
    api.get('/controls').then(r => setControls(Array.isArray(r.data) ? r.data : [])).catch(() => setControls([])).finally(() => setLoading(false));
    api.get('/policies').then(r => setPolicies(r.data)).catch(() => setPolicies([]));
  };
  
  useEffect(() => { load(); }, []);

  useEffect(() => {
    setSelectedIds([]);
  }, [fw, status, search]);

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!confirm(`Möchten Sie die ${selectedIds.length} ausgewählten eigenen Maßnahmen wirklich löschen?`)) return;
    try {
      await api.post('/controls/bulk-delete', { ids: selectedIds });
      toast.success(`${selectedIds.length} Maßnahmen gelöscht`);
      setSelectedIds([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  const counts = useMemo(() => {
    const c = { implemented: 0, planned: 0, not_applicable: 0 };
    controls.forEach(x => { if (c[x.status] !== undefined) c[x.status]++; });
    return c;
  }, [controls]);
  const coverage = controls.length ? Math.round((counts.implemented / controls.length) * 100) : 0;

  const filtered = controls.filter(c => {
    // Hide framework controls whose module is disabled
    const moduleKey = FW_TO_MODULE[c.framework];
    if (moduleKey && !isEnabled(moduleKey as any)) return false;
    if (fw && c.framework !== fw) return false;
    if (status && c.status !== status) return false;
    if (search && !`${c.code || ''} ${c.title}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const quickStatus = async (c: Control, s: ControlStatus) => {
    setControls(prev => prev.map(x => x.id === c.id ? { ...x, status: s } : x));
    try { await api.put(`/controls/${c.id}`, { status: s }); } catch { load(); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.put(`/controls/${editing.id}`, { 
        status: editing.status, 
        applicability_justification: editing.applicability_justification, 
        policy_ids: editing.policy_ids,
        ...(editing.framework === 'custom' ? { title: editing.title, description: editing.description, type: editing.type } : {}) 
      });
      setEditing(null); load();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const createCustom = async () => {
    try { 
      await api.post('/controls', newCtrl); 
      setCreateOpen(false); 
      setNewCtrl({ code: '', title: '', description: '', type: 'organizational', policy_ids: [] }); 
      load(); 
    }
    catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const removeCustom = async (c: Control) => {
    if (!confirm(`Maßnahme "${c.title}" löschen?`)) return;
    try { await api.delete(`/controls/${c.id}`); load(); } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
  };

  const customControls = filtered.filter(c => c.framework === 'custom');

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Maßnahmen & SoA</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">Statement of Applicability · ISO 27001 / NIS-2 / BSI · {controls.length} Controls</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {user?.role === 'admin' && selectedIds.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1 mr-2">
              <Trash2 size={14} />
              {selectedIds.length} Löschen
            </Button>
          )}
          {user?.role === 'admin' && <Button onClick={() => setCreateOpen(true)}><Plus size={16} />Eigene Maßnahme</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-green-500 shrink-0"><CheckCircle2 className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{counts.implemented}</p><p className="text-xs text-gray-500 dark:text-slate-400">Umgesetzt</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-yellow-500 shrink-0"><Clock className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{counts.planned}</p><p className="text-xs text-gray-500 dark:text-slate-400">Geplant</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-gray-400 shrink-0"><MinusCircle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{counts.not_applicable}</p><p className="text-xs text-gray-500 dark:text-slate-400">Nicht anwendbar</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-blue-500 shrink-0"><ShieldCheck className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{coverage}%</p><p className="text-xs text-gray-500 dark:text-slate-400">Abdeckung</p></div></CardBody></Card>
      </div>

      {/* Active module hints */}
      {(isEnabled('iso27001') || isEnabled('nis2') || isEnabled('bsi_grundschutz')) && (
        <div className="flex flex-wrap gap-2">
          {isEnabled('iso27001') && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
              <Info size={13} />
              <span>ISO 27001-Controls stammen aus dem <a href="/iso27001" className="font-semibold underline">ISO 27001-Modul</a>. Status dort bearbeiten für volle Details.</span>
            </div>
          )}
          {isEnabled('nis2') && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-xs text-orange-700 dark:text-orange-300">
              <Info size={13} />
              <span>NIS-2-Maßnahmen stammen aus dem <a href="/nis2" className="font-semibold underline">NIS-2-Modul</a>. Status dort bearbeiten für volle Details.</span>
            </div>
          )}
          {isEnabled('bsi_grundschutz') && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-xs text-green-700 dark:text-green-300">
              <Info size={13} />
              <span>BSI-Anforderungen stammen aus dem <a href="/bsi-grundschutz" className="font-semibold underline">BSI-Modul</a>. Status dort bearbeiten für volle Details.</span>
            </div>
          )}
        </div>
      )}

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder="Suche (Code/Titel)…"
        activeCount={[fw, status].filter(Boolean).length}
        onReset={() => { setSearch(''); setFw(''); setStatus(''); }}>
        <Select className="w-full md:w-44" value={fw} onChange={e => setFw(e.target.value)} options={[{ value: '', label: 'Alle Frameworks' }, ...Object.entries(fwLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-full md:w-40" value={status} onChange={e => setStatus(e.target.value)} options={[{ value: '', label: 'Alle Status' }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <tr>
                {user?.role === 'admin' && (
                  <Th className="w-10">
                    {customControls.length > 0 && (
                      <input
                        type="checkbox"
                        checked={selectedIds.length > 0 && selectedIds.length === customControls.length}
                        ref={el => {
                          if (el) {
                            el.indeterminate = selectedIds.length > 0 && selectedIds.length < customControls.length;
                          }
                        }}
                        onChange={e => {
                          if (e.target.checked) {
                            setSelectedIds(customControls.map(c => c.id));
                          } else {
                            setSelectedIds([]);
                          }
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    )}
                  </Th>
                )}
                <Th>Code</Th>
                <Th>Maßnahme</Th>
                <Th>Framework</Th>
                <Th>Bezug</Th>
                <Th>Status</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                  {user?.role === 'admin' && (
                    <Td onClick={e => e.stopPropagation()} className="w-10">
                      {c.framework === 'custom' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(c.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedIds(prev => [...prev, c.id]);
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== c.id));
                            }
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      )}
                    </Td>
                  )}
                  <Td className="font-mono text-xs text-gray-500 whitespace-nowrap">{c.code || '–'}</Td>
                  <Td className="cursor-pointer" onClick={() => setEditing({ ...c, policy_ids: (c as any).policies?.map((p: any) => p.id) || [] })}>
                    <p className="text-sm dark:text-slate-200">{c.title}</p>
                    {c.applicability_justification && <p className="text-[11px] text-gray-400 truncate max-w-md">{c.applicability_justification}</p>}
                  </Td>
                  <Td><span className="text-[10px] font-bold uppercase text-gray-400">{fwLabels[c.framework]}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {(c as any).policies?.map((p: any) => (
                        <div key={p.id} className="flex items-center gap-1 text-[10px] bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded" title={p.title}>
                          <FileText size={10} /> {p.code || 'Doc'}
                        </div>
                      ))}
                      {(!(c as any).policies || (c as any).policies.length === 0) && <span className="text-[10px] text-gray-300">–</span>}
                    </div>
                  </Td>
                  <Td>
                    <select value={c.status} onChange={e => quickStatus(c, e.target.value as ControlStatus)}
                      disabled={!canWrite}
                      className={`text-xs font-medium rounded-full px-2 py-1 border-0 ${canWrite ? 'cursor-pointer' : 'cursor-default opacity-75'} ${statusColor[c.status]}`}>
                      {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Td>
                  <Td>{user?.role === 'admin' && c.framework === 'custom' && <button onClick={() => removeCustom(c)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>}</Td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={user?.role === 'admin' ? 7 : 6} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">Keine Controls gefunden</td></tr>}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      {/* Edit / Justification Modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${editing.code || ''} ${editing.title}`.trim() : ''} size="xl">
        {editing && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[75vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Basis-Informationen</h3>
              {editing.framework === 'custom' ? (
                <>
                  <Input label="Titel" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} />
                  <Select label="Typ" value={editing.type} onChange={e => setEditing({ ...editing, type: e.target.value as any })} options={Object.entries(typeLabels).map(([v, l]) => ({ value: v, label: l }))} />
                  <div className="flex flex-col gap-1"><label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung</label>
                    <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={4} value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div>
                </>
              ) : (
                <div className="p-4 bg-gray-50 dark:bg-slate-800/40 rounded-xl border dark:border-slate-800 text-sm text-gray-600 dark:text-slate-300 leading-relaxed">
                  <div className="flex items-center gap-2 mb-2"><span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{fwLabels[editing.framework]}</span><span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-400">{typeLabels[editing.type]}</span></div>
                  {editing.description}
                </div>
              )}
              <Select label="SoA-Status" value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as ControlStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} />
              <div className="flex flex-col gap-1"><label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Begründung der Anwendbarkeit (SoA)</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={4} value={editing.applicability_justification || ''} onChange={e => setEditing({ ...editing, applicability_justification: e.target.value })} placeholder="Warum (nicht) anwendbar bzw. wie umgesetzt?" /></div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider flex items-center gap-2"><Link2 size={13} />Verknüpfte Richtlinien</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">Verbinden Sie diese Maßnahme mit Richtlinien aus Ihrer Bibliothek, die diese TOM näher beschreiben.</p>
              <div className="border dark:border-slate-700 rounded-xl p-3 space-y-1 max-h-[400px] overflow-y-auto bg-gray-50/30 dark:bg-slate-800/20">
                {policies.length === 0 && <p className="text-xs text-gray-400 italic">Keine Richtlinien vorhanden.</p>}
                {policies.map(p => (
                  <label key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer border border-transparent hover:border-gray-100 dark:hover:border-slate-700 transition-all">
                    <input type="checkbox" checked={editing.policy_ids.includes(p.id)} 
                      onChange={e => {
                        const next = e.target.checked ? [...editing.policy_ids, p.id] : editing.policy_ids.filter((id: number) => id !== p.id);
                        setEditing({ ...editing, policy_ids: next });
                      }}
                      className="w-4 h-4 rounded text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium dark:text-slate-200 truncate">{p.title}</p>
                      <p className="text-[10px] text-gray-400 uppercase font-mono">{p.code || 'Kein Code'}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 flex gap-3 pt-4 border-t dark:border-slate-800">
              <Button variant="secondary" onClick={() => setEditing(null)} className="flex-1 justify-center">Abbrechen</Button>
              <Button onClick={saveEdit} disabled={!canWrite} className="flex-1 justify-center">Speichern</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create custom control */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Eigene Maßnahme anlegen" size="xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[75vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider">Basis-Informationen</h3>
            <Input label="Code (optional)" value={newCtrl.code} onChange={e => setNewCtrl({ ...newCtrl, code: e.target.value })} placeholder="z. B. ORG-01" />
            <Input label="Titel *" value={newCtrl.title} onChange={e => setNewCtrl({ ...newCtrl, title: e.target.value })} />
            <Select label="Typ" value={newCtrl.type} onChange={e => setNewCtrl({ ...newCtrl, type: e.target.value })} options={Object.entries(typeLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <div className="flex flex-col gap-1"><label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={4} value={newCtrl.description} onChange={e => setNewCtrl({ ...newCtrl, description: e.target.value })} /></div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase text-gray-400 tracking-wider flex items-center gap-2"><Link2 size={13} />Richtlinien zuweisen</h3>
            <div className="border dark:border-slate-700 rounded-xl p-3 space-y-1 max-h-[400px] overflow-y-auto bg-gray-50/30 dark:bg-slate-800/20">
              {policies.length === 0 && <p className="text-xs text-gray-400 italic">Keine Richtlinien vorhanden.</p>}
              {policies.map(p => (
                <label key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer border border-transparent hover:border-gray-100 dark:hover:border-slate-700 transition-all">
                  <input type="checkbox" checked={newCtrl.policy_ids.includes(p.id)} 
                    onChange={e => {
                      const next = e.target.checked ? [...newCtrl.policy_ids, p.id] : newCtrl.policy_ids.filter((id: number) => id !== p.id);
                      setNewCtrl({ ...newCtrl, policy_ids: next });
                    }}
                    className="w-4 h-4 rounded text-blue-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium dark:text-slate-200 truncate">{p.title}</p>
                    <p className="text-[10px] text-gray-400 uppercase font-mono">{p.code || 'Kein Code'}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="md:col-span-2 flex gap-3 pt-4 border-t dark:border-slate-800">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button onClick={createCustom} disabled={!newCtrl.title || !canWrite} className="flex-1 justify-center">Anlegen</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
