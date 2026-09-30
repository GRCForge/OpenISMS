import React, { useEffect, useState, useMemo } from 'react';
import { AlertOctagon, Download, CheckCircle2, Pencil, ListChecks, ChevronDown, ChevronUp, ChevronRight, Radio, RefreshCw, Building2, ClipboardList, Info, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import api from '../lib/api';
import type { User } from '../types';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import { Modal } from '../components/ui/Modal';
import { FilterBar } from '../components/ui/FilterBar';
import { Table, Thead, Tbody, Th, Td } from '../components/ui/Table';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { useToast } from '../contexts/ToastContext';
import { hasWriteAccess } from '../lib/permissions';
import { IconButton } from '../components/ui/IconButton';
import { SelfCheck } from '../components/nis2/SelfCheck';

type ImplStatus = 'not_started' | 'in_progress' | 'implemented' | 'not_applicable';
type EntityType = 'essential' | 'important' | 'indirect' | 'unknown';
type Obligation = 'required' | 'recommended' | 'not_applicable';

/**
 * Anwendbarkeit je Betroffenheitsprofil.
 *
 * Nicht jede Einrichtung schuldet denselben Katalog: Eine wesentliche
 * Einrichtung nach Anhang I schuldet ihn ganz, ein Zulieferer ausserhalb des
 * Anwendungsbereichs bekommt nur einen Teil davon vertraglich durchgereicht.
 * 'obligation' ist die Auflösung dieser Tabelle fuer das eingestellte Profil
 * und kommt fertig vom Server.
 */
type Applicability = Record<'essential' | 'important' | 'indirect', Obligation>;

interface Nis2Profile {
  entity_type: EntityType;
  sector: string;
  note: string;
}

interface Nis2Measure {
  id: number;
  article_ref: string;
  category: string;
  title: string;
  description?: string;
  implementation_status: ImplStatus;
  responsible?: { id: number; name: string };
  responsible_id?: number | null;
  evidence?: string;
  deadline?: string;
  notes?: string;
  last_review_date?: string;
  applicability: Applicability;
  obligation: Obligation;
  custom?: boolean;
  /** Fundstelle im deutschen Umsetzungsgesetz, wo belegt. */
  bsig_ref?: string | null;
  scope_note?: string | null;
  references?: { label: string; url?: string | null }[] | null;
  /** Artikelreferenz des Oberkriteriums, null auf der obersten Ebene. */
  parent_ref?: string | null;
}

const statusColors: Record<ImplStatus, string> = {
  not_started: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  implemented: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  not_applicable: 'bg-slate-100 text-slate-400 dark:bg-slate-800/60 dark:text-slate-400',
};

const OBLIGATION_COLORS: Record<Obligation, string> = {
  required: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  recommended: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  not_applicable: 'bg-gray-100 text-gray-600 dark:bg-slate-800/60 dark:text-slate-400',
};

const ENTITY_TYPES: EntityType[] = ['essential', 'important', 'indirect', 'unknown'];
const OBLIGATIONS: Obligation[] = ['required', 'recommended', 'not_applicable'];

// Art. 21(2)(a) verlangt unter anderem, die Bedrohungslage zu verfolgen. Dafuer
// gibt es ein eigenes Modul — von hier aus verlinkt, statt den Nachweis zweimal
// zu fuehren.
const THREAT_INTEL_REFS = new Set(['Art. 21(2)(a)']);

const CATEGORY_COLORS: Record<string, string> = {
  'Risikoanalyse & Sicherheitsrichtlinien': 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400',
  'Vorfallbewältigung':                     'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400',
  'Business Continuity':                    'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400',
  'Lieferkettensicherheit':                 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400',
  'Sicherheit im Erwerb':                   'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-400',
  'Wirksamkeit von Maßnahmen':              'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400',
  'Cyberhygiene & Schulungen':              'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-400',
  'Kryptografie':                           'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400',
  'Personalsicherheit & Zugangssteuerung':  'bg-pink-50 dark:bg-pink-900/20 text-pink-700 dark:text-pink-400',
  'Multi-Faktor-Authentifizierung':         'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400',
  'Meldepflichten':                         'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400',
  'Registrierung & behoerdliche Pflichten': 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400',
  'Kritische Anlagen':                      'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300',
};

const CATEGORY_KEY_MAP: Record<string, string> = {
  'Risikoanalyse & Sicherheitsrichtlinien': 'riskPolicies',
  'Vorfallbewältigung':                     'incidentResponse',
  'Business Continuity':                    'businessContinuity',
  'Lieferkettensicherheit':                 'supplychainSecurity',
  'Sicherheit im Erwerb':                   'acquisitionSecurity',
  'Wirksamkeit von Maßnahmen':              'measureEffectiveness',
  'Cyberhygiene & Schulungen':              'cyberHygiene',
  'Kryptografie':                           'cryptography',
  'Personalsicherheit & Zugangssteuerung':  'accessControl',
  'Multi-Faktor-Authentifizierung':         'mfa',
  'Meldepflichten':                         'reportingObligations',
  'Governance & Managementhaftung':         'governance',
  'Korrekturmassnahmen':                    'correctiveActions',
  'Registrierung & behoerdliche Pflichten': 'registration',
  'Kritische Anlagen':                      'criticalFacilities',
  'Eigene Kriterien':                       'ownCriteria',
};

const DEFAULT_APPLICABILITY: Applicability = { essential: 'required', important: 'required', indirect: 'recommended' };

const emptyEditForm = {
  implementation_status: 'not_started' as ImplStatus,
  responsible_id: '',
  evidence: '',
  deadline: '',
  notes: '',
  last_review_date: '',
  applicability: { ...DEFAULT_APPLICABILITY } as Applicability,
};

export const Nis2: React.FC = () => {
  const { t } = useTranslation('nis2');
  const { user } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const canWrite = can('nis2', 'create', hasWriteAccess(user?.role));
  const canManage = can('nis2', 'edit', user?.role === 'admin' || user?.role === 'assessor');

  const statusLabels: Record<ImplStatus, string> = {
    not_started: t('status.not_started'),
    in_progress: t('status.in_progress'),
    implemented: t('status.implemented'),
    not_applicable: t('status.not_applicable'),
  };

  const getCategoryLabel = (cat: string): string => {
    const key = CATEGORY_KEY_MAP[cat];
    return key ? t(`categories.${key}`) : cat;
  };

  const [tab, setTab] = useState<'catalogue' | 'selfCheck'>('catalogue');
  const [profile, setProfile] = useState<Nis2Profile>({ entity_type: 'unknown', sector: '', note: '' });
  const [profileDraft, setProfileDraft] = useState<Nis2Profile | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Standardmaessig blendet die Liste aus, was das eingestellte Profil nicht
  // schuldet. Wer den vollen Katalog sehen will, schaltet es einen Klick
  // weiter — ausgeblendet ist nicht geloescht.
  const [onlyApplicable, setOnlyApplicable] = useState(true);
  const [measures, setMeasures] = useState<Nis2Measure[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (cat: string) => setCollapsedCategories(prev => {
    const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next;
  });
  const [editMeasure, setEditMeasure] = useState<Nis2Measure | null>(null);
  const [editForm, setEditForm] = useState({ ...emptyEditForm });
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.get('/nis2').then(r => setMeasures(r.data)).catch(() => setMeasures([])).finally(() => setLoading(false));

  const loadProfile = () =>
    api.get('/nis2/profile').then(r => setProfile({ entity_type: r.data.entity_type, sector: r.data.sector ?? '', note: r.data.note ?? '' })).catch(() => {});

  useEffect(() => {
    load();
    loadProfile();
    api.get('/users').then(r => setUsers(r.data)).catch(() => {});
  }, []);

  const saveProfile = async () => {
    if (!profileDraft) return;
    setSavingProfile(true);
    try {
      const r = await api.put('/nis2/profile', profileDraft);
      setProfile({ entity_type: r.data.entity_type, sector: r.data.sector ?? '', note: r.data.note ?? '' });
      setProfileDraft(null);
      // Die Pflichtstufe je Kriterium haengt am Profil und wird serverseitig
      // abgeleitet — die Liste muss neu geladen werden, sonst zeigt sie die
      // Stufen des alten Profils.
      await load();
      toast.success(t('profile.saved'));
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    } finally {
      setSavingProfile(false);
    }
  };

  const syncCatalog = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/nis2/sync-catalog');
      toast.success(r.data.added > 0 ? t('profile.synced', { count: r.data.added }) : t('profile.syncedNone'));
      if (r.data.added > 0) await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    } finally {
      setSyncing(false);
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      await api.post('/nis2/seed');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      if (e.response?.status === 409) await load();
      else toast.error(e.response?.data?.error || t('toast.loadError'));
    } finally {
      setSeeding(false);
    }
  };

  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const openEdit = (m: Nis2Measure) => {
    setEditMeasure(m);
    setEditForm({
      implementation_status: m.implementation_status,
      responsible_id: m.responsible_id ? String(m.responsible_id) : '',
      evidence: m.evidence || '',
      deadline: m.deadline ? m.deadline.slice(0, 10) : '',
      notes: m.notes || '',
      last_review_date: m.last_review_date ? m.last_review_date.slice(0, 10) : '',
      applicability: { ...DEFAULT_APPLICABILITY, ...(m.applicability || {}) },
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMeasure) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...editForm, responsible_id: editForm.responsible_id ? Number(editForm.responsible_id) : null };
      // Ohne Verwaltungsrecht wird die Anwendbarkeit gar nicht erst
      // mitgeschickt — sonst schriebe ein Formular, das sie nur anzeigt, sie
      // bei jedem Speichern zurueck.
      if (!canManage) delete payload.applicability;
      const r = await api.put(`/nis2/${editMeasure.id}`, payload);
      // Die Pflichtstufe leitet der Server aus dem Profil ab; nach einer
      // geaenderten Anwendbarkeit muss sie neu geholt werden, sonst zeigt die
      // Zeile weiter die alte Stufe.
      if (canManage) await load();
      else setMeasures(ms => ms.map(m => m.id === editMeasure.id ? { ...m, ...r.data, obligation: m.obligation, responsible: editForm.responsible_id ? { id: Number(editForm.responsible_id), name: users.find(u => u.id === Number(editForm.responsible_id))?.name || '' } : undefined } : m));
      setEditMeasure(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || t('toast.saveError'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Zaehlt nur, was das eingestellte Profil ueberhaupt schuldet.
   *
   * Wer 'not_applicable' mitzaehlt, misst das Falsche: Ein indirekt Betroffener
   * stuende dauerhaft bei "nicht erfuellt", weil er die 24-Stunden-Fruehwarnung
   * ans CSIRT nicht leistet — die er gar nicht leisten muss. Ein von Hand auf
   * "nicht anwendbar" gesetztes Kriterium faellt ebenfalls heraus.
   */
  const stats = useMemo(() => {
    // Ein Kriterium mit Unterkriterien ist eine Klammer und zaehlt nicht
    // selbst — sonst ginge dieselbe Anforderung zweimal in die Quote ein.
    const containers = new Set(measures.map(m => m.parent_ref).filter(Boolean));
    const applicable = measures.filter(m => m.obligation !== 'not_applicable'
      && m.implementation_status !== 'not_applicable'
      && !containers.has(m.article_ref));
    const implemented = applicable.filter(m => m.implementation_status === 'implemented').length;
    const inProgress = applicable.filter(m => m.implementation_status === 'in_progress').length;
    const open = applicable.filter(m => m.implementation_status === 'not_started').length;
    const excluded = measures.length - applicable.length;
    // Angefangenes zaehlt halb — als "nicht erfuellt" waere jede
    // Zwischenmessung wertlos, voll gezaehlt waere die Quote geschoent.
    const score = applicable.length ? (implemented + inProgress * 0.5) / applicable.length : 0;
    const maturity = score >= 0.95 ? 5 : score >= 0.8 ? 4 : score >= 0.55 ? 3 : score >= 0.3 ? 2 : 1;
    return { total: applicable.length, catalogTotal: measures.length, excluded, implemented, inProgress, open, rate: Math.round(score * 100), maturity };
  }, [measures]);

  const categories = useMemo(() => Array.from(new Set(measures.map(m => m.category))).sort((a, b) => a.localeCompare(b)), [measures]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = (m: Nis2Measure) => !!m.deadline && new Date(m.deadline) < today && m.implementation_status !== 'implemented';

  const filtered = useMemo(() => measures.filter(m => {
    if (onlyApplicable && m.obligation === 'not_applicable') return false;
    if (statusFilter && m.implementation_status !== statusFilter) return false;
    if (categoryFilter && m.category !== categoryFilter) return false;
    if (search) { const q = search.toLowerCase(); if (!m.article_ref.toLowerCase().includes(q) && !m.title.toLowerCase().includes(q) && !m.category.toLowerCase().includes(q)) return false; }
    return true;
  }), [measures, statusFilter, categoryFilter, search, onlyApplicable]);

  /**
   * Kategorien, darin Oberkriterien mit ihren Unterkriterien direkt darunter.
   *
   * Ein Oberkriterium bleibt sichtbar, sobald eines seiner Kinder den Filter
   * passiert — sonst haengen die Unterpunkte ohne den Gesetzesbezug in der
   * Liste, zu dem sie gehoeren. Es wird dann als Klammer gezeigt, nicht als
   * Treffer.
   */
  const grouped = useMemo(() => {
    const byRef = new Map(measures.map(m => [m.article_ref, m]));
    const visible = new Set(filtered.map(m => m.article_ref));
    const shown: Nis2Measure[] = [];
    const seen = new Set<string>();
    for (const m of filtered) {
      const parentRef = m.parent_ref;
      if (parentRef && !visible.has(parentRef)) {
        const parent = byRef.get(parentRef);
        if (parent && !seen.has(parent.article_ref)) { shown.push(parent); seen.add(parent.article_ref); }
      }
      if (!seen.has(m.article_ref)) { shown.push(m); seen.add(m.article_ref); }
    }

    const tops = shown.filter(m => !m.parent_ref);
    const childrenOf = (ref: string) => shown.filter(m => m.parent_ref === ref);
    const ordered: Nis2Measure[] = [];
    for (const top of tops) { ordered.push(top); ordered.push(...childrenOf(top.article_ref)); }
    // Unterkriterien, deren Elternteil ausgefiltert wurde, gehen nicht verloren.
    for (const m of shown) if (m.parent_ref && !tops.some(t => t.article_ref === m.parent_ref) && !ordered.includes(m)) ordered.push(m);

    const map = new Map<string, Nis2Measure[]>();
    for (const m of ordered) { if (!map.has(m.category)) map.set(m.category, []); map.get(m.category)!.push(m); }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, measures]);

  /** Referenzen, unter denen Unterkriterien haengen. */
  const containerRefs = useMemo(
    () => new Set(measures.map(m => m.parent_ref).filter(Boolean) as string[]),
    [measures],
  );

  const activeFilterCount = [statusFilter, categoryFilter].filter(Boolean).length;

  if (loading) return <div className="flex justify-center pt-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2"><AlertOctagon size={24} className="text-blue-600" aria-hidden="true" />{t('title')}</h1>
        <p className="text-gray-600 dark:text-slate-400 text-sm">{t('subtitle', { count: measures.length })}</p>
      </div>
    </div>
  );

  const tabs = (
    <div className="flex gap-1 border-b border-gray-200 dark:border-slate-800" role="tablist">
      {(['catalogue', 'selfCheck'] as const).map(key => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors rounded-t-md flex items-center gap-1.5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
            tab === key
              ? 'border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300'
              : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}>
          {key === 'catalogue'
            ? <><ListChecks size={14} aria-hidden="true" />{t('tabs.catalogue')}</>
            : <><ClipboardList size={14} aria-hidden="true" />{t('tabs.selfCheck')}</>}
        </button>
      ))}
    </div>
  );

  // Der Fragebogen ist der sinnvolle Einstieg — er beantwortet, wo man steht,
  // bevor der Kriterienkatalog fuehrt, was zu tun ist. Er bleibt deshalb auch
  // dann erreichbar, wenn der Katalog noch nicht geladen wurde.
  if (measures.length === 0) return (
    <div className="space-y-6">
      {header}
      {tabs}
      {tab === 'selfCheck' ? (
        <SelfCheck canEdit={canWrite} canManage={canManage} onAnswered={load} />
      ) : (
        <Card><CardBody>
          <div className="py-16 text-center">
            <ListChecks size={40} className="mx-auto mb-3 text-gray-400 dark:text-slate-600" aria-hidden="true" />
            <p className="text-gray-700 dark:text-slate-300 font-medium">{t('empty.title')}</p>
            <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{t('empty.description')}</p>
            {canManage && <Button onClick={seed} disabled={seeding} className="mt-4"><Download size={16} />{seeding ? t('empty.loading') : t('empty.loadButton')}</Button>}
          </div>
        </CardBody></Card>
      )}
    </div>
  );

  if (tab === 'selfCheck') return (
    <div className="space-y-6">
      {header}
      {tabs}
      <SelfCheck canEdit={canWrite} canManage={canManage} onAnswered={load} />
    </div>
  );

  return (
    <div className="space-y-6">
      {header}
      {tabs}

      {/* Betroffenheitsprofil — es entscheidet, welche Kriterien ueberhaupt
          gelten, und steht deshalb vor dem Katalog, nicht daneben. */}
      <Card>
        <CardBody className="py-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 shrink-0"><Building2 size={16} className="text-blue-600 dark:text-blue-400" /></div>
              <div>
                <p className="font-semibold text-sm dark:text-white">{t('profile.title')}</p>
                <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5">{t(`profile.types.${profile.entity_type}.label`)} — {t(`profile.types.${profile.entity_type}.description`)}</p>
                {profile.sector && <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5">{t('profile.sector')}: {profile.sector}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button variant="secondary" onClick={() => setProfileDraft({ ...profile })}>
                  <Pencil size={14} />{t('profile.change')}
                </Button>
              )}
              {canManage && (
                <Button variant="secondary" onClick={syncCatalog} disabled={syncing} title={t('profile.syncHint')}>
                  <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />{t('profile.sync')}
                </Button>
              )}
            </div>
          </div>
          {profile.entity_type === 'unknown' && (
            <p className="text-xs text-orange-700 dark:text-orange-400">{t('profile.unknownHint')}</p>
          )}
          {stats.excluded > 0 && (
            <p className="text-xs text-gray-600 dark:text-slate-400">{t('profile.excluded', { count: stats.excluded, total: stats.catalogTotal })}</p>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: t('stats.applicable'), value: stats.total, color: 'bg-blue-500', icon: ListChecks },
          { label: t('stats.rate'), value: `${stats.rate}%`, color: 'bg-indigo-600', icon: CheckCircle2, hint: t('stats.maturity', { level: stats.maturity }) },
          { label: t('stats.implemented'), value: stats.implemented, color: 'bg-green-600', icon: CheckCircle2 },
          { label: t('stats.inProgress'), value: stats.inProgress, color: 'bg-yellow-500', icon: AlertOctagon },
          { label: t('stats.open'), value: stats.open, color: 'bg-gray-500', icon: Pencil },
        ].map(s => (
          <Card key={s.label}><CardBody className="flex items-center gap-3 py-4">
            <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
            <div>
              <p className="text-2xl font-bold dark:text-white">{s.value}</p>
              <p className="text-xs text-gray-600 dark:text-slate-400">{s.label}</p>
              {'hint' in s && s.hint ? <p className="text-[11px] text-gray-600 dark:text-slate-400">{s.hint}</p> : null}
            </div>
          </CardBody></Card>
        ))}
      </div>

      <FilterBar search={search} onSearch={setSearch} searchPlaceholder={t('filter.searchPlaceholder')} activeCount={activeFilterCount} onReset={() => { setSearch(''); setStatusFilter(''); setCategoryFilter(''); }}>
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} options={[{ value: '', label: t('filter.allStatus') }, ...Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))]} />
        <Select className="w-56" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} options={[{ value: '', label: t('filter.allCategories') }, ...categories.map(c => ({ value: c, label: getCategoryLabel(c) }))]} />
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 whitespace-nowrap shrink-0">
          <input type="checkbox" checked={onlyApplicable} onChange={e => setOnlyApplicable(e.target.checked)}
            className="rounded border-gray-400 dark:border-slate-600" />
          {t('filter.onlyApplicable')}
        </label>
      </FilterBar>

      {grouped.map(([category, items]) => {
        const implementedCount = items.filter(m => m.implementation_status === 'implemented').length;
        const pct = items.length > 0 ? Math.round((implementedCount / items.length) * 100) : 0;
        const isCatExpanded = !collapsedCategories.has(category);
        const colorClass = CATEGORY_COLORS[category] || 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
        return (
          <Card key={category} className="overflow-hidden">
            <button onClick={() => toggleCategory(category)} className="w-full flex items-center gap-3 p-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors text-left">
              <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${colorClass}`}>{getCategoryLabel(category)}</span>
              <span className="text-xs text-gray-500 dark:text-slate-400 shrink-0">{t('table.measureCount', { count: items.length })}</span>
              <div className="flex items-center gap-2 min-w-[80px] ml-auto">
                <div className="w-16 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                <span className="text-xs font-bold text-gray-600 dark:text-slate-400">{pct}%</span>
              </div>
              {isCatExpanded ? <ChevronDown size={16} className="text-gray-500 shrink-0 dark:text-gray-400" /> : <ChevronRight size={16} className="text-gray-500 shrink-0 dark:text-gray-400" />}
            </button>
            {isCatExpanded && (
              <div className="border-t dark:border-slate-700">
                <Table>
                  <Thead><tr>
                    <Th>{t('table.article')}</Th><Th>{t('table.measure')}</Th><Th>{t('table.obligation')}</Th><Th>{t('table.status')}</Th><Th>{t('table.deadline')}</Th><Th>{t('table.lastReview')}</Th><Th><span className="sr-only">{t('modal.edit')}</span></Th>
                  </tr></Thead>
                  <Tbody>
                    {items.map(m => {
                      const expanded = expandedIds.has(m.id);
                      const overdue = isOverdue(m);
                      // Ein Kriterium mit Unterkriterien ist eine Klammer: Es
                      // traegt den Gesetzesbezug, aber keinen eigenen Status.
                      const isContainer = containerRefs.has(m.article_ref);
                      const children = isContainer ? measures.filter(x => x.parent_ref === m.article_ref) : [];
                      const counted = children.filter(c => c.obligation !== 'not_applicable' && c.implementation_status !== 'not_applicable');
                      const doneCount = counted.filter(c => c.implementation_status === 'implemented').length;
                      const childPct = counted.length ? Math.round((doneCount / counted.length) * 100) : 0;
                      return (
                        <React.Fragment key={m.id}>
                          <tr className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${isContainer ? 'bg-gray-50/60 dark:bg-slate-800/30' : ''}`}>
                            <Td className={m.parent_ref ? 'pl-8 sm:pl-10' : ''}>
                              <span className={`font-mono text-xs whitespace-nowrap ${isContainer ? 'font-semibold text-gray-700 dark:text-slate-300' : 'text-gray-600 dark:text-slate-400'}`}>{m.article_ref}</span>
                              {m.bsig_ref && !m.parent_ref && (
                                <span className="block font-mono text-[10px] text-gray-600 dark:text-slate-400 whitespace-nowrap">{m.bsig_ref}</span>
                              )}
                            </Td>
                            <Td className={m.parent_ref ? 'pl-4' : ''}>
                              <div className="flex items-start gap-2">
                                {m.description && <button type="button" onClick={() => toggleExpanded(m.id)} className="mt-0.5 p-0.5 rounded text-gray-500 hover:text-blue-600 transition-colors shrink-0 dark:text-gray-400" title={expanded ? t('description.hide') : t('description.show')}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}
                                <div>
                                  <p className={`text-sm dark:text-slate-200 ${isContainer ? 'font-semibold' : 'font-medium'}`}>{t('measures.' + m.article_ref + '.title', { defaultValue: m.title })}</p>
                                  {m.responsible && <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5">{m.responsible.name}</p>}
                                  {m.scope_note && !m.parent_ref && (
                                    // Bedingt geltende Pflicht: Sie steht im
                                    // Katalog, weil sie fuer Betroffene sonst
                                    // fehlte. Wen sie nicht betrifft, sieht
                                    // hier, warum, und setzt sie auf "nicht
                                    // anwendbar".
                                    <p className="inline-flex items-start gap-1 text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded px-1.5 py-0.5 mt-1">
                                      <Info size={11} aria-hidden="true" className="mt-px shrink-0" />
                                      <span>{m.scope_note}</span>
                                    </p>
                                  )}
                                  {THREAT_INTEL_REFS.has(m.article_ref) && (
                                    <Link to="/threat-intel" className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 hover:underline mt-0.5">
                                      <Radio size={11} aria-hidden="true" />{t('threatIntelLink')}
                                    </Link>
                                  )}
                                </div>
                              </div>
                            </Td>
                            <Td><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${OBLIGATION_COLORS[m.obligation] ?? OBLIGATION_COLORS.required}`}>{t(`obligation.${m.obligation ?? 'required'}`)}</span></Td>
                            <Td>
                              {isContainer ? (
                                // Abgeleitet statt gesetzt: Die Klammer ist
                                // erfuellt, wenn ihre Bestandteile es sind.
                                <span className="flex items-center gap-2" title={t('subCriteria.progressHint')}>
                                  <span className="w-14 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 shrink-0">
                                    <span className="bg-blue-500 h-1.5 rounded-full block transition-all" style={{ width: `${childPct}%` }} />
                                  </span>
                                  <span className="text-[11px] text-gray-700 dark:text-slate-300 whitespace-nowrap">{t('subCriteria.progress', { done: doneCount, total: counted.length })}</span>
                                </span>
                              ) : (
                                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusColors[m.implementation_status]}`}>{statusLabels[m.implementation_status]}</span>
                              )}
                            </Td>
                            <Td>{m.deadline ? <span className={`text-xs font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-slate-400'}`}>{format(new Date(m.deadline), 'dd.MM.yyyy')}{overdue && ' ⚠'}</span> : <span className="text-gray-300 dark:text-slate-600">–</span>}</Td>
                            <Td className="text-gray-500 dark:text-slate-400 text-xs">{m.last_review_date ? format(new Date(m.last_review_date), 'dd.MM.yyyy') : '–'}</Td>
                            <Td>{canWrite && <IconButton label={t('modal.edit')} onClick={() => openEdit(m)}><Pencil size={14} /></IconButton>}</Td>
                          </tr>
                          {expanded && m.description && (
                            <tr className="bg-gray-50 dark:bg-slate-800/30">
                              <td />
                              <td colSpan={6} className="px-4 py-3">
                                <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed">{t('measures.' + m.article_ref + '.description', { defaultValue: m.description })}</p>
                                {m.evidence && <div className="mt-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{t('description.evidence')}</span><span className="text-xs text-gray-600 dark:text-slate-400">{m.evidence}</span></div>}
                                {!!m.references?.length && (
                                  // Der Katalog sagt, was geschuldet ist; die
                                  // Quelle sagt, wie. Sie gehoert an das
                                  // Kriterium und nicht in eine Linksammlung,
                                  // die niemand oeffnet.
                                  <div className="mt-2">
                                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{t('description.references')}</span>
                                    <ul className="mt-0.5 space-y-0.5">
                                      {m.references.map((ref, i) => (
                                        <li key={i} className="text-xs text-gray-600 dark:text-slate-400">
                                          {ref.url ? (
                                            <a href={ref.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-400 hover:underline">
                                              <ExternalLink size={11} aria-hidden="true" />{ref.label}
                                            </a>
                                          ) : ref.label}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </Tbody>
                </Table>
              </div>
            )}
          </Card>
        );
      })}

      {grouped.length === 0 && (
        <Card><CardBody><div className="py-12 text-center"><AlertOctagon size={36} className="mx-auto mb-3 text-gray-300 dark:text-slate-600" /><p className="text-gray-500 dark:text-slate-400">{t('filterEmpty')}</p></div></CardBody></Card>
      )}

      <Modal open={!!profileDraft} onClose={() => setProfileDraft(null)} title={t('profile.modalTitle')}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-slate-300">{t('profile.modalIntro')}</p>
          <div className="space-y-2">
            {ENTITY_TYPES.map(type => (
              <label key={type} className={`flex items-start gap-2 rounded-xl border p-3 cursor-pointer transition-colors ${
                profileDraft?.entity_type === type
                  ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/40'}`}>
                <input type="radio" name="entity-type" value={type} className="mt-1"
                  checked={profileDraft?.entity_type === type}
                  onChange={() => setProfileDraft(d => (d ? { ...d, entity_type: type } : d))} />
                <span>
                  <span className="block text-sm font-semibold text-gray-900 dark:text-white">{t(`profile.types.${type}.label`)}</span>
                  <span className="block text-xs text-gray-600 dark:text-slate-400">{t(`profile.types.${type}.description`)}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="nis2-sector" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('profile.sector')}</label>
            <input id="nis2-sector" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              placeholder={t('profile.sectorPlaceholder')} value={profileDraft?.sector ?? ''}
              onChange={e => setProfileDraft(d => (d ? { ...d, sector: e.target.value } : d))} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="nis2-note" className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('profile.note')}</label>
            <textarea id="nis2-note" rows={3} className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden"
              placeholder={t('profile.notePlaceholder')} value={profileDraft?.note ?? ''}
              onChange={e => setProfileDraft(d => (d ? { ...d, note: e.target.value } : d))} />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={() => setProfileDraft(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            <Button type="button" onClick={saveProfile} disabled={savingProfile} className="flex-1 justify-center">{savingProfile ? t('modal.saving') : t('modal.save')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editMeasure} onClose={() => setEditMeasure(null)} title={editMeasure ? `${editMeasure.article_ref} – ${t('measures.' + editMeasure.article_ref + '.title', { defaultValue: editMeasure.title })}` : ''} size="lg">
        <form onSubmit={saveEdit} className="space-y-4">
          {editMeasure && <div className="flex gap-2 flex-wrap"><span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{getCategoryLabel(editMeasure.category)}</span></div>}
          <Select label={t('modal.status')} value={editForm.implementation_status} onChange={e => setEditForm({ ...editForm, implementation_status: e.target.value as ImplStatus })} options={Object.entries(statusLabels).map(([v, l]) => ({ value: v, label: l }))} disabled={!canWrite} />
          <SearchableSelect label={t('modal.responsible')} value={editForm.responsible_id} onChange={val => setEditForm({ ...editForm, responsible_id: val })} options={[{ value: '', label: t('modal.nobody') }, ...users.filter(u => u.active).map(u => ({ value: String(u.id), label: u.name }))]} disabled={!canWrite} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.evidence')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={2} placeholder={t('modal.evidencePlaceholder')} value={editForm.evidence} onChange={e => setEditForm({ ...editForm, evidence: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.deadline')}</label>
              <input type="date" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" value={editForm.deadline} onChange={e => setEditForm({ ...editForm, deadline: e.target.value })} disabled={!canWrite} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.lastReview')}</label>
              <input type="date" className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl px-3 py-2 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" value={editForm.last_review_date} onChange={e => setEditForm({ ...editForm, last_review_date: e.target.value })} disabled={!canWrite} />
            </div>
          </div>
          {/* Anwendbarkeit je Profil — der eigentliche Hebel, mit dem der
              Katalog an die eigene Betroffenheit angepasst wird. Nur fuer
              Verwalter: Wer hier etwas wegnimmt, nimmt es aus der
              Erfuellungsquote heraus. */}
          {canManage && (
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-slate-700 p-3">
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.applicability')}</p>
                <p className="text-xs text-gray-600 dark:text-slate-400">{t('modal.applicabilityHint')}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(['essential', 'important', 'indirect'] as const).map(prof => (
                  <Select key={prof} label={t(`profile.types.${prof}.short`)}
                    value={editForm.applicability[prof]}
                    onChange={e => setEditForm({ ...editForm, applicability: { ...editForm.applicability, [prof]: e.target.value as Obligation } })}
                    options={OBLIGATIONS.map(o => ({ value: o, label: t(`obligation.${o}`) }))} />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('modal.notes')}</label>
            <textarea className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-3 text-sm dark:text-white focus:ring-2 focus:ring-blue-500 outline-hidden" rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} disabled={!canWrite} />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditMeasure(null)} className="flex-1 justify-center">{t('modal.cancel')}</Button>
            {canWrite && <Button type="submit" disabled={saving} className="flex-1 justify-center">{saving ? t('modal.saving') : t('modal.save')}</Button>}
          </div>
        </form>
      </Modal>
    </div>
  );
};
