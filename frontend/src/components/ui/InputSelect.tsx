import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface InputSelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
}

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

export const InputSelect: React.FC<InputSelectProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder,
  required
}) => {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        !(document.getElementById('inputselect-portal')?.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Update position on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    const update = () => updatePos();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      setIsOpen(false);
    } else if (e.key === 'Enter') {
      if (isOpen) {
        e.preventDefault(); // Prevent form submission when pressing enter to close dropdown
        setIsOpen(false);
      }
    }
  };

  const handleBlur = () => {
    // delay closing so clicking on a dropdown option works
    setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const { cleanLabel, isRequired } = parseLabel(label, required);

  const uniqueOptions = Array.from(new Set(options.filter(Boolean)));
  
  // Check if current value is already in the list
  const isExactMatch = uniqueOptions.some(opt => opt.toLowerCase() === (value || '').trim().toLowerCase());
  const showCreateOption = value && value.trim() && !isExactMatch;

  const filteredOptions = uniqueOptions.filter(opt =>
    opt.toLowerCase().includes((value || '').toLowerCase())
  );

  const dropdown = isOpen ? (
    <div
      id="inputselect-portal"
      style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}
      className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto p-1 space-y-0.5 custom-scrollbar"
    >
      {showCreateOption && (
        <button
          type="button"
          onMouseDown={e => {
            e.preventDefault();
            onChange(value.trim());
            setIsOpen(false);
          }}
          className="w-full text-left px-2.5 py-1.5 text-xs rounded-md transition-colors cursor-pointer text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 font-semibold border-b border-gray-100 dark:border-slate-700/50 flex items-center justify-between"
        >
          <span>{t('ui.addEntry', { value: value.trim() })}</span>
          <span className="text-[10px] text-gray-400 font-normal px-1 py-0.5 bg-gray-100 dark:bg-slate-700 rounded-xs">{t('ui.new')}</span>
        </button>
      )}

      {filteredOptions.length === 0 && !showCreateOption ? (
        <div className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">
          {t('ui.noOptions')}
        </div>
      ) : filteredOptions.length === 0 && showCreateOption ? null : (
        filteredOptions.map(opt => (
          <button
            key={opt}
            type="button"
            onMouseDown={e => {
              e.preventDefault();
              onChange(opt);
              setIsOpen(false);
            }}
            className={`w-full text-left px-2.5 py-1.5 text-xs rounded-md transition-colors cursor-pointer ${
              opt === value
                ? 'bg-blue-500 text-white font-semibold'
                : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700/50'
            }`}
          >
            {opt}
          </button>
        ))
      )}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-1.5 w-full" ref={containerRef}>
      {cleanLabel && (
        <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          {cleanLabel}
          {isRequired && <span className="text-red-500 ml-1 font-bold">*</span>}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          className="w-full px-3 py-2 pr-10 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-sm text-gray-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 transition-all placeholder:text-gray-400 dark:placeholder:text-slate-500"
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); updatePos(); setIsOpen(true); }}
          onFocus={() => { updatePos(); setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={isRequired}
        />
        <button
          type="button"
          onClick={() => { updatePos(); setIsOpen(o => !o); }}
          className="absolute right-2 p-1 text-gray-400 hover:text-gray-600 focus:outline-hidden cursor-pointer"
        >
          <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {createPortal(dropdown, document.body)}
    </div>
  );
};
