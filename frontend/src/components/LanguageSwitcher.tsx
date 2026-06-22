import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
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
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-xs font-medium w-full"
        title={current.label}
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span>{current.code.toUpperCase()}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50 min-w-[130px]">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { i18n.changeLanguage(lang.code); setOpen(false); }}
              className={`flex items-center gap-2.5 w-full px-3 py-2 text-sm transition-colors ${
                current.code === lang.code
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <span>{lang.flag}</span>
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
