import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const parseLabel = (label?: string, required?: boolean) => {
  if (!label) return { cleanLabel: undefined, isRequired: !!required };
  const trimmed = label.trim();
  if (trimmed.endsWith('*')) {
    const lastStarIndex = label.lastIndexOf('*');
    const cleanLabel = (label.slice(0, lastStarIndex) + label.slice(lastStarIndex + 1)).trim();
    return { cleanLabel, isRequired: true };
  }
  return { cleanLabel: label, isRequired: !!required };
};

export const Input: React.FC<InputProps> = ({ label, error, className = '', ...props }) => {
  const { cleanLabel, isRequired } = parseLabel(label, props.required);
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {cleanLabel && (
        <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          {cleanLabel}
          {isRequired && <span className="text-red-500 ml-1 font-bold">*</span>}
        </label>
      )}
      <input
        className={`px-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg text-sm text-gray-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 transition-all placeholder:text-gray-400 dark:placeholder:text-slate-500 ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
};
