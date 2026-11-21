import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../domain/entities/user.interface.js';
import {
  EmailAlreadyExistsError,
  InvalidFullNameError,
} from '../errors/auth.errors.js';
import {
  IncorrectPasswordError,
  EmptyProfileUpdateError,
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
    phoneNumber: null,
    status: 'ACTIVE',
    role: 'CUSTOMER',
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
    findProfileById: vi
      .fn<UserProfileRepository['findProfileById']>()
      .mockResolvedValue({ user, avatarUrl: null, profileUpdatedAt: null }),
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
      const { user, repository, hasher, service } = setup();
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
      await expect(
        service.changeEmail(user.id, {
          currentPassword: 'password',
          newEmail: 'new@example.com',
          sessionId: 'session-id',
        }),
      ).rejects.toBeInstanceOf(UserUnavailableError);
      expect(hasher.verify).not.toHaveBeenCalled();
      expect(hasher.hash).not.toHaveBeenCalled();
      expect(repository.changePassword).not.toHaveBeenCalled();
      expect(repository.changeEmail).not.toHaveBeenCalled();
      expect(repository.deleteOwnAccount).not.toHaveBeenCalled();
    },
  );

  it('returns profile metadata without credential material', async () => {
    const { user, service } = setup();
    const profile = await service.getProfile(user.id);
    expect(profile).toMatchObject({ role: 'CUSTOMER', emailVerifiedAt: null });
    expect(profile).not.toHaveProperty('passwordHash');
    expect(profile).not.toHaveProperty('authVersion');
  });

  it('uses the latest profile timestamp without attaching avatar data to the account', async () => {
    const { user, repository, service } = setup();
    const profileUpdatedAt = new Date(user.updatedAt.getTime() + 1000);
    repository.findProfileById.mockResolvedValue({
      user,
      avatarUrl: 'https://example.com/avatar.png',
      profileUpdatedAt,
    });
    const profile = await service.getProfile(user.id);
    expect(profile.avatarUrl).toBe('https://example.com/avatar.png');
    expect(profile.updatedAt).toEqual(profileUpdatedAt);
    expect(profile.updatedAt).not.toBe(profileUpdatedAt);
    expect(user).not.toHaveProperty('avatarUrl');
  });

  it.each(['invalid-number', '123456', '+1234567890123456'])(
    'rejects an invalid phone before persisting any profile fields: %s',
    async (phoneNumber) => {
      const { user, repository, service } = setup();
      await expect(
        service.updateProfile(user.id, {
          fullName: 'Updated Name',
          phoneNumber,
          avatarUrl: 'https://example.com/avatar.png',
        }),
      ).rejects.toBeInstanceOf(InvalidAccountInputError);
      expect(repository.updateProfile).not.toHaveBeenCalled();
    },
  );

  it('requires current-password proof before checking or changing the email address', async () => {
    const { user, repository, hasher, service } = setup();
    hasher.verify.mockResolvedValue(false);
    await expect(
      service.changeEmail(user.id, {
        currentPassword: 'wrong-password',
        newEmail: 'new@example.com',
        sessionId: 'session-id',
      }),
    ).rejects.toBeInstanceOf(IncorrectPasswordError);
    expect(repository.findByEmail).not.toHaveBeenCalled();
    expect(repository.changeEmail).not.toHaveBeenCalled();
  });

  it('normalizes an email change and binds the requesting session to the verified credential snapshot', async () => {
    const { user, repository, hasher, service } = setup();
    repository.findByEmail.mockResolvedValue(null);
    await service.changeEmail(user.id, {
      currentPassword: 'correct-password',
      newEmail: '  NEW@Example.com  ',
      sessionId: 'session-to-preserve',
    });
    expect(hasher.verify).toHaveBeenCalledWith(
      'correct-password',
      user.passwordHash,
    );
    expect(repository.findByEmail).toHaveBeenCalledWith('new@example.com');
    expect(repository.changeEmail).toHaveBeenCalledWith(user.id, {
      emailNormalized: 'new@example.com',
      sessionId: 'session-to-preserve',
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
    });
    expect(user.emailNormalized).toBe('customer@example.com');
    expect(user.authVersion).toBe(7);
  });

  it.each(['not-an-email', '  CUSTOMER@EXAMPLE.COM  '])(
    'rejects an invalid or unchanged email before reserving it: %s',
    async (newEmail) => {
      const { user, repository, service } = setup();
      await expect(
        service.changeEmail(user.id, {
          currentPassword: 'correct-password',
          newEmail,
          sessionId: 'session-id',
        }),
      ).rejects.toBeInstanceOf(InvalidAccountInputError);
      expect(repository.findByEmail).not.toHaveBeenCalled();
      expect(repository.changeEmail).not.toHaveBeenCalled();
    },
  );

  it('refuses an email already belonging to another account', async () => {
    const { user, repository, service } = setup();
    repository.findByEmail.mockResolvedValue({
      ...user,
      id: 'other-user',
      emailNormalized: 'taken@example.com',
    });
    await expect(
      service.changeEmail(user.id, {
        currentPassword: 'correct-password',
        newEmail: 'taken@example.com',
        sessionId: 'session-id',
      }),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
    expect(repository.changeEmail).not.toHaveBeenCalled();
  });
});

