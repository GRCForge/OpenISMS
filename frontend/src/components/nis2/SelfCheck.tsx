import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, Download, Upload, ListChecks, AlertTriangle, FileWarning,
  CircleHelp, ChevronDown, ChevronRight, Plus, CheckCircle2,
} from 'lucide-react';
import api from '../../lib/api';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../../contexts/ToastContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type Answer = 'not_assessed' | 'yes' | 'partly' | 'no';
type Obligation = 'required' | 'recommended' | 'not_applicable';
type GapKind = 'open' | 'partial' | 'undocumented' | 'unanswered';
type CategoryStatus = 'good' | 'improvable' | 'critical' | 'unanswered';

interface SelfCheckItem {
  id: number;
  question_ref: string;
  category: string;
  article_ref: string;
  question: string;
  recommendation?: string;
  answer_implementation: Answer;
  answer_evidence: Answer;
  evidence_source?: string;
  notes?: string;
  answered_at?: string | null;
  answeredBy?: { id: number; name: string };
  task?: { id: number; title: string; status: string } | null;
  task_id?: number | null;
  obligation: Obligation;
  sort_order: number;
  custom?: boolean;
}

interface CategoryStat {
  total: number; answered: number; unanswered: number; gaps: number;
  rate: number; maturity: number | null; status: CategoryStatus;
}

interface ArticleStat {
  article_ref: string;
  questions: number;
  answered: number;
  rate: number | null;
  gaps: { question_ref: string; kind: GapKind }[];
  measure_status: string | null;
  measure_title: string | null;
}

interface Gap {
  id: number; question_ref: string; category: string; article_ref: string;
  question: string; recommendation?: string; kind: GapKind; task_id: number | null;
}

interface SelfCheckStats {
  total: number; applicable: number; required: number; recommended: number;
  excluded_by_profile: number; answered: number; unanswered: number;
  completion: number; rate: number; maturity: number | null; status: CategoryStatus;
  gap_counts: Record<GapKind, number>;
  by_category: Record<string, CategoryStat>;
  by_article: Record<string, ArticleStat>;
  gaps: Gap[];
}

const ANSWERS: Answer[] = ['not_assessed', 'yes', 'partly', 'no'];

const ANSWER_STYLE: Record<Answer, string> = {
  not_assessed: 'border-gray-400 dark:border-slate-600',
  yes: 'border-green-600 dark:border-green-500 bg-green-50 dark:bg-green-900/20',
  partly: 'border-yellow-600 dark:border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20',
  no: 'border-red-600 dark:border-red-500 bg-red-50 dark:bg-red-900/20',
};

const STATUS_STYLE: Record<CategoryStatus, string> = {
  good: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  improvable: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  unanswered: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

const GAP_STYLE: Record<GapKind, string> = {
  open: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  partial: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  undocumented: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  unanswered: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

/**
 * Antwortsatz aus Text lesen.
 *
 * Akzeptiert Semikolon, Tabulator oder Komma als Trenner und die
 * deutschsprachigen Antworten aus einem externen Bericht ("Ja", "Teilweise",
 * "Nein") — von dort kommen die Antworten, die hier landen sollen. Eine
 * Kopfzeile wird erkannt und uebersprungen; alles andere Unlesbare wird
 * gezaehlt und angezeigt, statt still zu verschwinden.
 */
const ANSWER_WORDS: Record<string, Answer> = {
  ja: 'yes', yes: 'yes', y: 'yes',
  teilweise: 'partly', teils: 'partly', partly: 'partly', partial: 'partly',
  nein: 'no', no: 'no', n: 'no',
  '': 'not_assessed', not_assessed: 'not_assessed', offen: 'not_assessed', '-': 'not_assessed',
};

interface ParsedRow {
  question_ref: string;
  answer_implementation?: Answer;
  answer_evidence?: Answer;
  evidence_source?: string;
}

export const parseSelfCheckImport = (text: string): { rows: ParsedRow[]; bad: string[] } => {
  const rows: ParsedRow[] = [];
  const bad: string[] = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/[;\t,]/).map(c => c.trim().replace(/^"|"$/g, ''));
    const ref = cells[0] ?? '';
    if (!/^q\d+$/i.test(ref)) {
      if (!/^(frage|question)/i.test(ref)) bad.push(line.slice(0, 60));
      continue;
    }
    const impl = ANSWER_WORDS[(cells[1] ?? '').toLowerCase()];
    const evid = ANSWER_WORDS[(cells[2] ?? '').toLowerCase()];
    if (impl === undefined && evid === undefined) { bad.push(line.slice(0, 60)); continue; }
    rows.push({
      question_ref: ref.toLowerCase(),
      ...(impl !== undefined ? { answer_implementation: impl } : {}),
      ...(evid !== undefined ? { answer_evidence: evid } : {}),
      ...(cells[3] ? { evidence_source: cells[3] } : {}),
    });
  }
  return { rows, bad };
};

