import React, { useEffect, useMemo, useState } from 'react';
import { Network, GitBranch, Layers, Box } from 'lucide-react';
import api from '../lib/api';
import type { Asset, RiskLevel } from '../types';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Mermaid } from '../components/ui/Mermaid';
import { Skeleton, SkeletonStatCard, SkeletonCard } from '../components/ui/Skeleton';
import { Select } from '../components/ui/Select';

const typeLabels: Record<string, string> = {
  hardware: 'Hardware', software: 'Software', information: 'Information/Daten',
  process: 'Prozess', service: 'Service', personal: 'Personal',
  application: 'Anwendung', data: 'Daten',
  ai_application: 'KI-Anwendung (AI Act)', ai_agent: 'KI-Agent', other: 'Sonstiges',
};

// Mermaid node shape per asset type — labels must be quoted to handle special chars
const typeShape = (type: string, label: string): string => {
  switch (type) {
    case 'hardware':       return `["🖥 ${label}"]`;
    case 'software':       return `("💾 ${label}")`;
    case 'application':    return `("📦 ${label}")`;
    case 'data':
    case 'information':    return `[("🗄 ${label}")]`;
    case 'service':        return `{"🔌 ${label}"}`;
    case 'process':        return `[/"⚙ ${label}"/]`;
    case 'ai_application':
    case 'ai_agent':       return `(("🤖 ${label}"))`;
    case 'personal':       return `["👤 ${label}"]`;
    default:               return `["${label}"]`;
  }
};

// Farbklassen je Risikostufe (Mermaid classDef)
const classDefs = [
  'classDef critical fill:#fee2e2,stroke:#ef4444,color:#991b1b,stroke-width:2px;',
  'classDef high fill:#ffedd5,stroke:#f97316,color:#9a3412,stroke-width:1.5px;',
  'classDef medium fill:#fef9c3,stroke:#eab308,color:#854d0e;',
  'classDef low fill:#dcfce7,stroke:#22c55e,color:#166534;',
  'classDef none fill:#f1f5f9,stroke:#cbd5e1,color:#475569;',
  'classDef ai fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px;',
].join('\n  ');

const Legend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
    <span className={`w-3 h-3 rounded-sm ${color}`} /> {label}
  </span>
);

