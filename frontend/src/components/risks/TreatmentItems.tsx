import React, { useState } from 'react';
import { Plus, ListChecks, Pencil, ClipboardList, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import type { Risk, RiskTreatment, RiskTreatmentItem, RiskTreatmentItemStatus, User, Group, Control } from '../../types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../../contexts/ToastContext';

// Structured risk treatment plan of one risk (3.8.0, ISO 27001 6.1.3 e).
// Items live in their own API (/risks/:id/treatment-items); the free-text plan
// of the risk form is not touched.

const OPTIONS: RiskTreatment[] = ['mitigate', 'transfer', 'avoid', 'accept'];
const STATUSES: RiskTreatmentItemStatus[] = ['planned', 'in_progress', 'implemented', 'discarded'];

interface ItemForm {
  id: number | null;
  title: string; description: string; treatment_option: RiskTreatment;
  responsible: string; // 'u:<id>' | 'g:<id>' | ''
  due_date: string; status: RiskTreatmentItemStatus; status_reason: string;
  cost_once: string; cost_recurring: string; control_id: string;
}

const emptyForm: ItemForm = { id: null, title: '', description: '', treatment_option: 'mitigate', responsible: '', due_date: '', status: 'planned', status_reason: '', cost_once: '', cost_recurring: '', control_id: '' };

const toForm = (i: RiskTreatmentItem): ItemForm => ({
  id: i.id, title: i.title, description: i.description || '', treatment_option: i.treatment_option,
  responsible: i.responsible_user_id ? `u:${i.responsible_user_id}` : i.responsible_group_id ? `g:${i.responsible_group_id}` : '',
  due_date: i.due_date ? String(i.due_date).slice(0, 10) : '', status: i.status, status_reason: i.status_reason || '',
  cost_once: i.cost_once != null ? String(Number(i.cost_once)) : '', cost_recurring: i.cost_recurring != null ? String(Number(i.cost_recurring)) : '',
  control_id: i.control_id ? String(i.control_id) : '',
});

const eur = (v: number, lang: string) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : lang === 'es' ? 'es-ES' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(v);

interface Props {
  risk: Risk | null;
  canEdit: boolean;
  users: User[];
  groups: Group[];
  controls: Control[];
  levelLabel: (key?: string | null) => string;
  onChanged: () => void;
}

export const TreatmentItems: React.FC<Props> = ({ risk, canEdit, users, groups, controls, levelLabel, onChanged }) => {
  const { t, i18n } = useTranslation('risks');
  const toast = useToast();
  const [form, setForm] = useState<ItemForm | null>(null);
  const [busy, setBusy] = useState(false);
  const items = risk?.treatmentItems || [];
  const progress = risk?.treatment_progress;
  const today = new Date().toISOString().slice(0, 10);

  if (!risk) return <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('items.saveFirst')}</p>;

  const save = async () => {
    if (!form) return;
    const [kind, id] = form.responsible.split(':');
    const body = {
      title: form.title, description: form.description || null, treatment_option: form.treatment_option,
      responsible_user_id: kind === 'u' ? Number(id) : null, responsible_group_id: kind === 'g' ? Number(id) : null,
      due_date: form.due_date || null, status: form.status, status_reason: form.status_reason || null,
      cost_once: form.cost_once === '' ? null : Number(form.cost_once), cost_recurring: form.cost_recurring === '' ? null : Number(form.cost_recurring),
      control_id: form.control_id ? Number(form.control_id) : null,
    };
    setBusy(true);
    try {
      if (form.id) await api.put(`/risks/${risk.id}/treatment-items/${form.id}`, body);
      else await api.post(`/risks/${risk.id}/treatment-items`, body);
      toast.success(t('items.saved'));
      setForm(null);
      onChanged();
    } catch (err: any) { toast.error(err.response?.data?.error || t('toast.errorSaving')); }
    finally { setBusy(false); }
  };

  const createTask = async (item: RiskTreatmentItem) => {
    setBusy(true);
    try {
      await api.post(`/risks/${risk.id}/treatment-items/${item.id}/task`, {});
      toast.success(t('items.taskCreated'));
      onChanged();
    } catch (err: any) { toast.error(err.response?.data?.error || t('toast.errorSaving')); }
    finally { setBusy(false); }
  };

  const responsibleOptions = [
    { value: '', label: t('items.none') },
    ...users.map(u => ({ value: `u:${u.id}`, label: `${t('items.responsiblePerson')}: ${u.name}` })),
    ...groups.map(g => ({ value: `g:${g.id}`, label: `${t('items.responsibleGroup')}: ${g.name}` })),
  ];
  const area = 'w-full bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2 text-sm dark:text-white';
  const active = progress ? progress.total - progress.discarded : 0;

  return (
    <section className="md:col-span-2 p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider flex items-center gap-1.5"><ListChecks size={13} />{t('items.title', { count: items.length })}</h3>
          <p className="text-[11px] text-gray-500 dark:text-slate-400">{t('items.hint')}</p>
        </div>
        {canEdit && !form && <Button type="button" size="sm" variant="secondary" onClick={() => setForm({ ...emptyForm })}><Plus size={12} />{t('items.add')}</Button>}
      </div>

      {progress && progress.total > 0 && (
        <div className="space-y-1">
          <div className="h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-valuenow={progress.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-emerald-500" style={{ width: `${progress.percent ?? 0}%` }} />
          </div>
          <p className="text-[11px] text-gray-600 dark:text-slate-400">
            {t('items.progress', { implemented: progress.implemented, active, percent: progress.percent ?? 0 })}
            {progress.overdue > 0 && <span className="ml-2 text-red-600 dark:text-red-400">{progress.overdue} {t('items.overdue')}</span>}
            {progress.cost_once_total !== undefined && <span className="ml-2">{t('items.costs', { once: eur(progress.cost_once_total, i18n.language), recurring: eur(progress.cost_recurring_total || 0, i18n.language) })}</span>}
          </p>
          {progress.complete_above_appetite && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/50 rounded-lg p-2">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />{t('items.completeAboveAppetite', { level: levelLabel(risk.appetite_max_level) })}
            </p>
          )}
        </div>
      )}

      {items.length === 0 && !form && <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('items.empty')}</p>}
      {items.map(i => {
        const overdue = !['implemented', 'discarded'].includes(i.status) && !!i.due_date && String(i.due_date).slice(0, 10) < today;
        return (
          <div key={i.id} className="p-2.5 rounded-lg border dark:border-slate-700 bg-white dark:bg-slate-900/50 text-xs space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={`font-semibold dark:text-slate-200 ${i.status === 'discarded' ? 'line-through text-gray-500' : ''}`}>{i.title}</p>
                <p className="text-gray-500 dark:text-slate-400">
                  {t(`treatment.${i.treatment_option}`)} · {t(`items.statuses.${i.status}`)}
                  {i.responsibleUser && ` · ${i.responsibleUser.name}`}{i.responsibleGroup && ` · ${i.responsibleGroup.name}`}
                  {i.due_date && <span className={overdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''}> · {String(i.due_date).slice(0, 10)}{overdue ? ` (${t('items.overdue')})` : ''}</span>}
                </p>
                {i.status === 'discarded' && i.status_reason && <p className="text-gray-500 dark:text-slate-400">{t('items.reason')}: {i.status_reason}</p>}
                <p className="text-gray-500 dark:text-slate-400">
                  {i.cost_once != null && <span>{eur(Number(i.cost_once), i18n.language)} </span>}
                  {i.cost_recurring != null && <span>+ {eur(Number(i.cost_recurring), i18n.language)}/a </span>}
                  {i.control && <span>· {i.control.code || ''} {i.control.title} </span>}
                  {i.task && <span>· {t('items.task')} #{i.task.id} ({t(`items.taskStatus.${i.task.status}`, { defaultValue: i.task.status })})</span>}
                </p>
              </div>
              {canEdit && (
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline flex items-center gap-1" onClick={() => setForm(toForm(i))}><Pencil size={11} />{t('items.edit')}</button>
                  {!['implemented', 'discarded'].includes(i.status) && (!i.task || i.task.status === 'cancelled') && (
                    <button type="button" disabled={busy} className="text-emerald-700 dark:text-emerald-300 hover:underline flex items-center gap-1" onClick={() => createTask(i)}><ClipboardList size={11} />{t('items.createTask')}</button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {form && canEdit && (
        <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-white dark:bg-slate-900/50 space-y-2">
          <Input label={t('items.name')} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <textarea className={area} rows={2} placeholder={t('items.description')} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Select label={t('items.option')} value={form.treatment_option} onChange={e => setForm({ ...form, treatment_option: e.target.value as RiskTreatment })} options={OPTIONS.map(o => ({ value: o, label: t(`treatment.${o}`) }))} />
            <Select label={t('items.responsible')} value={form.responsible} onChange={e => setForm({ ...form, responsible: e.target.value })} options={responsibleOptions} />
            <Input label={t('items.due')} type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} />
            <Select label={t('items.status')} value={form.status} onChange={e => setForm({ ...form, status: e.target.value as RiskTreatmentItemStatus })} options={STATUSES.map(s => ({ value: s, label: t(`items.statuses.${s}`) }))} />
            <Input label={t('items.costOnce')} type="number" min={0} step="0.01" value={form.cost_once} onChange={e => setForm({ ...form, cost_once: e.target.value })} />
            <Input label={t('items.costRecurring')} type="number" min={0} step="0.01" value={form.cost_recurring} onChange={e => setForm({ ...form, cost_recurring: e.target.value })} />
          </div>
          <Select label={t('items.control')} value={form.control_id} onChange={e => setForm({ ...form, control_id: e.target.value })}
            options={[{ value: '', label: t('items.none') }, ...controls.map(c => ({ value: String(c.id), label: `${c.code ? `${c.code} ` : ''}${c.title}` }))]} />
          <Input label={form.status === 'discarded' ? `${t('items.reasonRequired')} *` : t('items.reason')} value={form.status_reason} onChange={e => setForm({ ...form, status_reason: e.target.value })} />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={save} disabled={busy || !form.title.trim() || (form.status === 'discarded' && !form.status_reason.trim())}>{t('items.save')}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setForm(null)}>{t('items.cancel')}</Button>
          </div>
        </div>
      )}
    </section>
  );
};
