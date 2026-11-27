import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Plus, ShieldAlert, Gauge, ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import { loadActiveScale, stepOptions } from '../../lib/riskMethodology';
import type { RiskScale } from '../../types';
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
import type { AdditionalMeasure } from './BsiCheckPanel';

// Risikoanalyse nach BSI-Standard 200-3 je Zielobjekt (3.10.0):
// Auswahl (Kap. 3), Gefaehrdungsuebersicht (Kap. 4), Einstufung (Kap. 5) und
// Konsolidierung (Kap. 7) - Uebernahme der Massnahmen in den Realisierungsplan.
// Backend: /api/bsi-grundschutz/domains/:id/risk-analysis (services/bsiRiskAnalysisService.js).

type Protection = 'normal' | 'high' | 'very_high';
type Coverage = 'unknown' | 'covered' | 'partially' | 'not_covered';
type Decision = 'auto' | 'include' | 'exclude';
type AnalysisStatus = 'open' | 'in_progress' | 'completed';
interface Ref { id: number; name: string }
interface Asset { id: number; name: string; type: string }
interface ProtectionNeed { overall: Protection | null; confidentiality: Protection | null; integrity: Protection | null; availability: Protection | null }
interface TargetRow {
  target_object_id: number; target_type: string; asset: Asset; protection_need: ProtectionNeed | null; modeling_count: number;
  reasons: string[]; decision: Decision; decision_reason: string | null; scenario_not_covered: boolean; scenario_note: string | null;
  included: boolean; status: AnalysisStatus;
  threats: { elementary_total: number; assessed: number; relevant: number; classified: number; additional: number };
}
interface Overview {
  summary: { target_objects: number; included: number; completed: number; classified_threats: number; without_protection_need: number };
  targets: TargetRow[];
}
interface RiskBrief { id: number; ref: string; title: string; likelihood: number | null; impact: number | null; inherent_level: string | null; effective_level: string | null }
interface ThreatRow {
  threat: { id: number; code: string | null; title: string; source: string; description: string | null };
  additional: boolean; relevant: boolean | null; relevance_note: string | null; coverage: Coverage; coverage_note: string | null;
  assessed_by: Ref | null; has_risk: boolean; risk: RiskBrief | null;
}
interface TargetAnalysis {
  target: { id: number; target_type: string; asset: Asset };
  protection_need: ProtectionNeed | null; reasons: string[]; decision: Decision; decision_reason: string | null;
  scenario_not_covered: boolean; scenario_note: string | null; included: boolean; status: AnalysisStatus;
  modules: { module_id: string; title: string | null }[];
  can_see_risks: boolean;
  threats: ThreatRow[];
  additional_measures: AdditionalMeasure[];
}

interface Props { domain: BsiDomain | null; canEdit: boolean }

const COVERAGES: Coverage[] = ['unknown', 'covered', 'partially', 'not_covered'];
const apiError = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;
const protectionColors: Record<Protection, string> = {
  normal: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  very_high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};
const textarea = 'bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white';

