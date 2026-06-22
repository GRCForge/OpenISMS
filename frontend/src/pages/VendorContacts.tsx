import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Pencil, Trash2, Mail, Phone, Building2 } from 'lucide-react';
import { FilterBar } from '../components/ui/FilterBar';
import api from '../lib/api';
import type { Vendor, VendorContact } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

const emptyContact = { name: '', email: '', phone: '', role: '', notes: '', vendor_id: '' };
const emptyVendor = { name: '', type: 'software' as any };

export const VendorContacts: React.FC = () => {
  const { t } = useTranslation('vendorcontacts');
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const canEdit = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'it-staff';

  const typeOptions = [
    { value: 'software', label: t('types.software') },
    { value: 'cloud', label: t('types.cloud') },
    { value: 'hardware', label: t('types.hardware') },
    { value: 'consulting', label: t('types.consulting') },
    { value: 'hosting', label: t('types.hosting') },
    { value: 'logistics', label: t('types.logistics') },
    { value: 'other', label: t('types.other') },
  ];

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [contacts, setContacts] = useState<(VendorContact & { vendor?: Vendor })[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editContact, setEditContact] = useState<VendorContact | null>(null);
  const [form, setForm] = useState<Record<string, string>>(emptyContact);
  const [saving, setSaving] = useState(false);

  const [isNewVendor, setIsNewVendor] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState(emptyVendor);

  const load = async () => {
    try {
      const res = await api.get('/vendors');
      setVendors(res.data);
      const allContacts: any[] = [];
      res.data.forEach((v: Vendor) => {
        (v.contacts || []).forEach(c => {
          allContacts.push({ ...c, vendor: v });
        });
      });
      setContacts(allContacts);
    } catch {
      toast.error(t('toast.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      let targetVendorId = form.vendor_id;

      if (isNewVendor) {
        if (!newVendorForm.name) throw new Error(t('form.newCompanyName'));
        const vRes = await api.post('/vendors', newVendorForm);
        targetVendorId = String(vRes.data.id);
      }

      if (!targetVendorId) throw new Error(t('form.selectCompany'));

      if (editContact) {
        await api.put(`/vendors/${targetVendorId}/contacts/${editContact.id}`, form);
      } else {
        await api.post(`/vendors/${targetVendorId}/contacts`, { ...form, vendor_id: targetVendorId });
      }

      setModalOpen(false);
      setIsNewVendor(false);
      setNewVendorForm(emptyVendor);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || t('toast.saveError'));
    } finally { setSaving(false); }
  };

  const deleteContact = async (vId: number, cId: number) => {
    if (!confirm(t('confirm.delete'))) return;
    try {
      await api.delete(`/vendors/${vId}/contacts/${cId}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.deleteError'));
    }
  };

  const filtered = contacts.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
                         (c.role || '').toLowerCase().includes(search.toLowerCase()) ||
                         (c.email || '').toLowerCase().includes(search.toLowerCase());
    const matchesVendor = !vendorFilter || String(c.vendor_id) === vendorFilter;
    const matchesType = !typeFilter || c.vendor?.type === typeFilter;
    const matchesRole = !roleFilter || c.role === roleFilter;
    return matchesSearch && matchesVendor && matchesType && matchesRole;
  });

  const uniqueRoles = Array.from(new Set(contacts.map(c => c.role).filter((role): role is string => !!role))).sort((a, b) => a.localeCompare(b));

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', { count: contacts.length, vendors: vendors.length })}</p>
        </div>
        {canEdit && (
          <Button onClick={() => { setEditContact(null); setForm(emptyContact); setIsNewVendor(false); setModalOpen(true); }}><UserPlus size={16} />{t('new')}</Button>
        )}
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder={t('searchPlaceholder')}
        activeCount={[vendorFilter, typeFilter, roleFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setVendorFilter(''); setTypeFilter(''); setRoleFilter(''); }}>
        <Select
          className="w-44"
          value={vendorFilter}
          onChange={e => setVendorFilter(e.target.value)}
          options={[
            { value: '', label: t('filters.allCompanies') },
            ...vendors.map(v => ({ value: String(v.id), label: v.name }))
          ]}
        />
        <Select
          className="w-44"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          options={[
            { value: '', label: t('filters.allTypes') },
            ...typeOptions
          ]}
        />
        <Select
          className="w-44"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          options={[
            { value: '', label: t('filters.allRoles') },
            ...uniqueRoles.map(r => ({ value: r!, label: r! }))
          ]}
        />
      </FilterBar>

      <Card>
        <Table>
          <Thead>
            <tr><Th>{t('table.name')}</Th><Th>{t('table.company')}</Th><Th className="hidden sm:table-cell">{t('table.role')}</Th><Th className="hidden min-[480px]:table-cell">{t('table.contact')}</Th><Th className="text-right">{t('table.actions')}</Th></tr>
          </Thead>
          <Tbody>
            {filtered.map(c => (
              <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <Td>
                  <div className="flex flex-col">
                    <span className="font-medium dark:text-slate-200">{c.name}</span>
                    <div className="flex sm:hidden flex-col gap-0.5 mt-1">
                       <span className="text-[10px] text-gray-500">{c.role || '–'}</span>
                       {c.email && <span className="text-[10px] text-blue-500 truncate">{c.email}</span>}
                    </div>
                  </div>
                </Td>
                <Td>
                   <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-gray-400 shrink-0" />
                      <span className="text-sm dark:text-slate-400 truncate">{c.vendor?.name}</span>
                   </div>
                </Td>
                <Td className="hidden sm:table-cell"><span className="text-sm text-gray-600 dark:text-slate-400">{c.role || '–'}</span></Td>
                <Td className="hidden min-[480px]:table-cell">
                   <div className="flex flex-col gap-0.5">
                      {c.email && <a href={`mailto:${c.email}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Mail size={10}/>{c.email}</a>}
                      {c.phone && <span className="text-xs text-gray-500 flex items-center gap-1"><Phone size={10}/>{c.phone}</span>}
                   </div>
                </Td>
                <Td>
                  <div className="flex justify-end gap-2">
                    {canEdit && (
                      <>
                        <button onClick={() => { setEditContact(c); setForm({ name: c.name, email: c.email || '', phone: c.phone || '', role: c.role || '', notes: c.notes || '', vendor_id: String(c.vendor_id) }); setIsNewVendor(false); setModalOpen(true); }} className="p-1 text-gray-400 hover:text-blue-600 transition-colors"><Pencil size={14}/></button>
                        {user?.role === 'admin' && <button onClick={() => deleteContact(c.vendor_id, c.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={14}/></button>}
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400 dark:text-slate-500">{t('empty')}</td></tr>
            )}
          </Tbody>
        </Table>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editContact ? t('modal.editTitle') : t('modal.newTitle')} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-2xl border dark:border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-bold dark:text-slate-200 uppercase tracking-wider text-[10px]">{t('form.company')}</label>
              {!editContact && (
                <button type="button" onClick={() => setIsNewVendor(!isNewVendor)} className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline flex items-center gap-1">
                  {isNewVendor ? t('form.switchToExisting') : t('form.switchToNew')}
                </button>
              )}
            </div>

            {isNewVendor && !editContact ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                <Input label={t('form.newCompanyName')} value={newVendorForm.name} onChange={e => setNewVendorForm({ ...newVendorForm, name: e.target.value })} required placeholder={t('form.newCompanyNamePlaceholder')} />
                <Select label={t('form.type')} value={newVendorForm.type} onChange={e => setNewVendorForm({ ...newVendorForm, type: e.target.value as any })}
                  options={typeOptions} />
              </div>
            ) : (
              <Select value={form.vendor_id} onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}
                options={[{ value: '', label: t('form.selectCompany') }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]} required />
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-2">
            <div className="md:col-span-2">
              <Input label={t('form.fullName')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder={t('form.fullNamePlaceholder')} />
            </div>
            <Input label={t('form.functionRole')} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder={t('form.functionRolePlaceholder')} />
            <Input label={t('form.department')} value={form.department || ''} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder={t('form.departmentPlaceholder')} />

            <Input label={t('form.email')} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@firma.de" />
            <Input label={t('form.phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+49 123 456789" />

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('form.notes')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t('form.notesPlaceholder')} />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('form.cancel')}</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? t('form.saving') : (editContact ? t('form.save') : t('form.create'))}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
