import React, { useState, useEffect } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  Shield, LayoutDashboard, Server, ClipboardCheck, Bell,
  Users, LogOut, Menu, ChevronRight, CheckCircle,
  Upload, AlertTriangle, Building2, Sun, Moon, FileText, Network, Settings, ShieldAlert, ShieldCheck, AlertOctagon, BarChart3, BookOpen, CheckSquare, Fingerprint, Trash2, LayoutList, Radar, Copy, Check, KeyRound, Eye, EyeOff, Search, UserCheck, Scale,
  Zap, Bot, LifeBuoy, Target, Car
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../contexts/ModulesContext';
import type { ModuleKey } from '../contexts/ModulesContext';
import { useTheme } from '../contexts/ThemeContext';
import { useCommandPalette } from '../contexts/CommandPaletteContext';
import { useKeyShortcut } from '../hooks/useKeyShortcut';
import { NotificationBell } from './NotificationBell';
import { BottomNav } from './BottomNav';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { IsmsLogo } from './IsmsLogo';
import api from '../lib/api';
import { startRegistration } from '../lib/webauthn';

interface NavItem {
  path: string;
  icon: React.FC<any>;
  label: string;
  hint?: string;
  adminOnly?: boolean;
  roles?: string[];
  badge?: number;
  module?: ModuleKey;
}

