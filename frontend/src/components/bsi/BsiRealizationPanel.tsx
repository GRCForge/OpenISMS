import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, FileDown, Trash2, Euro, CalendarClock, ListChecks, UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import writeXlsxFile, { type Cell } from 'write-excel-file/browser';
import api from '../../lib/api';
import { downloadReport, type ReportFormat } from '../../lib/export';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { IconButton } from '../ui/IconButton';
import { Table, Thead, Tbody, Th, Td } from '../ui/Table';
import { useToast } from '../../contexts/ToastContext';
import type { BsiDomain } from './BsiDomainPanel';

// Realisierungsplan (Referenzdokument A.6) und die Referenzdokumente A.1-A.6
// als DOCX/PDF (3.10.0). Backend: /api/bsi-grundschutz/domains/:id/realization-plan
// und /reports/:doc (services/bsiRiskAnalysisService.js, services/reportService.js).

type Priority = 'high' | 'medium' | 'low';
interface PlanItem {
  kind: 'requirement' | 'measure'; key: string; realization_measure_id?: number; target_name: string | null;
  ref: string; title: string; module_id?: string; risk_title?: string; level: string | null; status: string;
  responsible: string | null; due_date: string | null; cost_once: number | null; cost_recurring: number | null;
  priority: Priority; priority_source: 'set' | 'suggested';
}
interface Plan {
  summary: { items: number; requirements: number; measures: number; overdue: number; without_responsible: number; without_due_date: number; cost_once_total: number; cost_recurring_total: number; not_checked_requirements: number };
  items: PlanItem[];
}
interface Props { domain: BsiDomain | null; canEdit: boolean }

const DOCS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'all'] as const;
const apiError = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;
const eur = (n: number | null | undefined) => (n == null ? '–' : n.toLocaleString(undefined, { style: 'currency', currency: 'EUR' }));
const priorityColors: Record<Priority, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

