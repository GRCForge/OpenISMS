import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle, Gauge, History, Plus, Trash2, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import api from '../../lib/api';
import type { Risk, RiskHistoryEntry, RiskKri, RiskLevel } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../../contexts/ToastContext';

// Risk monitoring of one risk (3.9.0, ISO 27005 clause 10): periodic review,
// open reassessment flags with reasons, assessment history (chart over time)
// and key risk indicators. Data from /risks/:id/history and /risks/:id/kris;
// flags and review dates come with the risk detail.

interface Kpi { id: number; title: string; target?: string; current_value?: string | null }

interface Props {
  risk: Risk | null;
  canEdit: boolean;
  levelLabel: (key?: string | null) => string;
  onChanged: () => void;
}

const fmtDate = (v: string | null | undefined, lang: string) => (v ? new Date(v).toLocaleDateString(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB') : '–');

export const RiskMonitoringPanel: React.FC<Props> = ({ risk, canEdit, levelLabel, onChanged }) => {
  const { t, i18n } = useTranslation('risks');
  const toast = useToast();
  const [history, setHistory] = useState<RiskHistoryEntry[]>([]);
  const [kris, setKris] = useState<RiskKri[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [kriForm, setKriForm] = useState<{ id: number | null; kpi_id: string; threshold: string; direction: 'above' | 'below'; note: string } | null>(null);
  const [showTable, setShowTable] = useState(false);
  const riskId = risk?.id;

  const loadData = () => {
    if (!riskId) return;
    api.get(`/risks/${riskId}/history`).then(r => setHistory(Array.isArray(r.data) ? r.data : [])).catch(() => setHistory([]));
    api.get(`/risks/${riskId}/kris`).then(r => setKris(Array.isArray(r.data) ? r.data : [])).catch(() => setKris([]));
  };
  useEffect(loadData, [riskId]);
  useEffect(() => {
    if (!canEdit) return;
    api.get('/compliance/kpis').then(r => setKpis(Array.isArray(r.data) ? r.data : [])).catch(() => setKpis([]));
  }, [canEdit]);

  if (!risk) return null;
  const lang = i18n.language;
  const flags = risk.openReviewFlags || [];

  const confirmReview = async () => {
    setBusy(true);
    try {
      await api.post(`/risks/${risk.id}/review`, { note });
      toast.success(t('monitoring.reviewSaved'));
      setNote('');
      loadData();
      onChanged();
    } catch (err: any) { toast.error(err.response?.data?.error || t('toast.errorSaving')); }
    finally { setBusy(false); }
  };

  const saveKri = async () => {
    if (!kriForm) return;
    const body = { kpi_id: Number(kriForm.kpi_id), threshold: kriForm.threshold, direction: kriForm.direction, note: kriForm.note || null };
    setBusy(true);
    try {
      if (kriForm.id) await api.put(`/risks/${risk.id}/kris/${kriForm.id}`, { threshold: body.threshold, direction: body.direction, note: body.note });
      else await api.post(`/risks/${risk.id}/kris`, body);
      toast.success(t('monitoring.kriSaved'));
      setKriForm(null);
      loadData();
      onChanged();
    } catch (err: any) { toast.error(err.response?.data?.error || t('toast.errorSaving')); }
    finally { setBusy(false); }
  };

  const removeKri = async (k: RiskKri) => {
    if (!confirm(t('monitoring.kriConfirmDelete', { title: k.kpi?.title || k.kpi_id }))) return;
    try { await api.delete(`/risks/${risk.id}/kris/${k.id}`); loadData(); onChanged(); } catch (err: any) { toast.error(err.response?.data?.error || t('toast.errorDelete')); }
  };

  const chartData = history.map(h => ({
    date: fmtDate(h.recorded_at, lang),
    gross: h.inherent_score,
    net: h.residual_score,
    target: h.target_score,
  }));

  return (
    <section className="md:col-span-2 p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-blue-600 dark:text-blue-400" />
        <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('monitoring.title')}</h3>
      </div>

      {/* Periodic review */}
      <div className={`p-3 rounded-lg border text-xs space-y-1 ${risk.review_overdue ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10' : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900/40'}`}>
        <p className="dark:text-slate-200">
          <span className="font-semibold">{t('monitoring.nextReview')}:</span>{' '}
          {risk.next_review_due ? fmtDate(risk.next_review_due, lang) : t('monitoring.noReviewDue')}
          {risk.next_review_due && <span className="text-gray-500 dark:text-slate-400"> ({risk.next_review_source === 'review_date' ? t('monitoring.sourceReviewDate') : t('monitoring.sourceCycle', { months: risk.review_cycle_months })})</span>}
          {risk.review_overdue && <span className="ml-2 font-semibold text-red-700 dark:text-red-400">{t('monitoring.overdue')}</span>}
        </p>
        <p className="text-gray-500 dark:text-slate-400">{t('monitoring.lastReviewed')}: {fmtDate(risk.last_reviewed_at, lang)}</p>
      </div>

      {/* Open reassessment flags */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('monitoring.flagsTitle', { count: flags.length })}</h4>
        {flags.length === 0 && <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('monitoring.noFlags')}</p>}
        {flags.map(f => (
          <div key={f.id} className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 text-xs">
            <p className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1"><AlertTriangle size={12} />{t(`monitoring.trigger.${f.trigger_type}`)}{f.occurrence_count > 1 ? ` · ${t('monitoring.occurrences', { count: f.occurrence_count })}` : ''}</p>
            <p className="text-amber-900/90 dark:text-amber-200 mt-0.5">{f.reason}</p>
            {(f.occurrences || []).length > 1 && (
              <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-900/80 dark:text-amber-200/80">
                {(f.occurrences || []).slice(1).map((o, i) => <li key={i}>{fmtDate(o.at, lang)}: {o.reason}</li>)}
              </ul>
            )}
            <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1">{t('monitoring.flaggedOn', { date: fmtDate(f.created_at, lang) })}</p>
          </div>
        ))}
        {canEdit && (
          <div className="space-y-2 pt-1">
            <textarea className="w-full bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2 text-xs dark:text-white" rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder={t('monitoring.reviewNotePlaceholder')} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={confirmReview} disabled={busy || !note.trim()}><CheckCircle size={12} />{flags.length ? t('monitoring.reviewAndResolve') : t('monitoring.confirmReview')}</Button>
              <span className="text-[11px] text-gray-500 dark:text-slate-400">{t('monitoring.reviewHint')}</span>
            </div>
          </div>
        )}
      </div>

      {/* Assessment history */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider flex items-center gap-1"><History size={12} />{t('monitoring.historyTitle', { count: history.length })}</h4>
          {history.length > 0 && <button type="button" className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline" onClick={() => setShowTable(s => !s)}>{showTable ? t('monitoring.hideEntries') : t('monitoring.showEntries')}</button>}
        </div>
        {history.length === 0 ? <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('monitoring.noHistory')}</p> : (
          <div className="h-44 bg-white dark:bg-slate-900/40 rounded-lg border dark:border-slate-700 p-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="stepAfter" dataKey="gross" name={t('levels3.gross')} stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="stepAfter" dataKey="net" name={t('levels3.net')} stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line type="stepAfter" dataKey="target" name={t('levels3.target')} stroke="#16a34a" strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {showTable && (
          <div className="max-h-56 overflow-y-auto border dark:border-slate-700 rounded-lg custom-scrollbar">
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400">
                <tr><th className="text-left p-1.5">{t('monitoring.colDate')}</th><th className="text-left p-1.5">{t('monitoring.colTrigger')}</th><th className="text-left p-1.5">{t('levels3.gross')}</th><th className="text-left p-1.5">{t('levels3.net')}</th><th className="text-left p-1.5">{t('levels3.target')}</th><th className="text-left p-1.5">{t('monitoring.colUser')}</th></tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-800">
                {[...history].reverse().map(h => (
                  <tr key={h.id} className="dark:text-slate-300" title={h.note || ''}>
                    <td className="p-1.5 whitespace-nowrap">{new Date(h.recorded_at).toLocaleString(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB')}</td>
                    <td className="p-1.5">{t(`monitoring.historyTrigger.${h.trigger}`)}{h.methodology_version ? <span className="text-gray-400"> · v{h.methodology_version}</span> : null}</td>
                    <td className="p-1.5">{h.likelihood}×{h.impact} {levelLabel(h.inherent_level as RiskLevel)}</td>
                    <td className="p-1.5">{h.residual_likelihood != null ? `${h.residual_likelihood}×${h.residual_impact} ${levelLabel(h.residual_level as RiskLevel)}${h.residual_override ? ' *' : ''}` : '–'}</td>
                    <td className="p-1.5">{h.target_likelihood != null ? `${h.target_likelihood}×${h.target_impact} ${levelLabel(h.target_level as RiskLevel)}` : '–'}</td>
                    <td className="p-1.5">{h.user?.name || h.user_name || t('monitoring.system')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* KRIs */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider flex items-center gap-1"><Gauge size={12} />{t('monitoring.kriTitle', { count: kris.length })}</h4>
          {canEdit && !kriForm && <Button type="button" size="sm" variant="secondary" onClick={() => setKriForm({ id: null, kpi_id: '', threshold: '', direction: 'above', note: '' })}><Plus size={12} />{t('monitoring.kriAdd')}</Button>}
        </div>
        {kris.length === 0 && !kriForm && <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('monitoring.kriEmpty')}</p>}
        {kris.map(k => (
          <div key={k.id} className={`flex items-start justify-between gap-2 p-2 rounded-lg border text-xs ${k.breached ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10' : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900/40'}`}>
            <div className="min-w-0">
              <p className="font-semibold dark:text-slate-200">{k.kpi?.title || `KPI #${k.kpi_id}`}</p>
              <p className="text-gray-600 dark:text-slate-400">{t(k.direction === 'below' ? 'monitoring.kriRuleBelow' : 'monitoring.kriRuleAbove', { threshold: k.threshold })} · {t('monitoring.kriLast', { value: k.last_value ?? '–', date: fmtDate(k.last_measured_at, lang) })}</p>
              {k.breached && <p className="font-semibold text-red-700 dark:text-red-400">{t('monitoring.kriBreached', { date: fmtDate(k.breached_at, lang) })}</p>}
              {k.note && <p className="text-gray-500 dark:text-slate-400">{k.note}</p>}
            </div>
            {canEdit && (
              <div className="flex gap-1 shrink-0">
                <button type="button" className="p-1 text-gray-400 hover:text-blue-600" title={t('monitoring.kriEdit')} aria-label={t('monitoring.kriEdit')} onClick={() => setKriForm({ id: k.id, kpi_id: String(k.kpi_id), threshold: String(k.threshold), direction: k.direction, note: k.note || '' })}><Pencil size={13} /></button>
                <button type="button" className="p-1 text-gray-400 hover:text-red-600" title={t('monitoring.kriRemove')} aria-label={t('monitoring.kriRemove')} onClick={() => removeKri(k)}><Trash2 size={13} /></button>
              </div>
            )}
          </div>
        ))}
        {kriForm && (
          <div className="p-3 rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900/50 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Select label={t('monitoring.kriKpi')} value={kriForm.kpi_id} disabled={!!kriForm.id} onChange={e => setKriForm({ ...kriForm, kpi_id: e.target.value })}
                options={[{ value: '', label: t('form.select') }, ...kpis.map(k => ({ value: String(k.id), label: `${k.title}${k.current_value ? ` (${k.current_value})` : ''}` }))]} />
              <Select label={t('monitoring.kriDirection')} value={kriForm.direction} onChange={e => setKriForm({ ...kriForm, direction: e.target.value as 'above' | 'below' })}
                options={[{ value: 'above', label: t('monitoring.kriAbove') }, { value: 'below', label: t('monitoring.kriBelow') }]} />
              <Input label={t('monitoring.kriThreshold')} value={kriForm.threshold} inputMode="decimal" onChange={e => setKriForm({ ...kriForm, threshold: e.target.value })} />
            </div>
            <Input placeholder={t('monitoring.kriNote')} value={kriForm.note} onChange={e => setKriForm({ ...kriForm, note: e.target.value })} />
            <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('monitoring.kriHint')}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={saveKri} disabled={busy || !kriForm.kpi_id || kriForm.threshold.trim() === ''}>{t('monitoring.kriSave')}</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setKriForm(null)}>{t('buttons.cancel')}</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
