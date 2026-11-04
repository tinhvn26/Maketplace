import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../domain/entities/user.interface.js';
import { EmailAlreadyExistsError } from '../errors/auth.errors.js';
import type { UserReader } from '../ports/user.repository.js';
import type { AccountActionMessageBuilder } from '../ports/account-action-message-builder.js';
import {
  IncorrectAccountPasswordError,
  InvalidAccountActionError,
  InvalidAccountPasswordError,
  InvalidEmailChangeError,
} from '../errors/account-actions.errors.js';
import { AccountActionsService } from './account-actions.service.js';

const resetOtpSecret = 'test-reset-otp-secret-at-least-32-bytes';
const otp = '012345';

function challenge(email = 'user@example.com', id = 'action-1') {
  return {
    id,
    tokenHash: createHmac('sha256', resetOtpSecret)
      .update(
        JSON.stringify(['marketplate:password-reset:otp:v1', id, email, otp]),
      )
      .digest('hex'),
  };
}

function fixture(overrides: Partial<User> = {}) {
  const user: User = {
    id: 'user-1',
    fullName: 'A User',
    emailNormalized: 'user@example.com',
    passwordHash: 'existing-hash',
    avatarUrl: null,
    status: 'ACTIVE',
    role: 'USER',
    emailVerifiedAt: null,
    authVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  const users = {
    findById: vi
      .fn<(id: string) => Promise<User | null>>()
      .mockResolvedValue(user),
    findByEmail: vi
      .fn<(email: string) => Promise<User | null>>()
      .mockResolvedValue(user),
  } satisfies UserReader;
  const passwords = {
    hash: vi
      .fn<(password: string) => Promise<string>>()
      .mockResolvedValue('new-hash'),
    verify: vi
      .fn<(password: string, hash: string) => Promise<boolean>>()
      .mockResolvedValue(true),
  };
  const actions = {
    queue: vi.fn().mockResolvedValue(true),
    isValid: vi.fn().mockResolvedValue(true),
    claimPasswordResetAttempt: vi.fn().mockResolvedValue(challenge()),
    verifyEmail: vi.fn().mockResolvedValue(undefined),
    resetPassword: vi.fn().mockResolvedValue(undefined),
    changeEmail: vi.fn().mockResolvedValue(undefined),
  };
  const message = { subject: 'Rendered subject', text: 'Rendered message' };
  const messages = {
    build: vi
      .fn<AccountActionMessageBuilder['build']>()
      .mockReturnValue(message),
  } satisfies AccountActionMessageBuilder;
  const service = new AccountActionsService(
    users,
    passwords,
    actions,
    { resetOtpSecret },
    messages,
  );
  return { user, users, passwords, actions, messages, message, service };
}

describe('AccountActionsService', () => {
  it('queues the rendered OTP message with an account-bound keyed hash and a 15-minute lifetime', async () => {
    const { actions, users, messages, message, service } = fixture();
    await expect(
      service.requestPasswordReset(' USER@EXAMPLE.COM '),
    ).resolves.toBeUndefined();
    expect(users.findByEmail).toHaveBeenCalledWith('user@example.com');
    const input = actions.queue.mock.calls[0][0];
    const sentOtp = messages.build.mock.calls[0][0].token;
    expect(sentOtp).toMatch(/^[0-9]{6}$/);
    expect(messages.build).toHaveBeenCalledOnce();
    expect(messages.build).toHaveBeenCalledWith({
      purpose: 'RESET_PASSWORD',
      token: sentOtp,
      expiresInMinutes: 15,
    });
    expect(input.mail).toBe(message);
    expect(input.tokenHash).toBe(
      createHmac('sha256', resetOtpSecret)
        .update(
          JSON.stringify([
            'marketplate:password-reset:otp:v1',
            input.id,
            'user@example.com',
            sentOtp,
          ]),
        )
        .digest('hex'),
    );
    expect(input.tokenHash).not.toBe(
      createHash('sha256').update(sentOtp).digest('hex'),
    );
    expect(input).not.toHaveProperty('token');
    expect(input).not.toHaveProperty('otp');
    expect(input.authVersion).toBe(3);
    expect(input.expiresAt.getTime() - input.now.getTime()).toBe(15 * 60_000);
  });

  it.each([
    { name: 'missing', user: null },
    { name: 'locked', user: { status: 'LOCKED' as const } },
    { name: 'deleted', user: { deletedAt: new Date() } },
  ])('returns the same empty result for a $name account', async ({ user }) => {
    const { service, users, actions } = fixture(user ?? {});
    if (user === null) users.findByEmail.mockResolvedValue(null);
    await expect(
      service.requestPasswordReset('user@example.com'),
    ).resolves.toBeUndefined();
    await expect(
      service.requestVerification('user@example.com'),
    ).resolves.toBeUndefined();
    expect(actions.queue).not.toHaveBeenCalled();
  });

  it('does not issue another verification token for a verified email', async () => {
    const { service, actions } = fixture({ emailVerifiedAt: new Date() });
    await service.requestVerification('user@example.com');
    expect(actions.queue).not.toHaveBeenCalled();
  });

  it('gives verification links a 24-hour lifetime', async () => {
    const { service, actions } = fixture();
    await service.requestVerification('user@example.com');
    const input = actions.queue.mock.calls[0][0];
    expect(input.purpose).toBe('VERIFY_EMAIL');
    expect(input.expiresAt.getTime() - input.now.getTime()).toBe(
      24 * 60 * 60_000,
    );
  });

  it.each(['', 'short', 'a'.repeat(44), '<'.repeat(43), ' '.repeat(43)])(
    'rejects malformed tokens before touching storage',
    async (invalid) => {
      const { service, actions } = fixture();
      await expect(service.verifyEmail(invalid)).rejects.toBeInstanceOf(
        InvalidAccountActionError,
      );
      await expect(service.confirmEmailChange(invalid)).rejects.toBeInstanceOf(
        InvalidAccountActionError,
      );
      expect(actions.isValid).not.toHaveBeenCalled();
      expect(actions.verifyEmail).not.toHaveBeenCalled();
      expect(actions.changeEmail).not.toHaveBeenCalled();
    },
  );

  it.each([
    '',
    '12345',
    '1234567',
    'abcdef',
    ' 123456',
    '123456 ',
    '１２３４５６',
  ])(
    'rejects malformed OTP %j without claiming an attempt',
    async (invalid) => {
      const { service, actions, passwords } = fixture();
      await expect(
        service.resetPassword('user@example.com', invalid, 'new-password'),
      ).rejects.toBeInstanceOf(InvalidAccountActionError);
      expect(actions.claimPasswordResetAttempt).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
    },
  );

  it('does not spend an OTP attempt on an invalid new password', async () => {
    const { service, actions } = fixture();
    await expect(
      service.resetPassword('user@example.com', otp, 'short'),
    ).rejects.toBeInstanceOf(InvalidAccountPasswordError);
    expect(actions.claimPasswordResetAttempt).not.toHaveBeenCalled();
  });

  it('rejects a non-string password from a non-HTTP caller before claiming an attempt', async () => {
    const { service, actions } = fixture();
    await expect(
      service.resetPassword('user@example.com', otp, null as unknown as string),
    ).rejects.toBeInstanceOf(InvalidAccountPasswordError);
    expect(actions.claimPasswordResetAttempt).not.toHaveBeenCalled();
  });

  it('avoids password hashing when no eligible attempt remains', async () => {
    const { service, actions, passwords } = fixture();
    actions.claimPasswordResetAttempt.mockResolvedValue(null);
    await expect(
      service.resetPassword('user@example.com', otp, 'new-password'),
    ).rejects.toBeInstanceOf(InvalidAccountActionError);
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(actions.resetPassword).not.toHaveBeenCalled();
  });

  it('accepts a leading-zero code, normalizes its email and sends only hashes to reset', async () => {
    const { service, actions, passwords } = fixture();
    await service.resetPassword(' USER@EXAMPLE.COM ', otp, 'new-password');
    expect(actions.claimPasswordResetAttempt).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(Date),
    );
    expect(passwords.hash).toHaveBeenCalledWith('new-password');
    expect(actions.resetPassword).toHaveBeenCalledWith(
      challenge().tokenHash,
      'new-hash',
      expect.any(Date),
    );
  });

  it('spends an attempt but does not hash the password for an incorrect code', async () => {
    const { service, actions, passwords } = fixture();
    await expect(
      service.resetPassword('user@example.com', '999999', 'new-password'),
    ).rejects.toBeInstanceOf(InvalidAccountActionError);
    expect(actions.claimPasswordResetAttempt).toHaveBeenCalledTimes(1);
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(actions.resetPassword).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'action-1', email: 'other@example.com' },
    { id: 'other-action', email: 'user@example.com' },
  ])(
    'rejects a hash from a different account or issuance',
    async ({ id, email }) => {
      const { service, actions, passwords } = fixture();
      actions.claimPasswordResetAttempt.mockResolvedValue({
        id,
        tokenHash: challenge().tokenHash,
      });
      await expect(
        service.resetPassword(email, otp, 'new-password'),
      ).rejects.toBeInstanceOf(InvalidAccountActionError);
      expect(passwords.hash).not.toHaveBeenCalled();
    },
  );

  it('propagates invalidation during password hashing without retrying a new challenge', async () => {
    const { service, actions, passwords } = fixture();
    actions.resetPassword.mockRejectedValue(new InvalidAccountActionError());
    await expect(
      service.resetPassword('user@example.com', otp, 'new-password'),
    ).rejects.toBeInstanceOf(InvalidAccountActionError);
    expect(passwords.hash).toHaveBeenCalledOnce();
    expect(actions.claimPasswordResetAttempt).toHaveBeenCalledOnce();
  });

  it('requires the current password before disclosing whether a new email exists', async () => {
    const { service, users, passwords, actions } = fixture();
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.requestEmailChange('user-1', 'next@example.com', 'wrong'),
    ).rejects.toBeInstanceOf(IncorrectAccountPasswordError);
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(actions.queue).not.toHaveBeenCalled();
  });

  it('rejects the current email and an email already in use', async () => {
    const { service } = fixture();
    await expect(
      service.requestEmailChange('user-1', 'USER@example.com', 'password'),
    ).rejects.toBeInstanceOf(InvalidEmailChangeError);
    await expect(
      service.requestEmailChange('user-1', 'next@example.com', 'password'),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it.each(['invalid', 'invalid@example', 'a'.repeat(250) + '@example.com'])(
    'rejects invalid email %j from a non-HTTP caller after checking password proof',
    async (newEmail) => {
      const { service, users, passwords, actions } = fixture();
      await expect(
        service.requestEmailChange('user-1', newEmail, 'password'),
      ).rejects.toBeInstanceOf(InvalidEmailChangeError);
      expect(passwords.verify).toHaveBeenCalledOnce();
      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(actions.queue).not.toHaveBeenCalled();
    },
  );

  it('sends the email-change link to the new email with the existing credential snapshot', async () => {
    const { service, users, actions } = fixture();
    users.findByEmail.mockResolvedValue(null);
    await service.requestEmailChange('user-1', ' NEW@EXAMPLE.COM ', 'password');
    expect(actions.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'CHANGE_EMAIL',
        emailNormalized: 'new@example.com',
        expectedEmailNormalized: 'user@example.com',
        authVersion: 3,
      }),
    );
  });
});
