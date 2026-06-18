import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  Shield, LayoutDashboard, Server, ClipboardCheck, Bell,
  Users, LogOut, Menu, ChevronRight, CheckCircle,
  Upload, AlertTriangle, Building2, Sun, Moon, FileText, Network, Settings, ShieldAlert, ShieldCheck, AlertOctagon, BarChart3, BookOpen, CheckSquare, Fingerprint, Trash2, LayoutList, Radar, Copy, Check, KeyRound, Eye, EyeOff, Search, UserCheck, Scale,
  Zap, Bot, LifeBuoy, Target, Car
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../contexts/ModulesContext';
import type { ModuleKey } from '../contexts/ModulesContext';
import { useTheme } from '../contexts/ThemeContext';
import { useCommandPalette } from '../contexts/CommandPaletteContext';
import { useKeyShortcut } from '../hooks/useKeyShortcut';
import { NotificationBell } from './NotificationBell';
import { BottomNav } from './BottomNav';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { IsmsLogo } from './IsmsLogo';
import api from '../lib/api';
import { startRegistration } from '../lib/webauthn';

interface NavItem {
  path: string;
  icon: React.FC<any>;
  labelKey: string;
  adminOnly?: boolean;
  roles?: string[];
  badge?: number;
  module?: ModuleKey;
}

interface NavGroup {
  groupKey: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: 'cockpit',
    items: [
      { path: '/',       icon: LayoutDashboard, labelKey: 'dashboard' },
      { path: '/my',     icon: LayoutList,      labelKey: 'my' },
      { path: '/report', icon: BarChart3,        labelKey: 'report' },
    ],
  },
  {
    groupKey: 'governance',
    items: [
      { path: '/compliance',         icon: CheckCircle,  labelKey: 'compliance' },
      { path: '/controls',           icon: ShieldCheck,  labelKey: 'controls' },
      { path: '/policies',           icon: FileText,     labelKey: 'policies' },
      { path: '/vvt',                icon: BookOpen,     labelKey: 'vvt',               module: 'dsgvo' },
      { path: '/subject-requests',   icon: UserCheck,    labelKey: 'subjectRequests',   roles: ['admin', 'dpo', 'assessor'], module: 'dsgvo' },
      { path: '/legal-requirements', icon: Scale,        labelKey: 'legalRequirements', roles: ['admin', 'assessor', 'dpo'] },
      { path: '/iso27001',           icon: ShieldCheck,  labelKey: 'iso27001',          module: 'iso27001', roles: ['admin', 'assessor', 'it-staff'] },
      { path: '/bsi-grundschutz',    icon: BookOpen,     labelKey: 'bsiGrundschutz',    module: 'bsi_grundschutz', roles: ['admin', 'assessor'] },
      { path: '/nis2',               icon: AlertOctagon, labelKey: 'nis2',              module: 'nis2', roles: ['admin', 'assessor', 'dpo'] },
      { path: '/c5',                 icon: Shield,       labelKey: 'c5',                module: 'c5', roles: ['admin', 'assessor', 'it-staff'] },
      { path: '/tisax',              icon: Car,          labelKey: 'tisax',             module: 'tisax', roles: ['admin', 'assessor'] },
      { path: '/ai-act',             icon: Bot,          labelKey: 'aiAct',             module: 'ai_act', roles: ['admin', 'assessor', 'dpo'] },
    ],
  },
  {
    groupKey: 'operations',
    items: [
      { path: '/assets',    icon: Server,       labelKey: 'assets' },
      { path: '/discovery', icon: Radar,        labelKey: 'discovery',  adminOnly: true, module: 'discovery' },
      { path: '/risks',     icon: ShieldAlert,  labelKey: 'risks' },
      { path: '/incidents', icon: AlertOctagon, labelKey: 'incidents' },
      { path: '/tasks',     icon: CheckSquare,  labelKey: 'tasks' },
      { path: '/dora',      icon: Zap,          labelKey: 'dora',       module: 'dora', roles: ['admin', 'assessor', 'it-staff'] },
      { path: '/pentests',  icon: Target,       labelKey: 'pentests',   module: 'pentest', roles: ['admin', 'assessor', 'it-staff'] },
    ],
  },
  {
    groupKey: 'resources',
    items: [
      { path: '/vendors',     icon: Building2,      labelKey: 'vendors' },
      { path: '/contacts',    icon: Users,          labelKey: 'contacts' },
      { path: '/topology',    icon: Network,        labelKey: 'topology' },
      { path: '/assessments', icon: ClipboardCheck, labelKey: 'assessments' },
      { path: '/reminders',   icon: Bell,           labelKey: 'reminders' },
      { path: '/bcm',         icon: LifeBuoy,       labelKey: 'bcm',  module: 'bcm', roles: ['admin', 'assessor'] },
    ],
  },
  {
    groupKey: 'system',
    items: [
      { path: '/import', icon: Upload,   labelKey: 'import', adminOnly: true },
      { path: '/admin',  icon: Settings, labelKey: 'admin',  adminOnly: true },
    ],
  },
];

