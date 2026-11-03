import type { UserStatus } from '../types/user-status.type.js';
import type { UserRole } from '../types/user-role.types.js';

export interface User {
  id: string;
  fullName: string;
  emailNormalized: string;
  passwordHash: string;
  avatarUrl: string | null;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: Date | null;
  authVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
