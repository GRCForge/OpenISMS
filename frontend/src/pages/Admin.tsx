import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users as UsersIcon, History, KeyRound, Settings as SettingsIcon, CheckCircle2, XCircle, Copy, Loader2, ShieldCheck, Wrench, Trash2, Lock, RefreshCw, BookOpen, ExternalLink, Database, Download, Upload, AlertTriangle, FileArchive, Mail, Send, Wifi, Puzzle, Shield, Zap, Bot, LifeBuoy, Target, Car, Radar, AlertOctagon, Tag } from 'lucide-react';
import api from '../lib/api';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Users } from './Users';
import { AuditLogPage } from './AuditLog';
import { Groups } from './Groups';
import { useModules } from '../contexts/ModulesContext';
import type { ModuleKey } from '../contexts/ModulesContext';

type AdminTab = 'users' | 'groups' | 'audit' | 'settings' | 'security' | 'rbac' | 'api' | 'backup' | 'smtp' | 'modules' | 'llm';

// ---------------- SMTP / E-Mail ----------------
interface SmtpState { host: string; port: string; secure: boolean; user: string; password: string; from: string; }

const SmtpSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const [cfg, setCfg] = useState<SmtpState>({ host: '', port: '587', secure: false, user: '', password: '', from: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get('/admin/smtp').then(r => {
      if (r.data) setCfg({ host: r.data.host || '', port: String(r.data.port || 587), secure: !!r.data.secure, user: r.data.user || '', password: r.data.password || '', from: r.data.from || '' });
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put('/admin/smtp', { ...cfg, port: Number(cfg.port) });
      // Reload masked config so subsequent "Verbindung testen" uses the stored password via backend
      const r = await api.get('/admin/smtp');
      if (r.data) setCfg({ host: r.data.host || '', port: String(r.data.port || 587), secure: !!r.data.secure, user: r.data.user || '', password: r.data.password || '', from: r.data.from || '' });
      setMsg({ ok: true, text: t('oidc.save_success') });
    }
    catch (e: any) { setMsg({ ok: false, text: e.response?.data?.error || t('save_failed') }); }
    finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try { await api.post('/admin/smtp/test', { ...cfg, port: Number(cfg.port) }); setMsg({ ok: true, text: t('smtp.test_success') }); }
    catch (e: any) { setMsg({ ok: false, text: e.response?.data?.error || t('smtp.test_failed') }); }
    finally { setTesting(false); }
  };

  const sendTest = async () => {
    if (!sendTo) return;
    setSending(true); setMsg(null);
    try { await api.post('/admin/smtp/send-test', { to: sendTo }); setMsg({ ok: true, text: t('smtp.test_email_sent', { to: sendTo }) }); }
    catch (e: any) { setMsg({ ok: false, text: e.response?.data?.error || t('smtp.send_failed') }); }
    finally { setSending(false); }
  };

  const upd = (patch: Partial<SmtpState>) => setCfg(c => ({ ...c, ...patch }));

  if (!loaded) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Mail size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('smtp.title')}</h2></div></CardHeader>
      <CardBody className="space-y-5 max-w-2xl">
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('smtp.description')}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2"><Input label={t('smtp.host')} value={cfg.host} onChange={e => upd({ host: e.target.value })} placeholder="smtp.gmail.com" /></div>
          <Input label={t('smtp.port')} type="number" value={cfg.port} onChange={e => upd({ port: e.target.value })} placeholder="587" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label={t('smtp.username')} value={cfg.user} onChange={e => upd({ user: e.target.value })} placeholder="user@example.com" />
          <Input label={t('smtp.password')} type="password" value={cfg.password} onChange={e => upd({ password: e.target.value })} placeholder="••••••••" />
        </div>
        <Input label={t('smtp.from')} value={cfg.from} onChange={e => upd({ from: e.target.value })} placeholder='OpenISMS <noreply@example.com>' />
        <label className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50 dark:bg-slate-800/40 dark:border-slate-700 cursor-pointer">
          <input type="checkbox" checked={cfg.secure} onChange={e => upd({ secure: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
          <span className="text-sm dark:text-slate-200">{t('smtp.use_secure')}</span>
        </label>

        {msg && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${msg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
            {msg.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{msg.text}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2 border-t dark:border-slate-700">
          <Button variant="secondary" onClick={test} disabled={testing || !cfg.host}>
            <Wifi size={14} />{testing ? t('smtp.testing') : t('smtp.test_connection')}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? t('save_saving') : t('save')}
          </Button>
        </div>

        <div className="pt-2 border-t dark:border-slate-700 space-y-3">
          <p className="text-sm font-medium dark:text-slate-300">{t('smtp.send_test_email')}</p>
          <div className="flex gap-3">
            <input
              type="email"
              value={sendTo}
              onChange={e => setSendTo(e.target.value)}
              placeholder="empfaenger@example.com"
              className="flex-1 bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            />
            <Button variant="secondary" onClick={sendTest} disabled={sending || !sendTo || !cfg.host}>
              <Send size={14} />{sending ? t('smtp.sending') : t('smtp.send')}
            </Button>
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500">{t('smtp.send_test_help')}</p>
        </div>
      </CardBody>
    </Card>
  );
};

// ---------------- OIDC / SSO ----------------
interface OidcState {
  enabled: boolean; displayName: string; issuer: string; clientId: string;
  scopes: string; clientSecretSet: boolean; callbackUrl: string;
}

const OidcSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const [cfg, setCfg] = useState<OidcState | null>(null);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api.get('/admin/oidc').then(r => setCfg(r.data)).catch(() => setCfg(null));
  useEffect(() => { load(); }, []);

  if (!cfg) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  const upd = (patch: Partial<OidcState>) => setCfg({ ...cfg, ...patch });

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await api.put('/admin/oidc', {
        enabled: cfg.enabled, displayName: cfg.displayName, issuer: cfg.issuer,
        clientId: cfg.clientId, scopes: cfg.scopes, ...(secret ? { clientSecret: secret } : {}),
      });
      setSecret('');
      await load();
      setMsg({ ok: true, text: t('oidc.save_success') });
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('save_failed') });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      const r = await api.post('/admin/oidc/test', { issuer: cfg.issuer });
      setMsg({ ok: true, text: t('oidc.discovery_success', { issuer: r.data.issuer }) });
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('oidc.discovery_failed') });
    } finally { setTesting(false); }
  };

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><KeyRound size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('oidc.title')}</h2></div></CardHeader>
      <CardBody className="space-y-5">
        <label className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50 dark:bg-slate-800/40 dark:border-slate-700 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={e => upd({ enabled: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
          <span className="text-sm font-medium dark:text-slate-200">{t('oidc.enable')}</span>
        </label>

        <Input label={t('oidc.display_name')} value={cfg.displayName} onChange={e => upd({ displayName: e.target.value })} placeholder={t('oidc.display_name_placeholder')} />
        <Input label={t('oidc.issuer_url')} value={cfg.issuer} onChange={e => upd({ issuer: e.target.value })} placeholder="https://auth.example.com/application/o/isms/" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label={t('oidc.client_id')} value={cfg.clientId} onChange={e => upd({ clientId: e.target.value })} />
          <Input label={`${t('oidc.client_secret')}${cfg.clientSecretSet ? t('oidc.client_secret_set') : ''}`} type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={cfg.clientSecretSet ? t('oidc.client_secret_placeholder') : ''} />
        </div>
        <Input label={t('oidc.scopes')} value={cfg.scopes} onChange={e => upd({ scopes: e.target.value })} placeholder="openid profile email" />

        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30">
          <p className="text-xs text-blue-700 dark:text-blue-300 font-semibold mb-1">{t('oidc.redirect_uri_help')}</p>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-white dark:bg-slate-900 px-2 py-1 rounded border dark:border-slate-700 break-all flex-1">{cfg.callbackUrl}</code>
            <button onClick={() => navigator.clipboard?.writeText(cfg.callbackUrl)} className="shrink-0 text-blue-600 dark:text-blue-400 hover:text-blue-800" title={t('oidc.copy')}><Copy size={14} /></button>
          </div>
        </div>

        {msg && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${msg.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
            {msg.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{msg.text}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={test} disabled={testing || !cfg.issuer}>{testing ? t('smtp.testing') : t('smtp.test_connection')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('save_saving') : t('save')}</Button>
        </div>
      </CardBody>
    </Card>
  );
};

// ---------------- Allgemeine Einstellungen ----------------
interface GeneralState { appName: string; reviewIntervalMonths: number; ssoAutoProvision: boolean; ssoDefaultRole: string; }

const GeneralSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const [s, setS] = useState<GeneralState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.get('/admin/settings').then(r => setS(r.data)).catch(() => setS(null)); }, []);
  if (!s) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  const save = async () => {
    setSaving(true); setSaved(false);
    try { await api.put('/admin/settings', s); setSaved(true); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><SettingsIcon size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('general.title')}</h2></div></CardHeader>
      <CardBody className="space-y-5 max-w-2xl">
        <Input label={t('general.app_name')} value={s.appName} onChange={e => setS({ ...s, appName: e.target.value })} />
        <Input label={t('general.review_interval')} type="number" value={String(s.reviewIntervalMonths)} onChange={e => setS({ ...s, reviewIntervalMonths: parseInt(e.target.value) || 12 })} />
        <Select label={t('general.sso_default_role')} value={s.ssoDefaultRole} onChange={e => setS({ ...s, ssoDefaultRole: e.target.value })}
          options={[
            { value: 'admin', label: t('roles.admin') },
            { value: 'assessor', label: t('roles.assessor') },
            { value: 'it-staff', label: t('roles.it-staff') },
            { value: 'dpo', label: t('roles.dpo') },
            { value: 'owner', label: t('roles.owner') },
            { value: 'viewer', label: t('roles.viewer') }
          ]} />
        <label className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50 dark:bg-slate-800/40 dark:border-slate-700 cursor-pointer">
          <input type="checkbox" checked={s.ssoAutoProvision} onChange={e => setS({ ...s, ssoAutoProvision: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
          <span className="text-sm font-medium dark:text-slate-200">{t('general.sso_autoprovision')}</span>
        </label>
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} disabled={saving}>{saving ? t('save_saving') : t('save')}</Button>
          {saved && <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 size={15} />{t('general.saved')}</span>}
        </div>
      </CardBody>
    </Card>
  );
};

interface PasswordPolicy { minLength: number; requireUppercase: boolean; requireNumber: boolean; requireSpecial: boolean; }
interface BruteForcePolicy { maxAttempts: number; lockoutMinutes: number; }
interface SecurityState { auditLogRetentionMonths: number; passwordPolicy: PasswordPolicy; bruteForcePolicy: BruteForcePolicy; }

const SecuritySettings: React.FC = () => {
  const { t, i18n } = useTranslation('admin');
  const [s, setS] = useState<SecurityState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ deleted: number; cutoff: string } | null>(null);

  const load = () => api.get('/admin/settings').then(r => setS({
    auditLogRetentionMonths: r.data.auditLogRetentionMonths || 15,
    passwordPolicy: r.data.passwordPolicy || { minLength: 10, requireUppercase: true, requireNumber: true, requireSpecial: true },
    bruteForcePolicy: r.data.bruteForcePolicy || { maxAttempts: 5, lockoutMinutes: 15 },
  })).catch(() => setS(null));

  useEffect(() => { load(); }, []);
  if (!s) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await api.put('/admin/settings', {
        auditLogRetentionMonths: s.auditLogRetentionMonths,
        passwordPolicy: s.passwordPolicy,
        bruteForcePolicy: s.bruteForcePolicy
      });
      setSaved(true);
    }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  const purge = async () => {
    if (!confirm(t('security.purge_confirm'))) return;
    setPurging(true); setPurgeResult(null);
    try {
      const r = await api.post('/admin/maintenance/purge-audit-log');
      setPurgeResult(r.data);
    } catch { /* ignore */ } finally { setPurging(false); }
  };

  const upd = (patch: Partial<SecurityState>) => setS(prev => prev ? { ...prev, ...patch } : prev);
  const updPolicy = (patch: Partial<PasswordPolicy>) => upd({ passwordPolicy: { ...s.passwordPolicy, ...patch } });
  const updBrute = (patch: Partial<BruteForcePolicy>) => upd({ bruteForcePolicy: { ...s.bruteForcePolicy, ...patch } });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('security.password_policy_title')}</h2></div></CardHeader>
        <CardBody className="space-y-4">
          <Input label={t('security.min_length')} type="number" value={String(s.passwordPolicy.minLength)} onChange={e => updPolicy({ minLength: parseInt(e.target.value) || 8 })} />
          {([
            ['requireUppercase', 'security.req_uppercase'],
            ['requireNumber', 'security.req_number'],
            ['requireSpecial', 'security.req_special'],
          ] as const).map(([key, labelKey]) => (
            <label key={key} className="flex items-center gap-3 p-3 rounded-lg border dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 cursor-pointer">
              <input type="checkbox" checked={s.passwordPolicy[key]} onChange={e => updPolicy({ [key]: e.target.checked })} className="w-4 h-4 rounded text-blue-600" />
              <span className="text-sm dark:text-slate-200">{t(labelKey)}</span>
            </label>
          ))}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={save} disabled={saving}>{saving ? t('save_saving') : t('save')}</Button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 size={15} />{t('general.saved')}</span>}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center gap-2"><Lock size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('security.brute_force_title')}</h2></div></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('security.max_attempts')}
              type="number"
              value={String(s.bruteForcePolicy.maxAttempts)}
              onChange={e => updBrute({ maxAttempts: Math.max(1, parseInt(e.target.value) || 5) })}
            />
            <Input
              label={t('security.lockout_minutes')}
              type="number"
              value={String(s.bruteForcePolicy.lockoutMinutes)}
              onChange={e => updBrute({ lockoutMinutes: Math.max(1, parseInt(e.target.value) || 15) })}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {t('security.brute_force_help')}
          </p>
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={save} disabled={saving}>{saving ? t('save_saving') : t('save')}</Button>
            {saved && <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 size={15} />{t('general.saved')}</span>}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><div className="flex items-center gap-2"><Wrench size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('security.audit_retention_title')}</h2></div></CardHeader>
        <CardBody className="space-y-4">
          <Input label={t('security.retention_period')} type="number" value={String(s.auditLogRetentionMonths)} onChange={e => upd({ auditLogRetentionMonths: parseInt(e.target.value) || 15 })} />
          <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">{t('security.retention_help')}</p>
          <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30 text-xs text-blue-700 dark:text-blue-300">
            {t('security.cleanup_help')}
          </div>
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button onClick={save} disabled={saving}>{saving ? t('save_saving') : t('security.save_retention')}</Button>
            <Button variant="secondary" onClick={purge} disabled={purging} className="text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-900/20">
              <Trash2 size={14} />{purging ? t('security.purging') : t('security.purge_now')}
            </Button>
          </div>
          {purgeResult && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/40 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 size={14} className="inline mr-1" />
              {t('security.purge_result', { count: purgeResult.deleted, date: new Date(purgeResult.cutoff).toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-US') })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

// ---------------- RBAC / Rollen & Rechte ----------------
const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', assessor: 'Assessor', 'it-staff': 'IT-Staff', dpo: 'DPO', owner: 'Owner', management: 'Management', viewer: 'Viewer',
};

// ---- Custom Roles ----
interface CustomRoleItem { id: number; name: string; description: string | null; base_role: string; users_count?: number; }
interface OidcMappingItem { id: number; claim_path: string; claim_value: string; role: string | null; custom_role_id: number | null; priority: number; customRole?: { id: number; name: string; base_role: string } | null; }

const BASE_ROLES = ['admin', 'assessor', 'dpo', 'it-staff', 'management', 'owner', 'viewer'] as const;

const CustomRolesEditor: React.FC = () => {
  const { t } = useTranslation('admin');
  const [roles, setRoles] = useState<CustomRoleItem[]>([]);
  const [form, setForm] = useState<Partial<CustomRoleItem>>({});
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.get('/admin/custom-roles').then(r => setRoles(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const startEdit = (r: CustomRoleItem) => { setEditId(r.id); setForm({ name: r.name, description: r.description || '', base_role: r.base_role }); };
  const cancelEdit = () => { setEditId(null); setForm({}); };

  const save = async () => {
    if (!form.name?.trim()) return;
    setSaving(true); setMsg('');
    try {
      if (editId) { await api.put(`/admin/custom-roles/${editId}`, form); }
      else { await api.post('/admin/custom-roles', form); }
      setForm({}); setEditId(null); await load(); setMsg(t('custom_roles.saved'));
    } catch (e: any) { setMsg(e.response?.data?.error || t('custom_roles.error')); }
    finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm(t('custom_roles.delete_confirm'))) return;
    try { await api.delete(`/admin/custom-roles/${id}`); await load(); }
    catch { /* ignore */ }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><Lock size={18} className="text-purple-500" /><h2 className="font-semibold dark:text-white">{t('custom_roles.title')}</h2></div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('custom_roles.description')}</p>
        {roles.length === 0 && <p className="text-sm text-gray-400 italic">{t('custom_roles.no_roles')}</p>}
        {roles.length > 0 && (
          <div className="border dark:border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('custom_roles.name_header')}</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('custom_roles.base_role_header')}</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider hidden sm:table-cell">{t('custom_roles.description_header')}</th>
                  <th className="px-4 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {roles.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20">
                    {editId === r.id ? (
                      <>
                        <td className="px-4 py-2"><Input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="text-sm" /></td>
                        <td className="px-4 py-2">
                          <Select value={form.base_role || 'viewer'} onChange={e => setForm(f => ({ ...f, base_role: e.target.value }))}>
                            {BASE_ROLES.map(br => <option key={br} value={br}>{t('roles.' + br + '_short', { defaultValue: br })}</option>)}
                          </Select>
                        </td>
                        <td className="px-4 py-2 hidden sm:table-cell"><Input value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="text-sm" placeholder={t('custom_roles.description_placeholder')} /></td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <Button size="sm" onClick={save} disabled={saving}>{t('ok')}</Button>
                            <Button size="sm" variant="secondary" onClick={cancelEdit}>✕</Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-medium dark:text-white">
                          {r.name}
                          {!!r.users_count && <span className="ml-2 text-xs font-normal text-gray-400 dark:text-slate-500">{t('custom_roles.users_count', { count: r.users_count })}</span>}
                        </td>
                        <td className="px-4 py-2"><span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{t('roles.' + r.base_role + '_short', { defaultValue: r.base_role })}</span></td>
                        <td className="px-4 py-2 text-gray-500 dark:text-slate-400 text-xs hidden sm:table-cell">{r.description || '—'}</td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => startEdit(r)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500"><Wrench size={13} /></button>
                            <button onClick={() => del(r.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border dark:border-slate-700 rounded-xl p-4 bg-gray-50/50 dark:bg-slate-800/30">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('custom_roles.add_title')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input placeholder={t('custom_roles.name_placeholder')} value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Select value={form.base_role || 'viewer'} onChange={e => setForm(f => ({ ...f, base_role: e.target.value }))}>
              {BASE_ROLES.map(br => <option key={br} value={br}>{t('roles.' + br + '_short', { defaultValue: br })}</option>)}
            </Select>
            <Input placeholder={t('custom_roles.description_placeholder')} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button size="sm" onClick={save} disabled={saving || !form.name?.trim()}>{saving ? t('save_saving') : t('custom_roles.add_btn')}</Button>
            {msg && <span className="text-xs text-green-600 dark:text-green-400">{msg}</span>}
          </div>
        </div>
      </CardBody>
    </Card>
  );
};

// ---- OIDC Claim Mappings ----
const OidcMappingsEditor: React.FC = () => {
  const { t } = useTranslation('admin');
  const [mappings, setMappings] = useState<OidcMappingItem[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRoleItem[]>([]);
  const [form, setForm] = useState({ claim_path: '', claim_value: '', role: 'viewer', custom_role_id: '', priority: '0', use_custom: false });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    const [m, r] = await Promise.all([api.get('/admin/oidc-mappings'), api.get('/admin/custom-roles')]);
    setMappings(m.data); setCustomRoles(r.data);
  };
  useEffect(() => { load().catch(() => {}); }, []);

  const add = async () => {
    if (!form.claim_path.trim() || !form.claim_value.trim()) return;
    setSaving(true); setMsg('');
    try {
      const body: Record<string, unknown> = { claim_path: form.claim_path.trim(), claim_value: form.claim_value.trim(), priority: parseInt(form.priority) || 0 };
      if (form.use_custom && form.custom_role_id) body.custom_role_id = parseInt(form.custom_role_id);
      else body.role = form.role;
      await api.post('/admin/oidc-mappings', body);
      setForm({ claim_path: '', claim_value: '', role: 'viewer', custom_role_id: '', priority: '0', use_custom: false });
      await load(); setMsg(t('oidc_mappings.added'));
    } catch (e: any) { setMsg(e.response?.data?.error || t('custom_roles.error')); }
    finally { setSaving(false); }
  };

  const del = async (id: number) => {
    if (!confirm(t('oidc_mappings.delete_confirm'))) return;
    try { await api.delete(`/admin/oidc-mappings/${id}`); await load(); }
    catch { /* ignore */ }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><KeyRound size={18} className="text-indigo-500" /><h2 className="font-semibold dark:text-white">{t('oidc_mappings.title')}</h2></div>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          {t('oidc_mappings.description')}
        </p>
        {mappings.length === 0 && <p className="text-sm text-gray-400 italic">{t('oidc_mappings.no_mappings')}</p>}
        {mappings.length > 0 && (
          <div className="border dark:border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('oidc_mappings.claim_path')}</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('oidc_mappings.claim_value')}</th>
                  <th className="text-left px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('oidc_mappings.role')}</th>
                  <th className="text-center px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">{t('oidc_mappings.prio')}</th>
                  <th className="px-4 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {mappings.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/20">
                    <td className="px-4 py-2 font-mono text-xs text-blue-700 dark:text-blue-300">{m.claim_path}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.claim_value}</td>
                    <td className="px-4 py-2">
                      {m.customRole
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">{m.customRole.name} <span className="opacity-60">({t('roles.' + m.customRole.base_role + '_short', { defaultValue: m.customRole.base_role })})</span></span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{t('roles.' + (m.role || '') + '_short', { defaultValue: m.role || '' })}</span>
                      }
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-gray-500">{m.priority}</td>
                    <td className="px-4 py-2"><button onClick={() => del(m.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border dark:border-slate-700 rounded-xl p-4 bg-gray-50/50 dark:bg-slate-800/30 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{t('oidc_mappings.new_mapping')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label={t('oidc_mappings.claim_path_label')} placeholder="groups" value={form.claim_path} onChange={e => setForm(f => ({ ...f, claim_path: e.target.value }))} />
            <Input label={t('oidc_mappings.claim_value')} placeholder="security-admins" value={form.claim_value} onChange={e => setForm(f => ({ ...f, claim_value: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                <input type="checkbox" className="rounded" checked={form.use_custom} onChange={e => setForm(f => ({ ...f, use_custom: e.target.checked }))} />
                {t('oidc_mappings.use_custom_role')}
              </label>
              {form.use_custom ? (
                <Select label={t('oidc_mappings.custom_role_label')} value={form.custom_role_id} onChange={e => setForm(f => ({ ...f, custom_role_id: e.target.value }))}>
                  <option value="">{t('oidc_mappings.select_placeholder')}</option>
                  {customRoles.map(r => <option key={r.id} value={String(r.id)}>{r.name} ({t('roles.' + r.base_role + '_short', { defaultValue: r.base_role })})</option>)}
                </Select>
              ) : (
                <Select label={t('oidc_mappings.standard_role_label')} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  {BASE_ROLES.map(r => <option key={r} value={r}>{t('roles.' + r + '_short', { defaultValue: r })}</option>)}
                </Select>
              )}
            </div>
            <Input label={t('oidc_mappings.priority_label')} type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
            <Button onClick={add} disabled={saving || !form.claim_path.trim() || !form.claim_value.trim()}>
              {saving ? t('oidc_mappings.adding') : t('oidc_mappings.add_btn')}
            </Button>
          </div>
          {msg && <p className="text-xs text-green-600 dark:text-green-400">{msg}</p>}
        </div>
      </CardBody>
    </Card>
  );
};

const RbacEditor: React.FC = () => {
  const { t } = useTranslation('admin');
  const [data, setData] = useState<{ permissions: Record<string, Record<string, string[]>>; roles: string[] } | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>('assessor');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => api.get('/admin/permissions').then(r => setData(r.data)).catch(() => setData(null));
  useEffect(() => { load(); }, []);

  if (!data) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  const { permissions, roles } = data;

  const toggle = (module: string, action: string, role: string) => {
    const cur = permissions[module]?.[action] || [];
    const next = cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role];
    setData(d => d ? { ...d, permissions: { ...d.permissions, [module]: { ...d.permissions[module], [action]: next } } } : d);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true); setSaved(false);
    try { await api.put('/admin/permissions', { permissions }); setSaved(true); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!confirm(t('rbac.reset_confirm'))) return;
    try { const r = await api.post('/admin/permissions/reset'); setData(d => d ? { ...d, permissions: r.data.permissions } : d); setSaved(true); }
    catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lock size={18} className="text-blue-500" />
              <h2 className="font-semibold dark:text-white">{t('rbac.title')}</h2>
            </div>
            <div className="flex items-center gap-2">
              {saved && <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 size={13} />{t('rbac.saved')}</span>}
              <Button variant="secondary" size="sm" onClick={reset}><RefreshCw size={13} />{t('rbac.reset')}</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? t('save_saving') : t('save')}</Button>
            </div>
          </div>
        </CardHeader>
        <CardBody className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl border dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2 shrink-0">
              <Shield size={16} className="text-blue-500" />
              <span className="text-sm font-semibold dark:text-slate-200">{t('rbac.select_role_label')}</span>
            </div>
            <div className="w-full sm:w-64">
              <Select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}>
                {roles.map(r => (
                  <option key={r} value={r}>{t('roles.' + r + '_short', { defaultValue: r })}</option>
                ))}
              </Select>
            </div>
          </div>

          {selectedRole === 'admin' ? (
            <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30 flex items-start gap-3">
              <AlertTriangle size={18} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">{t('rbac.admin_role_title')}</p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">{t('rbac.admin_role_help')}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {Object.entries(permissions).map(([module, actions]) => (
                <div key={module} className="border dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900/50 shadow-sm flex flex-col">
                  <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800/50 border-b dark:border-slate-800">
                    <span className="text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">{t('modules.' + module, { defaultValue: module })}</span>
                  </div>
                  <div className="p-4 space-y-3 flex-1">
                    {Object.entries(actions).map(([action, allowed]) => {
                      const isChecked = (allowed as string[]).includes(selectedRole);
                      return (
                        <label key={action} className="flex items-center justify-between gap-3 cursor-pointer group">
                          <span className="text-xs text-gray-600 dark:text-slate-400 group-hover:text-gray-900 dark:group-hover:text-slate-200 transition-colors">
                            {t('actions.' + action, { defaultValue: action })}
                          </span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(module, action, selectedRole)}
                            className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

// ---------------- API Dokumentation ----------------
const ApiDocs: React.FC = () => {
  const { t } = useTranslation('admin');
  const [backendUrl, setBackendUrl] = useState('');
  useEffect(() => {
    const loc = window.location;
    const base = loc.hostname === 'localhost' ? 'http://localhost:3001' : `${loc.protocol}//${loc.host}`;
    setBackendUrl(`${base}/api/docs`);
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><div className="flex items-center gap-2"><BookOpen size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('api_docs.title')}</h2></div></CardHeader>
        <CardBody className="space-y-4">
          <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-1">{t('api_docs.auth_title')}</p>
            <p className="text-sm text-blue-700 dark:text-blue-400">{t('api_docs.auth_help')}</p>
            <code className="block mt-2 text-xs bg-white dark:bg-slate-900 p-3 rounded-lg border dark:border-slate-700 font-mono">Authorization: Bearer {'<token>'}</code>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">{t('api_docs.token_help_before')} <code className="bg-white/60 dark:bg-slate-800 px-1 rounded">POST /api/auth/login</code> {t('api_docs.token_help_after')}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border dark:border-slate-800 space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('api_docs.interactive_title')}</p>
              <p className="text-sm text-gray-600 dark:text-slate-400">{t('api_docs.interactive_desc')}</p>
              <a href={backendUrl} target="_blank" rel="noreferrer">
                <Button size="sm" className="mt-2"><ExternalLink size={14} />{t('api_docs.open_swagger')}</Button>
              </a>
            </div>
            <div className="p-4 rounded-xl border dark:border-slate-800 space-y-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{t('api_docs.spec_title')}</p>
              <p className="text-sm text-gray-600 dark:text-slate-400">{t('api_docs.spec_desc')}</p>
              <a href={`${backendUrl.replace('/docs', '/openapi.json')}?download=1`} download="openapi.json">
                <Button size="sm" variant="secondary" className="mt-2"><Download size={14} />{t('api_docs.spec_download')}</Button>
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {[
              ['auth', 'Authentifizierung', 'Login, JWT'],
              ['assets', 'Assets', 'CRUD, Dokumente'],
              ['risks', 'Risiken', 'Risikoregister'],
              ['incidents', 'Vorfälle', 'Incident Management'],
              ['assessments', 'Bewertungen', 'CIA / SBF'],
              ['controls', 'Maßnahmen', 'Controls & SoA'],
              ['policies', 'Richtlinien', 'Policy-Bibliothek'],
              ['users', 'Benutzer', 'User Management'],
              ['admin', 'Administration', 'Einstellungen, RBAC'],
              ['import', 'Import', 'CSV-Massenimport']
            ].map(([key, name, desc]) => (
              <div key={key} className="p-2 rounded-lg border dark:border-slate-800 bg-gray-50 dark:bg-slate-800/30">
                <p className="font-bold text-gray-700 dark:text-slate-300">{t('api_docs.cat.' + key, { defaultValue: name })}</p>
                <p className="text-gray-400 dark:text-slate-500">{t('api_docs.cat.' + key + '_desc', { defaultValue: desc })}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

// ---------------- Backup & Restore ----------------
interface BackupInfo { tables: Record<string, number>; upload_size_bytes: number; }
interface BackupMeta { isms_version: string; exported_at: string; tables: Record<string, number>; _current_version?: string; }

const BackupRestore: React.FC = () => {
  const { t, i18n } = useTranslation('admin');
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewMeta, setPreviewMeta] = useState<BackupMeta | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get('/admin/backup/info').then(r => setInfo(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      const resp = await api.get('/admin/backup/export', { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      a.href = url; a.download = `isms-backup-${ts}.zip`; a.click();
      URL.revokeObjectURL(url);
      setResult({ ok: true, text: t('backup.export_success') });
    } catch { setResult({ ok: false, text: t('backup.export_failed') }); }
    finally { setExporting(false); }
  };

  const readFileMeta = async (file: File) => {
    setSelectedFile(file); setPreviewMeta(null); setResult(null);
    try {
      const fd = new FormData(); fd.append('backup', file);
      const r = await api.post('/admin/backup/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreviewMeta(r.data);
    } catch {
      // Preview failed — restore will still validate the file
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.zip')) readFileMeta(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFileMeta(file);
  };

  const handleRestore = async () => {
    if (!selectedFile || confirmText !== 'WIEDERHERSTELLEN') return;
    setRestoring(true); setConfirmOpen(false); setConfirmText('');
    try {
      const fd = new FormData(); fd.append('backup', selectedFile);
      const r = await api.post('/admin/backup/restore', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResult({ ok: true, text: t('backup.restore_success', { tables: r.data.tables_restored, files: r.data.files_restored }) });
      setSelectedFile(null); setPreviewMeta(null);
      api.get('/admin/backup/info').then(r2 => setInfo(r2.data)).catch(() => {});
    } catch (e: any) {
      setResult({ ok: false, text: t('backup.restore_failed', { error: e.response?.data?.error || e.message }) });
    } finally { setRestoring(false); }
  };

  const fmtBytes = (b: number) => b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
  const totalRows = info ? Object.values(info.tables).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-6">
      {result && (
        <div className={`flex items-center gap-3 p-4 rounded-xl border ${result.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'}`}>
          {result.ok ? <CheckCircle2 size={18} className="text-green-600 shrink-0" /> : <XCircle size={18} className="text-red-600 shrink-0" />}
          <p className={`text-sm font-medium ${result.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{result.text}</p>
          <button onClick={() => setResult(null)} className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* Export Section */}
      <Card>
        <CardHeader><div className="flex items-center gap-2"><Download size={16} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('backup.create_title')}</h2></div></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">{t('backup.create_desc')}</p>

          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={14} className="animate-spin" />{t('backup.loading_stats')}</div>
          ) : info && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: t('backup.total_records'), value: totalRows.toLocaleString(i18n.language) },
                { label: t('backup.tables'), value: Object.keys(info.tables).length },
                { label: t('backup.upload_size'), value: fmtBytes(info.upload_size_bytes) },
              ].map(s => (
                <div key={s.label} className="p-3 rounded-xl border dark:border-slate-800 bg-gray-50 dark:bg-slate-800/40 text-center">
                  <p className="text-xl font-bold dark:text-white">{s.value}</p>
                  <p className="text-xs text-gray-400">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleExport} disabled={exporting} className="flex items-center gap-2">
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {exporting ? t('backup.exporting') : t('backup.download_btn')}
            </Button>
            <p className="text-xs text-gray-400 dark:text-slate-500">{t('backup.zip_help')}</p>
          </div>
        </CardBody>
      </Card>

      {/* Restore Section */}
      <Card className="border-orange-200 dark:border-orange-900/40">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-orange-500" />
            <h2 className="font-semibold dark:text-white">{t('backup.restore_title')}</h2>
            <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">{t('backup.destructive')}</span>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800">
            <AlertTriangle size={16} className="text-orange-600 shrink-0 mt-0.5" />
            <p className="text-sm text-orange-700 dark:text-orange-300">{t('backup.restore_warning_before')} <strong>{t('backup.restore_warning_bold')}</strong> {t('backup.restore_warning_after')}</p>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : selectedFile ? 'border-green-400 bg-green-50 dark:bg-green-900/20' : 'border-gray-300 dark:border-slate-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10'}`}
          >
            <input ref={fileRef} type="file" accept=".zip" className="hidden" onChange={handleFileChange} />
            {selectedFile ? (
              <div className="space-y-1">
                <FileArchive size={32} className="mx-auto text-green-500" />
                <p className="font-medium text-green-700 dark:text-green-400">{selectedFile.name}</p>
                <p className="text-xs text-gray-400">{fmtBytes(selectedFile.size)} · {t('backup.click_to_change')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload size={32} className="mx-auto text-gray-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-gray-500 dark:text-slate-400">{t('backup.drag_drop_help')}</p>
                <p className="text-xs text-gray-400">{t('backup.zip_limits')}</p>
              </div>
            )}
          </div>

          {selectedFile && previewMeta && (
            <div className="p-4 rounded-xl border dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold dark:text-slate-200"><CheckCircle2 size={15} className="text-green-500" />{t('backup.details')}</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                <span>{t('backup.version')}</span><span className="font-mono font-bold dark:text-slate-300">v{previewMeta.isms_version}</span>
                <span>{t('backup.created_at')}</span><span className="font-mono dark:text-slate-300">{new Date(previewMeta.exported_at).toLocaleString(i18n.language)}</span>
                <span>{t('backup.tables')}</span><span className="font-mono dark:text-slate-300">{t('backup.preview_tables', { tables: Object.keys(previewMeta.tables).length, rows: Object.values(previewMeta.tables).reduce((a,b)=>a+b,0).toLocaleString(i18n.language) })}</span>
              </div>
              {previewMeta._current_version && previewMeta._current_version !== previewMeta.isms_version && (
                <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900/40 text-xs text-yellow-700 dark:text-yellow-400">
                  <span className="font-bold">⚠</span>
                  {t('backup.version_mismatch', { backupVersion: previewMeta.isms_version, currentVersion: previewMeta._current_version })}
                </div>
              )}
            </div>
          )}

          {selectedFile && (
            <div className="flex items-center justify-between pt-2">
              <div>
                <p className="text-sm font-medium dark:text-slate-200">{t('backup.selected')}</p>
                <p className="text-xs text-gray-400">{t('backup.proceed_warning')}</p>
              </div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={restoring}
                className="bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2"
              >
                {restoring ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {restoring ? t('backup.restoring') : t('backup.restore_btn')}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-100 dark:bg-red-900/30"><AlertTriangle size={20} className="text-red-600" /></div>
              <div>
                <h3 className="font-bold text-lg dark:text-white">{t('backup.confirm_modal.title')}</h3>
                <p className="text-xs text-gray-500">{t('backup.confirm_modal.subtitle')}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400">{t('backup.confirm_modal.warning')}</p>
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700 dark:text-slate-300">{t('backup.confirm_modal.input_label')}<span className="font-mono text-red-600">WIEDERHERSTELLEN</span></label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="WIEDERHERSTELLEN"
                className="w-full px-3 py-2 rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-white focus:ring-2 focus:ring-red-500 outline-none"
                autoFocus
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setConfirmOpen(false); setConfirmText(''); }} className="flex-1 px-4 py-2 rounded-xl border dark:border-slate-700 text-sm font-medium dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">{t('cancel')}</button>
              <button
                onClick={handleRestore}
                disabled={confirmText !== 'WIEDERHERSTELLEN'}
                className="flex-1 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('backup.confirm_modal.submit_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------- Module Management ----------------
interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  icon: React.FC<any>;
  iconColor: string;
  features: string[];
  alwaysOn?: boolean;
}

const MODULE_DEFS: ModuleDefinition[] = [
  {
    key: 'dsgvo',
    label: 'DSGVO / Datenschutz',
    description: 'Datenschutz-Grundverordnung — Verzeichnis der Verarbeitungstätigkeiten (Art. 30), Betroffenenrechte (Art. 15–22), DSFA-Workflow (Art. 35) und Datenflusskarte.',
    icon: Shield,
    iconColor: 'text-blue-600 dark:text-blue-400',
    features: ['Verarbeitungsverzeichnis (VVT, Art. 30)', 'Betroffenenrechte Art. 15–22', 'DSFA-Workflow (Art. 35)', 'Datenflusskarte'],
  },
  {
    key: 'tisax',
    label: 'TISAX',
    description: 'Trusted Information Security Assessment Exchange — Anforderungen der Automobilindustrie (VDA ISA), Label-Tracking.',
    icon: Car,
    iconColor: 'text-indigo-600 dark:text-indigo-400',
    features: ['Assessment-Tracking', 'Label-Status (AL2/AL3)', 'Auditplanung', 'Gültigkeitsüberwachung'],
  },
  {
    key: 'dora',
    label: 'DORA',
    description: 'Digital Operational Resilience Act — IKT-Drittparteienregister, Kritikalitätsbewertung und SLA-Tracking nach EU 2022/2554.',
    icon: Zap,
    iconColor: 'text-yellow-600 dark:text-yellow-400',
    features: ['IKT-Drittparteienregister', 'Kritikalitätsbewertung', 'RTO/RPO-Tracking', 'Review-Fristen'],
  },
  {
    key: 'ai_act',
    label: 'EU AI Act',
    description: 'KI-Register nach EU 2024/1689 — Risikoklassifikation (minimal/limited/high-risk/prohibited), Konformitätsstatus und technische Dokumentation.',
    icon: Bot,
    iconColor: 'text-purple-600 dark:text-purple-400',
    features: ['KI-Systemregister', 'Risikoklassifikation (Art. 5–7)', 'Konformitätsstatus', 'Technische Dokumentation'],
  },
  {
    key: 'bcm',
    label: 'BCM',
    description: 'Business Continuity Management — Business Impact Analysis, Wiederanlaufzeiten (RTO/RPO), Recovery-Strategien und Übungsprotokoll.',
    icon: LifeBuoy,
    iconColor: 'text-teal-600 dark:text-teal-400',
    features: ['BIA-Prozessregister', 'RTO/RPO-Ziele', 'Recovery-Strategien', 'Übungsprotokoll'],
  },
  {
    key: 'pentest',
    label: 'Pentest-Tracking',
    description: 'Verwaltung von Penetrationstests — Projekte, Findings mit Schweregrad (CVSS), Remediation-Status und Retest-Tracking.',
    icon: Target,
    iconColor: 'text-red-600 dark:text-red-400',
    features: ['Projekt- & Scope-Verwaltung', 'Finding-Register mit CVSS', 'Remediation-Tracking', 'Retest-Status'],
  },
  {
    key: 'discovery',
    label: 'Network Discovery & CVE',
    description: 'Netzwerk-Scanning, automatisches Asset-Discovery und CVE-Vulnerability-Matching (NVD, OSV.dev) für erkannte Assets.',
    icon: Radar,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    features: ['Netzwerk-Scan (Agent-basiert)', 'CVE-Matching per CPE/OSV', 'CVSS-Schweregrade', 'Automatisches Asset-Inventar'],
  },
  {
    key: 'iso27001',
    label: 'ISO 27001:2022',
    description: 'Statement of Applicability (SoA) und Umsetzungsstatus aller 93 Annex-A-Controls nach ISO/IEC 27001:2022 — Organisatorisch, Personell, Physisch, Technologisch.',
    icon: ShieldCheck,
    iconColor: 'text-green-600 dark:text-green-400',
    features: ['93 Annex-A-Controls (4 Themes)', 'Statement of Applicability (SoA)', 'Umsetzungsstatus & Begründung', 'Gap-Analyse & Fortschrittsübersicht'],
  },
  {
    key: 'bsi_grundschutz',
    label: 'BSI IT-Grundschutz',
    description: 'Anforderungsmanagement nach BSI IT-Grundschutz-Kompendium — Bausteine (ISMS, ORP, CON, OPS, DER, APP, SYS, NET, INF) mit Basis-, Standard- und Erhöhten-Anforderungen.',
    icon: BookOpen,
    iconColor: 'text-amber-600 dark:text-amber-400',
    features: ['Bausteine & Anforderungskatalog', 'Basis-, Standard- und Erhöhte Anforderungen', 'Umsetzungsstatus je Anforderung', 'Verantwortliche & Review-Fristen'],
  },
  {
    key: 'nis2',
    label: 'NIS-2 (EU 2022/2555)',
    description: 'Sicherheitsmaßnahmen nach Art. 21 NIS-2-Richtlinie und Meldepflichten nach Art. 23 — für wesentliche und wichtige Einrichtungen nach EU 2022/2555.',
    icon: AlertOctagon,
    iconColor: 'text-red-600 dark:text-red-400',
    features: ['10 Mindestmaßnahmen (Art. 21)', 'Meldepflichten Art. 23 (24h/72h/1 Monat)', 'Entitätsklassifizierung (wesentlich/wichtig)', 'Umsetzungsnachweis & Fristen'],
  },
  {
    key: 'c5',
    label: 'BSI C5:2026',
    description: 'BSI Cloud Computing Compliance Criteria Catalogue (C5:2026) — 174 Kriterien in 18 Domains für Cloud-Anbieter und deren Auftraggeber.',
    icon: Shield,
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    features: ['174 Kriterien (C5:2026)', '18 Domains (AM, IAM, OPS, CRY, DEV …)', 'Umsetzungsstatus & Nachweise', 'Gap-Analyse nach BSI-Testat-Vorbereitung'],
  },
  {
    key: 'mcp',
    label: 'Model Context Protocol (MCP)',
    description: 'KI-Integration — Stellt einen Model Context Protocol (MCP) Server auf /mcp zur Verfügung, über den KI-Assistenten wie Claude Assets abfragen, Risiken verwalten und Sicherheitsvorfälle anlegen können.',
    icon: Puzzle,
    iconColor: 'text-rose-600 dark:text-rose-400',
    features: ['MCP Server Endpoint (/mcp)', 'KI-Interaktion (Claude, Cursor etc.)', 'Lese- & Schreib-Tools', 'API-Token / MCP_SECRET Auth'],
  },
];

const ModulesSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const { modules, reload } = useModules();
  const [localModules, setLocalModules] = useState<Record<ModuleKey, boolean>>({ ...modules });
  const [savingKey, setSavingKey] = useState<ModuleKey | null>(null);
  const [lastSaved, setLastSaved] = useState<ModuleKey | null>(null);

  useEffect(() => { setLocalModules({ ...modules }); }, [modules]);

  const toggle = async (key: ModuleKey) => {
    const next = { ...localModules, [key]: !localModules[key] };
    setLocalModules(next);
    setSavingKey(key);
    setLastSaved(null);
    try {
      await api.put('/modules', next);
      await reload();
      setLastSaved(key);
      setTimeout(() => setLastSaved(k => k === key ? null : k), 2000);
    } catch {
      setLocalModules(prev => ({ ...prev, [key]: !prev[key] }));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Puzzle size={18} className="text-green-500" />
            <h2 className="font-semibold dark:text-white">{t('modules.title')}</h2>
          </div>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
            {t('modules.description')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MODULE_DEFS.map(mod => {
              const enabled = localModules[mod.key] ?? false;
              const isSaving = savingKey === mod.key;
              const isSaved = lastSaved === mod.key;
              return (
                <div
                  key={mod.key}
                  onClick={() => !isSaving && toggle(mod.key)}
                  className={`relative p-4 rounded-2xl border-2 transition-all select-none ${
                    isSaving ? 'cursor-wait opacity-80' : 'cursor-pointer'
                  } ${
                    enabled
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-900'
                  }`}
                >
                  {isSaved && (
                    <span className="absolute top-2 right-2 text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1 font-semibold">
                      <CheckCircle2 size={11} />{t('modules.saved')}
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`p-2 rounded-xl shrink-0 ${enabled ? 'bg-green-100 dark:bg-green-900/40' : 'bg-gray-100 dark:bg-slate-800'}`}>
                        <mod.icon size={20} className={enabled ? mod.iconColor : 'text-gray-400 dark:text-slate-500'} />
                      </div>
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm leading-tight ${enabled ? 'text-green-900 dark:text-green-100' : 'text-gray-700 dark:text-slate-300'}`}>
                          {t('modules_config.' + mod.key + '.label', { defaultValue: mod.label })}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-500 mt-0.5 leading-relaxed">{t('modules_config.' + mod.key + '.description', { defaultValue: mod.description })}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {mod.features.map((f, idx) => (
                            <span key={f} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              enabled ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-500'
                            }`}>{t('modules_config.' + mod.key + '.features.' + idx, { defaultValue: f })}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className={`shrink-0 w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-green-600' : 'bg-gray-300 dark:bg-slate-600'}`}>
                      {isSaving
                        ? <div className="w-5 h-5 mt-0.5 mx-auto rounded-full border-2 border-white border-t-transparent animate-spin" />
                        : <div className={`w-5 h-5 mt-0.5 rounded-full bg-white shadow transition-transform`} style={{ transform: enabled ? 'translateX(22px)' : 'translateX(2px)' }} />
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

// ---------------- LLM-Einstellungen ----------------
interface LlmProviderConfig { model?: string; baseUrl?: string; hasApiKey?: boolean; }
interface LlmConfig {
  provider: string;
  anthropic?: LlmProviderConfig;
  openai?: LlmProviderConfig;
  gemini?: LlmProviderConfig;
  ollama?: LlmProviderConfig;
}

const LlmSettings: React.FC = () => {
  const { t } = useTranslation('admin');
  const [cfg, setCfg] = useState<LlmConfig>({ provider: 'anthropic' });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get('/admin/llm').then(r => {
      if (r.data) setCfg(r.data);
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const payload: any = { provider: cfg.provider };
      for (const p of ['anthropic', 'openai', 'gemini', 'ollama'] as const) {
        const pc = cfg[p] || {};
        payload[p] = { model: pc.model || '' };
        if (p === 'openai' || p === 'ollama') payload[p].baseUrl = (pc as any).baseUrl || '';
        if (apiKeys[p]) payload[p].apiKey = apiKeys[p];
      }
      const r = await api.put('/admin/llm', payload);
      setCfg(r.data);
      setApiKeys({});
      setMsg({ ok: true, text: t('llm.saved') });
    } catch (e: any) {
      setMsg({ ok: false, text: e.response?.data?.error || t('llm.save_failed') });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      const r = await api.post('/admin/llm/test');
      setMsg({ ok: true, text: t('llm.test_ok', { provider: r.data.provider, model: r.data.model }) });
    } catch (e: any) {
      setMsg({ ok: false, text: t('llm.test_failed', { error: e.response?.data?.error || 'Unknown error' }) });
    } finally { setTesting(false); }
  };

  const providers = [
    { value: 'anthropic', label: t('llm.provider_anthropic') },
    { value: 'openai', label: t('llm.provider_openai') },
    { value: 'gemini', label: t('llm.provider_gemini') },
    { value: 'ollama', label: t('llm.provider_ollama') },
  ];

  const modelSuggestions: Record<string, string[]> = {
    anthropic: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
    gemini: ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
    ollama: ['llama3.2', 'llama3.1', 'mistral', 'qwen2.5', 'deepseek-r1'],
  };

  if (!loaded) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-blue-600" /></div>;

  const p = cfg.provider as keyof LlmConfig;
  const activeCfg = (cfg[p] as LlmProviderConfig) || {};
  const hasKey = activeCfg.hasApiKey || !!apiKeys[cfg.provider];

  return (
    <Card>
      <CardHeader><div className="flex items-center gap-2"><Bot size={18} className="text-blue-500" /><h2 className="font-semibold dark:text-white">{t('llm.title')}</h2></div></CardHeader>
      <CardBody className="space-y-6 max-w-2xl">
        <p className="text-sm text-gray-500 dark:text-slate-400">{t('llm.description')}</p>

        {!hasKey && cfg.provider !== 'ollama' && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{t('llm.no_key_warning')}</span>
          </div>
        )}

        <Select label={t('llm.provider_label')} value={cfg.provider}
          onChange={e => setCfg(c => ({ ...c, provider: e.target.value }))}>
          {providers.map(pr => <option key={pr.value} value={pr.value}>{pr.label}</option>)}
        </Select>

        <div className="border dark:border-slate-700 rounded-lg p-4 space-y-4">
          {cfg.provider !== 'ollama' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('llm.api_key')}</label>
              {activeCfg.hasApiKey && (
                <p className="text-xs text-green-600 dark:text-green-400 mb-1 flex items-center gap-1"><CheckCircle2 size={12} />{t('llm.api_key_set')}</p>
              )}
              <Input
                type="password"
                placeholder={activeCfg.hasApiKey ? '••••••••' : t('llm.api_key_placeholder')}
                value={apiKeys[cfg.provider] || ''}
                onChange={e => setApiKeys(k => ({ ...k, [cfg.provider]: e.target.value }))}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">{t('llm.model')}</label>
            <Input
              value={activeCfg.model || ''}
              onChange={e => setCfg(c => ({ ...c, [cfg.provider]: { ...activeCfg, model: e.target.value } }))}
              list={`model-suggestions-${cfg.provider}`}
              placeholder={modelSuggestions[cfg.provider]?.[0] || ''}
            />
            <datalist id={`model-suggestions-${cfg.provider}`}>
              {(modelSuggestions[cfg.provider] || []).map(m => <option key={m} value={m} />)}
            </datalist>
          </div>

          {(cfg.provider === 'ollama' || cfg.provider === 'openai') && (
            <div>
              <Input
                label={t('llm.base_url')}
                value={(activeCfg as any).baseUrl || ''}
                onChange={e => setCfg(c => ({ ...c, [cfg.provider]: { ...activeCfg, baseUrl: e.target.value } }))}
                placeholder={cfg.provider === 'ollama' ? 'http://localhost:11434' : t('llm.base_url_placeholder')}
              />
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">{t('llm.base_url_help')}</p>
            </div>
          )}
        </div>

        {msg && (
          <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${msg.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'}`}>
            {msg.ok ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : <XCircle size={15} className="shrink-0 mt-0.5" />}
            <span>{msg.text}</span>
          </div>
        )}

        <div className="flex gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin mr-1" />{t('llm.saving')}</> : t('save')}
          </Button>
          <Button variant="secondary" onClick={test} disabled={testing}>
            {testing ? <><Loader2 size={14} className="animate-spin mr-1" />{t('llm.testing')}</> : t('llm.test')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
};

// ---------------- Admin-Shell ----------------
export const Admin: React.FC = () => {
  const { t } = useTranslation('admin');
  const [tab, setTab] = useState<AdminTab>('users');
  const tabs: { key: AdminTab; label: string; icon: React.FC<any> }[] = [
    { key: 'users', label: 'Benutzer', icon: UsersIcon },
    { key: 'groups', label: 'Gruppen', icon: Tag },
    { key: 'modules', label: 'Module', icon: Puzzle },
    { key: 'audit', label: 'Audit Log', icon: History },
    { key: 'security', label: 'Sicherheit & SSO', icon: ShieldCheck },
    { key: 'smtp', label: 'E-Mail / SMTP', icon: Mail },
    { key: 'settings', label: 'Allgemein', icon: SettingsIcon },
    { key: 'rbac', label: 'Rollen & Rechte', icon: Lock },
    { key: 'api', label: 'API Dokumentation', icon: BookOpen },
    { key: 'backup', label: 'Backup & Restore', icon: Database },
    { key: 'llm', label: 'KI / LLM', icon: Bot },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold dark:text-white">{t('title')}</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm">{t('subtitle')}</p>
      </div>

      <div className="border-b border-gray-200 dark:border-slate-800">
        <nav className="flex gap-1 -mb-px overflow-x-auto no-scrollbar scroll-smooth">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === key ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 hover:border-gray-300'
              }`}>
              <Icon size={15} />{t('tabs.' + key, { defaultValue: label })}
            </button>
          ))}
          <div className="min-w-[20px] shrink-0 sm:hidden" /> {/* Spacer for mobile scroll end */}
        </nav>
      </div>

      {tab === 'users' && <Users />}
      {tab === 'groups' && <Groups />}
      {tab === 'modules' && <ModulesSettings />}
      {tab === 'audit' && <AuditLogPage />}
      {tab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="space-y-6">
            <OidcSettings />
            <CustomRolesEditor />
            <OidcMappingsEditor />
          </div>
          <div className="space-y-6">
            <SecuritySettings />
          </div>
        </div>
      )}
      {tab === 'smtp' && <SmtpSettings />}
      {tab === 'settings' && <GeneralSettings />}
      {tab === 'rbac' && <RbacEditor />}
      {tab === 'api' && <ApiDocs />}
      {tab === 'backup' && <BackupRestore />}
      {tab === 'llm' && <LlmSettings />}
    </div>
  );
};