export const Layout: React.FC = () => {
  const { user, logout } = useAuth();
  const { isEnabled } = useModules();
  const { theme, toggleTheme } = useTheme();
  const { openPalette } = useCommandPalette();
  const { t } = useTranslation(['nav', 'profile', 'common']);
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
      setTokenMsg({ ok: true, text: t('profile:apiTokens.generated') });
    } catch (err: any) {
      setTokenMsg({ ok: false, text: err.response?.data?.error || t('common:status.error') });
    } finally {
      setTokenLoading(false);
    }
  };

  const handleDeleteToken = async (id: number) => {
    if (!confirm(t('profile:apiTokens.confirmDelete'))) return;
    try {
      await api.delete(`/auth/tokens/${id}`);
      setApiTokens(prev => prev.filter(t => t.id !== id));
      setTokenMsg({ ok: true, text: t('profile:apiTokens.deleted') });
    } catch (err: any) {
      setTokenMsg({ ok: false, text: err.response?.data?.error || t('common:status.error') });
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

  // Profile data (2FA state, passkeys, API tokens) is fetched only the first
  // time the modal opens. All in-modal actions update this state locally
  // (enable/disable 2FA, register/delete passkey, create/delete token), so
  // reopening the modal doesn't need to refetch all three endpoints each time.
  const profileLoaded = useRef(false);
  const openProfile = () => {
    if (!profileLoaded.current) {
      profileLoaded.current = true;
      api.get('/auth/me').then(r => setTotpEnabled(r.data.totp_enabled || false)).catch(() => { profileLoaded.current = false; });
      api.get('/auth/passkey').then(r => setPasskeys(r.data)).catch(() => {});
      api.get('/auth/tokens').then(r => setApiTokens(r.data)).catch(() => {});
    }
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
      setPwMsg({ ok: true, text: t('profile:password.success') });
      setPwCurrent(''); setPwNew('');
    } catch (e: any) {
      setPwMsg({ ok: false, text: e.response?.data?.error || t('profile:password.error') });
    } finally { setPwLoading(false); }
  };

  const startTotpSetup = async () => {
    setTotpLoading(true); setTotpMsg(null);
    try {
      const r = await api.get('/auth/2fa/setup');
      setTotpSetup(r.data);
    } catch (e: any) { setTotpMsg({ ok: false, text: e.response?.data?.error || t('common:status.error') }); }
    finally { setTotpLoading(false); }
  };

  const verifyTotp = async () => {
    setTotpLoading(true); setTotpMsg(null);
    try {
      await api.post('/auth/2fa/verify', { token: totpCode, secret: totpSetup?.secret });
      setTotpEnabled(true); setTotpSetup(null); setTotpCode('');
      setTotpMsg({ ok: true, text: t('profile:totp.enabled') });
    } catch (e: any) { setTotpMsg({ ok: false, text: e.response?.data?.error || t('profile:totp.invalidCode') }); }
    finally { setTotpLoading(false); }
  };

  const disableTotp = async () => {
    const code = prompt(t('profile:totp.disablePrompt'));
    if (!code) return;
    try {
      await api.post('/auth/2fa/disable', { token: code });
      setTotpEnabled(false);
      setTotpMsg({ ok: true, text: t('profile:totp.disabled') });
    } catch (e: any) { setTotpMsg({ ok: false, text: e.response?.data?.error || t('common:status.error') }); }
  };

  const registerPasskey = async () => {
    setPasskeyLoading(true); setPasskeyMsg(null);
    try {
      const name = prompt(t('profile:passkeys.namePrompt'));
      if (name === null) { setPasskeyLoading(false); return; }
      const optionsRes = await api.get('/auth/passkey/register-options');
      const regResult = await startRegistration(optionsRes.data);
      await api.post('/auth/passkey/register-verify', { ...regResult, name: name || 'Passkey' });
      const updated = await api.get('/auth/passkey');
      setPasskeys(updated.data);
      setPasskeyMsg({ ok: true, text: t('profile:passkeys.success') });
    } catch (e: any) {
      if (!e.message?.includes('abgebrochen')) {
        setPasskeyMsg({ ok: false, text: e.response?.data?.error || e.message || t('profile:passkeys.failed') });
      }
    } finally { setPasskeyLoading(false); }
  };

  const deletePasskey = async (id: number) => {
    if (!confirm(t('profile:passkeys.confirmDelete'))) return;
    try {
      await api.delete(`/auth/passkey/${id}`);
      setPasskeys(pks => pks.filter(p => p.id !== id));
      setPasskeyMsg({ ok: true, text: t('profile:passkeys.removed') });
    } catch (e: any) { setPasskeyMsg({ ok: false, text: e.response?.data?.error || t('common:status.error') }); }
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
          <button onClick={toggleTheme} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors" title={t(`nav:theme.${theme === 'light' ? 'dark' : 'light'}`)}>
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-2 custom-scrollbar">
          {NAV_GROUPS.map(group => {
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
              <div key={group.groupKey}>
                <p className="text-[10px] font-bold text-slate-500 dark:text-slate-600 uppercase tracking-widest px-2 mb-1">
                  {t(`nav:groups.${group.groupKey}`)}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map(item => {
                    const active = isActive(item.path);
                    const showBadge = item.path === '/reminders' && overdueCount > 0;
                    const isEmployee = item.path === '/my' && user?.role === 'employee';
                    const lk = isEmployee ? 'myEmployee' : item.labelKey;
                    const label = t(`nav:items.${lk}.label`);
                    const hint = t(`nav:items.${lk}.hint`);
                    const IconComponent = isEmployee ? BookOpen : item.icon;
                    return (
                      <Link key={item.path} to={item.path} onClick={() => setSidebarOpen(false)}
                        title={hint}
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
              <p className="text-[10px] font-bold text-red-300 uppercase tracking-tight">
                {t('nav:overdueReviews', { count: overdueCount })}
              </p>
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
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-1">
                  {t(`common:roles.${user?.role ?? 'viewer'}`)}
                </p>
              </div>
            </div>
          </button>

          <div className="flex items-center gap-2">
            <button onClick={logout}
              className="flex items-center gap-3 flex-1 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all uppercase tracking-widest border border-transparent hover:border-red-500/20">
              <LogOut size={14} />{t('common:actions.logout')}
            </button>
            <LanguageSwitcher />
          </div>
          {version && <p className="text-center text-[10px] text-slate-600 dark:text-slate-700 mt-2 font-mono">OpenISMS v{version} · © 2026 Maximilian Herz</p>}
        </div>
      </aside>

      <Modal open={profileModalOpen} onClose={() => setProfileModalOpen(false)} title={t('profile:title')} size="xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-2 max-h-[75vh] overflow-y-auto pr-2">
          {/* Left column: profile info & security (7 of 12 cols) */}
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
                  {t(`common:roles.${user?.role ?? 'viewer'}`)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border dark:border-slate-800 bg-white dark:bg-slate-900/50">
                <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">{t('profile:department')}</p>
                <p className="text-sm font-medium dark:text-slate-200">{user?.department || t('profile:noDepartment')}</p>
              </div>
              <div className="p-4 rounded-xl border dark:border-slate-800 bg-white dark:bg-slate-900/50">
                <p className="text-[10px] font-bold uppercase text-gray-400 mb-1">{t('profile:loginMethod')}</p>
                <p className="text-sm font-medium dark:text-slate-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                  {user?.email.includes('.local') || user?.id.toString().startsWith('local-') || !user?.email.includes('@')
                    ? t('profile:localUser')
                    : t('profile:sso')}
                </p>
              </div>
            </div>

            {/* Password Change for Local Users */}
            {(user?.email.includes('.local') || !user?.email.includes('@')) && (
              <div className="pt-5 border-t dark:border-slate-800 space-y-3">
                <p className="text-sm font-semibold dark:text-slate-200">{t('profile:password.title')}</p>
                <form onSubmit={handlePasswordChange} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input
                      type="password"
                      placeholder={t('profile:password.current')}
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      required
                    />
                    <Input
                      type="password"
                      placeholder={t('profile:password.new')}
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
                      {pwLoading ? t('common:status.saving') : t('profile:password.save')}
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* 2FA / TOTP Section */}
            <div className="pt-5 border-t dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold dark:text-slate-200">{t('profile:totp.title')}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{t('profile:totp.subtitle')}</p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${totpEnabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                  {totpEnabled ? t('profile:totp.active') : t('profile:totp.inactive')}
                </span>
              </div>

              {totpMsg && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${totpMsg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                  {totpMsg.text}
                </div>
              )}

              {!totpEnabled && !totpSetup && (
                <Button size="sm" variant="secondary" onClick={startTotpSetup} disabled={totpLoading}>
                  {totpLoading ? t('profile:totp.loading') : t('profile:totp.enable')}
                </Button>
              )}

              {totpSetup && (
                <div className="space-y-3 p-4 rounded-xl border dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40">
                  <p className="text-xs text-gray-600 dark:text-slate-400">{t('profile:totp.scanInstruction')}</p>
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
                      {totpLoading ? '…' : t('profile:totp.confirm')}
                    </Button>
                  </div>
                </div>
              )}

              {totpEnabled && (
                <button onClick={disableTotp} className="text-sm text-red-600 dark:text-red-400 hover:underline">
                  {t('profile:totp.disable')}
                </button>
              )}
            </div>

            {/* Passkeys Section */}
            <div className="pt-5 border-t dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold dark:text-slate-200 flex items-center gap-2"><Fingerprint size={14} className="text-green-500" />{t('profile:passkeys.title')}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{t('profile:passkeys.subtitle')}</p>
                </div>
                {passkeySupported && (
                  <Button size="sm" variant="secondary" onClick={registerPasskey} disabled={passkeyLoading}>
                    {passkeyLoading ? '…' : t('profile:passkeys.add')}
                  </Button>
                )}
              </div>
              {!passkeySupported && <p className="text-xs text-gray-400 dark:text-slate-500">{t('profile:passkeys.noSupport')}</p>}
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
                            {pk.device_type === 'singleDevice' ? t('profile:passkeys.deviceBound') : t('profile:passkeys.synced')}
                            {pk.backed_up ? ` · ${t('profile:passkeys.cloudBackup')}` : ''}
                            {' · '}{t('profile:passkeys.registered')} {new Date(pk.created_at).toLocaleDateString()}
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

          {/* Right column: API tokens (5 of 12 cols) */}
          <div className="lg:col-span-5 space-y-6 border-t lg:border-t-0 lg:border-l lg:pl-8 dark:border-slate-800 border-gray-100 flex flex-col justify-between">
            <div className="space-y-4 flex-1">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-blue-500" />
                <p className="text-sm font-semibold dark:text-slate-200">{t('profile:apiTokens.title')}</p>
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 leading-relaxed">
                {t('profile:apiTokens.description')}
              </p>

              {/* List of tokens */}
              <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                {apiTokens.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-slate-400 italic">{t('profile:apiTokens.none')}</p>
                ) : (
                  apiTokens.map(token => {
                    const isExpired = token.expires_at && new Date(token.expires_at) < new Date();
                    return (
                      <div key={token.id} className="p-3 rounded-xl border dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold dark:text-slate-200 truncate">{token.name}</p>
                            <p className="text-[10px] text-gray-400 dark:text-slate-500">
                              {t('profile:apiTokens.created')} {new Date(token.created_at).toLocaleDateString()}
                              {token.expires_at ? (
                                <span className={isExpired ? ' text-red-500 ml-1.5' : ' ml-1.5'}>
                                  · {t('profile:apiTokens.validUntil')} {new Date(token.expires_at).toLocaleDateString()} {isExpired && t('profile:apiTokens.expired')}
                                </span>
                              ) : (
                                <span className="ml-1.5">· {t('profile:apiTokens.unlimited')}</span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteToken(token.id)}
                            className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded flex-shrink-0"
                            title={t('common:actions.delete')}
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
                            title={revealedTokens[token.id] ? t('common:actions.hide') : t('common:actions.show')}
                          >
                            {revealedTokens[token.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyToken(token.id, token.token)}
                            className="p-1.5 rounded border dark:border-slate-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                            title={t('common:actions.copy')}
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
                <p className="text-xs font-semibold dark:text-slate-300">{t('profile:apiTokens.newToken')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    type="text"
                    placeholder={t('profile:apiTokens.namePlaceholder')}
                    value={newTokenName}
                    onChange={e => setNewTokenName(e.target.value)}
                    required
                  />
                  <Input
                    type="date"
                    placeholder={t('profile:apiTokens.expiryPlaceholder')}
                    value={newTokenExpiry}
                    onChange={e => setNewTokenExpiry(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    title={t('profile:apiTokens.expiryTitle')}
                  />
                </div>
                <Button type="submit" disabled={tokenLoading} className="w-full justify-center text-xs py-1.5">
                  {tokenLoading ? t('common:status.loading') : t('profile:apiTokens.generate')}
                </Button>
              </form>
            </div>

            <div className="pt-6 border-t dark:border-slate-800 flex justify-end">
              <Button variant="secondary" onClick={() => setProfileModalOpen(false)}>{t('common:actions.close')}</Button>
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
            <span className="text-xs">{t('common:filters.searchPlaceholder')}</span>
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
