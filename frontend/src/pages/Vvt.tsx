import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, Download, FileSpreadsheet, Building2, Server, Globe, ShieldAlert, Search, AlertOctagon, CalendarCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import type { VvtEntry, User, Vendor, Asset } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { exportToCSV, exportToExcel } from '../lib/export';
import { format } from 'date-fns';
import { SearchableSelect } from '../components/ui/SearchableSelect';

const getEmptyForm = (legalBasisDefault: string) => ({
  name: '', purpose: '', legal_basis: legalBasisDefault, data_categories: '',
  data_subjects: '', recipients: '', retention_period: '', retention_legal_basis: '', deletion_procedure: '', security_measures: '',
  responsible_id: '', processor_id: '', status: 'active' as 'draft' | 'active' | 'archived', notes: '',
  special_categories: false, third_country_transfers: false, transfer_safeguards: '',
  dsfa_required: false, last_review_date: '',
  asset_ids: [] as number[], vendor_ids: [] as number[],
});

export const Vvt: React.FC = () => {
  const { t } = useTranslation('vvt');
  const { user } = useAuth();
  const toast = useToast();
  const canWrite = user?.role === 'admin' || user?.role === 'assessor' || user?.role === 'dpo';

  const statusLabels: Record<string, string> = useMemo(() => ({
    draft: t('statusLabels.draft', 'Entwurf'),
    active: t('statusLabels.active', 'Aktiv'),
    archived: t('statusLabels.archived', 'Archiviert'),
  }), [t]);

  const defaultLegalBasis = t('modal.legalBasisDefault', 'Art. 6 Abs. 1 lit. f DSGVO');

  const [entries, setEntries] = useState<VvtEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sensitivityFilter, setSensitivityFilter] = useState('');
  const [thirdCountryFilter, setThirdCountryFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState(() => getEmptyForm(defaultLegalBasis));
  const [saving, setSaving] = useState(false);

  const [assetSearch, setAssetSearch] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');

  // DSFA (Art. 35) state
  const emptyDsfaForm = {
    title: '', processing_description: '', necessity_assessment: '',
    risks_identified: '', measures_taken: '',
    residual_risk: 'medium' as 'low' | 'medium' | 'high' | 'very_high',
    dpa_consultation_required: false,
    status: 'draft' as 'draft' | 'in_review' | 'approved' | 'rejected',
    approver_id: '' as number | '', approval_date: '', next_review_date: '', notes: '',
  };
  const [dsfaModalOpen, setDsfaModalOpen] = useState(false);
  const [dsfaVvtId, setDsfaVvtId] = useState<number | null>(null);
  const [dsfaVvtName, setDsfaVvtName] = useState('');
  const [dsfaId, setDsfaId] = useState<number | null>(null);
  const [dsfaForm, setDsfaForm] = useState({ ...emptyDsfaForm });
  const [dsfaSaving, setDsfaSaving] = useState(false);

  const filteredAssets = useMemo(() => {
    return assets.filter(a => a.name.toLowerCase().includes(assetSearch.toLowerCase()));
  }, [assets, assetSearch]);

  const filteredVendors = useMemo(() => {
    return vendors.filter(v => v.name.toLowerCase().includes(vendorSearch.toLowerCase()));
  }, [vendors, vendorSearch]);

  const templates: Record<string, Omit<ReturnType<typeof getEmptyForm>, 'retention_legal_basis' | 'deletion_procedure'> & { retention_legal_basis?: string; deletion_procedure?: string }> = useMemo(() => ({
    hr: {
      name: t('templates.hr.name', "Personalverwaltung (HR)"),
      purpose: t('templates.hr.purpose', "Abwicklung von Beschäftigungsverhältnissen, Gehaltsabrechnung, Zeiterfassung und Personalentwicklung."),
      legal_basis: t('templates.hr.legal_basis', "Art. 88 DSGVO i.V.m. § 26 BDSG (Beschäftigtendaten)"),
      data_categories: t('templates.hr.data_categories', "Stammdaten (Name, Anschrift), Kontaktdaten, Bankverbindungen, Gehaltsdaten, Zeiterfassungsdaten, Sozialversicherungsnummern."),
      data_subjects: t('templates.hr.data_subjects', "Mitarbeiter, Praktikanten, Auszubildende."),
      recipients: t('templates.hr.recipients', "Sozialversicherungsträger, Finanzamt, Banken (Lohnzahlung), Lohnbuchhaltung."),
      retention_period: t('templates.hr.retention_period', "6-10 Jahre gemäß gesetzlichen Aufbewahrungsfristen (HGB/AO)."),
      security_measures: t('templates.hr.security_measures', "Zutrittskontrollen, Berechtigungskonzept (nur HR-Abteilung), Verschlüsselung von Übertragungen."),
      special_categories: true,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: false,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.hr.notes', "Standard-HR-Tätigkeit. Beinhaltet sensible Mitarbeiterdaten."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    crm: {
      name: t('templates.crm.name', "Kundenverwaltung & CRM"),
      purpose: t('templates.crm.purpose', "Vertragsanbahnung, Kundenbetreuung, Abwicklung von Dienstleistungen und Rechnungsstellung."),
      legal_basis: t('templates.crm.legal_basis', "Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung)"),
      data_categories: t('templates.crm.data_categories', "Stammdaten, Kontaktdaten, Vertragsdaten, Zahlungsdaten, Korrespondenzhistorie."),
      data_subjects: t('templates.crm.data_subjects', "Kunden, Interessenten, Ansprechpartner bei Geschäftskunden."),
      recipients: t('templates.crm.recipients', "Banken (Zahlungsabwicklung), CRM-System-Hoster, interne Buchhaltung."),
      retention_period: t('templates.crm.retention_period', "10 Jahre gem. § 257 HGB und § 147 AO für Rechnungs- und Buchungsbelege."),
      security_measures: t('templates.crm.security_measures', "Rollenbasierte Berechtigungen im CRM, SSL/TLS-Verschlüsselung, Passwortrichtlinie."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: false,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.crm.notes', "Kundenbeziehungsmanagement."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    newsletter: {
      name: t('templates.newsletter.name', "Newsletter-Marketing"),
      purpose: t('templates.newsletter.purpose', "Versand von Newslettern, Marketing-E-Mails und Produktinformationen."),
      legal_basis: t('templates.newsletter.legal_basis', "Art. 6 Abs. 1 lit. a DSGVO (Einwilligung durch Double-Opt-In)"),
      data_categories: t('templates.newsletter.data_categories', "E-Mail-Adresse, Name (optional), IP-Adresse (Opt-In Nachweis), Klick- und Öffnungsverhalten (anonymisiert)."),
      data_subjects: t('templates.newsletter.data_subjects', "Newsletter-Abonnenten, Bestandskunden."),
      recipients: t('templates.newsletter.recipients', "E-Mail-Marketing-Dienstleister (SaaS-Anbieter)."),
      retention_period: t('templates.newsletter.retention_period', "Bis zum Widerruf der Einwilligung (Abmeldung), Nachweisdaten für 3 Jahre nach Abmeldung."),
      security_measures: t('templates.newsletter.security_measures', "Double-Opt-In-Verfahren, TLS-Verschlüsselung der Formulare, AVV mit Versanddienstleister."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: false,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.newsletter.notes', "Marketing-Newsletter."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    hosting: {
      name: t('templates.hosting.name', "Webseiten-Hosting & Protokollierung"),
      purpose: t('templates.hosting.purpose', "Bereitstellung der Webseite, Fehleranalyse, Angriffsabwehr und Systemsicherheit."),
      legal_basis: t('templates.hosting.legal_basis', "Art. 6 Abs. 1 lit. f DSGVO (Berechtigtes Interesse an Betrieb und Sicherheit)"),
      data_categories: t('templates.hosting.data_categories', "IP-Adresse, Browsertyp, Referrer URL, Datum/Uhrzeit des Zugriffs, übertragene Datenmenge."),
      data_subjects: t('templates.hosting.data_subjects', "Webseiten-Besucher."),
      recipients: t('templates.hosting.recipients', "Webhosting-Provider, Content Delivery Network (CDN) falls verwendet."),
      retention_period: t('templates.hosting.retention_period', "Server-Protokolldateien werden nach 7 Tagen gelöscht oder anonymisiert."),
      security_measures: t('templates.hosting.security_measures', "HTTPS-Verschlüsselung (SSL/TLS), Server-Härtung, DDoS-Schutz, AVV mit Webhoster."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: false,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.hosting.notes', "Standard-Webserver-Protokollierung."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    support: {
      name: t('templates.support.name', "IT-Support & Ticket-System"),
      purpose: t('templates.support.purpose', "Bearbeitung von Support-Anfragen, Behebung technischer Störungen und Benutzerverwaltung."),
      legal_basis: t('templates.support.legal_basis', "Art. 6 Abs. 1 lit. b DSGVO (Vertrag/Support) bzw. lit. f DSGVO (Systembetrieb)"),
      data_categories: t('templates.support.data_categories', "Stammdaten, E-Mail-Adresse, Support-Inhalte/Tickets, System- und Diagnosedaten, IP-Adresse."),
      data_subjects: t('templates.support.data_subjects', "Mitarbeiter, Kunden, Anwender."),
      recipients: t('templates.support.recipients', "Helpdesk-Software-Anbieter, IT-Support-Dienstleister."),
      retention_period: t('templates.support.retention_period', "3 Jahre nach Abschluss des Tickets / Lösung der Support-Anfrage."),
      security_measures: t('templates.support.security_measures', "Zugriffsbeschränkungen auf Tickets, HTTPS-Verschlüsselung, Audit-Trail für Ticket-Änderungen."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: false,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.support.notes', "Betrieb des internen und externen IT-Supports."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    cctv: {
      name: t('templates.cctv.name', "Videoüberwachung (CCTV)"),
      purpose: t('templates.cctv.purpose', "Schutz von Gebäuden und Personen, Vorbeugung und Aufklärung von Straftaten, Hausrecht."),
      legal_basis: t('templates.cctv.legal_basis', "Art. 6 Abs. 1 lit. f DSGVO (Berechtigtes Interesse an Sicherheit und Eigentumsschutz)"),
      data_categories: t('templates.cctv.data_categories', "Bild- und Videodaten von Personen im Erfassungsbereich (Gesicht, Kleidung, Verhalten)."),
      data_subjects: t('templates.cctv.data_subjects', "Mitarbeiter, Besucher, Kunden, Passanten im Überwachungsbereich."),
      recipients: t('templates.cctv.recipients', "Sicherheitsdienst, Strafverfolgungsbehörden (bei Vorfällen), internes Facility Management."),
      retention_period: t('templates.cctv.retention_period', "Automatische Überschreibung nach 72 Stunden, bei Vorfällen bis zur Strafanzeige/Klärung."),
      security_measures: t('templates.cctv.security_measures', "Passwortgeschützter Zugriff auf Videoanlage, verschlüsselte Speicherung, Hinweisschilder gem. § 4 BDSG, Zugriffsprotokollierung."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: true,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.cctv.notes', "Videoüberwachung ist nach Art. 35 DSGVO i.d.R. DSFA-pflichtig. Betriebsrat einbeziehen."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    access_control: {
      name: t('templates.access_control.name', "Zutrittskontrolle & Ausweissystem"),
      purpose: t('templates.access_control.purpose', "Steuerung und Protokollierung des physischen Zutritts zu Gebäuden und Sicherheitsbereichen."),
      legal_basis: t('templates.access_control.legal_basis', "Art. 6 Abs. 1 lit. f DSGVO (Berechtigtes Interesse an Gebäudesicherheit) i.V.m. § 26 BDSG (Mitarbeiter)"),
      data_categories: t('templates.access_control.data_categories', "Personalnummer, Name, Chip-/Kartenkennung, Zutrittszeiten, Zutrittsorte, biometrische Daten (falls verwendet)."),
      data_subjects: t('templates.access_control.data_subjects', "Mitarbeiter, Auftragnehmer, Besucher mit Dauerausweis."),
      recipients: t('templates.access_control.recipients', "Sicherheitsbeauftragter, HR-Abteilung, Strafverfolgungsbehörden (bei Vorfällen)."),
      retention_period: t('templates.access_control.retention_period', "Zutrittsprotokolle: 6 Monate; bei Vorfällen bis zur Klärung; Ausweisdaten: bis Beendigung des Beschäftigungsverhältnisses + 6 Monate."),
      security_measures: t('templates.access_control.security_measures', "Verschlüsselte Datenbankablagen, rollenbasierter Zugriff auf Zutrittsprotokoll, Löschkonzept, physische Sicherung der Server."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: false,
      last_review_date: "",
      status: "active" as const,
      notes: t('templates.access_control.notes', "Bei Einsatz biometrischer Daten (Fingerabdruck) wechselt die Rechtsgrundlage zu Art. 9 Abs. 2 lit. b DSGVO — DSFA und Betriebsvereinbarung erforderlich."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    },
    employee_monitoring: {
      name: t('templates.employee_monitoring.name', "IT-Nutzungsprotokollierung (Mitarbeitermonitoring)"),
      purpose: t('templates.employee_monitoring.purpose', "Sicherstellung der ordnungsgemäßen Nutzung betrieblicher IT-Ressourcen, Abwehr von Cyberangriffen, Aufklärung von Compliance-Verstößen."),
      legal_basis: t('templates.employee_monitoring.legal_basis', "Art. 6 Abs. 1 lit. f DSGVO i.V.m. § 26 BDSG (Beschäftigte) — nur zulässig bei konkretem Verdacht oder anlassloser Protokollierung im erlaubten Rahmen"),
      data_categories: t('templates.employee_monitoring.data_categories', "Verbindungsdaten (URLs, IP-Adressen), Anmeldezeitpunkte, E-Mail-Header (kein Inhalt), Druckerprotokolle, USB-Nutzungslogs."),
      data_subjects: t('templates.employee_monitoring.data_subjects', "Mitarbeiter, ggf. Freelancer und Auftragnehmer mit Systemzugang."),
      recipients: t('templates.employee_monitoring.recipients', "IT-Sicherheit, CISO, Personalabteilung (bei Verdachtsfall), Betriebsrat."),
      retention_period: t('templates.employee_monitoring.retention_period', "Standardprotokoll: 30 Tage; anlassbezogene Auswertung: bis Abschluss des Verfahrens."),
      security_measures: t('templates.employee_monitoring.security_measures', "Streng reglementierter Zugriff (nur CISO + Betriebsrat), 4-Augen-Prinzip für Auswertung, pseudonymisierte Speicherung, Revisionssichere Protokollierung."),
      special_categories: false,
      third_country_transfers: false,
      transfer_safeguards: "",
      dsfa_required: true,
      last_review_date: "",
      status: "draft" as const,
      notes: t('templates.employee_monitoring.notes', "DSFA und Betriebsvereinbarung zwingend erforderlich. Vorab Betriebsrat einbeziehen (§ 87 Abs. 1 Nr. 6 BetrVG)."),
      responsible_id: "",
      processor_id: "",
      asset_ids: [],
      vendor_ids: []
    }
  }), [t]);

  const handleApplyTemplate = (templateKey: string) => {
    if (!templateKey) return;
    const selected = templates[templateKey as keyof typeof templates];
    if (selected) {
      setForm({
        ...getEmptyForm(defaultLegalBasis),
        ...selected,
        retention_legal_basis: selected.retention_legal_basis || '',
        deletion_procedure: selected.deletion_procedure || '',
        responsible_id: form.responsible_id,
        processor_id: form.processor_id,
        asset_ids: form.asset_ids,
        vendor_ids: form.vendor_ids
      });
    }
  };

  const load = () => api.get('/vvt').then(r => setEntries(r.data)).catch(() => setEntries([])).finally(() => setLoading(false));

  useEffect(() => {
    load();
    api.get('/users').then(r => setUsers(r.data)).catch(() => setUsers([]));
    api.get('/vendors').then(r => setVendors(r.data)).catch(() => setVendors([]));
    api.get('/assets').then(r => setAssets(r.data)).catch(() => setAssets([]));
  }, []);

  const filtered = entries.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || (e.purpose || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || e.status === statusFilter;
    const matchSensitivity = !sensitivityFilter || 
      (sensitivityFilter === 'special' && e.special_categories) || 
      (sensitivityFilter === 'normal' && !e.special_categories);
    const matchThirdCountry = !thirdCountryFilter || 
      (thirdCountryFilter === 'third' && e.third_country_transfers) || 
      (thirdCountryFilter === 'eu' && !e.third_country_transfers);
    return matchSearch && matchStatus && matchSensitivity && matchThirdCountry;
  });

  const flattenForExport = (rows: VvtEntry[]) => rows.map(e => ({
    [t('export.columns.id', 'ID')]: `VVT-${String(e.id).padStart(3, '0')}`,
    [t('export.columns.name', 'Name')]: e.name,
    [t('export.columns.purpose', 'Zweck')]: e.purpose || '',
    [t('export.columns.legalBasis', 'Rechtsgrundlage')]: e.legal_basis || '',
    [t('export.columns.dataCategories', 'Datenkategorien')]: e.data_categories || '',
    [t('export.columns.dataSubjects', 'Betroffene Personen')]: e.data_subjects || '',
    [t('export.columns.recipients', 'Empfänger')]: e.recipients || '',
    [t('export.columns.retentionPeriod', 'Löschfrist')]: e.retention_period || '',
    [t('export.columns.responsible', 'Verantwortlich')]: (e as any).responsible?.name || '',
    [t('export.columns.processor', 'Auftragsverarbeiter')]: (e as any).processor?.name || '',
    [t('export.columns.specialCategories', 'Art. 9 Sensible Daten')]: e.special_categories ? t('yes', 'Ja') : t('no', 'Nein'),
    [t('export.columns.thirdCountryTransfers', 'Drittlandübermittlung')]: e.third_country_transfers ? t('yes', 'Ja') : t('no', 'Nein'),
    [t('export.columns.transferSafeguards', 'Übermittlungsgarantien')]: e.transfer_safeguards || '',
    [t('export.columns.dsfaRequired', 'DSFA erforderlich (Art. 35)')]: (e as any).dsfa_required ? t('yes', 'Ja') : t('no', 'Nein'),
    [t('export.columns.lastReviewDate', 'Letzte Überprüfung')]: (e as any).last_review_date ? format(new Date((e as any).last_review_date), t('dateFormat', 'dd.MM.yyyy')) : '–',
    [t('export.columns.securityMeasures', 'Sicherheitsmaßnahmen (TOM)')]: e.security_measures || '',
    [t('export.columns.status', 'Status')]: statusLabels[e.status] || e.status,
    [t('export.columns.notes', 'Notizen')]: e.notes || '',
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editId) await api.put(`/vvt/${editId}`, form);
      else await api.post('/vvt', form);
      setModalOpen(false); load();
    } catch (err: any) { toast.error(err.response?.data?.error || t('toast.saveError', 'Fehler beim Speichern')); }
    finally { setSaving(false); }
  };

  const openEdit = (e: VvtEntry) => {
    setEditId(e.id);
    setForm({
      name: e.name, purpose: e.purpose || '', legal_basis: e.legal_basis || '',
      data_categories: e.data_categories || '', data_subjects: e.data_subjects || '',
      recipients: e.recipients || '', retention_period: e.retention_period || '',
      retention_legal_basis: e.retention_legal_basis || '', deletion_procedure: e.deletion_procedure || '',
      security_measures: e.security_measures || '', notes: e.notes || '',
      responsible_id: e.responsible_id ? String(e.responsible_id) : '',
      processor_id: e.processor_id ? String(e.processor_id) : '',
      status: e.status, special_categories: !!e.special_categories,
      third_country_transfers: !!e.third_country_transfers, transfer_safeguards: e.transfer_safeguards || '',
      dsfa_required: !!(e as any).dsfa_required,
      last_review_date: (e as any).last_review_date || '',
      asset_ids: (e as any).assets?.map((a: any) => a.id) || [],
      vendor_ids: (e as any).vendors?.map((v: any) => v.id) || [],
    });
    setAssetSearch('');
    setVendorSearch('');
    setModalOpen(true);
  };

  const remove = async (e: VvtEntry) => {
    if (!confirm(t('confirm.delete', `Eintrag "${e.name}" löschen?`, { name: e.name }))) return;
    try { await api.delete(`/vvt/${e.id}`); load(); } catch { toast.error(t('toast.error', 'Fehler')); }
  };

  const toggleLink = (key: 'asset_ids' | 'vendor_ids', id: number) =>
    setForm(f => ({ ...f, [key]: (f[key] as number[]).includes(id) ? (f[key] as number[]).filter(x => x !== id) : [...(f[key] as number[]), id] }));

  const openDsfa = async (e: VvtEntry) => {
    setDsfaVvtId(e.id);
    setDsfaVvtName(e.name);
    try {
      const r = await api.get(`/vvt/${e.id}/dsfa`);
      if (r.data) {
        setDsfaId(r.data.id);
        setDsfaForm({
          title: r.data.title || '',
          processing_description: r.data.processing_description || '',
          necessity_assessment: r.data.necessity_assessment || '',
          risks_identified: r.data.risks_identified || '',
          measures_taken: r.data.measures_taken || '',
          residual_risk: r.data.residual_risk || 'medium',
          dpa_consultation_required: !!r.data.dpa_consultation_required,
          status: r.data.status || 'draft',
          approver_id: r.data.approver_id ?? '',
          approval_date: r.data.approval_date || '',
          next_review_date: r.data.next_review_date || '',
          notes: r.data.notes || '',
        });
      } else {
        setDsfaId(null);
        setDsfaForm({ ...emptyDsfaForm, title: t('dsfaModal.defaultTitle', `DSFA: ${e.name}`, { name: e.name }) });
      }
    } catch {
      setDsfaId(null);
      setDsfaForm({ ...emptyDsfaForm, title: t('dsfaModal.defaultTitle', `DSFA: ${e.name}`, { name: e.name }) });
    }
    setDsfaModalOpen(true);
  };

  const saveDsfa = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!dsfaVvtId) return;
    setDsfaSaving(true);
    try {
      const payload = {
        ...dsfaForm,
        approver_id: dsfaForm.approver_id !== '' ? Number(dsfaForm.approver_id) : null,
        approval_date: dsfaForm.approval_date || null,
        next_review_date: dsfaForm.next_review_date || null,
      };
      if (dsfaId) await api.put(`/vvt/${dsfaVvtId}/dsfa/${dsfaId}`, payload);
      else await api.post(`/vvt/${dsfaVvtId}/dsfa`, payload);
      toast.success(t('toast.dsfaSaved', 'DSFA gespeichert.'));
      setDsfaModalOpen(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || t('toast.dsfaSaveError', 'Fehler beim Speichern der DSFA'));
    } finally { setDsfaSaving(false); }
  };

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">{t('title', 'Verarbeitungstätigkeiten')}</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle', 'Verzeichnis gem. Art. 30 DSGVO · {{count}} Einträge', { count: entries.length })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportToCSV(flattenForExport(entries), `vvt-${format(new Date(), 'yyyyMMdd')}`)}><Download size={14} />{t('export.csv', 'CSV')}</Button>
          <Button variant="secondary" size="sm" onClick={() => void exportToExcel(flattenForExport(entries), `vvt-${format(new Date(), 'yyyyMMdd')}`, t('title', 'Verarbeitungstätigkeiten'))}><FileSpreadsheet size={14} />{t('export.excel', 'Excel')}</Button>
          {canWrite && <Button onClick={() => { setEditId(null); setForm(getEmptyForm(defaultLegalBasis)); setAssetSearch(''); setVendorSearch(''); setModalOpen(true); }}><Plus size={16} />{t('new', 'Tätigkeit erfassen')}</Button>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: t('stats.total', 'Gesamt'),             value: entries.length,                                       color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/30 text-blue-700 dark:text-blue-300' },
          { label: t('stats.active', 'Aktiv'),              value: entries.filter(e => e.status === 'active').length,    color: 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-900/30 text-green-700 dark:text-green-300' },
          { label: t('stats.sensitive', 'Art. 9 (sensibel)'),  value: entries.filter(e => e.special_categories).length,    color: 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/30 text-red-700 dark:text-red-300' },
          { label: t('stats.thirdCountry', 'Drittlandtransfer'),  value: entries.filter(e => e.third_country_transfers).length, color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-900/30 text-orange-700 dark:text-orange-300' },
          { label: t('stats.dsfa', 'DSFA-pflichtig'),     value: entries.filter(e => (e as any).dsfa_required).length, color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-900/30 text-purple-700 dark:text-purple-300' },
        ].map(s => (
          <div key={s.label} className={`p-3 rounded-xl border flex flex-col gap-0.5 ${s.color}`}>
            <span className="text-2xl font-bold">{s.value}</span>
            <span className="text-xs font-medium opacity-80">{s.label}</span>
          </div>
        ))}
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('searchPlaceholder', 'Verarbeitungstätigkeit suchen...')}
        activeCount={[statusFilter, sensitivityFilter, thirdCountryFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setStatusFilter(''); setSensitivityFilter(''); setThirdCountryFilter(''); }}>
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[
          { value: '', label: t('filters.allStatus', 'Alle Status') },
          { value: 'draft', label: t('statusLabels.draft', 'Entwurf') },
          { value: 'active', label: t('statusLabels.active', 'Aktiv') },
          { value: 'archived', label: t('statusLabels.archived', 'Archiviert') },
        ]} />
        <Select className="w-44" value={sensitivityFilter} onChange={e => setSensitivityFilter(e.target.value)} options={[
          { value: '', label: t('filters.allSensitivities', 'Alle Sensibilitäten') },
          { value: 'special', label: t('filters.specialCategories', 'Besondere Kategorien (Art. 9)') },
          { value: 'normal', label: t('filters.standardData', 'Standard-Daten') },
        ]} />
        <Select className="w-44" value={thirdCountryFilter} onChange={e => setThirdCountryFilter(e.target.value)} options={[
          { value: '', label: t('filters.allRecipients', 'Alle Empfänger') },
          { value: 'third', label: t('filters.thirdCountry', 'Drittland (Art. 44)') },
          { value: 'eu', label: t('filters.onlyEu', 'Nur EU / EWR') },
        ]} />
      </FilterBar>

      <Card>
        <CardBody className="p-0">
          <Table>
            <Thead><tr><Th className="hidden md:table-cell">{t('table.ref', 'Ref')}</Th><Th>{t('table.activity', 'Verarbeitungstätigkeit')}</Th><Th className="hidden sm:table-cell">{t('table.responsible', 'Verantwortlich')}</Th><Th className="hidden sm:table-cell">{t('table.riskReference', 'Risiko & Bezug')}</Th><Th>{t('table.status', 'Status')}</Th><Th>{''}</Th></tr></Thead>
            <Tbody>
              {filtered.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => openEdit(e)}>
                  <Td className="font-mono text-xs text-gray-500 hidden md:table-cell">VVT-{String(e.id).padStart(3, '0')}</Td>
                  <Td>
                    <p className="text-sm font-medium dark:text-slate-200">{e.name}</p>
                    <p className="text-[11px] text-gray-400 truncate max-w-xs">{e.purpose}</p>
                  </Td>
                  <Td className="text-sm dark:text-slate-400 hidden sm:table-cell">{(e as any).responsible?.name || '–'}</Td>
                  <Td className="hidden sm:table-cell">
                    <div className="flex items-center flex-wrap gap-1.5">
                       {e.special_categories && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400" title={t('tooltips.specialCategories', 'Besondere Kategorien gem. Art. 9 DSGVO')}>
                            <ShieldAlert size={10} /> {t('labels.specialCategories', 'Art. 9')}
                          </span>
                       )}
                       {e.third_country_transfers && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400" title={t('tooltips.thirdCountry', 'Drittlandübermittlung gem. Art. 44 DSGVO')}>
                            <Globe size={10} /> {t('labels.thirdCountry', 'Drittland')}
                          </span>
                       )}
                       {(e as any).dsfa_required && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" title={t('tooltips.dsfa', 'Datenschutz-Folgenabschätzung erforderlich (Art. 35 DSGVO)')}>
                            <AlertOctagon size={10} /> {t('labels.dsfa', 'DSFA')}
                          </span>
                       )}
                       {((e as any).last_review_date) && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-400" title={t('tooltips.lastReview', 'Letzte Überprüfung: {{date}}', { date: (e as any).last_review_date })}>
                            <CalendarCheck size={10} /> {format(new Date((e as any).last_review_date), 'MM/yy')}
                          </span>
                       )}
                       {((e as any).assets?.length > 0) && <span className="flex items-center gap-1 text-[10px] text-gray-500" title={t('tooltips.linkedAssets', 'Verknüpfte Assets')}><Server size={10}/> {(e as any).assets.length}</span>}
                       {((e as any).vendors?.length > 0) && <span className="flex items-center gap-1 text-[10px] text-gray-500" title={t('tooltips.linkedVendors', 'Verknüpfte Dienstleister')}><Building2 size={10}/> {(e as any).vendors.length}</span>}
                    </div>
                  </Td>
                  <Td><Badge value={e.status === 'active' ? 'active' : e.status === 'draft' ? 'evaluation' : 'archived'} label={statusLabels[e.status]} /></Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                       {(e as any).dsfa_required && (
                        <button
                          onClick={(ev) => { ev.stopPropagation(); openDsfa(e); }}
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-800/50 transition-colors"
                          title={t('tooltips.openDsfa', 'Datenschutz-Folgenabschätzung (Art. 35 DSGVO) öffnen')}
                        >
                          {t('labels.dsfa', 'DSFA')}
                        </button>
                       )}
                       {canWrite && (
                         <button onClick={(ev) => { ev.stopPropagation(); remove(e); }} className="text-gray-300 hover:text-red-500 cursor-pointer" title={t('actions.delete', 'Löschen')}><Trash2 size={14}/></button>
                       )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
 
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? (canWrite ? t('modal.editTitle', 'VVT-Eintrag bearbeiten') : t('modal.detailsTitle', 'Verarbeitungstätigkeit Details')) : t('modal.newTitle', 'Neuen VVT-Eintrag anlegen')} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {!editId && canWrite && (
              <div className="md:col-span-2 bg-blue-50/50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-900/20">
                <Select
                  label={t('modal.applyTemplate', 'Aus Vorlage ausfüllen (optional)')}
                  value=""
                  onChange={e => handleApplyTemplate(e.target.value)}
                  options={[
                    { value: '', label: t('modal.noTemplate', '-- Keine Vorlage (leer starten) --') },
                    { value: 'hr', label: t('modal.templates.hr', 'HR / Personalverwaltung') },
                    { value: 'crm', label: t('modal.templates.crm', 'Kundenverwaltung & CRM') },
                    { value: 'newsletter', label: t('modal.templates.newsletter', 'Newsletter-Marketing') },
                    { value: 'hosting', label: t('modal.templates.hosting', 'Webseiten-Hosting & Protokollierung') },
                    { value: 'support', label: t('modal.templates.support', 'IT-Support & Ticket-System') },
                    { value: 'cctv', label: t('modal.templates.cctv', 'Videoüberwachung (CCTV)') },
                    { value: 'access_control', label: t('modal.templates.access_control', 'Zutrittskontrolle & Ausweissystem') },
                    { value: 'employee_monitoring', label: t('modal.templates.employee_monitoring', 'IT-Nutzungsprotokollierung (Mitarbeitermonitoring)') },
                  ]}
                />
              </div>
            )}
            <div className="md:col-span-2">
              <Input label={t('modal.name', 'Name der Tätigkeit *')} value={form.name} onChange={v => setForm({ ...form, name: v.target.value })} required placeholder={t('modal.namePlaceholder', 'z. B. Personalverwaltung, Kunden-Newsletter...')} disabled={!canWrite} />
            </div>
            
            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-1.5">{t('modal.purpose', 'Zweck der Verarbeitung')} <InfoTooltip text={t('tooltips.purpose', 'Warum werden diese Daten verarbeitet?')} /></label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} disabled={!canWrite} />
            </div>
 
            <Input label={t('modal.legalBasis', 'Rechtsgrundlage')} value={form.legal_basis} onChange={v => setForm({ ...form, legal_basis: v.target.value })} placeholder={t('modal.legalBasisPlaceholder', 'z. B. Art. 6 Abs. 1 lit. b DSGVO')} disabled={!canWrite} />
            <Select label={t('modal.status', 'Status')} value={form.status} onChange={v => setForm({ ...form, status: v.target.value as any })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite} />
 
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.dataCategories', 'Datenkategorien')}</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.data_categories} onChange={e => setForm({ ...form, data_categories: e.target.value })} placeholder={t('modal.dataCategoriesPlaceholder', 'z. B. Name, Anschrift, E-Mail, IP-Adresse...')} disabled={!canWrite} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.dataSubjects', 'Betroffene Personen')}</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.data_subjects} onChange={e => setForm({ ...form, data_subjects: e.target.value })} placeholder={t('modal.dataSubjectsPlaceholder', 'z. B. Mitarbeiter, Kunden, Bewerber...')} disabled={!canWrite} />
              </div>
            </div>
 
            <Input label={t('modal.recipients', 'Empfänger der Daten')} value={form.recipients} onChange={v => setForm({ ...form, recipients: v.target.value })} placeholder={t('modal.recipientsPlaceholder', 'z. B. Sozialversicherungsträger, Steuerberater...')} disabled={!canWrite} />

            <div className="md:col-span-2 p-4 bg-amber-50/60 dark:bg-amber-900/10 rounded-xl border border-amber-200 dark:border-amber-900/30 space-y-3">
              <p className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-widest">{t('modal.retentionDeletion', 'Aufbewahrung & Löschung')}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input label={t('modal.retentionPeriod', 'Aufbewahrungsfrist')} value={form.retention_period} onChange={v => setForm({ ...form, retention_period: v.target.value })} placeholder={t('modal.retentionPeriodPlaceholder', 'z. B. 10 Jahre nach Vertragsende')} disabled={!canWrite} />
                <Input label={t('modal.retentionLegalBasis', 'Gesetzliche Grundlage der Frist')} value={form.retention_legal_basis} onChange={v => setForm({ ...form, retention_legal_basis: v.target.value })} placeholder={t('modal.retentionLegalBasisPlaceholder', 'z. B. § 257 HGB, § 147 AO')} disabled={!canWrite} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.deletionProcedure', 'Löschverfahren / -prozess')}</label>
                <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.deletion_procedure} onChange={e => setForm({ ...form, deletion_procedure: e.target.value })} placeholder={t('modal.deletionProcedurePlaceholder', 'Beschreibung: Wer löscht wann wie? Automatisch oder manuell?')} disabled={!canWrite} />
              </div>
            </div>

            <SearchableSelect label={t('modal.responsible', 'Interner Verantwortlicher')} value={form.responsible_id} onChange={val => setForm({ ...form, responsible_id: val })} options={[{ value: '', label: t('modal.pleaseSelect', '– bitte wählen –') }, ...users.map(u => ({ value: String(u.id), label: u.name }))]} disabled={!canWrite} />
            <SearchableSelect label={t('modal.processor', 'Haupt-Auftragsverarbeiter')} value={form.processor_id} onChange={val => setForm({ ...form, processor_id: val })} options={[{ value: '', label: t('modal.noneProcessor', 'Keiner (Eigenverarbeitung)') }, ...vendors.map(v => ({ value: String(v.id), label: v.name }))]} disabled={!canWrite} />
 
            <div className="md:col-span-2 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-blue-900/30 space-y-3">
              <p className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-widest">{t('modal.specialRiskFactors', 'Spezielle Risikofaktoren & Pflichten')}</p>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.special_categories} onChange={e => setForm({ ...form, special_categories: e.target.checked })} className="w-4 h-4 rounded text-blue-600" disabled={!canWrite} />
                  <span className="text-sm font-medium dark:text-slate-300">{t('modal.specialCategories', 'Besondere Kategorien (Art. 9)')}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.third_country_transfers} onChange={e => setForm({ ...form, third_country_transfers: e.target.checked })} className="w-4 h-4 rounded text-blue-600" disabled={!canWrite} />
                  <span className="text-sm font-medium dark:text-slate-300">{t('modal.thirdCountryTransfers', 'Drittlandübermittlung (Art. 44)')}</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.dsfa_required} onChange={e => setForm({ ...form, dsfa_required: e.target.checked })} className="w-4 h-4 rounded text-purple-600" disabled={!canWrite} />
                  <span className="text-sm font-medium dark:text-slate-300">{t('modal.dsfaRequired', 'DSFA erforderlich (Art. 35)')}</span>
                </label>
              </div>
              {form.third_country_transfers && (
                <Input label={t('modal.transferSafeguards', 'Übermittlungsgarantien')} value={form.transfer_safeguards} onChange={v => setForm({ ...form, transfer_safeguards: v.target.value })} placeholder={t('modal.transferSafeguardsPlaceholder', 'z. B. EU-Standardvertragsklauseln...')} disabled={!canWrite} />
              )}
              {form.dsfa_required && (
                <div className="flex items-start gap-2 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-900/30">
                  <AlertOctagon size={14} className="text-purple-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-purple-700 dark:text-purple-300">
                    {t('modal.dsfaAlert', 'Datenschutz-Folgenabschätzung (DSFA) gem. Art. 35 DSGVO erforderlich. Bitte führen Sie die DSFA durch und hinterlegen Sie das Dokument in den Anlagen.')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-1.5">
                <CalendarCheck size={13} /> {t('modal.lastReviewDate', 'Letzte Überprüfung (Review-Datum)')}
              </label>
              <input type="date" value={form.last_review_date} onChange={e => setForm({ ...form, last_review_date: e.target.value })}
                className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
                disabled={!canWrite} />
              <p className="text-[10px] text-gray-400 dark:text-slate-500">{t('modal.lastReviewDateHelp', 'Wann wurde dieser Eintrag zuletzt inhaltlich geprüft?')}</p>
            </div>
            <div />
 
            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.securityMeasures', 'Technische & organisatorische Maßnahmen (TOMs)')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.security_measures} onChange={e => setForm({ ...form, security_measures: e.target.value })} placeholder={t('modal.securityMeasuresPlaceholder', 'Kurze Auflistung oder Verweis auf IT-Sicherheitskonzept...')} disabled={!canWrite} />
            </div>
 
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-2"><Server size={14}/> {t('modal.linkedAssets', 'Verknüpfte IT-Systeme / Assets')}</label>
              <div className="relative flex items-center">
                <Search className="absolute left-3 text-gray-400" size={14} />
                <input type="text" placeholder={t('modal.filterAssetsPlaceholder', 'Asset filtern...')} value={assetSearch} onChange={e => setAssetSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-40 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 bg-gray-50/30 dark:bg-slate-800/20 custom-scrollbar">
                {filteredAssets.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">{t('modal.noAssetsFound', 'Keine Assets gefunden')}</p>
                ) : (
                  filteredAssets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                      <input type="checkbox" checked={form.asset_ids.includes(a.id)} onChange={() => toggleLink('asset_ids', a.id)} className="w-4 h-4 rounded text-blue-600" disabled={!canWrite} />
                      <span className="text-sm dark:text-slate-300 truncate">{a.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
 
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300 flex items-center gap-2"><Building2 size={14}/> {t('modal.linkedVendors', 'Weitere Auftragsverarbeiter')}</label>
              <div className="relative flex items-center">
                <Search className="absolute left-3 text-gray-400" size={14} />
                <input type="text" placeholder={t('modal.filterVendorsPlaceholder', 'Dienstleister filtern...')} value={vendorSearch} onChange={e => setVendorSearch(e.target.value)} className="w-full pl-9 pr-3 py-1.5 text-xs bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-hidden dark:text-white" />
              </div>
              <div className="max-h-40 overflow-y-auto border dark:border-slate-700 rounded-xl p-2 bg-gray-50/30 dark:bg-slate-800/20 custom-scrollbar">
                {filteredVendors.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500 p-2 text-center">{t('modal.noVendorsFound', 'Keine Dienstleister gefunden')}</p>
                ) : (
                  filteredVendors.map(v => (
                    <label key={v.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-colors border border-transparent hover:border-gray-200 dark:hover:border-slate-700">
                      <input type="checkbox" checked={form.vendor_ids.includes(v.id)} onChange={() => toggleLink('vendor_ids', v.id)} className="w-4 h-4 rounded text-blue-600" disabled={!canWrite} />
                      <span className="text-sm dark:text-slate-300 truncate">{v.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
 
            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notes', 'Interne Notizen')}</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} disabled={!canWrite} />
            </div>
          </div>
 
          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">{canWrite ? t('actions.cancel', 'Abbrechen') : t('actions.close', 'Schließen')}</Button>
            {canWrite && (
              <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('actions.saving', 'Speichern...') : t('actions.saveVvt', 'VVT-Eintrag speichern')}</Button>
            )}
          </div>
        </form>
      </Modal>
 
      {/* DSFA Modal (Art. 35 DSGVO) */}
      <Modal open={dsfaModalOpen} onClose={() => setDsfaModalOpen(false)} title={t('dsfaModal.title', `DSFA – ${dsfaVvtName}`, { name: dsfaVvtName })} size="xl">
        <form onSubmit={saveDsfa} className="space-y-4 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-900/30 rounded-xl text-sm text-purple-700 dark:text-purple-300">
            {t('dsfaModal.intro', 'Datenschutz-Folgenabschätzung gem. Art. 35 DSGVO. Pflicht bei hohem Risiko für Rechte und Freiheiten natürlicher Personen.')}
          </div>
          <Input label={t('dsfaModal.formTitle', 'Titel *')} value={dsfaForm.title} onChange={e => setDsfaForm({ ...dsfaForm, title: e.target.value })} required disabled={!canWrite} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select label={t('dsfaModal.status', 'Status')} value={dsfaForm.status} onChange={e => setDsfaForm({ ...dsfaForm, status: e.target.value as typeof dsfaForm.status })}
              options={[
                { value: 'draft', label: t('dsfaStatusLabels.draft', 'Entwurf') },
                { value: 'in_review', label: t('dsfaStatusLabels.in_review', 'In Prüfung') },
                { value: 'approved', label: t('dsfaStatusLabels.approved', 'Genehmigt') },
                { value: 'rejected', label: t('dsfaStatusLabels.rejected', 'Abgelehnt') },
              ]} disabled={!canWrite} />
            <Select label={t('dsfaModal.residualRisk', 'Restrisiko')} value={dsfaForm.residual_risk} onChange={e => setDsfaForm({ ...dsfaForm, residual_risk: e.target.value as typeof dsfaForm.residual_risk })}
              options={[
                { value: 'low', label: t('residualRiskLabels.low', 'Gering') },
                { value: 'medium', label: t('residualRiskLabels.medium', 'Mittel') },
                { value: 'high', label: t('residualRiskLabels.high', 'Hoch') },
                { value: 'very_high', label: t('residualRiskLabels.very_high', 'Sehr hoch') },
              ]} disabled={!canWrite} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('dsfaModal.processingDescription', 'Beschreibung der Verarbeitung')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3}
              value={dsfaForm.processing_description} onChange={e => setDsfaForm({ ...dsfaForm, processing_description: e.target.value })} disabled={!canWrite} placeholder={t('dsfaModal.processingDescriptionPlaceholder', 'Art, Umfang, Kontext und Zweck der Verarbeitung...')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('dsfaModal.necessityAssessment', 'Notwendigkeit & Verhältnismäßigkeit')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2}
              value={dsfaForm.necessity_assessment} onChange={e => setDsfaForm({ ...dsfaForm, necessity_assessment: e.target.value })} disabled={!canWrite} placeholder={t('dsfaModal.necessityAssessmentPlaceholder', 'Warum ist die Verarbeitung notwendig und verhältnismäßig?')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('dsfaModal.risksIdentified', 'Identifizierte Risiken')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3}
              value={dsfaForm.risks_identified} onChange={e => setDsfaForm({ ...dsfaForm, risks_identified: e.target.value })} disabled={!canWrite} placeholder={t('dsfaModal.risksIdentifiedPlaceholder', 'Welche Risiken für Rechte und Freiheiten der Betroffenen wurden identifiziert?')} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('dsfaModal.measuresTaken', 'Maßnahmen zur Risikominimierung')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3}
              value={dsfaForm.measures_taken} onChange={e => setDsfaForm({ ...dsfaForm, measures_taken: e.target.value })} disabled={!canWrite} placeholder={t('dsfaModal.measuresTakenPlaceholder', 'Welche technischen und organisatorischen Maßnahmen wurden ergriffen?')} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SearchableSelect label={t('dsfaModal.approvedBy', 'Genehmigt durch')}
              value={dsfaForm.approver_id !== '' ? String(dsfaForm.approver_id) : ''}
              onChange={v => setDsfaForm({ ...dsfaForm, approver_id: v ? Number(v) : '' })}
              options={users.map(u => ({ value: String(u.id), label: u.name }))}
              placeholder={t('dsfaModal.approvedByPlaceholder', 'Person auswählen...')} disabled={!canWrite} />
            <Input label={t('dsfaModal.approvalDate', 'Genehmigungsdatum')} type="date" value={dsfaForm.approval_date} onChange={e => setDsfaForm({ ...dsfaForm, approval_date: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label={t('dsfaModal.nextReviewDate', 'Nächste Überprüfung')} type="date" value={dsfaForm.next_review_date} onChange={e => setDsfaForm({ ...dsfaForm, next_review_date: e.target.value })} disabled={!canWrite} />
            <div className="flex items-center gap-3 pt-6">
              <input type="checkbox" id="dpa_consult" checked={dsfaForm.dpa_consultation_required}
                onChange={e => setDsfaForm({ ...dsfaForm, dpa_consultation_required: e.target.checked })} disabled={!canWrite} className="w-4 h-4 rounded" />
              <label htmlFor="dpa_consult" className="text-sm text-gray-700 dark:text-slate-300">{t('dsfaModal.dpaConsultationRequired', 'Vorherige Konsultation Aufsichtsbehörde (Art. 36)')}</label>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('dsfaModal.notes', 'Notizen')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2}
              value={dsfaForm.notes} onChange={e => setDsfaForm({ ...dsfaForm, notes: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setDsfaModalOpen(false)} className="flex-1 justify-center">{t('actions.close', 'Schließen')}</Button>
            {canWrite && <Button type="submit" disabled={dsfaSaving} className="flex-1 justify-center">{dsfaSaving ? t('actions.saving', 'Speichern...') : t('actions.saveDsfa', 'DSFA speichern')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
