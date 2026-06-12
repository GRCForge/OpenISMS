import React, { useState, useEffect, useRef } from 'react';
import { Bell, AlertTriangle, Clock, ShieldAlert, X, Trash2, ChevronRight, AtSign, BellOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { format } from 'date-fns';
import { usePushNotifications } from '../hooks/usePushNotifications';

interface Notification {
  id?: number;
  type: 'overdue' | 'upcoming' | 'never_assessed' | 'mention';
  asset_id?: number;
  asset_name?: string;
  due_date?: string | null;
  title: string;
  content?: string;
  link?: string;
  actor?: { name: string };
  created_at?: string;
}

export const NotificationBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ overdue: Notification[], upcoming: Notification[], neverAssessed: Notification[], mentions: Notification[], total: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const push = usePushNotifications();

  const load = () => api.get('/notifications').then(r => setData(r.data)).catch(() => {});

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const dismiss = async (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.patch(`/reminders/${id}/dismiss`);
      load();
    } catch {
      // Dismiss failed silently — notification stays visible
    }
  };

  const markRead = async (id: number) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      load();
    } catch {
      // Mark-read failed silently — badge remains
    }
  };

  if (!data) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button onClick={() => setOpen(!open)} className="relative p-2 text-slate-400 hover:text-white transition-colors">
        <Bell size={20} />
        {data.total > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500 text-[10px] font-bold text-white items-center justify-center">
              {data.total}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-800/50">
            <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              Benachrichtigungen
              {data.total > 0 && <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] px-1.5 py-0.5 rounded-full">{data.total}</span>}
            </h3>
            <div className="flex items-center gap-2">
              {push.supported && push.permission !== 'denied' && (
                <button
                  onClick={() => push.subscribed ? push.unsubscribe() : push.requestPermission()}
                  disabled={push.loading}
                  title={push.subscribed ? 'Browser-Push deaktivieren' : 'Browser-Push aktivieren'}
                  className={`p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1 ${push.subscribed ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50' : 'text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                >
                  {push.subscribed ? <Bell size={13} /> : <BellOff size={13} />}
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"><X size={16} /></button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
            {data.total === 0 ? (
              <div className="p-10 text-center text-gray-400 dark:text-slate-600">
                <CheckCircle className="mx-auto mb-3 opacity-20" size={40} />
                <p className="text-sm italic">Alles erledigt! Keine offenen Aufgaben.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {/* Mentions (Priority) */}
                {data.mentions.map(n => (
                   <Link key={`m-${n.id}`} to={n.link || '#'} onClick={() => { if(n.id) markRead(n.id); setOpen(false); }} className="flex items-start gap-3 p-4 bg-blue-50/30 dark:bg-blue-900/10 hover:bg-blue-100/30 transition-colors">
                      <div className="mt-1 p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-lg shrink-0"><AtSign size={14} /></div>
                      <div className="flex-1 min-w-0">
                         <div className="flex justify-between items-start">
                            <p className="text-sm font-bold text-gray-900 dark:text-white">{n.title}</p>
                            <span className="text-[10px] text-gray-400">{n.created_at ? format(new Date(n.created_at), 'HH:mm') : ''}</span>
                         </div>
                         <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5 line-clamp-2">{n.content}</p>
                      </div>
                   </Link>
                ))}

                {/* Overdue */}
                {data.overdue.map(n => (
                  <Link key={`ov-${n.asset_id}-${n.id}`} to={`/assets/${n.asset_id}`} onClick={() => setOpen(false)} className="group flex items-start gap-3 p-4 hover:bg-red-50/30 dark:hover:bg-red-900/5 transition-colors">
                    <div className="mt-1 p-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-lg shrink-0"><AlertTriangle size={14} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{n.asset_name}</p>
                        {n.id && (
                          <button onClick={(e) => dismiss(e, n.id!)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-400 hover:text-red-500 transition-all">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-red-600 dark:text-red-400 font-medium">Review überfällig seit {n.due_date ? format(new Date(n.due_date), 'dd.MM.yyyy') : '?'}</p>
                    </div>
                  </Link>
                ))}

                {/* Upcoming */}
                {data.upcoming.map(n => (
                  <Link key={`up-${n.asset_id}-${n.id}`} to={`/assets/${n.asset_id}`} onClick={() => setOpen(false)} className="group flex items-start gap-3 p-4 hover:bg-blue-50/30 dark:hover:bg-blue-900/5 transition-colors">
                    <div className="mt-1 p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-lg shrink-0"><Clock size={14} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{n.asset_name}</p>
                        {n.id && (
                          <button onClick={(e) => dismiss(e, n.id!)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded text-gray-400 hover:text-red-500 transition-all">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-slate-400">Nächstes Review: {n.due_date ? format(new Date(n.due_date), 'dd.MM.yyyy') : '?'}</p>
                    </div>
                  </Link>
                ))}

                {/* Never Assessed */}
                {data.neverAssessed.map(n => (
                  <Link key={`na-${n.asset_id}`} to={`/assets/${n.asset_id}`} onClick={() => setOpen(false)} className="flex items-start gap-3 p-4 hover:bg-amber-50/30 dark:hover:bg-amber-900/5 transition-colors">
                    <div className="mt-1 p-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-lg shrink-0"><ShieldAlert size={14} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{n.asset_name}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 italic">Noch nie bewertet</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {data.total > 0 && (
            <Link to="/tasks" onClick={() => setOpen(false)} className="block py-3 text-center text-xs font-bold text-blue-600 dark:text-blue-400 bg-gray-50/50 dark:bg-slate-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 border-t dark:border-slate-800 transition-colors">
              Alle Aufgaben anzeigen <ChevronRight size={10} className="inline ml-1" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
};

const CheckCircle: React.FC<any> = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-circle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
);
