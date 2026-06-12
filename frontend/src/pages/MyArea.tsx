import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutList, CheckSquare, AlertTriangle, ArrowRight, Fingerprint,
  CheckCircle2, Circle, ShieldAlert, Loader2, ChevronRight, Link2, Check, PlayCircle, BookOpen, CheckCircle
} from 'lucide-react';
import { format, isPast, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import api from '../lib/api';
import type { Task } from '../types';
import { Card } from '../components/ui/Card';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

interface OverviewItem {
  id: number;
  name: string;
  sub?: string;
  link: string;
}

interface Section {
  title: string;
  description: string;
  items: OverviewItem[];
  total: number;
  link: string;
  actionLabel: string;
}

interface Overview {
  my_tasks: Task[];
  passkey_count: number;
  sections: Section[];
}

interface UserTraining {
  id: number;
  user_id: number | null;
  training_id: number | null;
  training_title: string;
  employee_name: string | null;
  employee_email: string | null;
  completed_at: string | null;
  expires_at: string | null;
  certificate_url?: string;
  status: string;
  contested: boolean;
  contestation_comment: string | null;
  training?: {
    id: number;
    title: string;
    description?: string;
    required: boolean;
    date?: string;
  }
}

const priorityColor: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-orange-500 dark:text-orange-400',
  medium: 'text-blue-500 dark:text-blue-400',
  low: 'text-gray-400 dark:text-slate-600',
};

