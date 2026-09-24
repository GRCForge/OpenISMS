import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2, Search, ShieldCheck, Route as RouteIcon, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../lib/api';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Mermaid } from '../components/ui/Mermaid';
import { mermaidLabel } from '../lib/mermaid';
import { useAuth } from '../contexts/AuthContext';

// Beziehungsauswertung ueber den Graphen (Apache AGE, seit v3.0.0).
//
// Diese Seite beantwortet die Fragen, fuer die die Listenansichten nicht
// gebaut sind - naemlich die mit unbestimmter Tiefe. "Welche Prozesse haengen
// an diesem Server" steht in keiner Liste, weil die Kette ueber mehrere
// Zwischenschritte laeuft und je Ausgangspunkt anders lang ist.

interface GraphMeta {
  available: boolean;
  detail: string | null;
  labels: string[];
  edgeTypes: string[];
  entityTypes: Record<string, string>;
  frameworks: string[];
}

interface ImpactItem {
  label: string;
  pk: number | null;
  properties: Record<string, unknown>;
  distance: number;
}

interface ImpactResult {
  origin: { type: string; label: string; pk: number };
  depth: number;
  total: number;
  byLabel: Record<string, number>;
  truncated: boolean;
  items: ImpactItem[];
}

interface EvidenceResult {
  requirement: Record<string, unknown>;
  framework: string;
  ref: string;
  covered: boolean;
  evidence: Array<{
    control: { pk: number; properties: Record<string, unknown> };
    coverage: string;
    risks: Array<{ properties: Record<string, unknown>; assets: Array<Record<string, unknown>> }>;
  }>;
}

// Der sprechende Name eines Knotens. Die Modelle sind sich uneinig, ob das Feld
// `name`, `title` oder (bei Anforderungen) `ref` heisst - deshalb hier einmal
// zentral, statt an jeder Ausgabestelle dieselbe Kette zu wiederholen.
const knotenName = (props: Record<string, unknown>): string => {
  const p = props || {};
  if (typeof p.ref === 'string' && p.ref) {
    return typeof p.title === 'string' && p.title ? `${p.ref} — ${p.title}` : p.ref;
  }
  for (const feld of ['name', 'title', 'code']) {
    const v = p[feld];
    if (typeof v === 'string' && v) return v;
  }
  return '—';
};

