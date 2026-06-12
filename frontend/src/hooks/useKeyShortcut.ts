import { useEffect, useRef } from 'react';

interface ShortcutOptions {
  /** Ctrl (Windows) or Cmd (Mac) must be held */
  ctrl?: boolean;
  /** Disable the shortcut (e.g. when a modal is open) */
  disabled?: boolean;
}

/**
 * Registers a global keyboard shortcut.
 * Single-key shortcuts (no ctrl) are ignored while the user types in an input/textarea.
 */
export function useKeyShortcut(
  key: string,
  handler: () => void,
  options: ShortcutOptions = {}
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (options.disabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;

      if (!e.key) return;
      const keyMatch = e.key.toLowerCase() === key.toLowerCase();
      if (!keyMatch) return;

      if (options.ctrl) {
        if (!e.ctrlKey && !e.metaKey) return;
      } else {
        if (inEditable) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
      }

      e.preventDefault();
      handlerRef.current();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [key, options.ctrl, options.disabled]);
}
