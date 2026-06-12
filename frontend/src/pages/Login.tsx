import React, { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Smartphone, Fingerprint } from 'lucide-react';
import { IsmsLogo } from '../components/IsmsLogo';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { startAuthentication } from '../lib/webauthn';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

export const Login: React.FC = () => {
  const { user, login, loginWithToken } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoName, setSsoName] = useState('Single Sign-On');
  const [passkeySupported, setPasskeySupported] = useState(false);

  // TOTP 2FA
  const [totpPending, setTotpPending] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    api.get('/auth/oidc/status').then(r => { setSsoEnabled(r.data.ssoEnabled); if (r.data.name) setSsoName(r.data.name); }).catch(() => {});
    const ssoErr = params.get('error');
    if (ssoErr === 'sso') setError('Single-Sign-On-Anmeldung fehlgeschlagen.');
    else if (ssoErr === 'sso_session') setError('SSO-Sitzung ging beim Rücksprung verloren. Prüfen Sie, dass APP_URL exakt der aufgerufenen Domain entspricht und Cookies erlaubt sind.');
    // Check browser passkey support
    if (window.PublicKeyCredential) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(setPasskeySupported).catch(() => {});
    }
  }, []);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.requires_totp) {
        setTempToken(data.temp_token);
        setTotpPending(true);
      } else {
        await login(email, password);
      }
    } catch {
      setError('Ungültige Anmeldedaten');
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login/totp', { temp_token: tempToken, token: totpCode });
      loginWithToken(data.token);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ungültiger Code');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const optionsRes = await api.post('/auth/passkey/login-options', { email: email || undefined });
      const assertion = await startAuthentication(optionsRes.data);
      const verifyRes = await api.post('/auth/passkey/login-verify', assertion);
      loginWithToken(verifyRes.data.token);
    } catch (err: any) {
      if (err.message?.includes('abgebrochen')) {
        setError('');
      } else {
        setError(err.response?.data?.error || err.message || 'Passkey-Anmeldung fehlgeschlagen');
      }
    } finally {
      setLoading(false);
    }
  };

  if (totpPending) {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-900 to-slate-700 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 w-full max-w-md p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-full mb-4"><Smartphone className="text-blue-600 dark:text-blue-400" size={32} /></div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Zwei-Faktor-Authentifizierung</h1>
            <p className="text-gray-500 dark:text-slate-400 text-sm mt-1 text-center">Bitte gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
          </div>
          <form onSubmit={handleTotpSubmit} className="space-y-4">
            <Input
              label="TOTP-Code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              placeholder="123456"
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}
            <Button type="submit" className="w-full justify-center" disabled={loading || totpCode.length !== 6}>
              {loading ? 'Prüfen...' : 'Bestätigen'}
            </Button>
            <button type="button" onClick={() => { setTotpPending(false); setTotpCode(''); setError(''); }} className="w-full text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 transition-colors">
              ← Zurück zur Anmeldung
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 to-slate-700 flex flex-col items-center justify-center p-4 gap-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <IsmsLogo size={80} className="rounded-2xl shadow-xl shadow-blue-500/20 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">OpenISMS</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">Information Security Management System</p>
        </div>

        {ssoEnabled && (
          <>
            <a href="/api/auth/oidc/login" className="flex items-center justify-center gap-3 w-full border border-gray-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors mb-2">
              <KeyRound size={18} className="text-blue-600 dark:text-blue-400" />
              {ssoName}
            </a>
          </>
        )}

        {passkeySupported && (
          <button
            onClick={handlePasskeyLogin}
            disabled={loading}
            className="flex items-center justify-center gap-3 w-full border border-gray-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors mb-2"
          >
            <Fingerprint size={18} className="text-green-600 dark:text-green-400" />
            Mit Passkey anmelden
          </button>
        )}

        {(ssoEnabled || passkeySupported) && (
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
            <span className="text-xs text-gray-400 dark:text-slate-500">oder mit Passwort</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-slate-700" />
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="E-Mail" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          <Input label="Passwort" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}
          <Button type="submit" className="w-full justify-center" disabled={loading}>
            {loading ? 'Anmelden...' : 'Anmelden'}
          </Button>
        </form>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 font-mono">
        © 2026 Maximilian Herz · OpenISMS
      </p>
    </div>
  );
};
