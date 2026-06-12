import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

export type ModuleKey = 'dsgvo' | 'tisax' | 'dora' | 'ai_act' | 'bcm' | 'pentest' | 'discovery' | 'iso27001' | 'bsi_grundschutz' | 'nis2' | 'c5' | 'mcp';

interface ModulesContextType {
  modules: Record<ModuleKey, boolean>;
  loading: boolean;
  isEnabled: (key: ModuleKey) => boolean;
  reload: () => Promise<void>;
}

const DEFAULTS: Record<ModuleKey, boolean> = {
  dsgvo: true, tisax: false, dora: false, ai_act: false, bcm: false, pentest: false, discovery: true,
  iso27001: false, bsi_grundschutz: false, nis2: false, c5: false, mcp: true,
};

const ModulesContext = createContext<ModulesContextType>({
  modules: DEFAULTS,
  loading: false,
  isEnabled: () => false,
  reload: async () => {},
});

export const ModulesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [modules, setModules] = useState<Record<ModuleKey, boolean>>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const r = await api.get('/modules');
      setModules({ ...DEFAULTS, ...r.data });
    } catch {
      setModules({ ...DEFAULTS });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      reload();
    } else {
      setLoading(false);
      setModules({ ...DEFAULTS });
    }
  }, [user?.id]);

  const isEnabled = (key: ModuleKey) => modules[key] ?? false;

  return (
    <ModulesContext.Provider value={{ modules, loading, isEnabled, reload }}>
      {children}
    </ModulesContext.Provider>
  );
};

export const useModules = () => useContext(ModulesContext);
