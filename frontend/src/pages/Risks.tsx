import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, ShieldAlert, Grid3x3, Trash2, AlertTriangle, CheckCircle, ShieldCheck, Download, FileSpreadsheet, ChevronRight, Search, Shield, FolderOpen, FileText, Flag, RefreshCcw, ListChecks, Hourglass, Activity, CalendarClock, Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKeyShortcut } from '../hooks/useKeyShortcut';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import i18n from '../i18n';
import api from '../lib/api';
import type { Risk, Asset, User, Threat, Control, RiskLevel, RiskTreatment, RiskStatus, Template, RiskScale, RiskCategory, Vulnerability, ImpactDimensionKey, Group } from '../types';
import { TreatmentItems } from '../components/risks/TreatmentItems';
import { AcceptanceWorkflow } from '../components/risks/AcceptanceWorkflow';
import { RiskMonitoringPanel } from '../components/risks/RiskMonitoringPanel';
import { RiskHeatmap } from '../components/risks/RiskHeatmap';
import type { HeatmapCellRef } from '../components/risks/RiskHeatmap';
import { loadActiveScale, loadScaleVersion, levelLabel, stepOptions, loadRiskCategories, categoryLabel, dimensionLabel, maxDimension } from '../lib/riskMethodology';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { exportToCSV, exportToExcel } from '../lib/export';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';
import { IconButton } from '../components/ui/IconButton';

interface ScenarioForm { asset_ids: number[]; threat_id: number | null; vulnerability_id: number | null; description: string; }

const emptyRisk = {
  title: '', description: '', category: 'it_security', owner_id: '',
  likelihood: 3, impact: 3, treatment: 'mitigate' as RiskTreatment, treatment_plan: '',
  // 3.8.0: all treatment options (the main option is always part of it)
  treatment_options: [] as RiskTreatment[],
  status: 'open' as RiskStatus, review_date: '',
  asset_ids: [] as number[], threat_ids: [] as number[],
  controls: [] as { id: number; effectiveness: number }[],
  // Neubewertung nach der aktiven Methodik (nur bei Risiken an einer aelteren Version)
  reassess: false,
  // 3.7.0: impact per dimension (maximum principle), rationale, target risk, scenarios
  impact_dimensions: {} as Partial<Record<ImpactDimensionKey, number>>,
  likelihood_rationale: '',
  impact_rationale: '',
  target_likelihood: '' as number | '',
  target_impact: '' as number | '',
  scenarios: [] as ScenarioForm[],
};

type LevelBasis = 'gross' | 'net' | 'target';

// Values of a risk on the chosen level: gross (inherent), net (current), target.
const valuesOn = (r: Risk, basis: LevelBasis): { l: number | null; i: number | null; level: RiskLevel | null } => {
  if (basis === 'net') return { l: r.residual_likelihood ?? null, i: r.residual_impact ?? null, level: r.residual_level ?? null };
  if (basis === 'target') return { l: r.target_likelihood ?? null, i: r.target_impact ?? null, level: r.target_level ?? null };
  return { l: r.likelihood, i: r.impact, level: r.inherent_level ?? null };
};

// Kennzeichen aus der Risikomethodik: Appetit ueberschritten, neu zu bewerten.
const RiskFlags: React.FC<{ r: Risk }> = ({ r }) => {
  const { t } = useTranslation('risks');
  const progress = r.treatment_progress;
  const showProgress = !!progress && progress.total > 0;
  if (!r.appetite_exceeded && !r.needs_reassessment && !r.acceptance_pending_request_id && !showProgress && !r.needs_review && !r.review_overdue && !r.kri_breached && !r.acceptance_expiring && !r.acceptance_expired) return null;
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {showProgress && (
        <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium ${progress!.overdue > 0 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          <ListChecks size={9} />{progress!.percent ?? 0} %{progress!.overdue > 0 ? ` · ${progress!.overdue} ${t('items.overdue')}` : ''}
        </span>
      )}
      {r.acceptance_pending_request_id && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          <Hourglass size={9} />{t('acceptanceFlow.pendingBadge')}
        </span>
      )}
      {r.appetite_exceeded && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" title={t('methodology.appetiteTitle', { level: r.appetite_max_level })}>
          <Flag size={9} />{t('methodology.appetiteExceeded')}
        </span>
      )}
      {r.needs_reassessment && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <RefreshCcw size={9} />{t('methodology.needsReassessmentShort', { version: r.methodology_version })}
        </span>
      )}
      {r.needs_review && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" title={(r.review_flag_types || []).map(x => t(`monitoring.trigger.${x}`)).join(', ')}>
          <Activity size={9} />{t('monitoring.badgeReview')}
        </span>
      )}
      {r.review_overdue && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          <CalendarClock size={9} />{t('monitoring.badgeOverdue')}
        </span>
      )}
      {!!r.kri_breached && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          <Gauge size={9} />{t('monitoring.badgeKri', { count: r.kri_breached })}
        </span>
      )}
      {r.acceptance_expiring && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <Hourglass size={9} />{t('monitoring.badgeAcceptanceExpiring', { days: r.acceptance_days_left })}
        </span>
      )}
      {r.acceptance_expired && (
        <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium bg-red-600 text-white">
          <Hourglass size={9} />{t('monitoring.badgeAcceptanceExpired')}
        </span>
      )}
    </span>
  );
};

