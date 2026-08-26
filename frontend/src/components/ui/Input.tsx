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
  // The label used to be a bare <label> next to a bare <input>: nothing tied the
  // two together, so screen readers announced the field as unlabelled and
  // clicking the label did not focus it. useId gives every instance a stable id
  // across server/client without the caller having to pass one.
  const generatedId = React.useId();
  const inputId = props.id ?? generatedId;
  const errorId = `${inputId}-error`;
  const describedBy = [props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {cleanLabel && (
        <label htmlFor={inputId} className="text-sm font-semibold text-gray-700 dark:text-slate-300">
          {cleanLabel}
          {/* aria-hidden: aria-required on the input already announces the
              field as required — the asterisk is the sighted-user half. */}
          {isRequired && <span aria-hidden="true" className="text-red-500 ml-1 font-bold">*</span>}
        </label>
      )}
      {/* aria-required rather than `required`: a label ending in "*" should be
          ANNOUNCED as required without silently adding browser validation to
          fields that submit fine today. */}
      <input
        className={`px-3 py-2 bg-white dark:bg-slate-800 border rounded-lg text-sm text-gray-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 transition-all placeholder:text-gray-500 dark:placeholder:text-slate-400 ${
          error
            ? 'border-red-500 dark:border-red-500 focus:ring-red-500/20 focus:border-red-500'
            : 'border-gray-500 dark:border-slate-500 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400'
        } ${className}`}
        {...props}
        id={inputId}
        aria-required={isRequired || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {/* role="alert": a validation message that appears after the fact is
          otherwise never announced. */}
      {error && <p id={errorId} role="alert" className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
};
