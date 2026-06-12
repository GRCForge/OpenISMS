import React, { useEffect, useState } from 'react';
import {
  Server, AlertTriangle, Clock, CheckCircle, ShieldAlert,
  TrendingUp, Activity, BarChart3, ChevronRight, Rocket, ArrowRight,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../lib/api';
import type { DashboardData, RiskLevel, Classification } from '../types';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Link } from 'react-router-dom';
import { Skeleton, SkeletonStatCard, SkeletonCard } from '../components/ui/Skeleton';

const riskLabels: Record<RiskLevel, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
const riskColors: Record<RiskLevel, string> = { low: 'bg-green-500', medium: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500' };
const classLabels: Record<Classification, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };
const classColors: Record<string, string> = { public: 'bg-green-400', internal: 'bg-blue-400', confidential: 'bg-orange-400', secret: 'bg-red-500' };

const typeLabels: Record<string, string> = { 
  hardware: 'Hardware', software: 'Software', information: 'Information/Daten', 
  process: 'Prozess', service: 'Service', personal: 'Personal',
  application: 'Anwendung', data: 'Daten', other: 'Sonstiges'
};

const actionLabels: Record<string, string> = {
  create: 'erstellt', update: 'bearbeitet', delete: 'gelöscht',
  assess: 'bewertet', login: 'angemeldet', acknowledge: 'bestätigt', deactivate: 'deaktiviert',
};
const entityLabels: Record<string, string> = {
  asset: 'Asset', assessment: 'Bewertung', user: 'Benutzer', reminder: 'Erinnerung', auth: '',
  vendor: 'Dienstleister', document: 'Dokument'
};

