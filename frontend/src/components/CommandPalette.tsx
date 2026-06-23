import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Server, ShieldAlert, CheckSquare, FileText, X } from 'lucide-react';
import api from '../lib/api';
import { useCommandPalette } from '../contexts/CommandPaletteContext';

interface CmdResult {
  id: number;
  type: 'asset' | 'risk' | 'task' | 'policy';
  title: string;
  subtitle?: string;
  path: string;
}

const TYPE_CONFIG = {
  asset:  { icon: Server,      color: 'text-blue-500'   },
  risk:   { icon: ShieldAlert, color: 'text-red-500'    },
  task:   { icon: CheckSquare, color: 'text-green-500'  },
  policy: { icon: FileText,    color: 'text-purple-500' },
};

export const CommandPalette: React.FC = () => {
  const { t } = useTranslation('common');
  const { open, closePalette } = useCommandPalette();
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState<CmdResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [allData,   setAllData]   = useState<CmdResult[] | null>(null);
  const [loading,   setLoading]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Fetch all data lazily on first open
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());

    if (allData !== null) return;
    setLoading(true);

    Promise.allSettled([
      api.get('/assets'),
      api.get('/risks'),
      api.get('/tasks'),
      api.get('/policies'),
    ]).then(([assets, risks, tasks, policies]) => {
      const data: CmdResult[] = [];

      if (assets.status === 'fulfilled') {
        for (const a of (assets.value.data as any[])) {
          data.push({ id: a.id, type: 'asset', title: a.name, subtitle: a.type, path: `/assets/${a.id}` });
        }
      }
      if (risks.status === 'fulfilled') {
        for (const r of (risks.value.data as any[])) {
          data.push({ id: r.id, type: 'risk', title: r.title, subtitle: r.ref, path: '/risks' });
        }
      }
      if (tasks.status === 'fulfilled') {
        for (const t of (tasks.value.data as any[])) {
          data.push({ id: t.id, type: 'task', title: t.title, subtitle: t.status, path: '/tasks' });
        }
      }
      if (policies.status === 'fulfilled') {
        for (const p of (policies.value.data as any[])) {
          data.push({ id: p.id, type: 'policy', title: p.name || p.title || `Policy ${p.id}`, subtitle: p.type, path: '/policies' });
        }
      }

      setAllData(data);
      setLoading(false);
    });
  }, [open]);

  // Filter results on query change
  useEffect(() => {
    if (!allData) return;
    if (!query.trim()) {
      setResults(allData.slice(0, 8));
      setActiveIdx(0);
      return;
    }
    const q = query.toLowerCase();
    setResults(
      allData
        .filter(r => r.title.toLowerCase().includes(q) || r.subtitle?.toLowerCase().includes(q))
        .slice(0, 10)
    );
    setActiveIdx(0);
  }, [query, allData]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const select = useCallback((r: CmdResult) => {
    navigate(r.path);
    closePalette();
  }, [navigate, closePalette]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown')  { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && results[activeIdx]) select(results[activeIdx]);
    if (e.key === 'Escape') closePalette();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-16 sm:pt-28 px-4">
      <div className="absolute inset-0 bg-slate-900/60 dark:bg-black/80 backdrop-blur-sm" onClick={closePalette} />

      <div className="relative w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-slate-700 animate-in fade-in slide-in-from-top-4 duration-150">

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
          <Search size={16} className="text-gray-400 dark:text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('cmdPalette.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 outline-none"
          />
          {query ? (
            <button onClick={() => setQuery('')} className="text-gray-300 hover:text-gray-500 dark:text-slate-600 dark:hover:text-slate-400 transition-colors">
              <X size={15} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono text-gray-400 dark:text-slate-600 border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
              ESC
            </kbd>
          )}
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {loading && (
            <p className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">{t('cmdPalette.loading')}</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-gray-400 dark:text-slate-500">
              {query ? t('cmdPalette.noResults', { query }) : t('cmdPalette.noItems')}
            </p>
          )}
          {!loading && results.map((r, i) => {
            const { icon: Icon, color } = TYPE_CONFIG[r.type];
            return (
              <button
                key={`${r.type}-${r.id}`}
                data-idx={i}
                onClick={() => select(r)}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  i === activeIdx
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <Icon size={16} className={`shrink-0 ${color}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.title}</p>
                  {r.subtitle && (
                    <p className="text-xs text-gray-400 dark:text-slate-500 truncate">{r.subtitle}</p>
                  )}
                </div>
                <span className="text-[10px] text-gray-300 dark:text-slate-600 shrink-0 font-medium uppercase tracking-wider">
                  {t(`cmdPalette.types.${r.type}`)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 flex items-center gap-4 text-[11px] text-gray-400 dark:text-slate-500">
          <span className="flex items-center gap-1">
            <kbd className="font-mono border border-gray-200 dark:border-slate-700 px-1 py-0.5 rounded bg-white dark:bg-slate-700 text-gray-500 dark:text-slate-400">⇕</kbd>
            {t('cmdPalette.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono border border-gray-200 dark:border-slate-700 px-1 py-0.5 rounded bg-white dark:bg-slate-700 text-gray-500 dark:text-slate-400">↵</kbd>
            {t('cmdPalette.open')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="font-mono border border-gray-200 dark:border-slate-700 px-1 py-0.5 rounded bg-white dark:bg-slate-700 text-gray-500 dark:text-slate-400">ESC</kbd>
            {t('cmdPalette.close')}
          </span>
        </div>
      </div>
    </div>
  );
};
