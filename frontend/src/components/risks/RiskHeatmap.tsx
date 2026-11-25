import React from 'react';
import { useTranslation } from 'react-i18next';
import type { RiskScale } from '../../types';
import { levelColor, levelLabel, stepLabel, textOn } from '../../lib/riskMethodology';

export interface HeatmapCellRef { likelihood: number; impact: number; }

interface Props {
  scale: RiskScale;
  // Anzahl Risiken je Zelle, Schluessel "L-I". Ohne counts: reine Vorschau.
  counts?: Map<string, number>;
  selected?: HeatmapCellRef | null;
  onSelect?: (cell: HeatmapCellRef | null) => void;
  compact?: boolean;
}

// Matrix Wahrscheinlichkeit (Zeilen, oben die hoechste) x Auswirkung (Spalten)
// in der Groesse der Methodik (3 bis 6 Stufen je Achse).
export const RiskHeatmap: React.FC<Props> = ({ scale, counts, selected, onSelect, compact }) => {
  const { t } = useTranslation('risks');
  const cellSize = compact ? 'h-8 text-[10px]' : 'h-10 text-xs';
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <div className="flex items-center justify-center w-4 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 -rotate-90 whitespace-nowrap">{t('heatmap.likelihood')}</span>
        </div>
        <div className="flex-1 min-w-0">
          <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
            <tbody>
              {scale.matrix.map(row => (
                <tr key={row[0].likelihood}>
                  <th scope="row" className="text-[10px] font-medium text-gray-500 dark:text-slate-400 text-right pr-1 w-6" title={stepLabel(scale.likelihood_levels[row[0].likelihood - 1])}>{row[0].likelihood}</th>
                  {row.map(cell => {
                    const color = levelColor(scale, cell.level);
                    const n = counts?.get(`${cell.likelihood}-${cell.impact}`) || 0;
                    const isSel = selected?.likelihood === cell.likelihood && selected?.impact === cell.impact;
                    const label = `${stepLabel(scale.likelihood_levels[cell.likelihood - 1])} × ${stepLabel(scale.impact_levels[cell.impact - 1])} = ${cell.score} (${levelLabel(scale, cell.level)})`;
                    const content = counts ? (n > 0 ? n : '') : cell.score;
                    return (
                      <td key={cell.impact} className="p-0">
                        {onSelect ? (
                          <button type="button" title={label} aria-label={`${label}: ${n}`} aria-pressed={isSel}
                            onClick={() => onSelect(isSel ? null : { likelihood: cell.likelihood, impact: cell.impact })}
                            className={`w-full ${cellSize} rounded-md font-bold transition-transform ${isSel ? 'ring-2 ring-offset-1 ring-blue-600 dark:ring-offset-slate-900 scale-105' : ''} ${n === 0 && counts ? 'opacity-70' : ''}`}
                            style={{ backgroundColor: color, color: textOn(color) }}>
                            {content}
                          </button>
                        ) : (
                          <div title={label} className={`w-full ${cellSize} rounded-md font-bold flex items-center justify-center`} style={{ backgroundColor: color, color: textOn(color) }}>{content}</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td />
                {scale.impact_levels.map(s => (
                  <td key={s.value} className="text-center text-[10px] font-medium text-gray-500 dark:text-slate-400" title={stepLabel(s)}>{s.value}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-center text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{t('heatmap.impact')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {scale.risk_levels.map(l => (
          <span key={l.key} className="inline-flex items-center gap-1 text-[10px] text-gray-600 dark:text-slate-400">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            {levelLabel(scale, l.key)} {l.min_score}–{l.max_score}
          </span>
        ))}
      </div>
    </div>
  );
};
