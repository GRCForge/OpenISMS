import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.get('/auth/me')
        .then(r => setUser(r.data))
        .catch(err => {
          // Only drop the session on a genuine auth failure (401). Transient
          // errors like rate limiting (429), network blips or 5xx must NOT log
          // the user out — otherwise a single throttled request kills the session.
          if (err?.response?.status === 401) localStorage.removeItem('token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    setUser(data.user);
  };

  const loginWithToken = async (token: string) => {
    localStorage.setItem('token', token);
    setLoading(true);
    try {
      const r = await api.get('/auth/me');
      setUser(r.data);
    } catch (err: any) {
      // Keep the freshly issued token unless it was actually rejected (401);
      // a transient 429/5xx right after login must not discard the session.
      if (err?.response?.status === 401) localStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, loginWithToken, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
