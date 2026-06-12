import React, { useEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Download, FileSpreadsheet, Calendar, ArrowRight } from 'lucide-react';
import { FilterBar } from '../components/ui/FilterBar';
import api from '../lib/api';
import type { AuditLog as AuditLogType, AuditAction, AuditEntityType } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { exportToCSV, exportToExcel } from '../lib/export';

const actionLabels: Record<AuditAction, string> = {
  create: 'Erstellt', update: 'Bearbeitet', delete: 'Gelöscht',
  assess: 'Bewertet', login: 'Anmeldung', acknowledge: 'Bestätigt',
  deactivate: 'Deaktiviert', change_password: 'Passwort geändert', execute: 'Ausgeführt',
  seed: 'Katalog geladen', reseed: 'Katalog neu geladen',
};

const entityLabels: Record<AuditEntityType, string> = {
  asset: 'Asset', assessment: 'Bewertung', user: 'Benutzer',
  reminder: 'Erinnerung', auth: 'Authentifizierung', vendor: 'Dienstleister', document: 'Dokument',
  settings: 'Einstellung', risk: 'Risiko', control: 'Maßnahme', incident: 'Vorfall',
  audit_log: 'Audit-Log', dataflow: 'Datenfluss', task: 'Aufgabe', vvt: 'Datenschutz (VVT)',
  training: 'Schulung', user_training: 'Schulungszuweisung', training_contest: 'Quiz / Prüfung',
  kpi: 'KPI', kpi_measurement: 'KPI-Messung',
  audit: 'Audit / Prüfung', audit_finding: 'Audit-Befund',
  custom_role: 'Benutzerdefinierte Rolle', oidc_mapping: 'OIDC-Rollenmapping',
  iso27001_control: 'ISO 27001 Control', bsi_requirement: 'BSI Anforderung',
  tisax_requirement: 'TISAX Anforderung', tisax_assessment: 'TISAX Assessment',
  nis2_measure: 'NIS-2 Maßnahme', c5_criterion: 'C5 Kriterium',
  ai_system: 'KI-System (AI Act)',
  bcm_process: 'BCM Prozess', bcm_exercise: 'BCM Übung',
  dora_test: 'DORA Test', dora_third_party: 'DORA Drittpartei',
  pentest_project: 'Pentest', pentest_finding: 'Pentest-Befund',
  policy: 'Richtlinie / Dokument', legal_requirement: 'Rechtsanforderung',
  subject_request: 'Betroffenenanfrage', dsfa: 'DSFA', template: 'Vorlage',
};

const actionColors: Record<AuditAction, string> = {
  create: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  update: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  assess: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  login: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-400',
  acknowledge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  deactivate: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  change_password: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  execute: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  seed: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  reseed: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
};

const entityColors: Record<AuditEntityType, string> = {
  asset: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  assessment: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  user: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
  reminder: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  auth: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-500',
  vendor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  document: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  settings: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400',
  risk: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  control: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  incident: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  audit_log: 'bg-slate-100 text-slate-800 dark:bg-slate-850 dark:text-slate-400',
  dataflow: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
  task: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  vvt: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  training: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  user_training: 'bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300',
  training_contest: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
  kpi: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
  kpi_measurement: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-300',
  audit: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  audit_finding: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  custom_role: 'bg-teal-100 text-teal-700 dark:bg-teal-900/20 dark:text-teal-300',
  oidc_mapping: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  iso27001_control: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  bsi_requirement: 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  tisax_requirement: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
  tisax_assessment: 'bg-pink-100 text-pink-700 dark:bg-pink-900/20 dark:text-pink-300',
  nis2_measure: 'bg-purple-100 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
  c5_criterion: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300',
  ai_system: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/20 dark:text-fuchsia-300',
  bcm_process: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400',
  bcm_exercise: 'bg-lime-100 text-lime-700 dark:bg-lime-900/20 dark:text-lime-300',
  dora_test: 'bg-sky-100 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300',
  dora_third_party: 'bg-sky-100 text-sky-600 dark:bg-sky-900/10 dark:text-sky-400',
  pentest_project: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300',
  pentest_finding: 'bg-red-100 text-red-600 dark:bg-red-900/10 dark:text-red-400',
  policy: 'bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300',
  legal_requirement: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
  subject_request: 'bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300',
  dsfa: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  template: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
};

