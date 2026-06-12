import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Download, FileSpreadsheet, Server, Pencil, Trash2, ChevronRight, Square, CheckSquare } from 'lucide-react';
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
import { de } from 'date-fns/locale';
import { exportToCSV, exportToExcel } from '../lib/export';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useModules } from '../contexts/ModulesContext';
import { hasWriteAccess } from '../lib/permissions';

const typeOptions = [
  { value: 'application', label: 'Anwendung' },
  { value: 'software', label: 'Software' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'service', label: 'Dienst' },
  { value: 'data', label: 'Daten' },
  { value: 'information', label: 'Information/Daten' },
  { value: 'process', label: 'Prozess' },
  { value: 'personal', label: 'Personal' },
  { value: 'ai_application', label: 'KI-Anwendung (AI Act)' },
  { value: 'ai_agent', label: 'KI-Agent' },
  { value: 'other', label: 'Sonstiges' },
];

const typeLabels: Record<string, string> = {
  application: 'Anwendung', software: 'Software', hardware: 'Hardware', service: 'Dienst', data: 'Daten',
  information: 'Information/Daten', process: 'Prozess', personal: 'Personal',
  ai_application: 'KI-Anwendung (AI Act)', ai_agent: 'KI-Agent / Autonomes System', other: 'Sonstiges',
};
const classLabels: Record<string, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };

const statusOptions = [
  { value: '', label: 'Aktive Assets' },
  { value: 'all', label: 'Alle (inkl. Ausgemustert)' },
  { value: 'active', label: 'Nur Aktiv' },
  { value: 'inactive', label: 'Nur Inaktiv' },
  { value: 'decommissioned', label: 'Ausgemustert' },
];

const fwOptions = [
  { value: 'iso27001', label: 'ISO 27001' },
  { value: 'nis2', label: 'NIS-2' },
  { value: 'gdpr', label: 'DSGVO / GDPR' },
];

const classOptions = [
  { value: 'public', label: 'Öffentlich' },
  { value: 'internal', label: 'Intern' },
  { value: 'confidential', label: 'Vertraulich' },
  { value: 'secret', label: 'Geheim' },
];

const hostingOptions = [
  { value: 'on-premise', label: 'On-Premise' },
  { value: 'cloud_public', label: 'Cloud Public' },
  { value: 'cloud_private', label: 'Cloud Private' },
  { value: 'hybrid', label: 'Hybrid' },
];

const lifecycleOptions = [
  { value: 'evaluation', label: 'In Evaluierung' },
  { value: 'production', label: 'Produktion' },
  { value: 'maintenance', label: 'Wartung' },
  { value: 'archived', label: 'Archiviert' },
];

const emptyForm = { name: '', type: 'application', description: '', classification: 'internal', owner_id: '', assessor_id: '', version: '', vendor: '', location: '', vendor_id: '', hosting_type: 'on-premise', lifecycle_status: 'production', dsfa_required: 'false', nis2_relevant: 'false' };
const emptyFrameworks: string[] = [];

const isOnline = (lastSeen?: string) => {
  if (!lastSeen) return false;
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  return (now.getTime() - lastSeenDate.getTime()) < 5 * 60 * 1000; // 5 minutes
};

