import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ArrowLeft, Plus, Upload, Trash2, Download, MessageSquare, FileText, 
  ClipboardCheck, Clock, Building2, Mail, Phone, Edit, Shield, 
  Network, AlertTriangle, CheckCircle, Info, Database, Layers,
  Server, HardDrive, User, Activity, Globe, ListChecks, History, ChevronRight,
  Share2, ArrowRight, Bold, Italic, Link as LinkIcon, AtSign, Paperclip, X, Eye,
  BookOpen, AlertOctagon, ExternalLink
} from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../lib/api';
import { useModules } from '../contexts/ModulesContext';
import type { 
  Asset, AssetDocument, AssetComment, User as UserType, 
  Vendor, Framework, AssetType, Classification, HostingType, 
  LifecycleStatus, PatchStatus, RiskLevel
} from '../types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Input } from '../components/ui/Input';
import { InputSelect } from '../components/ui/InputSelect';
import { Mermaid } from '../components/ui/Mermaid';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';
import { Skeleton, SkeletonDetailHeader } from '../components/ui/Skeleton';

const ratingLabels = ['', 'Sehr Gering (1)', 'Gering (2)', 'Mittel (3)', 'Hoch (4)', 'Sehr Hoch (5)'];
const classLabels: Record<string, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };
const typeLabels: Record<string, string> = {
  hardware: 'Hardware', software: 'Software', information: 'Information/Daten',
  process: 'Prozess', service: 'Service', personal: 'Personal', application: 'Anwendung', data: 'Daten',
  ai_application: 'KI-Anwendung (AI Act)', ai_agent: 'KI-Agent / Autonomes System', other: 'Sonstiges'
};

const hostingLabels: Record<HostingType, string> = { 
  'on-premise': 'On-Premise', cloud_public: 'Cloud Public', 
  'cloud_private': 'Cloud Private', hybrid: 'Hybrid' 
};

const lifecycleLabels: Record<LifecycleStatus, string> = { 
  evaluation: 'In Evaluierung', production: 'Produktion', 
  maintenance: 'Wartung', archived: 'Archiviert' 
};

const patchStatusLabels: Record<PatchStatus, string> = { 
  'up-to-date': 'Konform / Aktuell', pending: 'Ausstehend', critical: 'Kritisch / Veraltet' 
};

const riskLabels: Record<string, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
const fwLabels: Record<string, string> = { iso27001: 'ISO 27001', nis2: 'NIS-2', gdpr: 'DSGVO / GDPR' };
const vvtLabels: Record<string, string> = { none: 'Nicht verzeichnet', pending: 'In Arbeit', complete: 'Vollständig erfasst' };
const dataCatLabels: Record<string, string> = { none: 'Unbekannt', normal: 'Normal (Art. 6)', special: 'Besonders (Art. 9)' };

const catLabels: Record<string, string> = { contract: 'Vertrag', dpa: 'AVV / DPA', policy: 'Richtlinie', guideline: 'Leitfaden', procedure: 'Verfahrensanweisung', certificate: 'Zertifikat', risk_report: 'Risikobericht', risk_acceptance: 'Risikoakzeptanz', other: 'Sonstiges' };
const catColors: Record<string, string> = { contract: 'bg-blue-100 text-blue-800', dpa: 'bg-purple-100 text-purple-800', policy: 'bg-green-100 text-green-800', guideline: 'bg-teal-100 text-teal-800', procedure: 'bg-indigo-100 text-indigo-800', certificate: 'bg-yellow-100 text-yellow-800', risk_report: 'bg-orange-100 text-orange-800', risk_acceptance: 'bg-red-100 text-red-800', other: 'bg-gray-100 text-gray-700' };
const treatmentLabels: Record<string, string> = { mitigate: 'Reduzieren (Mitigate)', accept: 'Akzeptieren (Accept)', transfer: 'Übertragen (Transfer)', avoid: 'Vermeiden (Avoid)' };

const RatingBar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div>
    <div className="flex justify-between mb-1"><span className="text-sm text-gray-600 dark:text-slate-400">{label}</span><span className="text-sm font-medium dark:text-slate-200">{value}/5</span></div>
    <div className="bg-gray-100 dark:bg-slate-800 rounded-full h-2"><div className={`h-2 rounded-full ${value >= 4 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${(value / 5) * 100}%` }} /></div>
  </div>
);

const MarkdownText: React.FC<{ text: string }> = ({ text }) => {
  // Simple regex-based markdown formatter with ReDoS protection (using bounded quantifiers to prevent backtracking issues)
  let html = text
    .replace(/[&<>]/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[s] || s)) // Sanitize
    .replace(/\*\*([^*]{1,500})\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]{1,500})\*/g, '<em>$1</em>')
    .replace(/`([^`]{1,1000})`/g, '<code class="bg-gray-100 dark:bg-slate-800 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/\[([^\]]{1,500})\]\(([^)]{1,1000})\)/g, (_, linkText, url) => {
      // Only allow safe URL schemes — blocks javascript:, data:, vbscript: etc.
      // Quotes must be escaped too: a URL like `https://a" onmouseover="…`
      // would otherwise break out of the href attribute.
      const safeUrl = (/^(https?:\/\/|\/)/i.test(url) ? url : '#').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      return `<a href="${safeUrl}" target="_blank" rel="noreferrer noopener" class="text-blue-600 hover:underline">${linkText}</a>`;
    })
    .replace(/^-(.{1,1000})$/gm, '• $1')
    .replace(/@([^\s@,.;:!]{1,100}(?:\s+[^\s@,.;:!]{1,100})?)/g, '<span class="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-bold px-1 rounded">@$1</span>')
    .replace(/\n/g, '<br />');

  return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />;
};

type Tab = 'basics' | 'classification' | 'dependencies' | 'security' | 'compliance' | 'vvt' | 'incidents' | 'documents' | 'comments';

const isOnline = (lastSeen?: string) => {
  if (!lastSeen) return false;
  const lastSeenDate = new Date(lastSeen);
  const now = new Date();
  return (now.getTime() - lastSeenDate.getTime()) < 5 * 60 * 1000; // 5 minutes
};

