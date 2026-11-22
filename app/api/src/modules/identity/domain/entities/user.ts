import type { UserRole } from '../types/user-role.type.js';
import type { UserStatus } from '../types/user-status.type.js';

export interface User {
  id: string;
  fullName: string;
  emailNormalized: string;
  passwordHash: string;
  phoneNumber: string | null;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: Date | null;
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export function isUserDeleted(user: User): boolean {
  return user.deletedAt !== null;
}

export function isUserActive(user: User): boolean {
  return user.status === 'ACTIVE' && user.deletedAt === null;
}
