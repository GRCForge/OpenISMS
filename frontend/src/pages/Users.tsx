import React, { useEffect, useState } from 'react';
import { UserPlus, Pencil, Trash2, KeyRound, ShieldCheck } from 'lucide-react';
import api from '../lib/api';
import type { User as UserType, UserRole, CustomRole } from '../types';
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

const roleLabels: Record<UserRole, string> = {
  admin: 'Administrator',
  assessor: 'Auditor / Bewerter',
  'it-staff': 'IT-Mitarbeiter',
  dpo: 'Datenschutzbeauftragter',
  owner: 'Asset Owner',
  management: 'Management',
  viewer: 'Betrachter',
  employee: 'Mitarbeiter'
};

const emptyForm = { name: '', email: '', password: '', role: 'viewer' as UserRole, department: '', active: true, custom_role_id: null as number | null };

export const Users: React.FC = () => {
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<UserType[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [authFilter, setAuthFilter] = useState('');
  const [roleChanging, setRoleChanging] = useState<number | null>(null);

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
  }, []);

  const roleSelectValue = (u: { role: UserRole; custom_role_id?: number | null }) =>
    u.custom_role_id ? `custom:${u.custom_role_id}` : u.role;

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
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
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
      toast.success('Passwort wurde erfolgreich zurückgesetzt.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    } finally { setSaving(false); }
  };

  const changeRole = async (u: UserType, value: string) => {
    if (u.id === currentUser?.id) { toast.warning('Eigene Rolle kann nicht geändert werden.'); return; }
    setRoleChanging(u.id);
    try {
      const body = value.startsWith('custom:')
        ? { custom_role_id: parseInt(value.slice(7)) }
        : { role: value, custom_role_id: null };
      await api.put(`/users/${u.id}`, body);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Rolle konnte nicht geändert werden');
    } finally { setRoleChanging(null); }
  };

  const deleteUser = async (id: number) => {
    if (id === currentUser?.id) { toast.warning('Sie können sich nicht selbst löschen.'); return; }
    if (!confirm('Benutzer wirklich löschen?')) return;
    try {
      await api.delete(`/users/${id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Löschen fehlgeschlagen');
    }
  };

  const filtered = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = !roleFilter || u.role === roleFilter;
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
          <h1 className="text-2xl font-bold dark:text-white">Benutzerverwaltung</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{users.length} registrierte Benutzer</p>
        </div>
        <Button onClick={() => { setEditUser(null); setForm(emptyForm); setModalOpen(true); }}><UserPlus size={16} />Benutzer anlegen</Button>
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder="Benutzer suchen..."
        activeCount={[roleFilter, authFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setRoleFilter(''); setAuthFilter(''); }}>
        <Select className="w-44" value={roleFilter} onChange={e => setRoleFilter(e.target.value)} options={[{ value: '', label: 'Alle Rollen' }, ...Object.entries(roleLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-52" value={authFilter} onChange={e => setAuthFilter(e.target.value)} options={[
          { value: '', label: 'Alle Sicherheitsstufen' },
          { value: 'sso', label: 'Nur SSO-Benutzer' },
          { value: 'local', label: 'Nur lokale Benutzer' },
          { value: 'mfa', label: 'MFA / Passkey aktiv' },
          { value: 'no-mfa', label: 'MFA inaktiv (unsicher)' }
        ]} />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead>
              <tr><Th>Name</Th><Th>E-Mail</Th><Th>Rolle</Th><Th>Abteilung</Th><Th>Authentifizierung</Th><Th>Status</Th><Th>{''}</Th></tr>
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
                    <select
                      value={roleSelectValue(u)}
                      disabled={u.id === currentUser?.id || roleChanging === u.id}
                      onChange={e => changeRole(u, e.target.value)}
                      className="text-xs font-medium rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-200 px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={u.id === currentUser?.id ? 'Eigene Rolle nicht änderbar' : 'Rolle direkt ändern'}
                    >
                      {Object.entries(roleLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      {customRoles.length > 0 && (
                        <optgroup label="Benutzerdefinierte Rollen">
                          {customRoles.map(cr => <option key={cr.id} value={`custom:${cr.id}`}>{cr.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </Td>
                  <Td className="text-sm dark:text-slate-400">{u.department || '–'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {u.sso_user ? (
                        <Badge value="sso" label="SSO" />
                      ) : (
                        <Badge value="password" label="Passwort" />
                      )}
                      {u.totp_enabled && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" title="Zwei-Faktor-Authentifizierung via App aktiv">
                          <ShieldCheck size={12} />
                          TOTP
                        </span>
                      )}
                      {u.passkeys && u.passkeys.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300" title={`${u.passkeys.length} Passkey(s) registriert`}>
                          <KeyRound size={12} />
                          Passkey
                        </span>
                      )}
                      {!u.sso_user && !u.totp_enabled && (!u.passkeys || u.passkeys.length === 0) && (
                        <Badge value="unsecure" label="2FA inaktiv" />
                      )}
                    </div>
                  </Td>
                  <Td><Badge value={u.active ? 'active' : 'archived'} label={u.active ? 'Aktiv' : 'Deaktiviert'} /></Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                       <button onClick={() => { setEditUser(u); setForm({ ...u, department: u.department || '', password: '', custom_role_id: u.custom_role_id ?? null }); setModalOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition-colors"><Pencil size={14}/></button>
                       <button onClick={() => setResetPwModal(u)} className="p-1 text-gray-400 hover:text-yellow-600 transition-colors" title="Passwort zurücksetzen"><KeyRound size={14}/></button>
                       <button onClick={() => deleteUser(u.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editUser ? 'Benutzer bearbeiten' : 'Neuen Benutzer anlegen'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label="Vollständiger Name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="z. B. Max Mustermann" />
            </div>
            <Input label="E-Mail-Adresse *" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required placeholder="max.mustermann@firma.de" />
            <Input label="Abteilung / Team" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="z. B. IT-Operations" />
            
            <Select label="System-Rolle *"
              value={form.custom_role_id ? `custom:${form.custom_role_id}` : form.role}
              onChange={e => {
                const v = e.target.value;
                if (v.startsWith('custom:')) setForm({ ...form, custom_role_id: parseInt(v.slice(7)) });
                else setForm({ ...form, role: v as UserRole, custom_role_id: null });
              }}>
              <option value="admin">Administrator (Vollzugriff)</option>
              <option value="assessor">Auditor / Bewerter</option>
              <option value="it-staff">IT-Mitarbeiter</option>
              <option value="dpo">Datenschutzbeauftragter</option>
              <option value="owner">Asset Owner (Verantwortlich)</option>
              <option value="viewer">Betrachter (Leserechte)</option>
              {customRoles.length > 0 && (
                <optgroup label="Benutzerdefinierte Rollen">
                  {customRoles.map(cr => <option key={cr.id} value={`custom:${cr.id}`}>{cr.name}</option>)}
                </optgroup>
              )}
            </Select>

            {!editUser && (
              <Input label="Initial-Passwort *" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
            )}

            {editUser && (
              <div className="md:col-span-2 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-xl border dark:border-slate-800 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold dark:text-white">Account-Status</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Deaktivierte Benutzer können sich nicht mehr am Portal anmelden.</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setForm({ ...form, active: !form.active })}
                  className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${form.active !== false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                >
                  {form.active !== false ? 'Aktiv' : 'Deaktiviert'}
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? 'Speichern...' : (editUser ? 'Änderungen speichern' : 'Benutzer anlegen')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!resetPwModal} onClose={() => setResetPwModal(null)} title="Passwort zurücksetzen" size="md">
        <form onSubmit={handleResetPw} className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">Neues Passwort für <strong>{resetPwModal?.name}</strong> festlegen:</p>
          <Input label="Neues Passwort *" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setResetPwModal(null)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" disabled={saving || !newPassword} className="flex-1 justify-center">{saving ? 'Speichern...' : 'Passwort setzen'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