const StatCard: React.FC<{
  label: string; value: string | number; icon: React.FC<any>;
  color: string; sub?: string; warn?: boolean;
}> = ({ label, value, icon: Icon, color, sub, warn }) => (
  <Card className={warn ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20' : ''}>
    <CardBody className="flex items-center gap-4 py-4">
      <div className={`p-3 rounded-xl ${color} shrink-0`}><Icon className="text-white" size={20} /></div>
      <div className="min-w-0">
        <p className={`text-2xl font-bold ${warn ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{value}</p>
        <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{label}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-slate-500">{sub}</p>}
      </div>
    </CardBody>
  </Card>
);

const BarRow: React.FC<{ label: string; badge?: string; count: number; total: number; color: string }> = ({ label, badge, count, total, color }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0">{badge ? <Badge value={badge} label={label} /> : <span className="text-sm text-gray-600 dark:text-slate-400">{label}</span>}</span>
      <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2">
        <div className={`h-2 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-medium text-gray-700 dark:text-slate-300 w-8 text-right">{count}</span>
    </div>
  );
};

const FwBar: React.FC<{ label: string; count: number; total: number; color: string }> = ({ label, count, total, color }) => {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium dark:text-slate-200">{label}</span>
        <span className="text-gray-500 dark:text-slate-400">{count}/{total} <span className="text-xs text-gray-400">({pct}%)</span></span>
      </div>
      <div className="bg-gray-100 dark:bg-slate-800 rounded-full h-2.5">
        <div className={`h-2.5 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/dashboard')
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="space-y-6" role="status" aria-label="Dashboard wird geladen">
      <div><Skeleton className="h-7 w-44 mb-1" /><Skeleton className="h-4 w-72" /></div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonStatCard key={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonCard lines={5} /><SkeletonCard lines={5} />
      </div>
      <SkeletonCard lines={3} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonCard lines={4} /><SkeletonCard lines={4} />
      </div>
    </div>
  );
  if (!data) return <div className="p-6 text-gray-500 flex flex-col items-center gap-3 py-20"><p>Dashboard konnte nicht geladen werden.</p><button onClick={load} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Erneut versuchen</button></div>;

  const totalRisk = data.riskDistribution.reduce((s, r) => s + parseInt(r.count), 0);

  const isNewSystem = data.stats.totalAssets === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm mt-0.5">Übersicht der Informationssicherheit · {format(new Date(), 'dd. MMMM yyyy', { locale: de })}</p>
      </div>

      {isNewSystem && (
        <Card className="border-blue-200 dark:border-blue-800/50 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <CardBody className="py-5">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-blue-600 shrink-0"><Rocket className="text-white" size={20} /></div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-900 dark:text-white">Willkommen bei OpenISMS!</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Starten Sie in wenigen Schritten mit Ihrer Informationssicherheits-Dokumentation.</p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { step: '1', label: 'Asset anlegen', desc: 'Server, Anwendung oder Daten erfassen', href: '/assets' },
                    { step: '2', label: 'Schutzbedarf bewerten', desc: 'Vertraulichkeit, Integrität, Verfügbarkeit', href: '/assessments' },
                    { step: '3', label: 'Risiken identifizieren', desc: 'Bedrohungen & Schwachstellen dokumentieren', href: '/risks' },
                    { step: '4', label: 'Maßnahmen zuordnen', desc: 'ISO 27001 Controls & SoA verwalten', href: '/controls' },
                  ].map(s => (
                    <Link key={s.step} to={s.href} className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-slate-800/60 border border-blue-100 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-sm transition-all group">
                      <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{s.step}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex items-center gap-1">{s.label}<ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" /></p>
                        <p className="text-xs text-gray-400 dark:text-slate-500 leading-snug">{s.desc}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Assets gesamt" value={data.stats.totalAssets} icon={Server} color="bg-blue-500" sub={`${data.stats.activeAssets} aktiv`} />
        <StatCard label="Hoch / Kritisch" value={data.stats.highRisk} icon={ShieldAlert} color={data.stats.highRisk > 0 ? 'bg-red-500' : 'bg-gray-400 dark:bg-slate-800'} warn={data.stats.highRisk > 0} />
        <StatCard label="Überfällige Reviews" value={data.stats.overdueReminders} icon={AlertTriangle} color={data.stats.overdueReminders > 0 ? 'bg-red-500' : 'bg-gray-400 dark:bg-slate-800'} warn={data.stats.overdueReminders > 0} />
        <StatCard label="Reviews in 30 Tagen" value={data.stats.upcomingReminders} icon={Clock} color="bg-yellow-500" />
        <StatCard label="Compliance" value={`${data.stats.compliancePct}%`} icon={CheckCircle} color={data.stats.compliancePct >= 80 ? 'bg-green-500' : data.stats.compliancePct >= 50 ? 'bg-yellow-500' : 'bg-orange-500'} sub="Framework-Abdeckung" />
        <StatCard label="Bewertet" value={`${totalRisk} / ${data.stats.totalAssets}`} icon={TrendingUp} color="bg-purple-500" sub={`von ${data.stats.totalAssets} Assets bewertet`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><div className="flex items-center gap-2"><BarChart3 size={16} className="text-blue-600 dark:text-blue-400" /><h2 className="font-semibold dark:text-white">Risikoverteilung</h2></div></CardHeader>
          <CardBody className="space-y-3">
            {totalRisk === 0 ? (
              <div className="text-center py-6">
                <ShieldAlert size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">Noch keine Risikobewertungen</p>
                <Link to="/assessments" className="text-xs text-blue-500 hover:underline mt-1 inline-block">Erste Bewertung starten →</Link>
              </div>
            ) :
              (['critical', 'high', 'medium', 'low'] as RiskLevel[]).map(level => {
                const c = parseInt(data.riskDistribution.find(r => r.risk_level === level)?.count || '0');
                return <BarRow key={level} label={riskLabels[level]} badge={level} count={c} total={totalRisk} color={riskColors[level]} />;
              })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center gap-2"><Server size={16} className="text-indigo-600 dark:text-indigo-400" /><h2 className="font-semibold dark:text-white">Nach Klassifizierung</h2></div></CardHeader>
          <CardBody className="space-y-3">
            {data.stats.activeAssets === 0 ? (
              <div className="text-center py-6">
                <Server size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">Noch keine aktiven Assets</p>
                <Link to="/assets" className="text-xs text-blue-500 hover:underline mt-1 inline-block">Asset anlegen →</Link>
              </div>
            ) :
              (['secret', 'confidential', 'internal', 'public'] as Classification[]).map(cls => {
                const c = parseInt(data.assetsByClassification.find(a => a.classification === cls)?.count || '0');
                if (!c) return null;
                return <BarRow key={cls} label={classLabels[cls]} badge={cls} count={c} total={data.stats.activeAssets} color={classColors[cls]} />;
              })}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Clock size={16} className="text-orange-500 dark:text-orange-400" /><h2 className="font-semibold dark:text-white">Anstehende Reviews (nächste 30 Tage)</h2></div>
            <Link to="/reminders" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 transition-colors">Alle <ChevronRight size={12} /></Link>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {data.upcomingReminders.length === 0 ? (
            <div className="text-center py-8">
              <Clock size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
              <p className="text-sm text-gray-400 dark:text-slate-500">Keine Reviews in den nächsten 30 Tagen</p>
              <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">Reviews werden automatisch nach der Erstbewertung geplant.</p>
            </div>
          ) :
            <div className="divide-y divide-gray-100 dark:divide-slate-800/50">
              {data.upcomingReminders.map(r => (
                <Link key={r.id} to={`/assets/${r.asset_id}`} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                    <div>
                      <p className="font-medium text-sm dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{r.Asset?.name}</p>
                      <p className="text-xs text-gray-400 dark:text-slate-500">{typeLabels[r.Asset?.type || ''] || r.Asset?.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Badge value={r.Asset?.classification || ''} label={classLabels[r.Asset?.classification as Classification]} />
                    <span className="text-sm text-gray-600 dark:text-slate-400 font-mono">{format(new Date(r.due_date), 'dd.MM.yyyy', { locale: de })}</span>
                    <ChevronRight size={16} className="text-gray-300 dark:text-slate-600 group-hover:text-blue-500 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><CheckCircle size={16} className="text-green-600 dark:text-green-400" /><h2 className="font-semibold dark:text-white">Compliance Frameworks</h2></div>
              <Link to="/compliance" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 transition-colors">Details <ChevronRight size={12} /></Link>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {data.frameworkCoverage.total === 0 ? (
              <div className="text-center py-6">
                <CheckCircle size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">Noch keine Assets mit Framework-Zuordnung</p>
                <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">Weisen Sie Assets den Frameworks ISO 27001, NIS-2 oder DSGVO zu.</p>
              </div>
            ) : <>
              <FwBar label="ISO 27001" count={data.frameworkCoverage.iso27001} total={data.frameworkCoverage.total} color="bg-blue-500" />
              <FwBar label="NIS-2" count={data.frameworkCoverage.nis2} total={data.frameworkCoverage.total} color="bg-purple-500" />
              <FwBar label="DSGVO / GDPR" count={data.frameworkCoverage.gdpr} total={data.frameworkCoverage.total} color="bg-green-500" />
              <p className="text-xs text-gray-400 dark:text-slate-500 pt-1 border-t border-gray-100 dark:border-slate-800 transition-colors">Mindestens ein Framework: {data.stats.compliancePct}% der aktiven Assets</p>
            </>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center gap-2"><Activity size={16} className="text-gray-500 dark:text-slate-400" /><h2 className="font-semibold dark:text-white">Letzte Aktivitäten</h2></div></CardHeader>
          <CardBody className="p-0">
            {data.recentActivity.length === 0 ? (
              <div className="text-center py-8">
                <Activity size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">Noch keine Aktivitäten</p>
                <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">Alle Änderungen werden hier protokolliert.</p>
              </div>
            ) :
              <div className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {data.recentActivity.map(log => (
                  <div key={log.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug dark:text-slate-300">
                        <span className="font-medium dark:text-white">{log.actor_name}</span>
                        {log.entity_name && <> hat <span className="text-blue-700 dark:text-blue-400">„{log.entity_name}"</span></>}
                        {' '}{entityLabels[log.entity_type] && <span className="text-gray-400 dark:text-slate-500">({entityLabels[log.entity_type]})</span>} {actionLabels[log.action] || log.action}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: de })}</p>
                    </div>
                  </div>
                ))}
              </div>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
