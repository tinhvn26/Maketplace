import type { User } from '../../domain/entities/user.interface.js';
import type { UserStatus } from '../../domain/types/user-status.type.js';
import type { UserRole } from '../../domain/types/user-role.types.js';

export interface UserProfileResult {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toUserProfileResult(user: User): UserProfileResult {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.emailNormalized,
    avatarUrl: user.avatarUrl,
    status: user.status,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
