import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Save, Loader2, Gauge, CheckCircle2, AlertTriangle, History, RefreshCcw, Eye, Wand2 } from 'lucide-react';
import api from '../../lib/api';
import { Card, CardHeader, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { IconButton } from '../ui/IconButton';
import { RiskHeatmap } from '../risks/RiskHeatmap';
import { forgetScales, loadActiveScale, loadScaleVersion, levelLabel, loadRiskCategories, categoryLabel } from '../../lib/riskMethodology';
import { RiskCategorySettings } from './RiskCategorySettings';
import { usePermissions } from '../../contexts/PermissionsContext';
import { useAuth } from '../../contexts/AuthContext';
import type { Risk, RiskLevel, RiskScale, RiskScaleStep, RiskMethodologyVersion, RiskLevelDef, RiskAcceptanceRule, RiskCategory, ImpactDimensionDef, ImpactDimensionKey } from '../../types';

const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const ROLES = ['admin', 'assessor', 'owner', 'it-staff', 'dpo', 'management', 'viewer', 'employee'];
// Fixed catalogue of impact dimensions (backend services/riskMethodology.js).
const DIMENSION_KEYS: ImpactDimensionKey[] = ['confidentiality', 'integrity', 'availability', 'financial', 'legal', 'reputation', 'operational'];
const MIN = 3;
const MAX = 6;

interface Draft {
  name: string;
  likelihood_unit: string;
  impact_unit: string;
  likelihood_levels: RiskScaleStep[];
  impact_levels: RiskScaleStep[];
  risk_levels: RiskLevelDef[];
  appetite: { default_max_level: RiskLevel | ''; categories: { category: string; max_level: RiskLevel }[] };
  acceptance: RiskAcceptanceRule[];
  impact_dimensions: ImpactDimensionDef[];
}
interface Issue { field: string; message: string; }
interface ValidateResult { valid: boolean; unchanged: boolean; errors: Issue[]; warnings: Issue[]; preview: RiskScale | null; matrix_changed: boolean; risks_to_reassess: number; }

const toDraft = (s: RiskScale): Draft => ({
  name: s.name,
  likelihood_unit: s.likelihood_unit || '',
  impact_unit: s.impact_unit || '',
  likelihood_levels: s.likelihood_levels.map(l => ({ ...l })),
  impact_levels: s.impact_levels.map(l => ({ ...l })),
  risk_levels: s.risk_levels.map(l => ({ ...l })),
  appetite: { default_max_level: s.appetite?.default_max_level || '', categories: (s.appetite?.categories || []).map(c => ({ ...c })) },
  acceptance: LEVELS.map(level => {
    const r = s.acceptance.find(a => a.level === level);
    return { level, roles: r ? [...r.roles] : ['admin'], max_months: r?.max_months ?? null };
  }),
  impact_dimensions: (s.impact_dimensions || []).map(d => ({ ...d })),
});

// Schwellen gleichmaessig ueber den Score verteilen (Verhaeltnis wie beim
// Standardprofil 4/9/14 von 25). Nur ein Vorschlag - die Pruefung macht der Server.
const suggestThresholds = (levels: RiskLevelDef[], maxScore: number): RiskLevelDef[] => {
  const cuts = [0.16, 0.36, 0.56].map(f => Math.max(1, Math.round(maxScore * f)));
  for (let i = 1; i < cuts.length; i++) if (cuts[i] <= cuts[i - 1]) cuts[i] = cuts[i - 1] + 1;
  const bounds = [[1, cuts[0]], [cuts[0] + 1, cuts[1]], [cuts[1] + 1, cuts[2]], [cuts[2] + 1, maxScore]];
  return levels.map((l, i) => ({ ...l, min_score: bounds[i][0], max_score: bounds[i][1] }));
};

export const RiskMethodologySettings: React.FC = () => {
  const { t } = useTranslation(['admin', 'risks', 'common']);
  const { user } = useAuth();
  const { can } = usePermissions();
  const canManage = can('risks', 'manage_methodology', user?.role === 'admin');
  const [active, setActive] = useState<RiskScale | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<RiskMethodologyVersion[]>([]);
  const [check, setCheck] = useState<ValidateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [viewVersion, setViewVersion] = useState<RiskScale | null>(null);
  const [pending, setPending] = useState<Risk[]>([]);
  const [carrySel, setCarrySel] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const reloadCategories = useCallback(() => loadRiskCategories().then(setCategories).catch(() => setCategories([])), []);
  useEffect(() => { reloadCategories(); }, [reloadCategories]);

  const reload = useCallback(async () => {
    forgetScales();
    const [s, v, r] = await Promise.all([
      loadActiveScale(),
      api.get<RiskMethodologyVersion[]>('/risks/methodology/versions').then(x => x.data).catch(() => []),
      api.get<Risk[]>('/risks/reassessment').then(x => x.data).catch(() => []),
    ]);
    setActive(s);
    setDraft(toDraft(s));
    setVersions(v);
    setPending(r);
    setCarrySel([]);
    setCheck(null);
  }, []);

  useEffect(() => { reload().catch(() => {}).finally(() => setLoading(false)); }, [reload]);

  const payload = useMemo(() => draft && ({
    ...draft,
    likelihood_unit: draft.likelihood_unit || null,
    impact_unit: draft.impact_unit || null,
    appetite: { default_max_level: draft.appetite.default_max_level || null, categories: draft.appetite.categories },
  }), [draft]);

  // Vorschau und Pruefung durch den Server, verzoegert nach jeder Aenderung.
  useEffect(() => {
    if (!payload || !canManage) return;
    const h = setTimeout(() => {
      setChecking(true);
      api.post<ValidateResult>('/risks/methodology/validate', { profile: payload })
        .then(r => setCheck(r.data)).catch(() => setCheck(null)).finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(h);
  }, [payload, canManage]);

  if (loading) return <div className="flex items-center gap-2 text-gray-500 text-sm dark:text-gray-400"><Loader2 size={14} className="animate-spin" />{t('admin:riskMethodology.loading')}</div>;
  if (!draft || !active) return <p className="text-sm text-red-600">{t('admin:riskMethodology.loadError')}</p>;

  const set = (patch: Partial<Draft>) => setDraft(d => (d ? { ...d, ...patch } : d));
  const axisKey = (axis: 'likelihood' | 'impact') => (axis === 'likelihood' ? 'likelihood_levels' : 'impact_levels') as 'likelihood_levels' | 'impact_levels';
  const setStep = (axis: 'likelihood' | 'impact', idx: number, patch: Partial<RiskScaleStep>) => {
    const k = axisKey(axis);
    set({ [k]: draft[k].map((s, i) => (i === idx ? { ...s, ...patch } : s)) } as Partial<Draft>);
  };
  const addStep = (axis: 'likelihood' | 'impact') => {
    const k = axisKey(axis);
    if (draft[k].length >= MAX) return;
    set({ [k]: [...draft[k], { value: draft[k].length + 1, label_de: '', label_en: '', description: null, range_min: null, range_max: null }] } as Partial<Draft>);
  };
  const removeStep = (axis: 'likelihood' | 'impact', idx: number) => {
    const k = axisKey(axis);
    if (draft[k].length <= MIN) return;
    set({ [k]: draft[k].filter((_, i) => i !== idx).map((s, i) => ({ ...s, value: i + 1 })) } as Partial<Draft>);
  };
  const setLevel = (key: RiskLevel, patch: Partial<RiskLevelDef>) => set({ risk_levels: draft.risk_levels.map(l => (l.key === key ? { ...l, ...patch } : l)) });
  const setRule = (level: RiskLevel, patch: Partial<RiskAcceptanceRule>) => set({ acceptance: draft.acceptance.map(a => (a.level === level ? { ...a, ...patch } : a)) });
  const toggleRole = (level: RiskLevel, role: string) => {
    const rule = draft.acceptance.find(a => a.level === level)!;
    setRule(level, { roles: rule.roles.includes(role) ? rule.roles.filter(r => r !== role) : [...rule.roles, role] });
  };
  const maxScore = draft.likelihood_levels.length * draft.impact_levels.length;
  const fieldErrors = (prefix: string) => (check?.errors || []).filter(e => e.field.startsWith(prefix));
  const num = (v: string) => (v === '' ? null : Number(v));
  // Empty labels: the server fills in the catalogue labels (de/en) on validation.
  const dimDefault = (_key: ImpactDimensionKey) => ({ label_de: '', label_en: '' });
  const toggleDimension = (key: ImpactDimensionKey) => {
    const on = draft.impact_dimensions.some(d => d.key === key);
    const next = on
      ? draft.impact_dimensions.filter(d => d.key !== key)
      : [...draft.impact_dimensions, { key, ...dimDefault(key), description: null }];
    set({ impact_dimensions: DIMENSION_KEYS.map(k => next.find(d => d.key === k)).filter((d): d is ImpactDimensionDef => !!d) });
  };
  const setDimension = (key: ImpactDimensionKey, patch: Partial<ImpactDimensionDef>) => set({ impact_dimensions: draft.impact_dimensions.map(d => (d.key === key ? { ...d, ...patch } : d)) });

  const save = async () => {
    if (!payload) return;
    const confirmText = t('admin:riskMethodology.confirmSave', { count: check?.risks_to_reassess ?? 0 });
    if (!window.confirm(confirmText)) return;
    setSaving(true); setMsg(null);
    try {
      const r = await api.put('/risks/methodology', { profile: payload, change_note: note || null });
      setMsg({ ok: true, text: t('admin:riskMethodology.saved', { version: r.data.version, count: r.data.risks_to_reassess }) });
      setNote('');
      await reload();
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('admin:riskMethodology.saveError') });
    } finally { setSaving(false); }
  };

  const carryOver = async () => {
    if (!carrySel.length || !window.confirm(t('admin:riskMethodology.confirmCarry', { count: carrySel.length, version: active.version }))) return;
    try {
      const r = await api.post('/risks/methodology/carry-over', { risk_ids: carrySel, confirm: true });
      setMsg({ ok: true, text: t('admin:riskMethodology.carried', { count: r.data.carried.length, skipped: r.data.skipped.length }) });
      await reload();
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('admin:riskMethodology.saveError') });
    }
  };

  const showVersion = async (id: number) => {
    try { setViewVersion(await loadScaleVersion(id)); } catch { setViewVersion(null); }
  };

  // Render-Funktion statt Komponente: eine in der Render-Phase definierte
  // Komponente waere bei jedem Tastendruck neu und verloere den Fokus.
  const renderAxis = (axis: 'likelihood' | 'impact') => {
    const k = axisKey(axis);
    const steps = draft[k];
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h4 className="text-sm font-semibold dark:text-white">{t(`admin:riskMethodology.${axis}`)} ({steps.length})</h4>
          <div className="flex items-end gap-2">
            <div className="w-40"><Input label={t('admin:riskMethodology.unit')} value={axis === 'likelihood' ? draft.likelihood_unit : draft.impact_unit} disabled={!canManage}
              onChange={e => set(axis === 'likelihood' ? { likelihood_unit: e.target.value } : { impact_unit: e.target.value })} placeholder={t(`admin:riskMethodology.unitPlaceholder_${axis}`)} /></div>
            {canManage && <Button type="button" size="sm" variant="secondary" onClick={() => addStep(axis)} disabled={steps.length >= MAX}><Plus size={13} />{t('admin:riskMethodology.addStep')}</Button>}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-500 dark:text-slate-400">
              <th className="py-1 pr-2 w-8">#</th><th className="py-1 pr-2">{t('admin:riskMethodology.labelDe')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.labelEn')}</th>
              <th className="py-1 pr-2">{t('admin:riskMethodology.criterion')}</th><th className="py-1 pr-2 w-24">{t('admin:riskMethodology.rangeFrom')}</th><th className="py-1 pr-2 w-24">{t('admin:riskMethodology.rangeTo')}</th><th className="w-8" />
            </tr></thead>
            <tbody>
              {steps.map((s, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2 font-mono text-gray-500">{i + 1}</td>
                  <td className="py-1 pr-2"><Input aria-label={`${t('admin:riskMethodology.labelDe')} ${i + 1}`} value={s.label_de} disabled={!canManage} onChange={e => setStep(axis, i, { label_de: e.target.value })} /></td>
                  <td className="py-1 pr-2"><Input aria-label={`${t('admin:riskMethodology.labelEn')} ${i + 1}`} value={s.label_en} disabled={!canManage} onChange={e => setStep(axis, i, { label_en: e.target.value })} /></td>
                  <td className="py-1 pr-2"><Input aria-label={`${t('admin:riskMethodology.criterion')} ${i + 1}`} value={s.description || ''} disabled={!canManage} onChange={e => setStep(axis, i, { description: e.target.value || null })} placeholder={t(`admin:riskMethodology.criterionPlaceholder_${axis}`)} /></td>
                  <td className="py-1 pr-2"><Input type="number" aria-label={`${t('admin:riskMethodology.rangeFrom')} ${i + 1}`} value={s.range_min ?? ''} disabled={!canManage} onChange={e => setStep(axis, i, { range_min: num(e.target.value) })} /></td>
                  <td className="py-1 pr-2"><Input type="number" aria-label={`${t('admin:riskMethodology.rangeTo')} ${i + 1}`} value={s.range_max ?? ''} disabled={!canManage} onChange={e => setStep(axis, i, { range_max: num(e.target.value) })} /></td>
                  <td className="py-1">{canManage && steps.length > MIN && <IconButton label={t('common:actions.delete')} variant="danger" onClick={() => removeStep(axis, i)}><Trash2 size={13} /></IconButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {fieldErrors(k).map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e.message}</p>)}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-blue-500" />
            <div>
              <h3 className="font-semibold dark:text-white">{t('admin:riskMethodology.title')}</h3>
              <p className="text-xs text-gray-500 dark:text-slate-400">{t('admin:riskMethodology.subtitle', { version: active.version, name: active.name })}</p>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-6">
          {!canManage && <p className="text-xs text-amber-700 dark:text-amber-400">{t('admin:riskMethodology.readOnly')}</p>}
          <Input label={t('admin:riskMethodology.name')} value={draft.name} disabled={!canManage} onChange={e => set({ name: e.target.value })} />

          {renderAxis('likelihood')}
          {renderAxis('impact')}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold dark:text-white">{t('admin:riskMethodology.levels', { max: maxScore })}</h4>
              {canManage && <Button type="button" size="sm" variant="secondary" onClick={() => set({ risk_levels: suggestThresholds(draft.risk_levels, maxScore) })}><Wand2 size={13} />{t('admin:riskMethodology.suggest')}</Button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 dark:text-slate-400">
                  <th className="py-1 pr-2">{t('admin:riskMethodology.levelKey')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.labelDe')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.labelEn')}</th>
                  <th className="py-1 pr-2 w-16">{t('admin:riskMethodology.color')}</th><th className="py-1 pr-2 w-24">{t('admin:riskMethodology.scoreFrom')}</th><th className="py-1 pr-2 w-24">{t('admin:riskMethodology.scoreTo')}</th>
                </tr></thead>
                <tbody>
                  {draft.risk_levels.map(l => (
                    <tr key={l.key}>
                      <td className="py-1 pr-2 font-mono">{l.key}</td>
                      <td className="py-1 pr-2"><Input aria-label={`${l.key} ${t('admin:riskMethodology.labelDe')}`} value={l.label_de} disabled={!canManage} onChange={e => setLevel(l.key, { label_de: e.target.value })} /></td>
                      <td className="py-1 pr-2"><Input aria-label={`${l.key} ${t('admin:riskMethodology.labelEn')}`} value={l.label_en} disabled={!canManage} onChange={e => setLevel(l.key, { label_en: e.target.value })} /></td>
                      <td className="py-1 pr-2"><input type="color" aria-label={`${l.key} ${t('admin:riskMethodology.color')}`} value={l.color} disabled={!canManage} onChange={e => setLevel(l.key, { color: e.target.value })} className="h-9 w-12 rounded border dark:border-slate-700 bg-transparent" /></td>
                      <td className="py-1 pr-2"><Input type="number" aria-label={`${l.key} ${t('admin:riskMethodology.scoreFrom')}`} value={l.min_score} disabled={!canManage} onChange={e => setLevel(l.key, { min_score: Number(e.target.value) })} /></td>
                      <td className="py-1 pr-2"><Input type="number" aria-label={`${l.key} ${t('admin:riskMethodology.scoreTo')}`} value={l.max_score} disabled={!canManage} onChange={e => setLevel(l.key, { max_score: Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fieldErrors('risk_levels').map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e.message}</p>)}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold dark:text-white">{t('admin:riskMethodology.dimensions')}</h4>
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('admin:riskMethodology.dimensionsHint')}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {DIMENSION_KEYS.map(key => (
                <label key={key} className="inline-flex items-center gap-1 text-xs dark:text-slate-300">
                  <input type="checkbox" className="w-3.5 h-3.5 rounded text-blue-600" disabled={!canManage} checked={draft.impact_dimensions.some(d => d.key === key)} onChange={() => toggleDimension(key)} />
                  {t(`risks:dimensions.${key}`)}
                </label>
              ))}
            </div>
            {draft.impact_dimensions.map(d => (
              <div key={d.key} className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input aria-label={`${d.key} de`} value={d.label_de} disabled={!canManage} onChange={e => setDimension(d.key, { label_de: e.target.value })} placeholder={`${t('admin:riskMethodology.labelDe')} · ${t(`risks:dimensions.${d.key}`)}`} />
                <Input aria-label={`${d.key} en`} value={d.label_en} disabled={!canManage} onChange={e => setDimension(d.key, { label_en: e.target.value })} placeholder={`${t('admin:riskMethodology.labelEn')} · ${t(`risks:dimensions.${d.key}`)}`} />
                <Input aria-label={`${d.key} criterion`} value={d.description || ''} disabled={!canManage} onChange={e => setDimension(d.key, { description: e.target.value || null })} placeholder={t('admin:riskMethodology.criterion')} />
              </div>
            ))}
            {fieldErrors('impact_dimensions').map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e.message}</p>)}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold dark:text-white">{t('admin:riskMethodology.appetite')}</h4>
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('admin:riskMethodology.appetiteHint')}</p>
            <div className="w-64">
              <Select label={t('admin:riskMethodology.appetiteDefault')} value={draft.appetite.default_max_level} disabled={!canManage}
                onChange={e => set({ appetite: { ...draft.appetite, default_max_level: e.target.value as RiskLevel | '' } })}
                options={[{ value: '', label: t('admin:riskMethodology.noLimit') }, ...LEVELS.map(k => ({ value: k, label: levelLabel(active, k) }))]} />
            </div>
            {draft.appetite.categories.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1"><Select label={i === 0 ? t('admin:riskMethodology.category') : undefined} aria-label={t('admin:riskMethodology.category')} value={c.category} disabled={!canManage}
                  onChange={e => set({ appetite: { ...draft.appetite, categories: draft.appetite.categories.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)) } })}
                  options={[{ value: '', label: t('risks:form.select') }, ...categories.map(cat => ({ value: cat.key, label: cat.active ? categoryLabel(cat) : `${categoryLabel(cat)} (${t('risks:categoriesAdmin.inactive')})` })),
                    ...(c.category && !categories.some(cat => cat.key === c.category) ? [{ value: c.category, label: c.category }] : [])]} /></div>
                <div className="w-48"><Select label={i === 0 ? t('admin:riskMethodology.maxLevel') : undefined} aria-label={t('admin:riskMethodology.maxLevel')} value={c.max_level} disabled={!canManage}
                  onChange={e => set({ appetite: { ...draft.appetite, categories: draft.appetite.categories.map((x, j) => (j === i ? { ...x, max_level: e.target.value as RiskLevel } : x)) } })}
                  options={LEVELS.map(k => ({ value: k, label: levelLabel(active, k) }))} /></div>
                {canManage && <IconButton label={t('common:actions.delete')} variant="danger" onClick={() => set({ appetite: { ...draft.appetite, categories: draft.appetite.categories.filter((_, j) => j !== i) } })}><Trash2 size={13} /></IconButton>}
              </div>
            ))}
            {canManage && <Button type="button" size="sm" variant="secondary" onClick={() => set({ appetite: { ...draft.appetite, categories: [...draft.appetite.categories, { category: '', max_level: 'medium' }] } })}><Plus size={13} />{t('admin:riskMethodology.addCategory')}</Button>}
            {fieldErrors('appetite').map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e.message}</p>)}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold dark:text-white">{t('admin:riskMethodology.acceptance')}</h4>
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('admin:riskMethodology.acceptanceHint')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-1 pr-2">{t('admin:riskMethodology.levelKey')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.roles')}</th><th className="py-1 pr-2 w-32">{t('admin:riskMethodology.maxMonths')}</th></tr></thead>
                <tbody>
                  {draft.acceptance.map(a => (
                    <tr key={a.level} className="align-top">
                      <td className="py-2 pr-2 font-medium dark:text-slate-200">{levelLabel(active, a.level)}</td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {ROLES.map(role => (
                            <label key={role} className="inline-flex items-center gap-1 dark:text-slate-300">
                              <input type="checkbox" checked={a.roles.includes(role)} disabled={!canManage} onChange={() => toggleRole(a.level, role)} className="w-3.5 h-3.5 rounded text-blue-600" />
                              {t(`common:roles.${role}`, { defaultValue: role })}
                            </label>
                          ))}
                        </div>
                      </td>
                      <td className="py-1 pr-2"><Input type="number" min={1} max={120} aria-label={`${a.level} ${t('admin:riskMethodology.maxMonths')}`} value={a.max_months ?? ''} disabled={!canManage} placeholder={t('admin:riskMethodology.unlimited')} onChange={e => setRule(a.level, { max_months: e.target.value === '' ? null : Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fieldErrors('acceptance').map((e, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{e.message}</p>)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold dark:text-white flex items-center gap-2"><Eye size={14} />{t('admin:riskMethodology.preview')} {checking && <Loader2 size={12} className="animate-spin" />}</h4>
              {check?.preview ? <RiskHeatmap scale={check.preview} /> : <p className="text-xs text-gray-500 dark:text-slate-400 italic">{t('admin:riskMethodology.noPreview')}</p>}
            </div>
            <div className="space-y-2 text-xs">
              {check && check.errors.length === 0 && !check.unchanged && <p className="flex items-center gap-1 text-green-700 dark:text-green-400"><CheckCircle2 size={13} />{t('admin:riskMethodology.valid')}</p>}
              {check?.unchanged && <p className="text-gray-500 dark:text-slate-400">{t('admin:riskMethodology.unchanged')}</p>}
              {check && check.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold text-red-700 dark:text-red-400">{t('admin:riskMethodology.errors', { count: check.errors.length })}</p>
                  <ul className="list-disc pl-4 text-red-700 dark:text-red-400">{check.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
                </div>
              )}
              {check?.warnings?.map((w, i) => <p key={i} className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle size={12} />{w.message}</p>)}
              {check?.valid && (
                <p className="text-amber-800 dark:text-amber-300">
                  {t(check.matrix_changed ? 'admin:riskMethodology.impactMatrix' : 'admin:riskMethodology.impactCriteria', { count: check.risks_to_reassess })}
                </p>
              )}
              {canManage && (
                <div className="space-y-2 pt-2">
                  <Input label={t('admin:riskMethodology.changeNote')} value={note} onChange={e => setNote(e.target.value)} placeholder={t('admin:riskMethodology.changeNotePlaceholder')} />
                  <Button type="button" onClick={save} disabled={saving || !check?.valid}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{t('admin:riskMethodology.save')}</Button>
                </div>
              )}
              {msg && <p className={msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>{msg.text}</p>}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center gap-2"><RefreshCcw size={16} className="text-amber-500" /><h3 className="font-semibold dark:text-white">{t('admin:riskMethodology.reassessTitle', { count: pending.length })}</h3></div></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('admin:riskMethodology.reassessHint')}</p>
          {pending.length === 0 ? <p className="text-xs text-gray-500 dark:text-slate-400 italic">{t('admin:riskMethodology.reassessEmpty')}</p> : (
            <>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="w-6" /><th className="py-1 pr-2">{t('risks:table.ref')}</th><th className="py-1 pr-2">{t('risks:table.risk')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.version')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.values')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.carryPossible')}</th></tr></thead>
                  <tbody>
                    {pending.map(r => (
                      <tr key={r.id} className="border-t dark:border-slate-800">
                        <td className="py-1">{canManage && !r.matrix_changed && <input type="checkbox" aria-label={r.ref || r.title} checked={carrySel.includes(r.id)} onChange={() => setCarrySel(s => (s.includes(r.id) ? s.filter(x => x !== r.id) : [...s, r.id]))} className="w-3.5 h-3.5 rounded text-blue-600" />}</td>
                        <td className="py-1 pr-2 font-mono">{r.ref}</td>
                        <td className="py-1 pr-2 dark:text-slate-200">{r.title}</td>
                        <td className="py-1 pr-2">v{r.methodology_version}</td>
                        <td className="py-1 pr-2">{r.likelihood} × {r.impact}</td>
                        <td className="py-1 pr-2">{r.matrix_changed ? t('admin:riskMethodology.carryNo') : t('admin:riskMethodology.carryYes')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setCarrySel(pending.filter(r => !r.matrix_changed).map(r => r.id))}>{t('admin:riskMethodology.selectCarryable')}</Button>
                  <Button type="button" size="sm" onClick={carryOver} disabled={!carrySel.length}>{t('admin:riskMethodology.carry', { count: carrySel.length, version: active.version })}</Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center gap-2"><History size={16} className="text-gray-500" /><h3 className="font-semibold dark:text-white">{t('admin:riskMethodology.versions')}</h3></div></CardHeader>
        <CardBody className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-1 pr-2">{t('admin:riskMethodology.version')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.name')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.matrix')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.status')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.riskCount')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.createdBy')}</th><th className="py-1 pr-2">{t('admin:riskMethodology.changeNote')}</th><th className="w-8" /></tr></thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.id} className="border-t dark:border-slate-800">
                    <td className="py-1 pr-2 font-mono">v{v.version}</td>
                    <td className="py-1 pr-2 dark:text-slate-200">{v.name}</td>
                    <td className="py-1 pr-2">{v.likelihood_size}×{v.impact_size}</td>
                    <td className="py-1 pr-2">{t(`admin:riskMethodology.status_${v.status}`)}</td>
                    <td className="py-1 pr-2">{v.risk_count}</td>
                    <td className="py-1 pr-2">{v.created_by?.name || t('admin:riskMethodology.system')} · {new Date(v.activated_at || v.created_at).toLocaleDateString()}</td>
                    <td className="py-1 pr-2 text-gray-500 dark:text-slate-400">{v.change_note || '–'}</td>
                    <td className="py-1"><IconButton label={t('admin:riskMethodology.show')} onClick={() => showVersion(v.id)}><Eye size={13} /></IconButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {viewVersion && (
            <div className="p-3 rounded-lg border dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between"><p className="text-xs font-semibold dark:text-white">v{viewVersion.version} · {viewVersion.name}</p><button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setViewVersion(null)}>{t('common:actions.close', { defaultValue: 'OK' })}</button></div>
              <div className="max-w-sm"><RiskHeatmap scale={viewVersion} compact /></div>
            </div>
          )}
        </CardBody>
      </Card>

      <RiskCategorySettings categories={categories} canManage={canManage} onChanged={reloadCategories} />
    </div>
  );
};