export const AssetDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const { isEnabled } = useModules();
  const toast = useToast();
  const [asset, setAsset] = useState<Asset | any>(null);
  const [documents, setDocuments] = useState<AssetDocument[]>([]);
  const [comments, setComments] = useState<AssetComment[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [vvtEntriesList, setVvtEntriesList] = useState<any[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLocations = () => {
    api.get('/assets/locations').then(r => setLocations(r.data)).catch(() => setLocations([]));
  };
  const [tab, setTab] = useState<Tab>('basics');

  useEffect(() => {
    if (!isEnabled('dsgvo') && tab === 'vvt') {
      setTab('basics');
    }
  }, [isEnabled, tab]);
  
  const [assessModalOpen, setAssessModalOpen] = useState(false);
  const [editSection, setEditSection] = useState<'basics' | 'compliance' | 'security' | null>(null);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [linkDocModalOpen, setLinkDocModalOpen] = useState(false);
  
  const [assessForm, setAssessForm] = useState({ confidentiality: '3', integrity: '3', availability: '3', notes: '', mitigation: '', risk_treatment: 'mitigate', treatment_justification: '', accepted_by: '', accepted_until: '' });
  const [raDocFile, setRaDocFile] = useState<File | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editFrameworks, setEditFrameworks] = useState<string[]>([]);
  const [editVvtIds, setEditVvtIds] = useState<number[]>([]);
  const [docForm, setDocForm] = useState({ category: 'other', description: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [comment, setComment] = useState('');
  const [meetingDate, setMeetingDate] = useState('');
  const [replyingTo, setReplyingTo] = useState<AssetComment | null>(null);
  const [saving, setSaving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [assetRisks, setAssetRisks] = useState<any[]>([]);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState<number>(-1);
  const [mentionHighlightIndex, setMentionHighlightIndex] = useState<number>(0);
  const [vvtAddModalOpen, setVvtAddModalOpen] = useState(false);
  const [vvtViewEntry, setVvtViewEntry] = useState<any | null>(null);
  const [vvtCreateMode, setVvtCreateMode] = useState(false);
  const [vvtForm, setVvtForm] = useState({
    name: '', purpose: '', legal_basis: 'Art. 6 Abs. 1 lit. f DSGVO', data_categories: '',
    data_subjects: '', recipients: '', retention_period: '', security_measures: '',
    responsible_id: '', processor_id: '', status: 'active' as 'draft' | 'active' | 'archived', notes: '',
    special_categories: false, third_country_transfers: false, transfer_safeguards: '',
  });
  const [cveRefreshing, setCveRefreshing] = useState(false);
  const [cpeResolving, setCpeResolving] = useState(false);
  const [cpeSuggestions, setCpeSuggestions] = useState<{ cpe: string; title: string }[]>([]);
  const [cpeSearchQuery, setCpeSearchQuery] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const selectCPE = async (cpe: string, title: string) => {
    setCpeSuggestions([]);
    setCpeResolving(true);
    try {
      await api.post(`/assets/${id}/resolve-cpe`, { cpe, title });
      setEditForm((prev: any) => ({ ...prev, cpe, cpe_title: title }));
      toast.success(`CPE gespeichert: ${title}`);
      loadAsset();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Speichern fehlgeschlagen'); }
    finally { setCpeResolving(false); }
  };

  const resolveCPE = async (customQuery?: string) => {
    setCpeResolving(true);
    setCpeSuggestions([]);
    try {
      const { data } = await api.post(`/assets/${id}/cpe-suggestions`, { query: customQuery });
      const suggestions: { cpe: string; title: string }[] = data.suggestions || [];
      if (!suggestions.length) {
        toast.error('Kein CPE-Eintrag in NVD gefunden. Bitte Hersteller/Name prüfen oder Suchbegriff anpassen.');
        return;
      }
      if (suggestions.length === 1) {
        // Only one result — save directly without showing a picker
        await selectCPE(suggestions[0].cpe, suggestions[0].title);
        return;
      }
      // Multiple results — show picker
      setCpeSuggestions(suggestions);
    } catch (err: any) { toast.error(err.response?.data?.error || 'CPE-Auflösung fehlgeschlagen'); }
    finally { setCpeResolving(false); }
  };

  const refreshCVEs = async () => {
    setCveRefreshing(true);
    try {
      const { data } = await api.post(`/assets/${id}/refresh-cves`);
      if (data.skipped) {
        toast.error(data.reason || 'CVE-Suche nicht möglich (fehlende Asset-Daten).');
      } else {
        toast.success(`CVE-Scan abgeschlossen: ${data.counts.critical} kritisch, ${data.counts.high} hoch, ${data.counts.medium} mittel, ${data.counts.low} gering (Quelle: ${data.source.toUpperCase()})`);
        loadAsset();
      }
    } catch (err: any) { toast.error(err.response?.data?.error || 'CVE-Aktualisierung fehlgeschlagen'); }
    finally { setCveRefreshing(false); }
  };

  const handleVvtAdd = async (vvtId: number) => {
    setSaving(true);
    try {
      const currentIds = asset.vvtEntries?.map((v: any) => v.id) || [];
      if (currentIds.includes(vvtId)) return;
      await api.put(`/assets/${id}`, { ...asset, vvt_ids: [...currentIds, vvtId] });
      setVvtAddModalOpen(false);
      loadAsset();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler beim Verknüpfen'); }
    finally { setSaving(false); }
  };

  const handleVvtCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data: newVvt } = await api.post('/vvt', { ...vvtForm, asset_ids: [parseInt(id!)] });
      setVvtAddModalOpen(false);
      setVvtCreateMode(false);
      setVvtForm({
        name: '', purpose: '', legal_basis: 'Art. 6 Abs. 1 lit. f DSGVO', data_categories: '',
        data_subjects: '', recipients: '', retention_period: '', security_measures: '',
        responsible_id: '', processor_id: '', status: 'active', notes: '',
        special_categories: false, third_country_transfers: false, transfer_safeguards: '',
      });
      loadAsset();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler beim Erstellen'); }
    finally { setSaving(false); }
  };

  const handleViewPdf = async (url: string) => {
    try {
      const response = await api.get(url, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      setPdfUrl(blobUrl);
    } catch (err: any) {
      const status = err?.response?.status;
      let detail = '';
      try { if (err?.response?.data instanceof Blob) detail = JSON.parse(await err.response.data.text())?.error || ''; } catch { /* ignore */ }
      toast.error(`PDF konnte nicht geladen werden${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
    }
  };

  const loadAsset = () => api.get(`/assets/${id}`).then(r => setAsset(r.data)).finally(() => setLoading(false));
  const loadDocs = () => api.get(`/assets/${id}/documents`).then(r => setDocuments(r.data));
  const loadComments = () => api.get(`/assets/${id}/comments`).then(r => setComments(r.data));

  useEffect(() => {
    loadAsset(); loadDocs(); loadComments();
    api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([]));
    api.get('/vendors').then(r => setVendors(r.data)).catch(() => setVendors([]));
    api.get('/assets').then(r => setAllAssets(r.data)).catch(() => setAllAssets([]));
    api.get('/risks').then(r => setAssetRisks(Array.isArray(r.data) ? r.data : [])).catch(() => setAssetRisks([]));
    api.get('/vvt').then(r => setVvtEntriesList(Array.isArray(r.data) ? r.data : [])).catch(() => setVvtEntriesList([]));
    loadLocations();
  }, [id]);

  const insertAtCursor = (text: string) => {
    if (!commentInputRef.current) return;
    const start = commentInputRef.current.selectionStart;
    const end = commentInputRef.current.selectionEnd;
    const current = comment;
    const next = current.substring(0, start) + text + current.substring(end);
    setComment(next);
    setTimeout(() => {
       commentInputRef.current?.focus();
       commentInputRef.current?.setSelectionRange(start + text.length, start + text.length);
    }, 10);
  };

  const checkMentions = (value: string, selectionStart: number) => {
    const textBeforeCursor = value.slice(0, selectionStart);
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    if (lastAtSymbol !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtSymbol + 1);
      const charBeforeAt = lastAtSymbol > 0 ? textBeforeCursor[lastAtSymbol - 1] : ' ';
      const isAtStartOrAfterSpace = charBeforeAt === ' ' || charBeforeAt === '\n' || charBeforeAt === '\t';
      
      if (isAtStartOrAfterSpace && !textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setMentionSearch(textAfterAt);
        setMentionIndex(lastAtSymbol);
        setMentionHighlightIndex(0);
        return;
      }
    }
    setMentionSearch(null);
    setMentionIndex(-1);
  };

  const insertMention = (username: string) => {
    if (mentionIndex === -1 || !commentInputRef.current) return;
    const start = mentionIndex;
    const end = commentInputRef.current.selectionStart;
    const current = comment;
    const next = current.substring(0, start) + `@${username} ` + current.substring(end);
    setComment(next);
    setMentionSearch(null);
    setMentionIndex(-1);
    setTimeout(() => {
      commentInputRef.current?.focus();
      const newCursorPos = start + username.length + 2; // for @ and space
      commentInputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
    }, 10);
  };

  const handleAssess = async (e: React.FormEvent) => {
    e.preventDefault();
    const isAccept = assessForm.risk_treatment === 'accept';
    if (isAccept && !raDocFile) {
      toast.warning('Risikoakzeptanz erfordert ein unterschriebenes Akzeptanz-Dokument. Bitte laden Sie es hoch.');
      return;
    }
    setSaving(true);
    try {
      let acceptance_document_id: number | undefined;
      if (isAccept && raDocFile) {
        const fd = new FormData();
        fd.append('file', raDocFile);
        fd.append('category', 'risk_acceptance');
        fd.append('description', `Risikoakzeptanz – ${asset?.name || ''}`);
        const up = await api.post(`/assets/${id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        acceptance_document_id = up.data.id;
      }
      await api.post('/assessments', {
        asset_id: parseInt(id!),
        confidentiality: parseInt(assessForm.confidentiality),
        integrity: parseInt(assessForm.integrity),
        availability: parseInt(assessForm.availability),
        notes: assessForm.notes,
        mitigation: assessForm.mitigation,
        risk_treatment: assessForm.risk_treatment,
        treatment_justification: assessForm.treatment_justification,
        accepted_by: assessForm.accepted_by,
        accepted_until: assessForm.accepted_until || undefined,
        acceptance_document_id,
      });
      setAssessModalOpen(false); setRaDocFile(null); loadAsset(); loadDocs();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
    finally { setSaving(false); }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docFile) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', docFile);
      fd.append('category', docForm.category);
      fd.append('description', docForm.description);
      await api.post(`/assets/${id}/documents`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDocModalOpen(false); setDocFile(null); setDocForm({ category: 'other', description: '' });
      loadDocs();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
    finally { setSaving(false); }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post(`/assets/${id}/comments`, { 
        content: comment, 
        meeting_date: meetingDate || undefined,
        parent_id: replyingTo?.id 
      });
      setComment(''); setMeetingDate(''); setReplyingTo(null); loadComments();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
    finally { setSaving(false); }
  };

  const openEditSection = (section: 'basics' | 'compliance' | 'security') => {
    if (!asset) return;
    setEditForm({ ...asset });
    setEditFrameworks(asset.frameworks || []);
    setEditVvtIds(asset.vvtEntries?.map((v: any) => v.id) || []);
    setEditSection(section);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.put(`/assets/${id}`, { ...editForm, frameworks: editFrameworks, vvt_ids: editVvtIds });
      setEditSection(null); loadAsset();
      loadLocations();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Fehler'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="space-y-6" role="status" aria-label="Asset wird geladen">
      <div className="flex items-center gap-1.5 text-sm">
        <Skeleton className="h-4 w-12" />
        <span className="text-gray-300 dark:text-slate-700">/</span>
        <Skeleton className="h-4 w-40" />
      </div>
      <SkeletonDetailHeader />
    </div>
  );
  if (!asset) return <div className="p-6 text-gray-500">Asset nicht gefunden</div>;

  const current = asset.Assessments?.find((a: any) => a.is_current);
  const riskColorMap: Record<string, string> = { low: 'bg-green-500', medium: 'bg-yellow-500', high: 'bg-orange-500', critical: 'bg-red-500' };
  const linkedRisks = assetRisks.filter(r => (r.assets || []).some((a: any) => a.id === asset.id));
  const activeUsers = users.filter(u => u.active);
  
  // Permissions
  const isViewer = !hasWriteAccess(user?.role);
  const isItStaff = user?.role === 'it-staff';
  const isDpo = user?.role === 'dpo';
  const isAssessor = user?.role === 'admin' || user?.role === 'assessor';
  const canEdit = user?.role === 'admin' || user?.role === 'assessor' || isItStaff || isDpo || user?.id === asset.owner_id || user?.id === asset.assessor_id;
  const canAssess = isAssessor;

  const safeFrameworks = Array.isArray(asset.frameworks) ? asset.frameworks : [];
  const isRestricted = user?.role === 'it-staff' || !hasWriteAccess(user?.role);
  const visiblePolicies = (asset.policies as any[] || []).filter(p => !isRestricted || p.category !== 'contract');
  const visibleDocs = documents.filter(d => !isRestricted || d.category !== 'contract');

  const tabs: { key: Tab; label: string; icon: React.FC<any>; badge?: number }[] = [
    { key: 'basics', label: 'Allgemein', icon: Info },
    { key: 'classification', label: 'Schutzbedarf', icon: Shield },
    ...(isEnabled('dsgvo') ? [{ key: 'vvt' as Tab, label: 'VVT', icon: BookOpen, badge: (asset?.vvtEntries?.length || 0) }] : []),
    { key: 'incidents', label: 'Vorfälle', icon: AlertOctagon, badge: (asset?.incidents?.length || 0) },
    { key: 'dependencies', label: 'Topologie', icon: Network },
    { key: 'security', label: 'Security Status', icon: Activity },
    { key: 'compliance', label: 'Richtlinien', icon: ListChecks },
    { key: 'documents', label: 'Dateien', icon: FileText, badge: visibleDocs.length },
    { key: 'comments', label: 'Kommentare', icon: MessageSquare, badge: comments.length },
  ];

  const generateMermaid = () => {
    if (!asset || !allAssets.length) return '';
    const shp = (type: string, label: string) => {
      // Always use quoted labels to prevent Mermaid parse errors from special chars
      const s = label.replace(/"/g, "'").replace(/[\n\r]+/g, ' ').slice(0, 38);
      switch (type) {
        case 'hardware':      return `["🖥 ${s}"]`;
        case 'software':      return `("💾 ${s}")`;
        case 'application':   return `("📦 ${s}")`;
        case 'data': case 'information': return `[("🗄 ${s}")]`;
        case 'service':       return `["🔌 ${s}"]`;
        case 'process':       return `["📋 ${s}"]`;
        case 'ai_application': case 'ai_agent': return `(("🤖 ${s}"))`;
        case 'personal':      return `["👤 ${s}"]`;
        default:              return `["${s}"]`;
      }
    };
    const parent = allAssets.find(a => String(a.id) === String(asset.parent_id));
    const grandparent = parent ? allAssets.find(a => String(a.id) === String(parent.parent_id)) : undefined;
    const children = allAssets.filter(a => String(a.parent_id) === String(asset.id));

    let chart = 'graph TD\n';
    chart += '  classDef current fill:#3b82f6,stroke:#2563eb,color:#fff,stroke-width:2px;\n';
    chart += '  classDef related fill:#f8fafc,stroke:#94a3b8,color:#1e293b,stroke-width:1px;\n';
    chart += '  classDef ancestor fill:#e0f2fe,stroke:#38bdf8,color:#0c4a6e,stroke-width:1px;\n';
    chart += '  classDef child fill:#dcfce7,stroke:#86efac,color:#14532d,stroke-width:1px;\n';

    if (grandparent) {
      chart += `  GP${shp(grandparent.type, grandparent.name)}\n  class GP ancestor;\n`;
      chart += `  click GP href "/assets/${grandparent.id}"\n`;
    }
    if (parent) {
      chart += `  P${shp(parent.type, parent.name)}\n  class P ancestor;\n`;
      chart += `  click P href "/assets/${parent.id}"\n`;
      if (grandparent) chart += `  GP --> P\n`;
    }
    chart += `  C${shp(asset.type, asset.name)}\n  class C current;\n`;
    if (parent) chart += `  P --> C\n`;
    children.forEach((ch, i) => {
      chart += `  CH${i}${shp(ch.type, ch.name)}\n  class CH${i} child;\n`;
      chart += `  click CH${i} href "/assets/${ch.id}"\n`;
      chart += `  C --> CH${i}\n`;
      // Grandchildren (one level deeper)
      const grandchildren = allAssets.filter(a => String(a.parent_id) === String(ch.id));
      grandchildren.slice(0, 3).forEach((gch, j) => {
        chart += `  GCH${i}_${j}${shp(gch.type, gch.name)}\n  class GCH${i}_${j} related;\n`;
        chart += `  click GCH${i}_${j} href "/assets/${gch.id}"\n`;
        chart += `  CH${i} --> GCH${i}_${j}\n`;
      });
      if (grandchildren.length > 3) chart += `  MORE${i}["… +${grandchildren.length - 3} mehr"]\n  CH${i} --> MORE${i}\n  class MORE${i} related;\n`;
    });

    // Cross-domain connections: GDPR/VVT, risks, external vendor, incidents.
    // These already exist as data relationships — surface them as labelled
    // (dotted) links from the current asset so the dependency view doubles as a
    // data-protection / risk connection map.
    const esc = (s: any) => String(s ?? '').replace(/"/g, "'").replace(/[\n\r]+/g, ' ').slice(0, 36);
    chart += '  classDef dsgvo fill:#f3e8ff,stroke:#a855f7,color:#581c87,stroke-width:1px;\n';
    chart += '  classDef riskn fill:#fee2e2,stroke:#ef4444,color:#7f1d1d,stroke-width:1px;\n';
    chart += '  classDef vendorn fill:#fef9c3,stroke:#ca8a04,color:#713f12,stroke-width:1px;\n';
    chart += '  classDef incidentn fill:#ffedd5,stroke:#f97316,color:#7c2d12,stroke-width:1px;\n';

    const vvtList = (asset.vvtEntries as any[]) || [];
    vvtList.slice(0, 5).forEach((v: any, i: number) => {
      chart += `  VVT${i}["📋 ${esc(v.name)}"]\n  class VVT${i} dsgvo;\n  C -.DSGVO.-> VVT${i}\n`;
    });
    if (vvtList.length > 5) chart += `  VVTMORE["… +${vvtList.length - 5} VVT"]\n  class VVTMORE dsgvo;\n  C -.DSGVO.-> VVTMORE\n`;

    (linkedRisks || []).slice(0, 5).forEach((r: any, i: number) => {
      chart += `  RSK${i}["⚠ ${esc(r.title)}"]\n  class RSK${i} riskn;\n  C -.Risiko.-> RSK${i}\n`;
    });

    const incList = (asset.incidents as any[]) || [];
    incList.slice(0, 5).forEach((n: any, i: number) => {
      chart += `  INC${i}["🚨 ${esc(n.title)}"]\n  class INC${i} incidentn;\n  C -.Vorfall.-> INC${i}\n`;
    });

    if (asset.vendorContact) {
      chart += `  VND["🏢 ${esc((asset.vendorContact as any).name)}"]\n  class VND vendorn;\n  C -.Dienstleister.-> VND\n`;
    }

    return chart;
  };

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
        <Link to="/assets" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Assets</Link>
        <ChevronRight size={14} className="text-gray-300 dark:text-slate-600" />
        <span className="text-gray-900 dark:text-white font-medium truncate max-w-xs">{asset.name}</span>
      </nav>
      <div className="flex items-start gap-4">
        <Link to="/assets"><Button variant="ghost" size="sm"><ArrowLeft size={16} />Zurück</Button></Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
             <span className="text-xs font-mono bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-sm text-gray-500">ID: {asset.id}</span>
             <h1 className="text-2xl font-bold truncate dark:text-white">{asset.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge value={asset.type} label={typeLabels[asset.type] || asset.type} />
            <Badge value={asset.lifecycle_status} label={lifecycleLabels[asset.lifecycle_status as LifecycleStatus] || asset.lifecycle_status} />
            {asset.nis2_relevant && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300"><AlertTriangle size={10} className="mr-1"/>NIS-2 Relevant</span>}
            {current && <Badge value={current.risk_level} label={`Risiko: ${riskLabels[current.risk_level as RiskLevel] || current.risk_level}`} />}
          </div>
        </div>
        <div className="flex gap-2">
          {!isViewer && (() => {
            type SectionMap = Partial<Record<Tab, 'basics' | 'compliance' | 'security'>>;
            const sectionMap: SectionMap = { basics: 'basics', dependencies: 'basics', classification: 'compliance', compliance: 'compliance', security: 'security' };
            const section = sectionMap[tab];
            if (!section) return null;
            const allowed = section === 'security' ? (isItStaff || isAssessor) : section === 'compliance' ? (isDpo || isAssessor) : canEdit;
            if (!allowed) return null;
            const labels = { basics: 'Stammdaten', compliance: 'Compliance', security: 'Security' };
            return <Button variant="secondary" onClick={() => openEditSection(section)}><Edit size={16} />{labels[section]} bearbeiten</Button>;
          })()}
          {!isViewer && canAssess && <Button onClick={() => setAssessModalOpen(true)}><Shield size={16} />Bewerten</Button>}
        </div>
      </div>

      {/* Kompakte Übersichtsleiste */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-3 flex items-center gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${current ? riskColorMap[current.risk_level] : 'bg-gray-400'}`}><Shield className="text-white" size={16} /></div>
          <div className="min-w-0"><p className="text-[10px] uppercase font-bold text-gray-400">Risiko</p><p className="text-sm font-bold dark:text-white truncate">{current ? (riskLabels[current.risk_level as RiskLevel] || current.risk_level) : 'Nicht bewertet'}</p></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-3 flex items-center gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-indigo-500"><Activity className="text-white" size={16} /></div>
          <div className="min-w-0"><p className="text-[10px] uppercase font-bold text-gray-400">Schutzbedarf</p><p className="text-sm font-bold dark:text-white">{current?.risk_score != null ? `${current.risk_score.toFixed(1)} / 5` : '–'}</p></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-3 flex items-center gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-orange-500"><Clock className="text-white" size={16} /></div>
          <div className="min-w-0"><p className="text-[10px] uppercase font-bold text-gray-400">Nächstes Review</p><p className="text-sm font-bold dark:text-white truncate">{current?.next_review_at ? format(new Date(current.next_review_at), 'dd.MM.yyyy') : 'Ausstehend'}</p></div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl border dark:border-slate-800 p-3 flex items-center gap-3">
          <div className="p-2 rounded-lg shrink-0 bg-blue-500"><User className="text-white" size={16} /></div>
          <div className="min-w-0"><p className="text-[10px] uppercase font-bold text-gray-400">Owner</p><p className="text-sm font-bold dark:text-white truncate">{asset.owner?.name || '–'}</p></div>
        </div>
      </div>

      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, badge }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === key ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 hover:border-gray-300'
              }`}>
              <Icon size={15} />{label}
              {badge !== undefined && badge > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${tab === key ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-500'}`}>{badge}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {tab === 'basics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><div className="flex items-center gap-2"><Info size={18} className="text-blue-500"/><h2 className="font-semibold dark:text-white">Strukturanalyse & Status</h2></div></CardHeader>
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-y-3 text-sm">
                    <span className="text-gray-500 dark:text-slate-400">Asset-ID</span><span className="font-mono dark:text-slate-200">{asset.id}</span>
                    <span className="text-gray-500 dark:text-slate-400">Asset-Name</span><span className="font-medium dark:text-slate-200">{asset.name}</span>
                    <span className="text-gray-500 dark:text-slate-400">Asset-Typ</span><span className="font-medium dark:text-slate-200">{typeLabels[asset.type] || asset.type}</span>
                    <span className="text-gray-500 dark:text-slate-400">Status (Lifecycle)</span><Badge value={asset.lifecycle_status} label={lifecycleLabels[asset.lifecycle_status as LifecycleStatus] || asset.lifecycle_status} />
                    <span className="text-gray-500 dark:text-slate-400">Betriebs-Status</span><Badge value={asset.status} label={asset.status === 'active' ? 'Aktiv' : 'Inaktiv'} />
                    <span className="text-gray-500 dark:text-slate-400">Hosting / Standort</span><span className="dark:text-slate-200">{hostingLabels[asset.hosting_type as HostingType]} {asset.location ? `(${asset.location})` : ''}</span>
                    <span className="text-gray-500 dark:text-slate-400">Version / Revision</span><span className="dark:text-slate-200">{asset.version || '–'}</span>
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardHeader><div className="flex items-center gap-2"><Building2 size={18} className="text-blue-500"/><h2 className="font-semibold dark:text-white">Hersteller & Lifecycle</h2></div></CardHeader>
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-y-3 text-sm">
                    <span className="text-gray-500 dark:text-slate-400">Hersteller / Vendor</span><span className="font-medium dark:text-slate-200">{asset.vendor || '–'}</span>
                    <span className="text-gray-500 dark:text-slate-400">EOL-Datum</span><span className={`${asset.eol_date && new Date(asset.eol_date) < new Date() ? 'text-red-600 font-bold' : 'dark:text-slate-200'}`}>{asset.eol_date ? format(new Date(asset.eol_date), 'dd.MM.yyyy') : 'Unbefristet'}</span>
                    <span className="text-gray-500 dark:text-slate-400">Patch-Status</span><Badge value={asset.patch_status} label={patchStatusLabels[asset.patch_status as PatchStatus] || asset.patch_status} />
                  </div>
                </CardBody>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><div className="flex items-center gap-2"><User size={18} className="text-blue-500"/><h2 className="font-semibold dark:text-white">Ownership & Verantwortlichkeiten</h2></div></CardHeader>
                <CardBody className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30">
                    <div className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-xs"><User className="text-blue-600 dark:text-blue-400" size={24}/></div>
                    <div>
                      <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider text-[10px]">Asset Owner (Business)</p>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold dark:text-white">{asset.owner?.name}</p>
                        {asset.owner && (
                          <div className={`w-2 h-2 rounded-full ${isOnline(asset.owner.last_seen_at) ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} title={isOnline(asset.owner.last_seen_at) ? 'Online' : 'Offline'} />
                        )}
                      </div>
                      <p className="text-xs text-blue-500 dark:text-slate-400">{asset.owner?.email} · {asset.owner?.department}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-slate-800/20 rounded-xl border border-gray-200 dark:border-slate-800">
                    <div className="p-2 bg-white dark:bg-slate-800 rounded-full shadow-xs"><Server className="text-gray-600 dark:text-slate-400" size={24}/></div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-slate-500 font-bold uppercase tracking-wider text-[10px]">Systemverantwortlicher (Technik)</p>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold dark:text-white">{asset.assessor?.name}</p>
                        {asset.assessor && (
                          <div className={`w-2 h-2 rounded-full ${isOnline(asset.assessor.last_seen_at) ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} title={isOnline(asset.assessor.last_seen_at) ? 'Online' : 'Offline'} />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400">{asset.assessor?.email}</p>
                    </div>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader><div className="flex items-center gap-2"><Globe size={18} className="text-blue-500"/><h2 className="font-semibold dark:text-white">Externer Dienstleister / NIS-2 Supply Chain</h2></div></CardHeader>
                <CardBody>
                  {asset.vendorContact ? (
                    <div className="space-y-4">
                      <div className="p-4 border dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-slate-800/30">
                        <p className="text-lg font-bold dark:text-white">{asset.vendorContact.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">{asset.vendorContact.website}</p>
                        <div className="mt-4 space-y-2">
                           {asset.vendorContact.contacts?.map((c: any) => (
                             <div key={c.id} className="text-sm border-t dark:border-slate-800 pt-2 flex justify-between">
                                <span className="dark:text-slate-300">{c.name} ({c.role})</span>
                                <div className="flex gap-2">
                                   {c.email && <a href={`mailto:${c.email}`} className="text-blue-600 dark:text-blue-400"><Mail size={14}/></a>}
                                   {c.phone && <span className="text-gray-500 dark:text-slate-400"><Phone size={14}/></span>}
                                </div>
                             </div>
                           ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400 dark:text-slate-500 italic">Kein externer Dienstleister zugeordnet.</div>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {tab === 'classification' && (
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <Card className="md:col-span-2">
                <CardHeader><h2 className="font-semibold dark:text-white">CIA-Rating (Schutzbedarfsfeststellung)</h2></CardHeader>
                <CardBody>
                   {current ? (
                     <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                           <RatingBar label="Vertraulichkeit (C)" value={current.confidentiality}/>
                           <RatingBar label="Integrität (I)" value={current.integrity}/>
                           <RatingBar label="Verfügbarkeit (A)" value={current.availability}/>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mt-6">
                           <div className="p-4 bg-gray-50 dark:bg-slate-800/30 rounded-xl">
                              <p className="text-xs text-gray-400 dark:text-slate-500 uppercase font-bold mb-1">Risiko-Score</p>
                              <p className="text-3xl font-bold dark:text-white">{current.risk_score?.toFixed(1) || '0.0'} <span className="text-sm font-normal text-gray-400">/ 5.0</span></p>
                           </div>
                           <div className={`p-4 rounded-xl flex items-center gap-3 ${current.risk_level === 'critical' || current.risk_level === 'high' ? 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30' : 'bg-green-50 dark:bg-green-900/10'}`}>
                              <Badge value={current.risk_level} label={riskLabels[current.risk_level as RiskLevel] || current.risk_level} />
                           </div>
                        </div>
                        {current.risk_treatment && (
                          <div className="mt-4 p-4 rounded-xl border dark:border-slate-800 bg-white dark:bg-slate-900/30 space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500">Risikobehandlung</p>
                              <Badge value={current.risk_treatment === 'accept' ? 'critical' : current.risk_treatment === 'avoid' ? 'high' : current.risk_treatment === 'transfer' ? 'medium' : 'low'} label={treatmentLabels[current.risk_treatment] || current.risk_treatment} />
                            </div>
                            {current.mitigation && <p className="text-sm text-gray-600 dark:text-slate-400">{current.mitigation}</p>}
                            {current.risk_treatment === 'accept' && (
                              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 space-y-2">
                                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-xs uppercase"><AlertTriangle size={12} /> Risikoakzeptanz dokumentiert</div>
                                {current.accepted_by && <p className="text-sm dark:text-slate-300">Akzeptiert durch: <strong>{current.accepted_by}</strong></p>}
                                {current.accepted_until && <p className="text-sm dark:text-slate-300">Gültig bis: <strong>{format(new Date(current.accepted_until), 'dd.MM.yyyy', { locale: de })}</strong></p>}
                                {current.treatment_justification && <p className="text-sm text-gray-600 dark:text-slate-400 italic">„{current.treatment_justification}"</p>}
                                {current.acceptance_document_id && (
                                  <button onClick={() => handleViewPdf(`/assets/${id}/documents/${current.acceptance_document_id}/download`)} className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1">
                                    <FileText size={12} /> Akzeptanz-Dokument anzeigen
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {current.notes && (
                          <div className="mt-3 p-3 rounded-xl bg-gray-50 dark:bg-slate-800/30 border dark:border-slate-800">
                            <p className="text-xs font-bold uppercase text-gray-400 dark:text-slate-500 mb-1">Feststellungen / Begründung</p>
                            <p className="text-sm text-gray-600 dark:text-slate-400">{current.notes}</p>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-2 border-t dark:border-slate-800 text-xs text-gray-400">
                          <span>Bewertet von <strong className="dark:text-slate-300">{current.assessorUser?.name || '–'}</strong></span>
                          {current.assessed_at && <span>{format(new Date(current.assessed_at), 'dd.MM.yyyy HH:mm', { locale: de })}</span>}
                        </div>
                     </div>
                   ) : (
                     <div className="text-center py-12">
                        <p className="text-gray-400 dark:text-slate-500 mb-4 italic">Keine Schutzbedarfsfeststellung vorhanden.</p>
                        {!isViewer && canAssess && <Button onClick={() => setAssessModalOpen(true)}><Shield size={16}/>Jetzt bewerten</Button>}
                     </div>
                   )}
                </CardBody>
             </Card>
             <Card>
                <CardHeader><h2 className="font-semibold dark:text-white">BCM &amp; Kritikalität</h2></CardHeader>
                <CardBody className="space-y-4">
                   <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold flex items-center">
                         RTO (Wiederanlaufzeit)
                         <InfoTooltip text="Recovery Time Objective: Die angestrebte Zeitdauer, innerhalb derer ein IT-System oder Geschäftsprozess nach einem Ausfall wiederhergestellt sein muss." />
                      </span>
                      <span className="text-xl font-mono dark:text-slate-200">{asset.rto || 'Nicht definiert'}</span>
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold flex items-center">
                         RPO (Datenverlust-Toleranz)
                         <InfoTooltip text="Recovery Point Objective: Der maximal tolerierbare Datenverlust bzw. der Zeitraum zwischen dem letzten Backup und einem Ausfall." />
                      </span>
                      <span className="text-xl font-mono dark:text-slate-200">{asset.rpo || 'Nicht definiert'}</span>
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold flex items-center">
                         Dienstbereitstellungszeit (SDO)
                         <InfoTooltip text="Service Delivery Objective: Das angestrebte Leistungsniveau (z. B. Mindestkapazität), das im Notbetrieb während des Ausfalls aufrechterhalten werden muss." />
                      </span>
                      <span className="text-xl font-mono dark:text-slate-200">{asset.sdo || 'Nicht definiert'}</span>
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold flex items-center">
                         Maximal tolerierbare Ausfallzeit (MTO)
                         <InfoTooltip text="Maximum Tolerable Outage: Die maximale Zeitdauer, die ein System ausfallen darf, bevor die Existenz der Organisation gefährdet ist." />
                      </span>
                      <span className="text-xl font-mono dark:text-slate-200">{asset.mto || 'Nicht definiert'}</span>
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold flex items-center">
                         Angriffskennzahlen (IoA)
                         <InfoTooltip text="Indicators of Attack: Indikatoren oder Kennzahlen, die auf einen laufenden oder bevorstehenden Cyberangriff auf das Asset hinweisen." />
                      </span>
                      <span className="text-xl font-mono dark:text-slate-200">{asset.ioa || 'Nicht definiert'}</span>
                   </div>
                </CardBody>
             </Card>
           </div>
        )}

        {tab === 'dependencies' && (
           <div className="space-y-4">
             <Card>
               <CardHeader>
                 <div className="flex flex-wrap items-center justify-between gap-3">
                   <div>
                     <h2 className="font-semibold dark:text-white">Topologie &amp; Verbindungen</h2>
                     <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Asset-Hierarchie (durchgezogen) sowie Verknüpfungen zu VVT/DSGVO, Risiken, Vorfällen und Dienstleister (gestrichelt). Knoten sind klickbar.</p>
                   </div>
                   <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                     {[
                       { color: 'bg-blue-500', label: 'Aktuelles Asset' },
                       { color: 'bg-blue-100 border border-blue-300', label: 'Vorfahren' },
                       { color: 'bg-green-100 border border-green-300', label: 'Kinder/Enkel' },
                       { color: 'bg-purple-100 border border-purple-300', label: 'VVT/DSGVO' },
                       { color: 'bg-red-100 border border-red-300', label: 'Risiken' },
                       { color: 'bg-orange-100 border border-orange-300', label: 'Vorfälle' },
                     ].map(({ color, label }) => (
                       <span key={label} className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                         <span className={`w-3 h-3 rounded-sm shrink-0 ${color}`} />{label}
                       </span>
                     ))}
                   </div>
                 </div>
               </CardHeader>
               <CardBody>
                 <Mermaid chart={generateMermaid()} className="min-h-[300px]" />
                 <p className="text-xs text-center text-gray-400 dark:text-slate-500 mt-2">
                   Tipp: Auf Knoten klicken um zum jeweiligen Asset zu navigieren. Übergeordnetes Asset in den Stammdaten festlegen.
                 </p>
               </CardBody>
             </Card>

             {(() => {
               const children = allAssets.filter(a => String(a.parent_id) === String(asset.id));
               if (children.length === 0) return null;
               return (
                 <Card>
                   <CardHeader>
                     <div className="flex items-center gap-2">
                       <Share2 size={18} className="text-blue-500" />
                       <h2 className="font-semibold dark:text-white">Abhängige Assets ({children.length})</h2>
                     </div>
                     <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Assets, die dieses Asset als übergeordnetes System (Parent) nutzen.</p>
                   </CardHeader>
                   <CardBody className="p-0">
                     <div className="divide-y divide-gray-100 dark:divide-slate-800">
                       {children.map(child => (
                         <Link
                           key={child.id}
                           to={`/assets/${child.id}`}
                           className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group"
                         >
                           <div className="flex items-center gap-3 min-w-0">
                             <span className="text-sm font-medium dark:text-slate-200 truncate">{child.name}</span>
                             <Badge value={child.type} label={typeLabels[child.type] || child.type} />
                           </div>
                           <div className="flex items-center gap-2 shrink-0 ml-4">
                             {(child as any).Assessments?.[0]?.risk_level && (
                               <Badge value={(child as any).Assessments[0].risk_level} label={riskLabels[(child as any).Assessments[0].risk_level as RiskLevel] || (child as any).Assessments[0].risk_level} />
                             )}
                             <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                           </div>
                         </Link>
                       ))}
                     </div>
                   </CardBody>
                 </Card>
               );
             })()}
           </div>
        )}

        {tab === 'security' && (
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {isEnabled('discovery') && <Card className="md:col-span-2">
                 <CardHeader>
                   <div className="flex items-center justify-between">
                     <h2 className="font-semibold dark:text-white">Vulnerability Management (CVE)</h2>
                     {isEnabled('discovery') && (
                       <div className="flex items-center gap-3">
                         {asset.cve_last_checked && (
                           <span className="text-xs text-gray-400 dark:text-slate-500">
                             Aktualisiert: {format(new Date(asset.cve_last_checked), 'dd.MM.yyyy HH:mm', { locale: de })}
                             {asset.cve_ids?.[0]?.source && <span className="ml-1 uppercase font-bold">· {(asset.cve_ids?.[0] as any)?.source || ''}</span>}
                           </span>
                         )}
                         <Button size="sm" variant="secondary" onClick={refreshCVEs} disabled={cveRefreshing}>
                           {cveRefreshing ? 'Wird geladen…' : 'CVEs aktualisieren'}
                         </Button>
                       </div>
                     )}
                   </div>
                 </CardHeader>
                 <CardBody className="space-y-4">
                    {isEnabled('discovery') ? (
                       <>
                         {/* Summary counts */}
                         <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="flex flex-col items-center p-3 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-400 rounded-lg">
                               <span className="text-2xl font-bold">{asset.cve_critical || 0}</span>
                               <span className="text-xs font-bold uppercase mt-1">Kritisch</span>
                            </div>
                            <div className="flex flex-col items-center p-3 bg-orange-50 dark:bg-orange-900/20 text-orange-800 dark:text-orange-400 rounded-lg">
                               <span className="text-2xl font-bold">{asset.cve_high || 0}</span>
                               <span className="text-xs font-bold uppercase mt-1">Hoch</span>
                            </div>
                            <div className="flex flex-col items-center p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400 rounded-lg">
                               <span className="text-2xl font-bold">{asset.cve_medium || 0}</span>
                               <span className="text-xs font-bold uppercase mt-1">Mittel</span>
                            </div>
                            <div className="flex flex-col items-center p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400 rounded-lg">
                               <span className="text-2xl font-bold">{asset.cve_low || 0}</span>
                               <span className="text-xs font-bold uppercase mt-1">Gering</span>
                            </div>
                         </div>

                         {/* Matching method info */}
                         <div className="flex flex-wrap gap-2 items-center text-xs">
                           {asset.package_name && asset.package_ecosystem && (
                             <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full font-bold">
                               OSV · {asset.package_ecosystem}:{asset.package_name}
                             </span>
                           )}
                           {asset.cpe && (
                             <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full" title={asset.cpe + (asset.version ? `:${asset.version}` : '')}>
                               <span className="font-bold">{asset.cpe_title || asset.cpe.split(':')[4]}</span>
                               {asset.version && <span className="opacity-70">v{asset.version}</span>}
                               <span className="text-[10px] font-bold bg-blue-200 dark:bg-blue-800 px-1 py-0.5 rounded">CPE</span>
                             </span>
                           )}
                           {!asset.cpe && !asset.package_name && (
                             <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full font-bold">
                               Keyword · {asset.cve_search_query || [asset.vendor, asset.version].filter(Boolean).join(' ') || asset.name || '—'}
                             </span>
                           )}
                           {!asset.cpe && !asset.package_name && (asset.vendor || asset.name) && (
                             <button onClick={() => resolveCPE()} disabled={cpeResolving} className="text-xs underline text-blue-500 dark:text-blue-400 hover:text-blue-700 disabled:opacity-50">
                               {cpeResolving ? 'Wird aufgelöst…' : 'CPE auto-auflösen'}
                             </button>
                           )}
                         </div>

                         {/* First-run hint */}
                         {!asset.cve_last_checked && (
                           <div className="text-sm text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
                             {(asset.vendor || asset.name || asset.package_name) ? (
                               <span>Noch kein Scan durchgeführt — klicken Sie auf „CVEs aktualisieren".</span>
                             ) : (
                               <span className="text-orange-600 dark:text-orange-400">Kein Hersteller, Paketname oder CPE hinterlegt. Bitte ergänzen Sie die Felder im Security-Edit-Dialog.</span>
                             )}
                           </div>
                         )}

                         {/* CVE list */}
                         {Array.isArray(asset.cve_ids) && asset.cve_ids.length > 0 && (
                           <div className="space-y-2">
                             <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase">Top-CVEs (nach CVSS-Score)</p>
                             <div className="max-h-64 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                                {(asset.cve_ids as any[]).map((cve: any) => {
                                  const cveUrl = cve.id.startsWith('CVE-') 
                                    ? `https://nvd.nist.gov/vuln/detail/${cve.id}` 
                                    : cve.id.startsWith('GHSA-') 
                                    ? `https://github.com/advisories/${cve.id}` 
                                    : `https://nvd.nist.gov/vuln/detail/${cve.id}`;

                                  const sourceUrl = cve.source === 'osv'
                                    ? (cve.id.startsWith('GHSA-') 
                                        ? `https://github.com/advisories/${cve.id}` 
                                        : `https://osv.dev/vulnerability/${cve.id}`)
                                    : cve.source === 'shodan'
                                    ? `https://nvd.nist.gov/vuln/detail/${cve.id}`
                                    : `https://nvd.nist.gov/vuln/detail/${cve.id}`;

                                  return (
                                    <div key={cve.id} className="flex gap-3 p-2.5 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-100 dark:border-slate-700 hover:border-gray-200 dark:hover:border-slate-650 transition-all items-start">
                                      <div className="flex-shrink-0 w-32">
                                        <a
                                          href={cveUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                                          title="CVE-Details auf externer Seite öffnen"
                                        >
                                          {cve.id}
                                          <ExternalLink size={11} className="inline-block shrink-0" />
                                        </a>
                                        <div className={`mt-1 text-[11px] font-bold px-1.5 py-0.5 rounded w-fit ${
                                          cve.severity === 'critical' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                          cve.severity === 'high'     ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                          cve.severity === 'medium'   ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                        }`}>{cve.score > 0 ? cve.score.toFixed(1) : '?'} {cve.severity?.toUpperCase()}</div>
                                        {cve.source && (
                                          <a
                                            href={sourceUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={`Quelle (${cve.source.toUpperCase()}) öffnen`}
                                            className={`mt-1 text-[10px] px-1.5 py-0.5 rounded w-fit uppercase font-bold inline-flex items-center gap-0.5 transition-all ${
                                              cve.source === 'osv'     ? 'bg-green-150 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50' :
                                              cve.source === 'nvd-cpe' ? 'bg-blue-150 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50' :
                                              cve.source === 'shodan'  ? 'bg-purple-150 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50' :
                                                                         'bg-gray-150 text-gray-750 hover:bg-gray-200'
                                            }`}
                                          >
                                            {cve.source}
                                            <ExternalLink size={8} className="shrink-0" />
                                          </a>
                                        )}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed font-sans">{cve.description || 'Keine Beschreibung'}</p>
                                        {cve.published && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{cve.published}</p>}
                                      </div>
                                      <div className="flex-shrink-0 self-center">
                                        <a
                                          href={cveUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="p-1.5 rounded-lg bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-200 dark:hover:border-blue-900/50 shadow-sm transition-all inline-flex items-center justify-center"
                                          title="Externe CVE-Seite öffnen"
                                        >
                                          <ExternalLink size={14} />
                                        </a>
                                      </div>
                                    </div>
                                  );
                                })}
                             </div>
                           </div>
                         )}
                       </>
                     ) : (
                       <p className="text-sm text-gray-400 dark:text-slate-500 italic py-6 text-center">
                         Das Schwachstellen-Modul (CVE) ist derzeit deaktiviert. Sie können es im Admin-Bereich unter "Module" aktivieren.
                       </p>
                     )}

                    <div className="pt-4 border-t dark:border-slate-800">
                       <p className="text-xs text-gray-400 dark:text-slate-500 mb-2 font-bold uppercase">Hardening Status (CIS / BSI)</p>
                       <div className="flex items-center gap-2">
                          {asset.hardening_status ? (
                            <><CheckCircle className="text-green-500" size={18}/> <span className="text-sm text-green-700 dark:text-green-400 font-bold">Konform</span></>
                          ) : (
                            <><AlertTriangle className="text-red-500" size={18}/> <span className="text-sm text-red-700 dark:text-red-400 font-bold">Abweichung</span></>
                          )}
                       </div>
                    </div>
                 </CardBody>
              </Card>}
              <Card>
                 <CardHeader><h2 className="font-semibold dark:text-white">Datensicherung (Backup)</h2></CardHeader>
                 <CardBody className="space-y-4">
                    <div className="flex flex-col gap-1">
                       <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold">Zugeordneter Plan</span>
                       <span className="text-sm font-medium dark:text-slate-200">{asset.backup_plan || 'Kein Backup-Plan zugeordnet'}</span>
                    </div>
                    <div className="flex flex-col gap-1 pt-3 border-t dark:border-slate-800">
                       <span className="text-xs text-gray-500 dark:text-slate-500 uppercase font-bold">Letzter Restore-Test</span>
                       <span className={`text-sm ${asset.last_restore_test ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} font-bold`}>
                         {asset.last_restore_test ? format(new Date(asset.last_restore_test), 'dd.MM.yyyy') : 'Noch nie getestet!'}
                       </span>
                    </div>
                 </CardBody>
              </Card>
           </div>
        )}

        {tab === 'vvt' && isEnabled('dsgvo') && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen size={18} className="text-blue-500"/>
                  <h2 className="font-semibold dark:text-white">Zugeordnete Verarbeitungstätigkeiten (VVT)</h2>
                </div>
                {!isViewer && (isDpo || isAssessor) && (
                  <Button size="sm" onClick={() => { setVvtCreateMode(false); setVvtAddModalOpen(true); }}><Plus size={14}/>VVT erfassen / verknüpfen</Button>
                )}
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {(!asset.vvtEntries || asset.vvtEntries.length === 0) ? (
                <div className="text-center py-12">
                   <BookOpen size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3 opacity-30" />
                   <p className="text-sm text-gray-400 dark:text-slate-500 italic">Dieses Asset ist aktuell in keinem VVT-Eintrag verzeichnet.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {asset.vvtEntries.map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold dark:text-slate-200">{v.name}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 truncate max-w-lg">{v.purpose}</p>
                        <div className="flex items-center gap-2 mt-2">
                           <span className="text-[10px] font-mono text-gray-400">Ref: VVT-{String(v.id).padStart(3, '0')}</span>
                           <Badge size="xs" value={v.status === 'active' ? 'active' : v.status === 'draft' ? 'evaluation' : 'archived'} label={v.status} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <Button size="sm" variant="secondary" onClick={() => setVvtViewEntry(v)}><Eye size={14}/> Details</Button>
                        <Link to="/vvt"><Button size="sm" variant="ghost" title="Im VVT-Verzeichnis öffnen"><ArrowRight size={14}/></Button></Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {tab === 'incidents' && (
          <Card>
            <CardHeader><div className="flex items-center gap-2"><AlertOctagon size={18} className="text-red-500"/><h2 className="font-semibold dark:text-white">Asset-bezogene Vorfälle</h2></div></CardHeader>
            <CardBody className="p-0">
              {(!asset.incidents || asset.incidents.length === 0) ? (
                <p className="text-sm text-gray-400 dark:text-slate-500 italic p-6 text-center">Keine Vorfälle für dieses Asset bekannt.</p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {asset.incidents.map((i: any) => (
                    <Link key={i.id} to="/incidents" className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold dark:text-slate-200 truncate">{i.title}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5 uppercase font-mono">{i.ref} · {format(new Date(i.created_at), 'dd.MM.yyyy')}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        <Badge value={i.severity} label={i.severity} />
                        <span className="text-xs text-gray-500 dark:text-slate-400">{i.status}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {tab === 'compliance' && (
          <div className="space-y-6">
            <Card>
              <CardHeader><div className="flex items-center justify-between"><div className="flex items-center gap-2"><AlertTriangle size={18} className="text-red-500"/><h2 className="font-semibold dark:text-white">Verknüpfte Risiken ({linkedRisks.length})</h2></div><Link to="/risks" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Zum Risikoregister →</Link></div></CardHeader>
              <CardBody className="p-0">
                {linkedRisks.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-slate-500 italic p-6 text-center">Keine Risiken mit diesem Asset verknüpft.</p>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-slate-800">
                    {linkedRisks.map((r: any) => (
                      <Link key={r.id} to="/risks" className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                        <p className="text-sm font-medium dark:text-slate-200 truncate mr-3"><span className="font-mono text-xs text-gray-400 mr-2">{r.ref}</span>{r.title}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {r.inherent_level && <Badge value={r.inherent_level} label={riskLabels[r.inherent_level as RiskLevel] || r.inherent_level} />}
                          {r.residual_level && <><ChevronRight size={12} className="text-gray-300"/><Badge value={r.residual_level} label={riskLabels[r.residual_level as RiskLevel] || r.residual_level} /></>}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><div className="flex items-center gap-2"><Shield size={18} className="text-blue-500"/><h2 className="font-semibold dark:text-white">Datenschutz & DSGVO (DSMS)</h2></div></CardHeader>
                <CardBody className="space-y-6">
                  <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border dark:border-slate-700 space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">VVT-Status</span>
                      <Badge value={asset.vvt_status === 'complete' ? 'active' : asset.vvt_status === 'pending' ? 'evaluation' : 'archived'} label={vvtLabels[asset.vvt_status as keyof typeof vvtLabels]} />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">DSFA Erforderlich?</span>
                      <Badge value={asset.dsfa_required ? 'critical' : 'active'} label={asset.dsfa_required ? 'Ja (Erforderlich)' : 'Nein'} />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">Daten-Kategorie</span>
                      <Badge value={asset.data_category === 'special' ? 'high' : asset.data_category === 'normal' ? 'internal' : 'archived'} label={dataCatLabels[asset.data_category as keyof typeof dataCatLabels]} />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest px-1">Verknüpfte Datenschutz-Nachweise</p>
                    <div className="divide-y dark:divide-slate-800 border dark:border-slate-800 rounded-lg overflow-hidden">
                      {visiblePolicies.filter((p: any) => p.category === 'dpa' || p.title.toLowerCase().includes('datenschutz')).length > 0 ? (
                        visiblePolicies.filter((p: any) => p.category === 'dpa' || p.title.toLowerCase().includes('datenschutz')).map((p: any) => (
                          <div key={p.id} className="p-3 text-sm flex items-center justify-between bg-white dark:bg-slate-900">
                             <div className="flex items-center gap-2">
                               <FileText size={14} className="text-purple-500"/>
                               <span className="dark:text-slate-300">{p.title}</span>
                             </div>
                             <Badge value="internal" label={`v${p.version}`} />
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-xs text-gray-400 italic">Keine expliziten Datenschutz-Dokumente verknüpft.</div>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader><div className="flex items-center gap-2"><ListChecks size={18} className="text-blue-500"/><h2 className="font-semibold dark:text-white">Framework-Compliance</h2></div></CardHeader>
                <CardBody className="space-y-4">
                  <div className="space-y-3">
                    {['iso27001', 'nis2', 'gdpr'].map(fw => (
                      <div key={fw} className="flex items-center justify-between p-3 rounded-lg border dark:border-slate-800 bg-white dark:bg-slate-900/50">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${safeFrameworks.includes(fw as any) ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-300'}`} />
                          <span className="text-sm font-medium dark:text-slate-300">{fwLabels[fw]}</span>
                        </div>
                        {safeFrameworks.includes(fw as any) ? (
                          <CheckCircle size={16} className="text-green-500" />
                        ) : (
                          <span className="text-[10px] text-gray-400 uppercase font-bold">Nicht relevant</span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-700 dark:text-slate-300 flex items-center gap-2">
                  <Shield size={18} className="text-blue-500" />
                  Zugeordnete Dokumente aus der Bibliothek
                </h3>
              </div>
              <Card>
                <CardBody className="p-0">
                  {(!visiblePolicies || visiblePolicies.length === 0) ? (
                    <div className="text-center py-8 text-gray-400 dark:text-slate-500 italic text-sm">Keine Dokumente aus der Bibliothek verknüpft.</div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-slate-800 text-sm">
                      {visiblePolicies.map((p: any) => (
                        <div key={p.id} className="flex items-center gap-4 px-6 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                          <div className="p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400">
                            <FileText size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate dark:text-slate-200">{p.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{p.code || 'Kein Kürzel'}</span>
                              <span className="text-gray-300">·</span>
                              <Badge value={p.category} label={catLabels[p.category] || p.category} />
                              <span className="text-gray-300">·</span>
                              <span className="text-[10px] text-gray-400">v{p.version} {p.valid_from ? `(Ab ${format(new Date(p.valid_from), 'dd.MM.yy')})` : ''}</span>
                            </div>
                            {p.history && p.history.length > 0 && (
                               <div className="mt-2 pl-4 border-l-2 border-slate-200 dark:border-slate-800 space-y-1">
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mb-1">Archivierte Versionen:</p>
                                  {p.history.map((h: any) => (
                                    <div key={h.id} className="flex items-center gap-2 text-[10px] text-gray-500">
                                       <span className="font-bold">v{h.version}</span>
                                       <span className="text-gray-300">·</span>
                                       <span>{format(new Date(h.created_at), 'dd.MM.yy HH:mm')}</span>
                                       {h.original_filename?.toLowerCase().endsWith('.pdf') && (
                                          <button onClick={() => handleViewPdf(`/policies/${p.id}/versions/${h.id}/download?inline=true`)} className="text-blue-500 hover:underline flex items-center gap-1"><Eye size={10}/> Ansehen</button>
                                       )}
                                       <a href={`/api/policies/${p.id}/versions/${h.id}/download`} target="_blank" rel="noreferrer" className="text-gray-500 hover:underline flex items-center gap-1"><Download size={10}/> Speichern</a>
                                    </div>
                                  ))}
                               </div>
                            )}
                          </div>
                          {p.file_url && (
                            <div className="flex gap-1">
                              {p.original_filename?.toLowerCase().endsWith('.pdf') && (
                                 <Button size="sm" variant="secondary" onClick={() => handleViewPdf(`/policies/${p.id}/download?inline=true`)} title="Ansehen"><Eye size={14} /></Button>
                              )}
                              <a href={`/api/policies/${p.id}/download`} target="_blank" rel="noreferrer">
                                <Button size="sm" variant="secondary" title="Herunterladen"><Download size={14} /></Button>
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-700 dark:text-slate-300 flex items-center gap-2">
                  <FileText size={18} className="text-blue-500" />
                  Asset-spezifische Dateien (Uploads)
                </h3>
                {!isViewer && (
                  <Button size="sm" onClick={() => setDocModalOpen(true)}><Upload size={14} />Hochladen</Button>
                )}
              </div>
              <Card>
                <CardBody className="p-0">
                  {visibleDocs.length === 0 ? (
                    <div className="text-center py-12">
                      <FileText size={40} className="mx-auto text-gray-300 dark:text-slate-700 mb-3 opacity-30" />
                      <p className="text-gray-400 dark:text-slate-500 italic text-sm">Noch keine lokalen Dateien hochgeladen</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 dark:divide-slate-800">
                      {visibleDocs.map(doc => (
                        <div key={doc.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors text-sm">
                          <FileText size={18} className="text-gray-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate dark:text-slate-200">{doc.original_name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-sm ${catColors[doc.category as keyof typeof catColors] || 'bg-gray-100'}`}>{catLabels[doc.category] || doc.category}</span>
                              <span className="text-gray-300">·</span>
                              <span className="text-xs text-gray-400 dark:text-slate-500">Uploader: {doc.uploader?.name}</span>
                            </div>
                          </div>
                          <div className="flex gap-1 text-sm">
                            {doc.original_name?.toLowerCase().endsWith('.pdf') && (
                               <Button size="sm" variant="secondary" onClick={() => handleViewPdf(`/assets/${id}/documents/${doc.id}/download?inline=true`)} title="Ansehen"><Eye size={14} /></Button>
                            )}
                            <a href={`/api/assets/${id}/documents/${doc.id}/download`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary" title="Herunterladen"><Download size={14} /></Button></a>
                            {!isViewer && (user?.role === 'admin' || user?.id === doc.uploader?.id) && (
                              <Button size="sm" variant="danger" title="Löschen" onClick={async () => { if (confirm('Datei wirklich löschen?')) { await api.delete(`/assets/${id}/documents/${doc.id}`); loadDocs(); } }}><Trash2 size={14}/></Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {tab === 'comments' && (
           <Card>
             <CardBody>
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                   {comments.filter(c => !c.parent_id).map(c => (
                     <div key={c.id} className="space-y-3">
                       {/* Parent Comment */}
                       <div id={`comment-${c.id}`} className="flex gap-4 p-4 bg-gray-50 dark:bg-slate-800/30 rounded-xl border dark:border-slate-800/50">
                          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center font-bold text-blue-700 dark:text-blue-400 shrink-0 shadow-xs">{c.author?.name?.charAt(0)}</div>
                          <div className="flex-1 min-w-0">
                             <p className="text-sm font-bold dark:text-slate-200 flex items-center justify-between">
                               <span>{c.author?.name} <span className="text-[10px] font-normal text-gray-400 bg-gray-100 dark:bg-slate-800 px-1.5 py-0.5 rounded ml-2 uppercase tracking-wider">{c.author?.role}</span></span>
                               <span className="text-[10px] font-normal text-gray-400 dark:text-slate-500">{format(new Date(c.created_at), 'dd.MM.yyyy HH:mm')}</span>
                             </p>
                             <div className="text-sm text-gray-600 dark:text-slate-400 mt-2 leading-relaxed">
                                <MarkdownText text={c.content} />
                             </div>
                             <div className="mt-2 flex items-center gap-4">
                               <button onClick={() => setReplyingTo(c)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Antworten</button>
                             </div>
                          </div>
                          {!isViewer && (user?.role === 'admin' || user?.id === c.user_id) && (
                            <button onClick={async () => { if(confirm('Kommentar wirklich löschen?')) { await api.delete(`/assets/${id}/comments/${c.id}`); loadComments(); } }} className="text-gray-400 hover:text-red-500 transition-colors self-start"><Trash2 size={14}/></button>
                          )}
                       </div>

                       {/* Child Comments (Replies) */}
                       {comments.filter(reply => reply.parent_id === c.id).length > 0 && (
                         <div className="pl-12 space-y-3 relative before:absolute before:left-6 before:top-0 before:bottom-6 before:w-px before:bg-gray-200 dark:before:bg-slate-700">
                           {comments.filter(reply => reply.parent_id === c.id).map(reply => (
                             <div key={reply.id} id={`comment-${reply.id}`} className="flex gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 relative">
                               <div className="absolute -left-6 top-6 w-6 h-px bg-gray-200 dark:bg-slate-700"></div>
                               <div className="w-8 h-8 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center font-bold text-teal-700 dark:text-teal-400 shrink-0 shadow-xs text-xs">{reply.author?.name?.charAt(0)}</div>
                               <div className="flex-1 min-w-0">
                                 <p className="text-xs font-bold dark:text-slate-200 flex items-center justify-between">
                                   <span>{reply.author?.name}</span>
                                   <span className="text-[10px] font-normal text-gray-400 dark:text-slate-500">{format(new Date(reply.created_at), 'dd.MM.yyyy HH:mm')}</span>
                                 </p>
                                 <div className="text-xs text-gray-600 dark:text-slate-400 mt-1 leading-relaxed">
                                    <MarkdownText text={reply.content} />
                                 </div>
                               </div>
                               {!isViewer && (user?.role === 'admin' || user?.id === reply.user_id) && (
                                  <button onClick={async () => { if(confirm('Antwort wirklich löschen?')) { await api.delete(`/assets/${id}/comments/${reply.id}`); loadComments(); } }} className="text-gray-300 hover:text-red-500 transition-colors self-start"><Trash2 size={12}/></button>
                               )}
                             </div>
                           ))}
                         </div>
                       )}
                     </div>
                   ))}
                   {comments.length === 0 && <div className="text-center py-12 text-gray-400 italic">Noch keine Kommentare vorhanden.</div>}
                </div>
                {!isViewer && (
                  <form onSubmit={handleComment} className="mt-6 pt-6 border-t dark:border-slate-800">
                    {replyingTo && (
                      <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/50 rounded flex justify-between items-center text-xs">
                        <span className="text-blue-700 dark:text-blue-300">
                          Antwort auf <span className="font-bold">{replyingTo.author?.name}</span>: <span className="italic">"{replyingTo.content.substring(0, 50)}{replyingTo.content.length > 50 ? '...' : ''}"</span>
                        </span>
                        <button type="button" onClick={() => setReplyingTo(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-white"><X size={14}/></button>
                      </div>
                    )}
                    <div className="flex items-center gap-1 mb-2">
                       <button type="button" onClick={() => insertAtCursor('**fett**')} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-500" title="Fett"><Bold size={16}/></button>
                       <button type="button" onClick={() => insertAtCursor('*kursiv*')} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-500" title="Kursiv"><Italic size={16}/></button>
                       <button type="button" onClick={() => insertAtCursor('[Link](https://...)')} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-500" title="Link"><LinkIcon size={16}/></button>
                       <button type="button" onClick={() => setLinkDocModalOpen(true)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-500" title="Datei verlinken"><Paperclip size={16}/></button>
                       <button
                         type="button"
                         onClick={() => {
                           insertAtCursor('@');
                           setTimeout(() => {
                             if (commentInputRef.current) {
                               checkMentions(commentInputRef.current.value, commentInputRef.current.selectionStart);
                             }
                           }, 50);
                         }}
                         className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-500"
                         title="Nutzer erwähnen"
                       >
                         <AtSign size={16} />
                       </button>
                    </div>
                    <div className="relative">
                      <textarea
                        ref={commentInputRef}
                        className="w-full bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-4 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden transition-all shadow-xs"
                        rows={4}
                        placeholder="Schreiben Sie einen Kommentar... (Markdown unterstützt, @Nutzer für Erwähnung)"
                        value={comment}
                        onChange={e => {
                          setComment(e.target.value);
                          checkMentions(e.target.value, e.target.selectionStart);
                        }}
                        onSelect={e => {
                          const target = e.target as HTMLTextAreaElement;
                          checkMentions(target.value, target.selectionStart);
                        }}
                        onKeyUp={e => {
                          const target = e.target as HTMLTextAreaElement;
                          checkMentions(target.value, target.selectionStart);
                        }}
                        onKeyDown={e => {
                          if (mentionSearch !== null) {
                            const filtered = activeUsers.filter(u => 
                              u.name.toLowerCase().includes(mentionSearch.toLowerCase())
                            );
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setMentionSearch(null);
                              setMentionIndex(-1);
                              return;
                            }
                            if (filtered.length > 0) {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setMentionHighlightIndex(prev => (prev + 1) % filtered.length);
                                return;
                              } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setMentionHighlightIndex(prev => (prev - 1 + filtered.length) % filtered.length);
                                return;
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                insertMention(filtered[mentionHighlightIndex].name);
                                return;
                              }
                            }
                          }
                        }}
                      />
                      {mentionSearch !== null && (
                        <div className="absolute left-4 bottom-full mb-1 w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl z-50 p-2 max-h-48 overflow-y-auto animate-fade-in">
                          <p className="text-[10px] font-bold text-gray-400 uppercase px-2 mb-1">Benutzer erwähnen</p>
                          {activeUsers.filter(u => u.name.toLowerCase().includes(mentionSearch.toLowerCase())).map((u, i) => (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => insertMention(u.name)}
                              className={`w-full text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 dark:text-slate-300 transition-colors ${
                                i === mentionHighlightIndex
                                  ? 'bg-blue-500 text-white dark:bg-blue-600 font-semibold'
                                  : 'hover:bg-gray-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                                i === mentionHighlightIndex
                                  ? 'bg-white/20 text-white'
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                              }`}>
                                {u.name.charAt(0)}
                              </span>
                              <span className="flex-1 truncate">{u.name}</span>
                              <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded ${
                                i === mentionHighlightIndex
                                  ? 'bg-white/20 text-white'
                                  : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
                              }`}>{u.role}</span>
                            </button>
                          ))}
                          {activeUsers.filter(u => u.name.toLowerCase().includes(mentionSearch.toLowerCase())).length === 0 && (
                            <p className="text-xs text-gray-400 italic px-2 py-1">Keine passenden Benutzer</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row justify-between items-center mt-3 gap-3">
                       <div className="flex items-center gap-3 w-full sm:w-auto">
                          <Input type="date" label="Termin-Bezug" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} className="!py-1" />
                          <p className="text-[10px] text-gray-400 italic hidden sm:block">Nutzen Sie @Nutzername für Erwähnungen.</p>
                       </div>
                       <Button type="submit" disabled={!comment.trim() || saving} className="w-full sm:w-auto">{saving ? 'Speichern...' : 'Kommentar posten'}</Button>
                    </div>
                  </form>
                )}
             </CardBody>
           </Card>
        )}
      </div>

      <Modal open={docModalOpen} onClose={() => setDocModalOpen(false)} title="Dokument hochladen" size="md">
        <form onSubmit={handleUpload} className="space-y-4">
          <Select label="Kategorie *" value={docForm.category} onChange={e => setDocForm({ ...docForm, category: e.target.value })} options={Object.entries(catLabels).map(([v, l]) => ({ value: v, label: l }))} required />
          <Input label="Beschreibung" value={docForm.description} onChange={e => setDocForm({ ...docForm, description: e.target.value })} placeholder="Optional..." />
          <div className="p-4 bg-gray-50 dark:bg-slate-800/50 rounded-xl border-2 border-dashed dark:border-slate-700">
             <input type="file" onChange={e => setDocFile(e.target.files?.[0] || null)} required className="text-sm dark:text-slate-300" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setDocModalOpen(false)} className="flex-1">Abbrechen</Button>
            <Button type="submit" disabled={saving || !docFile} className="flex-1">{saving ? 'Hochladen...' : 'Jetzt hochladen'}</Button>
          </div>
        </form>
      </Modal>

      {/* Modal 1: Stammdaten & Governance */}
      <Modal open={editSection === 'basics'} onClose={() => setEditSection(null)} title="Stammdaten bearbeiten" size="xl">
        <form onSubmit={handleEdit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Input label="Asset-Name *" value={editForm.name || ''} onChange={e => setEditForm({ ...editForm, name: e.target.value })} required />
            </div>
            <Select label="Asset-Typ *" value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })} options={Object.entries(typeLabels).map(([v, l]) => ({ value: v, label: l }))} />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Beschreibung / Einsatzzweck</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} placeholder="Kurze Beschreibung des Assets und dessen Funktion im Unternehmen..." />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select label="Klassifizierung *" value={editForm.classification || 'internal'} onChange={e => setEditForm({ ...editForm, classification: e.target.value })} options={Object.entries(classLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Select label="Hosting *" value={editForm.hosting_type} onChange={e => setEditForm({ ...editForm, hosting_type: e.target.value })} options={Object.entries(hostingLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <InputSelect
              label="Standort"
              value={editForm.location || ''}
              onChange={val => setEditForm({ ...editForm, location: val })}
              options={locations}
              placeholder="z. B. Rechenzentrum A, Cloud Region..."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select label="Lebenszyklus *" value={editForm.lifecycle_status} onChange={e => setEditForm({ ...editForm, lifecycle_status: e.target.value })} options={Object.entries(lifecycleLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Select label="Betriebs-Status *" value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} options={[{ value: 'active', label: 'Aktiv' }, { value: 'inactive', label: 'Inaktiv' }, { value: 'decommissioned', label: 'Außer Betrieb' }]} />
            <Input label="Version / Revision" value={editForm.version || ''} onChange={e => setEditForm({ ...editForm, version: e.target.value })} placeholder="z. B. 2.4.1" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input label="Hersteller / Vendor" value={editForm.vendor || ''} onChange={e => setEditForm({ ...editForm, vendor: e.target.value })} placeholder="z. B. Microsoft, Cisco..." />
            <Select label="Asset Owner *" value={String(editForm.owner_id || '')} onChange={e => setEditForm({ ...editForm, owner_id: e.target.value })} options={activeUsers.map(u => ({ value: String(u.id), label: u.name }))} />
            <Select label="Systemverantwortlicher *" value={String(editForm.assessor_id || '')} onChange={e => setEditForm({ ...editForm, assessor_id: e.target.value })} options={activeUsers.map(u => ({ value: String(u.id), label: u.name }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label="Dienstleister (Supply Chain)" value={String(editForm.vendor_id || '')} onChange={e => setEditForm({ ...editForm, vendor_id: e.target.value })} options={[{ value: '', label: 'Kein Dienstleister' }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]} />
            <SearchableSelect label="Übergeordnetes Asset (Topologie)" value={String(editForm.parent_id || '')} onChange={v => setEditForm({ ...editForm, parent_id: v })} placeholder="Eigenständig (Top-Level)" options={[{ value: '', label: 'Eigenständig (Top-Level)' }, ...allAssets.filter(a => a.id !== asset.id).map(a => ({ value: String(a.id), label: a.name }))]} />
          </div>

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setEditSection(null)} className="flex-1">Abbrechen</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? 'Speichern…' : 'Speichern'}</Button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Compliance & Datenschutz */}
      <Modal open={editSection === 'compliance'} onClose={() => setEditSection(null)} title="Compliance & Datenschutz bearbeiten" size="xl">
        <form onSubmit={handleEdit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Input label="RTO (Wiederanlaufzeit)" value={editForm.rto || ''} onChange={e => setEditForm({ ...editForm, rto: e.target.value })} placeholder="z. B. 4h" />
              <p className="text-[10px] text-gray-400 mt-1">Recovery Time Objective: Maximale Ausfallzeit.</p>
            </div>
            <div>
              <Input label="RPO (Datenverlust-Toleranz)" value={editForm.rpo || ''} onChange={e => setEditForm({ ...editForm, rpo: e.target.value })} placeholder="z. B. 1h" />
              <p className="text-[10px] text-gray-400 mt-1">Recovery Point Objective: Max. Datenverlust.</p>
            </div>
            <div>
              <Input label="SDO (Dienstbereitstellungszeit)" value={editForm.sdo || ''} onChange={e => setEditForm({ ...editForm, sdo: e.target.value })} placeholder="z. B. 24h oder 50%" />
              <p className="text-[10px] text-gray-400 mt-1">Service Delivery Objective: Dienstbereitstellungszeit im Notbetrieb.</p>
            </div>
            <div>
              <Input label="MTO (Maximal tolerierbare Ausfallzeit)" value={editForm.mto || ''} onChange={e => setEditForm({ ...editForm, mto: e.target.value })} placeholder="z. B. 48h" />
              <p className="text-[10px] text-gray-400 mt-1">Maximum Tolerable Outage: Maximal tolerierbare Ausfallzeit.</p>
            </div>
            <div>
              <Input label="IoA (Angriffskennzahlen)" value={editForm.ioa || ''} onChange={e => setEditForm({ ...editForm, ioa: e.target.value })} placeholder="z. B. Login-Fehlversuche, Traffic-Spikes" />
              <p className="text-[10px] text-gray-400 mt-1">Indicators of Attack: Angriffskennzahlen.</p>
            </div>
            <div>
              <Select label="Daten-Kategorie" value={editForm.data_category || 'none'} onChange={e => setEditForm({ ...editForm, data_category: e.target.value })} options={Object.entries(dataCatLabels).map(([v, l]) => ({ value: v, label: l }))} />
              <p className="text-[10px] text-gray-400 mt-1">„Besonders" = Art. 9 DSGVO.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Status & Pflichten</label>
              <div className="space-y-3">
                <Select label="VVT-Status (DSGVO)" value={editForm.vvt_status || 'none'} onChange={e => setEditForm({ ...editForm, vvt_status: e.target.value })} options={Object.entries(vvtLabels).map(([v, l]) => ({ value: v, label: l }))} />
                
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Verknüpfte VVT-Einträge</label>
                  <div className="max-h-40 overflow-y-auto bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg p-2 space-y-1 custom-scrollbar">
                    {vvtEntriesList.length === 0 ? (
                      <p className="text-xs text-gray-400 p-2">Keine VVT-Einträge gefunden.</p>
                    ) : vvtEntriesList.map(v => (
                      <label key={v.id} className="flex items-center gap-2 p-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 rounded cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={editVvtIds.includes(v.id)} 
                          onChange={(e) => {
                            if (e.target.checked) setEditVvtIds([...editVvtIds, v.id]);
                            else setEditVvtIds(editVvtIds.filter(id => id !== v.id));
                          }}
                          className="w-4 h-4 rounded text-blue-600" 
                        />
                        <span className="text-xs dark:text-slate-300">{v.name}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-gray-50 dark:bg-slate-800/30 border dark:border-slate-800 space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={!!editForm.dsfa_required} onChange={e => setEditForm({ ...editForm, dsfa_required: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
                    <span className="text-sm font-bold dark:text-slate-300">DSFA erforderlich (Art. 35)</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={!!editForm.nis2_relevant} onChange={e => setEditForm({ ...editForm, nis2_relevant: e.target.checked })} className="w-4 h-4 rounded text-orange-600" />
                    <span className="text-sm font-bold dark:text-slate-300">NIS-2 relevant</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setEditSection(null)} className="flex-1">Abbrechen</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? 'Speichern…' : 'Speichern'}</Button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Security Status */}
      <Modal open={editSection === 'security'} onClose={() => setEditSection(null)} title="Security Status bearbeiten" size="xl">
        <form onSubmit={handleEdit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Select label="Patch-Status" value={editForm.patch_status || 'up-to-date'} onChange={e => setEditForm({ ...editForm, patch_status: e.target.value })} options={Object.entries(patchStatusLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <Input label="EOL-Datum" type="date" value={editForm.eol_date ? String(editForm.eol_date).split('T')[0] : ''} onChange={e => setEditForm({ ...editForm, eol_date: e.target.value })} />
            <label className="flex items-center gap-3 p-3 rounded-xl border bg-green-50/50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30 cursor-pointer h-[58px] mt-6">
              <input type="checkbox" checked={!!editForm.hardening_status} onChange={e => setEditForm({ ...editForm, hardening_status: e.target.checked })} className="w-4 h-4 rounded text-green-600" />
              <span className="text-sm font-medium text-green-800 dark:text-green-400 leading-tight">Hardening (CIS/BSI) erfüllt</span>
            </label>
          </div>
          
          {isEnabled('discovery') && (
            <>
              <div className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/10">
                <h3 className="text-xs font-bold uppercase text-gray-500 mb-3">Schwachstellen (CVE)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                  <Input label="Kritisch" type="number" value={editForm.cve_critical ?? 0} onChange={e => setEditForm({ ...editForm, cve_critical: parseInt(e.target.value) || 0 })} />
                  <Input label="Hoch" type="number" value={editForm.cve_high ?? 0} onChange={e => setEditForm({ ...editForm, cve_high: parseInt(e.target.value) || 0 })} />
                  <Input label="Mittel" type="number" value={editForm.cve_medium ?? 0} onChange={e => setEditForm({ ...editForm, cve_medium: parseInt(e.target.value) || 0 })} />
                  <Input label="Niedrig" type="number" value={editForm.cve_low ?? 0} onChange={e => setEditForm({ ...editForm, cve_low: parseInt(e.target.value) || 0 })} />
                </div>
                <Input
                  label="CVE-Suchanfrage (optional, überschreibt Keyword-Suche)"
                  value={editForm.cve_search_query || ''}
                  onChange={e => setEditForm({ ...editForm, cve_search_query: e.target.value })}
                  placeholder={`Automatisch: ${[asset.vendor, asset.version].filter(Boolean).join(' ') || asset.name || '—'}`}
                />
              </div>

              <div className="p-4 rounded-xl border dark:border-slate-800 bg-blue-50/30 dark:bg-blue-900/5 space-y-3">
                <h3 className="text-xs font-bold uppercase text-blue-600 dark:text-blue-400 mb-1">Phase 1 — CPE (NVD, versions-genau)</h3>
                
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input
                      label="NVD-Katalog nach Produkt/Gerät durchsuchen (z. B. 'unifi udm pro')"
                      value={cpeSearchQuery}
                      onChange={e => setCpeSearchQuery(e.target.value)}
                      placeholder="Gerätename oder Begriff eingeben..."
                    />
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => resolveCPE(cpeSearchQuery)} disabled={cpeResolving || cpeSearchQuery.trim().length < 3} className="mb-0.5 whitespace-nowrap">
                    {cpeResolving ? 'Wird gesucht…' : 'CPE Suchen'}
                  </Button>
                </div>

                <div className="flex gap-2 items-end border-t dark:border-slate-800 pt-3">
                  <div className="flex-1">
                    <Input
                      label="CPE 2.3 (auto-aufgelöst oder manuell)"
                      value={editForm.cpe || ''}
                      onChange={e => setEditForm({ ...editForm, cpe: e.target.value })}
                      placeholder="cpe:2.3:a:vendor:product"
                    />
                    {(editForm.cpe_title || asset.cpe_title) && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                        Produkt: {editForm.cpe_title || asset.cpe_title}
                      </p>
                    )}
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => resolveCPE()} disabled={cpeResolving} className="mb-0.5 whitespace-nowrap">
                    {cpeResolving ? 'Wird gesucht…' : 'Auto-auflösen'}
                  </Button>
                </div>

                {/* CPE Suggestion Picker */}
                {cpeSuggestions.length > 0 && (
                  <div className="border border-blue-200 dark:border-blue-800 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-blue-100 dark:bg-blue-900/40">
                      <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                        {cpeSuggestions.length} Treffer gefunden — bitte das passende Produkt wählen:
                      </span>
                      <button
                        type="button"
                        onClick={() => setCpeSuggestions([])}
                        className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-200 text-xs px-1"
                        aria-label="Schließen"
                      >✕</button>
                    </div>
                    <ul className="divide-y divide-blue-100 dark:divide-blue-900/30 max-h-64 overflow-y-auto">
                      {cpeSuggestions.map((s, i) => (
                        <li key={s.cpe}>
                          <button
                            type="button"
                            onClick={() => selectCPE(s.cpe, s.title)}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                          >
                            <div className="flex items-center gap-2">
                              {i === 0 && (
                                <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500 text-white">Bester Treffer</span>
                              )}
                              <span className="font-medium text-sm text-gray-900 dark:text-white group-hover:text-blue-700 dark:group-hover:text-blue-300">
                                {s.title}
                              </span>
                            </div>
                            <span className="block text-[11px] text-gray-400 dark:text-slate-500 font-mono mt-0.5">{s.cpe}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {asset.cpe_resolved_at && (
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    Zuletzt aufgelöst: {format(new Date(asset.cpe_resolved_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </p>
                )}
              </div>

              <div className="p-4 rounded-xl border dark:border-slate-800 bg-green-50/30 dark:bg-green-900/5 space-y-3">
                <h3 className="text-xs font-bold uppercase text-green-600 dark:text-green-400 mb-1">Phase 2 — OSV.dev (Open-Source-Pakete, exakt)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Paketname"
                    value={editForm.package_name || ''}
                    onChange={e => setEditForm({ ...editForm, package_name: e.target.value })}
                    placeholder="z. B. lodash, django, log4j"
                  />
                  <Select
                    label="Ökosystem"
                    value={editForm.package_ecosystem || ''}
                    onChange={e => setEditForm({ ...editForm, package_ecosystem: e.target.value })}
                    options={[
                      { value: '', label: '— kein Paket —' },
                      { value: 'npm', label: 'npm (Node.js)' },
                      { value: 'PyPI', label: 'PyPI (Python)' },
                      { value: 'Maven', label: 'Maven (Java)' },
                      { value: 'Go', label: 'Go' },
                      { value: 'NuGet', label: 'NuGet (.NET)' },
                      { value: 'RubyGems', label: 'RubyGems (Ruby)' },
                      { value: 'crates.io', label: 'crates.io (Rust)' },
                      { value: 'Packagist', label: 'Packagist (PHP)' },
                      { value: 'Hex', label: 'Hex (Erlang/Elixir)' },
                      { value: 'Pub', label: 'Pub (Dart/Flutter)' },
                    ]}
                  />
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Backup-Plan" value={editForm.backup_plan || ''} onChange={e => setEditForm({ ...editForm, backup_plan: e.target.value })} placeholder="z. B. Veeam Backup v12" />
            <Input label="Letzter Restore-Test" type="date" value={editForm.last_restore_test ? String(editForm.last_restore_test).split('T')[0] : ''} onChange={e => setEditForm({ ...editForm, last_restore_test: e.target.value })} />
          </div>

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setEditSection(null)} className="flex-1">Abbrechen</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? 'Speichern…' : 'Speichern'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={linkDocModalOpen} onClose={() => setLinkDocModalOpen(false)} title="Dokument verlinken" size="md">
         <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-slate-400">Wählen Sie ein Dokument aus, um es als Link in den Kommentar einzufügen:</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
               {(asset.policies || []).length === 0 && documents.length === 0 && (
                 <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6 italic">Keine Dokumente vorhanden.</p>
               )}
               {(asset.policies || []).map((p: any) => (
                 <button key={`pol-${p.id}`} onClick={() => {
                   insertAtCursor(`[${p.title || 'Richtlinie'}](/api/policies/${p.id}/download)`);
                   setLinkDocModalOpen(false);
                 }} className="w-full text-left p-3 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg border dark:border-slate-800 flex items-center gap-3 transition-colors">
                    <BookOpen size={16} className="text-purple-500 flex-shrink-0"/>
                    <div>
                      <span className="text-sm font-medium dark:text-slate-300 block">{p.title || 'Richtlinie'}</span>
                      <span className="text-xs text-gray-400 dark:text-slate-500">Richtlinie</span>
                    </div>
                 </button>
               ))}
               {documents.map(d => (
                 <button key={`doc-${d.id}`} onClick={() => {
                   insertAtCursor(`[${d.original_name}](/api/assets/${id}/documents/${d.id}/download)`);
                   setLinkDocModalOpen(false);
                 }} className="w-full text-left p-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg border dark:border-slate-800 flex items-center gap-3 transition-colors">
                    <FileText size={16} className="text-blue-500 flex-shrink-0"/>
                    <div>
                      <span className="text-sm font-medium dark:text-slate-300 block">{d.original_name}</span>
                      {(d as any).category && <span className="text-xs text-gray-400 dark:text-slate-500">{(catLabels as any)[(d as any).category] || (d as any).category}</span>}
                    </div>
                 </button>
               ))}
            </div>
            <Button variant="secondary" onClick={() => setLinkDocModalOpen(false)} className="w-full">Abbrechen</Button>
         </div>
      </Modal>

      <Modal open={assessModalOpen} onClose={() => setAssessModalOpen(false)} title="Schutzbedarfsfeststellung" size="md">
        <form onSubmit={handleAssess} className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
          <section className="p-3 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 space-y-3">
            <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400">CIA-Bewertung</h3>
            {([['confidentiality', 'Vertraulichkeit (C)'], ['integrity', 'Integrität (I)'], ['availability', 'Verfügbarkeit (A)']] as const).map(([field, label]) => (
              <Select key={field} label={label} value={assessForm[field]} onChange={e => setAssessForm(f => ({ ...f, [field]: e.target.value }))} options={[1,2,3,4,5].map(n => ({ value: String(n), label: ratingLabels[n] }))} />
            ))}
          </section>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Feststellungen / Begründung</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} placeholder="Begründung der Einstufung…" value={assessForm.notes} onChange={e => setAssessForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <section className="p-3 rounded-xl border dark:border-slate-800 space-y-3">
            <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400">Risikobehandlung</h3>
            <Select label="Maßnahme" value={assessForm.risk_treatment} onChange={e => setAssessForm(f => ({ ...f, risk_treatment: e.target.value }))} options={Object.entries(treatmentLabels).map(([v, l]) => ({ value: v, label: l }))} />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Maßnahmenplan / Begründung</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} placeholder="Geplante Maßnahmen oder Begründung…" value={assessForm.mitigation} onChange={e => setAssessForm(f => ({ ...f, mitigation: e.target.value }))} />
            </div>
          </section>

          {assessForm.risk_treatment === 'accept' && (
            <section className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 space-y-3">
              <h3 className="text-xs font-bold uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1.5"><AlertTriangle size={13} /> Risikoakzeptanz – Pflichtfelder</h3>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Begründung der Akzeptanz <span className="text-red-500 font-bold ml-1">*</span></label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} required placeholder="Warum wird das Risiko akzeptiert?" value={assessForm.treatment_justification} onChange={e => setAssessForm(f => ({ ...f, treatment_justification: e.target.value }))} />
              </div>
              <Input label="Akzeptiert durch (Name / Funktion) *" value={assessForm.accepted_by} onChange={e => setAssessForm(f => ({ ...f, accepted_by: e.target.value }))} placeholder="z. B. Max Mustermann, CISO" required={assessForm.risk_treatment === 'accept'} />
              <Input label="Gültig bis" type="date" value={assessForm.accepted_until} onChange={e => setAssessForm(f => ({ ...f, accepted_until: e.target.value }))} />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Unterschriebenes Akzeptanz-Dokument <span className="text-red-500 font-bold ml-1">*</span> <span className="text-xs text-red-500">(Pflicht)</span></label>
                <input type="file" accept=".pdf,.docx,.doc" onChange={e => setRaDocFile(e.target.files?.[0] ?? null)} className="text-sm text-gray-600 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-300 hover:file:bg-blue-100" />
                {raDocFile && <p className="text-xs text-green-600 dark:text-green-400">{raDocFile.name} ausgewählt</p>}
              </div>
            </section>
          )}

          <div className="flex gap-3 pt-2 sticky bottom-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => { setAssessModalOpen(false); setRaDocFile(null); }} className="flex-1">Abbrechen</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? 'Speichern…' : 'Bewertung speichern'}</Button>
          </div>
        </form>
      </Modal>

      {/* PDF-Vorschau (authentifiziert via Blob-URL, funktioniert mit JWT/OIDC) */}
      <Modal open={!!pdfUrl} onClose={() => { if (pdfUrl) window.URL.revokeObjectURL(pdfUrl); setPdfUrl(null); }} title="Dokumentvorschau" size="lg">
        {pdfUrl && <iframe src={pdfUrl} title="PDF-Vorschau" className="w-full h-[75vh] rounded-lg border dark:border-slate-800 bg-white" />}
      </Modal>

      {/* VVT Add / Create Modal */}
      <Modal open={vvtAddModalOpen} onClose={() => setVvtAddModalOpen(false)} title={vvtCreateMode ? 'Neue Verarbeitungstätigkeit anlegen' : 'VVT verknüpfen'} size="xl">
        {!vvtCreateMode ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Wählen Sie einen bestehenden Eintrag aus oder legen Sie einen neuen an:</p>
              <Button size="sm" onClick={() => setVvtCreateMode(true)}><Plus size={14}/>Neuen Eintrag erstellen</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              {vvtEntriesList
                .filter(v => !asset.vvtEntries?.some((ex: any) => ex.id === v.id))
                .map(v => (
                <button key={v.id} onClick={() => handleVvtAdd(v.id)} className="text-left p-4 rounded-xl border dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group">
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-bold text-sm dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">{v.name}</p>
                    <Badge size="xs" value={v.status === 'active' ? 'active' : 'evaluation'} label={v.status} />
                  </div>
                  <p className="text-[11px] text-gray-400 line-clamp-2">{v.purpose}</p>
                </button>
              ))}
              {vvtEntriesList.filter(v => !asset.vvtEntries?.some((ex: any) => ex.id === v.id)).length === 0 && (
                <div className="col-span-2 text-center py-12 text-gray-400 italic">Keine weiteren VVTs zum Verknüpfen verfügbar.</div>
              )}
            </div>
            <div className="pt-4 border-t dark:border-slate-800 flex justify-end">
              <Button variant="secondary" onClick={() => setVvtAddModalOpen(false)}>Abbrechen</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleVvtCreate} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <div className="md:col-span-2">
                <Input label="Name der Tätigkeit *" value={vvtForm.name} onChange={v => setVvtForm({ ...vvtForm, name: v.target.value })} required placeholder="z. B. Personalverwaltung, Kunden-Newsletter..." />
              </div>
              <div className="md:col-span-2 flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Zweck der Verarbeitung</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={vvtForm.purpose} onChange={e => setVvtForm({ ...vvtForm, purpose: e.target.value })} />
              </div>
              <Input label="Rechtsgrundlage" value={vvtForm.legal_basis} onChange={v => setVvtForm({ ...vvtForm, legal_basis: v.target.value })} />
              <Select label="Status" value={vvtForm.status} onChange={v => setVvtForm({ ...vvtForm, status: v.target.value as any })} options={[{value: 'draft', label: 'Entwurf'}, {value: 'active', label: 'Aktiv'}, {value: 'archived', label: 'Archiviert'}]} />
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Datenkategorien</label>
                  <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={vvtForm.data_categories} onChange={e => setVvtForm({ ...vvtForm, data_categories: e.target.value })} placeholder="Name, E-Mail, etc." />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Betroffene Personen</label>
                  <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={vvtForm.data_subjects} onChange={e => setVvtForm({ ...vvtForm, data_subjects: e.target.value })} placeholder="Kunden, Mitarbeiter..." />
                </div>
              </div>
              <Select label="Interner Verantwortlicher" value={vvtForm.responsible_id} onChange={v => setVvtForm({ ...vvtForm, responsible_id: v.target.value })} options={[{ value: '', label: '– bitte wählen –' }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} />
              <Select label="Haupt-Auftragsverarbeiter" value={vvtForm.processor_id} onChange={v => setVvtForm({ ...vvtForm, processor_id: v.target.value })} options={[{ value: '', label: 'Keiner (Eigenverarbeitung)' }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]} />
            </div>
            <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
              <Button type="button" variant="secondary" onClick={() => setVvtCreateMode(false)} className="flex-1">Zurück zur Auswahl</Button>
              <Button type="submit" disabled={saving || !canWrite} className="flex-1">{saving ? 'Speichern...' : 'VVT erstellen & verknüpfen'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* VVT View Details Modal */}
      <Modal open={!!vvtViewEntry} onClose={() => setVvtViewEntry(null)} title="VVT Details" size="lg">
        {vvtViewEntry && (
          <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-slate-800/30 rounded-xl border dark:border-slate-800">
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Bezeichnung</p>
                <p className="text-sm font-bold dark:text-slate-200">{vvtViewEntry.name}</p>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-slate-800/30 rounded-xl border dark:border-slate-800">
                <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Status</p>
                <Badge value={vvtViewEntry.status === 'active' ? 'active' : 'evaluation'} label={vvtViewEntry.status} />
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-slate-800/30 rounded-xl border dark:border-slate-800">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Verarbeitungszweck</p>
              <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{vvtViewEntry.purpose || '–'}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border dark:border-slate-800 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase">Rechtsgrundlage</p>
                <p className="text-xs dark:text-slate-300">{vvtViewEntry.legal_basis || '–'}</p>
              </div>
              <div className="p-4 border dark:border-slate-800 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase">Löschfrist</p>
                <p className="text-xs dark:text-slate-300">{vvtViewEntry.retention_period || '–'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="p-4 border dark:border-slate-800 rounded-xl space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Datenkategorien</p>
                  <p className="text-xs dark:text-slate-300">{vvtViewEntry.data_categories || '–'}</p>
               </div>
               <div className="p-4 border dark:border-slate-800 rounded-xl space-y-1">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Betroffene Personen</p>
                  <p className="text-xs dark:text-slate-300">{vvtViewEntry.data_subjects || '–'}</p>
               </div>
            </div>

            <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30">
               <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase mb-2">Technische & organisatorische Maßnahmen (TOMs)</p>
               <p className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{vvtViewEntry.security_measures || 'Siehe IT-Sicherheitskonzept'}</p>
            </div>

            <div className="flex justify-end pt-4 border-t dark:border-slate-800">
               <Button onClick={() => setVvtViewEntry(null)}>Schließen</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
