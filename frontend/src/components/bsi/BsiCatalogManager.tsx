import React, { useEffect, useState } from 'react';
import { Upload, Link2, CheckCircle2, Trash2, GitCompare } from 'lucide-react';
import { format as formatDate } from 'date-fns';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Modal } from '../ui/Modal';
import { Table, Thead, Tbody, Th, Td } from '../ui/Table';
import { useToast } from '../../contexts/ToastContext';

export interface BsiCatalog {
  id: number;
  name: string;
  edition: string | null;
  format: 'seed' | 'kompendium_xml' | 'oscal_catalog';
  source: 'seed' | 'upload' | 'url';
  source_url: string | null;
  source_filename: string | null;
  source_sha256: string | null;
  source_version: string | null;
  oscal_version: string | null;
  status: 'preview' | 'active' | 'archived';
  module_count: number;
  requirement_count: number;
  created_at: string;
  activated_at: string | null;
  importedBy?: { id: number; name: string } | null;
}

interface DiffEntry { req_id: string; module_id: string; title: string; requirement_level: string | null; withdrawn: boolean }
interface CatalogDiff {
  against: { id: number; name: string; edition: string | null } | null;
  counts: { added: number; changed: number; removed: number; unchanged: number };
  added: DiffEntry[];
  changed: { req_id: string; fields: string[]; before: DiffEntry; after: DiffEntry }[];
  removed: DiffEntry[];
}

const PREVIEW_ROWS = 50;

const statusClass: Record<BsiCatalog['status'], string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  preview: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  archived: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
};

interface Props {
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  onActivated: () => void;
}

