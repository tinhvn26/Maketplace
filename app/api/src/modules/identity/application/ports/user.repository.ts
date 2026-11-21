import type { User } from '../../domain/entities/user.interface.js';
import type { UserRole } from '../../domain/types/user-role.types.js';
import type { UserStatus } from '../../domain/types/user-status.type.js';
import type { UpdateProfileInput } from '../users/update-profile.input.js';
import type {
  UserProfileDetails,
  UserProfileRecord,
} from '../users/user-profile.record.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserListQuery {
  page: number;
  limit: number;
  q?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface CredentialSnapshot {
  expectedPasswordHash: string;
  expectedAuthVersion: number;
}

export type AdminUserChange =
  | { status: UserStatus; role?: never; deleted?: never }
  | { role: UserRole; status?: never; deleted?: never }
  | { deleted: true; status?: never; role?: never };

export interface UserReader {
  findById(id: string): Promise<User | null>;
  findByEmail(emailNormalized: string): Promise<User | null>;
}

export interface AuthUserRepository extends Pick<UserReader, 'findByEmail'> {
  /** Account and profile must be created in one transaction. */
  create(user: User, profile: UserProfileDetails): Promise<UserProfileRecord>;
}

export interface UserProfileReader {
  findProfileById(id: string): Promise<UserProfileRecord | null>;
}

export interface UserProfileRepository extends UserReader, UserProfileReader {
  /** Updates only an active, nondeleted user; returns null otherwise. */
  updateProfile(
    id: string,
    changes: UpdateProfileInput,
  ): Promise<UserProfileRecord | null>;
  /** Verify the snapshot and revoke every session atomically with the change. */
  changePassword(
    id: string,
    change: CredentialSnapshot & { passwordHash: string },
  ): Promise<void>;
  /** Changes email atomically, preserving only the requesting active session. */
  changeEmail(
    id: string,
    change: CredentialSnapshot & { emailNormalized: string; sessionId: string },
  ): Promise<void>;
  deleteOwnAccount(id: string, snapshot: CredentialSnapshot): Promise<void>;
}

export interface AdminUserRepository extends UserProfileReader {
  list(
    query: UserListQuery,
  ): Promise<{ users: UserProfileRecord[]; total: number }>;
  /** Rechecks actor privileges and preserves at least one active administrator. */
  adminUpdate(
    actorId: string,
    id: string,
    change: AdminUserChange,
  ): Promise<UserProfileRecord>;
}

/** Aggregate contract for persistence adapters; consumers depend on narrower ports. */
export interface UserRepository
  extends
    UserReader,
    AuthUserRepository,
    UserProfileRepository,
    AdminUserRepository {}
