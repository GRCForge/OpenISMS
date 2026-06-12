import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ArrowRight, ExternalLink } from 'lucide-react';
import api from '../lib/api';

export type Framework = 'iso27001' | 'nis2' | 'bsi_grundschutz' | 'c5';

interface MappedControl {
  framework: Framework;
  ref: string;
  type: 'direct' | 'partial' | 'related';
  title: string;
  status?: string;
}

const FW_LABELS: Record<Framework, string> = {
  iso27001: 'ISO 27001:2022',
  nis2: 'NIS-2',
  bsi_grundschutz: 'BSI IT-Grundschutz',
  c5: 'BSI C5:2026',
};

const FW_COLORS: Record<Framework, string> = {
  iso27001: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  nis2: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  bsi_grundschutz: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  c5: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
};

const FW_ROUTES: Record<Framework, string> = {
  iso27001: '/iso27001',
  nis2: '/nis2',
  bsi_grundschutz: '/bsi-grundschutz',
  c5: '/c5',
};

const TYPE_LABELS = { direct: 'Direkt', partial: 'Teilweise', related: 'Verwandt' };
const TYPE_COLORS = {
  direct: 'text-green-600 dark:text-green-400',
  partial: 'text-amber-600 dark:text-amber-400',
  related: 'text-gray-400 dark:text-slate-500',
};

interface Props {
  framework: Framework;
  ref: string;
  exclude?: Framework[];
  compact?: boolean;
}

