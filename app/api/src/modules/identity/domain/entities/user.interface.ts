import type { UserRole } from '../types/user-role.types.js';
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
