import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle, AlertTriangle, ChevronRight, Shield, FileWarning, Lock, Server, UserCheck, GitMerge,
  Plus, Trash2, Calendar, TrendingUp, Gauge, ClipboardCheck, Activity, Award, FileText, Pencil, ExternalLink, Paperclip, Download
} from 'lucide-react';
import api from '../lib/api';
import type { User, Task, Classification, RiskLevel, DsgvoGap, ComplianceStats } from '../types';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton, SkeletonStatCard, SkeletonCard } from '../components/ui/Skeleton';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { useModules } from '../contexts/ModulesContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';
import { CrossFrameworkOverview } from '../components/ControlMappings';

const riskLabels: Record<RiskLevel, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
const classLabels: Record<Classification, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };
const vvtLabels: Record<string, string> = { none: 'Nicht verzeichnet', pending: 'In Arbeit', complete: 'Vollständig' };
const dataCatLabels: Record<string, string> = { none: 'Keine PD', normal: 'Normal (Art. 6)', special: 'Besonders (Art. 9)' };

type TopTab = 'frameworks' | 'kpis' | 'audits' | 'trainings';
type FrameworkTab = 'iso27001' | 'nis2' | 'gdpr' | 'mappings';

interface KPI {
  id: number;
  title: string;
  description: string;
  target: string;
  current_value: string;
  status: 'on_target' | 'warning' | 'critical';
  owner_id?: number | null;
  owner?: { id: number; name: string };
  measurements?: KPIMeasurement[];
}

interface KPIMeasurement {
  id: number;
  kpi_id: number;
  measured_at: string;
  value: string;
  notes?: string;
}

interface Audit {
  id: number;
  title: string;
  scope: string;
  audit_type: 'internal' | 'external' | 'certification';
  status: 'planned' | 'in_progress' | 'completed';
  auditor: string;
  start_date: string;
  end_date: string;
  report_link?: string;
  notes?: string;
  findings?: AuditFinding[];
}

interface AuditFinding {
  id: number;
  audit_id: number;
  title: string;
  description: string;
  severity: 'minor' | 'major' | 'observation';
  status: 'open' | 'resolved' | 'wont_fix';
  capa_task_id?: number | null;
  capaTask?: Task | null;
  assignee_id?: number | null;
  assignee?: { id: number; name: string };
}

interface UserTraining {
  id: number;
  user_id: number | null;
  user?: { id: number; name: string; department?: string };
  training_title: string;
  completed_at: string | null;
  expires_at?: string;
  certificate_url?: string;
  status: 'valid' | 'expired' | 'warning';
  employee_name?: string | null;
  employee_email?: string | null;
  contested?: boolean;
  contestation_comment?: string | null;
}

