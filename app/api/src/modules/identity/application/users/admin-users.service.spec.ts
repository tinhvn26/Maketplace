import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../domain/entities/user.interface.js';
import type { UserRole } from '../../domain/types/user-role.types.js';
import type { UserStatus } from '../../domain/types/user-status.type.js';
import {
  AdminRequiredError,
  InvalidAccountInputError,
  LastAdminError,
  UserNotFoundError,
} from '../errors/users.errors.js';
import type {
  AdminUserRepository,
  UserListQuery,
} from '../ports/user.repository.js';
import { AdminUsersService } from './admin-users.service.js';

function setup() {
  const user: User = {
    id: 'target-account',
    fullName: 'Customer',
    emailNormalized: 'customer@example.com',
    passwordHash: 'private-hash',
    phoneNumber: '+84901234567',
    status: 'ACTIVE',
    role: 'CUSTOMER',
    emailVerifiedAt: null,
    authVersion: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const profile = { user, avatarUrl: null, profileUpdatedAt: null };
  const repository = {
    findProfileById: vi
      .fn<AdminUserRepository['findProfileById']>()
      .mockResolvedValue(profile),
    list: vi
      .fn<AdminUserRepository['list']>()
      .mockResolvedValue({ users: [profile], total: 21 }),
    adminUpdate: vi
      .fn<AdminUserRepository['adminUpdate']>()
      .mockResolvedValue(profile),
  } satisfies AdminUserRepository;
  return { user, repository, service: new AdminUsersService(repository) };
}

describe('AdminUsersService', () => {
  it('keeps authority-sensitive status, role and deletion intents behind the atomic repository port', async () => {
    const { user, repository, service } = setup();
    const result = await service.updateStatus(
      'current-actor',
      user.id,
      'LOCKED',
    );
    expect(repository.adminUpdate).toHaveBeenLastCalledWith(
      'current-actor',
      user.id,
      { status: 'LOCKED' },
    );
    await service.updateRole('current-actor', user.id, 'ADMIN');
    expect(repository.adminUpdate).toHaveBeenLastCalledWith(
      'current-actor',
      user.id,
      { role: 'ADMIN' },
    );
    expect(await service.delete('current-actor', user.id)).toBeUndefined();
    expect(repository.adminUpdate).toHaveBeenLastCalledWith(
      'current-actor',
      user.id,
      { deleted: true },
    );
    expect(result).toMatchObject({
      id: user.id,
      phoneNumber: '+84901234567',
      isEmailVerified: false,
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('authVersion');
    expect(user.authVersion).toBe(5);
    expect(user.role).toBe('CUSTOMER');
    expect(user.status).toBe('ACTIVE');
  });

  it.each([
    'USER',
    'EMPLOYEE',
    'SELLER',
    'admin',
    'ADMIN ',
    null,
    undefined,
    {},
  ])('rejects unsupported role intent before persistence: %j', async (role) => {
    const { user, repository, service } = setup();
    await expect(
      service.updateRole('actor', user.id, role as UserRole),
    ).rejects.toBeInstanceOf(InvalidAccountInputError);
    expect(repository.adminUpdate).not.toHaveBeenCalled();
  });

  it.each(['CUSTOMER', 'EMPLOYER', 'ADMIN'] as const)(
    'accepts %s role assignment and filtering without treating it as administrator authority',
    async (role) => {
      const { user, repository, service } = setup();
      repository.adminUpdate.mockResolvedValue({
        user: { ...user, role },
        avatarUrl: null,
        profileUpdatedAt: null,
      });
      const result = await service.updateRole('actual-admin', user.id, role);
      expect(result.role).toBe(role);
      expect(repository.adminUpdate).toHaveBeenCalledWith(
        'actual-admin',
        user.id,
        { role },
      );
      await service.list({ page: 1, limit: 20, role });
      expect(repository.list).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        role,
        q: undefined,
      });
    },
  );

  it.each(['INACTIVE', 'locked', true, null, undefined])(
    'rejects unsupported status intent before persistence: %j',
    async (status) => {
      const { user, repository, service } = setup();
      await expect(
        service.updateStatus('actor', user.id, status as UserStatus),
      ).rejects.toBeInstanceOf(InvalidAccountInputError);
      expect(repository.adminUpdate).not.toHaveBeenCalled();
    },
  );

  it('preserves repository failures for revoked administrator access and the last active administrator', async () => {
    const { user, repository, service } = setup();
    const authorityError = new AdminRequiredError();
    repository.adminUpdate.mockRejectedValueOnce(authorityError);
    await expect(
      service.updateRole('demoted-actor', user.id, 'ADMIN'),
    ).rejects.toBe(authorityError);
    const lastAdminError = new LastAdminError();
    repository.adminUpdate.mockRejectedValueOnce(lastAdminError);
    await expect(service.updateStatus('actor', user.id, 'LOCKED')).rejects.toBe(
      lastAdminError,
    );
    expect(repository.adminUpdate).toHaveBeenCalledTimes(2);
  });

  it('normalizes Unicode searches at the same character boundary as HTTP validation', async () => {
    const { repository, service } = setup();
    const q = '🙂'.repeat(100);
    const result = await service.list({ page: 2, limit: 20, q: `  ${q}  ` });
    expect(repository.list).toHaveBeenCalledWith({ page: 2, limit: 20, q });
    expect(result).toMatchObject({ total: 21, page: 2, limit: 20, pages: 2 });
    expect(result.users[0]).not.toHaveProperty('passwordHash');
    expect(result.users[0]).not.toHaveProperty('authVersion');
    await service.list({ page: 1, limit: 20, q: '   ' });
    expect(repository.list).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      q: '',
    });
  });

  it.each([
    { page: 0 },
    { limit: 0 },
    { limit: 101 },
    { page: Number.MAX_SAFE_INTEGER },
    { q: '🙂'.repeat(101) },
    { q: 123 },
    { role: 'SELLER' },
    { status: 'INACTIVE' },
  ])(
    'rejects invalid administrative searches before persistence: %j',
    async (change) => {
      const { repository, service } = setup();
      const query = { page: 1, limit: 20, ...change } as UserListQuery;
      await expect(service.list(query)).rejects.toBeInstanceOf(
        InvalidAccountInputError,
      );
      expect(repository.list).not.toHaveBeenCalled();
    },
  );

  it('reports an absent profile rather than projecting an unavailable account', async () => {
    const { repository, service } = setup();
    repository.findProfileById.mockResolvedValue(null);
    await expect(service.get('missing-account')).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });
});
