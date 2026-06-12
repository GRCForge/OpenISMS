import React, { useEffect, useState } from 'react';
import { Building2, Plus, Pencil, Trash2, Globe, ShieldCheck, ExternalLink, ShieldAlert, User, Clock, CheckCircle, Paperclip, Download } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import api from '../lib/api';

const typeLabels: Record<string, string> = {
  software: 'Software',
  cloud: 'SaaS / Cloud',
  hardware: 'Hardware',
  consulting: 'Beratung',
  hosting: 'Hosting',
  logistics: 'Logistik',
  other: 'Sonstiges',
  it_provider: 'IT-Dienstleister'
};
import type { Vendor, RiskLevel } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { FilterBar } from '../components/ui/FilterBar';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { hasWriteAccess } from '../lib/permissions';

const typeOptions = [
  { value: 'software', label: 'Software-Hersteller' },
  { value: 'cloud', label: 'Cloud-Dienstleister / SaaS' },
  { value: 'hardware', label: 'Hardware-Lieferant' },
  { value: 'consulting', label: 'Beratung / Consulting' },
  { value: 'hosting', label: 'Rechenzentrum / Hosting' },
  { value: 'logistics', label: 'Logistik' },
  { value: 'other', label: 'Sonstiges' },
];

const emptyVendor = { name: '', type: 'software', website: '', phone: '', address: '', notes: '' };

