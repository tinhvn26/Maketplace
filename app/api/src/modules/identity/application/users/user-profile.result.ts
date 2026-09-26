import type { UserStatus } from '../../domain/types/user-status.type.js';

export interface UserProfileResult {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
