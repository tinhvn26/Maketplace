import type { UserStatus } from '../types/user-status.type.js';

export interface User {
  id: string;
  fullName: string;
  emailNormalized: string;
  passwordHash: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}