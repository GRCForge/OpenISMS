import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, FileSpreadsheet, FileText, ListChecks, AlertTriangle, CheckCircle, Euro } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { RiskLevel, RiskScale, RiskTreatmentPlan as Plan, RiskTreatmentItemStatus } from '../types';
import { loadActiveScale, levelLabel } from '../lib/riskMethodology';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Badge } from '../components/ui/Badge';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { exportToMultiSheetExcel, downloadReport, type ReportFormat } from '../lib/export';
import { useToast } from '../contexts/ToastContext';

// Risk treatment plan across all risks (3.8.0) - evidence for ISO 27001
// 6.1.3 e. Rows are filtered by the server (record rights). The Excel export
// goes through lib/export.ts, which neutralises formula injection.

const STATUSES: RiskTreatmentItemStatus[] = ['planned', 'in_progress', 'implemented', 'discarded'];

export const RiskTreatmentPlan: React.FC = () => {
  const { t, i18n } = useTranslation(['risks', 'common']);
  const toast = useToast();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [scale, setScale] = useState<RiskScale | null>(null);
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reportBusy, setReportBusy] = useState<ReportFormat | null>(null);
  const lang = i18n.language;
  // Treatment plan as DOCX/PDF (3.10.0), rendered and audit-logged by the server.
  const planReport = async (f: ReportFormat) => {
    setReportBusy(f);
    try { await downloadReport('/risks/reports/treatment-plan', f, 'risikobehandlungsplan'); }
    catch { toast.error(t('risks:reports.error')); }
    finally { setReportBusy(null); }
  };
  const eur = useMemo(() => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB', { style: 'currency', currency: 'EUR' }), [lang]);
  const lvl = (k?: RiskLevel | null) => (k ? levelLabel(scale, k, t(`risks:levels.${k}`)) : '–');

  useEffect(() => { loadActiveScale().then(setScale).catch(() => setScale(null)); }, []);
  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (status) params.status = status;
    if (overdue) params.overdue = 'true';
    api.get('/risks/treatment-plan', { params })
      .then(r => setPlan(r.data))
      .catch((err: any) => { setPlan(null); toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); })
      .finally(() => setLoading(false));
  }, [status, overdue]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportExcel = () => {
    if (!plan) return;
    const items = plan.items.map(i => ({
      [t('risks:table.ref')]: i.risk.ref || '',
      [t('risks:plan.risk')]: i.risk.title,
      [t('risks:plan.level')]: lvl(i.risk.effective_level),
      [t('risks:plan.appetite')]: i.risk.appetite_exceeded ? t('risks:plan.yes') : '',
      [t('risks:plan.riskOwner')]: i.risk.owner?.name || '',
      [t('risks:plan.measure')]: i.title,
      [t('risks:items.description')]: i.description || '',
      [t('risks:plan.option')]: t(`risks:treatment.${i.treatment_option}`),
      [t('risks:plan.responsible')]: i.responsibleUser?.name || i.responsibleGroup?.name || '',
      [t('risks:plan.due')]: i.due_date ? String(i.due_date).slice(0, 10) : '',
      [t('risks:plan.status')]: t(`risks:items.statuses.${i.status}`),
      [t('risks:items.overdue')]: i.overdue ? t('risks:plan.yes') : '',
      [t('risks:plan.reason')]: i.status_reason || '',
      [t('risks:plan.costOnce')]: i.cost_once ?? '',
      [t('risks:plan.costRecurring')]: i.cost_recurring ?? '',
      [t('risks:plan.control')]: i.control ? `${i.control.code || ''} ${i.control.title}`.trim() : '',
      [t('risks:plan.task')]: i.task ? `#${i.task.id} (${t(`risks:items.taskStatus.${i.task.status}`, { defaultValue: i.task.status })})` : '',
    }));
    const without = plan.risks_without_plan.map(r => ({
      [t('risks:table.ref')]: r.ref || '',
      [t('risks:plan.risk')]: r.title,
      [t('risks:plan.level')]: lvl(r.effective_level),
      [t('risks:plan.appetite')]: r.appetite_exceeded ? t('risks:plan.yes') : '',
      [t('risks:plan.riskOwner')]: r.owner?.name || '',
      [t('risks:form.treatment')]: t(`risks:treatment.${r.treatment}`),
    }));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    void exportToMultiSheetExcel([
      { name: t('risks:plan.sheetPlan'), data: items },
      { name: t('risks:plan.sheetWithout'), data: without },
    ], `risk-treatment-plan-${stamp}`);
  };

  const s = plan?.summary;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link to="/risks" className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"><ArrowLeft size={12} />{t('risks:plan.back')}</Link>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><ListChecks size={22} />{t('risks:plan.title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('risks:plan.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={exportExcel} disabled={!plan || (plan.items.length === 0 && plan.risks_without_plan.length === 0)}><FileSpreadsheet size={14} />Excel</Button>
          {(['docx', 'pdf'] as const).map(f => (
            <Button key={f} variant="secondary" size="sm" title={t('risks:reports.hint')} disabled={reportBusy !== null} onClick={() => void planReport(f)}>
              <FileText size={14} />{reportBusy === f ? t('risks:reports.loading') : `${t('risks:reports.treatmentPlan')} ${f.toUpperCase()}`}
            </Button>
          ))}
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-blue-500 shrink-0"><ListChecks className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{s.items}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:plan.sumItems')}</p></div></CardBody></Card>
          <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-red-500 shrink-0"><AlertTriangle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{s.overdue}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:plan.sumOverdue')}</p></div></CardBody></Card>
          <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-green-600 shrink-0"><CheckCircle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{s.implemented}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:plan.sumImplemented')}</p></div></CardBody></Card>
          <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-amber-500 shrink-0"><Euro className="text-white" size={18} /></div><div><p className="text-sm font-bold dark:text-white">{eur.format(s.cost_once_total)} / {eur.format(s.cost_recurring_total)}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:plan.sumCosts')}</p></div></CardBody></Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <Select className="w-48" value={status} onChange={e => setStatus(e.target.value)} options={[{ value: '', label: t('risks:plan.filterAll') }, ...STATUSES.map(v => ({ value: v, label: t(`risks:items.statuses.${v}`) }))]} />
          <label className="flex items-center gap-2 text-sm dark:text-slate-300"><input type="checkbox" checked={overdue} onChange={e => setOverdue(e.target.checked)} />{t('risks:plan.overdueOnly')}</label>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" /></div>
          ) : !plan || plan.items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">{t('risks:plan.empty')}</p>
          ) : (
            <Table>
              <Thead><tr><Th>{t('risks:plan.risk')}</Th><Th>{t('risks:plan.measure')}</Th><Th>{t('risks:plan.responsible')}</Th><Th>{t('risks:plan.due')}</Th><Th>{t('risks:plan.status')}</Th><Th>{t('risks:plan.costOnce')}</Th><Th>{t('risks:plan.costRecurring')}</Th><Th>{t('risks:plan.task')}</Th></tr></Thead>
              <Tbody>
                {plan.items.map(i => (
                  <tr key={i.id} className={i.overdue ? 'bg-red-50/50 dark:bg-red-900/10' : ''}>
                    <Td>
                      <p className="font-mono text-[10px] text-gray-500">{i.risk.ref}</p>
                      <p className="text-sm dark:text-slate-200">{i.risk.title}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        {i.risk.effective_level && <Badge value={i.risk.effective_level} label={lvl(i.risk.effective_level)} />}
                        {i.risk.appetite_exceeded && <span className="text-[10px] text-red-700 dark:text-red-300">{t('risks:plan.appetite')}</span>}
                      </div>
                    </Td>
                    <Td>
                      <p className={`text-sm dark:text-slate-200 ${i.status === 'discarded' ? 'line-through text-gray-500' : ''}`}>{i.title}</p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400">{t(`risks:treatment.${i.treatment_option}`)}{i.control ? ` · ${i.control.code || ''} ${i.control.title}` : ''}</p>
                      {i.status === 'discarded' && i.status_reason && <p className="text-[11px] text-gray-500 dark:text-slate-400">{i.status_reason}</p>}
                    </Td>
                    <Td className="text-sm dark:text-slate-300">{i.responsibleUser?.name || i.responsibleGroup?.name || '–'}</Td>
                    <Td className={`text-sm ${i.overdue ? 'text-red-600 dark:text-red-400 font-semibold' : 'dark:text-slate-300'}`}>{i.due_date ? String(i.due_date).slice(0, 10) : '–'}{i.overdue ? ` (${t('risks:items.overdue')})` : ''}</Td>
                    <Td className="text-sm dark:text-slate-300">{t(`risks:items.statuses.${i.status}`)}</Td>
                    <Td className="text-sm dark:text-slate-300 text-right">{i.cost_once != null ? eur.format(i.cost_once) : ''}</Td>
                    <Td className="text-sm dark:text-slate-300 text-right">{i.cost_recurring != null ? eur.format(i.cost_recurring) : ''}</Td>
                    <Td className="text-xs dark:text-slate-400">{i.task ? `#${i.task.id} · ${t(`risks:items.taskStatus.${i.task.status}`, { defaultValue: i.task.status })}` : '–'}</Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {plan && plan.risks_without_plan.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold dark:text-white">{t('risks:plan.withoutPlan', { count: plan.risks_without_plan.length })}</h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('risks:plan.withoutPlanHint')}</p>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <Thead><tr><Th>{t('risks:table.ref')}</Th><Th>{t('risks:plan.risk')}</Th><Th>{t('risks:plan.level')}</Th><Th>{t('risks:plan.riskOwner')}</Th><Th>{t('risks:form.treatment')}</Th></tr></Thead>
              <Tbody>
                {plan.risks_without_plan.map(r => (
                  <tr key={r.id}>
                    <Td className="font-mono text-xs text-gray-500">{r.ref}</Td>
                    <Td className="text-sm dark:text-slate-200">{r.title}{r.appetite_exceeded && <span className="ml-2 text-[10px] text-red-700 dark:text-red-300">{t('risks:plan.appetite')}</span>}</Td>
                    <Td>{r.effective_level ? <Badge value={r.effective_level} label={lvl(r.effective_level)} /> : '–'}</Td>
                    <Td className="text-sm dark:text-slate-300">{r.owner?.name || '–'}</Td>
                    <Td className="text-sm dark:text-slate-300">{t(`risks:treatment.${r.treatment}`)}</Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
};
