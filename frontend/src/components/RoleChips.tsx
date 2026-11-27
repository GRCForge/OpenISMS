import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomRole, RoleRef, UserRole } from '../types';

// Roles are named sets of permissions. Since v3.10.0 they reach users only
// through groups: a group carries roles, its members receive all of them.

export const BUILTIN_ROLES: UserRole[] = ['admin', 'assessor', 'it-staff', 'dpo', 'owner', 'management', 'employee', 'viewer'];

const roleKey = (r: RoleRef) => (r.system_role ? `s:${r.system_role}` : `c:${r.custom_role_id}`);

export const RoleChip: React.FC<{ role: RoleRef; customRoles?: CustomRole[] }> = ({ role, customRoles }) => {
  const { t } = useTranslation('users');
  const label = role.system_role
    ? t(`roleLabels.${role.system_role}`)
    : role.name || customRoles?.find(c => c.id === role.custom_role_id)?.name || `#${role.custom_role_id}`;
  const custom = !role.system_role;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${custom
      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
      : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
      <ShieldCheck size={11} />{label}
    </span>
  );
};

export const RoleChips: React.FC<{ roles?: RoleRef[]; customRoles?: CustomRole[]; empty?: React.ReactNode }> = ({ roles, customRoles, empty }) => {
  if (!roles || roles.length === 0) return <>{empty ?? null}</>;
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map(r => <RoleChip key={roleKey(r)} role={r} customRoles={customRoles} />)}
    </div>
  );
};

/** Checkbox list of built-in and custom roles. */
export const RolePicker: React.FC<{
  value: RoleRef[];
  onChange: (roles: RoleRef[]) => void;
  customRoles: CustomRole[];
  disabled?: boolean;
}> = ({ value, onChange, customRoles, disabled }) => {
  const { t } = useTranslation('users');
  const selected = new Set(value.map(roleKey));
  const toggle = (r: RoleRef) => {
    const k = roleKey(r);
    onChange(selected.has(k) ? value.filter(v => roleKey(v) !== k) : [...value, r]);
  };
  const box = (r: RoleRef, label: string, hint?: string) => (
    <label key={roleKey(r)} className={`flex items-start gap-2 p-2 rounded-lg border dark:border-slate-700 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50'}`}>
      <input type="checkbox" className="mt-0.5" disabled={disabled} checked={selected.has(roleKey(r))} onChange={() => toggle(r)} />
      <span>
        <span className="block text-sm font-medium text-gray-800 dark:text-slate-200">{label}</span>
        {hint && <span className="block text-[11px] text-gray-500 dark:text-slate-400">{hint}</span>}
      </span>
    </label>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">{t('rolePicker.builtin')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {BUILTIN_ROLES.map(r => box({ system_role: r }, t(`roleLabels.${r}`)))}
        </div>
      </div>
      {customRoles.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-1.5">{t('rolePicker.custom')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {customRoles.map(c => box({ custom_role_id: c.id, name: c.name }, c.name, c.description || undefined))}
          </div>
        </div>
      )}
    </div>
  );
};
