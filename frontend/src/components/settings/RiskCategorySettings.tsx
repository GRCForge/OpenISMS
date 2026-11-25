import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Tags, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { Card, CardHeader, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { IconButton } from '../ui/IconButton';
import type { RiskCategory } from '../../types';

interface Props {
  categories: RiskCategory[];
  canManage: boolean;
  onChanged: () => void;
}

type Edit = Pick<RiskCategory, 'label_de' | 'label_en' | 'description'> & { label_es: string; sort_order: number; active: boolean };
const emptyNew = { key: '', label_de: '', label_en: '', label_es: '', description: '' };

// Risk category taxonomy (risks.manage_methodology). The key is fixed once an
// entry exists - risks and methodology versions refer to it; labels, order and
// the active flag can change. Removing is only possible while nothing uses it.
export const RiskCategorySettings: React.FC<Props> = ({ categories, canManage, onChanged }) => {
  const { t } = useTranslation(['risks', 'common']);
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [newCat, setNewCat] = useState({ ...emptyNew });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const editOf = (c: RiskCategory): Edit => edits[c.id] || { label_de: c.label_de, label_en: c.label_en, label_es: c.label_es || '', description: c.description, sort_order: c.sort_order, active: c.active };
  const patch = (c: RiskCategory, p: Partial<Edit>) => setEdits(e => ({ ...e, [c.id]: { ...editOf(c), ...p } }));
  const fail = (err: any) => setMsg({ ok: false, text: err?.response?.data?.error || t('risks:toast.errorSaving') });

  const saveRow = async (c: RiskCategory) => {
    const e = editOf(c);
    try {
      await api.put(`/risks/categories/${c.id}`, { ...e, label_es: e.label_es || null, description: e.description || null });
      setEdits(x => { const n = { ...x }; delete n[c.id]; return n; });
      setMsg({ ok: true, text: t('risks:categoriesAdmin.saved') });
      onChanged();
    } catch (err) { fail(err); }
  };
  const removeRow = async (c: RiskCategory) => {
    if (!confirm(t('risks:categoriesAdmin.confirmDelete', { label: c.label_de }))) return;
    try { await api.delete(`/risks/categories/${c.id}`); onChanged(); } catch (err) { fail(err); }
  };
  const create = async () => {
    try {
      await api.post('/risks/categories', { ...newCat, key: newCat.key || undefined, label_es: newCat.label_es || null, description: newCat.description || null });
      setNewCat({ ...emptyNew });
      setMsg({ ok: true, text: t('risks:categoriesAdmin.saved') });
      onChanged();
    } catch (err) { fail(err); }
  };

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Tags size={16} className="text-blue-500" /><h3 className="font-semibold dark:text-white">{t('risks:categoriesAdmin.title')}</h3></div></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-slate-400">{t('risks:categoriesAdmin.hint')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-slate-400">
                <th className="py-1 pr-2">{t('risks:categoriesAdmin.key')}</th><th className="py-1 pr-2">DE</th><th className="py-1 pr-2">EN</th><th className="py-1 pr-2">ES</th>
                <th className="py-1 pr-2 w-20">{t('risks:categoriesAdmin.order')}</th><th className="py-1 pr-2">{t('risks:categoriesAdmin.active')}</th><th className="py-1 pr-2">{t('risks:categoriesAdmin.risks')}</th><th />
              </tr>
            </thead>
            <tbody>
              {categories.map(c => {
                const e = editOf(c);
                return (
                  <tr key={c.id} className="align-top">
                    <td className="py-1 pr-2 font-mono dark:text-slate-300">{c.key}{c.origin === 'migration' && <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400" title={t('risks:categoriesAdmin.migratedHint')}>({t('risks:categoriesAdmin.migrated')})</span>}</td>
                    <td className="py-1 pr-2"><Input aria-label={`${c.key} DE`} value={e.label_de} disabled={!canManage} onChange={ev => patch(c, { label_de: ev.target.value })} /></td>
                    <td className="py-1 pr-2"><Input aria-label={`${c.key} EN`} value={e.label_en} disabled={!canManage} onChange={ev => patch(c, { label_en: ev.target.value })} /></td>
                    <td className="py-1 pr-2"><Input aria-label={`${c.key} ES`} value={e.label_es} disabled={!canManage} onChange={ev => patch(c, { label_es: ev.target.value })} /></td>
                    <td className="py-1 pr-2"><Input type="number" min={0} aria-label={`${c.key} ${t('risks:categoriesAdmin.order')}`} value={e.sort_order} disabled={!canManage} onChange={ev => patch(c, { sort_order: Number(ev.target.value) || 0 })} /></td>
                    <td className="py-2 pr-2"><input type="checkbox" aria-label={`${c.key} ${t('risks:categoriesAdmin.active')}`} className="w-3.5 h-3.5 rounded text-blue-600" checked={e.active} disabled={!canManage} onChange={ev => patch(c, { active: ev.target.checked })} /></td>
                    <td className="py-2 pr-2 dark:text-slate-300">{c.risk_count}</td>
                    <td className="py-1 whitespace-nowrap">
                      {canManage && edits[c.id] && <IconButton label={t('common:actions.save', { defaultValue: 'Save' })} onClick={() => saveRow(c)}><Save size={13} /></IconButton>}
                      {canManage && c.risk_count === 0 && <IconButton label={t('common:actions.delete')} variant="danger" onClick={() => removeRow(c)}><Trash2 size={13} /></IconButton>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canManage && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end pt-2 border-t dark:border-slate-800">
            <Input label={t('risks:categoriesAdmin.key')} value={newCat.key} onChange={e => setNewCat({ ...newCat, key: e.target.value })} placeholder={t('risks:categoriesAdmin.keyPlaceholder')} />
            <Input label="DE" value={newCat.label_de} onChange={e => setNewCat({ ...newCat, label_de: e.target.value })} />
            <Input label="EN" value={newCat.label_en} onChange={e => setNewCat({ ...newCat, label_en: e.target.value })} />
            <Input label="ES" value={newCat.label_es} onChange={e => setNewCat({ ...newCat, label_es: e.target.value })} />
            <Button type="button" variant="secondary" onClick={create} disabled={!newCat.label_de.trim() || !newCat.label_en.trim()}><Plus size={13} />{t('risks:categoriesAdmin.add')}</Button>
          </div>
        )}
        {msg && <p className={`text-xs ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
};
