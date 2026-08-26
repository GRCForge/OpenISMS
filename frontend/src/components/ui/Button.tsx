import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

// Does this button render any text a screen reader can announce? Icon-only
// buttons (a bare <Download size={14} /> child) are all over the app and would
// otherwise be read as just "button". Where such a button carries a `title` for
// sighted users, reuse it as the accessible name.
const hasTextContent = (node: React.ReactNode): boolean =>
  React.Children.toArray(node).some(child => {
    if (typeof child === 'string') return child.trim().length > 0;
    if (typeof child === 'number') return true;
    if (React.isValidElement(child)) {
      const props = child.props as { children?: React.ReactNode };
      return hasTextContent(props.children);
    }
    return false;
  });

export const Button: React.FC<ButtonProps> = ({ 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  children, 
  ...props 
}) => {
  // focus-visible (not focus): keyboard users get a ring, mouse users don't.
  // The offset colour follows the surface the app actually paints behind
  // buttons — gray-50 in light mode, slate-950 in dark.
  const base = 'inline-flex items-center gap-2 font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-slate-950';
  
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs shadow-blue-200 dark:shadow-none',
    secondary: 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700',
    danger: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40',
    ghost: 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200',
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-2.5 text-base',
  };

  const needsLabel = !props['aria-label'] && !props['aria-labelledby'] && !hasTextContent(children);
  const ariaLabel = needsLabel && props.title ? props.title : props['aria-label'];

  return (
    <button 
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
};