export const Risks: React.FC = () => {
  const { t } = useTranslation(['risks', 'common']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  // Aktive Risikomethodik (Skalen, Stufen, Schwellen, Appetit, Akzeptanz).
  const [scale, setScale] = useState<RiskScale | null>(null);
  // Skala im Formular: die Version des bearbeiteten Risikos, bei Neubewertung die aktive.
  const [formScale, setFormScale] = useState<RiskScale | null>(null);
  const [heatCell, setHeatCell] = useState<HeatmapCellRef | null>(null);
  const [flagFilter, setFlagFilter] = useState('');

  // Bezeichnungen der Stufen aus der Methodik, ersatzweise aus der Uebersetzung.
  const levelLabels: Record<RiskLevel, string> = {
    low: levelLabel(scale, 'low', t('risks:levels.low')),
    medium: levelLabel(scale, 'medium', t('risks:levels.medium')),
    high: levelLabel(scale, 'high', t('risks:levels.high')),
    critical: levelLabel(scale, 'critical', t('risks:levels.critical')),
  };

  // Risk categories from the maintained taxonomy (/api/risks/categories).
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const categoryLabels: Record<string, string> = Object.fromEntries(categories.map(c => [c.key, categoryLabel(c)]));

  const treatmentLabels: Record<RiskTreatment, string> = {
    mitigate: t('risks:treatment.mitigate'),
    accept: t('risks:treatment.accept'),
    transfer: t('risks:treatment.transfer'),
    avoid: t('risks:treatment.avoid'),
  };

  const statusLabels: Record<RiskStatus, string> = {
    open: t('risks:status.open'),
    in_treatment: t('risks:status.in_treatment'),
    accepted: t('risks:status.accepted'),
    closed: t('risks:status.closed'),
  };

  const fwLabels: Record<string, string> = {
    iso27001: t('common:frameworks.iso27001'),
    nis2: t('common:frameworks.nis2'),
    bsi: t('common:frameworks.bsi'),
    custom: t('common:frameworks.custom'),
  };

  const { user } = useAuth();

  const { can } = usePermissions();
  const canWrite = can('risks', 'create', hasWriteAccess(user?.role));
  const canOverride = can('risks', 'override_residual', user?.role === 'admin' || user?.role === 'assessor');
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [heatBasis, setHeatBasis] = useState<LevelBasis>('gross');
  // Values the risk had when the form opened - a change makes the rationale mandatory.
  const [origValues, setOrigValues] = useState<{ likelihood: number; impact: number; dims: string } | null>(null);
  const [overrideForm, setOverrideForm] = useState<{ open: boolean; likelihood: number; impact: number; reason: string }>({ open: false, likelihood: 1, impact: 1, reason: '' });
  const toast = useToast();
  const [risks, setRisks] = useState<Risk[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [allControls, setAllControls] = useState<Control[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyRisk });
  const [saving, setSaving] = useState(false);
  const [controlSearch, setControlSearch] = useState('');
  // Detail of the risk being edited (scenarios, treatment items, acceptance requests).
  const [detail, setDetail] = useState<Risk | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [assetSearch, setAssetSearch] = useState('');
  const [threatSearch, setThreatSearch] = useState('');

  const filteredAssets = useMemo(() => {
    return assets.filter(a => a.name.toLowerCase().includes(assetSearch.toLowerCase()));
  }, [assets, assetSearch]);

  const filteredThreats = useMemo(() => {
    return threats.filter(t => t.title.toLowerCase().includes(threatSearch.toLowerCase()) || (t.code || '').toLowerCase().includes(threatSearch.toLowerCase()));
  }, [threats, threatSearch]);

  const handleDownload = async (id: number, origName: string) => {
    try {
      const response = await api.get(`/templates/${id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', origName);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t('risks:toast.downloadError'));
    }
  };

  const getFileIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return <FileSpreadsheet className="text-emerald-600 dark:text-emerald-400" size={18} />;
    if (ext === 'pdf') return <FileText className="text-rose-500" size={18} />;
    if (ext === 'docx' || ext === 'doc') return <FileText className="text-blue-600 dark:text-blue-400" size={18} />;
    if (ext === 'pptx' || ext === 'ppt') return <FileText className="text-orange-500 dark:text-orange-400" size={18} />;
    if (ext === 'zip') return <FileText className="text-amber-500 dark:text-amber-400" size={18} />;
    return <FileText className="text-slate-500" size={18} />;
  };

  const load = () => api.get('/risks').then(r => setRisks(Array.isArray(r.data) ? r.data : [])).catch(() => setRisks([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/assets').then(r => setAssets(r.data)).catch(() => setAssets([]));
    api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([]));
    api.get('/threats').then(r => setThreats(r.data)).catch(() => setThreats([]));
    api.get('/controls').then(r => setAllControls(r.data)).catch(() => setAllControls([]));
    api.get('/templates?category=risk').then(r => setTemplates(r.data)).catch(() => setTemplates([]));
    api.get('/groups').then(r => setGroups(Array.isArray(r.data) ? r.data : [])).catch(() => setGroups([]));
    loadActiveScale().then(setScale).catch(() => setScale(null));
    loadRiskCategories().then(setCategories).catch(() => setCategories([]));
    // Only roles with vulnerabilities.view get the list; others just cannot pick one.
    api.get('/vulnerabilities').then(r => setVulnerabilities(Array.isArray(r.data) ? r.data : [])).catch(() => setVulnerabilities([]));
  }, []);

  const stats = useMemo(() => {
    const total = risks.length;
    const critical = risks.filter(r => r.inherent_level === 'critical' || r.inherent_level === 'high').length;
    const inTreatment = risks.filter(r => r.status === 'in_treatment' || r.status === 'open').length;
    const accepted = risks.filter(r => r.status === 'accepted').length;
    return { total, critical, inTreatment, accepted };
  }, [risks]);

  const filtered = useMemo(() => risks.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (categoryFilter && r.category !== categoryFilter) return false;
    if (levelFilter && r.inherent_level !== levelFilter) return false;
    if (flagFilter === 'appetite' && !r.appetite_exceeded) return false;
    if (flagFilter === 'reassess' && !r.needs_reassessment) return false;
    if (flagFilter === 'review' && !r.needs_review) return false;
    if (flagFilter === 'overdue' && !r.review_overdue) return false;
    if (flagFilter === 'kri' && !r.kri_breached) return false;
    if (flagFilter === 'acceptance' && !r.acceptance_expiring && !r.acceptance_expired) return false;
    if (heatCell) {
      const v = valuesOn(r, heatBasis);
      if (r.needs_reassessment || v.l !== heatCell.likelihood || v.i !== heatCell.impact) return false;
    }
    if (search && !`${r.ref} ${r.title}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [risks, statusFilter, categoryFilter, levelFilter, flagFilter, heatCell, heatBasis, search]);

  // Heatmap zaehlt nur Risiken, die nach der aktiven Version bewertet sind -
  // Werte einer anderen Skala gehoeren nicht in diese Matrix.
  const heatCounts = useMemo(() => {
    const m = new Map<string, number>();
    risks.filter(r => !r.needs_reassessment).forEach(r => {
      const v = valuesOn(r, heatBasis);
      if (v.l == null || v.i == null) return;
      m.set(`${v.l}-${v.i}`, (m.get(`${v.l}-${v.i}`) || 0) + 1);
    });
    return m;
  }, [risks, heatBasis]);
  const reassessCount = useMemo(() => risks.filter(r => r.needs_reassessment).length, [risks]);
  const appetiteCount = useMemo(() => risks.filter(r => r.appetite_exceeded).length, [risks]);
  const monitorCounts = useMemo(() => ({
    review: risks.filter(r => r.needs_review).length,
    overdue: risks.filter(r => r.review_overdue).length,
    kri: risks.filter(r => r.kri_breached).length,
    acceptance: risks.filter(r => r.acceptance_expiring || r.acceptance_expired).length,
  }), [risks]);
  const resetFilters = () => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); setLevelFilter(''); setFlagFilter(''); setHeatCell(null); };

  const defaultCategory = () => (categories.find(c => c.key === 'it_security' && c.active) || categories.find(c => c.active))?.key || '';
  const openNew = () => {
    setEditId(null);
    setDetail(null);
    setFormScale(scale);
    setForm({ ...emptyRisk, category: defaultCategory() });
    setOrigValues(null);
    setOverrideForm({ open: false, likelihood: 1, impact: 1, reason: '' });
    setAssetSearch('');
    setThreatSearch('');
    setModalOpen(true);
  };
  const openEdit = (r: Risk) => {
    setEditId(r.id);
    // Werte gelten in der Skala der Version, nach der das Risiko bewertet ist.
    setFormScale(r.needs_reassessment ? null : scale);
    if (r.needs_reassessment && r.methodology_id) loadScaleVersion(r.methodology_id).then(setFormScale).catch(() => setFormScale(null));
    setForm({
      title: r.title, description: r.description || '', category: r.category || '',
      owner_id: r.owner_id ? String(r.owner_id) : '',
      likelihood: r.likelihood, impact: r.impact,
      treatment: r.treatment || 'mitigate', treatment_plan: r.treatment_plan || '',
      treatment_options: r.treatment_options && r.treatment_options.length ? r.treatment_options : [r.treatment || 'mitigate'],
      status: r.status, review_date: r.review_date ? r.review_date.split('T')[0] : '',
      asset_ids: (r.assets || []).map(a => a.id),
      threat_ids: (r.threats || []).map(t => t.id),
      controls: (r.controls || []).map(c => ({ id: c.id, effectiveness: (c as any).RiskControl?.effectiveness || 3 })),
      reassess: false,
      impact_dimensions: { ...(r.impact_dimensions || {}) },
      likelihood_rationale: r.likelihood_rationale || '',
      impact_rationale: r.impact_rationale || '',
      target_likelihood: r.target_likelihood ?? '',
      target_impact: r.target_impact ?? '',
      scenarios: [],
    });
    setOrigValues({ likelihood: r.likelihood, impact: r.impact, dims: JSON.stringify(r.impact_dimensions || {}) });
    setOverrideForm({ open: false, likelihood: r.residual_likelihood || 1, impact: r.residual_impact || 1, reason: '' });
    // Scenarios, treatment items and acceptance requests are only in the
    // detail view (record rights are checked there).
    setDetail(null);
    api.get(`/risks/${r.id}`).then(d => {
      setDetail(d.data || null);
      const sc = (d.data?.scenarios || []) as NonNullable<Risk['scenarios']>;
      setForm(f => ({ ...f, scenarios: sc.map(x => ({ asset_ids: (x.assets || []).map(a => a.id), threat_id: x.threat?.id ?? null, vulnerability_id: x.vulnerability?.id ?? null, description: x.description || '' })) }));
    }).catch(() => { /* list data stays usable */ });
    setAssetSearch('');
    setThreatSearch('');
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.owner_id) {
      toast.error(t('risks:form.ownerRequired'));
      return;
    }
    const dims = Object.fromEntries(Object.entries(form.impact_dimensions).filter(([, v]) => typeof v === 'number' && v > 0));
    const payload = {
      ...form,
      impact_dimensions: Object.keys(dims).length ? dims : null,
      impact: maxDimension(dims) ?? form.impact,
      target_likelihood: form.target_likelihood === '' ? null : form.target_likelihood,
      target_impact: form.target_impact === '' ? null : form.target_impact,
    };
    setSaving(true);
    try {
      if (editId) await api.put(`/risks/${editId}`, payload);
      else await api.post('/risks', payload);
      setModalOpen(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); }
    finally { setSaving(false); }
  };

  // Neubewertung: Formular auf die aktive Skala umstellen. Die Werte muessen
  // bewusst neu gewaehlt werden; gespeichert wird mit reassess, der Server
  // protokolliert den Wechsel der Version.
  const startReassess = () => {
    if (!scale) return;
    setFormScale(scale);
    const enabled = (scale.impact_dimensions || []).map(d => d.key);
    setForm(f => ({
      ...f, reassess: true,
      likelihood: Math.min(f.likelihood, scale.likelihood_size), impact: Math.min(f.impact, scale.impact_size),
      impact_dimensions: Object.fromEntries(Object.entries(f.impact_dimensions).filter(([k, v]) => enabled.includes(k as ImpactDimensionKey) && typeof v === 'number' && v <= scale.impact_size)),
      target_likelihood: '', target_impact: '',
      // A reassessment is a new assessment: the rationale is written afresh.
      likelihood_rationale: '', impact_rationale: '',
    }));
  };

  // Net risk: override with rationale, or back to the calculation.
  const saveOverride = async (override: boolean) => {
    if (!editId) return;
    try {
      await api.patch(`/risks/${editId}/residual-override`, override
        ? { override: true, residual_likelihood: overrideForm.likelihood, residual_impact: overrideForm.impact, reason: overrideForm.reason }
        : { override: false });
      setOverrideForm(o => ({ ...o, open: false, reason: '' }));
      load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorSaving')); }
  };

  const setScenario = (idx: number, patch: Partial<ScenarioForm>) => setForm(f => ({ ...f, scenarios: f.scenarios.map((sc, i) => (i === idx ? { ...sc, ...patch } : sc)) }));
  const addScenario = () => setForm(f => ({ ...f, scenarios: [...f.scenarios, { asset_ids: [], threat_id: null, vulnerability_id: null, description: '' }] }));
  const removeScenario = (idx: number) => setForm(f => ({ ...f, scenarios: f.scenarios.filter((_, i) => i !== idx) }));

  const remove = async (r: Risk) => {
    if (!confirm(t('risks:confirm.delete', { ref: r.ref || r.title }))) return;
    try { await api.delete(`/risks/${r.id}`); load(); } catch (err: any) { toast.error(err.response?.data?.error || t('risks:toast.errorDelete')); }
  };

  // After a change to treatment items or the acceptance workflow: reload the
  // detail and the register (progress, flags, status).
  const reloadDetail = () => {
    if (!editId) return;
    api.get(`/risks/${editId}`).then(d => setDetail(d.data || null)).catch(() => { /* keep the last state */ });
    load();
  };

  const revokeSignoff = async () => {
    if (!editId || !confirm(t('risks:confirm.revokeSignoff'))) return;
    try { await api.patch(`/risks/${editId}/revoke`); reloadDetail(); } catch { toast.error(t('risks:toast.errorDelete')); }
  };

  const toggleAsset = (id: number) => setForm(f => ({ ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id] }));
  const toggleThreat = (id: number) => setForm(f => ({ ...f, threat_ids: f.threat_ids.includes(id) ? f.threat_ids.filter(x => x !== id) : [...f.threat_ids, id] }));
  const toggleControl = (id: number) => setForm(f => ({ ...f, controls: f.controls.find(x => x.id === id) ? f.controls.filter(x => x.id !== id) : [...f.controls, { id, effectiveness: 3 }] }));
  const setControlEff = (id: number, val: number) => setForm(f => ({ ...f, controls: f.controls.map(x => x.id === id ? { ...x, effectiveness: val } : x) }));

  const visControls = useMemo(() => allControls.filter(c => {
    if (!controlSearch) return true;
    return `${c.code || ''} ${c.title}`.toLowerCase().includes(controlSearch.toLowerCase());
  }), [allControls, controlSearch]);

  const flattenForExport = (rows: Risk[]) => rows.map(r => ({
    [t('risks:table.ref')]: r.ref,
    [t('risks:table.risk')]: r.title,
    [t('risks:form.category')]: categoryLabels[r.category!] || r.category,
    [t('common:fields.owner')]: r.owner?.name || '',
    [t('risks:table.inherent')]: levelLabels[r.inherent_level!],
    [t('risks:form.likelihood')]: r.likelihood,
    [t('risks:form.impact')]: r.impact,
    [t('risks:assessment.likelihoodRationale')]: r.likelihood_rationale || '',
    [t('risks:assessment.impactRationale')]: r.impact_rationale || '',
    [t('risks:table.residual')]: r.residual_level ? levelLabels[r.residual_level] : '',
    [t('risks:levels3.overridden')]: r.residual_override ? t('risks:methodology.yes') : '',
    [t('risks:table.target')]: r.target_level ? levelLabels[r.target_level] : '',
    [t('risks:form.treatment')]: treatmentLabels[r.treatment || 'mitigate'],
    [t('risks:treatmentOptions.label')]: (r.treatment_options || [r.treatment || 'mitigate']).map(o => treatmentLabels[o]).join(', '),
    [t('risks:plan.sumImplemented')]: r.treatment_progress && r.treatment_progress.percent != null ? `${r.treatment_progress.percent} %` : '',
    [t('risks:table.status')]: statusLabels[r.status],
    [t('risks:form.acceptedBy', { name: '' }).trim()]: r.acceptedBy?.name || '',
    [t('risks:acceptedUntil')]: r.accepted_until ? format(new Date(r.accepted_until), 'dd.MM.yyyy', { locale: dateFnsLocale }) : '',
    [t('risks:form.nextReview')]: r.review_date ? format(new Date(r.review_date), 'dd.MM.yyyy', { locale: dateFnsLocale }) : '',
    [t('risks:methodology.versionColumn')]: r.methodology_version ?? '',
    [t('risks:methodology.appetiteExceeded')]: r.appetite_exceeded ? t('risks:methodology.yes') : '',
    [t('risks:monitoring.nextReview')]: r.next_review_due ? format(new Date(r.next_review_due), 'dd.MM.yyyy', { locale: dateFnsLocale }) : '',
    [t('risks:monitoring.badgeOverdue')]: r.review_overdue ? t('risks:methodology.yes') : '',
    [t('risks:monitoring.badgeReview')]: (r.review_flag_types || []).map(x => t(`risks:monitoring.trigger.${x}`)).join(', '),
    [t('risks:monitoring.filterKri')]: r.kri_breached ? String(r.kri_breached) : '',
  }));

  useKeyShortcut('n', openNew, { disabled: loading || editId !== null });
  useKeyShortcut('/', () => {
    (document.querySelector(`input[placeholder="${t('risks:searchPlaceholder')}"]`) as HTMLInputElement)?.focus();
  }, { disabled: loading });

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  const editingRisk = risks.find(r => r.id === editId);
  const acceptanceRule = scale?.acceptance.find(a => a.level === editingRisk?.effective_level);
  const statusOptions = Object.entries(statusLabels)
    .filter(([v]) => v !== 'accepted' || form.status === 'accepted')
    .map(([v, l]) => ({ value: v, label: l }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('risks:registerTitle')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('risks:subtitle', { count: risks.length })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/risks/treatment-plan" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700"><ListChecks size={14} />{t('risks:plan.open')}</Link>
          <Link to="/risks/monitoring" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700"><Activity size={14} />{t('risks:monitoring.open')}</Link>
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(flattenForExport(risks), `risks-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(flattenForExport(risks), `risks-${format(new Date(), 'yyyyMMdd')}`, 'Risiken')}><FileSpreadsheet size={14} />Excel</Button>
          {canWrite && <Button onClick={openNew}><Plus size={16} />{t('risks:new')}</Button>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-red-500 shrink-0"><ShieldAlert className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.critical}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.criticalHigh')}</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-orange-500 shrink-0"><AlertTriangle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.inTreatment}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.inTreatment')}</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-green-600 shrink-0"><CheckCircle className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.accepted}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.accepted')}</p></div></CardBody></Card>
        <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2.5 rounded-xl bg-blue-500 shrink-0"><Grid3x3 className="text-white" size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{stats.total}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:stats.total')}</p></div></CardBody></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
        <div className="lg:col-span-3 space-y-6">
          <Card className="space-y-4">
            <FilterBar
              search={search} onSearch={setSearch} searchPlaceholder={t('risks:searchPlaceholder')}
              activeCount={[statusFilter, categoryFilter, levelFilter, flagFilter, heatCell ? 'x' : ''].filter(Boolean).length}
              onReset={resetFilters}>
              <Select className="w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
              <Select className="w-40" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allCategories') }, ...Object.entries(categoryLabels).map(([v, l]) => ({ value: v, label: l }))]} />
              <Select className="w-40" value={levelFilter} onChange={e => setLevelFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allLevels') }, ...Object.entries(levelLabels).map(([v, l]) => ({ value: v, label: l }))]} />
              <Select className="w-48" value={flagFilter} onChange={e => setFlagFilter(e.target.value)} options={[{ value: '', label: t('risks:filters.allFlags') }, { value: 'appetite', label: `${t('risks:methodology.appetiteExceeded')} (${appetiteCount})` }, { value: 'reassess', label: `${t('risks:methodology.needsReassessment')} (${reassessCount})` }, { value: 'review', label: `${t('risks:monitoring.filterReview')} (${monitorCounts.review})` }, { value: 'overdue', label: `${t('risks:monitoring.filterOverdue')} (${monitorCounts.overdue})` }, { value: 'kri', label: `${t('risks:monitoring.filterKri')} (${monitorCounts.kri})` }, { value: 'acceptance', label: `${t('risks:monitoring.filterAcceptance')} (${monitorCounts.acceptance})` }]} />
            </FilterBar>

            <Card className="!border-0 shadow-none">
              <CardBody className="p-0">
                {/* Mobile card list (< sm) */}
                <div className="sm:hidden">
                  {filtered.length === 0 && risks.length === 0 ? (
                    <div className="py-12 text-center px-6">
                      <p className="text-gray-500 dark:text-slate-400 font-medium">{t('risks:empty.title')}</p>
                      <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 mb-4">{t('risks:empty.subtitle')}</p>
                      {canWrite && (
                        <button onClick={openNew}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                          <Plus size={15} />{t('risks:empty.createFirst')}
                        </button>
                      )}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="py-12 text-center px-6">
                      <p className="text-gray-500 dark:text-slate-400">{t('risks:noFilter')}</p>
                      <button onClick={resetFilters}
                        className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                        {t('common:actions.reset')}
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y dark:divide-slate-800/50">
                      {filtered.map(r => (
                        <div key={r.id}
                          className="px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                          onClick={() => openEdit(r)}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-[10px] text-gray-500 dark:text-slate-400">{r.ref}</p>
                              <p className="text-sm font-medium dark:text-slate-200 mt-0.5 leading-snug">{r.title}</p>
                              <p className="text-[11px] text-gray-500 mt-0.5 dark:text-gray-400">{categoryLabels[r.category!] || r.category}</p>
                              <RiskFlags r={r} />
                            </div>
                            {canWrite && (
                              <IconButton label={t('common:actions.delete')} variant="danger" onClick={e => { e.stopPropagation(); remove(r); }}><Trash2 size={14} /></IconButton>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            <Badge value={r.inherent_level!} label={levelLabels[r.inherent_level!]} />
                            {r.residual_level && (
                              <>
                                <ChevronRight size={12} className="text-gray-300" />
                                <Badge value={r.residual_level} label={levelLabels[r.residual_level]} />
                              </>
                            )}
                            <span className="text-[10px] text-gray-500 dark:text-slate-400 ml-auto">{statusLabels[r.status]}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Desktop table (sm+) */}
                <div className="hidden sm:block">
                  <Table>
                    <Thead><tr><Th>{t('risks:table.ref')}</Th><Th>{t('risks:table.risk')}</Th><Th>{t('risks:table.inherent')}</Th><Th>{t('risks:table.residual')}</Th><Th>{t('risks:table.target')}</Th><Th>{t('risks:table.status')}</Th><Th>{''}</Th></tr></Thead>
                    <Tbody>
                      {filtered.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => openEdit(r)}>
                          <Td className="font-mono text-xs text-gray-500">{r.ref}</Td>
                          <Td>
                            <p className="text-sm font-medium dark:text-slate-200">{r.title}</p>
                            <p className="text-[11px] text-gray-500 flex items-center gap-1.5 dark:text-gray-400">
                               <span>{categoryLabels[r.category!] || r.category}</span>
                               {(r.assets?.length || 0) > 0 && <span className="flex items-center gap-0.5"><Shield size={10} />{r.assets!.length}</span>}
                            </p>
                            <RiskFlags r={r} />
                          </Td>
                          <Td><Badge value={r.inherent_level!} label={levelLabels[r.inherent_level!]} /></Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              {r.residual_level ? (
                                <>
                                  <Badge value={r.residual_level} label={levelLabels[r.residual_level]} />
                                  {r.residual_override && <span title={r.residual_override_reason || ''} className="text-[10px] text-purple-700 dark:text-purple-300 font-semibold">{t('risks:levels3.overriddenShort')}</span>}
                                  {(r.inherent_level !== r.residual_level) && <span className="text-[10px] text-green-600 font-bold">-{Math.round((r.likelihood * r.impact - (r.residual_likelihood || 0) * (r.residual_impact || 0)) / (r.likelihood * r.impact || 1) * 100)}%</span>}
                                </>
                              ) : <span className="text-xs text-gray-300 italic">{t('risks:notTreated')}</span>}
                            </div>
                          </Td>
                          <Td>{r.target_level ? <Badge value={r.target_level} label={levelLabels[r.target_level]} /> : <span className="text-xs text-gray-300">–</span>}</Td>
                          <Td>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium dark:text-slate-400">{statusLabels[r.status]}</span>
                              {r.status === 'accepted' && r.accepted_until && (
                                <span className={`text-[10px] flex items-center gap-1 ${r.acceptance_expired ? 'text-red-600 dark:text-red-400 font-semibold' : r.acceptance_expiring ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}><ShieldCheck size={10} />{t('risks:acceptedUntil')} {format(new Date(r.accepted_until), 'dd.MM.yy', { locale: dateFnsLocale })}</span>
                              )}
                            </div>
                          </Td>
                          <Td className="text-right">
                             {canWrite && <button onClick={(e) => { e.stopPropagation(); remove(r); }} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>}
                          </Td>
                        </tr>
                      ))}
                      {filtered.length === 0 && risks.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center">
                            <p className="text-gray-500 dark:text-slate-400 font-medium">{t('risks:empty.title')}</p>
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 mb-4">{t('risks:empty.subtitle')}</p>
                            {canWrite && (
                              <button onClick={openNew}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                                <Plus size={15} />{t('risks:empty.createFirst')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                      {filtered.length === 0 && risks.length > 0 && (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center">
                            <p className="text-gray-500 dark:text-slate-400">{t('risks:noFilter')}</p>
                            <button onClick={resetFilters}
                              className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
                              {t('common:actions.reset')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </Tbody>
                  </Table>
                </div>
              </CardBody>
            </Card>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          {scale && (
            <Card>
              <CardHeader className="pb-2 border-b dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Grid3x3 className="text-blue-500" size={18} />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold dark:text-white">{t('risks:heatmap.title')}</h2>
                    <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate">{t('risks:methodology.versionLabel', { version: scale.version, name: scale.name })}</p>
                  </div>
                </div>
              </CardHeader>
              <CardBody className="pt-3 space-y-2">
                <div className="flex rounded-lg border dark:border-slate-700 overflow-hidden text-[11px]" role="group" aria-label={t('risks:levels3.basis')}>
                  {(['gross', 'net', 'target'] as LevelBasis[]).map(b => (
                    <button key={b} type="button" aria-pressed={heatBasis === b} onClick={() => { setHeatBasis(b); setHeatCell(null); }}
                      className={`flex-1 px-2 py-1 ${heatBasis === b ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                      {t(`risks:levels3.${b}`)}
                    </button>
                  ))}
                </div>
                <RiskHeatmap scale={scale} counts={heatCounts} selected={heatCell} onSelect={setHeatCell} compact />
                <p className="text-[10px] text-gray-500 dark:text-slate-400">{t('risks:heatmap.hint')}</p>
                {reassessCount > 0 && (
                  <button type="button" onClick={() => setFlagFilter('reassess')} className="text-[11px] text-amber-700 dark:text-amber-400 hover:underline flex items-center gap-1">
                    <RefreshCcw size={11} />{t('risks:heatmap.reassessPending', { count: reassessCount })}
                  </button>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b dark:border-slate-800">
              <div className="flex items-center gap-2">
                <FolderOpen className="text-orange-500 dark:text-orange-400" size={18} />
                <h2 className="text-sm font-semibold dark:text-white">{t('risks:templates.title')}</h2>
              </div>
              {user?.role !== 'viewer' && user?.role !== 'management' && ['admin', 'it-staff', 'assessor'].includes(user?.role || '') && (
                <Link to="/policies?tab=templates" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('risks:templates.manage')}</Link>
              )}
            </CardHeader>
            <CardBody className="pt-4 space-y-3">
              {templates.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-slate-400 italic">{t('risks:templates.empty')}</p>
              ) : (
                <div className="space-y-2">
                  {templates.map(t => (
                    <div key={t.id} className="flex items-start justify-between gap-2 p-2 rounded-lg border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 hover:bg-gray-100/50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="flex items-start gap-2 min-w-0">
                        <div className="mt-0.5 shrink-0">
                          {getFileIcon(t.filename)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold dark:text-white truncate" title={t.title}>{t.title}</p>
                          <p className="text-[10px] text-gray-500 dark:text-slate-400 truncate" title={t.original_name}>{t.original_name}</p>
                          {t.description && <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 line-clamp-2">{t.description}</p>}
                        </div>
                      </div>
                      <IconButton label="Download" onClick={() => handleDownload(t.id, t.original_name)}><Download size={14} /></IconButton>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('risks:modal.editTitle') : t('risks:modal.newTitle')} size="xl">
        <form onSubmit={save} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label={t('risks:form.title')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder={t('risks:form.titlePlaceholder')} />
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.description')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('risks:form.descriptionPlaceholder')} />
            </div>

            <Select label={t('risks:form.category')} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={[{ value: '', label: t('risks:form.select') }, ...categories.filter(c => c.active || c.key === form.category).map(c => ({ value: c.key, label: c.active ? categoryLabel(c) : `${categoryLabel(c)} (${t('risks:categoriesAdmin.inactive')})` }))]} />
            <SearchableSelect label={t('risks:form.owner')} value={String(form.owner_id || '')} onChange={val => setForm({ ...form, owner_id: val })} options={[{ value: '', label: t('risks:form.select') }, ...users.map(u => ({ value: String(u.id), label: u.name }))]} />

            <section className="md:col-span-2 p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('risks:form.inherentSection')}</h3>
                {formScale && <span className="text-[10px] text-gray-500 dark:text-slate-400">{t('risks:methodology.versionLabel', { version: formScale.version, name: formScale.name })}</span>}
              </div>
              {editingRisk?.needs_reassessment && !form.reassess && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 text-xs text-amber-800 dark:text-amber-300">
                  <span>{t(editingRisk.matrix_changed ? 'risks:methodology.outdatedMatrix' : 'risks:methodology.outdated', { version: editingRisk.methodology_version, active: scale?.version })}</span>
                  {canWrite && <Button type="button" size="sm" variant="secondary" onClick={startReassess}><RefreshCcw size={12} />{t('risks:methodology.reassess')}</Button>}
                </div>
              )}
              {form.reassess && (
                <p className="text-xs text-blue-700 dark:text-blue-300">{t('risks:methodology.reassessHint', { version: scale?.version })}</p>
              )}
              {formScale ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select label={t('risks:form.likelihood')} value={String(form.likelihood)} onChange={e => setForm({ ...form, likelihood: parseInt(e.target.value) })} options={stepOptions(formScale.likelihood_levels, formScale.likelihood_unit)} />
                  {(formScale.impact_dimensions || []).length === 0 ? (
                    <Select label={t('risks:form.impact')} value={String(form.impact)} onChange={e => setForm({ ...form, impact: parseInt(e.target.value) })} options={stepOptions(formScale.impact_levels, formScale.impact_unit)} />
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.impact')}</span>
                      <p className="text-sm dark:text-slate-200">
                        {maxDimension(form.impact_dimensions) != null
                          ? t('risks:assessment.impactFromDimensions', { value: maxDimension(form.impact_dimensions) })
                          : t('risks:assessment.impactSingle', { value: form.impact })}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('risks:assessment.maxPrinciple')}</p>
                    </div>
                  )}
                </div>
              ) : <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('risks:methodology.loading')}</p>}
              {formScale && (formScale.impact_dimensions || []).length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('risks:assessment.dimensions')}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {formScale.impact_dimensions.map(d => (
                      <Select key={d.key} label={dimensionLabel(d)} title={d.description || undefined}
                        value={form.impact_dimensions[d.key] ? String(form.impact_dimensions[d.key]) : ''}
                        onChange={e => setForm({ ...form, impact_dimensions: { ...form.impact_dimensions, [d.key]: e.target.value ? parseInt(e.target.value) : undefined } })}
                        options={[{ value: '', label: t('risks:assessment.notRated') }, ...stepOptions(formScale.impact_levels, formScale.impact_unit)]} />
                    ))}
                  </div>
                  {maxDimension(form.impact_dimensions) == null && (
                    <Select label={t('risks:assessment.overallImpact')} value={String(form.impact)} onChange={e => setForm({ ...form, impact: parseInt(e.target.value) })} options={stepOptions(formScale.impact_levels, formScale.impact_unit)} />
                  )}
                </div>
              )}
              {(() => {
                // Rationale is mandatory when the values are set (new risk,
                // reassessment) or changed; the server enforces it.
                const dimsNow = JSON.stringify(Object.fromEntries(Object.entries(form.impact_dimensions).filter(([, v]) => typeof v === 'number')));
                const lNeeded = !origValues || form.reassess || form.likelihood !== origValues.likelihood;
                const impactNow = maxDimension(form.impact_dimensions) ?? form.impact;
                const iNeeded = !origValues || form.reassess || impactNow !== origValues.impact || dimsNow !== origValues.dims;
                const area = 'bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden';
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:assessment.likelihoodRationale')}{lNeeded ? ' *' : ''}</label>
                      <textarea className={area} rows={2} required={lNeeded} value={form.likelihood_rationale} onChange={e => setForm({ ...form, likelihood_rationale: e.target.value })} placeholder={t('risks:assessment.likelihoodRationalePlaceholder')} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:assessment.impactRationale')}{iNeeded ? ' *' : ''}</label>
                      <textarea className={area} rows={2} required={iNeeded} value={form.impact_rationale} onChange={e => setForm({ ...form, impact_rationale: e.target.value })} placeholder={t('risks:assessment.impactRationalePlaceholder')} />
                    </div>
                    {(lNeeded || iNeeded) && origValues && <p className="md:col-span-2 text-[11px] text-amber-700 dark:text-amber-400">{t('risks:assessment.rationaleHint')}</p>}
                  </div>
                );
              })()}
              {formScale && (() => {
                const desc = [formScale.likelihood_levels[form.likelihood - 1], formScale.impact_levels[form.impact - 1]].filter(s => s?.description);
                return desc.length > 0 ? <ul className="text-[11px] text-gray-500 dark:text-slate-400 list-disc pl-4">{desc.map((s, i) => <li key={i}>{s!.description}</li>)}</ul> : null;
              })()}
            </section>

            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.affectedAssets', { count: form.asset_ids.length })}</label>
              <div className="relative flex items-center mb-1">
                <Search className="absolute left-3 text-gray-500 dark:text-gray-400" size={14} />
                <input type="text" placeholder={t('risks:form.assetFilter')} value={assetSearch} onChange={e => setAssetSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-32 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 bg-white dark:bg-slate-900/50 custom-scrollbar">
                {filteredAssets.length === 0 ? (
                   <p className="text-xs text-gray-500 dark:text-slate-400 p-2 text-center">{t('risks:form.noAssets')}</p>
                ) : (
                  filteredAssets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                      <input type="checkbox" checked={form.asset_ids.includes(a.id)} onChange={() => toggleAsset(a.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 truncate">{a.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.relevantThreats', { count: form.threat_ids.length })}</label>
              <div className="relative flex items-center mb-1">
                <Search className="absolute left-3 text-gray-500 dark:text-gray-400" size={14} />
                <input type="text" placeholder={t('risks:form.threatFilter')} value={threatSearch} onChange={e => setThreatSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-32 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 bg-white dark:bg-slate-900/50 custom-scrollbar">
                {filteredThreats.length === 0 ? (
                   <p className="text-xs text-gray-500 dark:text-slate-400 p-2 text-center">{t('risks:form.noThreats')}</p>
                ) : (
                  filteredThreats.map(t => (
                    <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                      <input type="checkbox" checked={form.threat_ids.includes(t.id)} onChange={() => toggleThreat(t.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 truncate"><span className="font-mono text-xs text-gray-500 mr-2 dark:text-gray-400">{t.code}</span>{t.title}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <section className="md:col-span-2 p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">{t('risks:scenarios.title', { count: form.scenarios.length })}</h3>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('risks:scenarios.hint')}</p>
                </div>
                {canWrite && <Button type="button" size="sm" variant="secondary" onClick={addScenario}><Plus size={12} />{t('risks:scenarios.add')}</Button>}
              </div>
              {form.scenarios.length === 0 && <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('risks:scenarios.empty')}</p>}
              {form.scenarios.map((sc, idx) => (
                <div key={idx} className="p-3 rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-600 dark:text-slate-300">{t('risks:scenarios.number', { n: idx + 1 })}</span>
                    {canWrite && <IconButton label={t('common:actions.delete')} variant="danger" onClick={() => removeScenario(idx)}><Trash2 size={13} /></IconButton>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-semibold text-gray-600 dark:text-slate-400">{t('risks:scenarios.assets')}</span>
                      <div className="max-h-28 overflow-y-auto border dark:border-slate-700 rounded-lg p-1.5 custom-scrollbar">
                        {assets.map(a => (
                          <label key={a.id} className="flex items-center gap-2 px-1 py-0.5 text-xs dark:text-slate-300 cursor-pointer">
                            <input type="checkbox" className="w-3.5 h-3.5 rounded text-blue-600" checked={sc.asset_ids.includes(a.id)}
                              onChange={() => setScenario(idx, { asset_ids: sc.asset_ids.includes(a.id) ? sc.asset_ids.filter(x => x !== a.id) : [...sc.asset_ids, a.id] })} />
                            <span className="truncate">{a.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <Select label={t('risks:scenarios.threat')} value={sc.threat_id ? String(sc.threat_id) : ''} onChange={e => setScenario(idx, { threat_id: e.target.value ? parseInt(e.target.value) : null })}
                      options={[{ value: '', label: t('risks:scenarios.none') }, ...threats.map(th => ({ value: String(th.id), label: `${th.code ? `${th.code} ` : ''}${th.title}` }))]} />
                    <Select label={t('risks:scenarios.vulnerability')} value={sc.vulnerability_id ? String(sc.vulnerability_id) : ''} onChange={e => setScenario(idx, { vulnerability_id: e.target.value ? parseInt(e.target.value) : null })}
                      options={[{ value: '', label: t('risks:scenarios.none') }, ...vulnerabilities.map(v => ({ value: String(v.id), label: `${v.ref || ''} ${v.cve_id && !v.title.startsWith(v.cve_id) ? `${v.cve_id} · ` : ''}${v.title}`.trim() }))]} />
                  </div>
                  <Input placeholder={t('risks:scenarios.description')} value={sc.description} onChange={e => setScenario(idx, { description: e.target.value })} />
                </div>
              ))}
            </section>

            <Select label={t('risks:form.treatment')} value={form.treatment} onChange={e => setForm({ ...form, treatment: e.target.value as RiskTreatment })} options={Object.entries(treatmentLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Select label={t('risks:table.status')} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as RiskStatus })} options={statusOptions} />

            <div className="md:col-span-2 flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:treatmentOptions.label')}</span>
              <div className="flex flex-wrap gap-3">
                {(Object.keys(treatmentLabels) as RiskTreatment[]).map(o => {
                  const isMain = o === form.treatment;
                  const checked = isMain || form.treatment_options.includes(o);
                  return (
                    <label key={o} className={`flex items-center gap-1.5 text-sm dark:text-slate-300 ${isMain ? 'opacity-70' : 'cursor-pointer'}`}>
                      <input type="checkbox" className="w-4 h-4 rounded text-blue-600" checked={checked} disabled={isMain}
                        onChange={() => setForm(f => ({ ...f, treatment_options: f.treatment_options.includes(o) ? f.treatment_options.filter(x => x !== o) : [...f.treatment_options, o] }))} />
                      {treatmentLabels[o]}
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('risks:treatmentOptions.hint')}</p>
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.treatmentPlan')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.treatment_plan} onChange={e => setForm({ ...form, treatment_plan: e.target.value })} />
            </div>

            {editId ? (
              <TreatmentItems risk={detail} canEdit={canWrite} users={users} groups={groups} controls={allControls}
                levelLabel={(k) => (k ? levelLabels[k as RiskLevel] || k : '–')} onChanged={reloadDetail} />
            ) : (
              <p className="md:col-span-2 text-xs text-gray-500 italic dark:text-gray-400">{t('risks:items.saveFirst')}</p>
            )}

            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('risks:form.linkedControls', { count: form.controls.length })}</label>
              <Input placeholder={t('risks:form.controlSearch')} value={controlSearch} onChange={e => setControlSearch(e.target.value)} />
              <div className="max-h-44 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 space-y-0.5 bg-white dark:bg-slate-900/50">
                {visControls.slice(0, 60).map(c => {
                  const sel = form.controls.find(x => x.id === c.id);
                  return (
                    <div key={c.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={!!sel} onChange={() => toggleControl(c.id)} className="w-4 h-4 rounded text-blue-600" />
                      <span className="text-sm dark:text-slate-300 flex-1 truncate">
                        <span className="text-[10px] font-bold uppercase text-gray-500 mr-1 dark:text-gray-400">{fwLabels[c.framework]}</span>
                        {c.code ? <span className="font-mono text-xs text-gray-500 mr-1 dark:text-gray-400">{c.code}</span> : null}{c.title}
                        <span className={`ml-1 text-[10px] ${c.status === 'implemented' ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'}`}>({c.status === 'implemented' ? t('risks:controlStatus.implemented') : c.status === 'planned' ? t('risks:controlStatus.planned') : t('risks:controlStatus.na')})</span>
                      </span>
                      {sel && (
                        <select value={sel.effectiveness} onChange={e => setControlEff(c.id, parseInt(e.target.value))} title={t('risks:form.controlEffectiveness')} className="text-xs border dark:border-slate-700 rounded-md bg-white dark:bg-slate-800 dark:text-slate-200 px-1 py-0.5">
                          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>W{n}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400" dangerouslySetInnerHTML={{ __html: t('risks:form.controlHint') }} />
            </div>

            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <section className="p-4 rounded-xl border dark:border-slate-800 bg-blue-50/30 dark:bg-blue-900/10 space-y-2">
                <h3 className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 tracking-wider">{t('risks:form.residualSection')}</h3>
                {editingRisk?.residual_level ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge value={editingRisk.residual_level} label={levelLabels[editingRisk.residual_level]} />
                    <span className="text-xs text-gray-500">W{editingRisk.residual_likelihood} × A{editingRisk.residual_impact}</span>
                    {editingRisk.residual_override && <span className="rounded-full px-1.5 text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">{t('risks:levels3.overridden')}</span>}
                  </div>
                ) : <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('risks:form.residualPending')}</p>}
                {editingRisk?.residual_override && (
                  <div className="text-[11px] text-gray-600 dark:text-slate-400 space-y-0.5">
                    <p>{t('risks:levels3.overrideReason')}: {editingRisk.residual_override_reason}</p>
                    <p>{t('risks:levels3.overrideBy', { name: editingRisk.residualOverrideBy?.name || '–', date: editingRisk.residual_override_at ? new Date(editingRisk.residual_override_at).toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-GB') : '–' })}</p>
                    {editingRisk.residual_calculated && <p>{t('risks:levels3.calculated', { l: editingRisk.residual_calculated.residual_likelihood, i: editingRisk.residual_calculated.residual_impact, level: editingRisk.residual_calculated.residual_level ? levelLabels[editingRisk.residual_calculated.residual_level] : '–' })}</p>}
                  </div>
                )}
                {editId && canOverride && !editingRisk?.needs_reassessment && formScale && (
                  overrideForm.open ? (
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <Select label={t('risks:form.likelihood')} value={String(overrideForm.likelihood)} onChange={e => setOverrideForm({ ...overrideForm, likelihood: parseInt(e.target.value) })} options={stepOptions(formScale.likelihood_levels, formScale.likelihood_unit)} />
                        <Select label={t('risks:form.impact')} value={String(overrideForm.impact)} onChange={e => setOverrideForm({ ...overrideForm, impact: parseInt(e.target.value) })} options={stepOptions(formScale.impact_levels, formScale.impact_unit)} />
                      </div>
                      <textarea className="w-full bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2 text-xs dark:text-white" rows={2} value={overrideForm.reason} onChange={e => setOverrideForm({ ...overrideForm, reason: e.target.value })} placeholder={t('risks:levels3.overrideReasonPlaceholder')} />
                      <div className="flex gap-2">
                        <Button type="button" size="sm" onClick={() => saveOverride(true)} disabled={!overrideForm.reason.trim()}>{t('risks:levels3.overrideSave')}</Button>
                        <Button type="button" size="sm" variant="secondary" onClick={() => setOverrideForm({ ...overrideForm, open: false })}>{t('risks:buttons.cancel')}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" className="text-[11px] text-blue-700 dark:text-blue-300 hover:underline" onClick={() => setOverrideForm({ ...overrideForm, open: true })}>{editingRisk?.residual_override ? t('risks:levels3.overrideChange') : t('risks:levels3.override')}</button>
                      {editingRisk?.residual_override && <button type="button" className="text-[11px] text-red-600 dark:text-red-400 hover:underline" onClick={() => saveOverride(false)}>{t('risks:levels3.overrideRemove')}</button>}
                    </div>
                  )
                )}
              </section>
              <section className="p-4 rounded-xl border dark:border-slate-800 bg-emerald-50/30 dark:bg-emerald-900/10 space-y-2">
                <h3 className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider">{t('risks:levels3.targetSection')}</h3>
                {formScale && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select label={t('risks:form.likelihood')} value={form.target_likelihood === '' ? '' : String(form.target_likelihood)} onChange={e => setForm({ ...form, target_likelihood: e.target.value ? parseInt(e.target.value) : '' })} options={[{ value: '', label: t('risks:assessment.notRated') }, ...stepOptions(formScale.likelihood_levels, formScale.likelihood_unit)]} />
                    <Select label={t('risks:form.impact')} value={form.target_impact === '' ? '' : String(form.target_impact)} onChange={e => setForm({ ...form, target_impact: e.target.value ? parseInt(e.target.value) : '' })} options={[{ value: '', label: t('risks:assessment.notRated') }, ...stepOptions(formScale.impact_levels, formScale.impact_unit)]} />
                  </div>
                )}
                {editingRisk?.target_level && <Badge value={editingRisk.target_level} label={levelLabels[editingRisk.target_level]} />}
                <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('risks:levels3.targetHint')}</p>
              </section>
              <Input label={t('risks:form.nextReview')} type="date" value={form.review_date} onChange={e => setForm({ ...form, review_date: e.target.value })} />
            </div>

            {editId && detail && (
              <AcceptanceWorkflow risk={detail} user={user} rule={acceptanceRule}
                canRequest={can('risks', 'request_acceptance', hasWriteAccess(user?.role))}
                canSignOff={can('risks', 'sign_off', ['admin', 'assessor', 'owner', 'management'].includes(user?.role || ''))}
                levelLabel={(k) => (k ? levelLabels[k as RiskLevel] || k : '–')} onRevoke={revokeSignoff} onChanged={reloadDetail} />
            )}

            {editId && detail && (
              <RiskMonitoringPanel risk={detail} canEdit={can('risks', 'edit', hasWriteAccess(user?.role))}
                levelLabel={(k) => (k ? levelLabels[k as RiskLevel] || k : '–')} onChanged={reloadDetail} />
            )}
          </div>

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('risks:buttons.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? t('risks:buttons.saving') : (editId ? t('risks:buttons.saveChanges') : t('risks:buttons.createRisk'))}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
