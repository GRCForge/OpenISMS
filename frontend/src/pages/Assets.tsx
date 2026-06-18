import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Download, FileSpreadsheet, Server, Pencil, Trash2, ChevronRight, Square, CheckSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useKeyShortcut } from '../hooks/useKeyShortcut';
import { FilterBar } from '../components/ui/FilterBar';
import api from '../lib/api';
import type { Asset, User, Vendor, Classification, AssetType, HostingType, LifecycleStatus } from '../types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { SkeletonTableRow } from '../components/ui/Skeleton';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { InputSelect } from '../components/ui/InputSelect';
import { format } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { exportToCSV, exportToExcel } from '../lib/export';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useModules } from '../contexts/ModulesContext';
import { hasWriteAccess } from '../lib/permissions';
import i18n from '../i18n';

const emptyForm = { name: '', type: 'application', description: '', classification: 'internal', owner_id: '', assessor_id: '', version: '', vendor: '', location: '', vendor_id: '', hosting_type: 'on-premise', lifecycle_status: 'production', dsfa_required: 'false', nis2_relevant: 'false' };
const emptyFrameworks: string[] = [];

const isOnline = (lastSeen?: string) => {
  if (!lastSeen) return false;
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  return (now.getTime() - lastSeenDate.getTime()) < 5 * 60 * 1000; // 5 minutes
};