export const Topology: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<'LR' | 'TD'>('LR');
  const [typeFilter, setTypeFilter] = useState<string>('');

  useEffect(() => {
    api.get('/assets').then(r => setAssets(Array.isArray(r.data) ? r.data : [])).catch(() => setAssets([])).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => (typeFilter ? assets.filter(a => a.type === typeFilter) : assets),
    [assets, typeFilter]
  );

  const stats = useMemo(() => {
    const ids = new Set(filtered.map(a => a.id));
    const hasParent = (a: Asset) => !!a.parent_id && ids.has(a.parent_id);
    const parentIds = new Set(filtered.filter(hasParent).map(a => a.parent_id));
    const roots = filtered.filter(a => !hasParent(a) && parentIds.has(a.id)).length;
    const linked = filtered.filter(a => hasParent(a) || parentIds.has(a.id)).length;
    const isolated = filtered.length - linked;
    return { total: filtered.length, roots, linked, isolated };
  }, [filtered]);

  const chart = useMemo(() => {
    if (!filtered.length) return '';
    const ids = new Set(filtered.map(a => a.id));
    const nid = (id: number) => `n${id}`;
    const esc = (s?: string) => (s || 'Unbenannt').replace(/"/g, "'").replace(/[`#;{}[\]/\\]/g, '').replace(/[\n\r]+/g, ' ').trim().slice(0, 42);

    // Only render assets that participate in at least one parent→child relationship
    const connectedIds = new Set<number>();
    filtered.forEach(a => {
      if (a.parent_id && ids.has(Number(a.parent_id))) {
        connectedIds.add(a.id);
        connectedIds.add(Number(a.parent_id));
      }
    });
    const chartAssets = filtered.filter(a => connectedIds.has(a.id));
    if (!chartAssets.length) return '';

    // Build parent → direct children map (only within chart assets)
    const childrenMap = new Map<number, number[]>();
    chartAssets.forEach(a => {
      if (a.parent_id && connectedIds.has(Number(a.parent_id))) {
        const pid = Number(a.parent_id);
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid)!.push(a.id);
      }
    });

    const inSubgraph = new Set<number>();
    let c = `graph ${direction}\n  ${classDefs}\n`;

    // Subgraphs: each parent gets a visual cluster containing its leaf children
    childrenMap.forEach((childIds, parentId) => {
      const parent = chartAssets.find(a => a.id === parentId);
      if (!parent) return;
      c += `  subgraph sg${parentId}[" "]\n`;
      c += `    ${nid(parentId)}${typeShape(parent.type, esc(parent.name))}\n`;
      inSubgraph.add(parentId);
      childIds.forEach(cid => {
        // Only include leaf children (children that aren't also parents) in this subgraph
        if (!childrenMap.has(cid)) {
          const child = chartAssets.find(a => a.id === cid);
          if (child) { c += `    ${nid(cid)}${typeShape(child.type, esc(child.name))}\n`; inSubgraph.add(cid); }
        }
      });
      c += `  end\n`;
    });

    // Multi-level nodes not placed in any subgraph (children that are also parents)
    chartAssets.forEach(a => {
      if (!inSubgraph.has(a.id)) c += `  ${nid(a.id)}${typeShape(a.type, esc(a.name))}\n`;
    });

    // Edges (all parent→child relationships)
    chartAssets.forEach(a => {
      if (a.parent_id && connectedIds.has(Number(a.parent_id))) c += `  ${nid(a.parent_id)} --> ${nid(a.id)}\n`;
    });

    // Class (AI gets purple, others get risk level) + click navigation
    chartAssets.forEach(a => {
      const isAi = a.type === 'ai_application' || a.type === 'ai_agent';
      const lvl: RiskLevel | 'none' = (a.Assessments && a.Assessments[0]?.risk_level) || 'none';
      c += `  class ${nid(a.id)} ${isAi ? 'ai' : lvl};\n`;
      c += `  click ${nid(a.id)} href "/assets/${a.id}" "${esc(a.name)}" _self\n`;
    });
    return c;
  }, [filtered, direction]);

  if (loading) return (
    <div className="space-y-6" role="status" aria-label="Topologie wird geladen">
      <div><Skeleton className="h-7 w-44 mb-1" /><Skeleton className="h-4 w-80" /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
      </div>
      <SkeletonCard lines={8} />
    </div>
  );

  const usedTypes = Array.from(new Set(assets.map(a => a.type)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">Asset-Topologie</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">Gesamtübersicht aller Assets und ihrer Abhängigkeiten (Parent/Child)</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            aria-label="Nach Asset-Typ filtern"
          >
            <option value="">Alle Typen</option>
            {usedTypes.map(t => <option key={String(t)} value={String(t)}>{typeLabels[String(t)] || String(t)}</option>)}
          </Select>
          <div className="flex rounded-lg border border-gray-300 dark:border-slate-700 overflow-hidden" role="group" aria-label="Diagramm-Ausrichtung">
            <button onClick={() => setDirection('LR')} aria-pressed={direction === 'LR'} aria-label="Horizontale Ansicht" className={`px-3 py-1.5 text-sm transition-colors ${direction === 'LR' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}>↔</button>
            <button onClick={() => setDirection('TD')} aria-pressed={direction === 'TD'} aria-label="Vertikale Ansicht" className={`px-3 py-1.5 text-sm transition-colors ${direction === 'TD' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300'}`}>↕</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Box, label: 'Assets', value: stats.total, color: 'bg-blue-500' },
          { icon: GitBranch, label: 'Wurzel-Systeme', value: stats.roots, color: 'bg-indigo-500' },
          { icon: Layers, label: 'Verknüpft', value: stats.linked, color: 'bg-green-500' },
          { icon: Network, label: 'Isoliert', value: stats.isolated, color: 'bg-gray-400' },
        ].map(s => (
          <Card key={s.label}>
            <CardBody className="flex items-center gap-3 py-4">
              <div className={`p-2.5 rounded-xl ${s.color} shrink-0`}><s.icon className="text-white" size={18} /></div>
              <div>
                <p className="text-2xl font-bold dark:text-white">{s.value}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{s.label}</p>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Network size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">Abhängigkeitsgraph</h2></div>
            <div className="flex flex-wrap items-center gap-3">
              <Legend color="bg-red-400" label="Kritisch" />
              <Legend color="bg-orange-400" label="Hoch" />
              <Legend color="bg-yellow-400" label="Mittel" />
              <Legend color="bg-green-400" label="Gering" />
              <Legend color="bg-slate-300" label="Unbewertet" />
              <Legend color="bg-violet-400" label="KI-Asset" />
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {!chart ? (
            <div className="text-center py-16 text-gray-400 dark:text-slate-500">
              <Network size={40} className="mx-auto mb-3 opacity-40" />
              <p className="italic">{filtered.length === 0 ? 'Keine Assets vorhanden.' : 'Keine Abhängigkeiten erfasst. Verknüpfe Assets über das Feld „Übergeordnetes Asset".'}</p>
            </div>
          ) : (
            <>
              <Mermaid chart={chart} className="min-h-[400px]" />
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-3 text-center">Tipp: Auf einen Knoten klicken, um zum jeweiligen Asset zu springen.</p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
