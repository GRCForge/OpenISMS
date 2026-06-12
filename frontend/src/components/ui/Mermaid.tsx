import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '../../contexts/ThemeContext';

interface MermaidProps {
  chart: string;
  className?: string;
}

// Unique ID per render call (mermaid.render requires a unique id)
let counter = 0;

export const Mermaid: React.FC<MermaidProps> = ({ chart, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!chart || !ref.current) return;

    const isDark = theme === 'dark';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'base',
      securityLevel: 'strict',
      themeVariables: {
        primaryColor: '#3b82f6',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#2563eb',
        lineColor: isDark ? '#64748b' : '#94a3b8',
        fontSize: '14px',
      },
      flowchart: { useMaxWidth: true, htmlLabels: false, curve: 'basis' },
    });

    // Parse "click <nodeId> href <url>" directives so we can re-apply them after
    // strict mode strips them from the rendered SVG.
    const clickMap = new Map<string, string>();
    for (const line of chart.split('\n')) {
      const m = line.match(/^\s*click\s+(\S+)\s+href\s+"([^"]+)"/);
      if (m) clickMap.set(m[1], m[2]);
    }

    const id = `mermaid-svg-${counter++}`;
    mermaid
      .render(id, chart)
      .then(({ svg, bindFunctions }: { svg: string; bindFunctions?: (el: Element) => void }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg; // NOSONAR(typescript:S5247) - SVG from Mermaid with securityLevel:'strict'; htmlLabels:false
        bindFunctions?.(ref.current);
        setError(false);

        // Post-process: attach click navigation to nodes.
        // SVG node ids have the form "flowchart-{nodeId}-{index}".
        if (clickMap.size > 0) {
          ref.current.querySelectorAll<SVGGElement>('g.node').forEach(node => {
            const match = node.id.match(/^flowchart-(.+)-\d+$/);
            const nodeKey = match?.[1];
            if (nodeKey && clickMap.has(nodeKey)) {
              node.style.cursor = 'pointer';
              node.addEventListener('click', () => {
                const url = clickMap.get(nodeKey)!;
                if (url.startsWith('/')) window.location.href = url; // only relative paths allowed
              });
            }
          });
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => { cancelled = true; };
  }, [chart, theme]);

  if (error) {
    return (
      <div className={`flex items-center justify-center py-10 text-sm text-gray-400 dark:text-slate-500 ${className}`}>
        Diagramm konnte nicht dargestellt werden.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`flex justify-center py-4 bg-gray-50/50 dark:bg-slate-900/50 rounded-xl border dark:border-slate-800 overflow-x-auto ${className}`}
    />
  );
};
