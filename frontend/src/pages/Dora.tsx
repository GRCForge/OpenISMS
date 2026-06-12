import React, { useEffect, useState, useMemo } from 'react';
import { Zap, Plus, Trash2, Pencil, CalendarCheck, FlaskConical } from 'lucide-react';
import { format } from 'date-fns';
import api from '../lib/api';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';

type DoraStatus = 'active' | 'under_review' | 'terminated';
type DoraCriticality = 'critical' | 'important' | 'standard';

interface DoraItem {
  id: number;
  name: string;
  ict_service: string;
  criticality: DoraCriticality;
  contract_start: string;
  contract_end: string;
  country: string;
  contact_name: string;
  contact_email: string;
  sla_rto_hours: number | null;
  sla_rpo_hours: number | null;
  last_review_date: string;
  next_review_date: string;
  status: DoraStatus;
  notes: string;
}

const criticalityLabels: Record<DoraCriticality, string> = {
  critical: 'Kritisch (DORA Art. 31)',
  important: 'Wichtig',
  standard: 'Standard',
};

const criticalityColors: Record<DoraCriticality, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  important: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  standard: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
};

const statusLabels: Record<DoraStatus, string> = {
  active: 'Aktiv',
  under_review: 'In Prüfung',
  terminated: 'Beendet',
};

const statusColors: Record<DoraStatus, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  under_review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  terminated: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
};

type DoraTestType = 'tlpt' | 'penetration_test' | 'vulnerability_scan' | 'scenario_based' | 'bcp_test' | 'other';
type DoraTestStatus = 'planned' | 'in_progress' | 'completed';
type DoraTestResult = 'pending' | 'passed' | 'passed_with_findings' | 'failed';

interface DoraResilienceTest {
  id: number;
  title: string;
  test_type: DoraTestType;
  test_date?: string;
  performed_by?: string;
  status: DoraTestStatus;
  result: DoraTestResult;
  findings?: string;
  remediation?: string;
  next_test_date?: string;
  notes?: string;
}

const testTypeLabels: Record<DoraTestType, string> = {
  tlpt: 'TLPT (Threat-Led Pentest)',
  penetration_test: 'Penetrationstest',
  vulnerability_scan: 'Schwachstellenscan',
  scenario_based: 'Szenariobasierter Test',
  bcp_test: 'BCP-/Wiederanlauftest',
  other: 'Sonstiger Test',
};

const testStatusLabels: Record<DoraTestStatus, string> = {
  planned: 'Geplant',
  in_progress: 'Laufend',
  completed: 'Abgeschlossen',
};