export const Assets: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const { isEnabled } = useModules();
  const canWrite = hasWriteAccess(user?.role);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
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
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(value), 300);
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
    if (!confirm(`Möchten Sie die ${selectedIds.length} ausgewählten Assets wirklich löschen / außer Betrieb setzen?`)) return;
    try {
      await api.post('/assets/bulk-delete', { ids: selectedIds });
      toast.success(`${selectedIds.length} Assets gelöscht`);
      setSelectedIds([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
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
      toast.error('Bitte Eigentümer und technischen Verantwortlichen auswählen.');
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
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const flattenForExport = (rows: Asset[]) => rows.map(a => ({
    'ID': a.id,
    'Name': a.name,
    'Typ': typeLabels[a.type] || a.type,
    'Klassifizierung': classLabels[a.classification] || a.classification,
    'Eigentümer': a.owner?.name || '',
    'Bewerter': a.assessor?.name || '',
    'Status': a.status,
    'Version': a.version || '',
    'Hersteller': a.vendor || '',
    'Standort': a.location || '',
    'Erstellt am': format(new Date(a.created_at), 'dd.MM.yyyy', { locale: de }),
  }));

  const activeUsers = useMemo(() => users.filter(u => u.active), [users]);
  const exportData = useMemo(() => flattenForExport(assets), [assets]);
  const isItStaff = user?.role === 'it-staff';

  useKeyShortcut('n', () => {
    if (user?.role === 'viewer' || user?.role === 'management') return;
    setEditId(null); setForm(emptyForm); setModalOpen(true);
  }, { disabled: modalOpen });
  useKeyShortcut('/', () => {
    (document.querySelector('input[placeholder*="Assets durchsuchen"]') as HTMLInputElement)?.focus();
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Assets & Anwendungen</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{assets.length} Einträge</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user?.role === 'admin' && selectedIds.length > 0 && (
            <Button variant="danger" size="sm" onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-1">
              <Trash2 size={14} />
              {selectedIds.length} Löschen
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(exportData, `assets-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(exportData, `assets-${format(new Date(), 'yyyyMMdd')}`, 'Assets')}><FileSpreadsheet size={14} />Excel</Button>
          {canWrite && <Button onClick={() => { setEditId(null); setForm(emptyForm); setModalOpen(true); }}><Plus size={16} />Asset anlegen</Button>}
        </div>
      </div>

      <FilterBar
        search={search} onSearch={handleSearchChange} searchPlaceholder="Assets durchsuchen..."
        activeCount={[typeFilter, classFilter, statusFilter, lifecycleFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setTypeFilter(''); setClassFilter(''); setStatusFilter(''); setLifecycleFilter(''); }}>
        <Select className="w-40" options={[{ value: '', label: 'Alle Typen' }, ...typeOptions]} value={typeFilter} onChange={e => setTypeFilter(e.target.value)} />
        <Select className="w-40" options={[{ value: '', label: 'Alle Klassen' }, ...classOptions]} value={classFilter} onChange={e => setClassFilter(e.target.value)} />
        <Select className="w-40" options={statusOptions} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} />
        <Select className="w-40" options={[{ value: '', label: 'Alle Lifecycles' }, ...lifecycleOptions]} value={lifecycleFilter} onChange={e => setLifecycleFilter(e.target.value)} />
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
                    <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Assets für diese Filter</p>
                    <button onClick={() => { setSearch(''); setTypeFilter(''); setClassFilter(''); setStatusFilter(''); }} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2">Filter zurücksetzen</button>
                  </>
                ) : (
                  <>
                    <p className="text-gray-500 dark:text-slate-400 font-medium">Noch keine Assets angelegt</p>
                    <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">Erfasse Server, Software, Anwendungen und andere schutzbedürftige Werte.</p>
                    {canWrite && (
                      <button onClick={() => { setEditId(null); setForm(emptyForm); setModalOpen(true); }}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                        <Plus size={15} />Erstes Asset anlegen
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
                        <Badge size="xs" value={a.status} label={a.status === 'active' ? 'Aktiv' : 'Inaktiv'} />
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
                  <Th>Name</Th>
                  <Th>Typ</Th>
                  <Th className="hidden md:table-cell">Klassifizierung</Th>
                  <Th className="hidden lg:table-cell">Eigentümer</Th>
                  <Th>Status</Th>
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
                        <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Assets für diese Filter</p>
                        <button onClick={() => { setSearch(''); setTypeFilter(''); setClassFilter(''); setStatusFilter(''); }} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mt-2">Filter zurücksetzen</button>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-500 dark:text-slate-400 font-medium">Noch keine Assets angelegt</p>
                        <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">Erfasse Server, Software, Anwendungen und andere schutzbedürftige Werte.</p>
                        {canWrite && (
                          <button onClick={() => { setEditId(null); setForm(emptyForm); setModalOpen(true); }}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors">
                            <Plus size={15} />Erstes Asset anlegen
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
                      <Td><Badge value={a.status} label={a.status === 'active' ? 'Aktiv' : 'Inaktiv'} /></Td>
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Asset bearbeiten' : 'Neues Asset anlegen'} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label="Name des Assets" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="z. B. ERP-System, Kundendatenbank..." />
            </div>
            
            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Kurze Beschreibung des Verwendungszwecks..." />
            </div>

            <Select label="Asset-Typ" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} required options={[{ value: '', label: '– bitte wählen –' }, ...typeOptions]} />
            <Select label="Schutzbedarf" disabled={isItStaff} value={form.classification} onChange={e => setForm({ ...form, classification: e.target.value })} required options={[{ value: '', label: '– bitte wählen –' }, ...classOptions]} />
            
            <SearchableSelect label="Eigentümer (Business Owner)" value={form.owner_id} onChange={val => setForm({ ...form, owner_id: val })} required options={[{ value: '', label: 'Auswählen...' }, ...activeUsers.map(u => ({ value: String(u.id), label: `${u.name} (${u.role})` }))]} />
            <SearchableSelect label="Techn. Verantwortlicher (Assessor)" value={form.assessor_id} onChange={val => setForm({ ...form, assessor_id: val })} required options={[{ value: '', label: 'Auswählen...' }, ...activeUsers.map(u => ({ value: String(u.id), label: `${u.name} (${u.role})` }))]} />
            
            <Input label="Version / Revision" value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} placeholder="v1.0.0" />
            <Input label="Hersteller / Vendor" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} placeholder="Microsoft, SAP, etc." />
            
            <InputSelect
              label="Standort / Region"
              value={form.location}
              onChange={val => setForm({ ...form, location: val })}
              options={locations}
              placeholder="RZ Süd, AWS, etc."
            />
            <SearchableSelect label="Externer Dienstleister (Supply Chain)" value={form.vendor_id} onChange={val => setForm({ ...form, vendor_id: val })} options={[{ value: '', label: '– Eigenbetrieb / Intern –' }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]} />

            <div className="md:col-span-2 space-y-3 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-xl border dark:border-slate-800">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Relevante Frameworks</label>
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
                 <Select label="DSFA erforderlich?" value={form.dsfa_required} onChange={e => setForm({...form, dsfa_required: e.target.value})} options={[{value: 'false', label: 'Nein'}, {value: 'true', label: 'Ja'}]} />
               ) : (
                 <div />
               )}
               <Select label="NIS-2 relevant?" value={form.nis2_relevant} onChange={e => setForm({...form, nis2_relevant: e.target.value})} options={[{value: 'false', label: 'Nein'}, {value: 'true', label: 'Ja'}]} />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? 'Speichern...' : 'Asset speichern'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