describe('UsersService profile changes', () => {
  it('normalizes name and phone together without forwarding privileged or unknown fields', async () => {
    const { user, repository, hasher, service } = setup();
    repository.updateProfile.mockResolvedValue({
      user: { ...user, fullName: 'Nguyễn Văn An', phoneNumber: '+84901234567' },
      avatarUrl: 'https://example.com/avatar.png',
      profileUpdatedAt: null,
    });
    const changes = {
      fullName: '  Nguyễn Văn An  ',
      phoneNumber: '  +84901234567  ',
      avatarUrl: 'https://example.com/avatar.png',
      role: 'ADMIN',
      status: 'LOCKED',
      emailNormalized: 'injected@example.com',
      passwordHash: 'injected-hash',
      authVersion: 0,
    };
    const result = await service.updateProfile(user.id, changes);
    expect(repository.updateProfile).toHaveBeenCalledWith(user.id, {
      fullName: 'Nguyễn Văn An',
      phoneNumber: '+84901234567',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(result).toMatchObject({
      fullName: 'Nguyễn Văn An',
      phoneNumber: '+84901234567',
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('authVersion');
    expect(hasher.hash).not.toHaveBeenCalled();
    expect(user.authVersion).toBe(7);
  });

  it('preserves omitted fields and passes explicit null to clear optional profile data', async () => {
    const { user, repository, service } = setup();
    repository.updateProfile.mockResolvedValue({
      user,
      avatarUrl: null,
      profileUpdatedAt: null,
    });
    await service.updateProfile(user.id, {
      phoneNumber: null,
      avatarUrl: null,
    });
    expect(repository.updateProfile).toHaveBeenLastCalledWith(user.id, {
      phoneNumber: null,
      avatarUrl: null,
    });
    await service.updateProfile(user.id, { fullName: 'Only Name' });
    expect(repository.updateProfile).toHaveBeenLastCalledWith(user.id, {
      fullName: 'Only Name',
    });
  });

  it('rejects an empty update and invalid name before any persistence', async () => {
    const { user, repository, service } = setup();
    await expect(service.updateProfile(user.id, {})).rejects.toBeInstanceOf(
      EmptyProfileUpdateError,
    );
    await expect(
      service.updateProfile(user.id, { fullName: ' \n ' }),
    ).rejects.toBeInstanceOf(InvalidFullNameError);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it.each([null, { status: 'LOCKED' as const }, { deletedAt: new Date() }])(
    'rejects unavailable profile reads: %j',
    async (change) => {
      const { user, repository, service } = setup();
      repository.findProfileById.mockResolvedValue(
        change === null
          ? null
          : {
              user: { ...user, ...change },
              avatarUrl: null,
              profileUpdatedAt: null,
            },
      );
      await expect(service.getProfile(user.id)).rejects.toBeInstanceOf(
        UserUnavailableError,
      );
    },
  );

  it('treats an active-account check that fails inside update persistence as unavailable', async () => {
    const { user, repository, service } = setup();
    repository.updateProfile.mockResolvedValue(null);
    await expect(
      service.updateProfile(user.id, { phoneNumber: null }),
    ).rejects.toBeInstanceOf(UserUnavailableError);
  });
});
