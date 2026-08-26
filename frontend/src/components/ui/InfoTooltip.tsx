import React, { useId } from 'react';

/**
 * The trigger used to be a plain <span> shown on :hover only — unreachable by
 * keyboard and invisible on touch, which hid the BCM/compliance explanations
 * from anyone not using a mouse. It is now a real button: focusable, described
 * by the tooltip it opens, and revealed on focus as well as hover.
 */
export const InfoTooltip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const tooltipId = useId();
  return (
    <span className={`group relative inline-flex items-center ml-1 align-middle ${className}`}>
      <button
        type="button"
        aria-describedby={tooltipId}
        // The tooltip text IS the button's purpose, so it doubles as the label —
        // otherwise the control announces as an unnamed "?" button.
        aria-label={text}
        className="w-3.5 h-3.5 rounded-full bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 text-[9px] font-bold flex items-center justify-center select-none cursor-help focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-offset-1"
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 w-56 rounded-xl bg-gray-900 dark:bg-slate-700 text-white text-xs p-2.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 text-left shadow-xl leading-relaxed"
      >
        {text}
      </span>
    </span>
  );
};
