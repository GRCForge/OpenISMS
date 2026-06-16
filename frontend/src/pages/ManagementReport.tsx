import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format, differenceInDays } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  FileSpreadsheet, TrendingUp, ShieldAlert, CheckCircle,
  AlertTriangle, Clock, Activity, BookOpen, Shield, Users, Globe, Pen,
  BarChart2, Target, Zap, CheckSquare, RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
  Area, ReferenceLine,
} from 'recharts';
import api from '../lib/api';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { exportToMultiSheetExcel } from '../lib/export';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import type { ReviewSignOff } from '../types';

const riskLabels: Record<string, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
const classLabels: Record<string, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };
const treatmentLabels: Record<string, string> = { mitigate: 'Reduzieren', accept: 'Akzeptieren', transfer: 'Übertragen', avoid: 'Vermeiden' };
const riskStatusLabels: Record<string, string> = { open: 'Offen', in_treatment: 'In Behandlung', accepted: 'Akzeptiert', closed: 'Geschlossen' };

const RISK_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981',
};

// ── Gauge ────────────────────────────────────────────────────────────────────
const Gauge: React.FC<{ value: number; size?: number }> = ({ value, size = 150 }) => {
  const r = (size / 2) * 0.78;
  const cx = size / 2;
  const cy = size * 0.42;
  const startAngle = Math.PI * 1.25;
  const endAngle = Math.PI * -0.25;
  const range = endAngle - startAngle;
  const angle = startAngle + (range * Math.min(value, 100)) / 100;
  const arc = (a: number) => ({ x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });
  const s = arc(startAngle); const e = arc(endAngle); const f = arc(angle);
  const large = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
  const fLarge = Math.abs(angle - startAngle) > Math.PI ? 1 : 0;
  const track = `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  const fill  = `M ${s.x} ${s.y} A ${r} ${r} 0 ${fLarge} 1 ${f.x} ${f.y}`;
  const color = value >= 75 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`} className="overflow-visible">
      <path d={track} fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" className="dark:stroke-slate-700" />
      <path d={fill}  fill="none" stroke={color}   strokeWidth="10" strokeLinecap="round" />
      <text x={cx} y={cy - 2}         textAnchor="middle" fontSize={size * 0.22}  fontWeight="bold" fill={color}>{value}</text>
      <text x={cx} y={cy + size * 0.15} textAnchor="middle" fontSize={size * 0.11} fill="#9ca3af" className="dark:fill-slate-500 font-semibold">/ 100</text>
    </svg>
  );
};

// ── Sparkline ────────────────────────────────────────────────────────────────
const Sparkline: React.FC<{ data: number[]; color?: string }> = ({ data, color = '#3b82f6' }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1); const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 72; const h = 28;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
  const last = data[data.length - 1]; const prev = data[data.length - 2];
  const trend = last > prev ? '↑' : last < prev ? '↓' : '→';
  const tc = last > prev ? 'text-green-500' : last < prev ? 'text-red-500' : 'text-gray-400';
  return (
    <div className="flex items-center gap-1">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={`text-xs font-bold ${tc}`}>{trend}</span>
    </div>
  );
};

// ── Pie label ────────────────────────────────────────────────────────────────
const RADIAN = Math.PI / 180;
const PieLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
  if (percent < 0.06) return null;
  const rad = innerRadius + (outerRadius - innerRadius) * 0.5;
  return <text x={cx + rad * Math.cos(-midAngle * RADIAN)} y={cy + rad * Math.sin(-midAngle * RADIAN)} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="bold">{`${(percent * 100).toFixed(0)}%`}</text>;
};

// Module-level snapshot cache. The report aggregates 9 heavy endpoints; without
// this, every visit re-fires all 9. Re-opening the page within the TTL reuses the
// last snapshot (0 requests). "Aktualisieren" or a sign-off forces a refresh.
type ReportSnapshot = {
  assets: any[]; risks: any[]; assessments: any[]; reminders: any[];
  controls: any[]; incidents: any[]; vvtEntries: any[]; trends: any; signOffs: ReviewSignOff[];
};
const REPORT_TTL_MS = 3 * 60 * 1000;
let reportCache: { at: number; data: ReportSnapshot } | null = null;
export const invalidateReportCache = () => { reportCache = null; };