export const BsiRiskAnalysisPanel: React.FC<Props> = ({ domain, canEdit }) => {
  const { t } = useTranslation('bsigrundschutz');
  const toast = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<TargetAnalysis | null>(null);
  const [onlyRelevant, setOnlyRelevant] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scale, setScale] = useState<RiskScale | null>(null);
  const [threatOptions, setThreatOptions] = useState<{ id: number; code: string | null; title: string; source: string }[]>([]);
  // Dialogs
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionForm, setDecisionForm] = useState({ decision: 'auto' as Decision, decision_reason: '', scenario_not_covered: false, scenario_note: '', status: 'open' as AnalysisStatus });
  const [assessRow, setAssessRow] = useState<ThreatRow | null>(null);
  const [assessForm, setAssessForm] = useState({ relevant: '', relevance_note: '', coverage: 'unknown' as Coverage, coverage_note: '' });
  const [classifyRow, setClassifyRow] = useState<ThreatRow | null>(null);
  const [classifyForm, setClassifyForm] = useState({ likelihood: '', impact: '', likelihood_rationale: '', impact_rationale: '' });
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ threat_id: '', title: '', code: '', relevance_note: '' });

  const base = domain ? `/bsi-grundschutz/domains/${domain.id}` : '';
  const loadOverview = useCallback(async () => {
    if (!domain) return;
    const r = await api.get(`${base}/risk-analysis`);
    setOverview(r.data);
  }, [domain, base]);
  const loadDetail = useCallback(async (id: number) => {
    const r = await api.get(`${base}/risk-analysis/${id}`);
    setDetail(r.data);
  }, [base]);

  useEffect(() => { setSelected(null); setDetail(null); loadOverview().catch(() => setOverview(null)); }, [loadOverview]);
  useEffect(() => { if (selected != null) loadDetail(selected).catch(err => { toast.error(apiError(err, t('toast.loadError'))); setSelected(null); }); }, [selected, loadDetail, toast, t]);
  useEffect(() => { loadActiveScale().then(setScale).catch(() => setScale(null)); }, []);

  const reload = async () => { await loadOverview(); if (selected != null) await loadDetail(selected); };
  const protectionBadge = (p: Protection | null | undefined) => p
    ? <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${protectionColors[p]}`}>{t(`riskAnalysis.protection.${p}`)}</span>
    : <span className="text-xs text-gray-500 dark:text-slate-400">{t('riskAnalysis.noProtectionNeed')}</span>;

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setSaving(true);
    try { await fn(); after?.(); await reload(); } catch (err) { toast.error(apiError(err, t('toast.saveError'))); } finally { setSaving(false); }
  };

  // ── Selection decision ──────────────────────────────────────────────────
  const openDecision = (r: { decision: Decision; decision_reason: string | null; scenario_not_covered: boolean; scenario_note: string | null; status: AnalysisStatus }) => {
    setDecisionForm({ decision: r.decision, decision_reason: r.decision_reason || '', scenario_not_covered: r.scenario_not_covered, scenario_note: r.scenario_note || '', status: r.status });
    setDecisionOpen(true);
  };
  const saveDecision = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (selected == null) return;
    void run(() => api.put(`${base}/risk-analysis/${selected}`, {
      decision: decisionForm.decision,
      decision_reason: decisionForm.decision_reason || null,
      scenario_not_covered: decisionForm.scenario_not_covered,
      scenario_note: decisionForm.scenario_note || null,
      status: decisionForm.status,
    }), () => setDecisionOpen(false));
  };

  // ── Threat assessment ───────────────────────────────────────────────────
  const openAssess = (r: ThreatRow) => {
    setAssessRow(r);
    setAssessForm({ relevant: r.relevant == null ? '' : String(r.relevant), relevance_note: r.relevance_note || '', coverage: r.coverage, coverage_note: r.coverage_note || '' });
  };
  const saveAssess = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (selected == null || !assessRow) return;
    void run(() => api.put(`${base}/risk-analysis/${selected}/threats/${assessRow.threat.id}`, {
      relevant: assessForm.relevant === '' ? null : assessForm.relevant === 'true',
      relevance_note: assessForm.relevance_note || null,
      coverage: assessForm.coverage,
      coverage_note: assessForm.coverage_note || null,
    }), () => setAssessRow(null));
  };

  // ── Classification ──────────────────────────────────────────────────────
  const openClassify = (r: ThreatRow) => {
    setClassifyRow(r);
    setClassifyForm({ likelihood: r.risk?.likelihood ? String(r.risk.likelihood) : '', impact: r.risk?.impact ? String(r.risk.impact) : '', likelihood_rationale: '', impact_rationale: '' });
  };
  const saveClassify = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (selected == null || !classifyRow) return;
    void run(async () => {
      const r = await api.post(`${base}/risk-analysis/${selected}/threats/${classifyRow.threat.id}/classify`, {
        likelihood: Number(classifyForm.likelihood), impact: Number(classifyForm.impact),
        likelihood_rationale: classifyForm.likelihood_rationale, impact_rationale: classifyForm.impact_rationale,
      });
      toast.success(r.data?.created ? t('riskAnalysis.riskCreated', { ref: r.data.risk?.ref }) : t('riskAnalysis.riskUpdated', { ref: r.data?.risk?.ref }));
    }, () => setClassifyRow(null));
  };

  // ── Additional threat ───────────────────────────────────────────────────
  const openAdd = () => {
    setAddForm({ threat_id: '', title: '', code: '', relevance_note: '' });
    setAddOpen(true);
    api.get('/threats').then(r => setThreatOptions(r.data)).catch(() => setThreatOptions([]));
  };
  const saveAdd = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (selected == null) return;
    const body = addForm.threat_id
      ? { threat_id: Number(addForm.threat_id), relevance_note: addForm.relevance_note || null }
      : { title: addForm.title, code: addForm.code || undefined, relevance_note: addForm.relevance_note || null };
    void run(() => api.post(`${base}/risk-analysis/${selected}/threats`, body), () => setAddOpen(false));
  };

  // ── Realisation plan ────────────────────────────────────────────────────
  const takeOver = (m: AdditionalMeasure) => void run(() => api.post(`${base}/realization-plan/measures`, { treatment_item_id: m.treatment_item_id }));

  const threats = useMemo(() => (detail?.threats || []).filter(r => !onlyRelevant || r.relevant === true || r.has_risk), [detail, onlyRelevant]);
  const inOverview = useMemo(() => new Set((detail?.threats || []).map(r => r.threat.id)), [detail]);
  const likelihoodOptions = useMemo(() => (scale ? stepOptions(scale.likelihood_levels, scale.likelihood_unit) : []), [scale]);
  const impactOptions = useMemo(() => (scale ? stepOptions(scale.impact_levels, scale.impact_unit) : []), [scale]);

  if (!domain) return <Card><CardBody><p className="py-10 text-center text-sm text-gray-500 dark:text-slate-400">{t('check.noDomain')}</p></CardBody></Card>;

  const decisionDialog = (
    <Modal open={decisionOpen} onClose={() => setDecisionOpen(false)} title={t('riskAnalysis.decisionTitle')}>
      <form onSubmit={saveDecision} className="space-y-4">
        <Select label={t('riskAnalysis.decision')} value={decisionForm.decision} onChange={e => setDecisionForm({ ...decisionForm, decision: e.target.value as Decision })}
          options={(['auto', 'include', 'exclude'] as const).map(d => ({ value: d, label: t(`riskAnalysis.decisions.${d}`) }))} />
        {decisionForm.decision !== 'auto' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-decision-reason" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.decisionReason')} *</label>
            <textarea id="ra-decision-reason" rows={3} required className={textarea} value={decisionForm.decision_reason} onChange={e => setDecisionForm({ ...decisionForm, decision_reason: e.target.value })} />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm dark:text-slate-200">
          <input type="checkbox" checked={decisionForm.scenario_not_covered} onChange={e => setDecisionForm({ ...decisionForm, scenario_not_covered: e.target.checked })} />
          {t('riskAnalysis.reasons.scenario_not_covered')}
        </label>
        {decisionForm.scenario_not_covered && (
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-scenario-note" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.scenarioNote')} *</label>
            <textarea id="ra-scenario-note" rows={2} required className={textarea} value={decisionForm.scenario_note} onChange={e => setDecisionForm({ ...decisionForm, scenario_note: e.target.value })} />
          </div>
        )}
        <Select label={t('riskAnalysis.progress')} value={decisionForm.status} onChange={e => setDecisionForm({ ...decisionForm, status: e.target.value as AnalysisStatus })}
          options={(['open', 'in_progress', 'completed'] as const).map(s => ({ value: s, label: t(`riskAnalysis.statuses.${s}`) }))} />
        <div className="flex gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={() => setDecisionOpen(false)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
          <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>
        </div>
      </form>
    </Modal>
  );

  // ── Overview of all target objects ──────────────────────────────────────
  if (selected == null || !detail) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: t('riskAnalysis.summary.targets'), value: overview?.summary.target_objects ?? 0 },
            { label: t('riskAnalysis.summary.included'), value: overview?.summary.included ?? 0 },
            { label: t('riskAnalysis.summary.completed'), value: overview?.summary.completed ?? 0 },
            { label: t('riskAnalysis.summary.classified'), value: overview?.summary.classified_threats ?? 0 },
          ].map(s => (
            <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
              <div className="p-2.5 rounded-xl bg-blue-600 shrink-0"><ShieldAlert className="text-white" size={18} /></div>
              <div><p className="text-xl font-bold dark:text-white">{s.value}</p><p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p></div>
            </CardBody></Card>
          ))}
        </div>
        <Card><CardBody className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('riskAnalysis.intro')}</p>
          {(overview?.summary.without_protection_need || 0) > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{t('riskAnalysis.withoutProtectionNeed', { count: overview?.summary.without_protection_need })}</p>
          )}
          {(overview?.targets.length || 0) === 0
            ? <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">{t('riskAnalysis.empty')}</p>
            : (
              <Table>
                <Thead><tr><Th>{t('check.target')}</Th><Th>{t('riskAnalysis.protectionNeed')}</Th><Th>{t('riskAnalysis.reasonsTitle')}</Th><Th>{t('riskAnalysis.selected')}</Th><Th>{t('riskAnalysis.progress')}</Th><Th>{t('riskAnalysis.threatsColumn')}</Th><Th>{''}</Th></tr></Thead>
                <Tbody>
                  {overview!.targets.map(r => (
                    <tr key={r.target_object_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 align-top">
                      <Td><p className="text-sm dark:text-slate-200">{r.asset.name}</p><p className="text-xs text-gray-500 dark:text-slate-400">{r.target_type}</p></Td>
                      <Td>{protectionBadge(r.protection_need?.overall)}</Td>
                      <Td className="text-xs dark:text-slate-300">{r.reasons.length ? r.reasons.map(x => t(`riskAnalysis.reasons.${x}`)).join(', ') : '–'}</Td>
                      <Td className="text-xs dark:text-slate-300">{r.included ? t('riskAnalysis.yes') : t('riskAnalysis.no')}{r.decision !== 'auto' ? ` (${t(`riskAnalysis.decisions.${r.decision}`)})` : ''}</Td>
                      <Td className="text-xs dark:text-slate-300">{t(`riskAnalysis.statuses.${r.status}`)}</Td>
                      <Td className="text-xs dark:text-slate-300">{t('riskAnalysis.threatCounts', { assessed: r.threats.assessed, total: r.threats.elementary_total + r.threats.additional, relevant: r.threats.relevant, classified: r.threats.classified })}</Td>
                      <Td><Button variant="secondary" size="sm" onClick={() => setSelected(r.target_object_id)}>{t('riskAnalysis.open')}</Button></Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            )}
        </CardBody></Card>
      </div>
    );
  }

  // ── Threat overview of one target object ────────────────────────────────
  const d = detail;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => { setSelected(null); setDetail(null); }}><ArrowLeft size={14} />{t('riskAnalysis.back')}</Button>
        <h3 className="font-semibold dark:text-white">{d.target.asset.name}</h3>
        {protectionBadge(d.protection_need?.overall)}
        <span className="text-xs text-gray-500 dark:text-slate-400">{t(`riskAnalysis.statuses.${d.status}`)}</span>
        <div className="flex-1" />
        {canEdit && <Button variant="secondary" size="sm" onClick={() => openDecision(d)}><Pencil size={14} />{t('riskAnalysis.decisionTitle')}</Button>}
      </div>

      <Card><CardBody className="space-y-2 text-sm dark:text-slate-200">
        <p><span className="font-semibold">{t('riskAnalysis.reasonsTitle')}:</span> {d.reasons.length ? d.reasons.map(x => t(`riskAnalysis.reasons.${x}`)).join(', ') : '–'}</p>
        <p><span className="font-semibold">{t('riskAnalysis.selected')}:</span> {d.included ? t('riskAnalysis.yes') : t('riskAnalysis.no')}{d.decision !== 'auto' ? ` – ${t(`riskAnalysis.decisions.${d.decision}`)}: ${d.decision_reason || ''}` : ''}</p>
        {d.scenario_not_covered && <p><span className="font-semibold">{t('riskAnalysis.reasons.scenario_not_covered')}:</span> {d.scenario_note}</p>}
        <p><span className="font-semibold">{t('riskAnalysis.modules')}:</span> {d.modules.length ? d.modules.map(m => m.module_id).join(', ') : t('riskAnalysis.noModules')}</p>
        <p className="text-xs text-gray-500 dark:text-slate-400">{t('riskAnalysis.coverageHint')}</p>
        {!d.included && <p className="text-xs text-amber-700 dark:text-amber-400">{t('riskAnalysis.notIncludedHint')}</p>}
      </CardBody></Card>

      <Card><CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold dark:text-white">{t('riskAnalysis.threatOverview')}</h3>
          <label className="flex items-center gap-2 text-xs dark:text-slate-300">
            <input type="checkbox" checked={onlyRelevant} onChange={e => setOnlyRelevant(e.target.checked)} />{t('riskAnalysis.onlyRelevant')}
          </label>
          <div className="flex-1" />
          {canEdit && d.included && <Button variant="secondary" size="sm" onClick={openAdd}><Plus size={14} />{t('riskAnalysis.addThreat')}</Button>}
        </div>
        <Table>
          <Thead><tr><Th>{t('riskAnalysis.threat')}</Th><Th>{t('riskAnalysis.relevant')}</Th><Th>{t('riskAnalysis.coverage')}</Th><Th>{t('riskAnalysis.risk')}</Th><Th>{''}</Th></tr></Thead>
          <Tbody>
            {threats.map(r => (
              <tr key={r.threat.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 align-top">
                <Td>
                  <p className="text-sm dark:text-slate-200"><span className="font-mono text-xs text-gray-600 dark:text-slate-400">{r.threat.code}</span> {r.threat.title}</p>
                  {r.additional && <span className="text-[11px] text-blue-700 dark:text-blue-300">{t('riskAnalysis.additional')}</span>}
                  {r.relevance_note && <p className="text-xs text-gray-500 dark:text-slate-400">{r.relevance_note}</p>}
                </Td>
                <Td className="text-xs dark:text-slate-300">{r.relevant == null ? t('riskAnalysis.notAssessed') : r.relevant ? t('riskAnalysis.yes') : t('riskAnalysis.no')}</Td>
                <Td className="text-xs dark:text-slate-300">{t(`riskAnalysis.coverages.${r.coverage}`)}{r.coverage_note ? <p className="text-gray-500 dark:text-slate-400">{r.coverage_note}</p> : null}</Td>
                <Td className="text-xs dark:text-slate-300">{r.risk ? `${r.risk.ref} · ${r.risk.effective_level || r.risk.inherent_level || ''}` : r.has_risk ? t('riskAnalysis.riskHidden') : '–'}</Td>
                <Td>
                  {canEdit && d.included && (
                    <div className="flex gap-1">
                      <IconButton label={t('riskAnalysis.assess')} onClick={() => openAssess(r)}><Pencil size={14} /></IconButton>
                      {r.relevant === true && <IconButton label={t('riskAnalysis.classify')} onClick={() => openClassify(r)}><Gauge size={14} /></IconButton>}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      </CardBody></Card>

      {d.can_see_risks && (
        <Card><CardBody className="space-y-2">
          <h3 className="font-semibold dark:text-white">{t('riskAnalysis.measuresTitle')}</h3>
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('riskAnalysis.measuresHint')}</p>
          {d.additional_measures.length === 0
            ? <p className="text-sm text-gray-500 dark:text-slate-400">{t('riskAnalysis.noMeasures')}</p>
            : (
              <Table>
                <Thead><tr><Th>{t('riskAnalysis.risk')}</Th><Th>{t('riskAnalysis.measure')}</Th><Th>{t('table.status')}</Th><Th>{t('check.responsible')}</Th><Th>{t('check.dueDate')}</Th><Th>{t('riskAnalysis.inPlan')}</Th></tr></Thead>
                <Tbody>
                  {d.additional_measures.map(m => (
                    <tr key={m.treatment_item_id}>
                      <Td className="text-xs dark:text-slate-300">{m.risk_ref}</Td>
                      <Td className="text-sm dark:text-slate-200">{m.title}</Td>
                      <Td className="text-xs dark:text-slate-300">{t(`riskAnalysis.itemStatus.${m.status}`)}</Td>
                      <Td className="text-xs dark:text-slate-300">{m.responsible?.name || m.responsible_group?.name || '–'}</Td>
                      <Td className="text-xs dark:text-slate-300">{m.due_date || '–'}</Td>
                      <Td className="text-xs dark:text-slate-300">
                        {m.in_realization_plan ? t('riskAnalysis.yes') : canEdit
                          ? <Button variant="secondary" size="sm" disabled={saving} onClick={() => takeOver(m)}><ListPlus size={14} />{t('riskAnalysis.takeOver')}</Button>
                          : t('riskAnalysis.no')}
                      </Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            )}
        </CardBody></Card>
      )}

      {decisionDialog}

      <Modal open={!!assessRow} onClose={() => setAssessRow(null)} title={assessRow ? `${assessRow.threat.code || ''} ${assessRow.threat.title}` : ''}>
        <form onSubmit={saveAssess} className="space-y-4">
          {assessRow?.threat.description && <p className="text-xs text-gray-500 dark:text-slate-400">{assessRow.threat.description}</p>}
          <Select label={t('riskAnalysis.relevant')} value={assessForm.relevant} onChange={e => setAssessForm({ ...assessForm, relevant: e.target.value })}
            options={[{ value: '', label: t('riskAnalysis.notAssessed') }, { value: 'true', label: t('riskAnalysis.yes') }, { value: 'false', label: t('riskAnalysis.no') }]} />
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-relevance-note" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.relevanceNote')}</label>
            <textarea id="ra-relevance-note" rows={2} className={textarea} value={assessForm.relevance_note} onChange={e => setAssessForm({ ...assessForm, relevance_note: e.target.value })} />
          </div>
          <Select label={t('riskAnalysis.coverage')} value={assessForm.coverage} onChange={e => setAssessForm({ ...assessForm, coverage: e.target.value as Coverage })}
            options={COVERAGES.map(c => ({ value: c, label: t(`riskAnalysis.coverages.${c}`) }))} />
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-coverage-note" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.coverageNote')}</label>
            <textarea id="ra-coverage-note" rows={2} className={textarea} value={assessForm.coverage_note} onChange={e => setAssessForm({ ...assessForm, coverage_note: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAssessRow(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!classifyRow} onClose={() => setClassifyRow(null)} title={classifyRow ? t('riskAnalysis.classifyTitle', { threat: `${classifyRow.threat.code || ''} ${classifyRow.threat.title}`.trim() }) : ''}>
        <form onSubmit={saveClassify} className="space-y-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">{classifyRow?.risk ? t('riskAnalysis.classifyUpdateHint', { ref: classifyRow.risk.ref }) : t('riskAnalysis.classifyCreateHint')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select label={`${t('riskAnalysis.likelihood')} *`} value={classifyForm.likelihood} required onChange={e => setClassifyForm({ ...classifyForm, likelihood: e.target.value })}
              options={[{ value: '', label: '–' }, ...likelihoodOptions]} />
            <Select label={`${t('riskAnalysis.impact')} *`} value={classifyForm.impact} required onChange={e => setClassifyForm({ ...classifyForm, impact: e.target.value })}
              options={[{ value: '', label: '–' }, ...impactOptions]} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-likelihood-rationale" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.likelihoodRationale')} *</label>
            <textarea id="ra-likelihood-rationale" rows={2} required className={textarea} value={classifyForm.likelihood_rationale} onChange={e => setClassifyForm({ ...classifyForm, likelihood_rationale: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-impact-rationale" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.impactRationale')} *</label>
            <textarea id="ra-impact-rationale" rows={2} required className={textarea} value={classifyForm.impact_rationale} onChange={e => setClassifyForm({ ...classifyForm, impact_rationale: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setClassifyRow(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            <Button type="submit" disabled={saving || !classifyForm.likelihood || !classifyForm.impact || !classifyForm.likelihood_rationale.trim() || !classifyForm.impact_rationale.trim()} className="flex-1 justify-center">{saving ? t('modal.saving') : t('riskAnalysis.classify')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('riskAnalysis.addThreat')}>
        <form onSubmit={saveAdd} className="space-y-4">
          <SearchableSelect label={t('riskAnalysis.existingThreat')} value={addForm.threat_id} onChange={v => setAddForm({ ...addForm, threat_id: v })}
            options={[{ value: '', label: t('riskAnalysis.newThreat') }, ...threatOptions.filter(x => x.source !== 'bsi_elementar' && !inOverview.has(x.id)).map(x => ({ value: String(x.id), label: `${x.code ? `${x.code} ` : ''}${x.title}` }))]} />
          {!addForm.threat_id && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label={t('riskAnalysis.threatCode')} value={addForm.code} maxLength={20} onChange={e => setAddForm({ ...addForm, code: e.target.value })} />
              <div className="md:col-span-2"><Input label={`${t('riskAnalysis.threatTitle')} *`} value={addForm.title} required maxLength={255} onChange={e => setAddForm({ ...addForm, title: e.target.value })} /></div>
              <p className="md:col-span-3 text-xs text-gray-500 dark:text-slate-400">{t('riskAnalysis.newThreatHint')}</p>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="ra-add-note" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('riskAnalysis.relevanceNote')}</label>
            <textarea id="ra-add-note" rows={2} className={textarea} value={addForm.relevance_note} onChange={e => setAddForm({ ...addForm, relevance_note: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            <Button type="submit" disabled={saving || (!addForm.threat_id && !addForm.title.trim())} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
