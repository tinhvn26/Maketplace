import type { UserStatus } from '../../domain/types/user-status.type.js';
import type { UserRole } from '../../domain/types/user-role.types.js';
import type { UserProfileRecord } from './user-profile.record.js';

export interface UserProfileResult {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: Date | null;
  isEmailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toUserProfileResult(
  record: UserProfileRecord,
): UserProfileResult {
  const { user, avatarUrl, profileUpdatedAt } = record;
  const userUpdatedAt = user.updatedAt;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.emailNormalized,
    phoneNumber: user.phoneNumber,
    avatarUrl,
    status: user.status,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    isEmailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
    updatedAt:
      profileUpdatedAt && profileUpdatedAt.getTime() > userUpdatedAt.getTime()
        ? new Date(profileUpdatedAt)
        : userUpdatedAt,
  };
}
