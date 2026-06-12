import React from 'react';

const variants = {
  public: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  internal: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  confidential: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  secret: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  
  // Status & Lifecycle
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  production: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  maintenance: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  evaluation: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  archived: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400',
  decommissioned: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  acknowledged: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  owner: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  assessor: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  sso: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  password: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400',
  totp: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  passkey: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  unsecure: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  default: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400',
};

interface BadgeProps { 
  value: string; 
  label?: string; 
  size?: 'default' | 'xs';
}

export const Badge: React.FC<BadgeProps> = ({ value, label, size = 'default' }) => {
  const cls = variants[value as keyof typeof variants] || variants.default;
  const sizeCls = size === 'xs' ? 'px-1.5 py-0 text-[10px]' : 'px-2.5 py-0.5 text-xs';
  return <span className={`inline-flex items-center rounded-full font-medium transition-colors ${sizeCls} ${cls}`}>{label || value}</span>;
};
