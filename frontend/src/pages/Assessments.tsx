import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { TrendingUp, TrendingDown, Minus, Download, FileSpreadsheet, FolderOpen, FileText } from 'lucide-react';
import api from '../lib/api';
import type { Assessment, RiskLevel, Classification, Template } from '../types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { FilterBar } from '../components/ui/FilterBar';
import { exportToCSV, exportToExcel } from '../lib/export';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const riskLabels: Record<string, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
const classLabels: Record<string, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };
const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

type Trend = 'up' | 'down' | 'same' | 'first';

const TrendBadge: React.FC<{ trend: Trend }> = ({ trend }) => {
  if (trend === 'up') return <span title="Risiko gestiegen"><TrendingUp size={13} className="text-red-500" /></span>;
  if (trend === 'down') return <span title="Risiko gesunken"><TrendingDown size={13} className="text-green-500" /></span>;
  if (trend === 'same') return <span title="Unverändert"><Minus size={13} className="text-gray-400 dark:text-slate-500" /></span>;
  return null;
};

export const Assessments: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [currentOnly, setCurrentOnly] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

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
      toast.error('Download fehlgeschlagen');
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

  useEffect(() => {
    api.get('/assessments').then(r => setAssessments(r.data)).catch(() => setAssessments([])).finally(() => setLoading(false));
    api.get('/templates?category=assessment').then(r => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  const activeFilterCount = [riskFilter, currentOnly ? 'current' : ''].filter(Boolean).length;

  const trendMap = useMemo<Record<number, Trend>>(() => {
    const byAsset: Record<number, Assessment[]> = {};
    assessments.forEach(a => {
      if (!byAsset[a.asset_id]) byAsset[a.asset_id] = [];
      byAsset[a.asset_id].push(a);
    });
    const map: Record<number, Trend> = {};
    Object.values(byAsset).forEach(list => {
      const sorted = [...list].sort((a, b) => new Date(b.assessed_at).getTime() - new Date(a.assessed_at).getTime());
      sorted.forEach((a, idx) => {
        if (idx === sorted.length - 1) { map[a.id] = 'first'; return; }
        const prev = sorted[idx + 1];
        map[a.id] = a.risk_score > prev.risk_score ? 'up' : a.risk_score < prev.risk_score ? 'down' : 'same';
      });
    });
    return map;
  }, [assessments]);

  const filtered = useMemo(() => assessments.filter(a => {
    if (search && !a.Asset?.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (riskFilter && a.risk_level !== riskFilter) return false;
    if (currentOnly && !a.is_current) return false;
    return true;
  }), [assessments, search, riskFilter, currentOnly]);

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  const flattenForExport = (rows: Assessment[]) => rows.map(a => ({
    'ID': a.id,
    'Asset': a.Asset?.name || '',
    'Asset-Typ': a.Asset?.type || '',
    'Klassifizierung': classLabels[a.Asset?.classification || ''] || a.Asset?.classification || '',
    'Vertraulichkeit (C)': a.confidentiality,
    'Integrität (I)': a.integrity,
    'Verfügbarkeit (A)': a.availability,
    'Risiko-Score': a.risk_score?.toFixed(2) || '0.00',
    'Risiko-Level': riskLabels[a.risk_level] || a.risk_level,
    'Bewerter': a.assessorUser?.name || '',
    'Bewertet am': a.assessed_at ? format(new Date(a.assessed_at), 'dd.MM.yyyy HH:mm', { locale: de }) : '',
    'Nächste Prüfung': a.next_review_at ? format(new Date(a.next_review_at), 'dd.MM.yyyy', { locale: de }) : '',
    'Aktuell': a.is_current ? 'Ja' : 'Nein',
    'Notizen': a.notes || '',
    'Maßnahmen': a.mitigation || '',
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Alle Bewertungen</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{filtered.length} von {assessments.length} Bewertungen</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(flattenForExport(filtered), `bewertungen-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(flattenForExport(filtered), `bewertungen-${format(new Date(), 'yyyyMMdd')}`, 'Bewertungen')}><FileSpreadsheet size={14} />Excel</Button>
        </div>
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder="Asset suchen..."
        activeCount={activeFilterCount}
        onReset={() => { setSearch(''); setRiskFilter(''); setCurrentOnly(false); }}
      >
        <Select
          value={riskFilter}
          onChange={e => setRiskFilter(e.target.value)}
          options={[
            { value: '', label: 'Alle Risiken' },
            { value: 'critical', label: 'Kritisch' },
            { value: 'high', label: 'Hoch' },
            { value: 'medium', label: 'Mittel' },
            { value: 'low', label: 'Gering' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-400 cursor-pointer whitespace-nowrap shrink-0">
          <input
            type="checkbox"
            checked={currentOnly}
            onChange={e => setCurrentOnly(e.target.checked)}
            className="rounded border-gray-300 text-blue-600"
          />
          Nur aktuelle
        </label>
      </FilterBar>

      <Card>
        <Table>
          <Thead>
            <tr>
              <Th>Asset</Th>
              <Th className="hidden md:table-cell">Klasse</Th>
              <Th className="hidden sm:table-cell">C</Th>
              <Th className="hidden sm:table-cell">I</Th>
              <Th className="hidden sm:table-cell">A</Th>
              <Th className="hidden sm:table-cell">Score</Th>
              <Th className="hidden sm:table-cell">Risiko</Th>
              <Th className="hidden lg:table-cell">Trend</Th>
              <Th className="hidden md:table-cell">Bewerter</Th>
              <Th className="hidden md:table-cell">Datum</Th>
              <Th className="hidden sm:table-cell">Nächste Prüfung</Th>
              <Th className="hidden sm:table-cell">Status</Th>
            </tr>
          </Thead>
          <Tbody>
            {filtered.map(a => {
              const trend = trendMap[a.id];
              const isOverdue = a.next_review_at && new Date(a.next_review_at) < new Date();
              return (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <Td>
                    <div className="flex flex-col">
                      <Link to={`/assets/${a.asset_id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{a.Asset?.name || 'Unbekannt'}</Link>
                      <div className="flex sm:hidden gap-1 mt-1">
                        <Badge size="xs" value={a.risk_level} label={riskLabels[a.risk_level] || a.risk_level} />
                        <span className={`text-[10px] font-bold ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                          {a.next_review_at ? format(new Date(a.next_review_at), 'dd.MM.yy') : '-'}
                        </span>
                      </div>
                    </div>
                  </Td>
                  <Td className="hidden md:table-cell"><Badge value={a.Asset?.classification || ''} label={classLabels[a.Asset?.classification as Classification] || a.Asset?.classification} /></Td>
                  <Td className="hidden sm:table-cell"><span className={`font-medium text-sm px-1 rounded ${a.confidentiality >= 4 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'dark:text-slate-300'}`}>{a.confidentiality}</span></Td>
                  <Td className="hidden sm:table-cell"><span className={`font-medium text-sm px-1 rounded ${a.integrity >= 4 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'dark:text-slate-300'}`}>{a.integrity}</span></Td>
                  <Td className="hidden sm:table-cell"><span className={`font-medium text-sm px-1 rounded ${a.availability >= 4 ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'dark:text-slate-300'}`}>{a.availability}</span></Td>
                  <Td className="hidden sm:table-cell">
                    <span className={`font-semibold tabular-nums ${riskOrder[a.risk_level] >= 2 ? 'text-red-600 dark:text-red-400' : riskOrder[a.risk_level] === 1 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                      {a.risk_score?.toFixed(2) || '0.00'}
                    </span>
                  </Td>
                  <Td className="hidden sm:table-cell"><Badge value={a.risk_level} label={riskLabels[a.risk_level as RiskLevel] || a.risk_level} /></Td>
                  <Td className="hidden lg:table-cell"><div className="flex justify-center"><TrendBadge trend={trend} /></div></Td>
                  <Td className="dark:text-slate-400 hidden md:table-cell">{a.assessorUser?.name || '-'}</Td>
                  <Td className="text-xs text-gray-500 dark:text-slate-500 hidden md:table-cell">{a.assessed_at ? format(new Date(a.assessed_at), 'dd.MM.yyyy', { locale: de }) : '-'}</Td>
                  <Td className="hidden sm:table-cell">
                    <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-medium text-xs' : 'text-xs dark:text-slate-400'}>
                      {a.next_review_at ? format(new Date(a.next_review_at), 'dd.MM.yyyy', { locale: de }) : '-'}
                      {isOverdue && ' ⚠'}
                    </span>
                  </Td>
                  <Td className="hidden sm:table-cell">{a.is_current ? <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">Aktuell</span> : <span className="text-xs text-gray-400 dark:text-slate-500">Veraltet</span>}</Td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">Keine Bewertungen gefunden</td></tr>}
          </Tbody>
        </Table>
      </Card>

      {templates.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 border-b dark:border-slate-800">
            <div className="flex items-center gap-2">
              <FolderOpen className="text-purple-500 dark:text-purple-400" size={18} />
              <h2 className="text-sm font-semibold dark:text-white">Assessment-Vorlagen & SBF-Templates</h2>
            </div>
            {user?.role !== 'viewer' && user?.role !== 'management' && ['admin', 'it-staff', 'assessor'].includes(user?.role || '') && (
              <Link to="/policies?tab=templates" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Verwalten</Link>
            )}
          </CardHeader>
          <CardBody className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {templates.map(t => (
                <div key={t.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 hover:bg-gray-100/50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5 shrink-0">
                      {getFileIcon(t.filename)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold dark:text-white truncate" title={t.title}>{t.title}</p>
                      <p className="text-[10px] text-gray-400 dark:text-slate-500 truncate" title={t.original_name}>{t.original_name}</p>
                      {t.description && <p className="text-[10px] text-gray-500 dark:text-slate-400 mt-1 line-clamp-2">{t.description}</p>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(t.id, t.original_name)}
                    className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white shrink-0 cursor-pointer transition-colors"
                    title="Herunterladen"
                  >
                    <Download size={15} />
                  </button>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
};
