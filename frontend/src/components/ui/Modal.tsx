import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'md' | 'lg' | 'xl' | '2xl';
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, size = 'md' }) => {
  const { t } = useTranslation('common');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
  }, [open]);

  // Move focus into the dialog on open and hand it back to whatever opened it on
  // close. Without this, closing a modal dropped focus onto <body> and keyboard
  // users had to tab from the top of the page again.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Respect an autoFocus'd field inside the dialog; only take focus when
    // nothing in here has it yet.
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => { previouslyFocused?.focus?.(); };
  }, [open]);

  // Escape closes; Tab cycles inside the dialog instead of walking the page
  // behind it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null || el === document.activeElement);
      // Nothing focusable in here (or everything is hidden): leave Tab alone
      // rather than swallowing it and stranding the user.
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sizes = {
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs" onClick={onClose} />
      {/* max-h keeps the header sticky and lets the body scroll; tighter padding on
          phones gives the content more usable width. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative bg-white dark:bg-slate-900 w-full ${sizes[size]} max-h-[95vh] sm:max-h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 scale-100 focus:outline-hidden`}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 flex-shrink-0">
          <h2 id={titleId} className="text-base font-bold text-gray-900 dark:text-white truncate pr-4">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('actions.close')}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 dark:text-slate-500 transition-colors flex-shrink-0 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
};
