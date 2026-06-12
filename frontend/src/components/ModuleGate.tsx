import React from 'react';
import { Navigate } from 'react-router-dom';
import { useModules } from '../contexts/ModulesContext';
import type { ModuleKey } from '../contexts/ModulesContext';

// Schützt Routen deaktivierter Module: Nav blendet sie aus,
// aber direkte URL-Aufrufe sollen ebenfalls ins Dashboard umleiten.
export const ModuleGate: React.FC<{ module: ModuleKey; children: React.ReactNode }> = ({ module, children }) => {
  const { isEnabled, loading } = useModules();
  if (loading) return null;
  if (!isEnabled(module)) return <Navigate to="/" replace />;
  return <>{children}</>;
};
