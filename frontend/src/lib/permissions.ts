import type { UserRole } from '../types';

const READ_ONLY_ROLES: UserRole[] = ['viewer', 'management', 'employee'];

export const hasWriteAccess = (role?: UserRole) => !!role && !READ_ONLY_ROLES.includes(role);
