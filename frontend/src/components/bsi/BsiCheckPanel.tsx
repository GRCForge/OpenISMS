import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, FileSpreadsheet, ClipboardCheck, Euro, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import writeXlsxFile, { type Cell } from 'write-excel-file/browser';
import api from '../../lib/api';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SearchableSelect } from '../ui/SearchableSelect';
import { Modal } from '../ui/Modal';
import { IconButton } from '../ui/IconButton';
import { Table, Thead, Tbody, Th, Td } from '../ui/Table';
import { useToast } from '../../contexts/ToastContext';
import type { BsiDomain } from './BsiDomainPanel';

// IT-Grundschutz-Check je Zielobjekt (BSI-Standard 200-2 Kap. 8.4).
// Backend: /api/bsi-grundschutz/domains/:id/check (services/bsiCheckService.js).

export type CheckStatus = 'implemented' | 'in_progress' | 'not_implemented' | 'not_applicable' | 'not_started';
const STATUSES: CheckStatus[] = ['implemented', 'in_progress', 'not_implemented', 'not_applicable', 'not_started'];
const NEEDS_JUSTIFICATION: CheckStatus[] = ['not_implemented', 'not_applicable'];

const statusColors: Record<CheckStatus, string> = {
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  not_implemented: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  not_applicable: 'bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400',
  not_started: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

interface Ref { id: number; name: string }
interface CheckEntry {
  entry_id: number | null;
  target_object_id: number | null;
  target_name: string | null;
  target_type: string | null;
  module_id: string;
  module_title: string | null;
  req_id: string;
  title: string;
  requirement_level: string | null;
  implementation_status: CheckStatus;
  justification: string | null;
  responsible: Ref | null;
  responsible_group: Ref | null;
  due_date: string | null;
  cost_once: number | null;
  cost_recurring: number | null;
  notes: string | null;
  last_review_date: string | null;
  documents: { id: number; original_name: string }[];
  controls: { id: number; code: string; title: string }[];
}
interface Bucket { total: number; fulfillment: number | null; cost_once: number; cost_recurring: number; implemented: number; in_progress: number; not_implemented: number; not_applicable: number; not_started: number }
interface Summary { total: Bucket; by_module: (Bucket & { module_id: string; module_title: string | null })[]; by_target: (Bucket & { target_object_id: number | null; target_name: string | null })[] }
interface CheckData {
  domain: { id: number; name: string; protection_approach: string };
  levels: string[];
  entries: CheckEntry[];
  unmodeled: { entry_id: number; target_object_id: number | null; target_name: string | null; req_id: string; title: string; implementation_status: CheckStatus; retired: boolean }[];
}

interface Props {
  domain: BsiDomain | null;
  canEdit: boolean;
}

const emptyForm = {
  implementation_status: 'not_started' as CheckStatus, justification: '', responsible_id: '', responsible_group_id: '',
  due_date: '', cost_once: '', cost_recurring: '', notes: '', last_review_date: '', document_ids: [] as number[], control_ids: [] as number[],
};

const apiError = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

const eur = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString(undefined, { style: 'currency', currency: 'EUR' }));
const pct = (n: number | null | undefined) => (n == null ? '–' : `${n} %`);

