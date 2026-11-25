import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Activity, AlertTriangle, CalendarClock, Gauge, Flag, Hourglass, TrendingDown, TrendingUp, FileSpreadsheet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { RiskLevel, RiskScale, RiskReviewFlag, RiskReviewTrigger, RiskTrend, RiskMonitoringSummary } from '../types';
import { loadActiveScale, levelLabel } from '../lib/riskMethodology';
import { RiskHeatmap } from '../components/risks/RiskHeatmap';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Badge } from '../components/ui/Badge';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { exportToExcel } from '../lib/export';
import { useToast } from '../contexts/ToastContext';

// Risk monitoring (3.9.0, ISO 27005 clause 10): figures, the reassessment
// list with reasons and the trend heat map (assessments valid at two dates).
// The reassessment list is filtered by the server (record rights); figures
// and the trend are counts only.

const TRIGGERS: RiskReviewTrigger[] = ['incident', 'audit_finding', 'threat_advisory', 'cve', 'kri', 'review_overdue'];
const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const RiskMonitoring: React.FC = () => {
  const { t, i18n } = useTranslation(['risks', 'common']);
  const toast = useToast();
  const lang = i18n.language;
  const [scale, setScale] = useState<RiskScale | null>(null);
  const [summary, setSummary] = useState<RiskMonitoringSummary | null>(null);
  const [flags, setFlags] = useState<RiskReviewFlag[]>([]);
  const [status, setStatus] = useState('open');
  const [trigger, setTrigger] = useState('');
  const [from, setFrom] = useState(day(-90));
  const [to, setTo] = useState(day(0));
  const [basis, setBasis] = useState<'residual' | 'inherent'>('residual');
  const [trend, setTrend] = useState<RiskTrend | null>(null);
  const lvl = (k?: RiskLevel | null) => (k ? levelLabel(scale, k, t(`risks:levels.${k}`)) : '–');
  const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB') : '–');

  useEffect(() => {
    loadActiveScale().then(setScale).catch(() => setScale(null));
    api.get('/risks/monitoring/summary').then(r => setSummary(r.data)).catch(() => setSummary(null));
  }, []);
  useEffect(() => {
    const params: Record<string, string> = { status };
    if (trigger) params.trigger_type = trigger;
    api.get('/risks/review-flags', { params }).then(r => setFlags(Array.isArray(r.data) ? r.data : []))
      .catch((err: any) => { setFlags([]); toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); });
  }, [status, trigger]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadTrend = () => {
    api.get('/risks/monitoring/trend', { params: { from, to, basis } }).then(r => setTrend(r.data))
      .catch((err: any) => { setTrend(null); toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); });
  };
  useEffect(loadTrend, [basis]); // eslint-disable-line react-hooks/exhaustive-deps

  const countsOf = (cells?: { likelihood: number; impact: number; count: number }[]) => new Map((cells || []).map(c => [`${c.likelihood}-${c.impact}`, c.count]));
  const fromCounts = useMemo(() => countsOf(trend?.cells_from), [trend]);
  const toCounts = useMemo(() => countsOf(trend?.cells_to), [trend]);
  const sameMatrix = !!scale && !!trend && scale.likelihood_size === trend.likelihood_size && scale.impact_size === trend.impact_size;

  const exportFlags = () => {
    const rows = flags.map(f => ({
      [t('risks:table.ref')]: f.risk?.ref || '',
      [t('risks:plan.risk')]: f.risk?.title || '',
      [t('risks:plan.riskOwner')]: f.risk?.owner?.name || '',
      [t('risks:plan.level')]: lvl(f.risk?.effective_level),
      [t('risks:monitoring.colTrigger')]: t(`risks:monitoring.trigger.${f.trigger_type}`),
      [t('risks:monitoring.colReason')]: f.reason,
      [t('risks:monitoring.colEvents')]: f.occurrence_count,
      [t('risks:monitoring.colFlagged')]: fmt(f.created_at),
      [t('risks:monitoring.colTask')]: f.task ? `#${f.task.id} (${f.task.status})` : '',
      [t('risks:monitoring.colStatus')]: f.status === 'open' ? t('risks:monitoring.statusOpen') : `${t('risks:monitoring.statusResolved')} – ${f.resolution || ''}`,
    }));
    void exportToExcel(rows, `risk-reassessment-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`, t('risks:monitoring.sheet'));
  };

  const s = summary;
  const card = (icon: React.ReactNode, color: string, value: React.ReactNode, label: string) => (
    <Card><CardBody className="flex items-center gap-3 py-4"><div className={`p-2.5 rounded-xl ${color} shrink-0 text-white`}>{icon}</div><div><p className="text-2xl font-bold dark:text-white">{value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{label}</p></div></CardBody></Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link to="/risks" className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"><ArrowLeft size={12} />{t('risks:plan.back')}</Link>
        <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><Activity size={22} />{t('risks:monitoring.pageTitle')}</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm">{t('risks:monitoring.pageSubtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {card(<AlertTriangle size={18} />, 'bg-amber-500', s?.open_reassessments ?? '–', t('risks:monitoring.kpiReassessments'))}
        {card(<CalendarClock size={18} />, 'bg-red-500', s?.overdue_reviews ?? '–', t('risks:monitoring.kpiOverdue'))}
        {card(<Gauge size={18} />, 'bg-rose-600', s?.kri_breaches ?? '–', t('risks:monitoring.kpiKri'))}
        {card(<Flag size={18} />, 'bg-orange-500', s?.appetite_exceeded ?? '–', t('risks:monitoring.kpiAppetite'))}
        {card(<Hourglass size={18} />, 'bg-blue-500', s ? `${s.acceptances_expiring} / ${s.acceptances_expired}` : '–', t('risks:monitoring.kpiAcceptances'))}
        {card(s?.trend && s.trend.worsened > s.trend.improved ? <TrendingUp size={18} /> : <TrendingDown size={18} />, 'bg-emerald-600', s?.trend ? `${s.trend.improved} / ${s.trend.worsened}` : '–', t('risks:monitoring.kpiTrend', { days: s?.trend?.days ?? 90 }))}
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-semibold dark:text-white">{t('risks:monitoring.listTitle')}</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <Select className="w-40" value={status} onChange={e => setStatus(e.target.value)} options={[{ value: 'open', label: t('risks:monitoring.statusOpen') }, { value: 'resolved', label: t('risks:monitoring.statusResolved') }, { value: 'all', label: t('risks:monitoring.statusAll') }]} />
            <Select className="w-56" value={trigger} onChange={e => setTrigger(e.target.value)} options={[{ value: '', label: t('risks:monitoring.allTriggers') }, ...TRIGGERS.map(x => ({ value: x, label: `${t(`risks:monitoring.trigger.${x}`)}${s ? ` (${s.open_reassessments_by_trigger[x] ?? 0})` : ''}` }))]} />
            <Button variant="secondary" size="sm" onClick={exportFlags} disabled={!flags.length}><FileSpreadsheet size={14} />Excel</Button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <Thead><tr><Th>{t('risks:plan.risk')}</Th><Th>{t('risks:monitoring.colTrigger')}</Th><Th>{t('risks:monitoring.colReason')}</Th><Th>{t('risks:monitoring.colFlagged')}</Th><Th>{t('risks:monitoring.colTask')}</Th></tr></Thead>
            <Tbody>
              {flags.map(f => (
                <tr key={f.id} className="align-top">
                  <Td>
                    <p className="font-mono text-[10px] text-gray-500">{f.risk?.ref}</p>
                    <p className="text-sm font-medium dark:text-slate-200">{f.risk?.title}</p>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400">{f.risk?.owner?.name || '–'}</p>
                    {f.risk?.effective_level && <Badge value={f.risk.effective_level} label={lvl(f.risk.effective_level)} />}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{t(`risks:monitoring.trigger.${f.trigger_type}`)}{f.occurrence_count > 1 && <span className="block text-[10px] text-gray-500">{t('risks:monitoring.occurrences', { count: f.occurrence_count })}</span>}</Td>
                  <Td className="text-xs dark:text-slate-300 max-w-md">
                    {f.reason}
                    {(f.occurrences || []).slice(1).map((o, i) => <p key={i} className="text-[11px] text-gray-500 dark:text-slate-400">{fmt(o.at)}: {o.reason}</p>)}
                    {f.status === 'resolved' && <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">{t('risks:monitoring.resolvedBy', { name: f.resolvedBy?.name || t('risks:monitoring.system'), date: fmt(f.resolved_at), how: t(`risks:monitoring.resolution.${f.resolution || 'reviewed'}`) })}{f.resolution_note ? ` – ${f.resolution_note}` : ''}</p>}
                  </Td>
                  <Td className="text-xs whitespace-nowrap">{fmt(f.created_at)}</Td>
                  <Td className="text-xs">{f.task ? <Link to="/tasks" className="text-blue-600 dark:text-blue-400 hover:underline">#{f.task.id}</Link> : '–'}{f.task && <span className="block text-[10px] text-gray-500">{f.task.status}{f.task.due_date ? ` · ${fmt(f.task.due_date)}` : ''}</span>}</Td>
                </tr>
              ))}
              {flags.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-slate-400">{t('risks:monitoring.listEmpty')}</td></tr>}
            </Tbody>
          </Table>
          <p className="px-4 py-2 text-[11px] text-gray-500 dark:text-slate-400">{t('risks:monitoring.listHint')}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold dark:text-white">{t('risks:monitoring.trendTitle')}</h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('risks:monitoring.trendHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2 items-end">
            <Input label={t('risks:monitoring.trendFrom')} type="date" value={from} onChange={e => setFrom(e.target.value)} />
            <Input label={t('risks:monitoring.trendTo')} type="date" value={to} onChange={e => setTo(e.target.value)} />
            <Select className="w-40" value={basis} onChange={e => setBasis(e.target.value as 'residual' | 'inherent')} options={[{ value: 'residual', label: t('risks:levels3.net') }, { value: 'inherent', label: t('risks:levels3.gross') }]} />
            <Button size="sm" onClick={loadTrend}>{t('risks:monitoring.trendCompare')}</Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          {trend && (
            <>
              <div className="flex flex-wrap gap-4 text-xs dark:text-slate-300">
                <span>{t('risks:monitoring.trendCompared', { count: trend.summary.compared })}</span>
                <span className="text-emerald-700 dark:text-emerald-400">{t('risks:monitoring.trendImproved', { count: trend.summary.improved })}</span>
                <span className="text-red-700 dark:text-red-400">{t('risks:monitoring.trendWorsened', { count: trend.summary.worsened })}</span>
                <span>{t('risks:monitoring.trendUnchanged', { count: trend.summary.unchanged })}</span>
                <span>{t('risks:monitoring.trendNew', { count: trend.summary.new_since })}</span>
                {trend.summary.no_data > 0 && <span className="text-gray-500">{t('risks:monitoring.trendNoData', { count: trend.summary.no_data })}</span>}
              </div>
              {scale && sameMatrix ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div><p className="text-xs font-semibold mb-1 dark:text-slate-300">{fmt(trend.from)}</p><RiskHeatmap scale={scale} counts={fromCounts} compact /></div>
                  <div><p className="text-xs font-semibold mb-1 dark:text-slate-300">{fmt(trend.to)}</p><RiskHeatmap scale={scale} counts={toCounts} compact /></div>
                </div>
              ) : <p className="text-xs text-gray-500 italic">{t('risks:monitoring.trendMatrixDiffers')}</p>}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 mb-1">{t('risks:monitoring.trendMoves')}</h3>
                  <Table>
                    <Thead><tr><Th>{t('risks:monitoring.trendFromCell')}</Th><Th>{t('risks:monitoring.trendToCell')}</Th><Th className="text-right">{t('risks:monitoring.trendCount')}</Th></tr></Thead>
                    <Tbody>
                      {trend.moves.filter(m => m.from.likelihood !== m.to.likelihood || m.from.impact !== m.to.impact).map((m, i) => (
                        <tr key={i}>
                          <Td className="text-xs">{m.from.likelihood}×{m.from.impact} <span className="text-gray-500">({lvl(m.from.level)})</span></Td>
                          <Td className="text-xs">{m.to.likelihood}×{m.to.impact} <span className="text-gray-500">({lvl(m.to.level)})</span></Td>
                          <Td className="text-xs text-right font-semibold">{m.count}</Td>
                        </tr>
                      ))}
                      {trend.moves.every(m => m.from.likelihood === m.to.likelihood && m.from.impact === m.to.impact) && <tr><td colSpan={3} className="px-3 py-4 text-xs text-gray-500 text-center">{t('risks:monitoring.trendNoMoves')}</td></tr>}
                    </Tbody>
                  </Table>
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 mb-1">{t('risks:monitoring.trendLevels')}</h3>
                  <Table>
                    <Thead><tr><Th>{t('risks:monitoring.trendFromLevel')}</Th><Th>{t('risks:monitoring.trendToLevel')}</Th><Th className="text-right">{t('risks:monitoring.trendCount')}</Th></tr></Thead>
                    <Tbody>
                      {trend.level_transitions.map((x, i) => (
                        <tr key={i}>
                          <Td className="text-xs">{x.from_level ? <Badge value={x.from_level} label={lvl(x.from_level)} /> : '–'}</Td>
                          <Td className="text-xs">{x.to_level ? <Badge value={x.to_level} label={lvl(x.to_level)} /> : '–'}</Td>
                          <Td className="text-xs text-right font-semibold">{x.count}</Td>
                        </tr>
                      ))}
                      {trend.level_transitions.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-xs text-gray-500 text-center">{t('risks:monitoring.trendNoMoves')}</td></tr>}
                    </Tbody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