// Lesbare Feld-Bezeichnungen und Wert-Formatierung fuer die Detail-Anzeige
const fieldLabels: Record<string, string> = {
  name: 'Name', type: 'Typ', classification: 'Klassifizierung', status: 'Status',
  owner_id: 'Owner', assessor_id: 'Systemverantw.', version: 'Version', vendor: 'Hersteller',
  location: 'Standort', vendor_id: 'Dienstleister', description: 'Beschreibung', frameworks: 'Frameworks',
  role: 'Rolle', email: 'E-Mail', due_date: 'Fälligkeit', asset_id: 'Asset',
  confidentiality: 'Vertraulichkeit', integrity: 'Integrität', availability: 'Verfügbarkeit',
  risk_level: 'Risiko', risk_score: 'Risiko-Score', notes: 'Notizen', mitigation: 'Maßnahmen',
  lifecycle_status: 'Lebenszyklus', hosting_type: 'Hosting', nis2_relevant: 'NIS-2 relevant',
  rto: 'RTO', rpo: 'RPO', patch_status: 'Patch Status', eol_date: 'EOL Datum',
  backup_plan: 'Backup-Plan', last_restore_test: 'Letzter Restore-Test', hardening_status: 'Hardening-Status',
  issuer: 'Issuer (URL)', clientId: 'Client ID', enabled: 'Aktiviert', displayName: 'Anzeigename',
  action: 'Aktion', method: 'Methode', source: 'Quelle', code: 'Kürzel / Code',
  accepted_until: 'Akzeptiert bis', deleted: 'Gelöschte Einträge', cutoff: 'Bereinigungsgrenze',
  tables: 'Tabellen-Anzahl', files_restored: 'Wiederhergestellte Dateien', tables_restored: 'Wiederhergestellte Tabellen',
  level: 'Stufe', treatment: 'Behandlungsstrategie', severity: 'Schweregrad',
  cve_critical: 'CVE Kritisch', cve_high: 'CVE Hoch', cve_medium: 'CVE Mittel', cve_low: 'CVE Niedrig',
  contact_name: 'Name Ansprechpartner', comment_id: 'Kommentar-ID', meeting: 'Besprechung / Meeting',
  ip_address: 'IP-Adresse', admin_reset: 'Admin-Reset', totp: 'MFA (TOTP)',
  // Training & Schulungen
  title: 'Titel', category: 'Kategorie', training_id: 'Schulung', count: 'Anzahl',
  completed_at: 'Abgeschlossen am', expires_at: 'Ablaufdatum', certificate_url: 'Zertifikat-URL',
  date: 'Datum', duration_minutes: 'Dauer (Min.)', mandatory: 'Pflichtschulung',
  // Rollen & Berechtigungen
  base_role: 'Basisrolle', permissions: 'Berechtigungen', department: 'Abteilung',
  // SMTP / Einstellungen
  host: 'SMTP-Host', port: 'Port', from: 'Absender', user: 'Benutzername', secure: 'SSL/TLS',
  modules: 'Module', passwordPolicy: 'Passwortrichtlinie', bruteForcePolicy: 'Brute-Force-Schutz',
  auditLogRetentionMonths: 'Log-Aufbewahrung (Monate)',
  // Compliance-Module
  implementation_status: 'Umsetzungsstatus', applicable: 'Anwendbar',
  justification: 'Begründung', evidence: 'Nachweise', last_review_date: 'Letztes Review',
  ref: 'Referenz', priority: 'Priorität', assigned_to_id: 'Zugewiesen an',
  deletion_reason: 'Löschgrund', request_type: 'Anfragetyp',
  // Pentest / DORA / BCM
  scope: 'Umfang', start_date: 'Startdatum', end_date: 'Enddatum', test_type: 'Testtyp',
  frequency: 'Häufigkeit', criticality: 'Kritikalität', value: 'Wert',
};

