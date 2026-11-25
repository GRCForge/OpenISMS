import api from './api';
import i18n from '../i18n';
import type { RiskScale, RiskScaleStep, RiskLevel, RiskLevelDef } from '../types';

/**
 * Helfer fuer die Risikomethodik. Skalen, Stufen und Schwellen kommen vom Server
 * (/api/risks/scale) - keine Stelle im Frontend nimmt mehr eine 5x5-Matrix an.
 * Versionen sind unveraenderlich, deshalb werden fruehere Versionen fuer die
 * Dauer der Sitzung zwischengespeichert; die aktive wird bei jedem Laden geholt.
 */

const versionCache = new Map<number, RiskScale>();

export const loadActiveScale = async (): Promise<RiskScale> => {
  const r = await api.get<RiskScale>('/risks/scale');
  if (r.data?.id) versionCache.set(r.data.id, r.data);
  return r.data;
};

export const loadScaleVersion = async (id: number): Promise<RiskScale> => {
  const hit = versionCache.get(id);
  if (hit) return hit;
  const r = await api.get<RiskScale>('/risks/scale', { params: { version: id } });
  versionCache.set(id, r.data);
  return r.data;
};

export const forgetScales = () => versionCache.clear();

// Bezeichnungen der Methodik gibt es auf Deutsch und Englisch; alle anderen
// Sprachen zeigen die englische.
const useGerman = () => (i18n.language || '').toLowerCase().startsWith('de');

export const stepLabel = (step?: RiskScaleStep | null) => (step ? (useGerman() ? step.label_de : step.label_en) || step.label_de : '');

export const levelDef = (scale: RiskScale | null | undefined, key?: string | null): RiskLevelDef | undefined =>
  scale?.risk_levels.find(l => l.key === key);

export const levelLabel = (scale: RiskScale | null | undefined, key?: string | null, fallback?: string) => {
  const def = levelDef(scale, key);
  if (!def) return fallback ?? (key || '');
  return (useGerman() ? def.label_de : def.label_en) || def.label_de;
};

export const levelColor = (scale: RiskScale | null | undefined, key?: RiskLevel | string | null) => levelDef(scale, key)?.color || '#6b7280';

// Lesbarer Text fuer Schrift auf einer Stufenfarbe (YIQ-Helligkeit).
export const textOn = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#111827' : '#ffffff';
};

export const rangeText = (step: RiskScaleStep, unit?: string | null) => {
  const fmt = (n: number) => n.toLocaleString(i18n.language || 'de');
  const u = unit ? ` ${unit}` : '';
  if (step.range_min != null && step.range_max != null) return `${fmt(step.range_min)}–${fmt(step.range_max)}${u}`;
  if (step.range_min != null) return `≥ ${fmt(step.range_min)}${u}`;
  if (step.range_max != null) return `≤ ${fmt(step.range_max)}${u}`;
  return '';
};

export const stepOptions = (steps: RiskScaleStep[], unit?: string | null) =>
  steps.map(s => {
    const range = rangeText(s, unit);
    return { value: String(s.value), label: `${stepLabel(s)} (${s.value})${range ? ` · ${range}` : ''}` };
  });
