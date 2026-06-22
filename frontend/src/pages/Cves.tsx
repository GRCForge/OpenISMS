import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, ExternalLink, ShieldAlert, AlertTriangle, Bug, Server, Shield, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { FilterBar } from '../components/ui/FilterBar';

interface AffectedAsset {
  id: number;
  name: string;
}

interface CveItem {
  id: string;
  score: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  description: string;
  published: string;
  source: string;
  assets: AffectedAsset[];
}

export const Cves: React.FC = () => {
  const { t } = useTranslation('cves');
  const [cves, setCves] = useState<CveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/assets/cves')
      .then(r => setCves(Array.isArray(r.data) ? r.data : []))
      .catch(() => setCves([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    let critical = 0;
    let high = 0;
    let medium = 0;
    let low = 0;
    cves.forEach(c => {
      if (c.severity === 'critical') critical++;
      else if (c.severity === 'high') high++;
      else if (c.severity === 'medium') medium++;
      else if (c.severity === 'low') low++;
    });
    return { total: cves.length, critical, high, medium, low };
  }, [cves]);

  const filtered = useMemo(() => {
    return cves.filter(c => {
      if (severityFilter && c.severity !== severityFilter) return false;
      if (sourceFilter && c.source !== sourceFilter) return false;
      
      if (search) {
        const query = search.toLowerCase();
        const matchesId = c.id.toLowerCase().includes(query);
        const matchesDesc = (c.description || '').toLowerCase().includes(query);
        const matchesAsset = c.assets.some(a => a.name.toLowerCase().includes(query));
        return matchesId || matchesDesc || matchesAsset;
      }
      return true;
    });
  }, [cves, search, severityFilter, sourceFilter]);

  const sources = useMemo(() => {
    const srcSet = new Set<string>();
    cves.forEach(c => {
      if (c.source) srcSet.add(c.source);
    });
    return Array.from(srcSet);
  }, [cves]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle')}</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardBody className="flex items-center gap-3 py-4">
            <div className="p-2.5 rounded-xl bg-red-500 shrink-0"><ShieldAlert className="text-white" size={18} /></div>
            <div>
              <p className="text-2xl font-bold dark:text-white">{stats.critical}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{t('stats.critical')}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-3 py-4">
            <div className="p-2.5 rounded-xl bg-orange-500 shrink-0"><AlertTriangle className="text-white" size={18} /></div>
            <div>
              <p className="text-2xl font-bold dark:text-white">{stats.high}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{t('stats.high')}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-3 py-4">
            <div className="p-2.5 rounded-xl bg-yellow-500 shrink-0"><AlertTriangle className="text-white" size={18} /></div>
            <div>
              <p className="text-2xl font-bold dark:text-white">{stats.medium}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{t('stats.medium')}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-3 py-4">
            <div className="p-2.5 rounded-xl bg-blue-500 shrink-0"><Bug className="text-white" size={18} /></div>
            <div>
              <p className="text-2xl font-bold dark:text-white">{stats.low}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{t('stats.low')}</p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-3 py-4">
            <div className="p-2.5 rounded-xl bg-slate-500 shrink-0"><Shield className="text-white" size={18} /></div>
            <div>
              <p className="text-2xl font-bold dark:text-white">{stats.total}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">{t('stats.total')}</p>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="space-y-4">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder={t('searchPlaceholder')}
          activeCount={[severityFilter, sourceFilter].filter(Boolean).length}
          onReset={() => { setSearch(''); setSeverityFilter(''); setSourceFilter(''); }}
        >
          <Select
            className="w-44"
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            options={[
              { value: '', label: t('filters.allSeverities') },
              { value: 'critical', label: t('filters.critical') },
              { value: 'high', label: t('filters.high') },
              { value: 'medium', label: t('filters.medium') },
              { value: 'low', label: t('filters.low') },
            ]}
          />
          <Select
            className="w-44"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            options={[
              { value: '', label: t('filters.allSources') },
              ...sources.map(src => ({ value: src, label: src.toUpperCase() })),
            ]}
          />
        </FilterBar>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-slate-500">
            {t('empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <tr>
                  <Th className="w-40">{t('table.id')}</Th>
                  <Th className="w-24">{t('table.score')}</Th>
                  <Th className="w-56">{t('table.affectedAssets')}</Th>
                  <Th>{t('table.description')}</Th>
                  <Th className="w-32">{t('table.source')}</Th>
                  <Th className="w-28">{t('table.published')}</Th>
                  <Th className="w-16 text-center">{t('table.actions')}</Th>
                </tr>
              </Thead>
              <Tbody>
                {filtered.map(c => {
                  const cveUrl = c.id.startsWith('CVE-') 
                    ? `https://nvd.nist.gov/vuln/detail/${c.id}` 
                    : c.id.startsWith('GHSA-') 
                    ? `https://github.com/advisories/${c.id}` 
                    : `https://nvd.nist.gov/vuln/detail/${c.id}`;

                  const sourceUrl = c.source === 'osv'
                    ? (c.id.startsWith('GHSA-') 
                        ? `https://github.com/advisories/${c.id}` 
                        : `https://osv.dev/vulnerability/${c.id}`)
                    : c.source === 'shodan'
                    ? `https://nvd.nist.gov/vuln/detail/${c.id}`
                    : `https://nvd.nist.gov/vuln/detail/${c.id}`;

                  return (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40 align-top">
                      <Td className="font-mono text-xs font-bold whitespace-nowrap">
                        <a
                          href={cveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1.5"
                        >
                          {c.id}
                          <ExternalLink size={12} className="shrink-0" />
                        </a>
                      </Td>
                      <Td>
                        <Badge value={c.severity} label={`${c.score > 0 ? c.score.toFixed(1) : '?'} ${c.severity.toUpperCase()}`} />
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5 max-w-xs">
                          {c.assets.map(asset => (
                            <Link
                              key={asset.id}
                              to={`/assets/${asset.id}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
                            >
                              <Server size={10} className="shrink-0" />
                              <span className="truncate max-w-[120px]" title={asset.name}>{asset.name}</span>
                              <ChevronRight size={10} className="opacity-50" />
                            </Link>
                          ))}
                        </div>
                      </Td>
                      <Td>
                        <p className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed font-sans">{c.description || t('noDescription')}</p>
                      </Td>
                      <Td className="text-xs font-bold whitespace-nowrap">
                        {c.source ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t('sourceTitle', { source: c.source.toUpperCase() })}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase font-bold transition-all border ${
                              c.source === 'osv'     ? 'bg-green-50/50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-200/50 dark:border-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/40' :
                              c.source === 'nvd-cpe' || c.source === 'nvd' ? 'bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-200/50 dark:border-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/40' :
                              c.source === 'shodan'  ? 'bg-purple-50/50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-200/50 dark:border-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/40' :
                                                       'bg-gray-50/50 dark:bg-slate-900/20 text-gray-700 dark:text-slate-400 border-gray-200/50 dark:border-slate-800 hover:bg-gray-100'
                            }`}
                          >
                            {c.source}
                            <ExternalLink size={10} className="shrink-0" />
                          </a>
                        ) : '—'}
                      </Td>
                      <Td className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                        {c.published ? c.published : '—'}
                      </Td>
                      <Td className="text-center whitespace-nowrap">
                        <a
                          href={cveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded-md text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors inline-flex items-center justify-center"
                          title={t('sourceTitle', { source: c.source.toUpperCase() })}
                        >
                          <ExternalLink size={14} />
                        </a>
                      </Td>
                    </tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};
