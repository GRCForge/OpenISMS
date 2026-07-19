import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Loader2, FileCheck2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import { Card, CardHeader, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface Requirement { ref: string; requirement: string; mandatory: boolean; }
interface Profile { label: string; requirements: Requirement[]; reference: string; }
type Profiles = Record<string, Profile>;

// Admin editor for the contract-analysis profiles: per document type, the criteria
// catalog that drives the coverage matrix plus a free-text reference/baseline.
export const TriageProfilesSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const [profiles, setProfiles] = useState<Profiles>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    api.get('/triage-profiles')
      .then(r => { setProfiles(r.data || {}); setOpenKey(Object.keys(r.data || {})[0] || null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = (key: string, patch: Partial<Profile>) =>
    setProfiles(p => ({ ...p, [key]: { ...p[key], ...patch } }));

  const updateReq = (key: string, idx: number, patch: Partial<Requirement>) =>
    update(key, { requirements: profiles[key].requirements.map((r, i) => i === idx ? { ...r, ...patch } : r) });

  const addReq = (key: string) =>
    update(key, { requirements: [...profiles[key].requirements, { ref: '', requirement: '', mandatory: false }] });

  const removeReq = (key: string, idx: number) =>
    update(key, { requirements: profiles[key].requirements.filter((_, i) => i !== idx) });

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await api.put('/triage-profiles', profiles);
      setProfiles(r.data);
      setMsg({ ok: true, text: t('triageProfiles.saved') });
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('triageProfiles.saveError') });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={14} className="animate-spin" />{t('triageProfiles.loading')}</div>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileCheck2 size={16} className="text-blue-500" />
          <h2 className="font-semibold dark:text-white">{t('triageProfiles.title')}</h2>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('triageProfiles.description')}</p>

        {msg && (
          <div className={`p-2.5 rounded-lg text-xs font-medium ${msg.ok ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'}`}>{msg.text}</div>
        )}

        <div className="space-y-2">
          {Object.entries(profiles).map(([key, p]) => {
            const isOpen = openKey === key;
            return (
              <div key={key} className="rounded-xl border dark:border-slate-800 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenKey(isOpen ? null : key)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/40 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span className="text-sm font-semibold dark:text-slate-200">{p.label}</span>
                  <span className="text-xs text-gray-400">{t('triageProfiles.criteriaCount', { count: p.requirements.length })}</span>
                </button>

                {isOpen && (
                  <div className="p-4 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">{t('triageProfiles.criteria')}</label>
                      {p.requirements.length === 0 && <p className="text-xs text-gray-400 italic">{t('triageProfiles.noCriteria')}</p>}
                      {p.requirements.map((r, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="w-40 shrink-0">
                            <Input value={r.ref} onChange={e => updateReq(key, idx, { ref: e.target.value })} placeholder={t('triageProfiles.refPlaceholder')} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <Input value={r.requirement} onChange={e => updateReq(key, idx, { requirement: e.target.value })} placeholder={t('triageProfiles.requirementPlaceholder')} />
                          </div>
                          <label className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-slate-400 whitespace-nowrap" title={t('triageProfiles.mandatoryHint')}>
                            <input type="checkbox" checked={r.mandatory} onChange={e => updateReq(key, idx, { mandatory: e.target.checked })} className="w-3.5 h-3.5 rounded accent-blue-600" />
                            {t('triageProfiles.mandatory')}
                          </label>
                          <button type="button" onClick={() => removeReq(key, idx)} className="p-1.5 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      ))}
                      <Button type="button" variant="secondary" size="sm" onClick={() => addReq(key)}><Plus size={13} className="mr-1" />{t('triageProfiles.addCriterion')}</Button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">{t('triageProfiles.reference')}</label>
                      <p className="text-[11px] text-gray-400">{t('triageProfiles.referenceHint')}</p>
                      <textarea
                        value={p.reference}
                        onChange={e => update(key, { reference: e.target.value })}
                        rows={5}
                        placeholder={t('triageProfiles.referencePlaceholder')}
                        className="w-full text-sm bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2.5 dark:text-white font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-2 border-t dark:border-slate-800">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin mr-1" />{t('triageProfiles.saving')}</> : <><Save size={14} className="mr-1" />{t('triageProfiles.save')}</>}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};
