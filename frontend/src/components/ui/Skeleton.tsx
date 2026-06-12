import React from 'react';

/** Single pulsing block. Compose into page-specific skeletons. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded bg-gray-200 dark:bg-slate-700/60 ${className}`} />
);

/** Stat card matching the compact overview cards used across the app. */
export const SkeletonStatCard: React.FC = () => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 p-4 flex items-center gap-3">
    <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-6 w-2/5" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  </div>
);

/** Generic card with N content lines. */
export const SkeletonCard: React.FC<{ lines?: number; className?: string }> = ({ lines = 4, className = '' }) => (
  <div className={`bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 p-5 space-y-3 ${className}`}>
    <Skeleton className="h-4 w-1/3 mb-4" />
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
    ))}
  </div>
);

/** Table row placeholder — use inside a <tbody>. */
export const SkeletonTableRow: React.FC<{ cols?: number }> = ({ cols = 5 }) => (
  <tr>
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="px-4 py-3">
        <Skeleton className="h-4" />
      </td>
    ))}
  </tr>
);

/** Full table skeleton: header + N body rows. */
export const SkeletonTable: React.FC<{ rows?: number; cols?: number }> = ({ rows = 6, cols = 5 }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 overflow-hidden">
    <div className="flex gap-4 px-4 py-3 border-b dark:border-slate-800">
      {Array.from({ length: cols }).map((_, i) => <Skeleton key={i} className="h-3 flex-1" />)}
    </div>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex gap-4 px-4 py-3.5 border-b dark:border-slate-800 last:border-0">
        {Array.from({ length: cols }).map((_, j) => <Skeleton key={j} className="h-3 flex-1" />)}
      </div>
    ))}
  </div>
);

/** Asset-detail header skeleton. */
export const SkeletonDetailHeader: React.FC = () => (
  <div className="space-y-6">
    <div className="flex items-start gap-4">
      <Skeleton className="h-8 w-20 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
    </div>
  </div>
);