export const Assets: React.FC = () => {
  const { t } = useTranslation(['assets', 'common']);
  const dateFnsLocale = i18n.language === 'de' ? de : enUS;

  const typeOptions = [
    { value: 'application',    label: t('assets:types.application') },
    { value: 'software',       label: t('assets:types.software') },
    { value: 'hardware',       label: t('assets:types.hardware') },
    { value: 'service',        label: t('assets:types.service') },
    { value: 'data',           label: t('assets:types.data') },
    { value: 'information',    label: t('assets:types.information') },
    { value: 'process',        label: t('assets:types.process') },
    { value: 'personal',       label: t('assets:types.personal') },
    { value: 'ai_application', label: t('assets:types.ai_application') },
    { value: 'ai_agent',       label: t('assets:types.ai_agent') },
    { value: 'other',          label: t('assets:types.other') },
  ];
  const typeLabels: Record<string, string> = Object.fromEntries(typeOptions.map(o => [o.value, o.label]));

  const classOptions = [
    { value: 'public',       label: t('common:classification.public') },
    { value: 'internal',     label: t('common:classification.internal') },
    { value: 'confidential', label: t('common:classification.confidential') },
    { value: 'secret',       label: t('common:classification.secret') },
  ];
  const classLabels: Record<string, string> = Object.fromEntries(classOptions.map(o => [o.value, o.label]));

  const statusOptions = [
    { value: '',               label: t('assets:status.activeAssets') },
    { value: 'all',            label: t('assets:status.all') },
    { value: 'active',         label: t('assets:status.onlyActive') },
    { value: 'inactive',       label: t('assets:status.onlyInactive') },
    { value: 'decommissioned', label: t('assets:status.decommissioned') },
  ];

  const hostingOptions = [
    { value: 'on-premise',    label: t('assets:hosting.on-premise') },
    { value: 'cloud_public',  label: t('assets:hosting.cloud_public') },
    { value: 'cloud_private', label: t('assets:hosting.cloud_private') },
    { value: 'hybrid',        label: t('assets:hosting.hybrid') },
  ];

  const lifecycleOptions = [
    { value: 'evaluation', label: t('assets:lifecycle.evaluation') },
    { value: 'production', label: t('assets:lifecycle.production') },
    { value: 'maintenance', label: t('assets:lifecycle.maintenance') },
    { value: 'archived',   label: t('assets:lifecycle.archived') },
  ];

  const fwOptions = [
    { value: 'iso27001', label: t('common:frameworks.iso27001') },
    { value: 'nis2',     label: t('common:frameworks.nis2') },
    { value: 'gdpr',     label: t('common:frameworks.gdpr') },
  ];

  const { user } = useAuth();
  const toast = useToast();
  const { isEnabled } = useModules();
  const canWrite = hasWriteAccess(user?.role);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState(() => sessionStorage.getItem('assets_search') || '');
  const [search, setSearch] = useState(() => sessionStorage.getItem('assets_search') || '');
  const [typeFilter, setTypeFilter] = useState(() => sessionStorage.getItem('assets_typeFilter') || '');
  const [classFilter, setClassFilter] = useState(() => sessionStorage.getItem('assets_classFilter') || '');
  const [statusFilter, setStatusFilter] = useState(() => sessionStorage.getItem('assets_statusFilter') || '');
  const [lifecycleFilter, setLifecycleFilter] = useState(() => sessionStorage.getItem('assets_lifecycleFilter') || '');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [frameworks, setFrameworks] = useState<string[]>(emptyFrameworks);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const loadLocations = () => {
    api.get('/assets/locations').then(r => setLocations(r.data)).catch(() => setLocations([]));
  };

  const isFirstRender = useRef(true);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setInputValue(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(value), 400);
  };

  // Restore scroll position after loading completes
  useEffect(() => {
    if (!loading) {
      const savedScroll = sessionStorage.getItem('assets_scroll_pos');
      if (savedScroll) {
        const mainEl = document.querySelector('main');
        if (mainEl) {
          setTimeout(() => {
            mainEl.scrollTop = parseInt(savedScroll, 10);
          }, 50);
        }
      }
    }
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [loading]);

  // Listen to scroll events on <main> to save scroll position
  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    const handleScroll = () => {
      sessionStorage.setItem('assets_scroll_pos', String(mainEl.scrollTop));
    };

    mainEl.addEventListener('scroll', handleScroll);
    return () => {
      mainEl.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Save filter state and reset scroll position on change
  useEffect(() => {
    sessionStorage.setItem('assets_search', search);
    sessionStorage.setItem('assets_typeFilter', typeFilter);
    sessionStorage.setItem('assets_classFilter', classFilter);
    sessionStorage.setItem('assets_statusFilter', statusFilter);
    sessionStorage.setItem('assets_lifecycleFilter', lifecycleFilter);

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    sessionStorage.setItem('assets_scroll_pos', '0');
    const mainEl = document.querySelector('main');
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
  }, [search, typeFilter, classFilter, statusFilter, lifecycleFilter]);

  const load = () => {
    setLoading(true);
    setSelectedIds([]);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (typeFilter) params.type = typeFilter;
    if (classFilter) params.classification = classFilter;
    if (statusFilter) params.status = statusFilter;
    if (lifecycleFilter) params.lifecycle_status = lifecycleFilter;
    api.get('/assets', { params }).then(r => setAssets(r.data)).catch(() => setAssets([])).finally(() => setLoading(false));
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!confirm(t('assets:toast.bulkDeleteConfirm', { count: selectedIds.length }))) return;
    try {
      await api.post('/assets/bulk-delete', { ids: selectedIds });
      toast.success(t('assets:toast.bulkDeleted', { count: selectedIds.length }));
      setSelectedIds([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('assets:toast.errorDeleting'));
    }
  };

  useEffect(() => {
    api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([]));
    api.get('/vendors').then(r => setVendors(r.data)).catch(() => setVendors([]));
    loadLocations();
  }, []);

  useEffect(() => { load(); }, [search, typeFilter, classFilter, statusFilter, lifecycleFilter]);

  const openEdit = (a: Asset) => {
    setEditId(a.id);
    setForm({
      name: a.name,
      type: a.type,
      description: a.description || '',
      classification: a.classification,
      owner_id: String(a.owner_id),
      assessor_id: String(a.assessor_id),
      version: a.version || '',
      vendor: a.vendor || '',
      location: a.location || '',
      vendor_id: a.vendor_id ? String(a.vendor_id) : '',
      hosting_type: a.hosting_type,
      lifecycle_status: a.lifecycle_status,
      dsfa_required: String(!!a.dsfa_required),
      nis2_relevant: String(!!a.nis2_relevant),
    });
    setFrameworks(a.frameworks || []);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.owner_id || !form.assessor_id) {
      toast.error(t('assets:form.requiredOwner'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        frameworks,
        dsfa_required: form.dsfa_required === 'true',
        nis2_relevant: form.nis2_relevant === 'true',
        // Ensure empty IDs are sent as null to prevent foreign key errors
        owner_id: form.owner_id || null,
        assessor_id: form.assessor_id || null,
        vendor_id: form.vendor_id || null,
      };
      if (editId) await api.put(`/assets/${editId}`, payload);
      else await api.post('/assets', payload);
      setModalOpen(false);
      setEditId(null);
      setForm(emptyForm);
      setFrameworks(emptyFrameworks);
      load();
      loadLocations();
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('assets:toast.errorSaving'));
    } finally { setSaving(false); }
  };

  const flattenForExport = (rows: Asset[]) => rows.map(a => ({
    'ID': a.id,
    [t('assets:table.name')]: a.name,
    [t('assets:table.type')]: typeLabels[a.type] || a.type,
    [t('assets:table.classification')]: classLabels[a.classification] || a.classification,
    [t('assets:table.owner')]: a.owner?.name || '',
    [t('assets:form.assessor')]: a.assessor?.name || '',
    [t('assets:table.status')]: a.status,
    [t('assets:form.version')]: a.version || '',
    [t('assets:form.vendor')]: a.vendor || '',
    [t('assets:form.location')]: a.location || '',
    'Created': format(new Date(a.created_at), 'P', { locale: dateFnsLocale }),
  }));

  const activeUsers = useMemo(() => users.filter(u => u.active), [users]);
  const exportData = useMemo(() => flattenForExport(assets), [assets, t, dateFnsLocale]);
  const isItStaff = user?.role === 'it-staff';

  const searchPlaceholder = t('assets:searchPlaceholder');

  useKeyShortcut('n', () => {
    if (user?.role === 'viewer' || user?.role === 'management') return;
    setEditId(null); setForm(emptyForm); setModalOpen(true);
  }, { disabled: modalOpen });
  useKeyShortcut('/', () => {
    (document.querySelector(`input[placeholder*="${searchPlaceholder}"]`) as HTMLInputElement)?.focus();
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('assets:title')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('assets:countLabel', { count: assets.length })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user?.role === 'admin' && selectedIds.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1">
              <Trash2 size={14} />
              {t('assets:bulkDelete', { count: selectedIds.length })}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(exportData, `assets-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(exportData, `assets-${format(new Date(), 'yyyyMMdd')}`, 'Assets')}><FileSpreadsheet size={14} />Excel</Button>
          {canWrite && <Button onClick={() => { setEditId(null); setForm(emptyForm); setModalOpen(true); }}><Plus size={16} />{t('assets:new')}</Button>}
        </div>
      </div>

      <FilterBar
        search={inputValue} onSearch={handleSearchChange} searchPlaceholder={searchPlaceholder}
        activeCount={[typeFilter, classFilter, statusFilter, lifecycleFilter].filter(Boolean).length}
        onReset={() => { setInputValue(''); setSearch(''); setTypeFilter(''); setClassFilter(''); setStatusFilter(''); setLifecycleFilter(''); }}>
        <Select className="w-40" options={[{ value: '', label: t('assets:filters.allTypes') }, ...typeOptions]} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} />
        <Select className="w-40" options={[{ value: '', label: t('assets:filters.allClassifications') }, ...classOptions]} value={classFilter} onChange={e => setClassFilter(e.target.value)} />
        <Select className="w-40" options={statusOptions} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} />
        <Select className="w-40" options={[{ value: '', label: t('assets:filters.allLifecycle') }, ...lifecycleOptions]} value={lifecycleFilter} onChange={e => setLifecycleFilter(e.target.value)} />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          {/* Mobile card list (< sm) */}
          <div className="sm:hidden">
            {loading ? (
              <div className="divide-y dark:divide-slate-800/50">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="p-4 animate-pulse">
                    <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-2/3 mb-2" />
                    <div className="flex gap-2">
                      <div className="h-5 bg-gray-100 dark:bg-slate-800 rounded-full w-16" />
                      <div className="h-5 bg-gray-100 dark:bg-slate-800 rounded-full w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : assets.length === 0 ? (
              <div className="py-20 text-center px-6">
                <Server size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                {(search || typeFilter || classFilter || statusFilter) ? (
                  <>
                    <p className="text-gray-500 dark:text-slate-400 font-medium">{t('assets:noFilter')}</p>
                    <button onClick={() => { setSearch(''); setTypeFilter(''); setClassFilter(''); setStatusFilter(''); }} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2">{t('common:actions.reset')}</button>
                  </>
                ) : (
                  <>
                    <p className="text-gray-500 dark:text-slate-400 font-medium">{t('assets:empty.title')}</p>
                    <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">{t('assets:empty.subtitle')}</p>
                    {canWrite && (
                      <button onClick={() => { setEditId(null); setForm(emptyForm); setModalOpen(true); }}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                        <Plus size={15} />{t('assets:empty.createFirst')}
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="divide-y dark:divide-slate-800/50">
                {assets.map(a => (
                  <div key={a.id}
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                    onClick={() => openEdit(a)}>
                    <div className="flex-1 min-w-0">
                      <Link
                        to={`/assets/${a.id}`}
                        className="text-blue-600 dark:text-blue-400 font-medium text-sm hover:underline"
                        onClick={e => e.stopPropagation()}>
                        {a.name}
                      </Link>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        <Badge size="xs" value={a.type} label={typeLabels[a.type] || a.type} />
                        <Badge size="xs" value={a.classification} label={classLabels[a.classification] || a.classification} />
                        <Badge size="xs" value={a.status} label={a.status === 'active' ? t('assets:status.active') : t('assets:status.inactive')} />
                      </div>
                      {a.owner && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{a.owner.name}</p>}
                    </div>
                    <ChevronRight size={16} className="text-gray-300 dark:text-slate-600 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Desktop table (sm+) */}
          <div className="hidden sm:block">
            <Table>
              <Thead>
                <tr>
                  {user?.role === 'admin' && (
                    <Th className="w-10">
                      <button
                        type="button"
                        onClick={() => {
                          if (assets.length > 0 && selectedIds.length === assets.length) {
                            setSelectedIds([]);
                          } else {
                            setSelectedIds(assets.map(a => a.id));
                          }
                        }}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-white mt-1 cursor-pointer"
                      >
                        {assets.length > 0 && selectedIds.length === assets.length ? (
                          <CheckSquare size={16} className="text-blue-500" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                    </Th>
                  )}
                  <Th>{t('assets:table.name')}</Th>
                  <Th>{t('assets:table.type')}</Th>
                  <Th className="hidden md:table-cell">{t('assets:table.classification')}</Th>
                  <Th className="hidden lg:table-cell">{t('assets:table.owner')}</Th>
                  <Th>{t('assets:table.status')}</Th>
                  <Th>{''}</Th>
                </tr>
              </Thead>
              <Tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} cols={user?.role === 'admin' ? 7 : 6} />)
                ) : assets.length === 0 ? (
                  <tr><td colSpan={user?.role === 'admin' ? 7 : 6} className="py-20 text-center">
                    <Server size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                    {(search || typeFilter || classFilter || statusFilter) ? (
                      <>
                        <p className="text-gray-500 dark:text-slate-400 font-medium">{t('assets:noFilter')}</p>
                        <button onClick={() => { setSearch(''); setTypeFilter(''); setClassFilter(''); setStatusFilter(''); }} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2">{t('common:actions.reset')}</button>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-500 dark:text-slate-400 font-medium">{t('assets:empty.title')}</p>
                        <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">{t('assets:empty.subtitle')}</p>
                        {canWrite && (
                          <button onClick={() => { setEditId(null); setForm(emptyForm); setModalOpen(true); }}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                            <Plus size={15} />{t('assets:empty.createFirst')}
                          </button>
                        )}
                      </>
                    )}
                  </td></tr>
                ) : (
                  assets.map(a => (
                    <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => openEdit(a)}>
                      {user?.role === 'admin' && (
                        <Td onClick={e => e.stopPropagation()} className="w-10">
                          <button
                            type="button"
                            onClick={() => {
                              const isSelected = selectedIds.includes(a.id);
                              if (isSelected) {
                                setSelectedIds(prev => prev.filter(id => id !== a.id));
                              } else {
                                setSelectedIds(prev => [...prev, a.id]);
                              }
                            }}
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-white mt-1 cursor-pointer"
                          >
                            {selectedIds.includes(a.id) ? (
                              <CheckSquare size={16} className="text-blue-500" />
                            ) : (
                              <Square size={16} />
                            )}
                          </button>
                        </Td>
                      )}
                      <Td>
                        <Link
                          to={`/assets/${a.id}`}
                          className="text-blue-600 dark:text-blue-400 font-medium hover:underline"
                          onClick={e => e.stopPropagation()}>
                          {a.name}
                        </Link>
                      </Td>
                      <Td><Badge value={a.type} label={typeLabels[a.type] || a.type} /></Td>
                      <Td className="hidden md:table-cell"><Badge value={a.classification} label={classLabels[a.classification] || a.classification} /></Td>
                      <Td className="hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium dark:text-slate-200">{a.owner?.name || '-'}</div>
                          {a.owner && (
                            <div className={`w-2 h-2 rounded-full ${isOnline(a.owner.last_seen_at) ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} title={isOnline(a.owner.last_seen_at) ? 'Online' : 'Offline'} />
                          )}
                        </div>
                      </Td>
                      <Td><Badge value={a.status} label={a.status === 'active' ? t('assets:status.active') : t('assets:status.inactive')} /></Td>
                      <Td className="text-right">
                        <Link to={`/assets/${a.id}`} className="p-2 text-gray-400 hover:text-blue-600 transition-colors" onClick={e => e.stopPropagation()}><Server size={14}/></Link>
                      </Td>
                    </tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </CardBody>
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? t('assets:edit') : t('assets:new')} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label={t('assets:form.name')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder={t('assets:form.placeholders.name')} />
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('assets:form.description')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('assets:form.placeholders.description')} />
            </div>

            <Select label={t('assets:form.type')} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} required options={[{ value: '', label: t('assets:form.placeholders.select') }, ...typeOptions]} />
            <Select label={t('assets:form.classification')} disabled={isItStaff} value={form.classification} onChange={e => setForm({ ...form, classification: e.target.value })} required options={[{ value: '', label: t('assets:form.placeholders.select') }, ...classOptions]} />

            <SearchableSelect label={t('assets:form.owner')} value={form.owner_id} onChange={val => setForm({ ...form, owner_id: val })} required options={[{ value: '', label: t('assets:form.placeholders.select') }, ...activeUsers.map(u => ({ value: String(u.id), label: `${u.name} (${u.role})` }))]} />
            <SearchableSelect label={t('assets:form.assessor')} value={form.assessor_id} onChange={val => setForm({ ...form, assessor_id: val })} required options={[{ value: '', label: t('assets:form.placeholders.select') }, ...activeUsers.map(u => ({ value: String(u.id), label: `${u.name} (${u.role})` }))]} />

            <Input label={t('assets:form.version')} value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder={t('assets:form.placeholders.version')} />
            <Input label={t('assets:form.vendor')} value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder={t('assets:form.placeholders.vendor')} />

            <InputSelect
              label={t('assets:form.location')}
              value={form.location}
              onChange={val => setForm({ ...form, location: val })}
              options={locations}
              placeholder={t('assets:form.placeholders.location')}
            />
            <SearchableSelect label={t('assets:form.externalVendor')} value={form.vendor_id} onChange={val => setForm({ ...form, vendor_id: val })} options={[{ value: '', label: t('assets:form.placeholders.own') }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]} />

            <div className="md:col-span-2 space-y-3 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-xl border dark:border-slate-800">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('assets:form.frameworks')}</label>
              <div className="flex flex-wrap gap-4">
                {fwOptions.filter(fw => fw.value !== 'gdpr' || isEnabled('dsgvo')).map(fw => (
                  <label key={fw.value} className={`flex items-center gap-2 ${isItStaff ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input type="checkbox" disabled={isItStaff} checked={frameworks.includes(fw.value)}
                      onChange={e => setFrameworks(f => e.target.checked ? [...f, fw.value] : f.filter(x => x !== fw.value))}
                      className="w-4 h-4 rounded text-blue-600" />
                    <span className="text-sm dark:text-slate-300">{fw.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 grid grid-cols-2 gap-4">
              {isEnabled('dsgvo') ? (
                <Select label={t('assets:form.dsfa')} value={form.dsfa_required} onChange={e => setForm({...form, dsfa_required: e.target.value})} options={[{value: 'false', label: t('assets:yn.no')}, {value: 'true', label: t('assets:yn.yes')}]} />
              ) : (
                <div />
              )}
              <Select label={t('assets:form.nis2')} value={form.nis2_relevant} onChange={e => setForm({...form, nis2_relevant: e.target.value})} options={[{value: 'false', label: t('assets:yn.no')}, {value: 'true', label: t('assets:yn.yes')}]} />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{t('common:actions.cancel')}</Button>
            <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('assets:form.saving') : t('assets:form.save')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
