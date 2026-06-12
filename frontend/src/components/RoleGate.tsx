import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';

// Schützt Routen vor unberechtigten Rollen: Nav blendet sie aus,
// aber direkte URL-Aufrufe sollen ebenfalls ins Dashboard umleiten.
export const RoleGate: React.FC<{ roles: UserRole[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
};