export const Vendors: React.FC = () => {
  const { user } = useAuth();
  const canWrite = hasWriteAccess(user?.role);
  const toast = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [dpaFilter, setDpaFilter] = useState('');
  const [certFilter, setCertFilter] = useState('');
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState(emptyVendor);
  const [saving, setSaving] = useState(false);

  const [assessModalOpen, setAssessModalOpen] = useState(false);
  const [assessVendor, setAssessVendor] = useState<Vendor | null>(null);
  const [assessForm, setAssessForm] = useState({
    risk_level: 'medium' as RiskLevel,
    risk_score: '',
    next_review_date: '',
    dpa_signed: false,
    dpa_signed_at: '',
    iso27001_certified: false,
    soc2_certified: false,
    gdpr_compliant: false,
    data_processor: false,
    fourth_party_risks: '',
    assessment_notes: ''
  });
  const [assessing, setAssessing] = useState(false);

  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [selectedVendorForDocs, setSelectedVendorForDocs] = useState<Vendor | null>(null);
  const [vendorDocs, setVendorDocs] = useState<any[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docForm, setDocForm] = useState({ category: 'dpa', description: '' });

  const loadDocs = (vendorId: number) => {
    api.get(`/vendors/${vendorId}/documents`)
      .then(r => setVendorDocs(r.data))
      .catch(() => setVendorDocs([]));
  };

  const openDocs = (v: Vendor) => {
    setSelectedVendorForDocs(v);
    setDocForm({ category: 'dpa', description: '' });
    setDocFile(null);
    setVendorDocs([]);
    setDocsModalOpen(true);
    loadDocs(v.id);
  };

  const handleDocUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVendorForDocs || !docFile) return;
    setUploadingDoc(true);
    const formData = new FormData();
    formData.append('file', docFile);
    formData.append('category', docForm.category);
    formData.append('description', docForm.description);

    try {
      await api.post(`/vendors/${selectedVendorForDocs.id}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('Dokument erfolgreich hochgeladen');
      setDocFile(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      loadDocs(selectedVendorForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Hochladen des Dokuments');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDocDelete = async (docId: number) => {
    if (!selectedVendorForDocs || !confirm('Dokument wirklich löschen?')) return;
    try {
      await api.delete(`/vendors/${selectedVendorForDocs.id}/documents/${docId}`);
      toast.success('Dokument gelöscht');
      loadDocs(selectedVendorForDocs.id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen des Dokuments');
    }
  };

  const load = () => api.get('/vendors').then(r => setVendors(r.data)).catch(() => setVendors([])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const filtered = vendors.filter(v => {
    const matchSearch = v.name.toLowerCase().includes(search.toLowerCase());
    const matchType = !typeFilter || v.type === typeFilter;
    const matchRisk = !riskFilter || v.risk_level === riskFilter;
    const matchDpa = !dpaFilter || (dpaFilter === 'signed' ? v.dpa_signed : !v.dpa_signed);
    const matchCert = !certFilter || 
      (certFilter === 'iso' ? v.iso27001_certified : 
       certFilter === 'soc2' ? v.soc2_certified : 
       certFilter === 'any' ? (v.iso27001_certified || v.soc2_certified) : true);

    return matchSearch && matchType && matchRisk && matchDpa && matchCert;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editVendor) {
        await api.put(`/vendors/${editVendor.id}`, form);
      } else {
        await api.post('/vendors', form);
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const openAssess = (v: Vendor) => {
    setAssessVendor(v);
    setAssessForm({
      risk_level: v.risk_level || 'medium',
      risk_score: v.risk_score ? String(v.risk_score) : '',
      next_review_date: v.next_review_date ? v.next_review_date.split('T')[0] : '',
      dpa_signed: !!v.dpa_signed,
      dpa_signed_at: v.dpa_signed_at ? v.dpa_signed_at.split('T')[0] : '',
      iso27001_certified: !!v.iso27001_certified,
      soc2_certified: !!v.soc2_certified,
      gdpr_compliant: !!v.gdpr_compliant,
      data_processor: !!v.data_processor,
      fourth_party_risks: v.fourth_party_risks || '',
      assessment_notes: v.assessment_notes || ''
    });
    setAssessModalOpen(true);
  };

  const handleAssess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assessVendor) return;
    setAssessing(true);
    try {
      await api.patch(`/vendors/${assessVendor.id}/assessment`, {
        ...assessForm,
        risk_score: assessForm.risk_score ? parseInt(assessForm.risk_score) : null
      });
      setAssessModalOpen(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Speichern der Bewertung');
    } finally { setAssessing(false); }
  };

  const remove = async (v: Vendor) => {
    if (!confirm(`Unternehmen "${v.name}" wirklich löschen?`)) return;
    try {
      await api.delete(`/vendors/${v.id}`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Fehler beim Löschen');
    }
  };

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Dienstleister & Lieferanten</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">Zentrales Lieferantenverzeichnis</p>
        </div>
        {canWrite && <Button onClick={() => { setEditVendor(null); setForm(emptyVendor); setModalOpen(true); }}><Plus size={16} />Firma anlegen</Button>}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Unternehmen suchen..."
        activeCount={[typeFilter, riskFilter, dpaFilter, certFilter].filter(Boolean).length}
        onReset={() => { setSearch(''); setTypeFilter(''); setRiskFilter(''); setDpaFilter(''); setCertFilter(''); }}
      >
        <Select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          options={[
            { value: '', label: 'Alle Typen' },
            ...Object.entries(typeLabels).map(([v, l]) => ({ value: v, label: l }))
          ]}
        />
        <Select
          value={riskFilter}
          onChange={e => setRiskFilter(e.target.value)}
          options={[
            { value: '', label: 'Alle Risiken' },
            { value: 'low', label: 'Gering' },
            { value: 'medium', label: 'Mittel' },
            { value: 'high', label: 'Hoch' },
            { value: 'critical', label: 'Kritisch' },
          ]}
        />
        <Select
          value={dpaFilter}
          onChange={e => setDpaFilter(e.target.value)}
          options={[
            { value: '', label: 'Alle AVV-Stati' },
            { value: 'signed', label: 'AVV unterzeichnet' },
            { value: 'unsigned', label: 'AVV ausstehend' },
          ]}
        />
        <Select
          value={certFilter}
          onChange={e => setCertFilter(e.target.value)}
          options={[
            { value: '', label: 'Alle Zertifikate' },
            { value: 'any', label: 'Zertifiziert (ISO/SOC2)' },
            { value: 'iso', label: 'ISO 27001 zertifiziert' },
            { value: 'soc2', label: 'SOC 2 Testat' },
          ]}
        />
      </FilterBar>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
        {filtered.map(v => (
          <Card key={v.id} className="group hover:border-blue-500 dark:hover:border-blue-400/50 transition-all duration-300 shadow-sm hover:shadow-lg overflow-hidden flex flex-col">
            <CardBody className="p-0 flex flex-col h-full">
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                    {(() => {
                      // Nur valide http(s)-Hostnames an den Favicon-Dienst geben —
                      // schützt vor javascript:-URLs und Render-Crash durch new URL()
                      let host: string | null = null;
                      if (v.website) {
                        try {
                          const u = new URL(/^https?:\/\//i.test(v.website) ? v.website : `https://${v.website}`);
                          if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname;
                        } catch { /* ungültige URL → Fallback-Icon */ }
                      }
                      return host ? (
                        <img
                          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
                          alt=""
                          className="w-6 h-6 object-contain rounded-sm"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).parentElement?.querySelector('.fallback-icon');
                            if (fallback) (fallback as HTMLElement).style.display = 'block';
                          }}
                        />
                      ) : null;
                    })()}
                    <Building2 size={24} className={`fallback-icon ${v.website ? 'hidden' : ''}`} />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge value={v.risk_level || 'medium'} label={v.risk_level?.toUpperCase() || 'MODERAT'} />
                    {v.data_processor && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">Auftragsverarbeiter</span>}
                  </div>
                </div>

                <h3 className="text-lg font-bold dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate" title={v.name}>{v.name}</h3>
                <p className="text-sm font-medium text-gray-500 dark:text-slate-400 mb-4">{typeLabels[v.type] || v.type}</p>

                <div className="space-y-2 mb-5">
                  {v.website && /^https?:\/\//i.test(v.website) && (
                    <a href={v.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 transition-colors">
                      <Globe size={14} className="text-gray-400" /> <span className="truncate">{v.website.replace(/^https?:\/\//, '')}</span>
                    </a>
                  )}
                  <Link to={`/contacts?vendor=${v.id}`} className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300 hover:text-blue-600 transition-colors">
                    <User size={14} className="text-gray-400" />
                    <span>{v.contacts?.length || 0} Ansprechpartner</span>
                    <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                </div>

                <div className="flex items-center gap-3 pt-4 border-t dark:border-slate-800 mt-auto">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Audit</p>
                    <div className="flex items-center gap-1.5">
                      <Clock size={14} className={v.next_review_date && new Date(v.next_review_date) < new Date() ? 'text-red-500' : 'text-gray-400'} />
                      <span className={`text-sm truncate ${v.next_review_date && new Date(v.next_review_date) < new Date() ? 'text-red-600 font-bold' : 'dark:text-slate-300'}`}>
                        {v.next_review_date ? format(new Date(v.next_review_date), 'dd.MM.yyyy') : '–'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openAssess(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors" title="Risikobewertung">
                      <ShieldCheck size={18} />
                    </button>
                    <button onClick={() => openDocs(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors" title="Dokumente verwalten (AVV, Zertifikate)">
                      <Paperclip size={18} />
                    </button>
                    {canWrite && (
                      <button onClick={() => { setEditVendor(v); setForm({ name: v.name, type: v.type, website: v.website || '', phone: v.phone || '', address: v.address || '', notes: v.notes || '' }); setModalOpen(true); }} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors" title="Bearbeiten">
                        <Pencil size={18} />
                      </button>
                    )}
                    {canWrite && (
                      <button onClick={() => remove(v)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-red-600 transition-colors" title="Löschen">
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Bar */}
              <div className="flex divide-x divide-gray-100 dark:divide-slate-800 border-t dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 mt-auto">
                <div className="flex-1 py-3 px-2 flex flex-col items-center gap-1" title="AVV unterzeichnet">
                  <ShieldCheck size={16} className={v.dpa_signed ? 'text-green-500' : 'text-gray-300'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">AVV</span>
                </div>
                <div className="flex-1 py-3 px-2 flex flex-col items-center gap-1" title="ISO 27001">
                  <ShieldAlert size={16} className={v.iso27001_certified ? 'text-blue-500' : 'text-gray-300'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">ISO</span>
                </div>
                <div className="flex-1 py-3 px-2 flex flex-col items-center gap-1" title="DSGVO-konform">
                  <CheckCircle size={16} className={v.gdpr_compliant ? 'text-green-500' : 'text-gray-300'} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">DSGVO</span>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editVendor ? 'Firma bearbeiten' : 'Neue Firma anlegen'} size="xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            <div className="md:col-span-2">
              <Input label="Unternehmensname *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="z. B. Amazon Web Services, Microsoft Deutschland..." />
            </div>
            <Select label="Branche / Typ *" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} options={typeOptions} />
            <Input label="Website" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://www.firma.de" />
            
            <Input label="Zentrale Telefonnummer" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+49 123 456789" />
            <Input label="Hauptsitz / Adresse" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Straße, PLZ Ort, Land" />
            
            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Interne Notizen / Kurzbeschreibung</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Besonderheiten, Vertragsnummern, kritische Abhängigkeiten..." />
            </div>
          </div>
          
          <div className="flex gap-3 pt-4 border-t dark:border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" disabled={saving || !canWrite} className="flex-1 justify-center">{saving ? 'Speichern...' : 'Unternehmensdaten speichern'}</Button>
          </div>
        </form>
      </Modal>

      {/* Risk Assessment Modal */}
      <Modal open={assessModalOpen} onClose={() => setAssessModalOpen(false)} title={`Risikobewertung: ${assessVendor?.name || ''}`} size="xl">
        <form onSubmit={handleAssess} className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6">
            
            <section className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">Risiko-Einstufung</h3>
              <div className="grid grid-cols-1 gap-4">
                <Select
                  label="Risikostufe"
                  value={assessForm.risk_level}
                  onChange={e => setAssessForm(f => ({ ...f, risk_level: e.target.value as RiskLevel }))}
                  options={[
                    { value: 'low', label: 'Gering (Low Risk)' },
                    { value: 'medium', label: 'Mittel (Standard)' },
                    { value: 'high', label: 'Hoch (Critical Vendor)' },
                    { value: 'critical', label: 'Kritisch (Immediate Action)' },
                  ]}
                />
                <Input
                  label="Risikopunktzahl (0–100)"
                  type="number"
                  min="0" max="100"
                  value={assessForm.risk_score}
                  onChange={e => setAssessForm(f => ({ ...f, risk_score: e.target.value }))}
                  placeholder="Eigene Gewichtung..."
                />
              </div>
            </section>

            <section className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/20 space-y-4">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider">Termine & Fristen</h3>
              <div className="grid grid-cols-1 gap-4">
                <Input label="Nächstes Audit / Review" type="date" value={assessForm.next_review_date} onChange={e => setAssessForm(f => ({ ...f, next_review_date: e.target.value }))} />
                <Input label="AVV unterzeichnet am" type="date" value={assessForm.dpa_signed_at} onChange={e => setAssessForm(f => ({ ...f, dpa_signed_at: e.target.value }))} />
              </div>
            </section>

            <div className="md:col-span-2">
              <h3 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 tracking-wider mb-3">Compliance-Checks</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { key: 'data_processor', label: 'Auftragsverarbeiter (Art. 28)' },
                  { key: 'dpa_signed', label: 'AVV liegt unterzeichnet vor' },
                  { key: 'gdpr_compliant', label: 'DSGVO-konform bestätigt' },
                  { key: 'iso27001_certified', label: 'ISO 27001 zertifiziert' },
                  { key: 'soc2_certified', label: 'SOC 2 Typ II Testat' },
                ].map(({key, label}) => (
                  <label key={key} className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${assessForm[key as keyof typeof assessForm] ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-slate-800 hover:border-gray-300'}`}>
                    <input
                      type="checkbox"
                      checked={assessForm[key as keyof typeof assessForm] as boolean}
                      onChange={e => setAssessForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="w-4 h-4 rounded text-blue-600"
                    />
                    <span className="text-xs font-medium dark:text-slate-300">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Sub-Dienstleister-Risiken (Kaskaden)</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} value={assessForm.fourth_party_risks} onChange={e => setAssessForm(f => ({ ...f, fourth_party_risks: e.target.value }))} placeholder="Nutzt dieser Dienstleister kritische Unter-Auftragnehmer (z.B. AWS, Google Cloud, Cloudflare)?" />
            </div>

            <div className="md:col-span-2 flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Zusammenfassung der Bewertung</label>
              <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={assessForm.assessment_notes} onChange={e => setAssessForm(f => ({ ...f, assessment_notes: e.target.value }))} placeholder="Beobachtungen, notwendige Nachbesserungen, Zusammenfassung der Sorgfaltspflichtprüfung..." />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t dark:border-slate-800 sticky bottom-0 bg-white dark:bg-slate-900">
            <Button type="button" variant="secondary" onClick={() => setAssessModalOpen(false)} className="flex-1 justify-center">Abbrechen</Button>
            <Button type="submit" disabled={assessing || !canWrite} className="flex-1 justify-center">{assessing ? 'Speichern...' : 'Risikobewertung abschließen'}</Button>
          </div>
        </form>
      </Modal>

      {/* Vendor Documents Modal */}
      <Modal open={docsModalOpen} onClose={() => setDocsModalOpen(false)} title={`Dokumente verwalten: ${selectedVendorForDocs?.name || ''}`} size="xl">
        <div className="space-y-6 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar">
          {/* Upload Form */}
          <form onSubmit={handleDocUpload} className="p-4 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 space-y-4">
            <h3 className="text-sm font-bold dark:text-white">Dokument hochladen</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Kategorie *"
                value={docForm.category}
                onChange={e => setDocForm(f => ({ ...f, category: e.target.value }))}
                options={[
                  { value: 'dpa', label: 'Auftragsverarbeitungsvertrag (AVV / DPA)' },
                  { value: 'contract', label: 'Hauptvertrag / NDA' },
                  { value: 'certificate', label: 'Zertifikat (z. B. ISO 27001, SOC 2)' },
                  { value: 'other', label: 'Sonstiges' }
                ]}
              />
              <Input
                label="Beschreibung"
                value={docForm.description}
                onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))}
                placeholder="z. B. Unterzeichneter AVV 2026, ISO-Zertifikat..."
              />
              <div className="md:col-span-2 flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">Datei auswählen *</label>
                <input
                  type="file"
                  onChange={e => setDocFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-500 dark:text-slate-400 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-slate-800 dark:file:text-slate-300"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={uploadingDoc} className="px-6">
                {uploadingDoc ? 'Wird hochgeladen...' : 'Dokument hinzufügen'}
              </Button>
            </div>
          </form>

          {/* List of Documents */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold dark:text-white">Vorhandene Dokumente</h3>
            {vendorDocs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-6 border border-dashed dark:border-slate-800 rounded-xl">Keine Dokumente hinterlegt.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800 border dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                {vendorDocs.map(doc => (
                  <div key={doc.id} className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm dark:text-white truncate">{doc.original_name}</span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {doc.category === 'dpa' ? 'AVV/DPA' : doc.category === 'contract' ? 'Vertrag' : doc.category === 'certificate' ? 'Zertifikat' : 'Sonstiges'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{doc.description || 'Keine Beschreibung'}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        Hochgeladen am {format(new Date(doc.created_at || Date.now()), 'dd.MM.yyyy HH:mm')} von {doc.uploader?.name || 'Unbekannt'} · {(doc.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <a
                        href={`${api.defaults.baseURL}/vendors/${selectedVendorForDocs?.id}/documents/${doc.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors"
                        title="Herunterladen"
                      >
                        <Download size={18} />
                      </a>
                      {canWrite && (
                        <button
                          onClick={() => handleDocDelete(doc.id)}
                          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 hover:text-red-600 transition-colors"
                          title="Löschen"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};
