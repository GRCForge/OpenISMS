import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

export const AuthCallback: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithToken } = useAuth();

  useEffect(() => {
    const code = params.get('code');
    if (code) {
      api.get(`/auth/oidc/exchange?code=${encodeURIComponent(code)}`)
        .then(async r => {
          await loginWithToken(r.data.token);
          navigate('/', { replace: true });
        })
        .catch(() => navigate('/login?error=sso', { replace: true }));
    } else {
      navigate('/login?error=sso', { replace: true });
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
};
