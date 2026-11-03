export interface UserSecurityState {
  role: string;
  status: string;
  deletedAt: Date | null;
}

export interface AdministrativeChange {
  role?: string;
  status?: string;
  deleted?: boolean;
}

export function isActiveAdministrator(user: UserSecurityState | null): boolean {
  return (
    user !== null &&
    user.role === 'ADMIN' &&
    user.status === 'ACTIVE' &&
    user.deletedAt === null
  );
}

export function removesAdministratorAccess(
  change: AdministrativeChange,
): boolean {
  return (
    change.deleted === true ||
    change.status === 'LOCKED' ||
    change.role === 'USER'
  );
}

export function canRemoveAdministratorAccess(
  user: UserSecurityState,
  activeAdministratorCount: number,
): boolean {
  return !isActiveAdministrator(user) || activeAdministratorCount > 1;
}
