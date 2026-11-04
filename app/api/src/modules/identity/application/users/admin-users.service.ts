import type { UserRole } from '../../domain/types/user-role.types.js';
import type { UserStatus } from '../../domain/types/user-status.type.js';
import {
  InvalidAccountInputError,
  UserNotFoundError,
} from '../errors/users.errors.js';
import type {
  UserListQuery,
  AdminUserRepository,
} from '../ports/user.repository.js';
import {
  toUserProfileResult,
  type UserProfileResult,
} from './user-profile.result.js';

export interface UserListResult {
  users: UserProfileResult[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export class AdminUsersService {
  constructor(private readonly userRepository: AdminUserRepository) {}

  async list(query: UserListQuery): Promise<UserListResult> {
    if (
      !Number.isSafeInteger(query.page) ||
      query.page < 1 ||
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      !Number.isSafeInteger((query.page - 1) * query.limit) ||
      (query.page - 1) * query.limit > 2147483647 ||
      (query.q !== undefined &&
        (typeof query.q !== 'string' || query.q.length > 100)) ||
      (query.role !== undefined && !['USER', 'ADMIN'].includes(query.role)) ||
      (query.status !== undefined &&
        !['ACTIVE', 'LOCKED'].includes(query.status))
    ) {
      throw new InvalidAccountInputError('Invalid user search or pagination');
    }
    const result = await this.userRepository.list({
      ...query,
      q: query.q?.trim(),
    });
    return {
      users: result.users.map(toUserProfileResult),
      total: result.total,
      page: query.page,
      limit: query.limit,
      pages: Math.ceil(result.total / query.limit),
    };
  }

  async get(userId: string): Promise<UserProfileResult> {
    const user = await this.userRepository.findById(userId);
    if (!user) throw new UserNotFoundError();
    return toUserProfileResult(user);
  }

  async updateStatus(
    actorId: string,
    userId: string,
    status: UserStatus,
  ): Promise<UserProfileResult> {
    if (status !== 'ACTIVE' && status !== 'LOCKED') {
      throw new InvalidAccountInputError('Unsupported user status');
    }
    return toUserProfileResult(
      await this.userRepository.adminUpdate(actorId, userId, { status }),
    );
  }

  async updateRole(
    actorId: string,
    userId: string,
    role: UserRole,
  ): Promise<UserProfileResult> {
    if (role !== 'USER' && role !== 'ADMIN') {
      throw new InvalidAccountInputError('Unsupported user role');
    }
    return toUserProfileResult(
      await this.userRepository.adminUpdate(actorId, userId, { role }),
    );
  }

  async delete(actorId: string, userId: string): Promise<void> {
    await this.userRepository.adminUpdate(actorId, userId, { deleted: true });
  }
}
