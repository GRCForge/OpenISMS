import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Users, Plus, Pencil, Trash2, UserPlus, UserMinus, Tag } from 'lucide-react';
import api from '../lib/api';
import type { Group, User } from '../types';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const emptyForm = { name: '', description: '', color: '#3b82f6' };

export const Groups: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation('groups');

  const [groups, setGroups] = useState<Group[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [memberModal, setMemberModal] = useState<Group | null>(null);
  const [addUserId, setAddUserId] = useState('');

  const load = () => {
    Promise.all([api.get('/groups'), api.get('/users')])
      .then(([g, u]) => { setGroups(g.data); setAllUsers(u.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditGroup(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (g: Group) => {
    setEditGroup(g);
    setForm({ name: g.name, description: g.description || '', color: g.color });
    setModalOpen(true);
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSaving(true);
    try {
      if (editGroup) {
        await api.put(`/groups/${editGroup.id}`, form);
        toast.success(t('toast.updated'));
      } else {
        await api.post('/groups', form);
        toast.success(t('toast.created'));
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.saveError'));
    } finally { setSaving(false); }
  };

  const handleDelete = async (g: Group) => {
    if (!confirm(t('confirm.delete', { name: g.name }))) return;
    try {
      await api.delete(`/groups/${g.id}`);
      toast.success(t('toast.deleted'));
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.deleteFailed'));
    }
  };

  const handleAddMember = async () => {
    if (!memberModal || !addUserId) return;
    try {
      await api.post(`/groups/${memberModal.id}/members`, { user_id: Number(addUserId) });
      toast.success(t('toast.memberAdded'));
      setAddUserId('');
      load();
      const updated = await api.get(`/groups/${memberModal.id}`);
      setMemberModal(updated.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.error'));
    }
  };

  const handleRemoveMember = async (groupId: number, userId: number) => {
    try {
      await api.delete(`/groups/${groupId}/members/${userId}`);
      toast.success(t('toast.memberRemoved'));
      load();
      const updated = await api.get(`/groups/${groupId}`);
      setMemberModal(updated.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.error'));
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="text-center py-20 text-gray-500 dark:text-slate-400">
        {t('adminOnly')}
      </div>
    );
  }

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Tag size={24} className="text-blue-600" />
            {t('title')}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {t('subtitle', { count: groups.length })}
          </p>
        </div>
        <Button onClick={openCreate}><Plus size={16} />{t('new')}</Button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-800 rounded-2xl">
          <Tag size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3" />
          <p className="text-gray-500 dark:text-slate-400 font-medium">{t('empty.title')}</p>
          <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">{t('empty.subtitle')}</p>
          <Button onClick={openCreate} className="mt-4"><Plus size={16} />{t('empty.createFirst')}</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(g => (
            <Card key={g.id} className="p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                  <span className="font-semibold text-gray-900 dark:text-white">{g.name}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => setMemberModal(g)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    title={t('manageMembers')}
                  >
                    <Users size={14} />
                  </button>
                  <button
                    onClick={() => openEdit(g)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(g)}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {g.description && (
                <p className="text-sm text-gray-500 dark:text-slate-400 line-clamp-2">{g.description}</p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {g.members.length === 0 ? (
                  <span className="text-xs text-gray-400 dark:text-slate-600">{t('noMembers')}</span>
                ) : (
                  <>
                    <div className="flex -space-x-2">
                      {g.members.slice(0, 5).map(m => (
                        <div
                          key={m.id}
                          className="w-7 h-7 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900"
                          style={{ backgroundColor: g.color }}
                          title={m.name}
                        >
                          {m.name.slice(0, 2).toUpperCase()}
                        </div>
                      ))}
                      {g.members.length > 5 && (
                        <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300 text-[10px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                          +{g.members.length - 5}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 dark:text-slate-500">{t('memberCount', { count: g.members.length })}</span>
                  </>
                )}
              </div>

              <div className="pt-2 border-t dark:border-slate-700">
                <p className="text-[11px] text-gray-400 dark:text-slate-600">
                  <Trans
                    i18nKey="groups:mentionHint"
                    values={{ name: g.name }}
                    components={{ code: <span className="font-mono font-semibold text-blue-600 dark:text-blue-400" /> }}
                  />
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t(editGroup ? 'modal.editTitle' : 'modal.newTitle')} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('form.name')}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            required
            autoFocus
            placeholder={t('form.namePlaceholder')}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('form.description')}</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('form.descriptionPlaceholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">{t('form.color')}</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2 border-t dark:border-slate-700">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">{t('form.cancel')}</Button>
            <Button type="submit" disabled={saving} className="flex-1">{saving ? t('form.saving') : t('form.save')}</Button>
          </div>
        </form>
      </Modal>

      {/* Member Management Modal */}
      <Modal
        open={!!memberModal}
        onClose={() => setMemberModal(null)}
        title={t('members.modalTitle', { name: memberModal?.name })}
        size="md"
      >
        {memberModal && (
          <div className="space-y-4">
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {memberModal.members.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-slate-600 py-2 text-center">{t('members.empty')}</p>
              ) : (
                memberModal.members.map(m => (
                  <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-slate-800/50">
                    <div>
                      <span className="text-sm font-medium text-gray-800 dark:text-slate-200">{m.name}</span>
                      <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">{m.email}</span>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(memberModal.id, m.id)}
                      className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                      title={t('members.remove')}
                    >
                      <UserMinus size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t dark:border-slate-700 space-y-2">
              <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{t('members.addTitle')}</p>
              <div className="flex gap-2">
                <select
                  className="flex-1 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={addUserId}
                  onChange={e => setAddUserId(e.target.value)}
                >
                  <option value="">{t('members.selectUser')}</option>
                  {allUsers
                    .filter(u => !memberModal.members.some(m => m.id === u.id))
                    .map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                    ))}
                </select>
                <Button onClick={handleAddMember} disabled={!addUserId}>
                  <UserPlus size={14} />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
