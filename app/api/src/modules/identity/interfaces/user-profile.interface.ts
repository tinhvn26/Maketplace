import type { UserStatus } from '../types/user-status.type.js';

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}