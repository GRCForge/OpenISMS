import React from 'react';
import { Link } from 'react-router';
import { Activity, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RiskMonitoringSummary, RiskReviewTrigger } from '../../types';
import { Card, CardBody, CardHeader } from '../ui/Card';

// Risk monitoring figures (3.9.0) for the dashboard and the management report:
// trend, overdue reviews, KRI breaches, appetite breaches, open reassessments,
// expiring/expired acceptances. Counts only (GET /api/dashboard, /api/report/trends).

const TRIGGERS: RiskReviewTrigger[] = ['incident', 'audit_finding', 'threat_advisory', 'cve', 'kri', 'review_overdue'];

export const RiskMonitoringCard: React.FC<{ summary: RiskMonitoringSummary | null | undefined; showLink?: boolean }> = ({ summary, showLink = true }) => {
  const { t } = useTranslation('risks');
  if (!summary) return null;
  const s = summary;
  const item = (label: string, value: React.ReactNode, warn: boolean) => (
    <div className={`p-3 rounded-lg border ${warn ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20' : 'border-gray-200 dark:border-slate-700'}`}>
      <p className={`text-xl font-bold ${warn ? 'text-red-700 dark:text-red-400' : 'dark:text-white'}`}>{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-slate-400">{label}</p>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"><Activity size={16} className="text-blue-600 dark:text-blue-400" /><h2 className="font-semibold dark:text-white">{t('monitoring.cardTitle')}</h2></div>
          {showLink && <Link to="/risks/monitoring" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">{t('monitoring.open')} <ChevronRight size={12} /></Link>}
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {item(t('monitoring.kpiTrend', { days: s.trend?.days ?? 90 }), s.trend ? `${s.trend.improved} ↓ / ${s.trend.worsened} ↑` : '–', !!s.trend && s.trend.worsened > s.trend.improved)}
          {item(t('monitoring.kpiOverdue'), s.overdue_reviews, s.overdue_reviews > 0)}
          {item(t('monitoring.kpiKri'), s.kri_breaches, s.kri_breaches > 0)}
          {item(t('monitoring.kpiAppetite'), s.appetite_exceeded, s.appetite_exceeded > 0)}
          {item(t('monitoring.kpiReassessments'), s.open_reassessments, s.open_reassessments > 0)}
          {item(t('monitoring.kpiAcceptances'), `${s.acceptances_expiring} / ${s.acceptances_expired}`, s.acceptances_expired > 0)}
        </div>
        {s.open_reassessment_flags > 0 && (
          <p className="text-[11px] text-gray-500 dark:text-slate-400">
            {TRIGGERS.filter(x => s.open_reassessments_by_trigger[x] > 0).map(x => `${t(`monitoring.trigger.${x}`)}: ${s.open_reassessments_by_trigger[x]}`).join(' · ')}
          </p>
        )}
        <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('monitoring.cardHint', { due: s.reviews_due_30_days, methodology: s.methodology_reassessment })}</p>
      </CardBody>
    </Card>
  );
};
