import React, { useEffect, useState } from 'react';
import { UserPlus, Pencil, Trash2, KeyRound, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { User as UserType, UserRole, CustomRole, Group } from '../types';
import { RoleChips } from '../components/RoleChips';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { FilterBar } from '../components/ui/FilterBar';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { IconButton } from '../components/ui/IconButton';

// Roles come from groups (v3.8.0): a user is assigned groups, never a role directly.
const emptyForm = { name: '', email: '', password: '', department: '', active: true, group_ids: [] as number[] };

export const Users: React.FC = () => {
  const { t } = useTranslation(['users', 'common']);
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const roleLabels: Record<UserRole, string> = {
    admin: t('users:roleLabels.admin'),
    assessor: t('users:roleLabels.assessor'),
    'it-staff': t('users:roleLabels.it-staff'),
    dpo: t('users:roleLabels.dpo'),
    owner: t('users:roleLabels.owner'),
    management: t('users:roleLabels.management'),
    viewer: t('users:roleLabels.viewer'),
    employee: t('users:roleLabels.employee'),
  };

  const [users, setUsers] = useState<UserType[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [authFilter, setAuthFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserType | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [resetPwModal, setResetPwModal] = useState<UserType | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = () => api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([])).finally(() => setLoading(false));
  useEffect(() => {
    load();
    // Custom-Rollen laden (nur Admins haben Zugriff – bei 403 bleibt die Liste leer).
    api.get('/admin/custom-roles').then(r => setCustomRoles(r.data)).catch(() => setCustomRoles([]));
    api.get('/groups').then(r => setGroups(r.data)).catch(() => setGroups([]));
  }, []);

  const toggleGroup = (id: number) => setForm(f => ({
    ...f,
    group_ids: f.group_ids.includes(id) ? f.group_ids.filter(g => g !== id) : [...f.group_ids, id],
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, form);
      } else {
        await api.post('/users', form);
      }
      setModalOpen(false);
      setForm(emptyForm);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('users:toasts.saveError'));
    } finally { setSaving(false); }
  };

  const handleResetPw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwModal) return;
    setSaving(true);
    try {
      await api.put(`/users/${resetPwModal.id}`, { password: newPassword });
      setResetPwModal(null);
      setNewPassword('');
      toast.success(t('users:resetPw.success'));
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('users:toasts.genericError'));
    } finally { setSaving(false); }
  };

  const deleteUser = async (id: number) => {
    if (id === currentUser?.id) { toast.warning(t('users:toasts.selfDeleteWarning')); return; }
    if (!confirm(t('users:confirmDeleteShort'))) return;
    try {
      await api.delete(`/users/${id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('users:toasts.deleteFailed'));
    }
  };

  const filtered = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    // Matches if the user holds the role through any group (or a custom role with that base role).
    const matchesRole = !roleFilter || (u.access_roles || []).some(r => (r.system_role || r.base_role) === roleFilter);
    let matchesAuth = true;
    if (authFilter === 'sso') matchesAuth = !!u.sso_user;
    if (authFilter === 'local') matchesAuth = !u.sso_user;
    if (authFilter === 'mfa') matchesAuth = !!u.totp_enabled || (!!u.passkeys && u.passkeys.length > 0);
    if (authFilter === 'no-mfa') matchesAuth = !u.sso_user && !u.totp_enabled && (!u.passkeys || u.passkeys.length === 0);
    return matchesSearch && matchesRole && matchesAuth;
  });

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('users:title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('users:subtitle', { count: users.length })}</p>
        </div>
        <Button onClick={() => { setEditUser(null); setForm(emptyForm); setModalOpen(true); }}><UserPlus size={16} />{t('users:createUser')}</Button>
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('users:searchPlaceholder')}
        activeCount={[roleFilter, authFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setRoleFilter(''); setAuthFilter(''); }}>
        <Select className="w-44" value={roleFilter} onChange={e => setRoleFilter(e.target.value)} options={[{ value: '', label: t('users:filters.allRoles') }, ...Object.entries(roleLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-52" value={authFilter} onChange={e => setAuthFilter(e.target.value)} options={[
          { value: '', label: t('users:filters.allSecurityLevels') },
          { value: 'sso', label: t('users:filters.ssoOnly') },
          { value: 'local', label: t('users:filters.localOnly') },
          { value: 'mfa', label: t('users:filters.mfaActive') },
          { value: 'no-mfa', label: t('users:filters.mfaInactive') }
        ]} />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <tr><Th>{t('users:fields.name')}</Th><Th>{t('users:fields.email')}</Th><Th>{t('users:fields.groupsAndRoles')}</Th><Th>{t('users:fields.department')}</Th><Th>{t('users:fields.authentication')}</Th><Th>{t('users:fields.status')}</Th><Th>{''}</Th></tr>
            </Thead>
            <Tbody>
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <Td>
                    <div className="flex items-center gap-3">
                       <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-bold text-blue-700 dark:text-blue-400 text-xs">{u.name.charAt(0)}</div>
                       <span className="font-medium dark:text-slate-200">{u.name}</span>
                    </div>
                  </Td>
                  <Td className="text-sm dark:text-slate-400">{u.email}</Td>
                  <Td>
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1">
                        {(u.groups || []).length === 0
                          ? <span className="text-xs text-gray-500 dark:text-slate-500">{t('users:noGroups')}</span>
                          : (u.groups || []).map(g => (
                            <span key={g.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300" title={g.source === 'sso' ? t('users:groupFromSso') : undefined}>
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: g.color || '#9ca3af' }} />{g.name}{g.source === 'sso' ? ' · SSO' : ''}
                            </span>
                          ))}
                      </div>
                      <RoleChips roles={u.access_roles} customRoles={customRoles}
                        empty={<span className="text-[11px] font-medium text-red-600 dark:text-red-400">{t('users:noRole')}</span>} />
                    </div>
                  </Td>
                  <Td className="text-sm dark:text-slate-400">{u.department || '–'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {u.sso_user ? (
                        <Badge value="sso" label={t('users:badges.sso')} />
                      ) : (
                        <Badge value="password" label={t('users:badges.password')} />
                      )}
                      {u.totp_enabled && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" title={t('users:badges.totpTitle')}>
                          <ShieldCheck size={12} />
                          TOTP
                        </span>
                      )}
                      {u.passkeys && u.passkeys.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300" title={t('users:badges.passkeyTitle', { count: u.passkeys.length })}>
                          <KeyRound size={12} />
                          Passkey
                        </span>
                      )}
                      {!u.sso_user && !u.totp_enabled && (!u.passkeys || u.passkeys.length === 0) && (
                        <Badge value="unsecure" label={t('users:badges.twoFactorInactive')} />
                      )}
                    </div>
                  </Td>
                  <Td><Badge value={u.active ? 'active' : 'archived'} label={u.active ? t('users:statusLabels.active') : t('users:statusLabels.deactivated')} /></Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                       <IconButton label={t('common:actions.edit')} onClick={() => { setEditUser(u); setForm({ name: u.name, email: u.email, department: u.department || '', password: '', active: u.active, group_ids: (u.groups || []).map(g => g.id) }); setModalOpen(true); }}><Pencil size={14}/></IconButton>
                       <IconButton label={t('users:resetPw.tooltip')} onClick={() => setResetPwModal(u)}><KeyRound size={14}/></IconButton>
                       <IconButton label={t('common:actions.delete')} variant="danger" onClick={() => deleteUser(u.id)}><Trash2 size={14}/></IconButton>
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editUser ? t('users:form.editTitle') : t('users:form.newTitle')} size="lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label={t('users:form.fullName')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder={t('users:form.fullNamePlaceholder')} />
            </div>
            <Input label={t('users:form.emailLabel')} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required placeholder={t('users:form.emailPlaceholder')} />
            <Input label={t('users:form.departmentLabel')} value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder={t('users:form.departmentPlaceholder')} />

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('users:form.groups')}</label>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">{t('users:form.groupsHint')}</p>
              {groups.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400">{t('users:form.noGroupsYet')}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-60 overflow-y-auto">
                  {groups.map(g => (
                    <label key={g.id} className="flex items-start gap-2 p-2 rounded-lg border dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      <input type="checkbox" className="mt-0.5" checked={form.group_ids.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 dark:text-slate-200">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />{g.name}
                        </span>
                        <RoleChips roles={g.roles} customRoles={customRoles}
                          empty={<span className="text-[11px] text-gray-500 dark:text-slate-500">{t('users:form.groupWithoutRoles')}</span>} />
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {!editUser && (
              <Input label={t('users:form.initialPassword')} type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
            )}

            {editUser && (
              <div className="md:col-span-2 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-xl border dark:border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold dark:text-white">{t('users:form.accountStatus')}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{t('users:form.accountStatusHint')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, active: !form.active })}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${form.active !== false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                >
                  {form.active !== false ? t('users:form.active') : t('users:form.deactivated')}
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('common:actions.cancel')}</Button>
            <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('users:form.saving') : (editUser ? t('users:form.saveChanges') : t('users:form.createUser'))}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!resetPwModal} onClose={() => setResetPwModal(null)} title={t('users:resetPw.title')} size="md">
        <form onSubmit={handleResetPw} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">{t('users:resetPw.intro')} <strong>{resetPwModal?.name}</strong></p>
          <Input label={t('users:resetPw.newPassword')} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setResetPwModal(null)} className="flex-1 justify-center">{t('common:actions.cancel')}</Button>
            <Button type="submit" disabled={saving || !newPassword} className="flex-1 justify-center">{saving ? t('users:resetPw.saving') : t('users:resetPw.setPassword')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