const LABEL_FARBEN: Record<string, string> = {
  Asset: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Vendor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Risk: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  Control: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Threat: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  Incident: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  VvtEntry: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  BcmProcess: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  Policy: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  AiSystem: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  Dsfa: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  Requirement: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

const LabelChip: React.FC<{ label: string }> = ({ label }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${LABEL_FARBEN[label] || LABEL_FARBEN.Requirement}`}>
    {label}
  </span>
);

type Tab = 'impact' | 'evidence' | 'path';

export const Graph: React.FC = () => {
  const { t } = useTranslation('graph');
  const { user } = useAuth();
  const [meta, setMeta] = useState<GraphMeta | null>(null);
  const [tab, setTab] = useState<Tab>('impact');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState('');

  useEffect(() => {
    api.get('/graph/meta').then(r => setMeta(r.data)).catch(() => setMeta(null));
  }, []);

  const rebuild = async () => {
    setRebuilding(true); setRebuildMsg('');
    try {
      const r = await api.post('/graph/rebuild');
      setRebuildMsg(t('rebuild_done', { nodes: r.data.nodes, edges: r.data.edges, ms: r.data.duration_ms }));
    } catch (e: any) {
      setRebuildMsg(e.response?.data?.error || t('rebuild_failed'));
    } finally { setRebuilding(false); }
  };

  if (!meta) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-blue-600" /></div>;
  }

  // Ohne Extension gibt es nichts auszuwerten. Statt leerer Kacheln steht hier,
  // WAS fehlt und was zu tun ist - die Meldung aus dem Backend wird
  // durchgereicht, weil sie den konkreten Grund kennt.
  if (!meta.available) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
          <Share2 size={22} className="text-blue-600" />{t('title')}
        </h1>
        <Card>
          <CardBody className="flex items-start gap-3 py-6">
            <AlertTriangle size={20} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-semibold dark:text-white">{t('unavailable_title')}</p>
              <p className="mt-1 text-gray-600 dark:text-slate-400">{t('unavailable_hint')}</p>
              {meta.detail && (
                <p className="mt-2 font-mono text-xs text-gray-500 dark:text-slate-500 break-all">{meta.detail}</p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const tabs: Array<{ key: Tab; icon: React.FC<any>; label: string }> = [
    { key: 'impact', icon: Search, label: t('tabs.impact') },
    { key: 'evidence', icon: ShieldCheck, label: t('tabs.evidence') },
    { key: 'path', icon: RouteIcon, label: t('tabs.path') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Share2 size={22} className="text-blue-600" />{t('title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-3xl">{t('subtitle')}</p>
        </div>
        {user?.role === 'admin' && (
          <div className="flex items-center gap-3">
            {rebuildMsg && <span className="text-xs text-gray-500 dark:text-slate-400">{rebuildMsg}</span>}
            <Button variant="secondary" onClick={rebuild} disabled={rebuilding}>
              <RefreshCw size={14} className={rebuilding ? 'animate-spin' : ''} />
              {rebuilding ? t('rebuilding') : t('rebuild')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b dark:border-slate-700 overflow-x-auto">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {tab === 'impact' && <ImpactPanel meta={meta} />}
      {tab === 'evidence' && <EvidencePanel meta={meta} />}
      {tab === 'path' && <PathPanel meta={meta} />}
    </div>
  );
};

// --------------------------------------------------------------------------
// Auswirkungsanalyse
// --------------------------------------------------------------------------
const ImpactPanel: React.FC<{ meta: GraphMeta }> = ({ meta }) => {
  const { t } = useTranslation('graph');
  const [typ, setTyp] = useState('asset');
  const [id, setId] = useState('');
  const [depth, setDepth] = useState('3');
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [ergebnis, setErgebnis] = useState<ImpactResult | null>(null);

  const suchen = async () => {
    if (!id.trim()) return;
    setLaedt(true); setFehler(''); setErgebnis(null);
    try {
      const r = await api.get(`/graph/impact/${typ}/${encodeURIComponent(id.trim())}`, { params: { depth } });
      setErgebnis(r.data);
    } catch (e: any) {
      setFehler(e.response?.data?.error || t('error_generic'));
    } finally { setLaedt(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <Select label={t('impact.entity_type')} value={typ} onChange={e => setTyp(e.target.value)}>
            {Object.keys(meta.entityTypes).map(k => (
              <option key={k} value={k}>{t(`entity.${k}`, { defaultValue: k })}</option>
            ))}
          </Select>
          <Input label={t('impact.entity_id')} type="number" value={id} onChange={e => setId(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') suchen(); }} placeholder="42" />
          <Select label={t('impact.depth')} value={depth} onChange={e => setDepth(e.target.value)}>
            {['1', '2', '3', '4'].map(d => <option key={d} value={d}>{t('impact.hops', { count: Number(d) })}</option>)}
          </Select>
          <Button onClick={suchen} disabled={laedt || !id.trim()}>
            {laedt ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {t('impact.analyse')}
          </Button>
        </CardBody>
      </Card>

      {fehler && (
        <Card><CardBody className="text-sm text-red-600 dark:text-red-400 py-4">{fehler}</CardBody></Card>
      )}

      {ergebnis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {Object.entries(ergebnis.byLabel).map(([label, n]) => (
              <Card key={label}>
                <CardBody className="py-3">
                  <div className="text-2xl font-bold dark:text-white">{n}</div>
                  <LabelChip label={label} />
                </CardBody>
              </Card>
            ))}
          </div>

          {ergebnis.total === 0 && (
            <Card><CardBody className="text-sm text-gray-500 dark:text-slate-400 py-6">{t('impact.empty')}</CardBody></Card>
          )}

          {ergebnis.truncated && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-300">{t('impact.truncated')}</p>
            </div>
          )}

          {ergebnis.total > 0 && (
            <Card>
              <CardHeader>
                <h2 className="font-semibold dark:text-white text-sm">
                  {t('impact.results', { count: ergebnis.total, depth: ergebnis.depth })}
                </h2>
              </CardHeader>
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider w-24">{t('impact.distance')}</th>
                      <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider w-32">{t('impact.kind')}</th>
                      <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('impact.name')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {ergebnis.items.map((it, i) => (
                      <tr key={`${it.label}-${it.pk}-${i}`} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20">
                        <td className="px-4 py-2 text-gray-500 dark:text-slate-400">
                          {t('impact.hops', { count: it.distance })}
                        </td>
                        <td className="px-4 py-2"><LabelChip label={it.label} /></td>
                        <td className="px-4 py-2 dark:text-slate-200">{knotenName(it.properties)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

// --------------------------------------------------------------------------
// Nachweis als Pfad
// --------------------------------------------------------------------------
const EvidencePanel: React.FC<{ meta: GraphMeta }> = ({ meta }) => {
  const { t } = useTranslation('graph');
  const [framework, setFramework] = useState(meta.frameworks[0] || 'iso27001');
  const [ref, setRef] = useState('');
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [ergebnis, setErgebnis] = useState<EvidenceResult | null>(null);

  const suchen = async () => {
    if (!ref.trim()) return;
    setLaedt(true); setFehler(''); setErgebnis(null);
    try {
      const r = await api.get(`/graph/evidence/${framework}/${encodeURIComponent(ref.trim())}`);
      setErgebnis(r.data);
    } catch (e: any) {
      setFehler(e.response?.data?.error || t('error_generic'));
    } finally { setLaedt(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <Select label={t('evidence.framework')} value={framework} onChange={e => setFramework(e.target.value)}>
            {meta.frameworks.map(f => <option key={f} value={f}>{t(`framework.${f}`, { defaultValue: f })}</option>)}
          </Select>
          <Input label={t('evidence.ref')} value={ref} onChange={e => setRef(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') suchen(); }} placeholder="A.8.13" />
          <Button onClick={suchen} disabled={laedt || !ref.trim()}>
            {laedt ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {t('evidence.check')}
          </Button>
        </CardBody>
      </Card>

      {fehler && <Card><CardBody className="text-sm text-red-600 dark:text-red-400 py-4">{fehler}</CardBody></Card>}

      {ergebnis && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-semibold dark:text-white text-sm">{knotenName(ergebnis.requirement)}</h2>
              {/* Die Aussage, auf die es ankommt: belegt oder nicht. Sie steht
                  bewusst oben und nicht als Fussnote unter der Liste. */}
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                ergebnis.covered
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              }`}>
                {ergebnis.covered ? t('evidence.covered') : t('evidence.not_covered')}
              </span>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            {!ergebnis.covered && (
              <p className="text-sm text-gray-500 dark:text-slate-400">{t('evidence.no_control')}</p>
            )}
            {ergebnis.evidence.map((e, i) => (
              <div key={i} className="border dark:border-slate-700 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <LabelChip label="Control" />
                  <span className="text-sm font-medium dark:text-slate-100">{knotenName(e.control.properties)}</span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">
                    {t(`evidence.coverage_${e.coverage}`, { defaultValue: e.coverage })}
                  </span>
                </div>
                {e.risks.length === 0 && (
                  <p className="text-xs text-gray-500 dark:text-slate-400 pl-1">{t('evidence.no_risk')}</p>
                )}
                {e.risks.map((r, j) => (
                  <div key={j} className="pl-4 border-l-2 dark:border-slate-700 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <LabelChip label="Risk" />
                      <span className="text-sm dark:text-slate-200">{knotenName(r.properties)}</span>
                    </div>
                    {r.assets.map((a, k) => (
                      <div key={k} className="flex items-center gap-2 pl-4 flex-wrap">
                        <LabelChip label="Asset" />
                        <span className="text-sm dark:text-slate-300">{knotenName(a)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
};

// --------------------------------------------------------------------------
// Kuerzeste Verbindung
// --------------------------------------------------------------------------
const PathPanel: React.FC<{ meta: GraphMeta }> = ({ meta }) => {
  const { t } = useTranslation('graph');
  const [vonTyp, setVonTyp] = useState('asset');
  const [vonId, setVonId] = useState('');
  const [nachTyp, setNachTyp] = useState('control');
  const [nachId, setNachId] = useState('');
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState('');
  const [ergebnis, setErgebnis] = useState<{ found: boolean; hops: number | null; nodes: any[]; edges: any[] } | null>(null);

  const suchen = async () => {
    if (!vonId.trim() || !nachId.trim()) return;
    setLaedt(true); setFehler(''); setErgebnis(null);
    try {
      const r = await api.get(`/graph/path/${vonTyp}/${encodeURIComponent(vonId.trim())}/${nachTyp}/${encodeURIComponent(nachId.trim())}`);
      setErgebnis(r.data);
    } catch (e: any) {
      setFehler(e.response?.data?.error || t('error_generic'));
    } finally { setLaedt(false); }
  };

  // Der Pfad als Diagramm. mermaidLabel() maskiert die Beschriftungen - ein
  // Anfuehrungszeichen oder eine eckige Klammer in einem Asset-Namen wuerde
  // die Diagrammdefinition sonst zerlegen.
  const chart = useMemo(() => {
    if (!ergebnis?.found || !ergebnis.nodes.length) return '';
    const zeilen = ['flowchart LR'];
    ergebnis.nodes.forEach((n, i) => {
      zeilen.push(`  n${i}["${mermaidLabel(`${n.label}: ${knotenName(n.properties)}`)}"]`);
    });
    ergebnis.edges.forEach((e, i) => {
      zeilen.push(`  n${i} -->|"${mermaidLabel(e.type)}"| n${i + 1}`);
    });
    return zeilen.join('\n');
  }, [ergebnis]);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <Select label={t('path.from_type')} value={vonTyp} onChange={e => setVonTyp(e.target.value)}>
            {Object.keys(meta.entityTypes).map(k => <option key={k} value={k}>{t(`entity.${k}`, { defaultValue: k })}</option>)}
          </Select>
          <Input label={t('path.from_id')} type="number" value={vonId} onChange={e => setVonId(e.target.value)} />
          <Select label={t('path.to_type')} value={nachTyp} onChange={e => setNachTyp(e.target.value)}>
            {Object.keys(meta.entityTypes).map(k => <option key={k} value={k}>{t(`entity.${k}`, { defaultValue: k })}</option>)}
          </Select>
          <Input label={t('path.to_id')} type="number" value={nachId} onChange={e => setNachId(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter') suchen(); }} />
          <Button onClick={suchen} disabled={laedt || !vonId.trim() || !nachId.trim()}>
            {laedt ? <Loader2 size={14} className="animate-spin" /> : <RouteIcon size={14} />}
            {t('path.find')}
          </Button>
        </CardBody>
      </Card>

      {fehler && <Card><CardBody className="text-sm text-red-600 dark:text-red-400 py-4">{fehler}</CardBody></Card>}

      {ergebnis && !ergebnis.found && (
        <Card><CardBody className="text-sm text-gray-500 dark:text-slate-400 py-6">{t('path.none')}</CardBody></Card>
      )}

      {ergebnis?.found && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold dark:text-white text-sm">{t('path.found', { count: ergebnis.hops ?? 0 })}</h2>
          </CardHeader>
          <CardBody>
            <Mermaid chart={chart} />
          </CardBody>
        </Card>
      )}
    </div>
  );
};