const valClassLabels: Record<string, string> = { public: 'Öffentlich', internal: 'Intern', confidential: 'Vertraulich', secret: 'Geheim' };
const valTypeLabels: Record<string, string> = { hardware: 'Hardware', software: 'Software', information: 'Information/Daten', process: 'Prozess', service: 'Service', personal: 'Personal', application: 'Anwendung', data: 'Daten', other: 'Sonstiges' };
const valRiskLabels: Record<string, string> = { low: 'Gering', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
const valFwLabels: Record<string, string> = { iso27001: 'ISO 27001', nis2: 'NIS-2', gdpr: 'DSGVO / GDPR' };
const valStatusLabels: Record<string, string> = { active: 'Aktiv', inactive: 'Inaktiv', decommissioned: 'Außer Betrieb', open: 'Offen', closed: 'Geschlossen', resolved: 'Behoben', in_progress: 'In Bearbeitung', pending: 'Ausstehend', valid: 'Gültig', expired: 'Abgelaufen' };
const valLifecycleLabels: Record<string, string> = { evaluation: 'In Evaluierung', production: 'Produktion', maintenance: 'Wartung', archived: 'Archiviert' };
const valImplLabels: Record<string, string> = { not_started: 'Nicht begonnen', in_progress: 'In Bearbeitung', implemented: 'Umgesetzt', not_applicable: 'Nicht anwendbar' };
const valModuleLabels: Record<string, string> = { dsgvo: 'DSGVO', tisax: 'TISAX', dora: 'DORA', ai_act: 'AI Act', bcm: 'BCM', pentest: 'Pentest', discovery: 'Netzwerk-Discovery', iso27001: 'ISO 27001', bsi_grundschutz: 'BSI Grundschutz', nis2: 'NIS-2', c5: 'BSI C5', mcp: 'MCP (KI-Integration)' };

const fieldLabel = (key: string) => fieldLabels[key] || key;

const formatValue = (key: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') return '–';
  if (Array.isArray(v)) return v.length ? v.map(x => valFwLabels[String(x)] || String(x)).join(', ') : '–';
  if (typeof v === 'boolean') return v ? 'Ja' : 'Nein';
  if (key === 'classification') return valClassLabels[String(v)] || String(v);
  if (key === 'type') return valTypeLabels[String(v)] || String(v);
  if (key === 'risk_level' || key === 'severity') return valRiskLabels[String(v)] || String(v);
  if (key === 'status') return valStatusLabels[String(v)] || String(v);
  if (key === 'lifecycle_status') return valLifecycleLabels[String(v)] || String(v);
  if (key === 'implementation_status') return valImplLabels[String(v)] || String(v);
  if (key === 'modules' && typeof v === 'object' && v !== null) {
    const active = Object.entries(v as Record<string, boolean>).filter(([, on]) => on).map(([k]) => valModuleLabels[k] || k);
    return active.length ? active.join(', ') : 'Keine';
  }
  if (key === 'eol_date' || key === 'last_restore_test' || key === 'due_date' || key === 'cutoff' || key === 'accepted_until' || key === 'completed_at' || key === 'expires_at' || key === 'date' || key === 'last_review_date' || key === 'start_date' || key === 'end_date') {
    try { return format(new Date(String(v)), 'dd.MM.yyyy'); } catch { return String(v); }
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const DetailsCell: React.FC<{ details?: any }> = ({ details: rawDetails }) => {
  if (!rawDetails) return <span className="text-gray-300 dark:text-slate-600">–</span>;

  let details = rawDetails;
  // Handle double-serialization or characters-as-keys object
  if (typeof details === 'string') {
    try { details = JSON.parse(details); } catch { return <span className="text-xs break-all">{details}</span>; }
  }
  
  // If it's an object that looks like {"0":"{", "1":"\"", ...} convert it back
  if (isRecord(details) && details["0"] !== undefined && details["1"] !== undefined) {
    try {
      const keys = Object.keys(details).filter(k => /^\d+$/.test(k)).sort((a, b) => parseInt(a) - parseInt(b));
      const str = keys.map(k => (details as any)[k]).join('');
      details = JSON.parse(str);
      // Might be double-stringified
      if (typeof details === 'string') details = JSON.parse(details);
    } catch { /* ignore */ }
  }

  if (!isRecord(details) || Object.keys(details).length === 0) {
     return <span className="text-xs break-all">{typeof details === 'string' ? details : JSON.stringify(details)}</span>;
  }

  // Update mit before/after -> Diff der geaenderten Felder
  if (isRecord(details.before) && isRecord(details.after)) {
    const before = details.before;
    const after = details.after;
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const changes = keys.filter(k => !sameValue(before[k], after[k]));

    if (changes.length === 0) return <span className="text-xs text-gray-400 dark:text-slate-500 italic">Keine Feldänderungen</span>;

    return (
      <details className="cursor-pointer group">
        <summary className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline group-open:mb-2">{changes.length} Änderung{changes.length > 1 ? 'en' : ''}</summary>
        <div className="space-y-1.5 bg-gray-50 dark:bg-slate-900 p-2.5 rounded-lg border dark:border-slate-800">
          {changes.map(k => (
            <div key={k} className="text-xs grid grid-cols-[100px_1fr] sm:grid-cols-[120px_1fr_16px_1fr] items-start sm:items-center gap-1.5 sm:gap-2">
              <span className="font-semibold text-gray-700 dark:text-slate-300">{fieldLabel(k)}</span>
              <span className="line-through text-red-500/80 dark:text-red-400/70 truncate" title={formatValue(k, before[k])}>{formatValue(k, before[k])}</span>
              <ArrowRight size={12} className="text-gray-400 shrink-0 hidden sm:block" />
              <span className="text-green-600 dark:text-green-400 font-medium truncate sm:col-start-4" title={formatValue(k, after[k])}>{formatValue(k, after[k])}</span>
            </div>
          ))}
        </div>
      </details>
    );
  }

  // Sonst: lesbare Schluessel-Wert-Liste
  const entries = Object.entries(details).filter(([k]) => k !== 'before' && k !== 'after');
  if (entries.length === 0) return <span className="text-gray-300 dark:text-slate-600">–</span>;

  if (entries.length <= 2) {
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
        {entries.map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1 bg-gray-50 dark:bg-slate-900/50 px-2 py-0.5 rounded-lg border dark:border-slate-800 text-gray-600 dark:text-slate-400">
            <span className="font-semibold text-gray-500 dark:text-slate-500">{fieldLabel(k)}:</span>
            <span className="text-gray-900 dark:text-slate-200 font-medium truncate max-w-[150px]" title={formatValue(k, v)}>{formatValue(k, v)}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <details className="cursor-pointer group">
      <summary className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline group-open:mb-2">Details ({entries.length})</summary>
      <div className="bg-gray-50 dark:bg-slate-900 p-2.5 rounded-lg border dark:border-slate-800 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {entries.map(([k, v]) => (
          <React.Fragment key={k}>
            <span className="font-semibold text-gray-700 dark:text-slate-400 text-right">{fieldLabel(k)}</span>
            <span className="text-gray-900 dark:text-slate-200 truncate" title={formatValue(k, v)}>{formatValue(k, v)}</span>
          </React.Fragment>
        ))}
      </div>
    </details>
  );
};

const PAGE_SIZE = 50;

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogType[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: p * PAGE_SIZE };
      if (entityType) params.entity_type = entityType;
      if (action) params.action = action;
      if (from) params.from = from;
      if (to) params.to = to;
      if (search) params.search = search;
      const { data } = await api.get('/audit-log', { params });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e) {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, entityType, action, from, to, search]);

  useEffect(() => { setPage(0); load(0); }, [entityType, action, from, to, search]);
  useEffect(() => { load(page); }, [page]);

  const flattenForExport = (rows: AuditLogType[]) =>
    rows.map(l => ({
      'ID': l.id,
      'Aktion': actionLabels[l.action] || l.action,
      'Entität': entityLabels[l.entity_type] || l.entity_type,
      'Name': l.entity_name || '',
      'Durchgeführt von': l.actor_name || '',
      'Datum/Zeit': format(new Date(l.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de }),
      'Details': l.details ? JSON.stringify(l.details) : '',
      'IP-Adresse': l.ip_address || '',
    }));

  const handleExportCSV = async () => {
    const { data } = await api.get('/audit-log', { params: { limit: 5000, offset: 0, ...(entityType && { entity_type: entityType }), ...(action && { action }), ...(from && { from }), ...(to && { to }), ...(search && { search }) } });
    exportToCSV(flattenForExport(data.logs), `audit-log-${format(new Date(), 'yyyyMMdd')}`);
  };

  const handleExportExcel = async () => {
    const { data } = await api.get('/audit-log', { params: { limit: 5000, offset: 0, ...(entityType && { entity_type: entityType }), ...(action && { action }), ...(from && { from }), ...(to && { to }), ...(search && { search }) } });
    await exportToExcel(flattenForExport(data.logs), `audit-log-${format(new Date(), 'yyyyMMdd')}`, 'Audit Log');
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Audit Log</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{total} Einträge gesamt</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleExportCSV}><Download size={14} />CSV</Button>
          <Button variant="secondary" size="sm" onClick={handleExportExcel}><FileSpreadsheet size={14} />Excel</Button>
        </div>
      </div>

      <FilterBar
        search={search} onSearch={setSearch} searchPlaceholder="Aktivität suchen..."
        activeCount={[entityType, action, from, to].filter(Boolean).length}
        onReset={() => { setSearch(''); setEntityType(''); setAction(''); setFrom(''); setTo(''); }}
      >
        <Select value={entityType} onChange={e => setEntityType(e.target.value)} options={[{ value: '', label: 'Alle Entitäten' }, ...Object.entries(entityLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select value={action} onChange={e => setAction(e.target.value)} options={[{ value: '', label: 'Alle Aktionen' }, ...Object.entries(actionLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <div className="flex items-center gap-1.5 shrink-0">
          <Calendar size={14} className="text-gray-400" />
          <span className="text-xs text-gray-500">Von</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-xs text-gray-500">Bis</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </FilterBar>

      <Card>
        {loading ? (
          <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
        ) : (
          <Table>
            <Thead>
              <tr><Th>Datum/Zeit</Th><Th>Aktion</Th><Th>Entität</Th><Th>Name</Th><Th>Durchgeführt von</Th><Th>Details</Th></tr>
            </Thead>
            <Tbody>
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <Td className="text-gray-500 dark:text-slate-500 text-xs whitespace-nowrap">{format(new Date(log.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: de })}</Td>
                  <Td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {actionLabels[log.action] || log.action}
                    </span>
                  </Td>
                  <Td>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${entityColors[log.entity_type] || 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {entityLabels[log.entity_type] || log.entity_type}
                    </span>
                  </Td>
                  <Td className="max-w-xs truncate font-medium dark:text-slate-200">{log.entity_name || '–'}</Td>
                  <Td className="dark:text-slate-400">{log.actor_name || '–'}</Td>
                  <Td className="max-w-sm">
                    <DetailsCell details={log.details} />
                  </Td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-slate-500">Keine Einträge gefunden</td></tr>
              )}
            </Tbody>
          </Table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-slate-400">
          <span>Seite {page + 1} von {totalPages} ({total} Einträge)</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Zurück</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Weiter</Button>
          </div>
        </div>
      )}
    </div>
  );
};