export const BsiCatalogManager: React.FC<Props> = ({ open, onClose, canManage, onActivated }) => {
  const { t } = useTranslation('bsigrundschutz');
  const toast = useToast();
  const [catalogs, setCatalogs] = useState<BsiCatalog[]>([]);
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [edition, setEdition] = useState('');
  const [format, setFormat] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BsiCatalog | null>(null);
  const [diff, setDiff] = useState<CatalogDiff | null>(null);

  const load = () => api.get('/bsi-grundschutz/catalogs').then(r => setCatalogs(r.data)).catch(() => setCatalogs([]));
  useEffect(() => { if (open) load(); }, [open]);

  const showDiff = async (c: BsiCatalog) => {
    setSelected(c);
    setDiff(null);
    try { setDiff((await api.get(`/bsi-grundschutz/catalogs/${c.id}/diff`)).data); }
    catch { toast.error(t('catalogs.toast.diffError')); }
  };

  const errorText = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

  const runImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      let res;
      if (mode === 'file') {
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('format', format);
        if (name) fd.append('name', name);
        if (edition) fd.append('edition', edition);
        res = await api.post('/bsi-grundschutz/catalogs/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        res = await api.post('/bsi-grundschutz/catalogs/import-url', { url, format, name: name || undefined, edition: edition || undefined });
      }
      toast.success(t('catalogs.toast.imported', { count: res.data.catalog.requirement_count }));
      setFile(null); setUrl(''); setName(''); setEdition('');
      await load();
      setSelected(res.data.catalog);
      setDiff(res.data.diff);
    } catch (err) {
      toast.error(errorText(err, t('catalogs.toast.importError')));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (c: BsiCatalog) => {
    if (!confirm(t('catalogs.activateConfirm', { name: c.name }))) return;
    setBusy(true);
    try {
      const r = await api.post(`/bsi-grundschutz/catalogs/${c.id}/activate`);
      toast.success(t('catalogs.toast.activated', { created: r.data.created, updated: r.data.updated, retired: r.data.retired }));
      setSelected(null); setDiff(null);
      await load();
      onActivated();
    } catch (err) {
      toast.error(errorText(err, t('catalogs.toast.activateError')));
    } finally {
      setBusy(false);
    }
  };

  const discard = async (c: BsiCatalog) => {
    if (!confirm(t('catalogs.discardConfirm', { name: c.name }))) return;
    try {
      await api.delete(`/bsi-grundschutz/catalogs/${c.id}`);
      if (selected?.id === c.id) { setSelected(null); setDiff(null); }
      await load();
    } catch (err) {
      toast.error(errorText(err, t('catalogs.toast.discardError')));
    }
  };

  const diffList = (title: string, rows: DiffEntry[], tone: string) => rows.length > 0 && (
    <div>
      <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${tone}`}>{title} ({rows.length})</p>
      <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">
        {rows.slice(0, PREVIEW_ROWS).map(r => (
          <li key={r.req_id} className="dark:text-slate-300"><span className="font-mono">{r.req_id}</span> {r.title}</li>
        ))}
        {rows.length > PREVIEW_ROWS && <li className="text-gray-500 dark:text-slate-400">{t('catalogs.diff.more', { count: rows.length - PREVIEW_ROWS })}</li>}
      </ul>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={t('catalogs.title')} size="2xl">
      <div className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-slate-400">{t('catalogs.intro')}</p>

        <Table>
          <Thead><tr>
            <Th>{t('catalogs.table.name')}</Th><Th>{t('catalogs.table.format')}</Th><Th>{t('catalogs.table.requirements')}</Th>
            <Th>{t('catalogs.table.status')}</Th><Th>{t('catalogs.table.imported')}</Th><Th>{''}</Th>
          </tr></Thead>
          <Tbody>
            {catalogs.map(c => (
              <tr key={c.id} className={selected?.id === c.id ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}>
                <Td><p className="font-medium text-sm dark:text-slate-200">{c.name}</p>{c.edition && <p className="text-xs text-gray-500 dark:text-slate-400">{c.edition}</p>}</Td>
                <Td className="text-xs dark:text-slate-300">{t(`catalogs.format.${c.format}`)}</Td>
                <Td className="text-xs dark:text-slate-300">{c.requirement_count}</Td>
                <Td><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusClass[c.status]}`}>{t(`catalogs.status.${c.status}`)}</span></Td>
                <Td className="text-xs text-gray-500 dark:text-slate-400">{formatDate(new Date(c.created_at), 'dd.MM.yyyy HH:mm')}{c.importedBy ? ` · ${c.importedBy.name}` : ''}</Td>
                <Td>
                  <div className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => showDiff(c)}><GitCompare size={14} />{t('catalogs.compare')}</Button>
                    {canManage && c.status !== 'active' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => activate(c)}><CheckCircle2 size={14} />{t('catalogs.activate')}</Button>}
                    {canManage && c.status === 'preview' && <Button size="sm" variant="danger" onClick={() => discard(c)}><Trash2 size={14} /></Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>

        {selected && (
          <div className="border dark:border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold dark:text-white">
              {t('catalogs.diff.title', { name: selected.name, against: diff?.against ? diff.against.name : t('catalogs.diff.none') })}
            </p>
            {selected.source_sha256 && <p className="text-[11px] font-mono text-gray-500 dark:text-slate-400 break-all">SHA-256 {selected.source_sha256}</p>}
            {!diff ? <p className="text-sm text-gray-500 dark:text-slate-400">…</p> : (
              <>
                <div className="flex gap-4 text-sm dark:text-slate-300">
                  <span>{t('catalogs.diff.added')}: <b>{diff.counts.added}</b></span>
                  <span>{t('catalogs.diff.changed')}: <b>{diff.counts.changed}</b></span>
                  <span>{t('catalogs.diff.removed')}: <b>{diff.counts.removed}</b></span>
                  <span>{t('catalogs.diff.unchanged')}: <b>{diff.counts.unchanged}</b></span>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {diffList(t('catalogs.diff.added'), diff.added, 'text-green-700 dark:text-green-400')}
                  {diffList(t('catalogs.diff.changed'), diff.changed.map(c => c.after), 'text-blue-700 dark:text-blue-400')}
                  {diffList(t('catalogs.diff.removed'), diff.removed, 'text-red-700 dark:text-red-400')}
                </div>
                {selected.status !== 'active' && <p className="text-xs text-gray-500 dark:text-slate-400">{t('catalogs.diff.hint')}</p>}
              </>
            )}
          </div>
        )}

        {canManage && (
          <form onSubmit={runImport} className="border-t dark:border-slate-700 pt-4 space-y-3">
            <p className="text-sm font-semibold dark:text-white">{t('catalogs.import.title')}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'file' ? 'primary' : 'secondary'} onClick={() => setMode('file')}><Upload size={14} />{t('catalogs.import.file')}</Button>
              <Button type="button" size="sm" variant={mode === 'url' ? 'primary' : 'secondary'} onClick={() => setMode('url')}><Link2 size={14} />{t('catalogs.import.url')}</Button>
            </div>
            {mode === 'file'
              ? <input type="file" accept=".xml,.json" aria-label={t('catalogs.import.file')} className="text-sm dark:text-slate-300" onChange={e => setFile(e.target.files?.[0] || null)} />
              : <Input label={t('catalogs.import.urlLabel')} type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" />}
            <div className="grid md:grid-cols-3 gap-3">
              <Select label={t('catalogs.import.format')} value={format} onChange={e => setFormat(e.target.value)} options={[
                { value: 'auto', label: t('catalogs.format.auto') },
                { value: 'kompendium_xml', label: t('catalogs.format.kompendium_xml') },
                { value: 'oscal_catalog', label: t('catalogs.format.oscal_catalog') },
              ]} />
              <Input label={t('catalogs.import.name')} value={name} onChange={e => setName(e.target.value)} maxLength={255} />
              <Input label={t('catalogs.import.edition')} value={edition} onChange={e => setEdition(e.target.value)} maxLength={120} />
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">{t('catalogs.import.hint')}</p>
            <Button type="submit" disabled={busy || (mode === 'file' ? !file : !url)}>{busy ? t('catalogs.import.running') : t('catalogs.import.submit')}</Button>
          </form>
        )}
      </div>
    </Modal>
  );
};
