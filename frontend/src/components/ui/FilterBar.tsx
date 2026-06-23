import React from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from './Input';

interface FilterBarProps {
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;   // Filter-Selects
  onReset?: () => void;
  activeCount?: number;
}

// Unified filter bar: search + filters in ONE row. Prevents vertical stacking.
export const FilterBar: React.FC<FilterBarProps> = ({
  search, onSearch, searchPlaceholder, children, onReset, activeCount = 0,
}) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-nowrap items-center gap-2 bg-white dark:bg-slate-900 p-2 rounded-xl border dark:border-slate-800 shadow-xs overflow-x-auto no-scrollbar">
      {onSearch && (
        <div className="relative w-64 shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
          <Input placeholder={searchPlaceholder ?? t('filters.searchPlaceholder')} value={search ?? ''} onChange={e => onSearch(e.target.value)} className="pl-9 h-9 text-sm" />
        </div>
      )}
      <div className="flex items-center gap-2">
        {children}
      </div>
      <div className="flex-1" />
      {activeCount > 0 && onReset && (
        <button type="button" onClick={onReset}
          className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 px-2 py-2 transition-colors whitespace-nowrap shrink-0 border border-transparent hover:border-red-500/20 rounded-lg"
          title={t('actions.reset')}>
          <X size={12} /> {activeCount}
        </button>
      )}
    </div>
  );
};
