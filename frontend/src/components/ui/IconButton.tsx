import React from 'react';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> {
  /**
   * Accessible name, required. It becomes both `aria-label` and `title`, so an
   * icon-only control can never ship without one — the review found 40 that
   * announced as nothing but "button".
   */
  label: string;
  variant?: 'default' | 'danger';
  /** sm: 26x26 with a 14px icon. md: 32x32 with a 16px icon. */
  size?: 'sm' | 'md';
}

/**
 * A single icon acting as a button.
 *
 * The hand-rolled pattern this replaces was `p-1` around a 14px icon — a 22x22
 * CSS px target, under the 24x24 floor of WCAG 2.2 SC 2.5.8 and awkward to hit
 * on a touch screen. `p-1.5` takes the same icon to 26x26 without changing the
 * row height it sits in, since table rows are taller than that anyway.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  label,
  variant = 'default',
  size = 'sm',
  className = '',
  children,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900';

  const variants = {
    default: 'text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-slate-800',
    danger: 'text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
  };

  const sizes = { sm: 'p-1.5', md: 'p-2' };

  return (
    <button
      type={props.type ?? 'button'}
      aria-label={label}
      title={label}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