const navGroups = [
  {
    label: 'Cockpit',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard', hint: 'Status auf einen Blick' },
      { path: '/my', icon: LayoutList, label: 'Mein Bereich', hint: 'Deine Aufgaben' },
      { path: '/report', icon: BarChart3, label: 'Reports', hint: 'Management Berichte' },
    ] as NavItem[],
  },
  {
    label: 'Governance',
    items: [
      { path: '/compliance', icon: CheckCircle, label: 'Compliance', hint: 'ISO 27001 · NIS-2 · DSGVO' },
      { path: '/controls', icon: ShieldCheck, label: 'Maßnahmen', hint: 'SoA & Kontrollen' },
      { path: '/policies', icon: FileText, label: 'Dokumente', hint: 'Richtlinien & Vorlagen' },
      { path: '/vvt', icon: BookOpen, label: 'Datenschutz', hint: 'VVT (Art. 30 DSGVO)', module: 'dsgvo' },
      { path: '/subject-requests', icon: UserCheck, label: 'Betroffenenrechte', hint: 'Anträge Art. 15–22 DSGVO', roles: ['admin', 'dpo', 'assessor'], module: 'dsgvo' },
      { path: '/legal-requirements', icon: Scale, label: 'Pflichten-Register', hint: 'Gesetzliche Anforderungen', roles: ['admin', 'assessor', 'dpo'] },
      { path: '/iso27001', icon: ShieldCheck, label: 'ISO 27001', hint: 'Annex A Controls & SoA', module: 'iso27001', roles: ['admin', 'assessor', 'it-staff'] },
      { path: '/bsi-grundschutz', icon: BookOpen, label: 'BSI Grundschutz', hint: 'IT-Grundschutz-Kompendium', module: 'bsi_grundschutz', roles: ['admin', 'assessor'] },
      { path: '/nis2', icon: AlertOctagon, label: 'NIS-2', hint: 'Art. 21 Sicherheitsmaßnahmen', module: 'nis2', roles: ['admin', 'assessor', 'dpo'] },
      { path: '/c5', icon: Shield, label: 'BSI C5:2026', hint: 'Cloud Controls Catalogue', module: 'c5', roles: ['admin', 'assessor', 'it-staff'] },
      { path: '/tisax', icon: Car, label: 'TISAX', hint: 'Automotive Security Assessment', module: 'tisax', roles: ['admin', 'assessor'] },
      { path: '/ai-act', icon: Bot, label: 'EU AI Act', hint: 'KI-Systemregister', module: 'ai_act', roles: ['admin', 'assessor', 'dpo'] },
    ] as NavItem[],
  },
  {
    label: 'Operations',
    items: [
      { path: '/assets', icon: Server, label: 'Assets', hint: 'Inventar & Klassifizierung' },
      { path: '/discovery', icon: Radar, label: 'Discovery', hint: 'Netzwerk & Agents', adminOnly: true, module: 'discovery' },
      { path: '/risks', icon: ShieldAlert, label: 'Risiken', hint: 'ISO 27005 Register' },
      { path: '/incidents', icon: AlertOctagon, label: 'Vorfälle', hint: 'Vorfallmanagement' },
      { path: '/tasks', icon: CheckSquare, label: 'Aufgaben', hint: 'Sicherheitsmaßnahmen' },
      { path: '/dora', icon: Zap, label: 'DORA', hint: 'IKT-Drittparteienregister', module: 'dora', roles: ['admin', 'assessor', 'it-staff'] },
      { path: '/pentests', icon: Target, label: 'Pentests', hint: 'Pentest-Tracking & Findings', module: 'pentest', roles: ['admin', 'assessor', 'it-staff'] },
    ] as NavItem[],
  },
  {
    label: 'Ressourcen',
    items: [
      { path: '/vendors', icon: Building2, label: 'Dienstleister', hint: 'Firmenverzeichnis' },
      { path: '/contacts', icon: Users, label: 'Ansprechpartner', hint: 'Kontakte bei Firmen' },
      { path: '/topology', icon: Network, label: 'Topologie', hint: 'Visualisierung' },
      { path: '/assessments', icon: ClipboardCheck, label: 'Assessments', hint: 'CIA-Bewertungen' },
      { path: '/reminders', icon: Bell, label: 'Reviews', hint: 'Fällige Prüfungen' },
      { path: '/bcm', icon: LifeBuoy, label: 'BCM', hint: 'Business Continuity Management', module: 'bcm', roles: ['admin', 'assessor'] },
    ] as NavItem[],
  },
  {
    label: 'System',
    items: [
      { path: '/import', icon: Upload, label: 'Import', hint: 'CSV Bulk-Upload', adminOnly: true },
      { path: '/admin', icon: Settings, label: 'Admin', hint: 'Einstellungen', adminOnly: true },
    ] as NavItem[],
  },
];

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const { isEnabled } = useModules();
  const { theme, toggleTheme } = useTheme();
  const { openPalette } = useCommandPalette();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.role === 'employee' && location.pathname !== '/my') {
      navigate('/my', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  useKeyShortcut('k', openPalette, { ctrl: true });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [version, setVersion] = useState('');
  // 2FA state
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ qr_data_url: string; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [totpLoading, setTotpLoading] = useState(false);
  // Passkeys state
  const [passkeys, setPasskeys] = useState<{ id: number; name: string; device_type: string; backed_up: boolean; created_at: string }[]>([]);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Password change state
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);
  // API token (for discovery agent) state
  interface ApiToken {
    id: number;
    name: string;
    token: string;
    expires_at: string | null;
    created_at: string;
  }
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState('');
  const [tokenMsg, setTokenMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [revealedTokens, setRevealedTokens] = useState<Record<number, boolean>>({});
  const [copiedTokens, setCopiedTokens] = useState<Record<number, boolean>>({});

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) return;
    setTokenLoading(true);
    setTokenMsg(null);
    try {
      const expiresAt = newTokenExpiry ? new Date(newTokenExpiry).toISOString() : null;
      const r = await api.post('/auth/tokens', { name: newTokenName, expires_at: expiresAt });
      setApiTokens(prev => [r.data, ...prev]);
      setNewTokenName('');
      setNewTokenExpiry('');
      setTokenMsg({ ok: true, text: 'API-Token erfolgreich generiert.' });
    } catch (err: any) {
      setTokenMsg({ ok: false, text: err.response?.data?.error || 'Fehler beim Generieren' });
    } finally {
      setTokenLoading(false);
    }
  };

  const handleDeleteToken = async (id: number) => {
    if (!confirm('Möchten Sie diesen API-Token wirklich löschen?')) return;
    try {
      await api.delete(`/auth/tokens/${id}`);
      setApiTokens(prev => prev.filter(t => t.id !== id));
      setTokenMsg({ ok: true, text: 'API-Token gelöscht.' });
    } catch (err: any) {
      setTokenMsg({ ok: false, text: err.response?.data?.error || 'Fehler beim Löschen' });
    }
  };

  const handleCopyToken = async (id: number, tokenStr: string) => {
    try {
      await navigator.clipboard.writeText(tokenStr);
      setCopiedTokens(prev => ({ ...prev, [id]: true }));
      setTimeout(() => setCopiedTokens(prev => ({ ...prev, [id]: false })), 2000);
    } catch { /* clipboard unavailable */ }
  };

  const toggleRevealToken = (id: number) => {
    setRevealedTokens(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Overdue badge: cheap dedicated endpoint, fetched once on mount and refreshed
  // every 5 min — NOT on every navigation (which re-ran the full dashboard
  // aggregation on each page change and hammered the rate limit).
  useEffect(() => {
    const loadBadge = () =>
      api.get('/dashboard/badge').then(r => setOverdueCount(r.data.overdueReminders)).catch(() => {});
    loadBadge();
    const timer = setInterval(loadBadge, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api.get('/version').then(r => setVersion(r.data.version)).catch(() => {});
  }, []);

  const openProfile = () => {
    api.get('/auth/me').then(r => setTotpEnabled(r.data.totp_enabled || false)).catch(() => {});
    api.get('/auth/passkey').then(r => setPasskeys(r.data)).catch(() => {});
    api.get('/auth/tokens').then(r => setApiTokens(r.data)).catch(() => {});
    setProfileModalOpen(true);
    setTotpSetup(null); setTotpCode(''); setTotpMsg(null);
    setPasskeyMsg(null);
    setPwCurrent(''); setPwNew(''); setPwMsg(null);
    setTokenMsg(null);
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setPasskeySupported).catch(() => {});
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true); setPwMsg(null);
    try {
      await api.post('/auth/change-password', { current_password: pwCurrent, new_password: pwNew });
      setPwMsg({ ok: true, text: 'Passwort erfolgreich geändert.' });
      setPwCurrent(''); setPwNew('');
    } catch (e: any) {
      setPwMsg({ ok: false, text: e.response?.data?.error || 'Fehler beim Ändern des Passworts' });
    } finally { setPwLoading(false); }
  };

  const startTotpSetup = async () => {
    setTotpLoading(true); setTotpMsg(null);
    try {
      const r = await api.get('/auth/2fa/setup');
      setTotpSetup(r.data);
    } catch (e: any) { setTotpMsg({ ok: false, text: e.response?.data?.error || 'Fehler' }); }
    finally { setTotpLoading(false); }
  };

  const verifyTotp = async () => {
    setTotpLoading(true); setTotpMsg(null);
    try {
      await api.post('/auth/2fa/verify', { token: totpCode, secret: totpSetup?.secret });
      setTotpEnabled(true); setTotpSetup(null); setTotpCode('');
      setTotpMsg({ ok: true, text: '2FA erfolgreich aktiviert.' });
    } catch (e: any) { setTotpMsg({ ok: false, text: e.response?.data?.error || 'Ungültiger Code' }); }
    finally { setTotpLoading(false); }
  };

  const disableTotp = async () => {
    const code = prompt('Bitte gib deinen aktuellen TOTP-Code zur Bestätigung ein:');
    if (!code) return;
    try {
      await api.post('/auth/2fa/disable', { token: code });
      setTotpEnabled(false);
      setTotpMsg({ ok: true, text: '2FA wurde deaktiviert.' });
    } catch (e: any) { setTotpMsg({ ok: false, text: e.response?.data?.error || 'Fehler' }); }
  };

  const registerPasskey = async () => {
    setPasskeyLoading(true); setPasskeyMsg(null);
    try {
      const name = prompt('Name für diesen Passkey (z.B. "MacBook", "iPhone"):');
      if (name === null) { setPasskeyLoading(false); return; }
      const optionsRes = await api.get('/auth/passkey/register-options');
      const regResult = await startRegistration(optionsRes.data);
      await api.post('/auth/passkey/register-verify', { ...regResult, name: name || 'Passkey' });
      const updated = await api.get('/auth/passkey');
      setPasskeys(updated.data);
      setPasskeyMsg({ ok: true, text: 'Passkey erfolgreich registriert.' });
    } catch (e: any) {
      if (!e.message?.includes('abgebrochen')) {
        setPasskeyMsg({ ok: false, text: e.response?.data?.error || e.message || 'Registrierung fehlgeschlagen' });
      }
    } finally { setPasskeyLoading(false); }
  };

  const deletePasskey = async (id: number) => {
    if (!confirm('Passkey wirklich löschen?')) return;
    try {
      await api.delete(`/auth/passkey/${id}`);
      setPasskeys(pks => pks.filter(p => p.id !== id));
      setPasskeyMsg({ ok: true, text: 'Passkey entfernt.' });
    } catch (e: any) { setPasskeyMsg({ ok: false, text: e.response?.data?.error || 'Fehler' }); }
  };

  const roleLabels: Record<string, string> = { 
    admin: 'System-Administrator',
    assessor: 'Auditor & Bewerter',
    'it-staff': 'IT-Mitarbeiter',
    dpo: 'Datenschutzbeauftragter',
    owner: 'Asset Verantwortlicher',
    viewer: 'Gast (Leserechte)',
    management: 'Management',
    employee: 'Mitarbeiter'
  };

  const isActive = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 transition-colors duration-200">
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-64 bg-slate-900 dark:bg-black text-white flex flex-col transform transition-transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Logo & Theme Toggle */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-3">
            <IsmsLogo size={36} className="rounded-xl shrink-0" />
            <div>
              <p className="font-bold text-sm leading-none">OpenISMS</p>
              <p className="text-xs text-slate-400 mt-0.5">Security Management</p>
            </div>
          </div>
          <button onClick={toggleTheme} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors" title={theme === 'light' ? 'Dunkelmodus aktivieren' : 'Hellmodus aktivieren'}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-2 custom-scrollbar">
          {navGroups.map(group => {
            const visibleItems = group.items.filter(i => {
              if (user?.role === 'employee') {
                return i.path === '/my';
              }
              if (i.adminOnly && user?.role !== 'admin') return false;
              if (i.roles && !i.roles.includes(user?.role || '')) return false;
              if (i.module && !isEnabled(i.module)) return false;
              return true;
            });
            if (!visibleItems.length) return null;
            return (
              <div key={group.label}>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-600 uppercase tracking-widest px-2 mb-1">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map(item => {
                    const active = isActive(item.path);
                    const showBadge = item.path === '/reminders' && overdueCount > 0;
                    const label = (item.path === '/my' && user?.role === 'employee') ? 'Meine Schulungen' : item.label;
                    const IconComponent = (item.path === '/my' && user?.role === 'employee') ? BookOpen : item.icon;
                    return (
                      <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)}
                        title={item.hint}
                        className={`flex items-center gap-2.5 px-3 py-1 rounded-lg text-sm transition-all ${
                          active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                        }`}>
                        <IconComponent size={15} className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="block truncate leading-tight font-medium">{label}</span>
                        </div>
                        {showBadge && (
                          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center shrink-0">
                            {overdueCount}
                          </span>
                        )}
                        {active && !showBadge && <ChevronRight size={12} className="shrink-0 opacity-70" />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-700/60 p-4">
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded-xl animate-pulse">
              <AlertTriangle size={13} className="text-red-400 shrink-0" />
              <p className="text-[10px] font-bold text-red-300 uppercase tracking-tight">{overdueCount} überfällige Reviews</p>
            </div>
          )}
          
          <button 
            onClick={openProfile}
            className="w-full group mb-2 p-2 rounded-xl hover:bg-white/5 transition-all text-left border border-transparent hover:border-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                {user?.avatar_url
                  ? <img src={user.avatar_url} alt={user.name} className="w-10 h-10 rounded-xl object-cover shadow-lg group-hover:scale-105 transition-transform" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.removeAttribute('style'); }} />
                  : null}
                <div className={`w-10 h-10 rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform ${user?.avatar_url ? 'hidden' : ''}`}>
                  {user?.name?.charAt(0).toUpperCase()}
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 border-2 border-slate-900 dark:border-black rounded-full shadow-xs" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-none truncate group-hover:text-blue-400 transition-colors">{user?.name}</p>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">{user?.role}</p>
              </div>
            </div>
          </button>

          <button onClick={logout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all uppercase tracking-widest border border-transparent hover:border-red-500/20">
            <LogOut size={14} />Abmelden
          </button>
          {version && <p className="text-center text-[10px] text-slate-600 dark:text-slate-700 mt-2 font-mono">OpenISMS v{version} · © 2026 Maximilian Herz</p>}
        </div>
      </aside>

      <Modal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} title="Benutzerprofil" size="xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-2 max-h-[75vh] overflow-y-auto pr-2">
          {/* Linke Spalte: Profil-Infos & Sicherheit (7 von 12 Spalten) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="flex items-center gap-5 p-5 bg-gray-50 dark:bg-slate-800/40 rounded-2xl border dark:border-slate-800">
              {user?.avatar_url
                ? <img src={user.avatar_url} alt={user.name} className="w-16 h-16 rounded-2xl object-cover shadow-xl" />
                : <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-2xl font-bold text-white shadow-xl shadow-blue-500/20">{user?.name?.charAt(0).toUpperCase()}</div>
              }
              <div>
                <h3 className="text-xl font-bold dark:text-white">{user?.name}</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400">{user?.email}</p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase tracking-wider">
                  <Shield size={10} />
                  {roleLabels[user?.role || 'viewer']}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border dark:border-slate-800 bg-white dark:bg-slate-900/50">
                <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Abteilung</p>
                <p className="text-sm font-medium dark:text-slate-200">{user?.department || 'Keine Abteilung angegeben'}</p>
              </div>
              <div className="p-4 rounded-xl border dark:border-slate-800 bg-white dark:bg-slate-900/50">
                <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">Login-Methode</p>
                <p className="text-sm font-medium dark:text-slate-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                  {user?.email.includes('.local') || user?.id.toString().startsWith('local-') || !user?.email.includes('@') ? 'Lokaler Benutzer' : 'Single Sign-On (OIDC)'}
                </p>
              </div>
            </div>

            {/* Password Change for Local Users */}
            {(user?.email.includes('.local') || !user?.email.includes('@')) && (
              <div className="pt-5 border-t dark:border-slate-800 space-y-3">
                <p className="text-sm font-semibold dark:text-slate-200">Passwort ändern</p>
                <form onSubmit={handlePasswordChange} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input 
                      type="password" 
                      placeholder="Aktuelles Passwort" 
                      value={pwCurrent} 
                      onChange={e => setPwCurrent(e.target.value)}
                      required
                    />
                    <Input 
                      type="password" 
                      placeholder="Neues Passwort" 
                      value={pwNew} 
                      onChange={e => setPwNew(e.target.value)}
                      required
                    />
                  </div>
                  {pwMsg && (
                    <div className={`text-xs px-3 py-2 rounded-lg ${pwMsg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                      {pwMsg.text}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" size="sm" disabled={pwLoading || !pwCurrent || !pwNew}>
                      {pwLoading ? 'Wird geändert...' : 'Passwort aktualisieren'}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* 2FA / TOTP Section */}
            <div className="pt-5 border-t dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold dark:text-slate-200">Zwei-Faktor-Authentifizierung</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">TOTP via Authenticator-App (Google Authenticator, Authy, etc.)</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${totpEnabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                  {totpEnabled ? 'Aktiv' : 'Inaktiv'}
                </span>
              </div>

              {totpMsg && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${totpMsg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                  {totpMsg.text}
                </div>
              )}

              {!totpEnabled && !totpSetup && (
                <Button size="sm" variant="secondary" onClick={startTotpSetup} disabled={totpLoading}>
                  {totpLoading ? 'Lade…' : '2FA aktivieren'}
                </Button>
              )}

              {totpSetup && (
                <div className="space-y-3 p-4 rounded-xl border dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40">
                  <p className="text-xs text-gray-600 dark:text-slate-400">Scanne den QR-Code mit deiner Authenticator-App, dann gib den 6-stelligen Code zur Bestätigung ein:</p>
                  <div className="flex justify-center">
                    <img src={totpSetup.qr_data_url} alt="TOTP QR Code" className="w-40 h-40 rounded-lg border dark:border-slate-700" />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      className="flex-1 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white font-mono tracking-widest"
                    />
                    <Button size="sm" onClick={verifyTotp} disabled={totpLoading || totpCode.length !== 6}>
                      {totpLoading ? '…' : 'Bestätigen'}
                    </Button>
                  </div>
                </div>
              )}

              {totpEnabled && (
                <button onClick={disableTotp} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                  2FA deaktivieren
                </button>
              )}
            </div>

            {/* Passkeys Section */}
            <div className="pt-5 border-t dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold dark:text-slate-200 flex items-center gap-2"><Fingerprint size={14} className="text-green-500" />Passkeys</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">Passwortlose Anmeldung per Biometrie oder PIN</p>
                </div>
                {passkeySupported && (
                  <Button size="sm" variant="secondary" onClick={registerPasskey} disabled={passkeyLoading}>
                    {passkeyLoading ? '…' : 'Passkey hinzufügen'}
                  </Button>
                )}
              </div>
              {!passkeySupported && <p className="text-xs text-gray-400 dark:text-slate-500">Dein Browser/Gerät unterstützt keine Passkeys.</p>}
              {passkeyMsg && (
                <div className={`text-xs px-3 py-2 rounded-lg ${passkeyMsg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                  {passkeyMsg.text}
                </div>
              )}
              {passkeys.length > 0 && (
                <div className="space-y-2">
                  {passkeys.map(pk => (
                    <div key={pk.id} className="flex items-center justify-between p-2.5 rounded-xl border dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40">
                      <div className="flex items-center gap-2.5">
                        <Fingerprint size={16} className="text-green-500 shrink-0" />
                        <div>
                          <p className="text-sm font-medium dark:text-slate-200">{pk.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-slate-500">
                            {pk.device_type === 'singleDevice' ? 'Gerätgebunden' : 'Synchronisiert'}{pk.backed_up ? ' · Cloud-Backup' : ''}
                            {' · '}Registriert {new Date(pk.created_at).toLocaleDateString('de')}
                          </p>
                        </div>
                      </div>
                      <button onClick={() => deletePasskey(pk.id)} className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Rechte Spalte: API-Token & Integrationen (5 von 12 Spalten) */}
          <div className="lg:col-span-5 space-y-6 border-t lg:border-t-0 lg:border-l lg:pl-8 dark:border-slate-800 border-gray-100 flex flex-col justify-between">
            <div className="space-y-4 flex-1">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-blue-500" />
                <p className="text-sm font-semibold dark:text-slate-200">API-Token (Discovery-Agent & MCP)</p>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 leading-relaxed">
                Verwalten Sie dedizierte API-Token für den Discovery-Agenten sowie den MCP-Server. Diese Token können im Discovery-Skript anstelle von <code className="font-mono text-blue-500">DEIN-JWT-TOKEN</code> oder in der MCP-Client-Konfiguration als Authorization-Header verwendet werden.
              </p>

              {/* List of tokens */}
              <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                {apiTokens.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-slate-400 italic">Keine API-Token vorhanden.</p>
                ) : (
                  apiTokens.map(token => {
                    const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                    return (
                      <div key={token.id} className="p-3 rounded-xl border dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold dark:text-slate-200 truncate">{token.name}</p>
                            <p className="text-[10px] text-gray-400 dark:text-slate-500">
                              Erstellt: {new Date(token.created_at).toLocaleDateString('de')}
                              {token.expires_at ? (
                                <span className={isExpired ? ' text-red-500 ml-1.5' : ' ml-1.5'}>
                                  · Gültig bis: {new Date(token.expires_at).toLocaleDateString('de')} {isExpired && '(Abgelaufen)'}
                                </span>
                              ) : (
                                <span className="ml-1.5">· Unbegrenzt gültig</span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteToken(token.id)}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded flex-shrink-0"
                            title="Löschen"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-slate-950 border dark:border-slate-850 font-mono text-[10px] break-all text-gray-600 dark:text-slate-300 select-all">
                            {revealedTokens[token.id] ? token.token : '••••••••••••••••••••••••••••••••••••••••'}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRevealToken(token.id)}
                            className="p-1.5 rounded border dark:border-slate-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                            title={revealedTokens[token.id] ? 'Verbergen' : 'Anzeigen'}
                          >
                            {revealedTokens[token.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyToken(token.id, token.token)}
                            className="p-1.5 rounded border dark:border-slate-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                            title="Kopieren"
                          >
                            {copiedTokens[token.id] ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Token messages */}
              {tokenMsg && (
                <div className={`p-2.5 rounded-lg text-xs font-medium ${tokenMsg.ok ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'}`}>
                  {tokenMsg.text}
                </div>
              )}

              {/* Create form */}
              <form onSubmit={handleGenerateToken} className="space-y-2 pt-2 border-t dark:border-slate-800/60">
                <p className="text-xs font-semibold dark:text-slate-300">Neuen Token erstellen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    type="text"
                    placeholder="Token-Name (z.B. AD-Server-Sweep)"
                    value={newTokenName}
                    onChange={e => setNewTokenName(e.target.value)}
                    required
                  />
                  <Input
                    type="date"
                    placeholder="Gültig bis (optional)"
                    value={newTokenExpiry}
                    onChange={e => setNewTokenExpiry(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    title="Gültigkeitsdatum (leer lassen für unbegrenzt)"
                  />
                </div>
                <Button type="submit" disabled={tokenLoading} className="w-full justify-center text-xs py-1.5">
                  {tokenLoading ? 'Generiere...' : 'Token generieren'}
                </Button>
              </form>
            </div>

            <div className="pt-6 border-t dark:border-slate-800 flex justify-end">
              <Button variant="secondary" onClick={() => setProfileModalOpen(false)}>Schließen</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"><Menu size={20} /></button>
          <IsmsLogo size={24} className="rounded-md lg:hidden" />
          <span className="lg:hidden font-semibold text-sm dark:text-white">OpenISMS</span>
          <button
            onClick={openPalette}
            className="hidden sm:flex items-center gap-2 text-sm text-gray-400 dark:text-slate-500 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 hover:text-gray-600 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600 transition-all bg-gray-50 dark:bg-slate-800/50"
          >
            <Search size={14} />
            <span className="text-xs">Suche…</span>
            <kbd className="font-mono text-[10px] px-1 py-0.5 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded ml-1">⌘K</kbd>
          </button>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 pb-20 md:pb-6 custom-scrollbar"><Outlet /></main>
      </div>
      <BottomNav />
    </div>
  );
};
