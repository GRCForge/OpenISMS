import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Radio, RefreshCw, ExternalLink, ShieldAlert, ShieldCheck, Rss, CalendarCheck,
  AlertTriangle, ClipboardCheck, ListChecks, Plus, Pencil, Trash2, Server,
  ChevronDown, ChevronRight, Download, CircleSlash,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { IconButton } from '../components/ui/IconButton';
import { Skeleton } from '../components/ui/Skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceType = 'national_csirt' | 'authority' | 'cert' | 'vendor' | 'isac' | 'commercial' | 'news' | 'community' | 'internal';
type FeedFormat = 'none' | 'rss' | 'atom' | 'cisa_kev';
type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type Relevance = 'not_assessed' | 'not_relevant' | 'monitor' | 'relevant' | 'critical';
type AdvisoryStatus = 'new' | 'in_assessment' | 'action_required' | 'mitigated' | 'closed';

interface ThreatSource {
  id: number;
  name: string;
  type: SourceType;
  country?: string;
  url?: string;
  feed_url?: string;
  feed_format: FeedFormat;
  auto_fetch: boolean;
  review_frequency: Frequency;
  responsible_id?: number | null;
  responsible?: { id: number; name: string };
  active: boolean;
  last_reviewed_at?: string | null;
  next_review_at?: string | null;
  last_review_note?: string | null;
  last_fetch_at?: string | null;
  last_fetch_status?: string | null;
  notes?: string;
  overdue: boolean;
}

interface LinkedAsset {
  id: number;
  name: string;
  type: string;
  ThreatAdvisoryAsset?: { match_source: string; confirmed: boolean; note?: string };
}

interface Advisory {
  id: number;
  ref?: string;
  external_id?: string;
  title: string;
  summary?: string;
  url?: string;
  published_at?: string | null;
  severity: Severity;
  cve_ids?: string;
  relevance: Relevance;
  status: AdvisoryStatus;
  assessment_notes?: string;
  assessed_at?: string | null;
  assessedBy?: { id: number; name: string };
  source?: { id: number; name: string; type: SourceType };
  risk?: { id: number; ref: string; title: string } | null;
  task?: { id: number; title: string } | null;
  incident?: { id: number; title: string } | null;
  assets?: LinkedAsset[];
  ingested_via: 'manual' | 'feed';
}

interface Stats {
  monitoring: {
    sources_total: number; sources_active: number; sources_overdue: number;
    sources_with_feed: number; sources_auto_fetch: number;
    national_csirt_covered: boolean; advisories_last_30d: number; next_due: string | null;
  };
  handling: {
    advisories_total: number; assessed: number; unassessed: number; assessment_rate: number;
    action_required: number; needs_handling: number; handled: number; handling_rate: number;
    linked_risks: number; linked_tasks: number; linked_incidents: number;
  };
  overdue_sources: { id: number; name: string; next_review_at: string | null; last_reviewed_at: string | null }[];
}

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  info: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