export const MyArea: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  
  // Standard states
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState<number | null>(null);

  // Employee-specific states
  const [trainings, setTrainings] = useState<UserTraining[]>([]);
  const [loadingTrainings, setLoadingTrainings] = useState(false);
  const [contestModalOpen, setContestModalOpen] = useState(false);
  const [selectedTraining, setSelectedTraining] = useState<UserTraining | null>(null);
  const [contestComment, setContestComment] = useState('');
  const [submittingContest, setSubmittingContest] = useState(false);

  const loadOverview = useCallback(() => {
    if (user?.role === 'employee') {
      setLoading(false);
      return;
    }
    api.get('/me/overview').then(r => setOverview(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [user]);

  const loadTrainings = useCallback(() => {
    if (user?.role !== 'employee') return;
    setLoadingTrainings(true);
    api.get('/compliance/trainings')
      .then(r => setTrainings(r.data))
      .catch(() => {})
      .finally(() => setLoadingTrainings(false));
  }, [user]);

  useEffect(() => {
    loadOverview();
    loadTrainings();
  }, [loadOverview, loadTrainings]);

  const quickTaskStatus = async (taskId: number, status: 'done' | 'in_progress') => {
    setTaskLoading(taskId);
    try {
      await api.put(`/tasks/${taskId}`, { status });
      setOverview(prev => prev ? {
        ...prev,
        my_tasks: status === 'done'
          ? prev.my_tasks.filter(t => t.id !== taskId)
          : prev.my_tasks.map(t => t.id === taskId ? { ...t, status } : t),
      } : prev);
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Fehler beim Aktualisieren der Aufgabe');
    } finally {
      setTaskLoading(null);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: 'System-Administrator',
    assessor: 'Auditor & Bewerter',
    'it-staff': 'IT-Mitarbeiter',
    dpo: 'Datenschutzbeauftragter',
    owner: 'Asset-Verantwortlicher',
    viewer: 'Gast',
    employee: 'Mitarbeiter',
  };

  if (loading) return <div className="flex justify-center pt-20"><Loader2 className="animate-spin text-blue-600" size={28} /></div>;

  if (user?.role === 'employee') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <BookOpen size={24} className="text-blue-600" />
            Meine Schulungen
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">
            Hier siehst du eine Übersicht deiner absolvierten Schulungen. Du kannst Einträge beanstanden, falls du an einer anderen Schulung teilgenommen hast oder die Angaben fehlerhaft sind.
          </p>
        </div>

        {loadingTrainings ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-blue-600" size={24} />
          </div>
        ) : trainings.length === 0 ? (
          <Card className="p-8 text-center">
            <CheckCircle size={32} className="mx-auto text-green-400 mb-2" />
            <p className="text-gray-500 dark:text-slate-400 font-medium">Keine Schulungseinträge vorhanden</p>
            <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">Es wurden noch keine Schulungsteilnahmen für dein Konto hinterlegt.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {trainings.map(t => (
              <Card key={t.id} className="p-5 border dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:shadow-md transition-all">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold dark:text-white">{t.training_title}</h3>
                      {t.training?.required && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-[10px] font-bold uppercase">
                          Pflicht
                        </span>
                      )}
                    </div>
                    {t.training?.description && (
                      <p className="text-xs text-gray-500 dark:text-slate-400 max-w-2xl">{t.training.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 dark:text-slate-500 pt-1">
                      {t.completed_at && (
                        <span>
                          Absolviert am: <strong>{format(parseISO(t.completed_at), 'dd.MM.yyyy')}</strong>
                        </span>
                      )}
                      {t.expires_at && (
                        <span>
                          Gültig bis: <strong>{format(parseISO(t.expires_at), 'dd.MM.yyyy')}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {t.contested ? (
                      <div className="flex flex-col items-end">
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                          <AlertTriangle size={13} />
                          Beanstandet
                        </span>
                        {t.contestation_comment && (
                          <span className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 max-w-[200px] truncate" title={t.contestation_comment}>
                            "{t.contestation_comment}"
                          </span>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/10 border-amber-200 dark:border-amber-900/30"
                        onClick={() => {
                          setSelectedTraining(t);
                          setContestComment('');
                          setContestModalOpen(true);
                        }}
                      >
                        <AlertTriangle size={14} className="mr-1" />
                        Beanstanden
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Contestation Modal */}
        <Modal
          open={contestModalOpen}
          onClose={() => setContestModalOpen(false)}
          title="Schulungsteilnahme beanstanden"
          size="md"
        >
          <div className="space-y-4 py-2">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl text-amber-800 dark:text-amber-300 text-xs">
              <p className="font-semibold flex items-center gap-1.5 mb-1">
                <AlertTriangle size={14} />
                Hinweis zur Beanstandung
              </p>
              Falls du an dieser Schulung nicht teilgenommen hast, das Datum falsch ist oder du eine andere Schulung besucht hast, kannst du dies hier begründen. Ein Compliance-Mitarbeiter wird deine Anfrage prüfen.
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-gray-400 mb-1">Ausgewählte Schulung</p>
              <p className="text-sm font-bold dark:text-white">{selectedTraining?.training_title}</p>
              {selectedTraining?.completed_at && (
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  Registriertes Datum: {format(parseISO(selectedTraining.completed_at), 'dd.MM.yyyy')}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="contestComment" className="block text-xs font-semibold uppercase text-gray-400">
                Begründung / Korrekturhinweis <span className="text-red-500">*</span>
              </label>
              <textarea
                id="contestComment"
                rows={4}
                className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                placeholder="z.B. 'Ich habe an diesem Tag nicht an dieser Schulung teilgenommen, sondern an der Datenschutz-Schulung B.'"
                value={contestComment}
                onChange={e => setContestComment(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setContestModalOpen(false)} disabled={submittingContest}>
                Abbrechen
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  if (!selectedTraining || !contestComment.trim()) return;
                  setSubmittingContest(true);
                  try {
                    await api.post(`/compliance/trainings/${selectedTraining.id}/contest`, { comment: contestComment });
                    toast.success('Beanstandung erfolgreich eingereicht.');
                    
                    // Update local state
                    setTrainings(prev => prev.map(t => t.id === selectedTraining.id ? { ...t, contested: true, contestation_comment: contestComment } : t));
                    setContestModalOpen(false);
                  } catch (e: any) {
                    toast.error(e.response?.data?.error || 'Fehler beim Einreichen der Beanstandung.');
                  } finally {
                    setSubmittingContest(false);
                  }
                }}
                disabled={submittingContest || !contestComment.trim()}
              >
                {submittingContest ? 'Wird übermittelt...' : 'Beanstandung absenden'}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  const tasks = overview?.my_tasks || [];
  const sections = overview?.sections || [];
  const overdueTasks = tasks.filter(t => t.due_date && isPast(parseISO(t.due_date)));
  const totalActionItems = sections.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <LayoutList size={24} className="text-blue-600" />
            Mein Bereich
          </h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">
            Willkommen, {user?.name} · <span className="font-medium">{roleLabels[user?.role || 'viewer']}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {totalActionItems > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 text-sm font-semibold">
              <AlertTriangle size={14} />
              {totalActionItems} offene Punkte
            </div>
          )}
          {!overview?.passkey_count && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-sm border border-yellow-200 dark:border-yellow-800/50" title="Kein Passkey hinterlegt">
              <Fingerprint size={14} />
              Kein Passkey
            </div>
          )}
        </div>
      </div>

      {/* My Tasks */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <CheckSquare size={16} className="text-blue-600" />
            Meine Aufgaben
            {tasks.length > 0 && <span className="text-xs font-normal text-gray-400">({tasks.length} offen)</span>}
          </h2>
          <Link to="/tasks" className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
            Alle Aufgaben <ArrowRight size={14} />
          </Link>
        </div>

        {tasks.length === 0 ? (
          <Card className="p-8 text-center">
            <CheckCircle2 size={32} className="mx-auto text-green-400 mb-2" />
            <p className="text-gray-500 dark:text-slate-400 font-medium">Keine offenen Aufgaben</p>
            <p className="text-gray-400 dark:text-slate-600 text-sm mt-1">Super! Alles erledigt.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {overdueTasks.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 text-sm text-red-700 dark:text-red-300">
                <AlertTriangle size={14} className="shrink-0" />
                <span><strong>{overdueTasks.length} Aufgabe{overdueTasks.length > 1 ? 'n' : ''}</strong> überfällig</span>
              </div>
            )}
            {tasks.map(t => {
              const isOverdue = t.due_date && isPast(parseISO(t.due_date));
              const busy = taskLoading === t.id;
              return (
                <Card key={t.id} className="p-3 hover:shadow-sm transition-shadow">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => quickTaskStatus(t.id, 'done')}
                      disabled={busy}
                      title="Als erledigt markieren"
                      className="shrink-0 text-gray-300 hover:text-green-500 dark:hover:text-green-400 transition-colors disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Circle size={16} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium dark:text-slate-200 truncate">{t.title}</p>
                        {t.related_type === 'asset' && t.related_id && (
                          <Link to={`/assets/${t.related_id}`} className="text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors" title="Zum Asset springen">
                            <Link2 size={12} />
                          </Link>
                        )}
                      </div>
                      {t.due_date && (
                        <p className={`text-xs mt-0.5 ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-400 dark:text-slate-500'}`}>
                          {isOverdue ? '⚠ Überfällig · ' : ''}
                          Fällig {format(parseISO(t.due_date), 'd. MMM yyyy', { locale: de })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`text-xs font-semibold ${priorityColor[t.priority]}`}>
                        {t.priority === 'critical' ? 'Kritisch' : t.priority === 'high' ? 'Hoch' : t.priority === 'medium' ? 'Mittel' : 'Niedrig'}
                      </span>
                      {t.status === 'open' && (
                        <button
                          onClick={() => quickTaskStatus(t.id, 'in_progress')}
                          disabled={busy}
                          title="In Bearbeitung setzen"
                          className="ml-1 p-1 text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 rounded transition-colors disabled:opacity-40"
                        >
                          <PlayCircle size={15} />
                        </button>
                      )}
                      <button
                        onClick={() => quickTaskStatus(t.id, 'done')}
                        disabled={busy}
                        title="Erledigt"
                        className="p-1 text-gray-300 hover:text-green-500 dark:hover:text-green-400 rounded transition-colors disabled:opacity-40"
                      >
                        <Check size={15} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
            <Link to="/tasks" className="flex items-center justify-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline py-2">
              Alle Aufgaben verwalten <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </section>

      {/* Role-specific sections */}
      {sections.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert size={16} className="text-orange-500" />
            Handlungsbedarf
          </h2>
          {sections.map((section, i) => (
            <Card key={i} className="overflow-hidden">
              <div className="px-4 py-3 border-b dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{section.title}</h3>
                    <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                      {section.total}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{section.description}</p>
                </div>
                <Link
                  to={section.link}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  {section.actionLabel} <ChevronRight size={13} />
                </Link>
              </div>
              <div className="divide-y dark:divide-slate-800/60">
                {section.items.map(item => (
                  <Link
                    key={item.id}
                    to={item.link}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/40 transition-colors group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">{item.name}</p>
                      {item.sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5 truncate">{item.sub}</p>}
                    </div>
                    <ChevronRight size={14} className="text-gray-300 dark:text-slate-700 group-hover:text-blue-500 shrink-0 ml-2 transition-colors" />
                  </Link>
                ))}
                {section.total > section.items.length && (
                  <Link to={section.link} className="flex items-center justify-center gap-1 py-2 text-xs text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    +{section.total - section.items.length} weitere → Alle anzeigen
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </section>
      )}

      {sections.length === 0 && tasks.length === 0 && (
        <Card className="p-12 text-center">
          <CheckCircle2 size={48} className="mx-auto text-green-400 mb-4" />
          <h3 className="text-lg font-bold dark:text-white mb-2">Alles im grünen Bereich</h3>
          <p className="text-gray-500 dark:text-slate-400">Keine offenen Aufgaben oder Handlungsbedarfe für deine Rolle.</p>
        </Card>
      )}

      {/* Security hint if no MFA */}
      {!overview?.passkey_count && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/40">
          <Fingerprint size={18} className="text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">Kein Passkey hinterlegt</p>
            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-0.5">
              Erhöhe die Sicherheit deines Kontos mit einem Passkey. Klicke auf dein Profilbild und wähle „Passkey hinzufügen".
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
