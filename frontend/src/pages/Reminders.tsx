import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CheckCircle, AlertTriangle, Download, FileSpreadsheet } from 'lucide-react';
import { FilterBar } from '../components/ui/FilterBar';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import api from '../lib/api';
import type { Reminder, Classification } from '../types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { Select } from '../components/ui/Select';
import { exportToCSV, exportToExcel } from '../lib/export';
import { useToast } from '../contexts/ToastContext';

export const Reminders: React.FC = () => {
  const toast = useToast();
  const { t, i18n } = useTranslation('reminders');
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);

  const statusLabels: Record<string, string> = {
    pending: t('status.pending'),
    acknowledged: t('status.acknowledged'),
    overdue: t('status.overdue'),
    completed: t('status.completed'),
  };

  const load = () => {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    api.get('/reminders', { params }).then(r => setReminders(r.data)).catch(() => setReminders([])).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const acknowledge = async (id: number) => {
    try {
      await api.patch(`/reminders/${id}/acknowledge`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.acknowledgeError'));
    }
  };

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  const today = new Date();
  const ninetyDaysFromNow = new Date();
  ninetyDaysFromNow.setDate(today.getDate() + 90);

  const filteredReminders = reminders.filter(r => {
    if (!showAll && r.status === 'pending') {
      const dueDate = new Date(r.due_date);
      if (dueDate > ninetyDaysFromNow) return false;
    }
    if (search && !r.Asset?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const overdue = reminders.filter(r => r.status === 'overdue').length;
  const pending = reminders.filter(r => r.status === 'pending').length;

  const flattenForExport = (rows: Reminder[]) => rows.map(r => ({
    [t('export.id')]: r.id,
    [t('export.asset')]: r.Asset?.name || t('unknown'),
    [t('export.assetType')]: r.Asset?.type || '',
    [t('export.classification')]: t(`common:classification.${r.Asset?.classification || ''}`, { defaultValue: r.Asset?.classification || '' }),
    [t('export.dueDate')]: r.due_date ? format(new Date(r.due_date), 'P', { locale: dateFnsLocale }) : '',
    [t('export.status')]: statusLabels[r.status] || r.status,
    [t('export.acknowledgedAt')]: r.acknowledged_at ? format(new Date(r.acknowledged_at), 'Pp', { locale: dateFnsLocale }) : '',
    [t('export.notes')]: r.notes || '',
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {overdue > 0 && `${t('overdueCount', { count: overdue })} · `}{t('pendingCount', { count: pending })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(flattenForExport(filteredReminders), `${t('export.filename')}-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(flattenForExport(filteredReminders), `${t('export.filename')}-${format(new Date(), 'yyyyMMdd')}`, t('export.sheetName'))}><FileSpreadsheet size={14} />Excel</Button>
        </div>
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder={t('searchPlaceholder')}
        activeCount={[statusFilter, showAll ? 'all' : ''].filter(Boolean).length}
        onReset={() => { setSearch(''); setStatusFilter(''); setShowAll(false); }}
      >
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
          { value: '', label: t('filters.allStatus') },
          { value: 'overdue', label: t('status.overdue') },
          { value: 'pending', label: t('status.pending') },
          { value: 'acknowledged', label: t('status.acknowledged') },
          { value: 'completed', label: t('status.completed') },
        ]} />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 cursor-pointer whitespace-nowrap shrink-0">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="rounded text-blue-600" />
          {t('filters.showDistantFuture')}
        </label>
      </FilterBar>

      {overdue > 0 && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-xl p-4 transition-colors">
          <AlertTriangle className="text-red-500 shrink-0" size={20} />
          <p className="text-sm text-red-700 dark:text-red-400">
            <strong>{t('overdueAlertBold', { count: overdue })}</strong>{t('overdueAlertRest')}
          </p>
        </div>
      )}

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>{t('table.asset')}</Th>
              <Th className="hidden sm:table-cell">{t('table.classification')}</Th>
              <Th className="hidden sm:table-cell">{t('table.dueDate')}</Th>
              <Th>{t('table.status')}</Th>
              <Th className="text-right">{t('table.actions')}</Th>
            </tr>
          </Thead>
          <Tbody>
            {filteredReminders.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <Td>
                  <div className="flex flex-col">
                    <Link to={`/assets/${r.asset_id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{r.Asset?.name || t('unknown')}</Link>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{r.Asset?.type}</p>
                    <div className="flex sm:hidden gap-1 mt-1">
                       <span className={r.status === 'overdue' ? 'text-red-600 dark:text-red-400 font-bold text-[10px]' : 'text-gray-400 text-[10px]'}>
                          {r.due_date ? format(new Date(r.due_date), 'P', { locale: dateFnsLocale }) : '-'}
                       </span>
                    </div>
                  </div>
                </Td>
                <Td className="hidden sm:table-cell">
                  <Badge value={r.Asset?.classification || ''} label={t(`common:classification.${r.Asset?.classification as Classification}`, { defaultValue: r.Asset?.classification || '' })} />
                </Td>
                <Td className="hidden sm:table-cell">
                  <span className={r.status === 'overdue' ? 'text-red-600 dark:text-red-400 font-semibold' : 'dark:text-slate-300'}>
                    {r.due_date ? format(new Date(r.due_date), 'P', { locale: dateFnsLocale }) : '-'}
                  </span>
                  {r.status === 'overdue' && <p className="text-xs text-red-500 dark:text-red-400">{t('overdueBadge')}</p>}
                </Td>
                <Td><Badge value={r.status} label={statusLabels[r.status]} /></Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    <Link to={`/assets/${r.asset_id}`} className="shrink-0"><Button size="sm" variant="secondary" title={t('actions.assess')}>{t('actions.assess')}</Button></Link>
                    {(r.status === 'pending' || r.status === 'overdue') && (
                      <Button size="sm" variant="ghost" onClick={() => acknowledge(r.id)} title={t('actions.acknowledge')}><CheckCircle size={14} /><span className="hidden md:inline">{t('actions.acknowledge')}</span></Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {reminders.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">{t('empty.noResults')}</td></tr>}
          </Tbody>
        </Table>
      </Card>
    </div>
  );
};
