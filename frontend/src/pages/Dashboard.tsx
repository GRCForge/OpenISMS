import React, { useEffect, useState } from 'react';
import {
  Server, AlertTriangle, Clock, CheckCircle, ShieldAlert,
  TrendingUp, Activity, BarChart3, ChevronRight, Rocket, ArrowRight,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import api from '../lib/api';
import type { DashboardData, RiskLevel, Classification } from '../types';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Link } from 'react-router-dom';
import { Skeleton, SkeletonStatCard, SkeletonCard } from '../components/ui/Skeleton';

const riskColors: Record<RiskLevel, string> = { low: 'bg-green-500', medium: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500' };
const classColors: Record<string, string> = { public: 'bg-green-400', internal: 'bg-blue-400', confidential: 'bg-orange-400', secret: 'bg-red-500' };

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
  const { t } = useTranslation(['dashboard', 'risks', 'common']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  const riskLabels: Record<string, string> = {
    low: t('risks:levels.low'), medium: t('risks:levels.medium'),
    high: t('risks:levels.high'), critical: t('risks:levels.critical'),
  };
  const classLabels: Record<string, string> = {
    public: t('common:classification.public'), internal: t('common:classification.internal'),
    confidential: t('common:classification.confidential'), secret: t('common:classification.secret'),
  };
  const typeLabels: Record<string, string> = {
    hardware: t('common:assetTypes.hardware'), software: t('common:assetTypes.software'),
    information: t('common:assetTypes.information'), process: t('common:assetTypes.process'),
    service: t('common:assetTypes.service'), personal: t('common:assetTypes.personal'),
    application: t('common:assetTypes.application'), data: t('common:assetTypes.data'),
    ai_application: t('common:assetTypes.ai_application'), ai_agent: t('common:assetTypes.ai_agent'),
    other: t('common:assetTypes.other'),
  };

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
    <div className="space-y-6" role="status" aria-label={t('dashboard:loading')}>
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
  if (!data) return (
    <div className="p-6 text-gray-500 flex flex-col items-center gap-3 py-20">
      <p>{t('dashboard:error')}</p>
      <button onClick={load} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('common:actions.retry')}</button>
    </div>
  );

  const totalRisk = data.riskDistribution.reduce((s, r) => s + parseInt(r.count), 0);

  const isNewSystem = data.stats.totalAssets === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('dashboard:title')}</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm mt-0.5">{`${t('dashboard:subtitle')} · ${format(new Date(), 'd MMMM yyyy', { locale: dateFnsLocale })}`}</p>
      </div>

      {isNewSystem && (
        <Card className="border-blue-200 dark:border-blue-800/50 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <CardBody className="py-5">
            <div className="flex items-start gap-4">
              <div className="p-2.5 rounded-xl bg-blue-600 shrink-0"><Rocket className="text-white" size={20} /></div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-gray-900 dark:text-white">{t('dashboard:welcome.title')}</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{t('dashboard:welcome.subtitle')}</p>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { step: '1', label: t('dashboard:welcome.steps.createAsset.label'), desc: t('dashboard:welcome.steps.createAsset.hint'), href: '/assets' },
                    { step: '2', label: t('dashboard:welcome.steps.assess.label'), desc: t('dashboard:welcome.steps.assess.hint'), href: '/assessments' },
                    { step: '3', label: t('dashboard:welcome.steps.risks.label'), desc: t('dashboard:welcome.steps.risks.hint'), href: '/risks' },
                    { step: '4', label: t('dashboard:welcome.steps.controls.label'), desc: t('dashboard:welcome.steps.controls.hint'), href: '/controls' },
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
        <StatCard label={t('dashboard:stats.totalAssets')} value={data.stats.totalAssets} icon={Server} color="bg-blue-500" sub={`${data.stats.activeAssets} ${t('common:status.active')}`} />
        <StatCard label={t('dashboard:stats.highCritical')} value={data.stats.highRisk} icon={ShieldAlert} color={data.stats.highRisk > 0 ? 'bg-red-500' : 'bg-gray-400 dark:bg-slate-800'} warn={data.stats.highRisk > 0} />
        <StatCard label={t('dashboard:stats.overdueReviews')} value={data.stats.overdueReminders} icon={AlertTriangle} color={data.stats.overdueReminders > 0 ? 'bg-red-500' : 'bg-gray-400 dark:bg-slate-800'} warn={data.stats.overdueReminders > 0} />
        <StatCard label={t('dashboard:stats.reviewsIn30Days')} value={data.stats.upcomingReminders} icon={Clock} color="bg-yellow-500" />
        <StatCard label={t('dashboard:stats.compliance')} value={`${data.stats.compliancePct}%`} icon={CheckCircle} color={data.stats.compliancePct >= 80 ? 'bg-green-500' : data.stats.compliancePct >= 50 ? 'bg-yellow-500' : 'bg-orange-500'} sub={t('dashboard:stats.frameworkCoverage')} />
        <StatCard label={t('dashboard:stats.assessed')} value={`${totalRisk} / ${data.stats.totalAssets}`} icon={TrendingUp} color="bg-purple-500" sub={t('dashboard:stats.assetsAssessed', { total: data.stats.totalAssets })} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><div className="flex items-center gap-2"><BarChart3 size={16} className="text-blue-600 dark:text-blue-400" /><h2 className="font-semibold dark:text-white">{t('dashboard:sections.riskDistribution')}</h2></div></CardHeader>
          <CardBody className="space-y-3">
            {totalRisk === 0 ? (
              <div className="text-center py-6">
                <ShieldAlert size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">{t('dashboard:sections.noRiskAssessments')}</p>
                <Link to="/assessments" className="text-xs text-blue-500 hover:underline mt-1 inline-block">{t('dashboard:sections.startAssessment')}</Link>
              </div>
            ) :
              (['critical', 'high', 'medium', 'low'] as RiskLevel[]).map(level => {
                const c = parseInt(data.riskDistribution.find(r => r.risk_level === level)?.count || '0');
                return <BarRow key={level} label={riskLabels[level]} badge={level} count={c} total={totalRisk} color={riskColors[level]} />;
              })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center gap-2"><Server size={16} className="text-indigo-600 dark:text-indigo-400" /><h2 className="font-semibold dark:text-white">{t('dashboard:sections.byClassification')}</h2></div></CardHeader>
          <CardBody className="space-y-3">
            {data.stats.activeAssets === 0 ? (
              <div className="text-center py-6">
                <Server size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">{t('dashboard:sections.noActiveAssets')}</p>
                <Link to="/assets" className="text-xs text-blue-500 hover:underline mt-1 inline-block">{t('dashboard:sections.createAsset')}</Link>
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
            <div className="flex items-center gap-2"><Clock size={16} className="text-orange-500 dark:text-orange-400" /><h2 className="font-semibold dark:text-white">{t('dashboard:sections.upcomingReviews')}</h2></div>
            <Link to="/reminders" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 transition-colors">{t('dashboard:sections.all')} <ChevronRight size={12} /></Link>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {data.upcomingReminders.length === 0 ? (
            <div className="text-center py-8">
              <Clock size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
              <p className="text-sm text-gray-400 dark:text-slate-500">{t('dashboard:sections.noReviews')}</p>
              <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">{t('dashboard:sections.reviewsScheduled')}</p>
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
                    <span className="text-sm text-gray-600 dark:text-slate-400 font-mono">{format(new Date(r.due_date), 'P', { locale: dateFnsLocale })}</span>
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
              <div className="flex items-center gap-2"><CheckCircle size={16} className="text-green-600 dark:text-green-400" /><h2 className="font-semibold dark:text-white">{t('dashboard:sections.complianceFrameworks')}</h2></div>
              <Link to="/compliance" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 transition-colors">{t('dashboard:sections.details')} <ChevronRight size={12} /></Link>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {data.frameworkCoverage.total === 0 ? (
              <div className="text-center py-6">
                <CheckCircle size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">{t('dashboard:sections.noFrameworkAssets')}</p>
                <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">{t('dashboard:sections.assignFrameworks')}</p>
              </div>
            ) : <>
              <FwBar label="ISO 27001" count={data.frameworkCoverage.iso27001} total={data.frameworkCoverage.total} color="bg-blue-500" />
              <FwBar label="NIS-2" count={data.frameworkCoverage.nis2} total={data.frameworkCoverage.total} color="bg-purple-500" />
              <FwBar label="DSGVO / GDPR" count={data.frameworkCoverage.gdpr} total={data.frameworkCoverage.total} color="bg-green-500" />
              <p className="text-xs text-gray-400 dark:text-slate-500 pt-1 border-t border-gray-100 dark:border-slate-800 transition-colors">{`${t('dashboard:sections.minOneFramework')} ${data.stats.compliancePct}%`}</p>
            </>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center gap-2"><Activity size={16} className="text-gray-500 dark:text-slate-400" /><h2 className="font-semibold dark:text-white">{t('dashboard:sections.recentActivity')}</h2></div></CardHeader>
          <CardBody className="p-0">
            {data.recentActivity.length === 0 ? (
              <div className="text-center py-8">
                <Activity size={28} className="mx-auto mb-2 text-gray-300 dark:text-slate-600" />
                <p className="text-sm text-gray-400 dark:text-slate-500">{t('dashboard:sections.noActivity')}</p>
                <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">{t('dashboard:sections.allChangesLogged')}</p>
              </div>
            ) :
              <div className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {data.recentActivity.map(log => (
                  <div key={log.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-slate-800/30 transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm leading-snug dark:text-slate-300">
                        {t('dashboard:sections.activityText', {
                          actor: log.actor_name,
                          action: t(`common:auditActions.${log.action}`, log.action),
                          name: log.entity_name || '',
                          type: log.entity_type ? t(`dashboard:entityLabels.${log.entity_type}`, log.entity_type) : '',
                        })}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: dateFnsLocale })}</p>
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
