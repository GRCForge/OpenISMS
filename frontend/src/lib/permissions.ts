import type { User, UserRole } from '../types';

// Since v3.10.0 roles reach a user through groups and a user can hold several
// (`user.roles`). `user.role` is the most privileged of them, kept for display.
// These helpers ask the same question the backend asks: does ANY role qualify?
// Presentation only — the server decides on every request.

const READ_ONLY_ROLES: UserRole[] = ['viewer', 'management', 'employee'];

type MaybeUser = Pick<User, 'role' | 'roles'> | null | undefined;

export const userRoles = (user: MaybeUser): UserRole[] => {
  if (!user) return [];
  if (Array.isArray(user.roles)) return user.roles;
  return user.role && user.role !== 'none' ? [user.role] : [];
};

/** True if the user holds at least one of the given roles. */
export const hasRole = (user: MaybeUser, ...roles: (UserRole | readonly UserRole[] | string | readonly string[])[]): boolean => {
  const own = userRoles(user) as string[];
  return roles.flat().some((r) => own.includes(r as string));
};

/** True if the user holds no role outside the given set (e.g. "only an employee"). */
export const onlyRoles = (user: MaybeUser, ...roles: (UserRole | readonly UserRole[])[]): boolean => {
  const set = new Set<string>(roles.flat() as string[]);
  return userRoles(user).every((r) => set.has(r));
};

/** A user may write as soon as one role may; no role at all is read-only. */
export const hasWriteAccess = (user: MaybeUser): boolean => {
  const roles = userRoles(user);
  return roles.length > 0 && roles.some((r) => !READ_ONLY_ROLES.includes(r));
};
