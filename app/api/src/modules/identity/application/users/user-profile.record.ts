import type { User } from '../../domain/entities/user.interface.js';

/** Profile data is composed with the account only at the read boundary. */
export interface UserProfileRecord {
  user: User;
  avatarUrl: string | null;
  profileUpdatedAt: Date | null;
}

export interface UserProfileDetails {
  avatarUrl: string | null;
}
