import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { IconButton } from '../ui/IconButton';

// Welche Anforderungen erfuellt diese Massnahme — ueber Regelwerksgrenzen hinweg.
//
// Bis v2.2.x trug eine Massnahme genau ein `framework`, und die
// Anforderungskataloge standen unverbunden daneben. Wer dieselbe Massnahme fuer
// ISO A.5.15, BSI ORP.4.A1 und C5 IDM-01 nachweisen wollte, musste sie dreimal
// anlegen — und beim naechsten Audit dreimal pflegen, mit drei Staenden, die
// auseinanderlaufen.

interface Zuordnung {
  id: number;
  framework: string;
  requirement_id: number;
  coverage: 'full' | 'partial';
  note: string | null;
  requirement: { id: number; ref: string; title: string; status: string | null } | null;
}

interface KatalogEintrag { id: number; ref: string; title: string }

// Regelwerk -> Endpunkt und die Felder, unter denen der jeweilige Katalog seine
// fachliche Referenz fuehrt. Die Kataloge sind historisch gewachsen und heissen
// alle etwas anderes; das hier ist die einzige Stelle, die das weiss.
const KATALOGE: Record<string, { pfad: string; refFeld: string }> = {
  iso27001: { pfad: '/iso27001', refFeld: 'ref' },
  bsi: { pfad: '/bsi-grundschutz', refFeld: 'req_id' },
  nis2: { pfad: '/nis2', refFeld: 'article_ref' },
  c5: { pfad: '/c5', refFeld: 'criterion_id' },
  tisax: { pfad: '/tisax', refFeld: 'ref' },
};

export const RequirementMapping: React.FC<{ controlId: number; canEdit: boolean }> = ({ controlId, canEdit }) => {
  const { t } = useTranslation('controls');
  const [zuordnungen, setZuordnungen] = useState<Zuordnung[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [framework, setFramework] = useState('iso27001');
  const [katalog, setKatalog] = useState<KatalogEintrag[]>([]);
  const [katalogLaedt, setKatalogLaedt] = useState(false);
  const [auswahl, setAuswahl] = useState('');
  const [abdeckung, setAbdeckung] = useState<'full' | 'partial'>('full');
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState('');

  const laden = async () => {
    try {
      const r = await api.get(`/controls/${controlId}/requirements`);
      setZuordnungen(Array.isArray(r.data) ? r.data : []);
    } catch { setZuordnungen([]); }
    finally { setLaedt(false); }
  };
  useEffect(() => { setLaedt(true); laden(); }, [controlId]);

  // Den Katalog des gewaehlten Regelwerks nachladen. Ist das Modul
  // abgeschaltet, antwortet die Route mit 403 — dann bleibt die Liste leer und
  // der Hinweis darunter sagt, warum.
  useEffect(() => {
    const k = KATALOGE[framework];
    if (!k) return;
    setKatalogLaedt(true); setAuswahl('');
    api.get(k.pfad)
      .then(r => {
        const rows = Array.isArray(r.data) ? r.data : (r.data?.items ?? []);
        setKatalog(rows.map((x: any) => ({ id: x.id, ref: x[k.refFeld] ?? '', title: x.title ?? '' })));
      })
      .catch(() => setKatalog([]))
      .finally(() => setKatalogLaedt(false));
  }, [framework]);

  const hinzufuegen = async () => {
    if (!auswahl) return;
    setSpeichert(true); setFehler('');
    try {
      await api.post(`/controls/${controlId}/requirements`, {
        framework, requirement_id: Number(auswahl), coverage: abdeckung,
      });
      setAuswahl('');
      await laden();
    } catch (e: any) {
      setFehler(e.response?.data?.error || t('requirements.add_failed'));
    } finally { setSpeichert(false); }
  };

  const entfernen = async (id: number) => {
    try { await api.delete(`/controls/${controlId}/requirements/${id}`); await laden(); }
    catch (e: any) { setFehler(e.response?.data?.error || t('requirements.delete_failed')); }
  };

  const nachFramework = zuordnungen.reduce<Record<string, Zuordnung[]>>((acc, z) => {
    (acc[z.framework] = acc[z.framework] || []).push(z);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase text-gray-500 tracking-wider flex items-center gap-2 dark:text-gray-400">
        <Link2 size={13} />{t('requirements.title')}
      </h3>
      <p className="text-xs text-gray-500 dark:text-slate-400">{t('requirements.hint')}</p>

      {laedt ? (
        <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-blue-600" /></div>
      ) : (
        <div className="border dark:border-slate-700 rounded-xl p-3 space-y-3 bg-gray-50/30 dark:bg-slate-800/20">
          {zuordnungen.length === 0 && (
            <p className="text-xs text-gray-500 italic dark:text-gray-400">{t('requirements.none')}</p>
          )}
          {Object.entries(nachFramework).map(([fw, liste]) => (
            <div key={fw} className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                {t(`requirements.framework.${fw}`, { defaultValue: fw })}
              </p>
              {liste.map(z => (
                <div key={z.id} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-800 border dark:border-slate-700">
                  <div className="min-w-0 flex-1">
                    {z.requirement ? (
                      <>
                        <p className="text-sm dark:text-slate-200 truncate">
                          <span className="font-mono text-xs text-blue-700 dark:text-blue-300">{z.requirement.ref}</span>
                          {' — '}{z.requirement.title}
                        </p>
                      </>
                    ) : (
                      // Die Zuordnung zeigt ins Leere. Sie wegzulassen waere die
                      // schlechtere Wahl: Sie stuende weiter in der Tabelle und
                      // liesse sich nirgends mehr entfernen.
                      <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
                        <AlertTriangle size={12} className="shrink-0" />
                        {t('requirements.dangling', { id: z.requirement_id })}
                      </p>
                    )}
                  </div>
                  {z.coverage === 'partial' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap">
                      {t('requirements.coverage_partial')}
                    </span>
                  )}
                  {canEdit && (
                    <IconButton label={t('requirements.remove')} variant="danger" onClick={() => entfernen(z.id)}>
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>
          ))}

          {canEdit && (
            <div className="pt-3 border-t dark:border-slate-700 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Select label={t('requirements.framework_label')} value={framework} onChange={e => setFramework(e.target.value)}>
                  {Object.keys(KATALOGE).map(f => (
                    <option key={f} value={f}>{t(`requirements.framework.${f}`, { defaultValue: f })}</option>
                  ))}
                </Select>
                <Select label={t('requirements.coverage_label')} value={abdeckung} onChange={e => setAbdeckung(e.target.value as 'full' | 'partial')}>
                  <option value="full">{t('requirements.coverage_full')}</option>
                  <option value="partial">{t('requirements.coverage_partial')}</option>
                </Select>
              </div>
              <Select label={t('requirements.requirement_label')} value={auswahl} onChange={e => setAuswahl(e.target.value)} disabled={katalogLaedt}>
                <option value="">
                  {katalogLaedt ? t('requirements.loading') : t('requirements.select')}
                </option>
                {katalog.map(k => (
                  <option key={k.id} value={String(k.id)}>{k.ref} — {k.title}</option>
                ))}
              </Select>
              {!katalogLaedt && katalog.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t('requirements.catalogue_empty')}</p>
              )}
              {fehler && <p className="text-xs text-red-600 dark:text-red-400">{fehler}</p>}
              <Button size="sm" onClick={hinzufuegen} disabled={speichert || !auswahl}>
                {speichert ? t('requirements.adding') : t('requirements.add')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