export const ManagementReport: React.FC = () => {
  const toast = useToast();
  const { user } = useAuth();

  const [assets,      setAssets]      = useState<any[]>([]);
  const [risks,       setRisks]       = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [reminders,   setReminders]   = useState<any[]>([]);
  const [controls,    setControls]    = useState<any[]>([]);
  const [incidents,   setIncidents]   = useState<any[]>([]);
  const [vvtEntries,  setVvtEntries]  = useState<any[]>([]);
  const [trends,      setTrends]      = useState<any>(null);
  const [loading,     setLoading]     = useState(true);
  const [signOffs,    setSignOffs]    = useState<ReviewSignOff[]>([]);
  const [signOffModalOpen, setSignOffModalOpen] = useState(false);
  const [signOffNotes,     setSignOffNotes]     = useState('');
  const [signOffSaving,    setSignOffSaving]    = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'trends' | 'details'>('overview');
  const canSignOff = user?.role === 'admin' || user?.role === 'assessor';

  const [refreshing, setRefreshing] = useState(false);

  const hydrate = (d: ReportSnapshot) => {
    setAssets(d.assets); setRisks(d.risks); setAssessments(d.assessments);
    setReminders(d.reminders); setControls(d.controls); setIncidents(d.incidents);
    setVvtEntries(d.vvtEntries); setTrends(d.trends); setSignOffs(d.signOffs);
  };

  const loadSignOffs = () =>
    api.get('/review/sign-offs')
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : [];
        setSignOffs(data);
        if (reportCache) reportCache.data.signOffs = data;
      })
      .catch(() => {});

  const loadAll = (force: boolean) => {
    if (!force && reportCache && Date.now() - reportCache.at < REPORT_TTL_MS) {
      hydrate(reportCache.data);
      setLoading(false);
      return;
    }
    if (force) setRefreshing(true);
    let failed = 0;
    const d: ReportSnapshot = {
      assets: [], risks: [], assessments: [], reminders: [],
      controls: [], incidents: [], vvtEntries: [], trends: null, signOffs: [],
    };
    Promise.all([
      api.get('/assets').then(r => { d.assets = r.data; }).catch(() => { failed++; }),
      api.get('/risks').then(r => { d.risks = Array.isArray(r.data) ? r.data : []; }).catch(() => { failed++; }),
      api.get('/assessments').then(r => { d.assessments = r.data; }).catch(() => { failed++; }),
      api.get('/reminders').then(r => { d.reminders = r.data; }).catch(() => { failed++; }),
      api.get('/controls').then(r => { d.controls = r.data; }).catch(() => { failed++; }),
      api.get('/incidents').then(r => { d.incidents = Array.isArray(r.data) ? r.data : []; }).catch(() => { failed++; }),
      api.get('/vvt').then(r => { d.vvtEntries = Array.isArray(r.data) ? r.data : []; }).catch(() => { failed++; }),
      api.get('/report/trends').then(r => { d.trends = r.data; }).catch(() => { failed++; }),
      api.get('/review/sign-offs').then(r => { d.signOffs = Array.isArray(r.data) ? r.data : []; }).catch(() => { failed++; }),
    ]).finally(() => {
      hydrate(d);
      // Only cache a fully successful snapshot — never persist partial data.
      if (failed === 0) reportCache = { at: Date.now(), data: d };
      setLoading(false);
      setRefreshing(false);
      if (failed > 0) toast.error(`${failed} Datenbereiche konnten nicht geladen werden.`);
    });
  };

  useEffect(() => { loadAll(false); }, []);

  // ── Derived values ────────────────────────────────────────────────────────
  const currentAssessments  = assessments.filter(a => a.is_current);
  const riskCounts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    currentAssessments.forEach(a => { if (c[a.risk_level as keyof typeof c] !== undefined) c[a.risk_level as keyof typeof c]++; });
    return c;
  }, [currentAssessments]);

  const openRisks           = risks.filter(r => r.status === 'open' || r.status === 'in_treatment');
  const acceptedRisks       = risks.filter(r => r.status === 'accepted');
  const overdueReminders    = reminders.filter(r => r.status === 'overdue');
  const implementedControls = controls.filter(c => c.status === 'implemented');
  const controlCoverage     = controls.length ? Math.round((implementedControls.length / controls.length) * 100) : 0;
  const assessedPct         = assets.length ? Math.round((currentAssessments.length / assets.length) * 100) : 0;
  const nis2Assets          = assets.filter(a => a.nis2_relevant);
  const openIncidents       = incidents.filter(i => ['reported', 'investigating', 'contained'].includes(i.status));
  const today               = new Date();
  const activeVvt           = vvtEntries.filter(v => v.status === 'active');
  const dsfaRequired        = vvtEntries.filter(v => v.dsfa_required);
  const art9Entries         = vvtEntries.filter(v => v.special_categories);
  const drittlandEntries    = vvtEntries.filter(v => v.third_country_transfers);

  const expiringAcceptances = currentAssessments.filter(a => {
    if (a.risk_treatment !== 'accept' || !a.accepted_until) return false;
    const days = differenceInDays(new Date(a.accepted_until), today);
    return days >= 0 && days <= 60;
  }).sort((a, b) => new Date(a.accepted_until).getTime() - new Date(b.accepted_until).getTime());

  const healthScore = trends?.autoKpis?.health_score ?? Math.round(
    (controlCoverage / 100) * 30 + (assessedPct / 100) * 25 +
    Math.max(0, 1 - (overdueReminders.length / Math.max(assets.length, 1))) * 25 +
    Math.max(0, 1 - (riskCounts.critical * 0.1 + riskCounts.high * 0.03)) * 20
  );
  const healthLabel = healthScore >= 75 ? 'Gut' : healthScore >= 50 ? 'Verbesserungsbedarf' : 'Kritisch';
  const healthColor = healthScore >= 75 ? 'text-green-600' : healthScore >= 50 ? 'text-amber-600' : 'text-red-600';

  // Chart data
  const riskPieData = useMemo(() => [
    { name: 'Kritisch', value: riskCounts.critical, color: RISK_COLORS.critical },
    { name: 'Hoch',     value: riskCounts.high,     color: RISK_COLORS.high },
    { name: 'Mittel',   value: riskCounts.medium,   color: RISK_COLORS.medium },
    { name: 'Gering',   value: riskCounts.low,      color: RISK_COLORS.low },
  ].filter(d => d.value > 0), [riskCounts]);

  const controlPieData = useMemo(() => {
    const s = trends?.controlStatus ?? { implemented: implementedControls.length, planned: controls.filter((c: any) => c.status === 'planned').length, not_applicable: controls.filter((c: any) => c.status === 'not_applicable').length };
    return [
      { name: 'Umgesetzt', value: s.implemented,    color: '#10b981' },
      { name: 'Geplant',   value: s.planned,         color: '#f59e0b' },
      { name: 'N/A',       value: s.not_applicable,  color: '#9ca3af' },
    ].filter(d => d.value > 0);
  }, [trends, controls, implementedControls]);

  const taskPieData = useMemo(() => {
    const s = trends?.taskStatus ?? {};
    return [
      { name: 'Offen',          value: s.open || 0,        color: '#6b7280' },
      { name: 'In Bearbeitung', value: s.in_progress || 0, color: '#3b82f6' },
      { name: 'Erledigt',       value: s.done || 0,        color: '#10b981' },
    ].filter(d => d.value > 0);
  }, [trends]);

  const monthlyData: any[] = trends?.monthly ?? [];
  const incidentSparkline  = monthlyData.map((m: any) => m.incidents);
  const riskSparkline      = monthlyData.map((m: any) => m.risks_new);
  const taskSparkline      = monthlyData.map((m: any) => m.tasks_done);

  // ── Excel Export ──────────────────────────────────────────────────────────
  const exportReport = async () => {
    const ts = format(new Date(), 'yyyyMMdd');
    const summarySheet = [
      { Kennzahl: 'ISMS Health Score',            Wert: `${healthScore}/100`, Hinweis: healthLabel },
      { Kennzahl: 'Erfasste Assets',              Wert: assets.length, Hinweis: '' },
      { Kennzahl: 'Assets bewertet',              Wert: currentAssessments.length, Hinweis: `${assessedPct}%` },
      { Kennzahl: 'Kritische Risiken',            Wert: riskCounts.critical, Hinweis: riskCounts.critical > 0 ? 'Sofortmaßnahmen' : 'OK' },
      { Kennzahl: 'Hohe Risiken',                 Wert: riskCounts.high, Hinweis: '' },
      { Kennzahl: 'Offene Risiken (Register)',    Wert: openRisks.length, Hinweis: '' },
      { Kennzahl: 'Control-Umsetzung',            Wert: `${controlCoverage}%`, Hinweis: `${implementedControls.length}/${controls.length}` },
      { Kennzahl: 'Überfällige Reviews',          Wert: overdueReminders.length, Hinweis: '' },
      { Kennzahl: 'Offene Vorfälle',              Wert: openIncidents.length, Hinweis: '' },
      { Kennzahl: 'MTTR (Tage)',                  Wert: trends?.autoKpis?.mttr_days ?? '–', Hinweis: 'letzte 90 Tage' },
      { Kennzahl: 'Aufgaben-Erledigungsrate',     Wert: `${trends?.autoKpis?.task_completion_rate ?? 0}%`, Hinweis: '' },
      { Kennzahl: 'VVT-Einträge aktiv',           Wert: activeVvt.length, Hinweis: `${dsfaRequired.length} DSFA-pflichtig` },
      { Kennzahl: 'Berichtsdatum',                Wert: format(new Date(), 'dd.MM.yyyy HH:mm', { locale: de }), Hinweis: '' },
    ];
    const riskSheet = risks.map(r => ({
      Ref: r.ref || `#${r.id}`, Titel: r.title,
      'Inhärentes Risiko': riskLabels[r.inherent_level || ''] || '',
      Behandlung: treatmentLabels[r.treatment || ''] || '',
      Status: riskStatusLabels[r.status] || r.status,
    }));
    const assetSheet = assets.map(a => {
      const cur = a.Assessments?.find((x: any) => x.is_current);
      return { ID: a.id, Asset: a.name, Typ: a.type, Klassifizierung: classLabels[a.classification] || a.classification, 'Risiko-Level': cur ? (riskLabels[cur.risk_level] || cur.risk_level) : 'Nicht bewertet', Owner: a.owner?.name || '' };
    });
    await exportToMultiSheetExcel([
      { name: 'Managementübersicht', data: summarySheet },
      { name: 'Asset-Register',      data: assetSheet },
      { name: 'Risikoregister',      data: riskSheet },
    ], `isms-management-report-${ts}`);
  };

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  // ── KPI Card ──────────────────────────────────────────────────────────────
  const KPI: React.FC<{ label: string; value: string | number; sub?: string; color?: string; icon: React.FC<any>; sparkline?: number[] }> = ({ label, value, sub, color = 'bg-blue-500', icon: Icon, sparkline }) => (
    <Card>
      <CardBody className="flex items-start gap-3 py-4">
        <div className={`p-2.5 rounded-xl ${color} shrink-0`}><Icon className="text-white" size={18} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold dark:text-white leading-tight">{value}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{label}</p>
          {sub && <p className="text-[10px] text-gray-400 dark:text-slate-500">{sub}</p>}
          {sparkline && sparkline.some(v => v > 0) && <div className="mt-1.5"><Sparkline data={sparkline} /></div>}
        </div>
      </CardBody>
    </Card>
  );

  const TABS = [{ key: 'overview', label: 'Übersicht' }, { key: 'trends', label: 'Entwicklung' }, { key: 'details', label: 'Details' }] as const;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <BarChart2 size={24} className="text-blue-600" />
            Management Report
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            Stand {format(new Date(), "dd. MMMM yyyy 'um' HH:mm 'Uhr'", { locale: de })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {signOffs.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg border border-green-200 dark:border-green-900/40">
              <CheckCircle size={12} />
              Freigegeben {format(new Date(signOffs[0].approved_at), 'dd.MM.yyyy', { locale: de })}
            </div>
          )}
          {canSignOff && (
            <Button variant="secondary" size="sm" onClick={() => setSignOffModalOpen(true)}>
              <Pen size={14} /> Review freigeben
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => loadAll(true)} disabled={refreshing} title="Daten neu laden">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Aktualisieren
          </Button>
          <Button size="sm" onClick={exportReport}>
            <FileSpreadsheet size={14} /> Excel-Export
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeTab === t.key ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════ TAB: ÜBERSICHT ══════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">

          {/* Health Score + KPIs */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <Card className="lg:col-span-1 flex flex-col items-center justify-center py-6 h-full">
              <CardBody className="flex flex-col items-center gap-3 w-full justify-between h-full">
                <p className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">ISMS Health Score</p>
                <div className="flex-1 flex items-center justify-center my-2">
                  <Gauge value={healthScore} size={175} />
                </div>
                <div className="text-center space-y-1.5">
                  <p className={`text-lg font-extrabold ${healthColor}`}>{healthLabel}</p>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 font-medium">
                    Maßnahmen: <span className="text-gray-900 dark:text-slate-100 font-bold">{controlCoverage}%</span> · Bewertung: <span className="text-gray-900 dark:text-slate-100 font-bold">{assessedPct}%</span>
                  </p>
                </div>
              </CardBody>
            </Card>
            <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <KPI label="Offene Hochrisiken" value={riskCounts.critical + riskCounts.high}
                sub={`${riskCounts.critical} kritisch · ${riskCounts.high} hoch`}
                color={(riskCounts.critical + riskCounts.high) > 0 ? 'bg-red-500' : 'bg-gray-400'}
                icon={ShieldAlert} sparkline={riskSparkline} />
              <KPI label="Control-Umsetzung" value={`${controlCoverage}%`}
                sub={`${implementedControls.length} / ${controls.length}`}
                color="bg-blue-500" icon={CheckCircle} />
              <KPI label="Asset-Bewertung" value={`${assessedPct}%`}
                sub={`${currentAssessments.length} / ${assets.length}`}
                color="bg-indigo-500" icon={Target} />
              <KPI label="Überfällige Reviews" value={overdueReminders.length}
                color={overdueReminders.length > 0 ? 'bg-amber-500' : 'bg-gray-400'}
                icon={Clock} />
              <KPI label="Offene Vorfälle" value={openIncidents.length}
                sub={`${incidents.length} gesamt`}
                color={openIncidents.length > 0 ? 'bg-orange-500' : 'bg-gray-400'}
                icon={Activity} sparkline={incidentSparkline} />
              {trends?.autoKpis?.mttr_days != null && (
                <KPI label="MTTR (Tage)" value={trends.autoKpis.mttr_days}
                  sub="Ø Entstörungszeit (90d)" color="bg-purple-500" icon={Zap} />
              )}
              <KPI label="Aufgaben erledigt" value={`${trends?.autoKpis?.task_completion_rate ?? 0}%`}
                sub={`${trends?.taskStatus?.done ?? 0} von ${Object.values(trends?.taskStatus ?? {}).reduce((a: number, b: any) => a + b, 0)}`}
                color="bg-teal-500" icon={CheckSquare} sparkline={taskSparkline} />
              <KPI label="NIS-2 Assets" value={nis2Assets.length}
                color="bg-slate-500" icon={Shield} />
              <KPI label="VVT-Einträge" value={activeVvt.length}
                sub={`${dsfaRequired.length} DSFA-pflichtig`}
                color="bg-teal-600" icon={BookOpen} />
            </div>
          </div>

          {/* 3 Donuts */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { title: 'Risikoverteilung (SBF)', data: riskPieData, empty: 'Keine Bewertungen' },
              { title: 'Maßnahmen-Status',        data: controlPieData, empty: 'Keine Maßnahmen' },
              { title: 'Aufgaben-Status',          data: taskPieData, empty: 'Keine Aufgaben' },
            ].map(chart => (
              <Card key={chart.title}>
                <CardHeader><h3 className="font-semibold dark:text-white text-sm">{chart.title}</h3></CardHeader>
                <CardBody className="pb-4">
                  {chart.data.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={176}>
                        <PieChart>
                          <Pie data={chart.data} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" labelLine={false} label={PieLabel}>
                            {chart.data.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                        {chart.data.map(d => (
                          <div key={d.name} className="flex items-center gap-1 text-xs text-gray-600 dark:text-slate-400">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                            {d.name}: <strong>{d.value}</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <p className="text-center text-gray-400 dark:text-slate-600 text-sm py-10">{chart.empty}</p>}
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Alert rows */}
          {(expiringAcceptances.length > 0 || riskCounts.critical > 0 || riskCounts.high > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {expiringAcceptances.length > 0 && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Clock size={15} className="text-amber-500" />
                      <h3 className="font-semibold dark:text-white text-sm">Risikoakzeptanzen ablaufend (≤ 60 Tage)</h3>
                      <span className="ml-auto text-xs font-bold text-amber-600">{expiringAcceptances.length}</span>
                    </div>
                  </CardHeader>
                  <CardBody className="p-0 max-h-52 overflow-y-auto">
                    {expiringAcceptances.map(a => {
                      const daysLeft = differenceInDays(new Date(a.accepted_until), today);
                      return (
                        <div key={a.id} className="flex items-center justify-between px-4 py-2.5 border-b dark:border-slate-800 last:border-0">
                          <div>
                            <p className="font-medium text-sm dark:text-slate-200">{a.Asset?.name || '–'}</p>
                            <p className="text-xs text-gray-400">bis {format(new Date(a.accepted_until), 'dd.MM.yyyy')}</p>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded-lg ${daysLeft <= 14 ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'}`}>
                            {daysLeft === 0 ? 'Heute!' : `${daysLeft}d`}
                          </span>
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              )}
              {(riskCounts.critical > 0 || riskCounts.high > 0) && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={15} className="text-red-500" />
                      <h3 className="font-semibold dark:text-white text-sm">Assets mit erhöhtem Risiko</h3>
                    </div>
                  </CardHeader>
                  <CardBody className="p-0 max-h-52 overflow-y-auto">
                    {currentAssessments.filter(a => ['critical', 'high'].includes(a.risk_level)).sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)).map(a => (
                      <Link
                        key={a.id}
                        to={`/assets/${a.asset_id}`}
                        className="flex items-center justify-between px-4 py-2.5 border-b dark:border-slate-800 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors group"
                      >
                        <div>
                          <p className="font-medium text-sm dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{a.Asset?.name || '–'}</p>
                          <p className="text-xs text-gray-400 dark:text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className="capitalize">{a.Asset?.type || 'Asset'}</span>
                            <span>·</span>
                            <span>Score {a.risk_score?.toFixed(1) ?? '–'}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge value={a.risk_level} label={riskLabels[a.risk_level] || a.risk_level} />
                          {a.risk_treatment && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400">
                              {treatmentLabels[a.risk_treatment]}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* Manual KPIs */}
          {(trends?.kpis?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp size={15} className="text-blue-500" />
                  <h3 className="font-semibold dark:text-white text-sm">Manuelle KPIs</h3>
                </div>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {trends.kpis.map((k: any) => {
                    const sc = k.status === 'on_target' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : k.status === 'warning' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                    const sl = k.status === 'on_target' ? 'Im Ziel' : k.status === 'warning' ? 'Warnung' : 'Kritisch';
                    const sd = (k.measurements || []).map((m: any) => parseFloat(m.value) || 0);
                    return (
                      <div key={k.id} className="p-3 rounded-xl border dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold dark:text-slate-200">{k.title}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${sc}`}>{sl}</span>
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <p className="text-xl font-bold dark:text-white">{k.current_value ?? '–'}</p>
                            <p className="text-[10px] text-gray-400 dark:text-slate-500">Ziel: {k.target}</p>
                          </div>
                          {sd.length >= 2 && <Sparkline data={sd} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════ TAB: ENTWICKLUNG ══════════════════ */}
      {activeTab === 'trends' && (
        <div className="space-y-6">
          {monthlyData.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl">
              <BarChart2 size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3" />
              <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Trend-Daten verfügbar</p>
              <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">Daten werden mit zunehmenden Einträgen automatisch befüllt.</p>
            </div>
          ) : (
            <>
              {/* Incidents + Risks */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <TrendingUp size={15} className="text-blue-500" />
                    <h3 className="font-semibold dark:text-white text-sm">Vorfälle & neue Risiken — letzte 12 Monate</h3>
                  </div>
                </CardHeader>
                <CardBody>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={monthlyData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="incidents" name="Vorfälle" fill="#fee2e2" stroke="#ef4444" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="high_incidents" name="Kritische Vorfälle" stroke="#b91c1c" strokeWidth={2} strokeDasharray="4 2" dot={false} />
                      <Bar dataKey="risks_new" name="Neue Risiken" fill="#f59e0b" radius={[3, 3, 0, 0]} opacity={0.85} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardBody>
              </Card>

              {/* Assets + Tasks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader><h3 className="font-semibold dark:text-white text-sm">Neue Assets pro Monat</h3></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={monthlyData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Bar dataKey="assets_new" name="Neue Assets" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader><h3 className="font-semibold dark:text-white text-sm">Erledigte Aufgaben pro Monat</h3></CardHeader>
                  <CardBody>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={monthlyData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Bar dataKey="tasks_done" name="Erledigt" fill="#10b981" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardBody>
                </Card>
              </div>

              {/* Manual KPI trend charts */}
              {trends?.kpis?.filter((k: any) => (k.measurements || []).length >= 2).map((k: any) => {
                const chartData = [...(k.measurements || [])].map((m: any) => ({
                  label: m.measured_at ? format(new Date(m.measured_at), 'MM/yy') : '',
                  value: parseFloat(m.value) || 0,
                }));
                const targetNum = parseFloat(k.target);
                return (
                  <Card key={k.id}>
                    <CardHeader>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold dark:text-white text-sm">{k.title}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${k.status === 'on_target' ? 'bg-green-100 text-green-700' : k.status === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                          Aktuell: {k.current_value ?? '–'}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">Ziel: {k.target}</span>
                      </div>
                    </CardHeader>
                    <CardBody>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={chartData} margin={{ top: 5, right: 16, left: -10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                          {!isNaN(targetNum) && (
                            <ReferenceLine y={targetNum} stroke="#10b981" strokeDasharray="4 2"
                              label={{ value: `Ziel ${k.target}`, fontSize: 10, fill: '#10b981', position: 'right' }} />
                          )}
                          <Line type="monotone" dataKey="value" name={k.title} stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardBody>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ══════════════════ TAB: DETAILS ══════════════════ */}
      {activeTab === 'details' && (
        <div className="space-y-6">
          {nis2Assets.length > 0 && (
            <Card>
              <CardHeader><div className="flex items-center gap-2"><Shield size={15} className="text-indigo-500" /><h3 className="font-semibold dark:text-white text-sm">NIS-2-relevante Assets ({nis2Assets.length})</h3></div></CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                  {nis2Assets.map(a => {
                    const cur = currentAssessments.find(x => x.asset_id === a.id);
                    return (
                      <div key={a.id} className="flex items-center justify-between px-5 py-3">
                        <div><p className="font-medium text-sm dark:text-slate-200">{a.name}</p><p className="text-xs text-gray-400">{a.type} · {classLabels[a.classification] || a.classification}</p></div>
                        {cur ? <Badge value={cur.risk_level} label={riskLabels[cur.risk_level] || cur.risk_level} /> : <span className="text-xs text-gray-400 italic">Nicht bewertet</span>}
                      </div>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          )}

          {vvtEntries.length > 0 && (
            <Card>
              <CardHeader><div className="flex items-center gap-2"><BookOpen size={15} className="text-teal-500" /><h3 className="font-semibold dark:text-white text-sm">Datenschutz-Übersicht (Art. 30 DSGVO)</h3></div></CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {[
                    { label: 'Verarbeitungstätigkeiten', value: vvtEntries.length, sub: `${activeVvt.length} aktiv`, icon: BookOpen, color: 'text-teal-500' },
                    { label: 'Art. 9 — Besondere Kategorien', value: art9Entries.length, sub: 'Erhöhte Schutzpflicht', icon: ShieldAlert, color: 'text-red-500' },
                    { label: 'Drittlandübermittlungen', value: drittlandEntries.length, sub: 'Art. 44 DSGVO', icon: Globe, color: 'text-orange-500' },
                    { label: 'DSFA-pflichtig (Art. 35)', value: dsfaRequired.length, sub: 'Datenschutz-Folgenabschätzung', icon: Users, color: 'text-purple-500' },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
                      <item.icon size={15} className={`${item.color} mt-0.5 shrink-0`} />
                      <div><p className="text-xl font-bold dark:text-white">{item.value}</p><p className="text-xs font-medium text-gray-500 dark:text-slate-400">{item.label}</p><p className="text-[10px] text-gray-400">{item.sub}</p></div>
                    </div>
                  ))}
                </div>
                {dsfaRequired.length > 0 && (
                  <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/30 rounded-xl p-3">
                    <p className="text-xs font-bold text-purple-700 dark:text-purple-300 mb-2">DSFA-pflichtige Tätigkeiten (Art. 35)</p>
                    <div className="flex flex-wrap gap-2">{dsfaRequired.map(v => <span key={v.id} className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg">{v.name}</span>)}</div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {assessments.some((a: any) => a.risk_treatment === 'accept') && (
            <Card>
              <CardHeader><div className="flex items-center gap-2"><CheckCircle size={15} className="text-amber-500" /><h3 className="font-semibold dark:text-white text-sm">Risikoakzeptanzen (SBF)</h3></div></CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
                  {assessments.filter((a: any) => a.risk_treatment === 'accept').map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between px-5 py-3">
                      <div><p className="font-medium text-sm dark:text-slate-200">{a.Asset?.name || '–'}</p><p className="text-xs text-gray-400">{a.accepted_by || '–'}{a.accepted_until && ` · bis ${format(new Date(a.accepted_until), 'dd.MM.yyyy')}`}</p></div>
                      <Badge value={a.risk_level} label={riskLabels[a.risk_level] || a.risk_level} />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {overdueReminders.length > 0 && (
            <Card>
              <CardHeader><div className="flex items-center gap-2"><Clock size={15} className="text-red-500" /><h3 className="font-semibold dark:text-white text-sm">Überfällige Sicherheitsbewertungen</h3></div></CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {overdueReminders.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between px-5 py-3">
                      <div><p className="font-medium text-sm dark:text-slate-200">{r.Asset?.name || '–'}</p><p className="text-xs text-red-500">Fällig: {r.due_date ? format(new Date(r.due_date), 'dd.MM.yyyy') : '–'}{r.due_date && ` · ${Math.floor((Date.now() - new Date(r.due_date).getTime()) / 86400000)} Tage überfällig`}</p></div>
                      <Badge value="critical" label="Überfällig" />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* ── Sign-off Modal ── */}
      <Modal open={signOffModalOpen} onClose={() => setSignOffModalOpen(false)} title="Management-Review Freigabe">
        <form onSubmit={async e => {
          e.preventDefault(); setSignOffSaving(true);
          try {
            await api.post('/review/sign-off', { notes: signOffNotes, report_date: new Date().toISOString().slice(0, 10) });
            toast.success('Management-Review freigegeben'); setSignOffModalOpen(false); setSignOffNotes(''); loadSignOffs();
          } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
          finally { setSignOffSaving(false); }
        }} className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-400">Hiermit bestätigen Sie die Kenntnisnahme des aktuellen Management-Reports gemäß ISO 27001 Kap. 9.3.</p>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-900/40 text-sm">
            <p className="font-medium dark:text-slate-200">Berichtsstand: {format(new Date(), 'dd. MMMM yyyy', { locale: de })}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">ISMS Health Score: {healthScore}/100 — {healthLabel}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Anmerkungen (optional)</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={signOffNotes} onChange={e => setSignOffNotes(e.target.value)} placeholder="Beschlüsse, Maßnahmen, Kommentare..." />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setSignOffModalOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" disabled={signOffSaving} className="flex-1 justify-center">{signOffSaving ? 'Speichern...' : 'Freigabe erteilen'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
