import React from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import type { UserRole } from '../types';
import { hasRole } from '../lib/permissions';

// Schützt Routen vor unberechtigten Rollen: Nav blendet sie aus,
// aber direkte URL-Aufrufe sollen ebenfalls ins Dashboard umleiten.
export const RoleGate: React.FC<{ roles: UserRole[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  // Any of the user's roles (they come from groups) qualifies.
  if (!user || !hasRole(user, roles)) return <Navigate to="/" replace />;
  return <>{children}</>;
};
