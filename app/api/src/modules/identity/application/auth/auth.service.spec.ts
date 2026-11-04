import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../domain/entities/user.interface.js';
import {
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidFullNameError,
  InvalidRegistrationInputError,
} from '../errors/auth.errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SessionRepository } from '../ports/session.repository.js';
import type { TokenIssuer } from '../ports/token-issuer.js';
import type { AuthUserRepository } from '../ports/user.repository.js';
import type { RegisterInput } from './register.input.js';
import { AuthService } from './auth.service.js';

function setup() {
  const now = new Date();
  const user: User = {
    id: 'user',
    fullName: 'Account Owner',
    emailNormalized: 'owner@example.com',
    passwordHash: 'password-hash',
    status: 'ACTIVE',
    role: 'USER',
    avatarUrl: null,
    authVersion: 4,
    emailVerifiedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const users = {
    findByEmail: vi
      .fn<AuthUserRepository['findByEmail']>()
      .mockResolvedValue(user),
    create: vi
      .fn<AuthUserRepository['create']>()
      .mockImplementation(async (newUser) => newUser),
  } satisfies AuthUserRepository;
  const passwords = {
    hash: vi
      .fn<PasswordHasher['hash']>()
      .mockResolvedValue('new-password-hash'),
    verify: vi.fn<PasswordHasher['verify']>().mockResolvedValue(true),
  } satisfies PasswordHasher;
  const result = {
    accessToken: 'access',
    refreshToken: 'new-refresh',
    tokenType: 'Bearer' as const,
    expiresIn: 900,
  };
  const tokens = {
    issue: vi.fn<TokenIssuer['issue']>().mockResolvedValue(result),
    verifyAccessToken: vi.fn(),
    verifyRefreshToken: vi
      .fn<TokenIssuer['verifyRefreshToken']>()
      .mockResolvedValue({ userId: 'user', sessionId: 'session' }),
  } satisfies TokenIssuer;
  const session = {
    id: 'session',
    userId: 'user',
    authVersion: 4,
    refreshTokenHash: 'existing-hash',
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + 60000),
    revokedAt: null,
  };
  const sessions = {
    createIfActive: vi
      .fn<SessionRepository['createIfActive']>()
      .mockResolvedValue(true),
    findActive: vi
      .fn<SessionRepository['findActive']>()
      .mockResolvedValue({ session, role: 'USER' }),
    rotateRefreshToken: vi
      .fn<SessionRepository['rotateRefreshToken']>()
      .mockResolvedValue(true),
    revoke: vi.fn(),
    revokeAll: vi.fn(),
    listActive: vi
      .fn<SessionRepository['listActive']>()
      .mockResolvedValue([session]),
  } satisfies SessionRepository;
  const verification = {
    requestVerification: vi
      .fn<(email: string) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const logger = { error: vi.fn() };
  return {
    service: new AuthService(
      users,
      passwords,
      tokens,
      sessions,
      verification,
      logger,
    ),
    verification,
    logger,
    user,
    users,
    passwords,
    tokens,
    sessions,
    session,
    result,
  };
}

describe('AuthService session boundary', () => {
  it('persists only a refresh hash with the verified credential version at login', async () => {
    const { service, sessions, users, result } = setup();
    await expect(
      service.login({ email: ' OWNER@EXAMPLE.COM ', password: 'password' }),
    ).resolves.toBe(result);
    expect(users.findByEmail).toHaveBeenCalledWith('owner@example.com');
    const stored = sessions.createIfActive.mock.calls[0][0];
    expect(stored).toMatchObject({
      userId: 'user',
      authVersion: 4,
      revokedAt: null,
    });
    expect(stored.refreshTokenHash).toBe(
      createHash('sha256').update(result.refreshToken).digest('hex'),
    );
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      604800000,
    );
    expect(JSON.stringify(stored)).not.toContain(result.refreshToken);
  });

  it('does not return tokens if credentials change between password verification and persistence', async () => {
    const { service, sessions } = setup();
    sessions.createIfActive.mockResolvedValue(false);
    await expect(
      service.login({ email: 'owner@example.com', password: 'password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('never creates sessions for deleted accounts or wrong passwords', async () => {
    const { service, user, users, passwords, sessions } = setup();
    users.findByEmail.mockResolvedValue({ ...user, deletedAt: new Date() });
    await expect(
      service.login({ email: user.emailNormalized, password: 'password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(passwords.verify).not.toHaveBeenCalled();
    users.findByEmail.mockResolvedValue(user);
    passwords.verify.mockResolvedValue(false);
    await expect(
      service.login({ email: user.emailNormalized, password: 'password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(sessions.createIfActive).not.toHaveBeenCalled();
  });

  it('rotates both tokens without extending the established session deadline', async () => {
    const { service, tokens, sessions, session, result } = setup();
    await expect(service.refresh('old-refresh')).resolves.toBe(result);
    expect(tokens.issue).toHaveBeenCalledWith(
      'user',
      'session',
      session.expiresAt,
    );
    expect(sessions.rotateRefreshToken).toHaveBeenCalledWith(
      'session',
      'user',
      createHash('sha256').update('old-refresh').digest('hex'),
      createHash('sha256').update(result.refreshToken).digest('hex'),
      expect.any(Date),
    );
  });

  it('does not return tokens after a concurrent revoke or refresh replay', async () => {
    const { service, sessions } = setup();
    sessions.rotateRefreshToken.mockResolvedValue(false);
    await expect(service.refresh('old-refresh')).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('does not touch sessions when a refresh token signature is invalid', async () => {
    const { service, tokens, sessions } = setup();
    tokens.verifyRefreshToken.mockResolvedValue(null);
    await expect(service.refresh('forged-refresh')).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(sessions.findActive).not.toHaveBeenCalled();
    expect(sessions.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('never exposes refresh hashes or credential versions in session listings', async () => {
    const { service, session } = setup();
    expect(await service.listSessions('user', 'session')).toEqual([
      {
        id: 'session',
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        expiresAt: session.expiresAt,
        current: true,
      },
    ]);
  });
});

describe('AuthService registration boundary', () => {
  const input: RegisterInput = {
    fullName: '  New Account  ',
    email: ' NEW@EXAMPLE.COM ',
    password: 'a-valid-password',
  };

  it.each([
    { fullName: ' ' },
    { fullName: 'x'.repeat(101) },
    { email: 'invalid-email' },
    { email: `${'x'.repeat(250)}@example.com` },
    { password: 'short' },
    { password: 'x'.repeat(129) },
    { avatarUrl: 'javascript:alert(1)' },
    { avatarUrl: 'not-a-url' },
    { avatarUrl: `https://example.com/${'x'.repeat(2048)}` },
  ])(
    'rejects invalid registration without an HTTP validation pipe: %j',
    async (changes) => {
      const { service, users, passwords, verification } = setup();
      users.findByEmail.mockResolvedValue(null);
      await expect(
        service.register({ ...input, ...changes }),
      ).rejects.toBeInstanceOf(
        'fullName' in changes
          ? InvalidFullNameError
          : InvalidRegistrationInputError,
      );
      expect(users.create).not.toHaveBeenCalled();
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(verification.requestVerification).not.toHaveBeenCalled();
    },
  );

  it('creates a normalized account and requests verification for non-HTTP callers', async () => {
    const { service, users, verification } = setup();
    users.findByEmail.mockResolvedValue(null);
    let committed = false;
    users.create.mockImplementation(async (newUser) => {
      await Promise.resolve();
      committed = true;
      return newUser;
    });
    verification.requestVerification.mockImplementation(async () => {
      expect(committed).toBe(true);
    });
    const profile = await service.register(input);
    expect(profile).toMatchObject({
      fullName: 'New Account',
      email: 'new@example.com',
      role: 'USER',
    });
    expect(profile).not.toHaveProperty('passwordHash');
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        emailNormalized: 'new@example.com',
        passwordHash: 'new-password-hash',
      }),
    );
    expect(verification.requestVerification).toHaveBeenCalledExactlyOnceWith(
      'new@example.com',
    );
  });

  it('keeps a committed registration successful when verification queueing fails', async () => {
    const { service, users, verification, logger } = setup();
    users.findByEmail.mockResolvedValue(null);
    verification.requestVerification.mockRejectedValue(
      new Error('private provider details'),
    );
    await expect(service.register(input)).resolves.toMatchObject({
      email: 'new@example.com',
    });
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Could not queue the registration verification email',
    );
  });

  it('does not queue verification when persisting the account fails', async () => {
    const { service, users, verification } = setup();
    users.findByEmail.mockResolvedValue(null);
    const failure = new Error('storage unavailable');
    users.create.mockRejectedValue(failure);
    await expect(service.register(input)).rejects.toBe(failure);
    expect(verification.requestVerification).not.toHaveBeenCalled();
  });
});
