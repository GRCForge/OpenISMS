import React, { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, AlertTriangle, Loader2, RefreshCw, Trash2, CheckCircle, Quote } from 'lucide-react';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { Modal } from './ui/Modal';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';

interface DocumentAnalysisModalProps {
  open: boolean;
  onClose: () => void;
  subjectType: 'document' | 'policy';
  subjectId: number;
  subjectTitle: string;
}

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  gap: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
};
const riskColors: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-orange-600 dark:text-orange-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-green-600 dark:text-green-400',
};
const coverageColors: Record<string, string> = {
  met: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  missing: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  na: 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400',
};

// Locates `quote` inside `text`, tolerating whitespace differences that PDF
// extraction commonly introduces (hard line breaks mid-sentence). Returns the
// match window in the ORIGINAL (non-collapsed) string, or null if not found.
function findQuoteRange(text: string, quote: string): { start: number; end: number } | null {
  if (!quote) return null;
  const direct = text.indexOf(quote);
  if (direct !== -1) return { start: direct, end: direct + quote.length };

  // Collapse whitespace runs to a single space, keeping an offset map from the
  // collapsed string back to the original so a match can be sliced correctly.
  const collapse = (s: string) => {
    let out = '';
    const map: number[] = [];
    let inWs = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        if (!inWs) { out += ' '; map.push(i); inWs = true; }
      } else {
        out += ch; map.push(i); inWs = false;
      }
    }
    return { collapsed: out, map };
  };

  const { collapsed: cText, map: textMap } = collapse(text);
  const { collapsed: cQuote } = collapse(quote);
  if (!cQuote) return null;
  const idx = cText.indexOf(cQuote);
  if (idx === -1) return null;
  const start = textMap[idx];
  const endIdx = idx + cQuote.length - 1;
  const end = (textMap[endIdx] ?? textMap[textMap.length - 1]) + 1;
  return { start, end };
}