const testStatusColors: Record<DoraTestStatus, string> = {
  planned: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

const testResultLabels: Record<DoraTestResult, string> = {
  pending: 'Ausstehend',
  passed: 'Bestanden',
  passed_with_findings: 'Bestanden mit Findings',
  failed: 'Nicht bestanden',
};

const testResultColors: Record<DoraTestResult, string> = {
  pending: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400',
  passed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  passed_with_findings: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const emptyTestForm = {
  title: '',
  test_type: 'penetration_test' as DoraTestType,
  test_date: '',
  performed_by: '',
  status: 'planned' as DoraTestStatus,
  result: 'pending' as DoraTestResult,
  findings: '',
  remediation: '',
  next_test_date: '',
  notes: '',
};

const emptyForm = {
  name: '',
  ict_service: '',
  criticality: 'standard' as DoraCriticality,
  contract_start: '',
  contract_end: '',
  country: '',
  contact_name: '',
  contact_email: '',
  sla_rto_hours: '',
  sla_rpo_hours: '',
  last_review_date: '',
  next_review_date: '',
  status: 'active' as DoraStatus,
  notes: '',
};

export const Dora: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);
  const canDelete = user?.role === 'admin' || user?.role === 'assessor';

  const [tab, setTab] = useState<'register' | 'tests'>('register');
  const [items, setItems] = useState<DoraItem[]>([]);
  const [tests, setTests] = useState<DoraResilienceTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [critFilter, setCritFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testEditId, setTestEditId] = useState<number | null>(null);
  const [testForm, setTestForm] = useState({ ...emptyTestForm });
  const [testSaving, setTestSaving] = useState(false);

  const load = () =>
    api.get('/dora').then(r => setItems(r.data)).catch(() => setItems([])).finally(() => setLoading(false));

  const loadTests = () =>
    api.get('/dora/tests').then(r => setTests(r.data)).catch(() => setTests([]));

  useEffect(() => { load(); loadTests(); }, []);

  const today = new Date();

  const filtered = useMemo(() => items.filter(i => {
    if (critFilter && i.criticality !== critFilter) return false;
    if (statusFilter && i.status !== statusFilter) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) &&
      !i.ict_service?.toLowerCase().includes(search.toLowerCase()) &&
      !i.country?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, critFilter, statusFilter, search]);

  const stats = useMemo(() => ({
    total: items.length,
    critical: items.filter(i => i.criticality === 'critical').length,
    reviewDue: items.filter(i => i.next_review_date && new Date(i.next_review_date) < today && i.status !== 'terminated').length,
    active: items.filter(i => i.status === 'active').length,
  }), [items]);

  const openNew = () => { setEditId(null); setForm({ ...emptyForm }); setModalOpen(true); };
  const openEdit = (i: DoraItem) => {
    setEditId(i.id);
    setForm({
      name: i.name,
      ict_service: i.ict_service,
      criticality: i.criticality,
      contract_start: i.contract_start || '',
      contract_end: i.contract_end || '',
      country: i.country || '',
      contact_name: i.contact_name || '',
      contact_email: i.contact_email || '',
      sla_rto_hours: i.sla_rto_hours != null ? String(i.sla_rto_hours) : '',
      sla_rpo_hours: i.sla_rpo_hours != null ? String(i.sla_rpo_hours) : '',
      last_review_date: i.last_review_date || '',
      next_review_date: i.next_review_date || '',
      status: i.status,
      notes: i.notes || '',
    });
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        sla_rto_hours: form.sla_rto_hours !== '' ? Number(form.sla_rto_hours) : null,
        sla_rpo_hours: form.sla_rpo_hours !== '' ? Number(form.sla_rpo_hours) : null,
      };
      if (editId) await api.put(`/dora/${editId}`, payload);
      else await api.post('/dora', payload);
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (i: DoraItem) => {
    if (!confirm(`„${i.name}" wirklich löschen?`)) return;
    try {
      await api.delete(`/dora/${i.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const isReviewDue = (item: DoraItem) =>
    item.next_review_date && new Date(item.next_review_date) < today && item.status !== 'terminated';

  const testStats = useMemo(() => ({
    total: tests.length,
    planned: tests.filter(t => t.status === 'planned').length,
    completed: tests.filter(t => t.status === 'completed').length,
    failed: tests.filter(t => t.result === 'failed').length,
  }), [tests]);

  const openNewTest = () => { setTestEditId(null); setTestForm({ ...emptyTestForm }); setTestModalOpen(true); };
  const openEditTest = (t: DoraResilienceTest) => {
    setTestEditId(t.id);
    setTestForm({
      title: t.title,
      test_type: t.test_type,
      test_date: t.test_date || '',
      performed_by: t.performed_by || '',
      status: t.status,
      result: t.result,
      findings: t.findings || '',
      remediation: t.remediation || '',
      next_test_date: t.next_test_date || '',
      notes: t.notes || '',
    });
    setTestModalOpen(true);
  };

  const saveTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestSaving(true);
    try {
      if (testEditId) await api.put(`/dora/tests/${testEditId}`, testForm);
      else await api.post('/dora/tests', testForm);
      setTestModalOpen(false);
      loadTests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setTestSaving(false);
    }
  };

  const removeTest = async (t: DoraResilienceTest) => {
    if (!confirm(`„${t.title}" wirklich löschen?`)) return;
    try {
      await api.delete(`/dora/tests/${t.id}`);
      loadTests();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const isNextTestOverdue = (t: DoraResilienceTest) =>
    !!t.next_test_date && new Date(t.next_test_date) < today;

  if (loading) return (
    <div className="flex justify-center pt-20">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Zap size={24} className="text-blue-600" />
            {tab === 'register' ? 'DORA IKT-Drittparteienregister' : 'DORA Resilienztests'}
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            {tab === 'register'
              ? `Digital Operational Resilience Act – Register IKT-Drittdienstleister · ${items.length} Einträge`
              : `Tests der digitalen operationalen Resilienz (DORA Art. 24–26) · ${tests.length} Einträge`}
          </p>
        </div>
        {canWrite && tab === 'register' && <Button onClick={openNew}><Plus size={16} />Dienstleister erfassen</Button>}
        {canWrite && tab === 'tests' && <Button onClick={openNewTest}><Plus size={16} />Test erfassen</Button>}
      </div>

      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar scroll-smooth">
          {([
            { key: 'register' as const, label: 'Drittparteien', icon: Zap },
            { key: 'tests' as const, label: 'Resilienztests', icon: FlaskConical },
          ]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === key ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 hover:border-gray-300'
              }`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'register' && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Gesamt', value: stats.total, color: 'bg-blue-500' },
          { label: 'Kritisch', value: stats.critical, color: 'bg-red-500' },
          { label: 'Review fällig', value: stats.reviewDue, color: 'bg-orange-500' },
          { label: 'Aktive Verträge', value: stats.active, color: 'bg-green-600' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <Zap className="text-white" size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Dienstleister, IKT-Service oder Land suchen..."
        activeCount={[critFilter, statusFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setCritFilter(''); setStatusFilter(''); }}
      >
        <Select
          className="w-52"
          value={critFilter}
          onChange={e => setCritFilter(e.target.value)}
          options={[{ value: '', label: 'Alle Kritikalitäten' }, ...Object.entries(criticalityLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
        <Select
          className="w-40"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          options={[{ value: '', label: 'Alle Status' }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]}
        />
      </FilterBar>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead>
              <tr>
                <Th>Dienstleister</Th>
                <Th>IKT-Service</Th>
                <Th>Kritikalität</Th>
                <Th>Status</Th>
                <Th>Land</Th>
                <Th>Nächste Prüfung</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {filtered.map(i => (
                <tr
                  key={i.id}
                  className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => openEdit(i)}
                >
                  <Td>
                    <p className="font-medium dark:text-slate-200">{i.name}</p>
                    {i.contact_name && <p className="text-[11px] text-gray-400">{i.contact_name}</p>}
                  </Td>
                  <Td className="text-gray-600 dark:text-slate-300">{i.ict_service}</Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${criticalityColors[i.criticality]}`}>
                      {criticalityLabels[i.criticality]}
                    </span>
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[i.status]}`}>
                      {statusLabels[i.status]}
                    </span>
                  </Td>
                  <Td className="text-gray-500">{i.country || '–'}</Td>
                  <Td>
                    {i.next_review_date ? (
                      <span className={`text-xs flex items-center gap-1 ${isReviewDue(i) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                        <CalendarCheck size={11} />
                        {format(new Date(i.next_review_date), 'dd.MM.yyyy')}
                        {isReviewDue(i) && ' ⚠'}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </Td>
                  <Td>
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {canWrite && (
                        <>
                          <button
                            onClick={() => openEdit(i)}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {(user?.role === 'admin' || user?.role === 'assessor') && (
                            <button
                              onClick={() => remove(i)}
                              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="py-16 text-center">
                      <Zap size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                      <p className="text-gray-500 dark:text-slate-400 font-medium">Keine IKT-Drittdienstleister gefunden</p>
                      {canWrite && (
                        <button
                          onClick={openNew}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> Dienstleister erfassen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
      </>)}

      {tab === 'tests' && (<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Tests gesamt', value: testStats.total, color: 'bg-blue-500' },
          { label: 'Geplant', value: testStats.planned, color: 'bg-gray-500' },
          { label: 'Abgeschlossen', value: testStats.completed, color: 'bg-green-600' },
          { label: 'Nicht bestanden', value: testStats.failed, color: 'bg-red-500' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}>
                <FlaskConical className="text-white" size={18} />
              </div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="p-0 text-sm">
          <Table>
            <Thead>
              <tr>
                <Th>Titel</Th>
                <Th>Testart</Th>
                <Th>Datum</Th>
                <Th>Durchgeführt von</Th>
                <Th>Status</Th>
                <Th>Ergebnis</Th>
                <Th>Nächster Test</Th>
                <Th>{''}</Th>
              </tr>
            </Thead>
            <Tbody>
              {tests.map(t => (
                <tr
                  key={t.id}
                  className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer"
                  onClick={() => openEditTest(t)}
                >
                  <Td>
                    <p className="font-medium dark:text-slate-200">{t.title}</p>
                  </Td>
                  <Td className="text-gray-600 dark:text-slate-300">{testTypeLabels[t.test_type]}</Td>
                  <Td className="text-gray-500">
                    {t.test_date ? format(new Date(t.test_date), 'dd.MM.yyyy') : '–'}
                  </Td>
                  <Td className="text-gray-500">{t.performed_by || '–'}</Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${testStatusColors[t.status]}`}>
                      {testStatusLabels[t.status]}
                    </span>
                  </Td>
                  <Td>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${testResultColors[t.result]}`}>
                      {testResultLabels[t.result]}
                    </span>
                  </Td>
                  <Td>
                    {t.next_test_date ? (
                      <span className={`text-xs flex items-center gap-1 ${isNextTestOverdue(t) ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500'}`}>
                        <CalendarCheck size={11} />
                        {format(new Date(t.next_test_date), 'dd.MM.yyyy')}
                        {isNextTestOverdue(t) && ' ⚠'}
                      </span>
                    ) : <span className="text-gray-300">–</span>}
                  </Td>
                  <Td>
                    <div className="flex gap-2 justify-end" onClick={e => e.stopPropagation()}>
                      {canWrite && (
                        <>
                          <button
                            onClick={() => openEditTest(t)}
                            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {canDelete && (
                            <button
                              onClick={() => removeTest(t)}
                              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
              {tests.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="py-16 text-center">
                      <FlaskConical size={40} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" />
                      <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Resilienztests gefunden</p>
                      {canWrite && (
                        <button
                          onClick={openNewTest}
                          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Plus size={15} /> Test erfassen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
      </>)}

      <Modal
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
        title={testEditId ? 'Resilienztest bearbeiten' : 'Resilienztest erfassen'}
        size="lg"
      >
        <form onSubmit={saveTest} className="space-y-4">
          <Input
            label="Titel *"
            value={testForm.title}
            onChange={e => setTestForm({ ...testForm, title: e.target.value })}
            required
            placeholder="z. B. Jährlicher Penetrationstest Kernbanksystem"
            disabled={!canWrite}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Testart"
              value={testForm.test_type}
              onChange={e => setTestForm({ ...testForm, test_type: e.target.value as DoraTestType })}
              options={Object.entries(testTypeLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Input
              label="Testdatum"
              type="date"
              value={testForm.test_date}
              onChange={e => setTestForm({ ...testForm, test_date: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Durchgeführt von"
              value={testForm.performed_by}
              onChange={e => setTestForm({ ...testForm, performed_by: e.target.value })}
              placeholder="z. B. externer Dienstleister, internes Team"
              disabled={!canWrite}
            />
            <Select
              label="Status"
              value={testForm.status}
              onChange={e => setTestForm({ ...testForm, status: e.target.value as DoraTestStatus })}
              options={Object.entries(testStatusLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label="Ergebnis"
              value={testForm.result}
              onChange={e => setTestForm({ ...testForm, result: e.target.value as DoraTestResult })}
              options={Object.entries(testResultLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Findings</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={testForm.findings}
              onChange={e => setTestForm({ ...testForm, findings: e.target.value })}
              placeholder="Festgestellte Schwachstellen und Auffälligkeiten"
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Behebungsmaßnahmen</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={testForm.remediation}
              onChange={e => setTestForm({ ...testForm, remediation: e.target.value })}
              placeholder="Geplante bzw. umgesetzte Maßnahmen zur Behebung"
              disabled={!canWrite}
            />
          </div>
          <Input
            label="Nächster Test"
            type="date"
            value={testForm.next_test_date}
            onChange={e => setTestForm({ ...testForm, next_test_date: e.target.value })}
            disabled={!canWrite}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notizen</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={testForm.notes}
              onChange={e => setTestForm({ ...testForm, notes: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setTestModalOpen(false)} className="flex-1 justify-center">
              Abbrechen
            </Button>
            {canWrite && (
              <Button type="submit" disabled={testSaving} className="flex-1 justify-center">
                {testSaving ? 'Speichern...' : (testEditId ? 'Aktualisieren' : 'Anlegen')}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'IKT-Drittdienstleister bearbeiten' : 'IKT-Drittdienstleister erfassen'}
        size="lg"
      >
        <form onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Dienstleistername *"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              placeholder="z. B. Microsoft Azure"
              disabled={!canWrite}
            />
            <Input
              label="IKT-Service / Leistungsbeschreibung *"
              value={form.ict_service}
              onChange={e => setForm({ ...form, ict_service: e.target.value })}
              required
              placeholder="z. B. Cloud-Infrastruktur, SaaS-Plattform"
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Kritikalität (DORA)"
              value={form.criticality}
              onChange={e => setForm({ ...form, criticality: e.target.value as DoraCriticality })}
              options={Object.entries(criticalityLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={e => setForm({ ...form, status: e.target.value as DoraStatus })}
              options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Vertragsbeginn"
              type="date"
              value={form.contract_start}
              onChange={e => setForm({ ...form, contract_start: e.target.value })}
              disabled={!canWrite}
            />
            <Input
              label="Vertragsende"
              type="date"
              value={form.contract_end}
              onChange={e => setForm({ ...form, contract_end: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label="Land"
              value={form.country}
              onChange={e => setForm({ ...form, country: e.target.value })}
              placeholder="z. B. Deutschland, USA"
              disabled={!canWrite}
            />
            <Input
              label="SLA RTO (Stunden)"
              type="number"
              min={0}
              value={form.sla_rto_hours}
              onChange={e => setForm({ ...form, sla_rto_hours: e.target.value })}
              placeholder="z. B. 4"
              disabled={!canWrite}
            />
            <Input
              label="SLA RPO (Stunden)"
              type="number"
              min={0}
              value={form.sla_rpo_hours}
              onChange={e => setForm({ ...form, sla_rpo_hours: e.target.value })}
              placeholder="z. B. 1"
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Ansprechpartner (Name)"
              value={form.contact_name}
              onChange={e => setForm({ ...form, contact_name: e.target.value })}
              placeholder="Vollständiger Name"
              disabled={!canWrite}
            />
            <Input
              label="Ansprechpartner (E-Mail)"
              type="email"
              value={form.contact_email}
              onChange={e => setForm({ ...form, contact_email: e.target.value })}
              placeholder="kontakt@example.com"
              disabled={!canWrite}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Letzte Prüfung"
              type="date"
              value={form.last_review_date}
              onChange={e => setForm({ ...form, last_review_date: e.target.value })}
              disabled={!canWrite}
            />
            <Input
              label="Nächste Prüfung"
              type="date"
              value={form.next_review_date}
              onChange={e => setForm({ ...form, next_review_date: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notizen</label>
            <textarea
              className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              rows={2}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              disabled={!canWrite}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">
              Abbrechen
            </Button>
            {canWrite && (
              <Button type="submit" disabled={saving} className="flex-1 justify-center">
                {saving ? 'Speichern...' : (editId ? 'Aktualisieren' : 'Anlegen')}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </div>
  );
};
