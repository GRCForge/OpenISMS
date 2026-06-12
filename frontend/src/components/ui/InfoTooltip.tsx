import React from 'react';

export const InfoTooltip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  <span className={`group relative inline-flex items-center ml-1 cursor-help align-middle ${className}`}>
    <span className="w-3.5 h-3.5 rounded-full bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400 text-[9px] font-bold flex items-center justify-center select-none">?</span>
    <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 rounded-xl bg-gray-900 dark:bg-slate-700 text-white text-xs p-2.5 opacity-0 group-hover:opacity-100 transition-opacity z-50 text-left shadow-xl leading-relaxed">
      {text}
    </span>
  </span>
);