export const BsiCheckPanel: React.FC<Props> = ({ domain, canEdit }) => {
  const { t } = useTranslation('bsigrundschutz');
  const toast = useToast();
  const [data, setData] = useState<CheckData | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [targetFilter, setTargetFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [edit, setEdit] = useState<CheckEntry | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<{ id: number; name: string; active?: boolean }[]>([]);
  const [groups, setGroups] = useState<Ref[]>([]);
  const [controls, setControls] = useState<{ id: number; code: string; title: string }[]>([]);
  const [docs, setDocs] = useState<{ id: number; original_name: string }[]>([]);

  const load = useCallback(async () => {
    if (!domain) return;
    const [c, s] = await Promise.all([
      api.get(`/bsi-grundschutz/domains/${domain.id}/check`),
      api.get(`/bsi-grundschutz/domains/${domain.id}/check/summary`),
    ]);
    setData(c.data);
    setSummary(s.data);
  }, [domain]);

  useEffect(() => { load().catch(() => { setData(null); setSummary(null); }); }, [load]);
  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
    api.get('/groups').then(r => setGroups(r.data.map((g: Ref) => ({ id: g.id, name: g.name })))).catch(() => {});
    api.get('/controls').then(r => setControls(r.data.map((c: { id: number; code: string; title: string }) => ({ id: c.id, code: c.code, title: c.title })))).catch(() => {});
  }, []);

  const statusLabel = (s: CheckStatus) => t(`check.status.${s}`);
  const targets = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of data?.entries || []) m.set(e.target_object_id == null ? 'domain' : String(e.target_object_id), e.target_name || t('check.domainLevel'));
    return [...m.entries()];
  }, [data, t]);

  const filtered = useMemo(() => (data?.entries || []).filter(e => {
    if (targetFilter && (e.target_object_id == null ? 'domain' : String(e.target_object_id)) !== targetFilter) return false;
    if (statusFilter && e.implementation_status !== statusFilter) return false;
    return true;
  }), [data, targetFilter, statusFilter]);

  const grouped = useMemo(() => {
    const out = new Map<string, { label: string; modules: Map<string, CheckEntry[]> }>();
    for (const e of filtered) {
      const k = e.target_object_id == null ? 'domain' : String(e.target_object_id);
      if (!out.has(k)) out.set(k, { label: e.target_name || t('check.domainLevel'), modules: new Map() });
      const g = out.get(k)!;
      if (!g.modules.has(e.module_id)) g.modules.set(e.module_id, []);
      g.modules.get(e.module_id)!.push(e);
    }
    return [...out.entries()];
  }, [filtered, t]);

  const openEdit = async (e: CheckEntry) => {
    setEdit(e);
    setForm({
      implementation_status: e.implementation_status, justification: e.justification || '',
      responsible_id: e.responsible ? String(e.responsible.id) : '', responsible_group_id: e.responsible_group ? String(e.responsible_group.id) : '',
      due_date: e.due_date || '', cost_once: e.cost_once == null ? '' : String(e.cost_once), cost_recurring: e.cost_recurring == null ? '' : String(e.cost_recurring),
      notes: e.notes || '', last_review_date: e.last_review_date || '',
      document_ids: e.documents.map(d => d.id), control_ids: e.controls.map(c => c.id),
    });
    if (domain) {
      api.get(`/bsi-grundschutz/domains/${domain.id}/check/documents`, { params: e.target_object_id ? { target_object_id: e.target_object_id } : {} })
        .then(r => setDocs(r.data)).catch(() => setDocs([]));
    }
  };

  const needsJustification = NEEDS_JUSTIFICATION.includes(form.implementation_status);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!domain || !edit) return;
    setSaving(true);
    try {
      await api.put(`/bsi-grundschutz/domains/${domain.id}/check`, {
        target_object_id: edit.target_object_id,
        req_id: edit.req_id,
        implementation_status: form.implementation_status,
        justification: form.justification || null,
        responsible_id: form.responsible_id ? Number(form.responsible_id) : null,
        responsible_group_id: form.responsible_group_id ? Number(form.responsible_group_id) : null,
        due_date: form.due_date || null,
        cost_once: form.cost_once === '' ? null : form.cost_once,
        cost_recurring: form.cost_recurring === '' ? null : form.cost_recurring,
        notes: form.notes || null,
        last_review_date: form.last_review_date || null,
        document_ids: form.document_ids,
        // Nur mitschicken, wenn sich etwas geaendert hat: Massnahmen zuordnen braucht controls.edit.
        ...(JSON.stringify([...form.control_ids].sort()) !== JSON.stringify(edit.controls.map(c => c.id).sort()) ? { control_ids: form.control_ids } : {}),
      });
      setEdit(null);
      await load();
    } catch (err) {
      toast.error(apiError(err, t('toast.saveError')));
    } finally { setSaving(false); }
  };

  // Excel im Aufbau des Referenzdokuments A.4; die Zeilen kommen formel-neutralisiert vom Server.
  const exportA4 = async () => {
    if (!domain) return;
    try {
      const r = await api.get(`/bsi-grundschutz/domains/${domain.id}/check/export`);
      const columns: string[] = r.data.columns;
      const rows: (string | number | null)[][] = r.data.rows;
      const toCell = (v: string | number | null): Cell => (v === null || v === '' ? null : typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String });
      const sheet: Cell[][] = [columns.map(c => ({ value: c, fontWeight: 'bold' as const })), ...rows.map(row => row.map(toCell))];
      const safeName = domain.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'Verbund';
      await writeXlsxFile(sheet, { sheet: 'A.4 IT-Grundschutz-Check', columns: columns.map(c => ({ width: Math.max(12, Math.min(60, c.length + 4)) })) })
        .toFile(`A4_IT-Grundschutz-Check_${safeName}.xlsx`);
    } catch (err) { toast.error(apiError(err, t('toast.loadError'))); }
  };

  if (!domain) return <Card><CardBody><p className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">{t('check.noDomain')}</p></CardBody></Card>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('check.fulfillment'), value: pct(summary?.total.fulfillment), icon: ClipboardCheck, color: 'bg-green-600' },
          { label: t('check.openCount'), value: String((summary?.total.not_started || 0) + (summary?.total.in_progress || 0)), icon: Pencil, color: 'bg-blue-500' },
          { label: t('check.costOnce'), value: eur(summary?.total.cost_once), icon: Euro, color: 'bg-amber-500' },
          { label: t('check.costRecurring'), value: eur(summary?.total.cost_recurring), icon: Euro, color: 'bg-amber-600' },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div><p className="text-xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <Card><CardBody className="space-y-2">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <Select className="w-64" label={t('check.filterTarget')} value={targetFilter} onChange={e => setTargetFilter(e.target.value)}
            options={[{ value: '', label: t('check.allTargets') }, ...targets.map(([v, l]) => ({ value: v, label: l }))]} />
          <Select className="w-48" label={t('table.status')} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            options={[{ value: '', label: t('filter.allStatus') }, ...STATUSES.map(s => ({ value: s, label: statusLabel(s) }))]} />
          <div className="flex-1" />
          <Button variant="secondary" onClick={exportA4}><FileSpreadsheet size={16} />{t('check.export')}</Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">{t(`check.approachInfo.${data?.domain.protection_approach || domain.protection_approach}`)}</p>
      </CardBody></Card>

      {(data?.entries.length || 0) === 0 && (
        <Card><CardBody><p className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">{t('check.empty')}</p></CardBody></Card>
      )}

      {grouped.map(([key, g]) => (
        <Card key={key} className="overflow-hidden"><CardBody className="space-y-4">
          <h3 className="font-semibold dark:text-white">{g.label}</h3>
          {[...g.modules.entries()].map(([moduleId, list]) => {
            const b = summary?.by_module.find(x => x.module_id === moduleId);
            return (
              <div key={moduleId} className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">{moduleId}</span>
                  <span className="dark:text-slate-200">{list[0].module_title}</span>
                  {b && <span className="text-xs text-gray-500 dark:text-slate-400 ml-auto">{t('check.moduleFulfillment', { value: pct(b.fulfillment) })}</span>}
                </div>
                <Table>
                  <Thead><tr><Th>{t('table.reqId')}</Th><Th>{t('table.title')}</Th><Th>{t('table.level')}</Th><Th>{t('table.status')}</Th><Th>{t('check.responsible')}</Th><Th>{t('check.dueDate')}</Th><Th>{''}</Th></tr></Thead>
                  <Tbody>
                    {list.map(e => (
                      <tr key={`${e.target_object_id}-${e.req_id}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 align-top">
                        <Td><span className="font-mono text-xs text-gray-600 dark:text-slate-400">{e.req_id}</span></Td>
                        <Td><p className="text-sm dark:text-slate-200">{e.title}</p>{e.justification && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{e.justification}</p>}</Td>
                        <Td className="text-xs dark:text-slate-300">{e.requirement_level ? t(`level.${e.requirement_level}`) : '–'}</Td>
                        <Td><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColors[e.implementation_status]}`}>{statusLabel(e.implementation_status)}</span></Td>
                        <Td className="text-xs dark:text-slate-300">{[e.responsible?.name, e.responsible_group?.name].filter(Boolean).join(' / ') || '–'}</Td>
                        <Td className="text-xs dark:text-slate-300">{e.due_date || '–'}</Td>
                        <Td><IconButton label={t('check.edit')} onClick={() => openEdit(e)}><Pencil size={14} /></IconButton></Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            );
          })}
        </CardBody></Card>
      ))}

      {summary && summary.by_target.length > 0 && (
        <Card><CardBody className="space-y-3">
          <h3 className="font-semibold dark:text-white">{t('check.summaryTitle')}</h3>
          <Table>
            <Thead><tr><Th>{t('check.target')}</Th><Th>{t('check.requirements')}</Th><Th>{t('check.fulfillment')}</Th><Th>{t('check.status.not_implemented')}</Th><Th>{t('check.costOnce')}</Th><Th>{t('check.costRecurring')}</Th></tr></Thead>
            <Tbody>
              {summary.by_target.map(b => (
                <tr key={String(b.target_object_id)}><Td className="text-sm dark:text-slate-200">{b.target_name || t('check.domainLevel')}</Td><Td>{b.total}</Td><Td>{pct(b.fulfillment)}</Td><Td>{b.not_implemented}</Td><Td>{eur(b.cost_once)}</Td><Td>{eur(b.cost_recurring)}</Td></tr>
              ))}
            </Tbody>
          </Table>
          <Table>
            <Thead><tr><Th>{t('domain.module')}</Th><Th>{t('check.requirements')}</Th><Th>{t('check.fulfillment')}</Th><Th>{t('check.status.not_implemented')}</Th><Th>{t('check.costOnce')}</Th><Th>{t('check.costRecurring')}</Th></tr></Thead>
            <Tbody>
              {summary.by_module.map(b => (
                <tr key={b.module_id}><Td className="text-sm dark:text-slate-200"><span className="font-mono text-xs">{b.module_id}</span> {b.module_title}</Td><Td>{b.total}</Td><Td>{pct(b.fulfillment)}</Td><Td>{b.not_implemented}</Td><Td>{eur(b.cost_once)}</Td><Td>{eur(b.cost_recurring)}</Td></tr>
              ))}
            </Tbody>
          </Table>
        </CardBody></Card>
      )}

      {data && data.unmodeled.length > 0 && (
        <Card><CardBody className="space-y-2">
          <h3 className="font-semibold dark:text-white flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500" />{t('check.unmodeledTitle', { count: data.unmodeled.length })}</h3>
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('check.unmodeledHint')}</p>
          <ul className="text-sm space-y-1">
            {data.unmodeled.map(u => (
              <li key={u.entry_id} className="dark:text-slate-300"><span className="font-mono text-xs">{u.req_id}</span> {u.title} · {u.target_name || t('check.domainLevel')} · {statusLabel(u.implementation_status)}{u.retired ? ` · ${t('check.retired')}` : ''}</li>
            ))}
          </ul>
        </CardBody></Card>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit ? `${edit.req_id} – ${edit.title}` : ''}>
        <form onSubmit={save} className="space-y-4">
          {edit && <p className="text-xs text-gray-500 dark:text-slate-400">{edit.target_name || t('check.domainLevel')} · {edit.module_id} {edit.module_title}</p>}
          <Select label={t('table.status')} value={form.implementation_status} disabled={!canEdit}
            onChange={e => setForm({ ...form, implementation_status: e.target.value as CheckStatus })}
            options={STATUSES.map(s => ({ value: s, label: statusLabel(s) }))} />
          <div className="flex flex-col gap-1">
            <label htmlFor="bsi-check-justification" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('check.justification')}{needsJustification ? ' *' : ''}</label>
            <textarea id="bsi-check-justification" rows={3} required={needsJustification} disabled={!canEdit}
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" value={form.justification}
              onChange={e => setForm({ ...form, justification: e.target.value })} />
            {needsJustification && <p className="text-xs text-gray-500 dark:text-slate-400">{t('check.justificationRequired')}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SearchableSelect label={t('check.responsibleUser')} value={form.responsible_id} disabled={!canEdit} onChange={v => setForm({ ...form, responsible_id: v })}
              options={[{ value: '', label: t('modal.nobody') }, ...users.filter(u => u.active !== false).map(u => ({ value: String(u.id), label: u.name }))]} />
            <SearchableSelect label={t('check.responsibleGroup')} value={form.responsible_group_id} disabled={!canEdit} onChange={v => setForm({ ...form, responsible_group_id: v })}
              options={[{ value: '', label: t('modal.nobody') }, ...groups.map(g => ({ value: String(g.id), label: g.name }))]} />
            <Input type="date" label={t('check.dueDate')} value={form.due_date} disabled={!canEdit} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            <Input type="date" label={t('modal.lastReview')} value={form.last_review_date} disabled={!canEdit} onChange={e => setForm({ ...form, last_review_date: e.target.value })} />
            <Input type="number" min={0} step="0.01" label={t('check.costOnce')} value={form.cost_once} disabled={!canEdit} onChange={e => setForm({ ...form, cost_once: e.target.value })} />
            <Input type="number" min={0} step="0.01" label={t('check.costRecurring')} value={form.cost_recurring} disabled={!canEdit} onChange={e => setForm({ ...form, cost_recurring: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('check.evidence')}</span>
            {docs.length === 0 && form.document_ids.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400">{t('check.noDocuments')}</p>}
            <div className="max-h-36 overflow-y-auto space-y-1">
              {[...docs, ...(edit?.documents || []).filter(d => !docs.some(x => x.id === d.id))].map(d => (
                <label key={d.id} className="flex items-center gap-2 text-sm dark:text-slate-200">
                  <input type="checkbox" disabled={!canEdit} checked={form.document_ids.includes(d.id)}
                    onChange={e => setForm({ ...form, document_ids: e.target.checked ? [...form.document_ids, d.id] : form.document_ids.filter(x => x !== d.id) })} />
                  {d.original_name}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('check.controls')}</span>
            <SearchableSelect value="" disabled={!canEdit} placeholder={t('check.addControl')}
              onChange={v => v && !form.control_ids.includes(Number(v)) && setForm({ ...form, control_ids: [...form.control_ids, Number(v)] })}
              options={controls.filter(c => !form.control_ids.includes(c.id)).map(c => ({ value: String(c.id), label: `${c.code} ${c.title}` }))} />
            <div className="flex flex-wrap gap-1.5">
              {form.control_ids.map(id => {
                const c = controls.find(x => x.id === id) || edit?.controls.find(x => x.id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 dark:text-slate-300">
                    {c ? `${c.code} ${c.title}` : `#${id}`}
                    {canEdit && <button type="button" aria-label={t('check.removeControl')} onClick={() => setForm({ ...form, control_ids: form.control_ids.filter(x => x !== id) })}>×</button>}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bsi-check-notes" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notes')}</label>
            <textarea id="bsi-check-notes" rows={2} disabled={!canEdit} className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEdit(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            {canEdit && <Button type="submit" disabled={saving || (needsJustification && !form.justification.trim())} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