export const ControlMappings: React.FC<Props> = ({ framework, ref: controlRef, exclude = [], compact = false }) => {
  const [data, setData] = useState<MappedControl[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/mappings', { params: { framework, ref: controlRef } })
      .then(r => setData(r.data.related || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [framework, controlRef]);

  if (loading) return <div className="flex items-center gap-2 py-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" />Querverweise laden…</div>;

  const visible = (data || []).filter(m => !exclude.includes(m.framework));
  if (visible.length === 0) return compact ? null : <p className="text-xs text-gray-400 italic">Keine Querverweise verfügbar.</p>;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {visible.map((m, i) => (
          <Link key={i} to={FW_ROUTES[m.framework]} title={`${FW_LABELS[m.framework]}: ${m.title} (${m.status === 'implemented' ? 'Erfüllt' : m.status === 'in_progress' ? 'In Arbeit' : 'Offen'})`}
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 transition-opacity border ${
              m.status === 'implemented'
                ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800/30'
                : m.status === 'in_progress'
                ? 'bg-amber-100 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/30'
                : `${FW_COLORS[m.framework]} border-transparent`
            }`}>
            {m.status === 'implemented' && <span className="text-green-600 dark:text-green-400 font-bold">✓</span>}
            {m.ref}
          </Link>
        ))}
      </div>
    );
  }

  const grouped = visible.reduce((acc, m) => {
    if (!acc[m.framework]) acc[m.framework] = [];
    acc[m.framework].push(m);
    return acc;
  }, {} as Record<string, MappedControl[]>);

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([fw, items]) => (
        <div key={fw}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${FW_COLORS[fw as Framework]}`}>
              {FW_LABELS[fw as Framework] || fw}
            </span>
          </div>
          <div className="space-y-1">
            {items.map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <ArrowRight size={12} className="text-gray-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <span className={`text-[10px] font-semibold mr-1 ${TYPE_COLORS[m.type]}`}>{TYPE_LABELS[m.type]}</span>
                  <span className="text-xs font-mono text-gray-600 dark:text-slate-400 mr-1">{m.ref}</span>
                  <span className="text-xs text-gray-500 dark:text-slate-400 leading-tight">
                    {m.title}
                    {m.status === 'implemented' && <span className="text-green-600 dark:text-green-400 font-bold ml-1.5" title="Erfüllt">✓</span>}
                    {m.status === 'in_progress' && <span className="text-amber-500 font-semibold ml-1.5" title="In Arbeit">(In Arbeit)</span>}
                  </span>
                </div>
                <Link to={FW_ROUTES[fw as Framework]} className="shrink-0 ml-auto">
                  <ExternalLink size={11} className="text-gray-300 hover:text-blue-500 transition-colors" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// ---- Cross-Framework Overview Table ----

interface OverviewItem {
  ref: string;
  title: string;
  theme?: string;
  category?: string;
  baustein?: string;
  domain?: string;
  status: string;
  total_mappings: number;
  mappings: Record<string, (MappedControl & { status: string })[]>;
}

interface OverviewProps {
  source: Framework;
}

const getStatusBadgeClass = (status: string) => {
  switch (status) {
    case 'implemented':
      return 'bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20';
    case 'in_progress':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20';
    case 'not_applicable':
      return 'bg-gray-100 dark:bg-slate-800 text-gray-500 border border-gray-200 dark:border-slate-700';
    default:
      return 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/10';
  }
};

const getTargetStatusClass = (status: string, isSourceImplemented: boolean) => {
  const isFulfilled = status === 'implemented' || isSourceImplemented;
  
  if (isFulfilled) {
    if (status === 'implemented') {
      return 'bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-800/50';
    } else {
      return 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/30';
    }
  }
  
  if (status === 'in_progress') {
    return 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/30';
  }
  
  if (status === 'not_applicable') {
    return 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700';
  }

  return 'bg-red-50/50 dark:bg-red-950/10 text-red-500 dark:text-red-400 border border-red-200/50 dark:border-red-900/30';
};

const getLinkText = (m: MappedControl & { status: string }, isSourceImplemented: boolean) => {
  if (m.status === 'implemented') {
    return `✓ ${m.ref}`;
  }
  if (isSourceImplemented) {
    return `✓(ISO) ${m.ref}`;
  }
  return m.ref;
};

export const CrossFrameworkOverview: React.FC<OverviewProps> = ({ source }) => {
  const [items, setItems] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'fulfilled' | 'pending'>('all');
  const [stats, setStats] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/mappings/overview', { params: { source } }),
      api.get('/mappings/stats'),
    ]).then(([ov, st]) => {
      setItems(ov.data.items || []);
      setStats(st.data.byPair || {});
    }).catch(() => setItems([])).finally(() => setLoading(false));
  }, [source]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-blue-500" /></div>;

  const targets = source === 'iso27001'
    ? (['nis2', 'bsi_grundschutz', 'c5'] as Framework[])
    : (['iso27001'] as Framework[]);

  const filtered = items.filter(it => {
    const matchesSearch = it.ref.toLowerCase().includes(filter.toLowerCase()) || it.title.toLowerCase().includes(filter.toLowerCase());
    if (!matchesSearch) return false;
    
    if (statusFilter === 'fulfilled') {
      if (it.status === 'implemented') return true;
      const anyTargetImplemented = Object.values(it.mappings).some((mappedArray) => 
        mappedArray.some((m) => m.status === 'implemented')
      );
      return anyTargetImplemented;
    }
    if (statusFilter === 'pending') {
      if (it.status === 'implemented') return false;
      const anyTargetImplemented = Object.values(it.mappings).some((mappedArray) => 
        mappedArray.some((m) => m.status === 'implemented')
      );
      return !anyTargetImplemented;
    }
    return true;
  });

  const withMappings = filtered.filter(it => it.total_mappings > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Nach ID oder Titel filtern…"
          className="px-3 py-1.5 text-sm border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
        />

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="px-3 py-1.5 text-sm border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">Alle Umsetzungsstufen</option>
          <option value="fulfilled">Erfüllt (ISO 27001 oder direkt)</option>
          <option value="pending">Noch umzusetzen (offen)</option>
        </select>

        <span className="text-xs text-gray-400 dark:text-slate-500">
          {withMappings.length} / {filtered.length} Controls mit Querverweisen
        </span>
        {Object.entries(stats).filter(([k]) => k.includes(source) || source === 'iso27001').map(([key, count]) => {
          const pair = key.replace('iso27001-', '').replace('-iso27001', '');
          const fwLabel = FW_LABELS[pair as Framework] || pair;
          return (
            <span key={key} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400">
              {fwLabel}: {count} Links
            </span>
          );
        })}
      </div>

      <div className="border dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-slate-800/50">
              <tr>
                <th className="text-left px-3 py-2 font-bold text-gray-500 uppercase tracking-wider w-20">Ref</th>
                <th className="text-left px-3 py-2 font-bold text-gray-500 uppercase tracking-wider">Bezeichnung & Status</th>
                {targets.map(fw => (
                  <th key={fw} className="text-center px-3 py-2 font-bold text-gray-500 uppercase tracking-wider w-32">
                    {FW_LABELS[fw]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {filtered.map(item => (
                <tr key={item.ref} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20">
                  <td className="px-3 py-2 font-mono font-bold text-gray-700 dark:text-slate-300">{item.ref}</td>
                  <td className="px-3 py-2 max-w-xs">
                    <div className="flex items-center gap-2 justify-between flex-wrap">
                      <span className="text-gray-600 dark:text-slate-400 truncate" title={item.title}>{item.title}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase shrink-0 ${getStatusBadgeClass(item.status)}`}>
                        {item.status === 'implemented' ? 'Erfüllt' : item.status === 'in_progress' ? 'In Arbeit' : item.status === 'not_applicable' ? 'N/A' : 'Offen'}
                      </span>
                    </div>
                  </td>
                  {targets.map(fw => {
                    const mapped = item.mappings[fw] || [];
                    return (
                      <td key={fw} className="px-3 py-2">
                        {mapped.length > 0 ? (
                          <div className="flex flex-wrap gap-1 justify-center">
                            {mapped.map((m, i) => {
                              const isSourceImplemented = item.status === 'implemented';
                              return (
                                <Link key={i} to={FW_ROUTES[fw]} title={`${m.title} (${m.status === 'implemented' ? 'Erfüllt' : m.status === 'in_progress' ? 'In Arbeit' : 'Offen'})`}
                                  className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded border hover:opacity-70 transition-opacity whitespace-nowrap ${getTargetStatusClass(m.status, isSourceImplemented)}`}>
                                  {getLinkText(m, isSourceImplemented)}
                                </Link>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="block text-center text-gray-200 dark:text-slate-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