export const BsiRealizationPanel: React.FC<Props> = ({ domain, canEdit }) => {
  const { t } = useTranslation('bsigrundschutz');
  const toast = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [priorityFilter, setPriorityFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const base = domain ? `/bsi-grundschutz/domains/${domain.id}` : '';
  const load = useCallback(async () => {
    if (!domain) return;
    const r = await api.get(`${base}/realization-plan`);
    setPlan(r.data);
  }, [domain, base]);
  useEffect(() => { load().catch(() => setPlan(null)); }, [load]);

  const items = useMemo(() => (plan?.items || []).filter(i => !priorityFilter || i.priority === priorityFilter), [plan, priorityFilter]);

  const setPriority = async (i: PlanItem, p: string) => {
    if (!i.realization_measure_id) return;
    try { await api.put(`${base}/realization-plan/measures/${i.realization_measure_id}`, { priority: p || null }); await load(); }
    catch (err) { toast.error(apiError(err, t('toast.saveError'))); }
  };
  const remove = async (i: PlanItem) => {
    if (!i.realization_measure_id) return;
    try { await api.delete(`${base}/realization-plan/measures/${i.realization_measure_id}`); await load(); }
    catch (err) { toast.error(apiError(err, t('toast.saveError'))); }
  };

  // Excel im Aufbau des Referenzdokuments A.6; Zeilen formel-neutralisiert vom Server.
  const exportA6 = async () => {
    if (!domain) return;
    try {
      const r = await api.get(`${base}/realization-plan/export`);
      const columns: string[] = r.data.columns;
      const rows: (string | number | null)[][] = r.data.rows;
      const toCell = (v: string | number | null): Cell => (v === null || v === '' ? null : typeof v === 'number' ? { value: v, type: Number } : { value: v, type: String });
      const sheet: Cell[][] = [columns.map(c => ({ value: c, fontWeight: 'bold' as const })), ...rows.map(row => row.map(toCell))];
      const safeName = domain.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'Verbund';
      await writeXlsxFile(sheet, { sheet: 'A.6 Realisierungsplan', columns: columns.map(c => ({ width: Math.max(12, Math.min(60, c.length + 4)) })) })
        .toFile(`A6_Realisierungsplan_${safeName}.xlsx`);
    } catch (err) { toast.error(apiError(err, t('toast.loadError'))); }
  };

  const report = async (doc: typeof DOCS[number], format: ReportFormat) => {
    if (!domain) return;
    setBusy(`${doc}-${format}`);
    try { await downloadReport(`${base}/reports/${doc}`, format, `bsi-${doc}`); }
    catch { toast.error(t('reports.error')); }
    finally { setBusy(null); }
  };

  if (!domain) return <Card><CardBody><p className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">{t('check.noDomain')}</p></CardBody></Card>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: t('realization.items'), value: String(plan?.summary.items ?? 0), icon: ListChecks, color: 'bg-blue-600' },
          { label: t('realization.overdue'), value: String(plan?.summary.overdue ?? 0), icon: CalendarClock, color: 'bg-red-500' },
          { label: t('realization.withoutResponsible'), value: String(plan?.summary.without_responsible ?? 0), icon: UserX, color: 'bg-amber-500' },
          { label: t('check.costOnce'), value: eur(plan?.summary.cost_once_total), icon: Euro, color: 'bg-amber-600' },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div><p className="text-xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
          </CardBody></Card>
        ))}
      </div>

      <Card><CardBody className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <Select className="w-48" label={t('realization.priority')} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
            options={[{ value: '', label: t('realization.allPriorities') }, ...(['high', 'medium', 'low'] as const).map(p => ({ value: p, label: t(`realization.priorities.${p}`) }))]} />
          <div className="flex-1" />
          <Button variant="secondary" onClick={exportA6}><FileSpreadsheet size={16} />{t('realization.export')}</Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">{t('realization.hint')}</p>
        {(plan?.summary.not_checked_requirements || 0) > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t('realization.notChecked', { count: plan?.summary.not_checked_requirements })}</p>
        )}
        {items.length === 0
          ? <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">{t('realization.empty')}</p>
          : (
            <Table>
              <Thead><tr><Th>{t('realization.priority')}</Th><Th>{t('realization.kind')}</Th><Th>{t('check.target')}</Th><Th>{t('realization.ref')}</Th><Th>{t('table.status')}</Th><Th>{t('check.responsible')}</Th><Th>{t('check.dueDate')}</Th><Th>{t('check.costOnce')}</Th><Th>{''}</Th></tr></Thead>
              <Tbody>
                {items.map(i => (
                  <tr key={i.key} className="align-top">
                    <Td>
                      {i.kind === 'measure' && canEdit
                        ? <Select value={i.priority_source === 'set' ? i.priority : ''} onChange={e => void setPriority(i, e.target.value)}
                            options={[{ value: '', label: `${t('realization.prioritySuggested')} (${t(`realization.priorities.${i.priority}`)})` }, ...(['high', 'medium', 'low'] as const).map(p => ({ value: p, label: t(`realization.priorities.${p}`) }))]} />
                        : <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${priorityColors[i.priority]}`}>{t(`realization.priorities.${i.priority}`)}{i.priority_source === 'suggested' ? ` · ${t('realization.suggestedShort')}` : ''}</span>}
                    </Td>
                    <Td className="text-xs dark:text-slate-300">{t(`realization.kinds.${i.kind}`)}</Td>
                    <Td className="text-xs dark:text-slate-300">{i.target_name || t('check.domainLevel')}</Td>
                    <Td><p className="text-sm dark:text-slate-200"><span className="font-mono text-xs">{i.ref}</span> {i.title}</p><p className="text-xs text-gray-500 dark:text-slate-400">{i.kind === 'requirement' ? i.module_id : i.risk_title}</p></Td>
                    <Td className="text-xs dark:text-slate-300">{i.kind === 'requirement' ? t(`check.status.${i.status}`) : t(`riskAnalysis.itemStatus.${i.status}`)}</Td>
                    <Td className="text-xs dark:text-slate-300">{i.responsible || '–'}</Td>
                    <Td className="text-xs dark:text-slate-300">{i.due_date ? String(i.due_date).slice(0, 10) : '–'}</Td>
                    <Td className="text-xs dark:text-slate-300">{eur(i.cost_once)}</Td>
                    <Td>{i.kind === 'measure' && canEdit && <IconButton label={t('realization.remove')} onClick={() => void remove(i)}><Trash2 size={14} /></IconButton>}</Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
      </CardBody></Card>

      <Card><CardBody className="space-y-3">
        <h3 className="font-semibold dark:text-white flex items-center gap-2"><FileText size={16} />{t('reports.title')}</h3>
        <p className="text-xs text-gray-500 dark:text-slate-400">{t('reports.hint')}</p>
        <Table>
          <Thead><tr><Th>{t('reports.document')}</Th><Th>{''}</Th></tr></Thead>
          <Tbody>
            {DOCS.map(doc => (
              <tr key={doc}>
                <Td className="text-sm dark:text-slate-200">{t(`reports.docs.${doc}`)}</Td>
                <Td>
                  <div className="flex gap-2 justify-end">
                    {(['docx', 'pdf'] as const).map(f => (
                      <Button key={f} variant="secondary" size="sm" disabled={busy !== null} onClick={() => void report(doc, f)}>
                        <FileDown size={14} />{busy === `${doc}-${f}` ? t('reports.loading') : f.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      </CardBody></Card>
    </div>
  );
};