export const DocumentAnalysisModal: React.FC<DocumentAnalysisModalProps> = ({ open, onClose, subjectType, subjectId, subjectTitle }) => {
  const { t, i18n } = useTranslation(['documentanalysis']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;
  const { user } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();

  const ANALYSIS_ROLES = ['admin', 'assessor', 'it-staff', 'dpo'];
  const canRun = can('document_analysis', 'run', ANALYSIS_ROLES.includes(user?.role || ''));

  const basePath = `/${subjectType === 'document' ? 'documents' : 'policies'}/${subjectId}/analyze`;

  const [runs, setRuns] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { label: string }>>({});
  const [docType, setDocType] = useState('other');
  const [starting, setStarting] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [activeRun, setActiveRun] = useState<any | null>(null);
  // Selected evidence quote driving the text-panel highlight — can come from a
  // finding OR a coverage entry (coverage entries carry a quote too, so
  // mandatory/met/partial requirements can show what triggered them, not just
  // findings). `id` disambiguates which row is currently active for styling.
  const [selectedEvidence, setSelectedEvidence] = useState<{ id: string; quote: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const highlightRef = useRef<HTMLElement | null>(null);

  const loadRuns = () => api.get(basePath).then(r => setRuns(r.data)).catch(() => setRuns([]));

  useEffect(() => {
    if (!open) return;
    loadRuns();
    api.get('/triage-profiles').then(r => setProfiles(r.data || {})).catch(() => setProfiles({}));
    setExpandedRunId(null);
    setActiveRun(null);
    setSelectedEvidence(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subjectType, subjectId]);

  useEffect(() => {
    const hasPending = runs.some(r => r.status === 'running' || r.status === 'pending');
    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(loadRuns, 4000);
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  useEffect(() => {
    if (selectedEvidence && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [selectedEvidence, activeRun]);

  const handleClose = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    onClose();
  };

  const startAnalysis = async () => {
    setStarting(true);
    try {
      await api.post(basePath, { doc_type: docType });
      toast.success(t('documentanalysis:analysis_started'));
      loadRuns();
    } catch (err: any) {
      const msg = err?.response?.data?.error || '';
      if (/api key|not configured/i.test(msg)) toast.error(t('documentanalysis:llm_not_configured'));
      else toast.error(t('documentanalysis:analysis_error'));
    } finally { setStarting(false); }
  };

  const retryRun = async (runId: number) => {
    try {
      await api.post(`${basePath}/${runId}/retry`);
      toast.success(t('documentanalysis:analysis_started'));
      loadRuns();
    } catch { toast.error(t('documentanalysis:analysis_error')); }
  };

  const deleteRun = async (runId: number) => {
    if (!confirm(t('documentanalysis:delete_confirm'))) return;
    try {
      await api.delete(`${basePath}/${runId}`);
      setRuns(rs => rs.filter(r => r.id !== runId));
      if (activeRun?.id === runId) setActiveRun(null);
    } catch { toast.error(t('documentanalysis:analysis_error')); }
  };

  const openRun = async (run: any) => {
    if (run.status !== 'done') {
      setExpandedRunId(expandedRunId === run.id ? null : run.id);
      return;
    }
    setSelectedEvidence(null);
    try {
      const r = await api.get(`${basePath}/${run.id}`);
      setActiveRun(r.data);
      setExpandedRunId(run.id);
    } catch { toast.error(t('documentanalysis:analysis_error')); }
  };

  const renderTextPanel = () => {
    const text: string = activeRun?.extracted_text || '';
    if (!selectedEvidence?.quote) return <>{text}</>;
    const range = findQuoteRange(text, selectedEvidence.quote);
    if (!range) return <>{text}</>;
    return (
      <>
        {text.slice(0, range.start)}
        <mark ref={highlightRef} className="bg-yellow-300 dark:bg-yellow-500/60 text-inherit rounded px-0.5">
          {text.slice(range.start, range.end)}
        </mark>
        {text.slice(range.end)}
      </>
    );
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('documentanalysis:title', { name: subjectTitle })} size="2xl">
      <div className="space-y-6">
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('documentanalysis:description')}</p>

        {canRun && (
          <div className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label={t('documentanalysis:doc_type_label')}
                value={docType}
                onChange={e => setDocType(e.target.value)}
                options={
                  Object.keys(profiles).length > 0
                    ? Object.entries(profiles).map(([key, p]) => ({ value: key, label: p.label }))
                    : [{ value: 'other', label: 'Other' }]
                }
              />
              <div className="flex items-end justify-end">
                <Button onClick={startAnalysis} disabled={starting}>
                  {starting ? <><Loader2 size={14} className="animate-spin mr-1" />{t('documentanalysis:running')}</> : <><Bot size={14} className="mr-1" />{t('documentanalysis:start_button')}</>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeRun && activeRun.status === 'done' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[65vh]">
            <div className="flex flex-col min-h-0 border dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50 text-xs font-bold uppercase text-gray-500 dark:text-slate-400 shrink-0 flex items-center justify-between">
                <span>{t('documentanalysis:split_view_text_panel_title')}</span>
                {selectedEvidence?.quote && !findQuoteRange(activeRun.extracted_text || '', selectedEvidence.quote) && (
                  <span className="normal-case font-normal text-amber-600 dark:text-amber-400">{t('documentanalysis:quote_not_found')}</span>
                )}
              </div>
              <div className="overflow-y-auto p-4 whitespace-pre-wrap font-mono text-xs leading-relaxed flex-1">
                {renderTextPanel()}
              </div>
            </div>
            <div className="flex flex-col min-h-0 border dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50 text-xs font-bold uppercase text-gray-500 dark:text-slate-400 shrink-0 flex items-center justify-between">
                <span>{t('documentanalysis:split_view_analysis_panel_title')}</span>
                {activeRun.risk_level && <span className={`text-xs font-semibold ${riskColors[activeRun.risk_level] || ''}`}>{t(`documentanalysis:riskLevels.${activeRun.risk_level}`)}</span>}
              </div>
              <div className="overflow-y-auto p-4 space-y-4 flex-1">
                {activeRun.summary && <p className="text-sm text-gray-700 dark:text-slate-300 italic">{activeRun.summary}</p>}
                {activeRun.truncated && <p className="text-xs text-amber-600 dark:text-amber-400">{t('documentanalysis:truncated_warning')}</p>}
                {Array.isArray(activeRun.coverage) && activeRun.coverage.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('documentanalysis:coverage_title')}</h4>
                    <div className="rounded-lg border dark:border-slate-700 divide-y dark:divide-slate-800">
                      {activeRun.coverage.map((c: any) => {
                        const evidenceId = `coverage-${c.ref}`;
                        const isActive = selectedEvidence?.id === evidenceId;
                        const Wrapper: any = c.quote ? 'button' : 'div';
                        return (
                          <Wrapper
                            key={c.ref}
                            {...(c.quote ? { onClick: () => setSelectedEvidence(isActive ? null : { id: evidenceId, quote: c.quote }) } : {})}
                            className={`w-full flex items-start gap-3 p-2.5 text-left transition-colors ${c.quote ? 'cursor-pointer' : ''} ${isActive ? 'bg-blue-50 dark:bg-blue-900/20' : c.quote ? 'hover:bg-gray-50 dark:hover:bg-slate-800/50' : ''}`}
                          >
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${coverageColors[c.status] || ''}`}>
                              {t(`documentanalysis:coverage_status.${c.status}`)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold dark:text-slate-200">{c.ref}</span>
                                {c.mandatory && <span className="text-[9px] uppercase text-gray-400">{t('documentanalysis:mandatory')}</span>}
                                {c.quote && <Quote size={10} className={isActive ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'} />}
                              </div>
                              <p className="text-[11px] text-gray-500 dark:text-slate-400">{c.requirement}</p>
                              {c.note && <p className="text-[11px] text-gray-400 dark:text-slate-500 italic mt-0.5">{c.note}</p>}
                            </div>
                          </Wrapper>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('documentanalysis:findings')}</h4>
                  {!activeRun.findings?.length ? (
                    <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle size={14} />{t('documentanalysis:no_findings')}</p>
                  ) : (
                    <div className="space-y-2">
                      {activeRun.findings.map((f: any) => {
                        const evidenceId = `finding-${f.id}`;
                        const isActive = selectedEvidence?.id === evidenceId;
                        return (
                          <button
                            key={f.id}
                            disabled={!f.quote}
                            onClick={() => f.quote && setSelectedEvidence(isActive ? null : { id: evidenceId, quote: f.quote })}
                            className={`w-full text-left rounded-lg border overflow-hidden transition-colors ${!f.quote ? 'cursor-default dark:border-slate-700' : isActive ? 'border-blue-400 dark:border-blue-500 ring-1 ring-blue-400' : 'dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}
                          >
                            <div className="p-3 flex items-start gap-3">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${severityColors[f.severity] || ''}`}>
                                {t(`documentanalysis:finding_${f.severity}`)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold dark:text-white">{f.finding_ref} — {f.title}</span>
                                  {f.control_ref && <span className="text-[10px] text-gray-500 dark:text-slate-400">{f.control_ref}</span>}
                                  {f.quote && <Quote size={10} className={isActive ? 'text-blue-500' : 'text-gray-400 dark:text-slate-500'} />}
                                </div>
                                {f.description && <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">{f.description}</p>}
                                {f.remediation && (
                                  <div className="mt-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-800 dark:text-blue-300">
                                    <span className="font-semibold">{t('documentanalysis:remediation_label')}:</span> {f.remediation}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-bold dark:text-white">{t('documentanalysis:past_runs')}</h3>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6 border border-dashed dark:border-slate-800 rounded-xl">{t('documentanalysis:no_runs')}</p>
          ) : (
            <div className="space-y-2">
              {runs.map(run => (
                <div key={run.id} className="border dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                  <div className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          run.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                          run.status === 'running' || run.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                          {run.status === 'running' || run.status === 'pending' ? <span className="flex items-center gap-1"><Loader2 size={10} className="animate-spin" />{t(`documentanalysis:status_${run.status}`)}</span> : t(`documentanalysis:status_${run.status}`)}
                        </span>
                        {run.risk_level && <span className={`text-xs font-semibold ${riskColors[run.risk_level] || ''}`}>{t(`documentanalysis:riskLevels.${run.risk_level}`)}</span>}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {format(new Date(run.created_at), 'Pp', { locale: dateFnsLocale })}
                        {run.llm_provider && ` · ${run.llm_provider} / ${run.llm_model}`}
                        {run.triggeredBy && ` · ${t('documentanalysis:triggered_by', { name: run.triggeredBy.name })}`}
                      </p>
                      {run.status === 'error' && run.error_message && (
                        <p className="text-xs text-red-500 mt-0.5">{t('documentanalysis:error_message', { message: run.error_message })}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {run.status === 'done' && (
                        <button onClick={() => openRun(run)} title={t('documentanalysis:view_details')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 transition-colors">
                          {expandedRunId === run.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      )}
                      {run.status === 'error' && canRun && (
                        <button onClick={() => retryRun(run.id)} title={t('documentanalysis:retry')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors">
                          <RefreshCw size={14} />
                        </button>
                      )}
                      {user?.role === 'admin' && (
                        <button onClick={() => deleteRun(run.id)} title={t('documentanalysis:delete_run')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-red-600 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {run.status === 'error' && !run.error_message && (
                    <div className="px-3 pb-2 flex items-center gap-1 text-xs text-red-500"><AlertTriangle size={12} /> {t('documentanalysis:analysis_error')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
