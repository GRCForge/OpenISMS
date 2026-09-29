import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../lib/api';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { useToast } from '../../contexts/ToastContext';

/**
 * Das Bewertungsmodell sichtbar und einstellbar machen.
 *
 * Es gibt keinen allgemein anerkannten Rechenweg dafuer, was "teilweise
 * umgesetzt" wert ist. Eine Quote, deren Herleitung man nicht sieht, ist in
 * einer Managementbewertung wenig wert — deshalb steht sie hier, mit dem
 * gerechneten Beispiel daneben.
 */

interface Thresholds { l5: number; l4: number; l3: number; l2: number }
interface StatusThresholds { good: number; improvable: number }

export interface ScoringModel {
  implementation_weight: number;
  partly_value: number;
  zero_on_not_implemented: boolean;
  maturity_thresholds: Thresholds;
  status_thresholds: StatusThresholds;
}

const errorText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const pct = (v: number) => Math.round(v * 100);

/** Dieselbe Rechnung wie im Backend — nur zum Anzeigen der Beispielwerte. */
const score = (impl: 'yes' | 'partly' | 'no', evid: 'yes' | 'partly' | 'no', m: ScoringModel) => {
  if (impl === 'no' && m.zero_on_not_implemented) return 0;
  const v = (a: string) => (a === 'yes' ? 1 : a === 'partly' ? m.partly_value : 0);
  return v(impl) * m.implementation_weight + v(evid) * (1 - m.implementation_weight);
};

interface Props { canEdit: boolean; onChanged?: () => void }

export const ScoringModelEditor: React.FC<Props> = ({ canEdit, onChanged }) => {
  const { t } = useTranslation('nis2');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<ScoringModel | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/nis2/scoring');
      setModel(r.data);
    } catch { /* Das Modell ist Beiwerk — ohne es rechnet der Server mit der Voreinstellung. */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!model) return;
    setSaving(true);
    try {
      const r = await api.put('/nis2/scoring', model);
      setModel(r.data);
      toast.success(t('scoring.saved'));
      onChanged?.();
    } catch (e) { toast.error(errorText(e, t('scoring.error'))); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const r = await api.delete('/nis2/scoring');
      setModel(r.data);
      toast.success(t('scoring.reset'));
      onChanged?.();
    } catch (e) { toast.error(errorText(e, t('scoring.error'))); }
    finally { setSaving(false); }
  };

  if (!model) return null;

  const set = <K extends keyof ScoringModel>(key: K, value: ScoringModel[K]) =>
    setModel(m => (m ? { ...m, [key]: value } : m));
  const setThreshold = (key: keyof Thresholds, value: number) =>
    setModel(m => (m ? { ...m, maturity_thresholds: { ...m.maturity_thresholds, [key]: value } } : m));

  const examples: [string, 'yes' | 'partly' | 'no', 'yes' | 'partly' | 'no'][] = [
    [t('scoring.example.yesYes'), 'yes', 'yes'],
    [t('scoring.example.yesPartly'), 'yes', 'partly'],
    [t('scoring.example.yesNo'), 'yes', 'no'],
    [t('scoring.example.partlyPartly'), 'partly', 'partly'],
    [t('scoring.example.noYes'), 'no', 'yes'],
  ];

  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-gray-50/60 dark:hover:bg-slate-800/30 transition-colors">
        {open ? <ChevronDown size={15} className="text-gray-500 dark:text-gray-400 shrink-0" aria-hidden="true" />
          : <ChevronRight size={15} className="text-gray-500 dark:text-gray-400 shrink-0" aria-hidden="true" />}
        <SlidersHorizontal size={15} className="text-blue-600 dark:text-blue-400 shrink-0" aria-hidden="true" />
        <span className="text-sm font-semibold dark:text-white">{t('scoring.title')}</span>
        <span className="text-xs text-gray-600 dark:text-slate-400 ml-auto">
          {t('scoring.summary', {
            impl: pct(model.implementation_weight),
            evid: 100 - pct(model.implementation_weight),
            partly: pct(model.partly_value),
          })}
        </span>
      </button>

      {open && (
        <CardBody className="border-t dark:border-slate-800 space-y-4">
          <p className="text-xs text-gray-700 dark:text-slate-400">{t('scoring.intro')}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sc-weight" className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">
                {t('scoring.weight', { impl: pct(model.implementation_weight), evid: 100 - pct(model.implementation_weight) })}
              </label>
              <input id="sc-weight" type="range" min={0} max={100} step={1} disabled={!canEdit}
                value={pct(model.implementation_weight)}
                onChange={e => set('implementation_weight', Number(e.target.value) / 100)}
                className="w-full accent-blue-600 disabled:opacity-60" />
              <p className="text-[11px] text-gray-600 dark:text-slate-400">{t('scoring.weightHint')}</p>
            </div>
            <div>
              <label htmlFor="sc-partly" className="block text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">
                {t('scoring.partly', { value: pct(model.partly_value) })}
              </label>
              <input id="sc-partly" type="range" min={0} max={100} step={1} disabled={!canEdit}
                value={pct(model.partly_value)}
                onChange={e => set('partly_value', Number(e.target.value) / 100)}
                className="w-full accent-blue-600 disabled:opacity-60" />
              <p className="text-[11px] text-gray-600 dark:text-slate-400">{t('scoring.partlyHint')}</p>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-300">
            <input type="checkbox" disabled={!canEdit} checked={model.zero_on_not_implemented}
              onChange={e => set('zero_on_not_implemented', e.target.checked)}
              className="mt-0.5 rounded border-gray-400 dark:border-slate-600" />
            <span>{t('scoring.gate')}<br />
              <span className="text-xs text-gray-600 dark:text-slate-400">{t('scoring.gateHint')}</span>
            </span>
          </label>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">{t('scoring.maturity')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['l5', 'l4', 'l3', 'l2'] as const).map(key => (
                <div key={key}>
                  <label htmlFor={`sc-${key}`} className="block text-[11px] text-gray-600 dark:text-slate-400 mb-0.5">
                    {t(`scoring.level.${key}`)}
                  </label>
                  <div className="flex items-center gap-1">
                    <input id={`sc-${key}`} type="number" min={0} max={100} step={1} disabled={!canEdit}
                      value={pct(model.maturity_thresholds[key])}
                      onChange={e => setThreshold(key, Number(e.target.value) / 100)}
                      className="w-full bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-lg px-2 py-1 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden disabled:opacity-60" />
                    <span className="text-xs text-gray-600 dark:text-slate-400">%</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 dark:text-slate-400 mt-1">{t('scoring.maturityHint')}</p>
          </div>

          {/* Das Beispiel rechnet mit, waehrend geschoben wird. Ohne das bleibt
              jede Einstellung eine Vermutung. */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-400 mb-1">{t('scoring.preview')}</p>
            <div className="flex flex-wrap gap-2">
              {examples.map(([label, impl, evid]) => (
                <span key={label} className="text-xs px-2 py-1 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200">
                  {label} → <span className="font-semibold">{pct(score(impl, evid, model))}%</span>
                </span>
              ))}
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={reset} disabled={saving}>
                <RotateCcw size={14} />{t('scoring.resetButton')}
              </Button>
              <Button onClick={save} disabled={saving}>{t('modal.save')}</Button>
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
};
