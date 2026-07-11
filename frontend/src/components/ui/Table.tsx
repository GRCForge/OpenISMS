import React from 'react';

export const Table: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left border-collapse">
      {children}
    </table>
  </div>
);

export const Thead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <thead className="bg-gray-50/50 dark:bg-slate-800/50 border-b border-gray-100 dark:border-slate-800">
    {children}
  </thead>
);

export const Tbody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
    {children}
  </tbody>
);

export const Th: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <th className={`px-3 sm:px-5 py-3 text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider ${className}`}>
    {children}
  </th>
);

export const Td: React.FC<{ children: React.ReactNode; className?: string; colSpan?: number; onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void }> = ({ children, className = '', colSpan, onClick }) => (
  <td className={`px-3 sm:px-5 py-3 text-sm dark:text-slate-300 ${className}`} colSpan={colSpan} onClick={onClick}>
    {children}
  </td>
);
