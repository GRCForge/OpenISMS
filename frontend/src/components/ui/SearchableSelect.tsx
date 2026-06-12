import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = '– bitte wählen –',
  disabled = false,
  required = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    } else {
      setSearch('');
    }
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder;

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  const parseLabel = (lbl?: string, req?: boolean) => {
    if (!lbl) return { cleanLabel: undefined, isRequired: !!req };
    const trimmed = lbl.trim();
    if (trimmed.endsWith('*')) {
      const lastStarIndex = lbl.lastIndexOf('*');
      const cleanLabel = (lbl.slice(0, lastStarIndex) + lbl.slice(lastStarIndex + 1)).trim();
      return { cleanLabel, isRequired: true };
    }
    return { cleanLabel: lbl, isRequired: !!req };
  };

  const { cleanLabel, isRequired } = parseLabel(label, required);

  return (
    <div className={`flex flex-col gap-1.5 w-full relative ${className}`} ref={containerRef}>
      {cleanLabel && (
        <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          {cleanLabel}
          {isRequired && <span className="text-red-500 ml-1 font-bold">*</span>}
        </label>
      )}
      
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-sm text-gray-900 dark:text-slate-100 flex items-center justify-between text-left cursor-pointer w-full focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 transition-all ${
          disabled ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-slate-900' : ''
        }`}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div className="absolute top-[100%] left-0 w-full mt-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b border-gray-100 dark:border-slate-700 flex items-center gap-2 relative bg-gray-50/50 dark:bg-slate-800/50">
            <Search className="absolute left-4 text-gray-400" size={14} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-md focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1 space-y-0.5 custom-scrollbar">
            {filteredOptions.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">Keine Einträge gefunden</p>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-md transition-colors cursor-pointer flex items-center justify-between ${
                    opt.value === value
                      ? 'bg-blue-500 text-white font-semibold'
                      : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