const RELEVANCE_BADGE: Record<Relevance, string> = {
  not_assessed: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  not_relevant: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  monitor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  relevant: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_BADGE: Record<AdvisoryStatus, string> = {
  new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  in_assessment: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  action_required: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  mitigated: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  closed: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const RELEVANCES: Relevance[] = ['not_assessed', 'not_relevant', 'monitor', 'relevant', 'critical'];
const STATUSES: AdvisoryStatus[] = ['new', 'in_assessment', 'action_required', 'mitigated', 'closed'];
const SOURCE_TYPES: SourceType[] = ['national_csirt', 'authority', 'cert', 'vendor', 'isac', 'commercial', 'news', 'community', 'internal'];
const FREQUENCIES: Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly'];
const FEED_FORMATS: FeedFormat[] = ['none', 'rss', 'atom', 'cisa_kev'];

const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  try { return format(parseISO(value), 'dd.MM.yyyy'); } catch { return '—'; }
};

const errorText = (e: unknown, fallback: string) => {
  const res = (e as { response?: { data?: { error?: string } } })?.response;
  return res?.data?.error || fallback;
};

// ─── Kennzahlkachel ───────────────────────────────────────────────────────────

const Kpi: React.FC<{
  icon: React.ElementType; label: string; value: React.ReactNode;
  hint?: string; tone?: 'neutral' | 'good' | 'warn' | 'bad';
}> = ({ icon: Icon, label, value, hint, tone = 'neutral' }) => {
  const tones = {
    neutral: 'text-gray-700 dark:text-slate-200',
    good: 'text-green-700 dark:text-green-400',
    warn: 'text-orange-700 dark:text-orange-400',
    bad: 'text-red-700 dark:text-red-400',
  };
  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-xs font-medium uppercase tracking-wide">
          <Icon size={14} aria-hidden="true" /> {label}
        </div>
        <div className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</div>
        {hint && <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">{hint}</div>}
      </CardBody>
    </Card>
  );
};

// ─── Seite ────────────────────────────────────────────────────────────────────

export const ThreatIntel: React.FC = () => {
  const { t } = useTranslation('threatintel');
  const { user } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();

  const writer = hasWriteAccess(user?.role);
  const canCreate = can('threat_intel', 'create', writer);
  const canEdit = can('threat_intel', 'edit', writer);
  const canAssess = can('threat_intel', 'assess', writer);
  const canReview = can('threat_intel', 'review', writer);
  const canFetch = can('threat_intel', 'fetch', writer);
  const canSeed = can('threat_intel', 'seed', user?.role === 'admin' || user?.role === 'assessor');
  const canDelete = can('threat_intel', 'delete', user?.role === 'admin' || user?.role === 'assessor');

  const [tab, setTab] = useState<'advisories' | 'sources'>('advisories');
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<ThreatSource[]>([]);
  const [advisories, setAdvisories] = useState<Advisory[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [relevanceFilter, setRelevanceFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const [assessing, setAssessing] = useState<Advisory | null>(null);
  const [assessForm, setAssessForm] = useState<{ relevance: Relevance; status: AdvisoryStatus; assessment_notes: string }>(
    { relevance: 'relevant', status: 'in_assessment', assessment_notes: '' });

  const [editingSource, setEditingSource] = useState<Partial<ThreatSource> | null>(null);
  const [reviewing, setReviewing] = useState<ThreatSource | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const loadStats = useCallback(async () => {
    try { setStats((await api.get('/threat-intel/stats')).data); } catch { /* Kennzahlen sind Beiwerk */ }
  }, []);

  const loadSources = useCallback(async () => {
    try { setSources((await api.get('/threat-intel/sources')).data); }
    catch (e) { toast.error(errorText(e, t('errors.loadSources'))); }
  }, [toast, t]);

  const loadAdvisories = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (relevanceFilter) params.relevance = relevanceFilter;
      if (severityFilter) params.severity = severityFilter;
      if (sourceFilter) params.source_id = sourceFilter;
      const r = await api.get('/threat-intel/advisories', { params });
      setAdvisories(r.data.items ?? []);
      setTotal(r.data.total ?? 0);
    } catch (e) {
      toast.error(errorText(e, t('errors.loadAdvisories')));
    }
  }, [search, statusFilter, relevanceFilter, severityFilter, sourceFilter, toast, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadSources(), loadAdvisories()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // Bewusst nur beim Aufbau: Die Filter laden unten für sich nach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => { loadAdvisories(); }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, relevanceFilter, severityFilter, sourceFilter]);

  const activeFilters = [statusFilter, relevanceFilter, severityFilter, sourceFilter, search].filter(Boolean).length;
  const resetFilters = () => { setSearch(''); setStatusFilter(''); setRelevanceFilter(''); setSeverityFilter(''); setSourceFilter(''); };

  // ── Aktionen ───────────────────────────────────────────────────────────────

  const seedCatalog = async () => {
    setBusy(true);
    try {
      const r = await api.post('/threat-intel/sources/seed');
      toast.success(t('sources.seeded', { count: r.data.count }));
      await Promise.all([loadSources(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.seed'))); }
    finally { setBusy(false); }
  };

  const fetchSource = async (source: ThreatSource) => {
    setBusy(true);
    try {
      const r = await api.post(`/threat-intel/sources/${source.id}/fetch`);
      toast.success(t('sources.fetched', { created: r.data.created, read: r.data.read }));
      await Promise.all([loadSources(), loadAdvisories(), loadStats()]);
    } catch (e) {
      toast.error(errorText(e, t('errors.fetch')));
      await loadSources();   // last_fetch_status zeigt den Grund
    } finally { setBusy(false); }
  };

  const fetchAll = async () => {
    setBusy(true);
    try {
      const r = await api.post('/threat-intel/fetch-all');
      toast.success(t('sources.fetchedAll', { created: r.data.created, sources: r.data.sources, failed: r.data.failed }));
      await Promise.all([loadSources(), loadAdvisories(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.fetch'))); }
    finally { setBusy(false); }
  };

  const submitReview = async () => {
    if (!reviewing) return;
    setBusy(true);
    try {
      await api.post(`/threat-intel/sources/${reviewing.id}/review`, { note: reviewNote });
      toast.success(t('sources.reviewRecorded'));
      setReviewing(null); setReviewNote('');
      await Promise.all([loadSources(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.review'))); }
    finally { setBusy(false); }
  };

  const saveSource = async () => {
    if (!editingSource?.name) { toast.error(t('errors.nameRequired')); return; }
    setBusy(true);
    try {
      if (editingSource.id) await api.put(`/threat-intel/sources/${editingSource.id}`, editingSource);
      else await api.post('/threat-intel/sources', editingSource);
      toast.success(t('sources.saved'));
      setEditingSource(null);
      await Promise.all([loadSources(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.save'))); }
    finally { setBusy(false); }
  };

  const deleteSource = async (source: ThreatSource) => {
    if (!window.confirm(t('sources.confirmDelete', { name: source.name }))) return;
    setBusy(true);
    try {
      await api.delete(`/threat-intel/sources/${source.id}`);
      toast.success(t('sources.deleted'));
      await Promise.all([loadSources(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.delete'))); }
    finally { setBusy(false); }
  };

  const openAssess = (advisory: Advisory) => {
    setAssessing(advisory);
    setAssessForm({
      relevance: advisory.relevance === 'not_assessed' ? 'relevant' : advisory.relevance,
      status: advisory.status,
      assessment_notes: advisory.assessment_notes ?? '',
    });
  };

  const submitAssessment = async () => {
    if (!assessing) return;
    setBusy(true);
    try {
      await api.post(`/threat-intel/advisories/${assessing.id}/assess`, assessForm);
      toast.success(t('advisories.assessed'));
      setAssessing(null);
      await Promise.all([loadAdvisories(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.assess'))); }
    finally { setBusy(false); }
  };

  const handOver = async (advisory: Advisory, target: 'to-risk' | 'to-task') => {
    setBusy(true);
    try {
      await api.post(`/threat-intel/advisories/${advisory.id}/${target}`);
      toast.success(target === 'to-risk' ? t('advisories.riskCreated') : t('advisories.taskCreated'));
      await Promise.all([loadAdvisories(), loadStats()]);
    } catch (e) { toast.error(errorText(e, t('errors.handover'))); }
    finally { setBusy(false); }
  };

  const matchAssets = async (advisory: Advisory) => {
    setBusy(true);
    try {
      const r = await api.post(`/threat-intel/advisories/${advisory.id}/match-assets`);
      toast.success(t('advisories.matched', { added: r.data.added, matched: r.data.matched }));
      await loadAdvisories();
    } catch (e) { toast.error(errorText(e, t('errors.match'))); }
    finally { setBusy(false); }
  };

  const exportCsv = () => {
    const head = ['Ref', 'Quelle', 'Kennung', 'Titel', 'Schwere', 'Relevanz', 'Status', 'Veroeffentlicht', 'Bewertet am', 'Bewertet von', 'Risiko', 'Aufgabe', 'CVE'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = advisories.map(a => [
      a.ref, a.source?.name, a.external_id, a.title, a.severity, a.relevance, a.status,
      a.published_at ?? '', a.assessed_at ?? '', a.assessedBy?.name ?? '',
      a.risk?.ref ?? '', a.task?.id ?? '', a.cve_ids ?? '',
    ].map(esc).join(';'));
    const blob = new Blob([`﻿${head.join(';')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bedrohungslage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── Ampeln ─────────────────────────────────────────────────────────────────

  const monitoringTone = useMemo<'good' | 'warn' | 'bad'>(() => {
    if (!stats) return 'warn';
    // Ohne nationales CSIRT ist die Frage aus dem Self-Check nicht mit "ja" zu
    // beantworten, egal wie viele andere Quellen im Register stehen.
    if (!stats.monitoring.national_csirt_covered || stats.monitoring.sources_active === 0) return 'bad';
    if (stats.monitoring.sources_overdue > 0) return 'warn';
    return 'good';
  }, [stats]);

  const handlingTone = useMemo<'good' | 'warn' | 'bad'>(() => {
    if (!stats || stats.handling.advisories_total === 0) return 'warn';
    if (stats.handling.handling_rate >= 90 && stats.handling.assessment_rate >= 90) return 'good';
    if (stats.handling.assessment_rate < 50) return 'bad';
    return 'warn';
  }, [stats]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Kopf */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Radio size={22} className="text-blue-600 dark:text-blue-400" aria-hidden="true" />
            {t('title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canFetch && stats && stats.monitoring.sources_auto_fetch > 0 && (
            <Button variant="secondary" onClick={fetchAll} disabled={busy} title={t('sources.fetchAll')}>
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {t('sources.fetchAll')}
            </Button>
          )}
          <Button variant="secondary" onClick={exportCsv} title={t('actions.export')}>
            <Download size={15} /> {t('actions.export')}
          </Button>
        </div>
      </div>

      {/* Nachweisleiste: die beiden Fragen, die der NIS-2-Self-Check zu
          Art. 21(2)(a) stellt, mit der Antwort aus dem eigenen Bestand. */}
      <Card>
        <CardBody className="p-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">
            {t('evidence.heading')}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className={`rounded-lg border p-3 ${monitoringTone === 'good'
              ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
              : monitoringTone === 'warn'
                ? 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20'
                : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
              <div className="text-sm font-medium text-gray-900 dark:text-white">{t('evidence.q1')}</div>
              <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
                {t('evidence.q1Answer', {
                  active: stats?.monitoring.sources_active ?? 0,
                  overdue: stats?.monitoring.sources_overdue ?? 0,
                  recent: stats?.monitoring.advisories_last_30d ?? 0,
                })}
              </div>
              <div className="text-xs mt-1 flex items-center gap-1">
                {stats?.monitoring.national_csirt_covered
                  ? <><ShieldCheck size={13} className="text-green-700 dark:text-green-400" aria-hidden="true" /> <span className="text-green-800 dark:text-green-300">{t('evidence.csirtCovered')}</span></>
                  : <><ShieldAlert size={13} className="text-red-700 dark:text-red-400" aria-hidden="true" /> <span className="text-red-800 dark:text-red-300">{t('evidence.csirtMissing')}</span></>}
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${handlingTone === 'good'
              ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
              : handlingTone === 'warn'
                ? 'border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-900/20'
                : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}>
              <div className="text-sm font-medium text-gray-900 dark:text-white">{t('evidence.q2')}</div>
              <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
                {t('evidence.q2Answer', {
                  assessed: stats?.handling.assessment_rate ?? 0,
                  handled: stats?.handling.handled ?? 0,
                  needs: stats?.handling.needs_handling ?? 0,
                })}
              </div>
              <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">
                {t('evidence.links', {
                  risks: stats?.handling.linked_risks ?? 0,
                  tasks: stats?.handling.linked_tasks ?? 0,
                  incidents: stats?.handling.linked_incidents ?? 0,
                })}
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Kennzahlen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon={Rss} label={t('kpi.sources')} value={`${stats?.monitoring.sources_active ?? 0}`}
          hint={t('kpi.sourcesHint', { feeds: stats?.monitoring.sources_with_feed ?? 0 })} />
        <Kpi icon={CalendarCheck} label={t('kpi.overdue')} value={`${stats?.monitoring.sources_overdue ?? 0}`}
          tone={(stats?.monitoring.sources_overdue ?? 0) > 0 ? 'warn' : 'good'}
          hint={stats?.monitoring.next_due ? t('kpi.nextDue', { date: fmtDate(stats.monitoring.next_due) }) : undefined} />
        <Kpi icon={ClipboardCheck} label={t('kpi.unassessed')} value={`${stats?.handling.unassessed ?? 0}`}
          tone={(stats?.handling.unassessed ?? 0) > 0 ? 'warn' : 'good'}
          hint={t('kpi.assessmentRate', { rate: stats?.handling.assessment_rate ?? 0 })} />
        <Kpi icon={AlertTriangle} label={t('kpi.actionRequired')} value={`${stats?.handling.action_required ?? 0}`}
          tone={(stats?.handling.action_required ?? 0) > 0 ? 'bad' : 'good'}
          hint={t('kpi.handlingRate', { rate: stats?.handling.handling_rate ?? 0 })} />
      </div>

      {/* Reiter */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800" role="tablist">
        {(['advisories', 'sources'] as const).map(key => (
          <button key={key} type="button" role="tab" aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 rounded-t-md ${
              tab === key
                ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
                : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
            {key === 'advisories' ? t('tabs.advisories', { count: total }) : t('tabs.sources', { count: sources.length })}
          </button>
        ))}
      </div>

      {tab === 'advisories' && (
        <>
          <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('filter.search')}
            onReset={resetFilters} activeCount={activeFilters}>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 text-sm">
              <option value="">{t('filter.allStatus')}</option>
              {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </Select>
            <Select value={relevanceFilter} onChange={e => setRelevanceFilter(e.target.value)} className="h-9 text-sm">
              <option value="">{t('filter.allRelevance')}</option>
              {RELEVANCES.map(r => <option key={r} value={r}>{t(`relevance.${r}`)}</option>)}
            </Select>
            <Select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} className="h-9 text-sm">
              <option value="">{t('filter.allSeverity')}</option>
              {SEVERITIES.map(s => <option key={s} value={s}>{t(`severity.${s}`)}</option>)}
            </Select>
            <Select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="h-9 text-sm">
              <option value="">{t('filter.allSources')}</option>
              {sources.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </Select>
          </FilterBar>

          <Card>
            {advisories.length === 0 ? (
              <CardBody className="text-center py-10 text-gray-600 dark:text-gray-400 text-sm">
                {activeFilters > 0 ? t('advisories.emptyFiltered') : t('advisories.empty')}
              </CardBody>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th className="w-8"><span className="sr-only">{t('table.expand')}</span></Th>
                    <Th>{t('table.advisory')}</Th>
                    <Th>{t('table.source')}</Th>
                    <Th>{t('table.severity')}</Th>
                    <Th>{t('table.relevance')}</Th>
                    <Th>{t('table.status')}</Th>
                    <Th>{t('table.published')}</Th>
                    <Th className="text-right">{t('table.actions')}</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {advisories.map(a => (
                    <React.Fragment key={a.id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                        <Td>
                          <IconButton label={expanded === a.id ? t('table.collapse') : t('table.expand')}
                            onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                            {expanded === a.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </IconButton>
                        </Td>
                        <Td>
                          <div className="font-medium text-gray-900 dark:text-white line-clamp-2">{a.title}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-2 mt-0.5">
                            <span>{a.ref}</span>
                            {a.external_id && <span className="font-mono">{a.external_id}</span>}
                            {a.cve_ids && <span className="font-mono text-orange-700 dark:text-orange-400">{a.cve_ids.split(',')[0].trim()}{a.cve_ids.includes(',') ? ' …' : ''}</span>}
                            {a.url && (
                              <a href={a.url} target="_blank" rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-400 hover:underline"
                                title={t('table.openSource')}>
                                <ExternalLink size={11} aria-hidden="true" /> {t('table.open')}
                              </a>
                            )}
                          </div>
                        </Td>
                        <Td className="text-sm text-gray-700 dark:text-gray-300">{a.source?.name ?? '—'}</Td>
                        <Td><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_BADGE[a.severity]}`}>{t(`severity.${a.severity}`)}</span></Td>
                        <Td><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${RELEVANCE_BADGE[a.relevance]}`}>{t(`relevance.${a.relevance}`)}</span></Td>
                        <Td><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[a.status]}`}>{t(`status.${a.status}`)}</span></Td>
                        <Td className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDate(a.published_at)}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {canAssess && (
                              <IconButton label={t('advisories.assess')} onClick={() => openAssess(a)}><ClipboardCheck size={14} /></IconButton>
                            )}
                            {canAssess && !a.risk && (
                              <IconButton label={t('advisories.toRisk')} onClick={() => handOver(a, 'to-risk')}><ShieldAlert size={14} /></IconButton>
                            )}
                            {canAssess && !a.task && (
                              <IconButton label={t('advisories.toTask')} onClick={() => handOver(a, 'to-task')}><ListChecks size={14} /></IconButton>
                            )}
                          </div>
                        </Td>
                      </tr>
                      {expanded === a.id && (
                        <tr className="bg-gray-50 dark:bg-slate-800/40">
                          <Td colSpan={8}>
                            <div className="p-3 space-y-3 text-sm">
                              {a.summary && <p className="text-gray-700 dark:text-gray-300">{a.summary}</p>}
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">{t('detail.assessment')}</div>
                                  {a.assessed_at ? (
                                    <p className="text-gray-700 dark:text-gray-300 mt-1">
                                      {t('detail.assessedBy', { name: a.assessedBy?.name ?? '—', date: fmtDate(a.assessed_at) })}
                                      {a.assessment_notes && <><br />{a.assessment_notes}</>}
                                    </p>
                                  ) : <p className="text-gray-600 dark:text-gray-400 mt-1">{t('detail.notAssessed')}</p>}
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400">{t('detail.handover')}</div>
                                  <ul className="mt-1 space-y-0.5 text-gray-700 dark:text-gray-300">
                                    <li>{t('detail.risk')}: {a.risk ? <a className="text-blue-700 dark:text-blue-400 hover:underline" href="/risks">{a.risk.ref} — {a.risk.title}</a> : '—'}</li>
                                    <li>{t('detail.task')}: {a.task ? <a className="text-blue-700 dark:text-blue-400 hover:underline" href="/tasks">{a.task.title}</a> : '—'}</li>
                                    <li>{t('detail.incident')}: {a.incident ? a.incident.title : '—'}</li>
                                  </ul>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-400 flex items-center gap-2">
                                    {t('detail.assets')}
                                    {canEdit && (
                                      <button type="button" onClick={() => matchAssets(a)}
                                        className="text-[11px] font-medium text-blue-700 dark:text-blue-400 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 rounded">
                                        {t('detail.matchAssets')}
                                      </button>
                                    )}
                                  </div>
                                  {a.assets?.length ? (
                                    <ul className="mt-1 space-y-0.5">
                                      {a.assets.map(asset => (
                                        <li key={asset.id} className="flex items-center gap-1 text-gray-700 dark:text-gray-300">
                                          <Server size={12} aria-hidden="true" />
                                          <a className="hover:underline text-blue-700 dark:text-blue-400" href={`/assets/${asset.id}`}>{asset.name}</a>
                                          {asset.ThreatAdvisoryAsset && !asset.ThreatAdvisoryAsset.confirmed && (
                                            <span className="text-[10px] px-1 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">{t('detail.unconfirmed')}</span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <p className="text-gray-600 dark:text-gray-400 mt-1">{t('detail.noAssets')}</p>}
                                </div>
                              </div>
                            </div>
                          </Td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {tab === 'sources' && (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            {canSeed && sources.length === 0 && (
              <Button onClick={seedCatalog} disabled={busy}><Plus size={15} /> {t('sources.seed')}</Button>
            )}
            {canCreate && (
              <Button variant="secondary" onClick={() => setEditingSource({ type: 'cert', feed_format: 'none', review_frequency: 'weekly', active: true, auto_fetch: false })}>
                <Plus size={15} /> {t('sources.add')}
              </Button>
            )}
          </div>
          <Card>
            {sources.length === 0 ? (
              <CardBody className="text-center py-10 text-gray-600 dark:text-gray-400 text-sm">{t('sources.empty')}</CardBody>
            ) : (
              <Table>
                <Thead>
                  <tr>
                    <Th>{t('table.sourceName')}</Th>
                    <Th>{t('table.type')}</Th>
                    <Th>{t('table.frequency')}</Th>
                    <Th>{t('table.lastReview')}</Th>
                    <Th>{t('table.nextReview')}</Th>
                    <Th>{t('table.feed')}</Th>
                    <Th className="text-right">{t('table.actions')}</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {sources.map(s => (
                    <tr key={s.id} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors ${s.active ? '' : 'opacity-60'}`}>
                      <Td>
                        <div className="font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                          {s.name}
                          {!s.active && <CircleSlash size={12} className="text-gray-500 dark:text-gray-400" aria-label={t('sources.inactive')} />}
                        </div>
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-700 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5">
                            <ExternalLink size={10} aria-hidden="true" /> {t('table.open')}
                          </a>
                        )}
                      </Td>
                      <Td className="text-sm text-gray-700 dark:text-gray-300">
                        {t(`sourceType.${s.type}`)}
                        {s.country && <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">{s.country}</span>}
                      </Td>
                      <Td className="text-sm text-gray-700 dark:text-gray-300">{t(`frequency.${s.review_frequency}`)}</Td>
                      <Td className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtDate(s.last_reviewed_at)}</Td>
                      <Td className="text-sm whitespace-nowrap">
                        <span className={s.overdue ? 'text-red-700 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-300'}>
                          {s.last_reviewed_at ? fmtDate(s.next_review_at) : t('sources.neverReviewed')}
                        </span>
                      </Td>
                      <Td className="text-xs text-gray-700 dark:text-gray-300 max-w-[16rem]">
                        {s.feed_format === 'none' || !s.feed_url ? (
                          <span className="text-gray-600 dark:text-gray-400">{t('sources.manualOnly')}</span>
                        ) : (
                          <>
                            <span className="uppercase font-medium">{s.feed_format}</span>
                            {s.auto_fetch ? <span className="ml-1 text-green-700 dark:text-green-400">{t('sources.autoOn')}</span>
                              : <span className="ml-1 text-gray-600 dark:text-gray-400">{t('sources.autoOff')}</span>}
                            {s.last_fetch_status && (
                              <div className={`truncate ${s.last_fetch_status.startsWith('OK') ? 'text-gray-600 dark:text-gray-400' : 'text-red-700 dark:text-red-400'}`}
                                title={s.last_fetch_status}>
                                {s.last_fetch_status}
                              </div>
                            )}
                          </>
                        )}
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canReview && (
                            <IconButton label={t('sources.review')} onClick={() => { setReviewing(s); setReviewNote(''); }}><CalendarCheck size={14} /></IconButton>
                          )}
                          {canFetch && s.feed_format !== 'none' && s.feed_url && (
                            <IconButton label={t('sources.fetch')} onClick={() => fetchSource(s)}><RefreshCw size={14} /></IconButton>
                          )}
                          {canEdit && <IconButton label={t('actions.edit')} onClick={() => setEditingSource(s)}><Pencil size={14} /></IconButton>}
                          {canDelete && <IconButton label={t('actions.delete')} onClick={() => deleteSource(s)} variant="danger"><Trash2 size={14} /></IconButton>}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {/* Bewertung */}
      <Modal open={!!assessing} onClose={() => setAssessing(null)} title={t('advisories.assessTitle')}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">{assessing?.title}</p>
          <Select label={t('advisories.relevance')} value={assessForm.relevance}
            onChange={e => setAssessForm(f => ({ ...f, relevance: e.target.value as Relevance }))}>
            {RELEVANCES.filter(r => r !== 'not_assessed').map(r => <option key={r} value={r}>{t(`relevance.${r}`)}</option>)}
          </Select>
          <Select label={t('advisories.status')} value={assessForm.status}
            onChange={e => setAssessForm(f => ({ ...f, status: e.target.value as AdvisoryStatus }))}>
            {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </Select>
          <div>
            <label htmlFor="assessment-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('advisories.notes')}
            </label>
            <textarea id="assessment-notes" rows={4} value={assessForm.assessment_notes}
              onChange={e => setAssessForm(f => ({ ...f, assessment_notes: e.target.value }))}
              placeholder={t('advisories.notesPlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus-visible:outline-hidden focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setAssessing(null)}>{t('actions.cancel')}</Button>
            <Button onClick={submitAssessment} disabled={busy}>{t('actions.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Durchsicht festhalten */}
      <Modal open={!!reviewing} onClose={() => setReviewing(null)} title={t('sources.reviewTitle')}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">{t('sources.reviewIntro', { name: reviewing?.name ?? '' })}</p>
          <div>
            <label htmlFor="review-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('sources.reviewNote')}
            </label>
            <textarea id="review-note" rows={4} value={reviewNote} onChange={e => setReviewNote(e.target.value)}
              placeholder={t('sources.reviewNotePlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus-visible:outline-hidden focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setReviewing(null)}>{t('actions.cancel')}</Button>
            <Button onClick={submitReview} disabled={busy}>{t('sources.reviewSave')}</Button>
          </div>
        </div>
      </Modal>

      {/* Quelle anlegen / bearbeiten */}
      <Modal open={!!editingSource} onClose={() => setEditingSource(null)}
        title={editingSource?.id ? t('sources.editTitle') : t('sources.addTitle')}>
        <div className="space-y-3">
          <Input label={t('sources.name')} required value={editingSource?.name ?? ''}
            onChange={e => setEditingSource(s => ({ ...s, name: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('sources.type')} value={editingSource?.type ?? 'cert'}
              onChange={e => setEditingSource(s => ({ ...s, type: e.target.value as SourceType }))}>
              {SOURCE_TYPES.map(ty => <option key={ty} value={ty}>{t(`sourceType.${ty}`)}</option>)}
            </Select>
            <Input label={t('sources.country')} value={editingSource?.country ?? ''}
              onChange={e => setEditingSource(s => ({ ...s, country: e.target.value }))} />
          </div>
          <Input label={t('sources.url')} value={editingSource?.url ?? ''}
            onChange={e => setEditingSource(s => ({ ...s, url: e.target.value }))} />
          <Input label={t('sources.feedUrl')} value={editingSource?.feed_url ?? ''}
            onChange={e => setEditingSource(s => ({ ...s, feed_url: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('sources.feedFormat')} value={editingSource?.feed_format ?? 'none'}
              onChange={e => setEditingSource(s => ({ ...s, feed_format: e.target.value as FeedFormat }))}>
              {FEED_FORMATS.map(f => <option key={f} value={f}>{t(`feedFormat.${f}`)}</option>)}
            </Select>
            <Select label={t('sources.frequency')} value={editingSource?.review_frequency ?? 'weekly'}
              onChange={e => setEditingSource(s => ({ ...s, review_frequency: e.target.value as Frequency }))}>
              {FREQUENCIES.map(f => <option key={f} value={f}>{t(`frequency.${f}`)}</option>)}
            </Select>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={!!editingSource?.auto_fetch}
              onChange={e => setEditingSource(s => ({ ...s, auto_fetch: e.target.checked }))}
              className="mt-0.5 rounded border-gray-400 dark:border-slate-600" />
            <span>{t('sources.autoFetch')}<br /><span className="text-xs text-gray-600 dark:text-gray-400">{t('sources.autoFetchHint')}</span></span>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={editingSource?.active !== false}
              onChange={e => setEditingSource(s => ({ ...s, active: e.target.checked }))}
              className="rounded border-gray-400 dark:border-slate-600" />
            {t('sources.active')}
          </label>
          <div>
            <label htmlFor="source-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('sources.notes')}</label>
            <textarea id="source-notes" rows={3} value={editingSource?.notes ?? ''}
              onChange={e => setEditingSource(s => ({ ...s, notes: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus-visible:outline-hidden focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEditingSource(null)}>{t('actions.cancel')}</Button>
            <Button onClick={saveSource} disabled={busy}>{t('actions.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
