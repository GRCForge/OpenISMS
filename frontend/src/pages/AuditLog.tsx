import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { Download, FileSpreadsheet, Calendar, ArrowRight } from 'lucide-react';
import { FilterBar } from '../components/ui/FilterBar';
import api from '../lib/api';
import type { AuditLog as AuditLogType, AuditAction, AuditEntityType } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { exportToCSV, exportToExcel } from '../lib/export';

const actionColors: Record<AuditAction, string> = {
  create: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  update: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  assess: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  login: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400',
  acknowledge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  deactivate: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  change_password: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  execute: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  seed: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  reseed: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
};

const entityColors: Record<AuditEntityType, string> = {
  asset: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  assessment: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  user: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  reminder: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  auth: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-500',
  vendor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  document: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  settings: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400',
  risk: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  control: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  incident: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  audit_log: 'bg-slate-100 text-slate-800 dark:bg-slate-850 dark:text-slate-400',
  dataflow: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
  task: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  vvt: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  training: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  user_training: 'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300',
  training_contest: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
  kpi: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  kpi_measurement: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300',
  audit: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  audit_finding: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  custom_role: 'bg-teal-100 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300',
  oidc_mapping: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  iso27001_control: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  bsi_requirement: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  tisax_requirement: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  tisax_assessment: 'bg-pink-100 text-pink-700 dark:bg-pink-900/20 dark:text-pink-300',
  nis2_measure: 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
  c5_criterion: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300',
  ai_system: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/20 dark:text-fuchsia-300',
  bcm_process: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400',
  bcm_exercise: 'bg-lime-100 text-lime-700 dark:bg-lime-900/20 dark:text-lime-300',
  dora_test: 'bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  dora_third_party: 'bg-sky-100 text-sky-600 dark:bg-sky-900/10 dark:text-sky-400',
  pentest_project: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300',
  pentest_finding: 'bg-red-100 text-red-600 dark:bg-red-900/10 dark:text-red-400',
  policy: 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300',
  legal_requirement: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
  subject_request: 'bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  dsfa: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  template: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

const DATE_KEYS = new Set([
  'eol_date', 'last_restore_test', 'due_date', 'cutoff', 'accepted_until',
  'completed_at', 'expires_at', 'date', 'last_review_date', 'start_date', 'end_date',
]);

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const formatValue = (t: any, key: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '–';
  if (Array.isArray(v)) return v.length ? v.map(x => t(`fwValues.${String(x)}`, { defaultValue: String(x) })).join(', ') : '–';
  if (typeof v === 'boolean') return v ? t('yes') : t('no');
  if (key === 'classification') return t(`classValues.${String(v)}`, { defaultValue: String(v) });
  if (key === 'type') return t(`typeValues.${String(v)}`, { defaultValue: String(v) });
  if (key === 'risk_level' || key === 'severity') return t(`riskValues.${String(v)}`, { defaultValue: String(v) });
  if (key === 'status') return t(`statusValues.${String(v)}`, { defaultValue: String(v) });
  if (key === 'lifecycle_status') return t(`lifecycleValues.${String(v)}`, { defaultValue: String(v) });
  if (key === 'implementation_status') return t(`implValues.${String(v)}`, { defaultValue: String(v) });
  if (key === 'modules' && typeof v === 'object' && v !== null) {
    const active = Object.entries(v as Record<string, boolean>).filter(([, on]) => on).map(([k]) => t(`moduleValues.${k}`, { defaultValue: k }));
    return active.length ? active.join(', ') : t('none');
  }
  if (DATE_KEYS.has(key)) {
    try { return format(new Date(String(v)), 'P'); } catch { return String(v); }
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const DetailsCell: React.FC<{ details?: any }> = ({ details: rawDetails }) => {
  const { t } = useTranslation('auditlog');
  if (!rawDetails) return <span className="text-gray-300 dark:text-slate-600">–</span>;

  let details = rawDetails;
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch { return <span className="text-xs break-all">{details}</span>; }
  }

  if (isRecord(details) && details['0'] !== undefined && details['1'] !== undefined) {
    try {
      const keys = Object.keys(details).filter(k => /^\d+$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
      const str = keys.map(k => (details as any)[k]).join('');
      details = JSON.parse(str);
      if (typeof details === 'string') details = JSON.parse(details);
    } catch { /* ignore */ }
  }

  if (!isRecord(details) || Object.keys(details).length === 0) {
    return <span className="text-xs break-all">{typeof details === 'string' ? details : JSON.stringify(details)}</span>;
  }

  if (isRecord(details.before) && isRecord(details.after)) {
    const before = details.before;
    const after = details.after;
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const changes = keys.filter(k => !sameValue(before[k], after[k]));

    if (changes.length === 0) return <span className="text-xs text-gray-400 dark:text-slate-500 italic">{t('details.noChanges')}</span>;

    return (
      <details className="cursor-pointer group">
        <summary className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline group-open:mb-2">{t('details.changes', { count: changes.length })}</summary>
        <div className="space-y-1.5 bg-gray-50 dark:bg-slate-900 p-2.5 rounded-lg border dark:border-slate-800">
          {changes.map(k => (
            <div key={k} className="text-xs grid grid-cols-[100px_1fr] sm:grid-cols-[120px_1fr_16px_1fr] items-start sm:items-center gap-1.5 sm:gap-2">
              <span className="font-semibold text-gray-700 dark:text-slate-300">{t(`fields.${k}`, { defaultValue: k })}</span>
              <span className="line-through text-red-500/80 dark:text-red-400/70 truncate" title={formatValue(t, k, before[k])}>{formatValue(t, k, before[k])}</span>
              <ArrowRight size={12} className="text-gray-400 shrink-0 hidden sm:block" />
              <span className="text-green-600 dark:text-green-400 font-medium truncate sm:col-start-4" title={formatValue(t, k, after[k])}>{formatValue(t, k, after[k])}</span>
            </div>
          ))}
        </div>
      </details>
    );
  }

  const entries = Object.entries(details).filter(([k]) => k !== 'before' && k !== 'after');
  if (entries.length === 0) return <span className="text-gray-300 dark:text-slate-600">–</span>;

  if (entries.length <= 2) {
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
        {entries.map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1 bg-gray-50 dark:bg-slate-900/50 px-2 py-0.5 rounded-lg border dark:border-slate-800 text-gray-600 dark:text-slate-400">
            <span className="font-semibold text-gray-500 dark:text-slate-500">{t(`fields.${k}`, { defaultValue: k })}:</span>
            <span className="text-gray-900 dark:text-slate-200 font-medium truncate max-w-[150px]" title={formatValue(t, k, v)}>{formatValue(t, k, v)}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <details className="cursor-pointer group">
      <summary className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline group-open:mb-2">{t('details.count', { count: entries.length })}</summary>
      <div className="bg-gray-50 dark:bg-slate-900 p-2.5 rounded-lg border dark:border-slate-800 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <span className="font-semibold text-gray-700 dark:text-slate-400 text-right">{t(`fields.${k}`, { defaultValue: k })}</span>
            <span className="text-gray-900 dark:text-slate-200 truncate" title={formatValue(t, k, v)}>{formatValue(t, k, v)}</span>
          </React.Fragment>
        ))}
      </div>
    </details>
  );
};

const PAGE_SIZE = 50;

export const AuditLogPage: React.FC = () => {
  const { t, i18n } = useTranslation('auditlog');
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  const actionLabels: Record<AuditAction, string> = {
    create: t('actions.create'), update: t('actions.update'), delete: t('actions.delete'),
    assess: t('actions.assess'), login: t('actions.login'), acknowledge: t('actions.acknowledge'),
    deactivate: t('actions.deactivate'), change_password: t('actions.change_password'), execute: t('actions.execute'),
    seed: t('actions.seed'), reseed: t('actions.reseed'),
  };

  const entityLabels: Record<AuditEntityType, string> = {
    asset: t('entities.asset'), assessment: t('entities.assessment'), user: t('entities.user'),
    reminder: t('entities.reminder'), auth: t('entities.auth'), vendor: t('entities.vendor'), document: t('entities.document'),
    settings: t('entities.settings'), risk: t('entities.risk'), control: t('entities.control'), incident: t('entities.incident'),
    audit_log: t('entities.audit_log'), dataflow: t('entities.dataflow'), task: t('entities.task'), vvt: t('entities.vvt'),
    training: t('entities.training'), user_training: t('entities.user_training'), training_contest: t('entities.training_contest'),
    kpi: t('entities.kpi'), kpi_measurement: t('entities.kpi_measurement'),
    audit: t('entities.audit'), audit_finding: t('entities.audit_finding'),
    custom_role: t('entities.custom_role'), oidc_mapping: t('entities.oidc_mapping'),
    iso27001_control: t('entities.iso27001_control'), bsi_requirement: t('entities.bsi_requirement'),
    tisax_requirement: t('entities.tisax_requirement'), tisax_assessment: t('entities.tisax_assessment'),
    nis2_measure: t('entities.nis2_measure'), c5_criterion: t('entities.c5_criterion'),
    ai_system: t('entities.ai_system'),
    bcm_process: t('entities.bcm_process'), bcm_exercise: t('entities.bcm_exercise'),
    dora_test: t('entities.dora_test'), dora_third_party: t('entities.dora_third_party'),
    pentest_project: t('entities.pentest_project'), pentest_finding: t('entities.pentest_finding'),
    policy: t('entities.policy'), legal_requirement: t('entities.legal_requirement'),
    subject_request: t('entities.subject_request'), dsfa: t('entities.dsfa'), template: t('entities.template'),
  };

  const [logs, setLogs] = useState<AuditLogType[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: p * PAGE_SIZE };
      if (entityType) params.entity_type = entityType;
      if (action) params.action = action;
      if (from) params.from = from;
      if (to) params.to = to;
      if (search) params.search = search;
      const { data } = await api.get('/audit-log', { params });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e) {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, entityType, action, from, to, search]);

  useEffect(() => { setPage(0); load(0); }, [entityType, action, from, to, search]);
  useEffect(() => { load(page); }, [page]);

  const flattenForExport = (rows: AuditLogType[]) =>
    rows.map(l => ({
      [t('export.id')]: l.id,
      [t('export.action')]: actionLabels[l.action] || l.action,
      [t('export.entity')]: entityLabels[l.entity_type] || l.entity_type,
      [t('export.name')]: l.entity_name || '',
      [t('export.performedBy')]: l.actor_name || '',
      [t('export.datetime')]: format(new Date(l.created_at), 'Ppp', { locale: dateFnsLocale }),
      [t('export.details')]: l.details ? JSON.stringify(l.details) : '',
      [t('export.ipAddress')]: l.ip_address || '',
    }));

  const handleExportCSV = async () => {
    const { data } = await api.get('/audit-log', { params: { limit: 5000, offset: 0, ...(entityType && { entity_type: entityType }), ...(action && { action }), ...(from && { from }), ...(to && { to }), ...(search && { search }) } });
    exportToCSV(flattenForExport(data.logs), `${t('export.filename')}-${format(new Date(), 'yyyyMMdd')}`);
  };

  const handleExportExcel = async () => {
    const { data } = await api.get('/audit-log', { params: { limit: 5000, offset: 0, ...(entityType && { entity_type: entityType }), ...(action && { action }), ...(from && { from }), ...(to && { to }), ...(search && { search }) } });
    await exportToExcel(flattenForExport(data.logs), `${t('export.filename')}-${format(new Date(), 'yyyyMMdd')}`, t('export.sheetName'));
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', { count: total })}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleExportCSV}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={handleExportExcel}><FileSpreadsheet size={14} />Excel</Button>
        </div>
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder={t('searchPlaceholder')}
        activeCount={[entityType, action, from, to].filter(Boolean).length}
        onReset={() => { setSearch(''); setEntityType(''); setAction(''); setFrom(''); setTo(''); }}
      >
        <Select value={entityType} onChange={e => setEntityType(e.target.value)} options={[{ value: '', label: t('filters.allEntities') }, ...Object.entries(entityLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select value={action} onChange={e => setAction(e.target.value)} options={[{ value: '', label: t('filters.allActions') }, ...Object.entries(actionLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={14} className="text-gray-400" />
          <span className="text-xs text-gray-500">{t('filters.from')}</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-xs text-gray-500">{t('filters.to')}</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </FilterBar>

      <Card>
        {loading ? (
          <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('table.datetime')}</Th>
                <Th>{t('table.action')}</Th>
                <Th>{t('table.entity')}</Th>
                <Th>{t('table.name')}</Th>
                <Th>{t('table.performedBy')}</Th>
                <Th>{t('table.details')}</Th>
              </tr>
            </Thead>
            <Tbody>
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <Td className="text-gray-500 dark:text-slate-500 text-xs whitespace-nowrap">{format(new Date(log.created_at), 'Ppp', { locale: dateFnsLocale })}</Td>
                  <Td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {actionLabels[log.action] || log.action}
                    </span>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${entityColors[log.entity_type] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {entityLabels[log.entity_type] || log.entity_type}
                    </span>
                  </Td>
                  <Td className="max-w-xs truncate font-medium dark:text-slate-200">{log.entity_name || '–'}</Td>
                  <Td className="dark:text-slate-400">{log.actor_name || '–'}</Td>
                  <Td className="max-w-sm">
                    <DetailsCell details={log.details} />
                  </Td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-500">{t('empty.noResults')}</td></tr>
              )}
            </Tbody>
          </Table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-slate-400">
          <span>{t('pagination.info', { current: page + 1, total: totalPages, count: total })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>{t('pagination.prev')}</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{t('pagination.next')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};
