import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'en', label: 'English', flagUrl: '/flags/en.svg' },
  { code: 'de', label: 'Deutsch', flagUrl: '/flags/de.svg' },
  { code: 'es', label: 'Español', flagUrl: '/flags/es.svg' },
];

export const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find(l => i18n.language.startsWith(l.code)) ?? LANGUAGES[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs font-medium w-full"
        title={current.label}
      >
        <img
          src={current.flagUrl}
          alt={current.label}
          className="w-5 h-3.5 object-cover rounded-sm border border-gray-200 dark:border-slate-700/50"
        />
        <span>{current.code.toUpperCase()}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 min-w-[130px]">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { i18n.changeLanguage(lang.code); setOpen(false); }}
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors ${
                current.code === lang.code
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <img
                src={lang.flagUrl}
                alt={lang.label}
                className="w-5 h-3.5 object-cover rounded-sm border border-gray-200 dark:border-slate-700/50"
              />
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
