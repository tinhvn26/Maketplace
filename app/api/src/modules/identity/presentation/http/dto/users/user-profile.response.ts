import type { UserStatus } from '../../../../domain/types/user-status.type.js';
import type { UserRole } from '../../../../domain/types/user-role.types.js';
import type { UserProfileResult } from '../../../../application/users/user-profile.result.js';

export interface UserProfileResponse {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  role: UserRole;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toUserProfileResponse(result: UserProfileResult): UserProfileResponse {
  return {
    id: result.id,
    fullName: result.fullName,
    email: result.email,
    avatarUrl: result.avatarUrl,
    status: result.status,
    role: result.role,
    emailVerifiedAt: result.emailVerifiedAt?.toISOString() ?? null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}