export const Compliance: React.FC = () => {
  const { isEnabled } = useModules();
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = hasWriteAccess(user?.role);

  const [activeTab, setActiveTab] = useState<TopTab>('frameworks');

  const availableFwTabs = useMemo(() => {
    const tabs: FrameworkTab[] = [];
    if (isEnabled('iso27001')) tabs.push('iso27001');
    if (isEnabled('nis2')) tabs.push('nis2');
    if (isEnabled('dsgvo')) tabs.push('gdpr');
    
    const activeFrameworks = [isEnabled('iso27001'), isEnabled('nis2'), isEnabled('bsi_grundschutz'), isEnabled('c5')].filter(Boolean).length;
    if (isEnabled('iso27001') && activeFrameworks >= 2) tabs.push('mappings');
    
    return tabs;
  }, [isEnabled]);

  const [activeFw, setActiveFw] = useState<FrameworkTab>('iso27001');

  useEffect(() => {
    if (availableFwTabs.length > 0 && !availableFwTabs.includes(activeFw)) {
      setActiveFw(availableFwTabs[0]);
    }
  }, [availableFwTabs, activeFw]);

  // Stats & Core data
  const [stats, setStats] = useState<ComplianceStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Users & Tasks for dropdowns
  const [users, setUsers] = useState<User[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Roadmap Sub-module states
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [trainings, setTrainings] = useState<UserTraining[]>([]);

  // Modals & Forms states
  const [kpiModal, setKpiModal] = useState(false);
  const [kpiForm, setKpiForm] = useState({ title: '', description: '', target: '', status: 'on_target', owner_id: '' });
  const [measureModal, setMeasureModal] = useState<number | null>(null);
  const [measureForm, setMeasureForm] = useState({ value: '', measured_at: new Date().toISOString().slice(0, 10), notes: '' });

  const [auditModal, setAuditModal] = useState(false);
  const [auditForm, setAuditForm] = useState({ title: '', scope: '', audit_type: 'internal', status: 'planned', auditor: '', start_date: '', end_date: '', report_link: '', notes: '' });
  const [findingModal, setFindingModal] = useState<number | null>(null);
  const [findingForm, setFindingForm] = useState({ title: '', description: '', severity: 'observation', status: 'open', capa_task_id: '', assignee_id: '' });

  const [trainingModal, setTrainingModal] = useState(false);
  const [trainingForm, setTrainingForm] = useState({
    user_ids: [] as number[],
    training_title: '',
    completed_at: '',
    expires_at: '',
    certificate_url: '',
    file: null as File | null
  });
  const [editTrainingId, setEditTrainingId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState('');

  // Master Training states
  const [trainingsList, setTrainingsList] = useState<any[]>([]);
  const [selectedTrainingId, setSelectedTrainingId] = useState<number | null>(null);

  // Modal 1: Master Training Course (Create/Edit)
  const [masterTrainingModal, setMasterTrainingModal] = useState(false);
  const [editMasterTrainingId, setEditMasterTrainingId] = useState<number | null>(null);
  const [masterTrainingForm, setMasterTrainingForm] = useState({
    title: '',
    description: '',
    date: '',
    mandatory: false
  });

  // Modal 2: Assign users to selected training
  const [assignModal, setAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({
    user_ids: [] as number[],
    file: null as File | null,
    mark_completed: false,
    completed_at: '',
    expires_at: '',
    certificate_url: ''
  });

  // Modal 3: Edit assignment / Record completion
  const [editAssignmentModal, setEditAssignmentModal] = useState(false);
  const [editAssignmentId, setEditAssignmentId] = useState<number | null>(null);
  const [editAssignmentForm, setEditAssignmentForm] = useState({
    completed_at: '',
    expires_at: '',
    certificate_url: ''
  });

  // Document Library State (for Audits)
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [selectedAuditForDocs, setSelectedAuditForDocs] = useState<Audit | null>(null);
  const [auditDocs, setAuditDocs] = useState<any[]>([]);
  const [docForm, setDocForm] = useState({ category: 'audit_report', description: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const loadDocs = (id: number) => {
    api.get(`/compliance/audits/${id}/documents`)
      .then(r => setAuditDocs(r.data))
      .catch(() => setAuditDocs([]));
  };

  const openDocs = (a: Audit) => {
    setSelectedAuditForDocs(a);
    setDocForm({ category: 'audit_report', description: '' });
    setDocFile(null);
    setAuditDocs([]);
    setDocsModalOpen(true);
    loadDocs(a.id);
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAuditForDocs || !docFile) return;
    setUploadingDoc(true);
    const formData = new FormData();
    formData.append('file', docFile);
    formData.append('category', docForm.category);
    formData.append('description', docForm.description);

    try {
      await api.post(`/compliance/audits/${selectedAuditForDocs.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('Dokument erfolgreich hochgeladen');
      setDocFile(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadDocs(selectedAuditForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Hochladen des Dokuments');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDocDelete = async (docId: number) => {
    if (!selectedAuditForDocs || !confirm('Dokument wirklich löschen?')) return;
    try {
      await api.delete(`/compliance/audits/${selectedAuditForDocs.id}/documents/${docId}`);
      toast.success('Dokument gelöscht');
      loadDocs(selectedAuditForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen des Dokuments');
    }
  };

  const loadStats = () => {
    setLoading(true);
    api.get('/compliance/stats')
      .then(r => setStats(r.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  };

  const loadKpis = () => {
    api.get('/compliance/kpis').then(r => setKpis(r.data)).catch(() => {});
  };

  const loadAudits = () => {
    api.get('/compliance/audits').then(r => setAudits(r.data)).catch(() => {});
  };

  const loadTrainings = () => {
    api.get('/compliance/trainings-list').then(r => {
      setTrainingsList(r.data);
      // Auto-select first training if none selected and catalog not empty
      if (r.data.length > 0 && selectedTrainingId === null) {
        setSelectedTrainingId(r.data[0].id);
      }
    }).catch(() => {});
    api.get('/compliance/trainings').then(r => setTrainings(r.data)).catch(() => {});
  };

  useEffect(() => {
    loadStats();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
    api.get('/tasks').then(r => setTasks(r.data)).catch(() => {});
  }, []);

  // Load a tab's data the first time it's opened only — switching back to an
  // already-visited tab shows the data already in state instead of refetching.
  // Mutations call loadKpis/loadAudits/loadTrainings directly, so writes always
  // pull fresh data regardless of this guard.
  const loadedTabs = useRef<Set<TopTab>>(new Set());
  useEffect(() => {
    if (loadedTabs.current.has(activeTab)) return;
    if (activeTab === 'kpis') { loadedTabs.current.add('kpis'); loadKpis(); }
    if (activeTab === 'audits') { loadedTabs.current.add('audits'); loadAudits(); }
    if (activeTab === 'trainings') { loadedTabs.current.add('trainings'); loadTrainings(); }
  }, [activeTab]);

  // KPI Actions
  const handleCreateKpi = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...kpiForm, owner_id: kpiForm.owner_id ? Number(kpiForm.owner_id) : null };
      await api.post('/compliance/kpis', payload);
      setKpiModal(false);
      setKpiForm({ title: '', description: '', target: '', status: 'on_target', owner_id: '' });
      loadKpis();
      toast.success('KPI erfolgreich erstellt');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Erstellen des KPIs');
    }
  };

  const handleDeleteKpi = async (id: number) => {
    if (!confirm('KPI wirklich löschen?')) return;
    try {
      await api.delete(`/compliance/kpis/${id}`);
      loadKpis();
      toast.success('KPI gelöscht');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  const handleAddMeasurement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!measureModal) return;
    try {
      await api.post(`/compliance/kpis/${measureModal}/measurements`, measureForm);
      setMeasureModal(null);
      setMeasureForm({ value: '', measured_at: new Date().toISOString().slice(0, 10), notes: '' });
      loadKpis();
      toast.success('Messwert hinzugefügt');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  // Audit Actions
  const handleCreateAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/compliance/audits', auditForm);
      setAuditModal(false);
      setAuditForm({ title: '', scope: '', audit_type: 'internal', status: 'planned', auditor: '', start_date: '', end_date: '', report_link: '', notes: '' });
      loadAudits();
      toast.success('Audit erfolgreich angelegt');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const handleDeleteAudit = async (id: number) => {
    if (!confirm('Audit wirklich löschen?')) return;
    try {
      await api.delete(`/compliance/audits/${id}`);
      loadAudits();
      toast.success('Audit gelöscht');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const handleAddFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!findingModal) return;
    try {
      const payload = {
        ...findingForm,
        capa_task_id: findingForm.capa_task_id ? Number(findingForm.capa_task_id) : null,
        assignee_id: findingForm.assignee_id ? Number(findingForm.assignee_id) : null
      };
      await api.post(`/compliance/audits/${findingModal}/findings`, payload);
      setFindingModal(null);
      setFindingForm({ title: '', description: '', severity: 'observation', status: 'open', capa_task_id: '', assignee_id: '' });
      loadAudits();
      toast.success('Abweichung (Finding) erfasst');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  const handleUpdateFindingStatus = async (id: number, status: 'open' | 'resolved' | 'wont_fix') => {
    try {
      await api.put(`/compliance/findings/${id}`, { status });
      loadAudits();
      toast.success('Finding-Status aktualisiert');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  // Training Actions
  const openNewTraining = () => {
    setEditTrainingId(null);
    setTrainingForm({ user_ids: [], training_title: '', completed_at: '', expires_at: '', certificate_url: '', file: null });
    setUserSearch('');
    setTrainingModal(true);
  };

  const openEditTraining = (t: UserTraining) => {
    setEditTrainingId(t.id);
    setTrainingForm({
      user_ids: t.user_id ? [t.user_id] : [],
      training_title: t.training_title,
      completed_at: t.completed_at || '',
      expires_at: t.expires_at || '',
      certificate_url: t.certificate_url || '',
      file: null
    });
    setUserSearch('');
    setTrainingModal(true);
  };

  const handleRecordTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editTrainingId) {
        const payload = {
          user_id: trainingForm.user_ids[0],
          training_title: trainingForm.training_title,
          completed_at: trainingForm.completed_at,
          expires_at: trainingForm.expires_at || null,
          certificate_url: trainingForm.certificate_url || null
        };
        await api.put(`/compliance/trainings/${editTrainingId}`, payload);
        toast.success('Schulungsnachweis aktualisiert');
      } else {
        const fd = new FormData();
        fd.append('training_title', trainingForm.training_title);
        fd.append('completed_at', trainingForm.completed_at);
        if (trainingForm.expires_at) fd.append('expires_at', trainingForm.expires_at);
        if (trainingForm.certificate_url) fd.append('certificate_url', trainingForm.certificate_url);
        fd.append('user_ids', JSON.stringify(trainingForm.user_ids));
        if (trainingForm.file) {
          fd.append('file', trainingForm.file);
        }
        await api.post('/compliance/trainings/bulk', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success('Schulungsnachweis(e) eingetragen');
      }
      setTrainingModal(false);
      setTrainingForm({ user_ids: [], training_title: '', completed_at: '', expires_at: '', certificate_url: '', file: null });
      loadTrainings();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Eintragen der Schulung');
    }
  };

  const handleDeleteTraining = async (id: number) => {
    if (!confirm('Schulungsnachweis wirklich löschen?')) return;
    try {
      await api.delete(`/compliance/trainings/${id}`);
      loadTrainings();
      toast.success('Eintrag gelöscht');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler');
    }
  };

  // Master Training Actions
  const openNewMasterTraining = () => {
    setEditMasterTrainingId(null);
    setMasterTrainingForm({ title: '', description: '', date: new Date().toISOString().slice(0,10), mandatory: false });
    setMasterTrainingModal(true);
  };

  const openEditMasterTraining = (course: any) => {
    setEditMasterTrainingId(course.id);
    setMasterTrainingForm({
      title: course.title,
      description: course.description || '',
      date: course.date,
      mandatory: !!course.mandatory
    });
    setMasterTrainingModal(true);
  };

  const handleSaveMasterTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        title: masterTrainingForm.title,
        description: masterTrainingForm.description || null,
        date: masterTrainingForm.date,
        mandatory: masterTrainingForm.mandatory
      };
      if (editMasterTrainingId) {
        await api.put(`/compliance/trainings-list/${editMasterTrainingId}`, payload);
        toast.success('Schulungskatalog aktualisiert');
      } else {
        await api.post('/compliance/trainings-list', payload);
        toast.success('Schulungskurs hinzugefügt');
      }
      setMasterTrainingModal(false);
      loadTrainings();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const handleDeleteMasterTraining = async (id: number) => {
    if (!confirm('Möchten Sie diesen Schulungskurs und alle zugehörigen Mitarbeiter-Zuweisungen wirklich löschen?')) return;
    try {
      await api.delete(`/compliance/trainings-list/${id}`);
      if (selectedTrainingId === id) setSelectedTrainingId(null);
      loadTrainings();
      toast.success('Schulung gelöscht');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  // User Assignment Actions
  const openAssignModal = () => {
    setAssignForm({
      user_ids: [],
      file: null,
      mark_completed: false,
      completed_at: new Date().toISOString().slice(0, 10),
      expires_at: '',
      certificate_url: ''
    });
    setUserSearch('');
    setAssignModal(true);
  };

  const handleAssignUsers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrainingId) return;
    try {
      const fd = new FormData();
      fd.append('training_id', String(selectedTrainingId));
      fd.append('user_ids', JSON.stringify(assignForm.user_ids));
      fd.append('mark_completed', String(assignForm.mark_completed));
      if (assignForm.mark_completed) {
        fd.append('completed_at', assignForm.completed_at);
        if (assignForm.expires_at) fd.append('expires_at', assignForm.expires_at);
        if (assignForm.certificate_url) fd.append('certificate_url', assignForm.certificate_url);
      }
      if (assignForm.file) {
        fd.append('file', assignForm.file);
      }

      await api.post('/compliance/trainings/bulk', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('Teilnehmer zugewiesen');
      setAssignModal(false);
      loadTrainings();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Zuweisen');
    }
  };

  // Edit Single Assignment / Record Completion Actions
  const openEditAssignment = (assignment: any) => {
    setEditAssignmentId(assignment.id);
    setEditAssignmentForm({
      completed_at: assignment.completed_at || new Date().toISOString().slice(0, 10),
      expires_at: assignment.expires_at || '',
      certificate_url: assignment.certificate_url || ''
    });
    setEditAssignmentModal(true);
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAssignmentId) return;
    try {
      const payload = {
        completed_at: editAssignmentForm.completed_at || null,
        expires_at: editAssignmentForm.expires_at || null,
        certificate_url: editAssignmentForm.certificate_url || null
      };
      await api.put(`/compliance/trainings/${editAssignmentId}`, payload);
      toast.success('Teilnehmerstatus aktualisiert');
      setEditAssignmentModal(false);
      loadTrainings();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const handleDeleteAssignment = async (id: number) => {
    if (!confirm('Zuweisung für diesen Mitarbeiter wirklich löschen?')) return;
    try {
      await api.delete(`/compliance/trainings/${id}`);
      loadTrainings();
      toast.success('Zuweisung entfernt');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Entfernen');
    }
  };

  if (loading) return (
    <div className="space-y-6" role="status" aria-label="Compliance wird geladen">
      <div><Skeleton className="h-7 w-56 mb-1" /><Skeleton className="h-4 w-80" /></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonStatCard key={i} />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} lines={5} />)}
      </div>
    </div>
  );

  if (!stats) return (
    <div className="p-6 text-gray-500 flex flex-col items-center gap-3 py-20">
      <p>Fehler beim Laden der Compliance-Daten.</p>
      <button onClick={loadStats} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Erneut versuchen</button>
    </div>
  );

  const gaps = stats.dsgvoGaps ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Compliance, KPIs & Audits</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">Normenabdeckung, kontinuierliche Verbesserung und Schulungsnachweise</p>
        </div>
      </div>

      {/* Top-Level Tabs Switcher */}
      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar">
          {[
            { key: 'frameworks' as TopTab, label: 'Normen-Scope (ISO/NIS2/GDPR)', icon: Shield },
            { key: 'kpis' as TopTab, label: 'KPIs & Wirksamkeit', icon: TrendingUp },
            { key: 'audits' as TopTab, label: 'Audit & CAPA Module', icon: ClipboardCheck },
            { key: 'trainings' as TopTab, label: 'Schulungsmatrix', icon: Award },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-all ${
                activeTab === key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 font-bold'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 hover:border-gray-300'
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── TAB 1: FRAMEWORKS (Normen-Scope) ────────────────────────── */}
      {activeTab === 'frameworks' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="hover:shadow-md transition-shadow">
              <CardBody className="flex items-center gap-4 p-6">
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl"><Shield size={24} /></div>
                <div><p className="text-3xl font-extrabold text-gray-900 dark:text-white leading-none">{stats.total}</p><p className="text-xs text-gray-500 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold">Assets im ISMS-Scope</p></div>
              </CardBody>
            </Card>
            <Card className="hover:shadow-md transition-shadow">
              <CardBody className="flex items-center gap-4 p-6">
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded-2xl"><AlertTriangle size={24} /></div>
                <div><p className="text-3xl font-extrabold text-gray-900 dark:text-white leading-none">{stats.highRisk}</p><p className="text-xs text-gray-500 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold">Hochrisiko-Assets</p></div>
              </CardBody>
            </Card>
            <Card className="hover:shadow-md transition-shadow">
              <CardBody className="flex items-center gap-4 p-6">
                <div className={`p-3 rounded-2xl ${gaps.length > 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'}`}>{gaps.length > 0 ? <FileWarning size={24} /> : <CheckCircle size={24} />}</div>
                <div><p className="text-3xl font-extrabold text-gray-900 dark:text-white leading-none">{gaps.length}</p><p className="text-xs text-gray-500 dark:text-slate-400 mt-2 uppercase tracking-wider font-semibold">DSGVO-Lücken (VVT fehlt)</p></div>
              </CardBody>
            </Card>
          </div>

          {availableFwTabs.length > 1 && (
            <div className="flex flex-wrap gap-2 p-1.5 bg-gray-100/80 dark:bg-slate-800/40 rounded-2xl max-w-xl">
              {availableFwTabs.map(fw => {
                const label = fw === 'iso27001' ? 'ISO 27001' : fw === 'nis2' ? 'NIS-2' : fw === 'mappings' ? 'Querverweise' : 'DSGVO (GDPR)';
                const icon = fw === 'iso27001' ? <Lock size={15} /> : fw === 'nis2' ? <Server size={15} /> : fw === 'mappings' ? <GitMerge size={15} /> : <UserCheck size={15} />;
                return (
                  <button key={fw} onClick={() => setActiveFw(fw)}
                    className={`flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-xl transition-all ${
                      activeFw === fw ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 hover:text-gray-950 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}>{icon}{label}</button>
                );
              })}
            </div>
          )}

          {activeFw === 'mappings' && <CrossFrameworkOverview source="iso27001" />}

          {activeFw === 'iso27001' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader><div className="flex items-center gap-2"><Lock size={16} className="text-blue-500" /><h2 className="font-bold dark:text-white">ISO 27001 Assets ({stats.frameworks.iso27001.count})</h2></div></CardHeader>
                  <CardBody className="p-0">
                    {stats.frameworks.iso27001.assets.length > 0 ? (
                      <Table>
                        <Thead><tr><Th>Asset Name</Th><Th>Typ</Th><Th>Klassifizierung</Th><Th>Risiko</Th><Th className="text-right">Aktionen</Th></tr></Thead>
                        <Tbody>
                          {stats.frameworks.iso27001.assets.map((asset: any) => (
                            <tr key={asset.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                              <Td className="font-semibold text-gray-900 dark:text-slate-100">{asset.name}</Td>
                              <Td><span className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 px-2 py-0.5 rounded uppercase font-medium">{asset.type}</span></Td>
                              <Td><span className="text-xs text-gray-500 dark:text-slate-400">{asset.classification ? (classLabels[asset.classification as keyof typeof classLabels] || asset.classification) : '—'}</span></Td>
                              <Td>{asset.risk_level ? <Badge value={asset.risk_level} label={riskLabels[asset.risk_level as keyof typeof riskLabels]} /> : <span className="text-xs italic text-gray-400">Unbewertet</span>}</Td>
                              <Td className="text-right"><Link to={`/assets/${asset.id}`} className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 text-xs font-semibold">Details <ChevronRight size={12} /></Link></Td>
                            </tr>
                          ))}
                        </Tbody>
                      </Table>
                    ) : <div className="p-8 text-center text-gray-400 italic">Keine Assets im Scope gefunden.</div>}
                  </CardBody>
                </Card>
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader><h2 className="font-bold text-gray-950 dark:text-white">Framework Info</h2></CardHeader>
                  <CardBody className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">Der Standard <strong>ISO/IEC 27001</strong> definiert die Kriterien für ein robustes Informationssicherheits-Managementsystem (ISMS).</p>
                    <p className="text-xs text-gray-500 dark:text-slate-500 leading-relaxed">Alle aktiven Assets der Organisation unterliegen Risikoanalysen und erfordern die Definition technischer und organisatorischer Maßnahmen (TOMs).</p>
                    <div className="pt-4 border-t dark:border-slate-800 space-y-2">
                      <Link to="/risks" className="w-full justify-center gap-2 flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs">Risikomanagement öffnen</Link>
                      <Link to="/controls" className="w-full justify-center gap-2 flex items-center px-4 py-2 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-xl text-xs font-bold transition-all shadow-xs">Sicherheitsmaßnahmen (TOMs)</Link>
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>
          )}

          {activeFw === 'nis2' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card>
                  <CardHeader><div className="flex items-center gap-2"><Server size={16} className="text-blue-500" /><h2 className="font-bold dark:text-white">NIS-2 Relevante Assets ({stats.frameworks.nis2.count})</h2></div></CardHeader>
                  <CardBody className="p-0">
                    {stats.frameworks.nis2.assets.length > 0 ? (
                      <Table>
                        <Thead><tr><Th>Asset Name</Th><Th>Typ</Th><Th>Klassifizierung</Th><Th>Risiko</Th><Th className="text-right">Aktionen</Th></tr></Thead>
                        <Tbody>
                          {stats.frameworks.nis2.assets.map((asset: any) => (
                            <tr key={asset.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                              <Td className="font-semibold text-gray-900 dark:text-slate-100">{asset.name}</Td>
                              <Td><span className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 px-2 py-0.5 rounded uppercase font-medium">{asset.type}</span></Td>
                              <Td><span className="text-xs text-gray-500 dark:text-slate-400">{asset.classification ? (classLabels[asset.classification as keyof typeof classLabels] || asset.classification) : '—'}</span></Td>
                              <Td>{asset.risk_level ? <Badge value={asset.risk_level} label={riskLabels[asset.risk_level as keyof typeof riskLabels]} /> : <span className="text-xs italic text-gray-400">Unbewertet</span>}</Td>
                              <Td className="text-right"><Link to={`/assets/${asset.id}`} className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 text-xs font-semibold">Details <ChevronRight size={12} /></Link></Td>
                            </tr>
                          ))}
                        </Tbody>
                      </Table>
                    ) : <div className="p-8 text-center text-gray-400 italic">Aktuell keine Assets als NIS-2 relevant gekennzeichnet.</div>}
                  </CardBody>
                </Card>
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader><h2 className="font-bold text-gray-950 dark:text-white">Framework Info</h2></CardHeader>
                  <CardBody className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">Die <strong>NIS-2-Richtlinie</strong> dient dem Aufbau eines gemeinsamen hohen Cybersicherheitsniveaus in der Europäischen Union.</p>
                    <p className="text-xs text-gray-500 dark:text-slate-500 leading-relaxed">Betreiber kritischer oder wichtiger Einrichtungen müssen angemessene und verhältnismäßige Sicherheitsvorkehrungen treffen.</p>
                    <div className="pt-4 border-t dark:border-slate-800 space-y-2">
                      <Link to="/incidents" className="w-full justify-center gap-2 flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs">Sicherheitsvorfälle verwalten</Link>
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>
          )}

          {activeFw === 'gdpr' && (
            <div className="space-y-6">
              {gaps.length > 0 ? (
                <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl flex items-start gap-3">
                  <FileWarning className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" size={20} />
                  <div>
                    <h3 className="font-bold text-red-800 dark:text-red-400 text-sm">VVT-Pflichtverletzung: {gaps.length} Lücke(n) erkannt</h3>
                    <p className="text-xs text-red-700 dark:text-red-400/80 mt-1">Die unten aufgeführten Assets verarbeiten personenbezogene Daten, besitzen aber noch keinen vollständigen VVT-Eintrag. Ein solcher ist rechtlich zwingend erforderlich.</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/30 rounded-xl flex items-center gap-3">
                  <CheckCircle className="text-green-600 dark:text-green-400 shrink-0" size={20} />
                  <p className="text-sm text-green-700 dark:text-green-400 font-medium">Alle Assets mit Personenbezug besitzen einen vollständigen VVT-Eintrag. Keine DSGVO-Lücken festgestellt.</p>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <Card>
                    <CardHeader><div className="flex items-center gap-2"><UserCheck size={16} className="text-blue-500" /><h2 className="font-bold dark:text-white">Assets mit Personenbezug ({stats.frameworks.gdpr.count})</h2></div></CardHeader>
                    <CardBody className="p-0">
                      {stats.frameworks.gdpr.assets.length > 0 ? (
                        <Table>
                          <Thead><tr><Th>Asset Name</Th><Th>Typ</Th><Th>Personenbezug</Th><Th>VVT Status</Th><Th className="text-right">Aktionen</Th></tr></Thead>
                          <Tbody>
                            {stats.frameworks.gdpr.assets.map((asset: any) => {
                              const gapEntry = gaps.find((g: any) => g.id === asset.id);
                              return (
                                <tr key={asset.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                                  <Td className="font-semibold text-gray-900 dark:text-slate-100">{asset.name}</Td>
                                  <Td><span className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 px-2 py-0.5 rounded uppercase font-medium">{asset.type}</span></Td>
                                  <Td><span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">{gapEntry ? dataCatLabels[gapEntry.data_category as keyof typeof dataCatLabels] : 'Ja'}</span></Td>
                                  <Td><span className={`text-xs font-semibold px-2 py-0.5 rounded ${gapEntry ? gapEntry.vvt_status === 'none' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>{gapEntry ? vvtLabels[gapEntry.vvt_status as keyof typeof vvtLabels] : 'Vollständig'}</span></Td>
                                  <Td className="text-right"><Link to={`/assets/${asset.id}`} className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 text-xs font-semibold">Details <ChevronRight size={12} /></Link></Td>
                                </tr>
                              );
                            })}
                          </Tbody>
                        </Table>
                      ) : <div className="p-8 text-center text-gray-400 italic">Keine Assets mit Personenbezug gefunden.</div>}
                    </CardBody>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card>
                    <CardHeader><h2 className="font-bold text-gray-950 dark:text-white">Framework Info</h2></CardHeader>
                    <CardBody className="space-y-4">
                      <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">Die <strong>Datenschutz-Grundverordnung (DSGVO)</strong> regelt den Schutz personenbezogener Daten.</p>
                      <p className="text-xs text-gray-500 dark:text-slate-500 leading-relaxed">Jedes Asset mit Personenbezug muss zwingend mit einem Eintrag im Verzeichnis von Verarbeitungstätigkeiten (VVT) dokumentiert sein.</p>
                      <div className="pt-4 border-t dark:border-slate-800 space-y-2">
                        <Link to="/vvt" className="w-full justify-center gap-2 flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs">Verzeichnis (VVT) verwalten</Link>
                      </div>
                    </CardBody>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: KPIS & EFFECTIVENESS (ISO 27001 Ch. 9.1) ────────── */}
      {activeTab === 'kpis' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-lg dark:text-white flex items-center gap-2"><Activity size={18} className="text-blue-600" />Kennzahlen & Wirksamkeitsmessungen (KPIs)</h2>
            {canWrite && <Button onClick={() => setKpiModal(true)} size="sm"><Plus size={14} /> KPI definieren</Button>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2 bg-green-500 rounded-xl text-white"><CheckCircle size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{kpis.filter(k => k.status === 'on_target').length}</p><p className="text-xs text-gray-500">Ziel erreicht / Konform</p></div></CardBody></Card>
            <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2 bg-yellow-500 rounded-xl text-white"><AlertTriangle size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{kpis.filter(k => k.status === 'warning').length}</p><p className="text-xs text-gray-500">Warnungen</p></div></CardBody></Card>
            <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2 bg-red-600 rounded-xl text-white"><FileWarning size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{kpis.filter(k => k.status === 'critical').length}</p><p className="text-xs text-gray-500">Kritische Abweichungen</p></div></CardBody></Card>
          </div>

          <Card>
            <CardBody className="p-0">
              <Table>
                <Thead>
                  <tr>
                    <Th>Kennzahl (KPI)</Th>
                    <Th>Zielwert</Th>
                    <Th>Aktueller Wert</Th>
                    <Th>Status</Th>
                    <Th>Verantwortlich</Th>
                    <Th>Letzter Trend</Th>
                    <Th className="text-right">Aktionen</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {kpis.map(kpi => {
                    const sortedMeasurements = [...(kpi.measurements || [])].sort((a, b) => new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime());
                    return (
                      <tr key={kpi.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                        <Td>
                          <p className="font-semibold text-gray-950 dark:text-white">{kpi.title}</p>
                          <p className="text-xs text-gray-400 line-clamp-1">{kpi.description}</p>
                        </Td>
                        <Td className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{kpi.target}</Td>
                        <Td className="font-mono text-xs font-bold">{kpi.current_value || '–'}</Td>
                        <Td>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            kpi.status === 'on_target' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            kpi.status === 'warning' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>{kpi.status === 'on_target' ? 'Ziel erreicht' : kpi.status === 'warning' ? 'Warnung' : 'Kritisch'}</span>
                        </Td>
                        <Td className="text-xs text-gray-500">{kpi.owner?.name || '—'}</Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            {sortedMeasurements.length > 0 ? (
                              <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded font-mono text-gray-500">
                                {sortedMeasurements.map(m => m.value).join(' → ')}
                              </span>
                            ) : <span className="text-xs text-gray-300 italic">Keine Werte</span>}
                          </div>
                        </Td>
                        <Td className="text-right">
                          <div className="flex gap-2 justify-end">
                            {canWrite && <Button onClick={() => setMeasureModal(kpi.id)} variant="secondary" size="sm">Wert loggen</Button>}
                            {canWrite && <Button onClick={() => handleDeleteKpi(kpi.id)} variant="danger" size="sm"><Trash2 size={12} /></Button>}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {kpis.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-gray-400 italic">Bisher keine KPIs definiert. Definiere Messgrößen zur Wirksamkeitsprüfung Ihrer Controls.</td></tr>
                  )}
                </Tbody>
              </Table>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ── TAB 3: AUDITS & CAPA (Internal/External Audits) ────────── */}
      {activeTab === 'audits' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-lg dark:text-white flex items-center gap-2"><ClipboardCheck size={18} className="text-blue-600" />Audits & Korrekturmaßnahmen (CAPA)</h2>
            {canWrite && <Button onClick={() => setAuditModal(true)} size="sm"><Plus size={14} /> Audit planen</Button>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2 bg-blue-500 rounded-xl text-white"><Calendar size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{audits.length}</p><p className="text-xs text-gray-500">Audits gesamt</p></div></CardBody></Card>
            <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2 bg-red-500 rounded-xl text-white"><FileWarning size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{audits.reduce((acc, a) => acc + (a.findings?.filter(f => f.status === 'open').length || 0), 0)}</p><p className="text-xs text-gray-500">Offene Abweichungen (Findings)</p></div></CardBody></Card>
            <Card><CardBody className="flex items-center gap-3 py-4"><div className="p-2 bg-green-600 rounded-xl text-white"><CheckCircle size={18} /></div><div><p className="text-2xl font-bold dark:text-white">{audits.reduce((acc, a) => acc + (a.findings?.filter(f => f.status === 'resolved').length || 0), 0)}</p><p className="text-xs text-gray-500">Behobene Findings (CAPA)</p></div></CardBody></Card>
          </div>

          {audits.map(audit => (
            <Card key={audit.id} className="overflow-hidden">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-800/20 border-b border-gray-100 dark:border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${
                        audit.audit_type === 'certification' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                        audit.audit_type === 'external' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>{audit.audit_type === 'certification' ? 'Zertifizierung' : audit.audit_type === 'external' ? 'Externes Audit' : 'Internes Audit'}</span>
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm ${
                        audit.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        audit.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400'
                      }`}>{audit.status === 'completed' ? 'Abgeschlossen' : audit.status === 'in_progress' ? 'In Durchführung' : 'Geplant'}</span>
                    </div>
                    <h3 className="font-bold text-gray-950 dark:text-white text-base mt-1.5">{audit.title}</h3>
                    <p className="text-xs text-gray-500">Scope: {audit.scope}</p>
                  </div>
                  <div className="flex gap-2">
                    {canWrite && <Button onClick={() => setFindingModal(audit.id)} variant="secondary" size="sm"><Plus size={12} /> Finding eintragen</Button>}
                    {canWrite && (
                      <Button onClick={() => openDocs(audit)} variant="secondary" size="sm" title="Dokumente verwalten">
                        <Paperclip size={12} /> Dokumente
                      </Button>
                    )}
                    {canWrite && audit.status === 'completed' && audit.report_link && (
                      <a href={audit.report_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-xs font-bold rounded-xl hover:bg-gray-200 shadow-xs"><FileText size={12} /> Externer Bericht ↗</a>
                    )}
                    {canWrite && <Button onClick={() => handleDeleteAudit(audit.id)} variant="danger" size="sm"><Trash2 size={12} /></Button>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 mt-3 pt-3 border-t dark:border-slate-800/60 font-medium">
                  <span>Auditor: {audit.auditor || '—'}</span>
                  <span>Zeitraum: {audit.start_date ? new Date(audit.start_date).toLocaleDateString() : '—'} bis {audit.end_date ? new Date(audit.end_date).toLocaleDateString() : '—'}</span>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <Table>
                  <Thead>
                    <tr>
                      <Th className="w-1/4">Abweichung / Finding</Th>
                      <Th>Schweregrad</Th>
                      <Th>Status</Th>
                      <Th>Zugeordnete Person</Th>
                      <Th>CAPA Maßnahme (Task)</Th>
                      <Th className="text-right">Aktionen</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {(audit.findings || []).map(finding => (
                      <tr key={finding.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                        <Td>
                          <p className="font-semibold text-xs text-gray-900 dark:text-white">{finding.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-1">{finding.description}</p>
                        </Td>
                        <Td>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            finding.severity === 'major' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                            finding.severity === 'minor' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>{finding.severity === 'major' ? 'Hauptabweichung' : finding.severity === 'minor' ? 'Nebenabweichung' : 'Empfehlung'}</span>
                        </Td>
                        <Td>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            finding.status === 'resolved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                            finding.status === 'wont_fix' ? 'bg-slate-100 text-slate-500' :
                            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>{finding.status === 'resolved' ? 'Behoben' : finding.status === 'wont_fix' ? 'Ignoriert' : 'Offen'}</span>
                        </Td>
                        <Td className="text-xs text-gray-500">{finding.assignee?.name || '—'}</Td>
                        <Td>
                          {finding.capaTask ? (
                            <Link to="/tasks" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                              <ExternalLink size={11} /> {finding.capaTask.title} ({finding.capaTask.status})
                            </Link>
                          ) : <span className="text-xs text-gray-400 italic">Kein Task verknüpft</span>}
                        </Td>
                        <Td className="text-right">
                          {canWrite && finding.status === 'open' && (
                            <div className="flex gap-1 justify-end">
                              <Button onClick={() => handleUpdateFindingStatus(finding.id, 'resolved')} variant="secondary" size="sm">Als behoben markieren</Button>
                              <Button onClick={() => handleUpdateFindingStatus(finding.id, 'wont_fix')} variant="secondary" size="sm">Akzeptieren</Button>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                    {(audit.findings || []).length === 0 && (
                      <tr><td colSpan={6} className="text-center py-6 text-xs text-gray-400 italic">Keine Abweichungen für dieses Audit verzeichnet. Perfekt!</td></tr>
                    )}
                  </Tbody>
                </Table>
              </CardBody>
            </Card>
          ))}

          {audits.length === 0 && (
            <Card><CardBody className="py-12 text-center text-gray-400 italic">Keine Audits geplant. Plane interne und externe Audits zur Absicherung des Informationssicherheitsstandards.</CardBody></Card>
          )}
        </div>
      )}

      {/* ── TAB 4: SCHULUNGSMATRIX (Awareness & Trainings) ────────── */}
      {activeTab === 'trainings' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-lg dark:text-white flex items-center gap-2">
              <Award size={18} className="text-blue-600" />
              Mitarbeiter-Schulungsmatrix (Awareness & Training)
            </h2>
            {canWrite && (
              <Button onClick={openNewMasterTraining} size="sm">
                <Plus size={14} /> Schulung erstellen
              </Button>
            )}
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardBody className="flex items-center gap-3 py-4">
                <div className="p-2 bg-green-500 rounded-xl text-white">
                  <CheckCircle size={18} />
                </div>
                <div>
                  <p className="text-2xl font-bold dark:text-white">
                    {trainings.filter(t => t.completed_at !== null && t.status !== 'expired').length}
                  </p>
                  <p className="text-xs text-gray-500">Erledigte Nachweise (Aktiv)</p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex items-center gap-3 py-4">
                <div className="p-2 bg-blue-500 rounded-xl text-white">
                  <Award size={18} />
                </div>
                <div>
                  <p className="text-2xl font-bold dark:text-white">
                    {trainings.filter(t => t.completed_at === null).length}
                  </p>
                  <p className="text-xs text-gray-500">Ausstehende Zuweisungen (Pending)</p>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="flex items-center gap-3 py-4">
                <div className="p-2 bg-red-600 rounded-xl text-white">
                  <AlertTriangle size={18} />
                </div>
                <div>
                  <p className="text-2xl font-bold dark:text-white">
                    {trainings.filter(t => t.status === 'expired').length}
                  </p>
                  <p className="text-xs text-gray-500">Abgelaufene Nachweise</p>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Catalog and Mappings Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            
            {/* Left Box: Trainings Catalog (2/5 width) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex justify-between items-center px-1">
                <h3 className="font-semibold text-sm text-gray-700 dark:text-slate-300 uppercase tracking-wider">
                  Schulungskatalog
                </h3>
                <span className="text-xs text-gray-500">{trainingsList.length} Kurse</span>
              </div>
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {trainingsList.map(course => {
                  const isSelected = selectedTrainingId === course.id;
                  return (
                    <div
                      key={course.id}
                      onClick={() => setSelectedTrainingId(course.id)}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-300 dark:border-blue-800'
                          : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-slate-600'
                      }`}
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="space-y-1 min-w-0">
                          <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                            {course.title}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-slate-400 font-mono">
                            Datum: {new Date(course.date).toLocaleDateString('de')}
                          </p>
                          {course.description && (
                            <p className="text-xs text-gray-400 dark:text-slate-500 line-clamp-1">
                              {course.description}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {course.mandatory ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 uppercase tracking-wider">
                              Pflicht
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-400 uppercase tracking-wider">
                              Freiwillig
                            </span>
                          )}
                          <span className="text-[10px] text-gray-500 font-medium">
                            {course.total_completed} / {course.total_assigned} erledigt
                          </span>
                        </div>
                      </div>
                      
                      {canWrite && (
                        <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-gray-100 dark:border-slate-700/50">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditMasterTraining(course);
                            }}
                            className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Schulung bearbeiten"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMasterTraining(course.id);
                            }}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                            title="Schulung löschen"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {trainingsList.length === 0 && (
                  <div className="p-8 text-center text-gray-400 italic bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl animate-pulse">
                    Keine Schulungen im Katalog. Klicken Sie auf "Schulung erstellen", um zu beginnen.
                  </div>
                )}
              </div>
            </div>

            {/* Right Box: Mapped Attendees (3/5 width) */}
            <div className="lg:col-span-3 space-y-4">
              {selectedTrainingId ? (() => {
                const selectedCourse = trainingsList.find(t => t.id === selectedTrainingId);
                if (!selectedCourse) return null;
                const courseAssignments = selectedCourse.assignments || [];
                return (
                  <Card className="h-full">
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 dark:border-slate-800">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold text-gray-900 dark:text-white text-base">
                            {selectedCourse.title}
                          </h3>
                          {selectedCourse.mandatory && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-bold bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 uppercase tracking-wider">
                              Pflicht
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          Datum: {new Date(selectedCourse.date).toLocaleDateString('de')} {selectedCourse.description ? `· ${selectedCourse.description}` : ''}
                        </p>
                      </div>
                      {canWrite && (
                        <Button onClick={openAssignModal} size="sm" className="shrink-0">
                          <Plus size={14} /> Mitarbeiter zuweisen
                        </Button>
                      )}
                    </CardHeader>
                    <CardBody className="p-0">
                      <Table>
                        <Thead>
                          <tr>
                            <Th>Mitarbeiter</Th>
                            <Th>Abteilung</Th>
                            <Th>Abschlussdatum</Th>
                            <Th>Gültig bis</Th>
                            <Th>Status</Th>
                            <Th>Zertifikat</Th>
                            {canWrite && <Th className="text-right">Aktionen</Th>}
                          </tr>
                        </Thead>
                        <Tbody>
                          {courseAssignments.map((a: any) => (
                            <tr key={a.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                              <Td className="font-semibold text-gray-900 dark:text-white">
                                <div>{a.user?.name || a.employee_name || '—'}</div>
                                {a.contested && (
                                  <div className="mt-1">
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-[10px] font-semibold" title={a.contestation_comment || ''}>
                                      ⚠ Beanstandet: "{a.contestation_comment}"
                                    </span>
                                  </div>
                                )}
                              </Td>
                              <Td className="text-xs text-gray-500">
                                {a.user?.department || (a.user_id ? '—' : (a.employee_email ? `Extern (${a.employee_email})` : 'Extern'))}
                              </Td>
                              <Td className="text-xs font-mono text-gray-500">
                                {a.completed_at ? new Date(a.completed_at).toLocaleDateString('de') : <span className="text-gray-400 italic">ausstehend</span>}
                              </Td>
                              <Td className="text-xs font-mono text-gray-500">
                                {a.expires_at ? new Date(a.expires_at).toLocaleDateString('de') : <span className="text-gray-300 italic">—</span>}
                              </Td>
                              <Td>
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                  a.completed_at === null ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                  a.status === 'valid' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                  a.status === 'warning' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                }`}>
                                  {a.completed_at === null ? 'Ausstehend' : a.status === 'valid' ? 'Aktiv' : a.status === 'warning' ? 'Ablaufend' : 'Abgelaufen'}
                                </span>
                              </Td>
                              <Td>
                                {a.certificate_url ? (
                                  <a href={a.certificate_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 text-xs font-semibold hover:underline inline-flex items-center gap-1">
                                    <FileText size={12} /> Nachweis ↗
                                  </a>
                                ) : (
                                  <span className="text-gray-300 italic text-xs">Kein Upload</span>
                                )}
                              </Td>
                              {canWrite && (
                                <Td className="text-right">
                                  <div className="flex justify-end gap-1.5">
                                    <Button onClick={() => openEditAssignment(a)} variant="secondary" size="sm" title="Nachweis pflegen / Status ändern">
                                      <Pencil size={11} />
                                    </Button>
                                    <Button onClick={() => handleDeleteAssignment(a.id)} variant="danger" size="sm" title="Zuweisung löschen">
                                      <Trash2 size={11} />
                                    </Button>
                                  </div>
                                </Td>
                              )}
                            </tr>
                          ))}
                          {courseAssignments.length === 0 && (
                            <tr>
                              <td colSpan={canWrite ? 7 : 6} className="text-center py-12 text-gray-400 italic">
                                Bisher keine Mitarbeiter dieser Schulung zugewiesen. Klicken Sie auf "Mitarbeiter zuweisen", um Teilnehmer zuzuordnen oder eine Excel-Teilnehmerliste hochzuladen.
                              </td>
                            </tr>
                          )}
                        </Tbody>
                      </Table>
                    </CardBody>
                  </Card>
                );
              })() : (
                <div className="h-64 flex flex-col justify-center items-center text-gray-400 italic bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                  Bitte wählen Sie links eine Schulung aus, um die Teilnehmerliste und deren Bearbeitungsstatus anzuzeigen.
                </div>
              )}
            </div>

          </div>
        </div>
      )}



      {/* ── MODALS ─────────────────────────────────────────────────────── */}

      {/* KPI Modal */}
      <Modal open={kpiModal} onClose={() => setKpiModal(false)} title="KPI / Wirksamkeitsmaßnahme definieren" size="lg">
        <form onSubmit={handleCreateKpi} className="space-y-4">
          <Input label="Kennzahl Titel *" value={kpiForm.title} onChange={e => setKpiForm({ ...kpiForm, title: e.target.value })} required placeholder="z. B. Phishing Clickrate bei jährlichem Kampagnen-Test" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" rows={2} value={kpiForm.description} onChange={e => setKpiForm({ ...kpiForm, description: e.target.value })} placeholder="Wie wird diese Kennzahl gemessen? Welches Control validiert sie?" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Zielwert (Target) *" value={kpiForm.target} onChange={e => setKpiForm({ ...kpiForm, target: e.target.value })} required placeholder="z. B. < 5%" />
            <Select label="Verantwortlicher Owner" value={kpiForm.owner_id} onChange={e => setKpiForm({ ...kpiForm, owner_id: e.target.value })} options={[{ value: '', label: '— niemand —' }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setKpiModal(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Speichern</Button>
          </div>
        </form>
      </Modal>

      {/* Log Measurement Modal */}
      <Modal open={measureModal !== null} onClose={() => setMeasureModal(null)} title="Messwert erfassen" size="md">
        <form onSubmit={handleAddMeasurement} className="space-y-4">
          <Input label="Messwert *" value={measureForm.value} onChange={e => setMeasureForm({ ...measureForm, value: e.target.value })} required placeholder="z. B. 3.2% oder 4 Tage" />
          <Input label="Messzeitpunkt *" type="date" value={measureForm.measured_at} onChange={e => setMeasureForm({ ...measureForm, measured_at: e.target.value })} required />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Bemerkungen</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" rows={2} value={measureForm.notes} onChange={e => setMeasureForm({ ...measureForm, notes: e.target.value })} placeholder="Abweichungen oder Kontext beim Erfassen" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMeasureModal(null)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Erfassen</Button>
          </div>
        </form>
      </Modal>

      {/* Audit Modal */}
      <Modal open={auditModal} onClose={() => setAuditModal(false)} title="Audit planen" size="lg">
        <form onSubmit={handleCreateAudit} className="space-y-4">
          <Input label="Audit-Titel" value={auditForm.title} onChange={e => setAuditForm({ ...auditForm, title: e.target.value })} required placeholder="z. B. Internes Audit Rechenzentrum & Backup" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Scope (Bereich)</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" rows={2} value={auditForm.scope} onChange={e => setAuditForm({ ...auditForm, scope: e.target.value })} placeholder="Welche Abteilungen, Systeme oder Controls werden auditiert?" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select label="Typ" value={auditForm.audit_type} onChange={e => setAuditForm({ ...auditForm, audit_type: e.target.value as any })} options={[{ value: 'internal', label: 'Intern' }, { value: 'external', label: 'Extern' }, { value: 'certification', label: 'Zertifizierung' }]} />
            <Select label="Status" value={auditForm.status} onChange={e => setAuditForm({ ...auditForm, status: e.target.value as any })} options={[{ value: 'planned', label: 'Geplant' }, { value: 'in_progress', label: 'In Durchführung' }, { value: 'completed', label: 'Abgeschlossen' }]} />
            <Input label="Auditor (Person/Firma)" value={auditForm.auditor} onChange={e => setAuditForm({ ...auditForm, auditor: e.target.value })} placeholder="z. B. TÜV SÜD, Assessor" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Startdatum" type="date" value={auditForm.start_date} onChange={e => setAuditForm({ ...auditForm, start_date: e.target.value })} />
            <Input label="Enddatum" type="date" value={auditForm.end_date} onChange={e => setAuditForm({ ...auditForm, end_date: e.target.value })} />
          </div>
          <Input label="Bericht Link (Wiki/PDF)" value={auditForm.report_link} onChange={e => setAuditForm({ ...auditForm, report_link: e.target.value })} placeholder="z. B. https://sharepoint.firma.de/compliance/audit-report.pdf" />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAuditModal(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Audit anlegen</Button>
          </div>
        </form>
      </Modal>

      {/* Finding Modal */}
      <Modal open={findingModal !== null} onClose={() => setFindingModal(null)} title="Abweichung (Finding) erfassen" size="lg">
        <form onSubmit={handleAddFinding} className="space-y-4">
          <Input label="Titel der Abweichung" value={findingForm.title} onChange={e => setFindingForm({ ...findingForm, title: e.target.value })} required placeholder="z. B. Fehlendes Backup-Konzept für neue SaaS" />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Detailbeschreibung</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white" rows={3} value={findingForm.description} onChange={e => setFindingForm({ ...findingForm, description: e.target.value })} placeholder="Genaue Beschreibung des Findings, inkl. Soll/Ist-Vergleich" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="Schweregrad" value={findingForm.severity} onChange={e => setFindingForm({ ...findingForm, severity: e.target.value as any })} options={[{ value: 'major', label: 'Hauptabweichung (Major)' }, { value: 'minor', label: 'Nebenabweichung (Minor)' }, { value: 'observation', label: 'Empfehlung / Beobachtung' }]} />
            <Select label="Zuständige Person" value={findingForm.assignee_id} onChange={e => setFindingForm({ ...findingForm, assignee_id: e.target.value })} options={[{ value: '', label: '— niemand —' }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} />
          </div>
          <Select label="Verknüpfte CAPA-Maßnahme (Task)" value={findingForm.capa_task_id} onChange={e => setFindingForm({ ...findingForm, capa_task_id: e.target.value })} options={[{ value: '', label: '— Keinen Task verknüpfen —' }, ...tasks.filter(t => t.status !== 'done').map(t => ({ value: String(t.id), label: t.title }))]} />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setFindingModal(null)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Abweichung eintragen</Button>
          </div>
        </form>
      </Modal>

      {/* Modal 1: Master Training Course (Create/Edit) */}
      <Modal
        open={masterTrainingModal}
        onClose={() => setMasterTrainingModal(false)}
        title={editMasterTrainingId ? "Schulungskurs bearbeiten" : "Schulungskurs erstellen"}
        size="lg"
      >
        <form onSubmit={handleSaveMasterTraining} className="space-y-4">
          <Input
            label="Schulungstitel *"
            value={masterTrainingForm.title}
            onChange={e => setMasterTrainingForm({ ...masterTrainingForm, title: e.target.value })}
            required
            placeholder="z. B. Jährliche Sicherheitsunterweisung 2026"
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung</label>
            <textarea
              className="bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              value={masterTrainingForm.description}
              onChange={e => setMasterTrainingForm({ ...masterTrainingForm, description: e.target.value })}
              placeholder="Inhalt, Schwerpunkte der Unterweisung..."
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Datum *"
              type="date"
              value={masterTrainingForm.date}
              onChange={e => setMasterTrainingForm({ ...masterTrainingForm, date: e.target.value })}
              required
            />
            <div className="flex items-center gap-2 pt-8">
              <input
                type="checkbox"
                id="mandatory-checkbox"
                checked={masterTrainingForm.mandatory}
                onChange={e => setMasterTrainingForm({ ...masterTrainingForm, mandatory: e.target.checked })}
                className="w-4 h-4 rounded text-blue-600"
              />
              <label htmlFor="mandatory-checkbox" className="text-sm font-semibold text-gray-700 dark:text-slate-300 cursor-pointer">
                Diese Schulung ist verpflichtend (Mandatory)
              </label>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setMasterTrainingModal(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Speichern</Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Assign users to selected training */}
      <Modal
        open={assignModal}
        onClose={() => setAssignModal(false)}
        title="Teilnehmer zuweisen & Mapping durchführen"
        size="lg"
      >
        <form onSubmit={handleAssignUsers} className="space-y-5">
          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-xl text-blue-800 dark:text-blue-300 text-xs">
            Zuweisung zum Kurs: <strong className="font-bold">{trainingsList.find(t => t.id === selectedTrainingId)?.title}</strong>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="mark-completed-checkbox"
              checked={assignForm.mark_completed}
              onChange={e => setAssignForm({ ...assignForm, mark_completed: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label htmlFor="mark-completed-checkbox" className="text-sm font-semibold text-gray-700 dark:text-slate-300 cursor-pointer">
              Zugeordnete Teilnehmer direkt als abgeschlossen / erledigt markieren
            </label>
          </div>

          {assignForm.mark_completed && (
            <div className="p-4 bg-gray-50 dark:bg-slate-800/40 border border-gray-200 dark:border-slate-700 rounded-xl space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Abschlussdatum *"
                  type="date"
                  value={assignForm.completed_at}
                  onChange={e => setAssignForm({ ...assignForm, completed_at: e.target.value })}
                  required={assignForm.mark_completed}
                />
                <Input
                  label="Gültig bis / Ablaufdatum"
                  type="date"
                  value={assignForm.expires_at}
                  onChange={e => setAssignForm({ ...assignForm, expires_at: e.target.value })}
                />
              </div>
              <Input
                label="Zertifikat / Nachweis Link (Wiki/PDF)"
                value={assignForm.certificate_url}
                onChange={e => setAssignForm({ ...assignForm, certificate_url: e.target.value })}
                placeholder="z. B. https://sharepoint.firma.de/trainings/cert_123.pdf"
              />
            </div>
          )}

          <div className="border-t dark:border-slate-800 pt-4 space-y-4">
            <h3 className="text-sm font-semibold dark:text-slate-200">Teilnehmer auswählen</h3>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Option A: Mitarbeiter manuell auswählen ({assignForm.user_ids.length} ausgewählt)</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const activeUserIds = users.filter(u => u.active).map(u => u.id);
                        setAssignForm({ ...assignForm, user_ids: activeUserIds });
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Alle auswählen
                    </button>
                    <span className="text-gray-300 dark:text-slate-700 text-xs">|</span>
                    <button
                      type="button"
                      onClick={() => setAssignForm({ ...assignForm, user_ids: [] })}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Auswahl aufheben
                    </button>
                    <Input
                      placeholder="Suchen..."
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      className="max-w-xs text-xs"
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto border dark:border-slate-800 rounded-xl p-2 bg-gray-50/50 dark:bg-slate-900/30 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {users.filter(u => u.active && u.name.toLowerCase().includes(userSearch.toLowerCase())).map(u => {
                    const isChecked = assignForm.user_ids.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-white dark:hover:bg-slate-800/60 border border-transparent hover:border-gray-200 dark:hover:border-slate-700/50 rounded-lg cursor-pointer transition-all">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            const ids = e.target.checked
                              ? [...assignForm.user_ids, u.id]
                              : assignForm.user_ids.filter(id => id !== u.id);
                            setAssignForm({ ...assignForm, user_ids: ids });
                          }}
                          className="w-4 h-4 rounded text-blue-600"
                        />
                        <div>
                          <p className="text-xs font-semibold dark:text-slate-200">{u.name}</p>
                          <p className="text-[10px] text-gray-400 truncate max-w-[180px]">{u.email} {u.department ? `· ${u.department}` : ''}</p>
                        </div>
                      </label>
                    );
                  })}
                  {users.filter(u => u.active && u.name.toLowerCase().includes(userSearch.toLowerCase())).length === 0 && (
                    <p className="text-xs text-gray-400 italic col-span-2 p-2">Keine passenden Mitarbeiter gefunden.</p>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t dark:border-slate-800 pt-3">
                <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 block">Option B: Teilnehmerliste hochladen (.xlsx)</span>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setAssignForm({ ...assignForm, file });
                    }}
                    className="block w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-800 dark:file:text-slate-200 cursor-pointer"
                  />
                  {assignForm.file && (
                    <button
                      type="button"
                      onClick={() => setAssignForm({ ...assignForm, file: null })}
                      className="text-xs text-red-500 hover:underline shrink-0"
                    >
                      Entfernen
                    </button>
                  )}
                </div>
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 px-3 py-2 space-y-1">
                  <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">Format: Excel (.xlsx) — Pflichtfelder pro Zeile:</p>
                  <ul className="text-[10px] text-blue-800 dark:text-blue-300 space-y-0.5 list-disc list-inside">
                    <li><span className="font-medium">Name</span> — Vor- und Nachname des Teilnehmers (Textspalte)</li>
                    <li><span className="font-medium">E-Mail</span> — E-Mail-Adresse (Spalte mit @-Zeichen)</li>
                  </ul>
                  <p className="text-[10px] text-blue-700/70 dark:text-blue-400/70">Spaltenreihenfolge ist beliebig. Zeilen ohne Name und E-Mail werden übersprungen. Bekannte Benutzer werden automatisch anhand von Name oder E-Mail zugeordnet, unbekannte Einträge als externe Teilnehmer erfasst.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAssignModal(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Zuweisen & Speichern</Button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Edit assignment / Record completion */}
      <Modal
        open={editAssignmentModal}
        onClose={() => setEditAssignmentModal(false)}
        title="Schulungs-Teilnahme bearbeiten"
        size="md"
      >
        <form onSubmit={handleSaveAssignment} className="space-y-4">
          <Input
            label="Abschlussdatum"
            type="date"
            value={editAssignmentForm.completed_at}
            onChange={e => setEditAssignmentForm({ ...editAssignmentForm, completed_at: e.target.value })}
            placeholder="Leer lassen, falls noch nicht abgeschlossen"
          />
          <Input
            label="Gültig bis / Ablaufdatum"
            type="date"
            value={editAssignmentForm.expires_at}
            onChange={e => setEditAssignmentForm({ ...editAssignmentForm, expires_at: e.target.value })}
          />
          <Input
            label="Nachweis / Zertifikat Link"
            value={editAssignmentForm.certificate_url}
            onChange={e => setEditAssignmentForm({ ...editAssignmentForm, certificate_url: e.target.value })}
            placeholder="z. B. https://sharepoint.firma.de/cert.pdf"
          />
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditAssignmentModal(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" className="flex-1 justify-center">Speichern</Button>
          </div>
        </form>
      </Modal>


      {/* Document Library Modal */}
      <Modal open={docsModalOpen} onClose={() => setDocsModalOpen(false)} title={`Dokumente: ${selectedAuditForDocs?.title}`} size="lg">
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Hinterlegte Dokumente</h3>
            {auditDocs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 italic">Noch keine Dokumente hinterlegt.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {auditDocs.map((doc: any) => (
                  <div key={doc.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg shrink-0">
                        <Paperclip size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={doc.original_name}>{doc.original_name}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-gray-500 dark:text-slate-400">
                          <span className="font-medium px-1.5 py-0.5 rounded-sm bg-gray-100 dark:bg-slate-700 uppercase tracking-wider">{doc.category}</span>
                          <span>{(doc.size / 1024).toFixed(0)} KB</span>
                          <span>• {new Date(doc.created_at).toLocaleDateString('de')}</span>
                          {doc.uploader && <span>• {doc.uploader.name}</span>}
                        </div>
                        {doc.description && <p className="text-xs text-gray-600 dark:text-slate-300 mt-1 line-clamp-2">{doc.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a 
                        href={`${api.defaults.baseURL}/compliance/audits/${selectedAuditForDocs?.id}/documents/${doc.id}/download`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors shadow-xs"
                        title="Herunterladen"
                      >
                        <Download size={16} />
                      </a>
                      {canWrite && (
                        <button 
                          onClick={() => handleDocDelete(doc.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors shadow-xs"
                          title="Löschen"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canWrite && (
            <form onSubmit={handleDocUpload} className="bg-gray-50 dark:bg-slate-800/50 p-4 rounded-xl border border-gray-200 dark:border-slate-700 space-y-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Neues Dokument hochladen</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Select
                  label="Dokumententyp"
                  value={docForm.category}
                  onChange={e => setDocForm({ ...docForm, category: e.target.value })}
                  options={[
                    { value: 'audit_report', label: 'Audit-Bericht' },
                    { value: 'certificate', label: 'Zertifikat' },
                    { value: 'contract', label: 'Vertrag / NDA' },
                    { value: 'other', label: 'Sonstiges' }
                  ]}
                />
                <div className="flex flex-col justify-end">
                  <input
                    type="file"
                    required
                    onChange={e => setDocFile(e.target.files ? e.target.files[0] : null)}
                    className="w-full text-sm text-gray-500 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-400 dark:hover:file:bg-blue-900/50 transition-all"
                  />
                </div>
              </div>
              <Input
                label="Beschreibung (optional)"
                value={docForm.description}
                onChange={e => setDocForm({ ...docForm, description: e.target.value })}
                placeholder="Kurze Anmerkung zum Dokument..."
              />
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={!docFile || uploadingDoc}>
                  {uploadingDoc ? 'Wird hochgeladen...' : 'Hochladen'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </div>
  );
};
