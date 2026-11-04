import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../domain/entities/user.interface.js';
import {
  IncorrectPasswordError,
  InvalidAccountInputError,
  UserUnavailableError,
} from '../errors/users.errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { UserProfileRepository } from '../ports/user.repository.js';
import { UsersService } from './users.service.js';

function setup() {
  const user: User = {
    id: 'account-id',
    fullName: 'Customer',
    emailNormalized: 'customer@example.com',
    passwordHash: 'stored-secret-hash',
    avatarUrl: null,
    status: 'ACTIVE',
    role: 'USER',
    emailVerifiedAt: null,
    authVersion: 7,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const repository = {
    findById: vi
      .fn<UserProfileRepository['findById']>()
      .mockResolvedValue(user),
    findByEmail: vi.fn<UserProfileRepository['findByEmail']>(),
    updateProfile: vi.fn<UserProfileRepository['updateProfile']>(),
    changePassword: vi
      .fn<UserProfileRepository['changePassword']>()
      .mockResolvedValue(undefined),
    deleteOwnAccount: vi
      .fn<UserProfileRepository['deleteOwnAccount']>()
      .mockResolvedValue(undefined),
    changeEmail: vi
      .fn<UserProfileRepository['changeEmail']>()
      .mockResolvedValue(undefined),
  } satisfies UserProfileRepository;
  const hasher = {
    hash: vi.fn<PasswordHasher['hash']>().mockResolvedValue('new-secret-hash'),
    verify: vi.fn<PasswordHasher['verify']>().mockResolvedValue(true),
  };
  return {
    user,
    repository,
    hasher,
    service: new UsersService(repository, hasher),
  };
}

describe('UsersService credential changes', () => {
  it('checks the current password and passes the exact credential snapshot for an atomic change', async () => {
    const { user, repository, hasher, service } = setup();
    await service.changePassword(user.id, {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(hasher.verify).toHaveBeenCalledWith(
      'old-password',
      user.passwordHash,
    );
    expect(repository.changePassword).toHaveBeenCalledWith(user.id, {
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
      passwordHash: 'new-secret-hash',
    });
  });

  it('does not hash or persist a new password when current-password proof fails', async () => {
    const { user, repository, hasher, service } = setup();
    hasher.verify.mockResolvedValue(false);
    await expect(
      service.changePassword(user.id, {
        currentPassword: 'incorrect',
        newPassword: 'new-password',
      }),
    ).rejects.toBeInstanceOf(IncorrectPasswordError);
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(repository.changePassword).not.toHaveBeenCalled();
  });

  it.each(['short', 'x'.repeat(129)])(
    'rejects invalid replacement password length',
    async (newPassword) => {
      const { user, repository, service } = setup();
      await expect(
        service.changePassword(user.id, {
          currentPassword: 'old-password',
          newPassword,
        }),
      ).rejects.toBeInstanceOf(InvalidAccountInputError);
      expect(repository.changePassword).not.toHaveBeenCalled();
    },
  );

  it('rejects replacing a password with itself', async () => {
    const { user, repository, service } = setup();
    await expect(
      service.changePassword(user.id, {
        currentPassword: 'old-password',
        newPassword: 'old-password',
      }),
    ).rejects.toBeInstanceOf(InvalidAccountInputError);
    expect(repository.changePassword).not.toHaveBeenCalled();
  });

  it('accepts a current password at the Unicode character limit', async () => {
    const { user, repository, hasher, service } = setup();
    const currentPassword = '😀'.repeat(128);
    await service.changePassword(user.id, {
      currentPassword,
      newPassword: 'new-password',
    });
    expect(hasher.verify).toHaveBeenCalledWith(
      currentPassword,
      user.passwordHash,
    );
    expect(repository.changePassword).toHaveBeenCalledOnce();
  });

  it('requires current-password proof before deleting the account', async () => {
    const { user, repository, hasher, service } = setup();
    hasher.verify.mockResolvedValue(false);
    await expect(
      service.deleteAccount(user.id, 'wrong-password'),
    ).rejects.toBeInstanceOf(IncorrectPasswordError);
    expect(repository.deleteOwnAccount).not.toHaveBeenCalled();
    hasher.verify.mockResolvedValue(true);
    await service.deleteAccount(user.id, 'correct-password');
    expect(repository.deleteOwnAccount).toHaveBeenCalledWith(user.id, {
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
    });
  });

  it.each([{ status: 'LOCKED' as const }, { deletedAt: new Date() }])(
    'refuses credential operations for unavailable accounts: %j',
    async (change) => {
      const { user, repository, service } = setup();
      repository.findById.mockResolvedValue({ ...user, ...change });
      await expect(
        service.deleteAccount(user.id, 'password'),
      ).rejects.toBeInstanceOf(UserUnavailableError);
      await expect(
        service.changePassword(user.id, {
          currentPassword: 'password',
          newPassword: 'new-password',
        }),
      ).rejects.toBeInstanceOf(UserUnavailableError);
      expect(repository.changePassword).not.toHaveBeenCalled();
      expect(repository.deleteOwnAccount).not.toHaveBeenCalled();
    },
  );

  it('returns profile metadata without credential material', async () => {
    const { user, service } = setup();
    const profile = await service.getProfile(user.id);
    expect(profile).toMatchObject({ role: 'USER', emailVerifiedAt: null });
    expect(profile).not.toHaveProperty('passwordHash');
    expect(profile).not.toHaveProperty('authVersion');
  });
});
