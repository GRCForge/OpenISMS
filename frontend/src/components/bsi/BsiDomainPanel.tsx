import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Network, Boxes, Lightbulb, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import { Card, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { SearchableSelect } from '../ui/SearchableSelect';
import { Modal } from '../ui/Modal';
import { IconButton } from '../ui/IconButton';
import { Table, Thead, Tbody, Th, Td } from '../ui/Table';
import { useToast } from '../../contexts/ToastContext';

// Informationsverbund, Zielobjekte und Modellierung (BSI-Standard 200-2).
// Backend: /api/bsi-grundschutz/domains (routes/bsi-domains.js).

export type ProtectionApproach = 'basis' | 'standard' | 'kern';
export type TargetType = 'business_process' | 'application' | 'it_system' | 'ics' | 'room' | 'building' | 'network';

export interface BsiDomain {
  id: number;
  name: string;
  description: string | null;
  scope: string | null;
  protection_approach: ProtectionApproach;
  catalog_id: number | null;
  is_default: boolean;
  catalog?: { id: number; name: string; edition: string | null; format: string; status: string } | null;
  target_object_count?: number;
  modeling_count?: number;
}

interface BriefAsset { id: number; name: string; type: string; status: string; classification: string }

export interface BsiTargetObject {
  id: number;
  domain_id: number;
  asset_id: number;
  target_type: TargetType;
  notes: string | null;
  asset: BriefAsset;
  suggested_target_type: TargetType | null;
  modeling_count: number;
}

interface Modeling {
  id: number;
  target_object_id: number | null;
  module_id: string;
  notes: string | null;
  module: { title: string; layer: string; kind: string } | null;
  in_active_catalog: boolean;
}

interface Suggestion { module_id: string; title: string; layer: string; kind: string; reason: string }

interface Meta {
  target_types: TargetType[];
  protection_approaches: ProtectionApproach[];
  asset_type_suggestions: Record<string, TargetType>;
}

interface AssetOption { id: number; name: string; type: string }

interface Props {
  canManage: boolean;
  domainId: number | null;
  onDomainChange: (id: number | null) => void;
}

const emptyDomainForm = { name: '', description: '', scope: '', protection_approach: 'standard' as ProtectionApproach };

const apiError = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

export const BsiDomainPanel: React.FC<Props> = ({ canManage, domainId, onDomainChange }) => {
  const { t } = useTranslation('bsigrundschutz');
  const toast = useToast();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [domains, setDomains] = useState<BsiDomain[]>([]);
  const [targets, setTargets] = useState<BsiTargetObject[]>([]);
  const [modeling, setModeling] = useState<Modeling[]>([]);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [domainModal, setDomainModal] = useState<'create' | 'edit' | null>(null);
  const [domainForm, setDomainForm] = useState({ ...emptyDomainForm });
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ asset_id: '', target_type: '' });
  // null = ganzer Verbund, sonst Zielobjekt-ID; undefined = kein Dialog offen
  const [suggestFor, setSuggestFor] = useState<number | null | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);

  const domain = domains.find(d => d.id === domainId) || null;

  const loadDomains = useCallback(async () => {
    const r = await api.get('/bsi-grundschutz/domains');
    setDomains(r.data);
    if (r.data.length && (domainId == null || !r.data.some((d: BsiDomain) => d.id === domainId))) onDomainChange(r.data[0].id);
  }, [domainId, onDomainChange]);

  const loadDetail = useCallback(async (id: number) => {
    const [to, mo] = await Promise.all([
      api.get(`/bsi-grundschutz/domains/${id}/target-objects`),
      api.get(`/bsi-grundschutz/domains/${id}/modeling`),
    ]);
    setTargets(to.data);
    setModeling(mo.data);
  }, []);

  useEffect(() => {
    api.get('/bsi-grundschutz/domains/meta').then(r => setMeta(r.data)).catch(() => {});
    loadDomains().catch(() => setDomains([]));
    // Assetliste nur fuer das Zuordnen; die Sichtbarkeit regelt /api/assets selbst.
    api.get('/assets').then(r => setAssets(r.data.map((a: AssetOption) => ({ id: a.id, name: a.name, type: a.type })))).catch(() => setAssets([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (domainId) loadDetail(domainId).catch(() => { setTargets([]); setModeling([]); });
  }, [domainId, loadDetail]);

  const targetTypeLabel = (tt: TargetType | null | undefined) => (tt ? t(`domain.targetType.${tt}`) : '–');
  const approachLabel = (a: ProtectionApproach) => t(`domain.approach.${a}`);

  const openDomainModal = (mode: 'create' | 'edit') => {
    setDomainForm(mode === 'edit' && domain
      ? { name: domain.name, description: domain.description || '', scope: domain.scope || '', protection_approach: domain.protection_approach }
      : { ...emptyDomainForm });
    setDomainModal(mode);
  };

  const saveDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (domainModal === 'edit' && domain) {
        await api.put(`/bsi-grundschutz/domains/${domain.id}`, domainForm);
        await loadDomains();
      } else {
        const r = await api.post('/bsi-grundschutz/domains', domainForm);
        await loadDomains();
        onDomainChange(r.data.id);
      }
      setDomainModal(null);
    } catch (err) {
      toast.error(apiError(err, t('toast.saveError')));
    } finally { setBusy(false); }
  };

  const assignedAssetIds = useMemo(() => new Set(targets.map(x => x.asset_id)), [targets]);
  const selectedAsset = assets.find(a => String(a.id) === addForm.asset_id);
  const suggestedType = selectedAsset && meta ? meta.asset_type_suggestions[selectedAsset.type] : undefined;

  const addTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain || !addForm.asset_id) return;
    setBusy(true);
    try {
      await api.post(`/bsi-grundschutz/domains/${domain.id}/target-objects`, {
        asset_id: Number(addForm.asset_id),
        target_type: addForm.target_type || suggestedType || undefined,
      });
      setAddOpen(false);
      setAddForm({ asset_id: '', target_type: '' });
      await Promise.all([loadDetail(domain.id), loadDomains()]);
    } catch (err) {
      toast.error(apiError(err, t('toast.saveError')));
    } finally { setBusy(false); }
  };

  const changeType = async (to: BsiTargetObject, target_type: string) => {
    if (!domain) return;
    try {
      await api.put(`/bsi-grundschutz/domains/${domain.id}/target-objects/${to.id}`, { target_type });
      await loadDetail(domain.id);
    } catch (err) { toast.error(apiError(err, t('toast.saveError'))); }
  };

  const removeTarget = async (to: BsiTargetObject) => {
    if (!domain || !window.confirm(t('domain.confirmRemoveTarget', { name: to.asset.name }))) return;
    try {
      await api.delete(`/bsi-grundschutz/domains/${domain.id}/target-objects/${to.id}`);
      await Promise.all([loadDetail(domain.id), loadDomains()]);
    } catch (err) { toast.error(apiError(err, t('toast.saveError'))); }
  };

  const openSuggestions = async (targetId: number | null) => {
    if (!domain) return;
    setSuggestFor(targetId);
    setSuggestions([]);
    try {
      const r = await api.get(`/bsi-grundschutz/domains/${domain.id}/modeling/suggestions`, { params: targetId ? { target_object_id: targetId } : {} });
      setSuggestions(r.data.suggestions);
    } catch (err) { toast.error(apiError(err, t('toast.loadError'))); }
  };

  // Uebernahme per Klick: ein Vorschlag wird erst mit diesem Aufruf zur Modellierung.
  const applySuggestion = async (s: Suggestion) => {
    if (!domain || suggestFor === undefined) return;
    try {
      await api.post(`/bsi-grundschutz/domains/${domain.id}/modeling`, { module_id: s.module_id, target_object_id: suggestFor });
      setSuggestions(list => list.filter(x => x.module_id !== s.module_id));
      await Promise.all([loadDetail(domain.id), loadDomains()]);
    } catch (err) { toast.error(apiError(err, t('toast.saveError'))); }
  };

  const removeModeling = async (mo: Modeling) => {
    if (!domain || !window.confirm(t('domain.confirmRemoveModeling', { module: mo.module_id }))) return;
    try {
      await api.delete(`/bsi-grundschutz/domains/${domain.id}/modeling/${mo.id}`);
      await Promise.all([loadDetail(domain.id), loadDomains()]);
    } catch (err) { toast.error(apiError(err, t('toast.saveError'))); }
  };

  const modelingFor = (targetId: number | null) => modeling.filter(m => m.target_object_id === targetId);

  const moduleChips = (targetId: number | null) => (
    <div className="flex flex-wrap gap-1.5">
      {modelingFor(targetId).map(mo => (
        <span key={mo.id} title={mo.module?.title || t('domain.notInCatalog')}
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-mono ${mo.in_active_catalog ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300'}`}>
          {mo.module_id}
          {canManage && <button type="button" aria-label={t('domain.removeModeling')} onClick={() => removeModeling(mo)} className="hover:text-red-600"><Trash2 size={11} /></button>}
        </span>
      ))}
      {modelingFor(targetId).length === 0 && <span className="text-xs text-gray-400 dark:text-slate-500">{t('domain.noModeling')}</span>}
    </div>
  );

  return (
    <div className="space-y-6">
      <Card><CardBody className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <Select label={t('domain.select')} value={domainId ? String(domainId) : ''} onChange={e => onDomainChange(e.target.value ? Number(e.target.value) : null)}
              options={domains.map(d => ({ value: String(d.id), label: d.is_default ? `${d.name} (${t('domain.default')})` : d.name }))} />
          </div>
          {canManage && domain && <Button variant="secondary" onClick={() => openDomainModal('edit')}><Pencil size={14} />{t('domain.edit')}</Button>}
          {canManage && <Button onClick={() => openDomainModal('create')}><Plus size={14} />{t('domain.create')}</Button>}
        </div>
        {domain && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div><p className="text-xs text-gray-500 dark:text-slate-400">{t('domain.approachLabel')}</p><p className="font-medium dark:text-white">{approachLabel(domain.protection_approach)}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-slate-400">{t('domain.catalog')}</p><p className="font-medium dark:text-white">{domain.catalog ? `${domain.catalog.name}${domain.catalog.edition ? ` (${domain.catalog.edition})` : ''}` : t('domain.noCatalog')}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-slate-400">{t('domain.scope')}</p><p className="dark:text-slate-200 whitespace-pre-line">{domain.scope || '–'}</p></div>
            {domain.description && <p className="md:col-span-3 text-gray-600 dark:text-slate-300 whitespace-pre-line">{domain.description}</p>}
          </div>
        )}
      </CardBody></Card>

      {domain && (
        <Card><CardBody className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold dark:text-white flex items-center gap-2"><Network size={18} className="text-blue-600" />{t('domain.domainWide')}</h2>
            {canManage && <Button size="sm" variant="secondary" onClick={() => openSuggestions(null)}><Lightbulb size={14} />{t('domain.suggest')}</Button>}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('domain.domainWideHint')}</p>
          {moduleChips(null)}
        </CardBody></Card>
      )}

      {domain && (
        <Card><CardBody className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold dark:text-white flex items-center gap-2"><Boxes size={18} className="text-blue-600" />{t('domain.targetObjects', { count: targets.length })}</h2>
            {canManage && <Button size="sm" onClick={() => setAddOpen(true)}><Plus size={14} />{t('domain.addTarget')}</Button>}
          </div>
          {targets.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">{t('domain.noTargets')}</p>
          ) : (
            <Table>
              <Thead><tr><Th>{t('domain.asset')}</Th><Th>{t('domain.targetTypeLabel')}</Th><Th>{t('domain.modeling')}</Th><Th>{''}</Th></tr></Thead>
              <Tbody>
                {targets.map(to => (
                  <tr key={to.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 align-top">
                    <Td><p className="font-medium text-sm dark:text-slate-200">{to.asset.name}</p><p className="text-xs text-gray-500 dark:text-slate-400">{to.asset.type}</p></Td>
                    <Td>
                      {canManage ? (
                        <Select className="w-48" aria-label={t('domain.targetTypeLabel')} value={to.target_type} onChange={e => changeType(to, e.target.value)}
                          options={(meta?.target_types || [to.target_type]).map(tt => ({ value: tt, label: targetTypeLabel(tt) }))} />
                      ) : <span className="text-sm dark:text-slate-200">{targetTypeLabel(to.target_type)}</span>}
                      {to.suggested_target_type && to.suggested_target_type !== to.target_type && (
                        <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">{t('domain.suggestedType', { type: targetTypeLabel(to.suggested_target_type) })}</p>
                      )}
                    </Td>
                    <Td>{moduleChips(to.id)}</Td>
                    <Td>
                      {canManage && (
                        <div className="flex gap-1">
                          <IconButton label={t('domain.suggest')} onClick={() => openSuggestions(to.id)}><Lightbulb size={14} /></IconButton>
                          <IconButton label={t('domain.removeTarget')} onClick={() => removeTarget(to)}><Trash2 size={14} /></IconButton>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody></Card>
      )}

      <Modal open={domainModal !== null} onClose={() => setDomainModal(null)} title={domainModal === 'edit' ? t('domain.edit') : t('domain.create')}>
        <form onSubmit={saveDomain} className="space-y-4">
          <Input label={`${t('domain.name')} *`} required value={domainForm.name} onChange={e => setDomainForm({ ...domainForm, name: e.target.value })} maxLength={255} />
          <Select label={t('domain.approachLabel')} value={domainForm.protection_approach} onChange={e => setDomainForm({ ...domainForm, protection_approach: e.target.value as ProtectionApproach })}
            options={(meta?.protection_approaches || ['basis', 'standard', 'kern']).map(a => ({ value: a, label: approachLabel(a) }))} />
          <p className="text-xs text-gray-500 dark:text-slate-400">{t(`domain.approachHint.${domainForm.protection_approach}`)}</p>
          <div className="flex flex-col gap-1">
            <label htmlFor="bsi-domain-scope" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('domain.scope')}</label>
            <textarea id="bsi-domain-scope" rows={3} className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" value={domainForm.scope} onChange={e => setDomainForm({ ...domainForm, scope: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bsi-domain-desc" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('domain.description')}</label>
            <textarea id="bsi-domain-desc" rows={3} className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" value={domainForm.description} onChange={e => setDomainForm({ ...domainForm, description: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setDomainModal(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            <Button type="submit" disabled={busy} className="flex-1 justify-center">{busy ? t('modal.saving') : t('modal.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={t('domain.addTarget')}>
        <form onSubmit={addTarget} className="space-y-4">
          <SearchableSelect label={t('domain.asset')} value={addForm.asset_id} onChange={val => setAddForm({ asset_id: val, target_type: '' })}
            options={assets.filter(a => !assignedAssetIds.has(a.id)).map(a => ({ value: String(a.id), label: `${a.name} (${a.type})` }))} />
          <Select label={t('domain.targetTypeLabel')} value={addForm.target_type || suggestedType || ''} onChange={e => setAddForm({ ...addForm, target_type: e.target.value })}
            options={[{ value: '', label: t('domain.chooseType') }, ...(meta?.target_types || []).map(tt => ({ value: tt, label: targetTypeLabel(tt) }))]} />
          {selectedAsset && (
            <p className="text-xs text-gray-500 dark:text-slate-400">{suggestedType ? t('domain.suggestedType', { type: targetTypeLabel(suggestedType) }) : t('domain.noTypeSuggestion')}</p>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            <Button type="submit" disabled={busy || !addForm.asset_id || !(addForm.target_type || suggestedType)} className="flex-1 justify-center">{t('modal.save')}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={suggestFor !== undefined} onClose={() => setSuggestFor(undefined)} size="lg"
        title={suggestFor === null ? t('domain.suggestTitleDomain') : t('domain.suggestTitleTarget', { name: targets.find(x => x.id === suggestFor)?.asset.name || '' })}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500 dark:text-slate-400">{t('domain.suggestHint')}</p>
          {suggestions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">{t('domain.noSuggestions')}</p>
          ) : (
            <Table>
              <Thead><tr><Th>{t('domain.module')}</Th><Th>{t('table.title')}</Th><Th>{''}</Th></tr></Thead>
              <Tbody>
                {suggestions.map(s => (
                  <tr key={s.module_id}>
                    <Td><span className="font-mono text-xs dark:text-slate-300">{s.module_id}</span></Td>
                    <Td className="text-sm dark:text-slate-200">{s.title}</Td>
                    <Td><Button size="sm" variant="secondary" onClick={() => applySuggestion(s)}><Check size={14} />{t('domain.apply')}</Button></Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
      </Modal>
    </div>
  );
};
