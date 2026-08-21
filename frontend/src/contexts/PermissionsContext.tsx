import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

/**
 * The effective permission matrix for the logged-in user, as the backend resolves
 * it (global matrix projected through the role, or the custom role's own matrix).
 *
 * Until this existed the UI decided visibility from hardcoded role lists while the
 * API decided from the matrix, so editing the matrix moved the API and left the UI
 * behind: buttons that lead straight to a 403, or features hidden from someone who
 * is allowed to use them.
 *
 * This is presentation only. Authorisation is decided server-side on every
 * request — hiding a button is a courtesy, never a control.
 */
export type PermissionMatrix = Record<string, Record<string, boolean>>;

interface PermissionsContextType {
  permissions: PermissionMatrix;
  loading: boolean;
  /**
   * Mirrors the backend's requirePermission contract: the matrix decides where it
   * defines module.action, and where it says nothing the caller's own fallback
   * does — which is the role check that site used before. Passing no fallback
   * means "hide it when the matrix is silent".
   */
  can: (module: string, action: string, fallback?: boolean) => boolean;
  reload: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType>({
  permissions: {},
  loading: false,
  can: (_m, _a, fallback = false) => fallback,
  reload: async () => {},
});

export const PermissionsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<PermissionMatrix>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const r = await api.get('/me/permissions');
      setPermissions(r.data?.permissions || {});
    } catch {
      // A failed load must not lock the UI down: every call then falls back to
      // the role check it carried before, and the API still refuses what it
      // should. Silently hiding half the app on a network blip would be worse.
      setPermissions({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      reload();
    } else {
      setPermissions({});
      setLoading(false);
    }
  }, [user, reload]);

  const can = useCallback((module: string, action: string, fallback = false) => {
    const entry = permissions?.[module]?.[action];
    return typeof entry === 'boolean' ? entry : fallback;
  }, [permissions]);

  return (
    <PermissionsContext.Provider value={{ permissions, loading, can, reload }}>
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = () => useContext(PermissionsContext);