// ─── Komponente ───────────────────────────────────────────────────────────────

interface Props {
  canEdit: boolean;
  canManage: boolean;
  /** Der Kriterienkatalog haengt an denselben Artikeln — nach dem Antworten neu laden. */
  onAnswered?: () => void;
}

export const SelfCheck: React.FC<Props> = ({ canEdit, canManage, onAnswered }) => {
  const { t } = useTranslation('nis2');
  const toast = useToast();

  const [items, setItems] = useState<SelfCheckItem[]>([]);
  const [stats, setStats] = useState<SelfCheckStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'questionnaire' | 'gaps' | 'coverage'>('questionnaire');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const load = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([
        api.get('/nis2/self-check'),
        api.get('/nis2/self-check/stats'),
      ]);
      setItems(i.data);
      setStats(s.data);
    } catch (e) {
      toast.error(errorText(e, t('selfCheck.errors.load')));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setBusy(true);
    try {
      const r = await api.post('/nis2/self-check/seed');
      toast.success(t('selfCheck.seeded', { count: r.data.count }));
      await load();
    } catch (e) { toast.error(errorText(e, t('selfCheck.errors.seed'))); }
    finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.post('/nis2/self-check/sync-catalog');
      toast.success(r.data.added > 0 ? t('selfCheck.synced', { count: r.data.added }) : t('selfCheck.syncedNone'));
      if (r.data.added > 0) await load();
    } catch (e) { toast.error(errorText(e, t('selfCheck.errors.seed'))); }
    finally { setBusy(false); }
  };

  // Jede Antwort wird sofort gespeichert. Ein Fragebogen mit 37 Fragen und
  // einem Speichern-Knopf am Ende verliert frueher oder spaeter eine Sitzung.
  const answer = async (item: SelfCheckItem, field: 'answer_implementation' | 'answer_evidence', value: Answer) => {
    const previous = items;
    setItems(list => list.map(i => (i.id === item.id ? { ...i, [field]: value } : i)));
    try {
      await api.put(`/nis2/self-check/${item.id}`, { [field]: value });
      const s = await api.get('/nis2/self-check/stats');
      setStats(s.data);
      onAnswered?.();
    } catch (e) {
      setItems(previous);   // sonst zeigt die Oberflaeche etwas an, das nicht gespeichert ist
      toast.error(errorText(e, t('selfCheck.errors.save')));
    }
  };

  const saveField = async (item: SelfCheckItem, field: 'evidence_source' | 'notes', value: string) => {
    if ((item[field] ?? '') === value) return;
    try {
      await api.put(`/nis2/self-check/${item.id}`, { [field]: value });
      setItems(list => list.map(i => (i.id === item.id ? { ...i, [field]: value } : i)));
    } catch (e) { toast.error(errorText(e, t('selfCheck.errors.save'))); }
  };

  const createTask = async (target: { id: number }) => {
    setBusy(true);
    try {
      await api.post(`/nis2/self-check/${target.id}/to-task`);
      toast.success(t('selfCheck.taskCreated'));
      await load();
    } catch (e) { toast.error(errorText(e, t('selfCheck.errors.task'))); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const head = ['question_ref', 'category', 'article_ref', 'question', 'answer_implementation', 'answer_evidence', 'evidence_source', 'notes'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = items.map(i => [
      i.question_ref, i.category, i.article_ref, i.question,
      i.answer_implementation, i.answer_evidence, i.evidence_source ?? '', i.notes ?? '',
    ].map(esc).join(';'));
    const blob = new Blob([`﻿${head.join(';')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nis2-self-check-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importPreview = useMemo(() => parseSelfCheckImport(importText), [importText]);

  const runImport = async () => {
    const { rows } = importPreview;
    if (!rows.length) { toast.error(t('selfCheck.import.nothing')); return; }
    setBusy(true);
    try {
      const r = await api.post('/nis2/self-check/bulk-answer', { answers: rows });
      toast.success(t('selfCheck.import.done', { applied: r.data.applied }));
      if (r.data.unknown?.length) toast.error(t('selfCheck.import.unknown', { refs: r.data.unknown.join(', ') }));
      setImportOpen(false);
      setImportText('');
      await load();
      onAnswered?.();
    } catch (e) { toast.error(errorText(e, t('selfCheck.errors.save'))); }
    finally { setBusy(false); }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, SelfCheckItem[]>();
    for (const item of [...items].sort((a, b) => a.sort_order - b.sort_order)) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  const articles = useMemo(() => {
    if (!stats) return [];
    return Object.values(stats.by_article).sort((a, b) => a.article_ref.localeCompare(b.article_ref));
  }, [stats]);

  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  if (loading) return <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  if (items.length === 0) return (
    <Card><CardBody>
      <div className="py-16 text-center">
        <ClipboardList size={40} className="mx-auto mb-3 text-gray-400 dark:text-slate-600" aria-hidden="true" />
        <p className="font-medium text-gray-900 dark:text-white">{t('selfCheck.empty.title')}</p>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1 max-w-xl mx-auto">{t('selfCheck.empty.description')}</p>
        {canManage && <Button onClick={seed} disabled={busy} className="mt-4"><Download size={16} />{t('selfCheck.empty.loadButton')}</Button>}
      </div>
    </CardBody></Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card><CardBody className="py-3">
          <p className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.stats.completion')}</p>
          <p className="text-2xl font-bold dark:text-white">{stats?.completion ?? 0}%</p>
          <p className="text-[11px] text-gray-600 dark:text-slate-400">{t('selfCheck.stats.answeredOf', { answered: stats?.answered ?? 0, total: stats?.applicable ?? 0 })}</p>
        </CardBody></Card>
        <Card><CardBody className="py-3">
          <p className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.stats.rate')}</p>
          <p className="text-2xl font-bold dark:text-white">{stats?.answered ? `${stats.rate}%` : '—'}</p>
          <p className="text-[11px] text-gray-600 dark:text-slate-400">
            {stats?.maturity ? t('stats.maturity', { level: stats.maturity }) : t('selfCheck.stats.noAnswers')}
          </p>
        </CardBody></Card>
        <Card><CardBody className="py-3">
          <p className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.gap.open')}</p>
          <p className="text-2xl font-bold text-red-700 dark:text-red-400">{stats?.gap_counts.open ?? 0}</p>
          <p className="text-[11px] text-gray-600 dark:text-slate-400">{t('selfCheck.gap.openHint')}</p>
        </CardBody></Card>
        <Card><CardBody className="py-3">
          <p className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.gap.partial')}</p>
          <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{stats?.gap_counts.partial ?? 0}</p>
          <p className="text-[11px] text-gray-600 dark:text-slate-400">{t('selfCheck.gap.partialHint')}</p>
        </CardBody></Card>
        <Card><CardBody className="py-3">
          <p className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.gap.undocumented')}</p>
          <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{stats?.gap_counts.undocumented ?? 0}</p>
          <p className="text-[11px] text-gray-600 dark:text-slate-400">{t('selfCheck.gap.undocumentedHint')}</p>
        </CardBody></Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800" role="tablist">
          {(['questionnaire', 'gaps', 'coverage'] as const).map(key => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors rounded-t-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
                view === key
                  ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                  : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
              {key === 'questionnaire' ? t('selfCheck.view.questionnaire')
                : key === 'gaps' ? t('selfCheck.view.gaps', { count: stats?.gaps.length ?? 0 })
                  : t('selfCheck.view.coverage')}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button variant="secondary" onClick={() => setImportOpen(true)}><Upload size={14} />{t('selfCheck.import.button')}</Button>}
          <Button variant="secondary" onClick={exportCsv}><Download size={14} />{t('actions.export')}</Button>
          {canManage && <Button variant="secondary" onClick={sync} disabled={busy}><Plus size={14} />{t('selfCheck.sync')}</Button>}
        </div>
      </div>

      {view === 'questionnaire' && grouped.map(([category, list]) => {
        const stat = stats?.by_category[category];
        const isOpen = !collapsed.has(category);
        return (
          <Card key={category}>
            <button type="button" onClick={() => toggle(category)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50/60 dark:hover:bg-slate-800/30 transition-colors">
              {isOpen ? <ChevronDown size={16} className="text-gray-500 dark:text-gray-400 shrink-0" aria-hidden="true" />
                : <ChevronRight size={16} className="text-gray-500 dark:text-gray-400 shrink-0" aria-hidden="true" />}
              <span className="font-semibold text-sm dark:text-white">{category}</span>
              <span className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.questionCount', { count: list.length })}</span>
              {stat && (
                <span className="ml-auto flex items-center gap-2">
                  {stat.unanswered > 0 && (
                    <span className="text-[11px] text-gray-600 dark:text-slate-400">{t('selfCheck.openQuestions', { count: stat.unanswered })}</span>
                  )}
                  <span className="text-xs font-bold text-gray-700 dark:text-slate-300">{stat.answered ? `${stat.rate}%` : '—'}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[stat.status]}`}>
                    {t(`selfCheck.status.${stat.status}`)}
                  </span>
                </span>
              )}
            </button>
            {isOpen && (
              <div className="border-t dark:border-slate-800 divide-y dark:divide-slate-800">
                {list.map(item => (
                  <div key={item.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="font-mono text-[11px] text-gray-600 dark:text-slate-400 shrink-0 mt-0.5">{item.question_ref}</span>
                      <p className="text-sm dark:text-slate-200 flex-1 min-w-[16rem]">{item.question}</p>
                      <span className="font-mono text-[11px] text-gray-600 dark:text-slate-400 shrink-0 mt-0.5">{item.article_ref}</span>
                      {item.obligation === 'recommended' && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 shrink-0">
                          {t('obligation.recommended')}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">
                          {t('selfCheck.axis.implementation')}
                        </p>
                        <div className="flex gap-1.5" role="group" aria-label={`${item.question_ref} ${t('selfCheck.axis.implementation')}`}>
                          {ANSWERS.map(a => (
                            <button key={a} type="button" disabled={!canEdit}
                              onClick={() => answer(item, 'answer_implementation', a)}
                              aria-pressed={item.answer_implementation === a}
                              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
                                item.answer_implementation === a
                                  ? `${ANSWER_STYLE[a]} font-semibold text-gray-900 dark:text-white`
                                  : 'border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                              {t(`selfCheck.answer.${a}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">
                          {t('selfCheck.axis.evidence')}
                        </p>
                        <div className="flex gap-1.5" role="group" aria-label={`${item.question_ref} ${t('selfCheck.axis.evidence')}`}>
                          {ANSWERS.map(a => (
                            <button key={a} type="button" disabled={!canEdit}
                              onClick={() => answer(item, 'answer_evidence', a)}
                              aria-pressed={item.answer_evidence === a}
                              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
                                item.answer_evidence === a
                                  ? `${ANSWER_STYLE[a]} font-semibold text-gray-900 dark:text-white`
                                  : 'border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                              {t(`selfCheck.answer.${a}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor={`ev-${item.id}`} className="block text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">
                            {t('selfCheck.evidenceSource')}
                          </label>
                          <input id={`ev-${item.id}`} defaultValue={item.evidence_source ?? ''}
                            onBlur={e => saveField(item, 'evidence_source', e.target.value)}
                            placeholder={t('selfCheck.evidenceSourcePlaceholder')}
                            className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" />
                        </div>
                        <div>
                          <label htmlFor={`no-${item.id}`} className="block text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">
                            {t('modal.notes')}
                          </label>
                          <input id={`no-${item.id}`} defaultValue={item.notes ?? ''}
                            onBlur={e => saveField(item, 'notes', e.target.value)}
                            className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" />
                        </div>
                      </div>
                    )}
                    {item.task && (
                      <p className="text-xs text-gray-600 dark:text-slate-400 flex items-center gap-1">
                        <CheckCircle2 size={12} aria-hidden="true" />
                        {t('selfCheck.linkedTask')}: <a href="/tasks" className="text-blue-700 dark:text-blue-400 hover:underline">{item.task.title}</a>
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}

      {view === 'gaps' && (
        stats && stats.gaps.length > 0 ? (
          <div className="space-y-2">
            {stats.gaps.map(gap => (
              <Card key={gap.id}>
                <CardBody className="py-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${GAP_STYLE[gap.kind]}`}>
                      {t(`selfCheck.gapKind.${gap.kind}`)}
                    </span>
                    <span className="font-mono text-[11px] text-gray-600 dark:text-slate-400 shrink-0 mt-0.5">{gap.article_ref}</span>
                    <span className="text-xs text-gray-600 dark:text-slate-400 shrink-0 mt-0.5">{gap.category}</span>
                    <div className="flex-1 min-w-[18rem]">
                      <p className="text-sm dark:text-slate-200">{gap.question}</p>
                      {gap.recommendation && (
                        <p className="text-xs text-gray-700 dark:text-slate-400 mt-1">
                          <span className="font-semibold">{t('selfCheck.recommendation')}: </span>{gap.recommendation}
                        </p>
                      )}
                    </div>
                    {canEdit && (gap.task_id
                      ? <span className="text-xs text-gray-600 dark:text-slate-400 shrink-0">{t('selfCheck.taskExists')}</span>
                      : <Button variant="secondary" onClick={() => createTask(gap)} disabled={busy} className="shrink-0">
                        <ListChecks size={14} />{t('selfCheck.createTask')}
                      </Button>)}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        ) : (
          <Card><CardBody className="py-12 text-center">
            <CheckCircle2 size={36} className="mx-auto mb-3 text-green-600 dark:text-green-500" aria-hidden="true" />
            <p className="text-gray-700 dark:text-slate-300">
              {stats?.answered ? t('selfCheck.noGaps') : t('selfCheck.noGapsUnanswered')}
            </p>
          </CardBody></Card>
        )
      )}

      {view === 'coverage' && (
        <Card>
          <CardBody className="p-0">
            <p className="px-4 pt-4 text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.coverageHint')}</p>
            <div className="divide-y dark:divide-slate-800 mt-2">
              {articles.map(a => {
                const open = a.gaps.filter(g => g.kind === 'open').length;
                const partial = a.gaps.filter(g => g.kind === 'partial').length;
                const undoc = a.gaps.filter(g => g.kind === 'undocumented').length;
                return (
                  <div key={a.article_ref} className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-gray-700 dark:text-slate-300 w-32 shrink-0">{a.article_ref}</span>
                    <span className="text-sm dark:text-slate-200 flex-1 min-w-[14rem]">{a.measure_title ?? '—'}</span>
                    {a.questions === 0 ? (
                      <span className="text-xs text-gray-600 dark:text-slate-400 flex items-center gap-1">
                        <CircleHelp size={12} aria-hidden="true" />{t('selfCheck.noQuestion')}
                      </span>
                    ) : (
                      <>
                        <span className="text-xs text-gray-600 dark:text-slate-400">{t('selfCheck.answeredRatio', { answered: a.answered, total: a.questions })}</span>
                        <span className="text-sm font-bold dark:text-white w-12 text-right">{a.rate === null ? '—' : `${a.rate}%`}</span>
                      </>
                    )}
                    <span className="flex gap-1">
                      {open > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${GAP_STYLE.open}`} title={t('selfCheck.gapKind.open')}><AlertTriangle size={10} className="inline mr-0.5" aria-hidden="true" />{open}</span>}
                      {partial > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${GAP_STYLE.partial}`} title={t('selfCheck.gapKind.partial')}>{partial}</span>}
                      {undoc > 0 && <span className={`text-[11px] px-1.5 py-0.5 rounded ${GAP_STYLE.undocumented}`} title={t('selfCheck.gapKind.undocumented')}><FileWarning size={10} className="inline mr-0.5" aria-hidden="true" />{undoc}</span>}
                    </span>
                    {a.measure_status && (
                      <span className="text-[11px] text-gray-600 dark:text-slate-400 w-32 text-right">
                        {t('selfCheck.measureStatus')}: {t(`status.${a.measure_status}`)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t('selfCheck.import.title')} size="lg">
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-slate-300">{t('selfCheck.import.intro')}</p>
          <pre className="text-[11px] bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-2 overflow-x-auto text-gray-700 dark:text-slate-300">{'q1;Ja;Ja\nq2;Teilweise;Ja\nq3;Ja;Ja;Schulungsnachweis 2026'}</pre>
          <div>
            <label htmlFor="sc-import" className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">{t('selfCheck.import.label')}</label>
            <textarea id="sc-import" rows={10} value={importText} onChange={e => setImportText(e.target.value)}
              className="w-full font-mono text-xs bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg p-2.5 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" />
          </div>
          <p className="text-xs text-gray-700 dark:text-slate-400">
            {t('selfCheck.import.preview', { count: importPreview.rows.length })}
            {importPreview.bad.length > 0 && ` · ${t('selfCheck.import.skipped', { count: importPreview.bad.length })}`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImportOpen(false)}>{t('modal.cancel')}</Button>
            <Button onClick={runImport} disabled={busy || importPreview.rows.length === 0}>{t('selfCheck.import.apply')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
