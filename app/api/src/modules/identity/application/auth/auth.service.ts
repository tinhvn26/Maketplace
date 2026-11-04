import { createHash, randomUUID } from 'node:crypto';
import type { User } from '../../domain/entities/user.interface.js';
import {
  isValidAvatarUrl,
  isValidEmail,
  isValidFullName,
  isValidPassword,
} from '../../domain/policies/user-input.policy.js';
import { isUserActive } from '../../domain/helpers/user.helpers.js';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  InvalidFullNameError,
  InvalidRefreshTokenError,
  InvalidRegistrationInputError,
} from '../errors/auth.errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { TokenIssuer } from '../ports/token-issuer.js';
import type { SessionRepository } from '../ports/session.repository.js';
import type { AuthUserRepository } from '../ports/user.repository.js';
import type { EmailVerificationRequester } from '../ports/email-verification-requester.js';
import type { IdentityLogger } from '../ports/identity-logger.js';
import {
  toUserProfileResult,
  type UserProfileResult,
} from '../users/user-profile.result.js';
import type { AuthTokens } from './auth-tokens.js';
import type { LoginInput } from './login.input.js';
import type { RegisterInput } from './register.input.js';

export class AuthService {
  constructor(
    private readonly userRepository: AuthUserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenIssuer: TokenIssuer,
    private readonly sessionRepository: SessionRepository,
    private readonly verification: EmailVerificationRequester,
    private readonly logger: IdentityLogger,
  ) {}

  async login(input: LoginInput): Promise<AuthTokens> {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(email);

    if (!user || !isUserActive(user)) {
      throw new InvalidCredentialsError();
    }

    const isValid = await this.passwordHasher.verify(
      input.password,
      user.passwordHash,
    );

    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    const now = new Date();
    const sessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const tokens = await this.tokenIssuer.issue(user.id, sessionId, expiresAt);
    const created = await this.sessionRepository.createIfActive({
      id: sessionId,
      userId: user.id,
      authVersion: user.authVersion,
      refreshTokenHash: this.hashToken(tokens.refreshToken),
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null,
    });

    if (!created) {
      throw new InvalidCredentialsError();
    }

    return tokens;
  }

  async register(input: RegisterInput): Promise<UserProfileResult> {
    if (!isValidFullName(input.fullName)) {
      throw new InvalidFullNameError();
    }
    const fullName = input.fullName.trim();
    const emailNormalized =
      typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!isValidEmail(emailNormalized)) {
      throw new InvalidRegistrationInputError('Email must be a valid email');
    }
    if (!isValidPassword(input.password)) {
      throw new InvalidRegistrationInputError(
        'Password must contain 8 to 128 characters',
      );
    }
    if (input.avatarUrl !== undefined && !isValidAvatarUrl(input.avatarUrl)) {
      throw new InvalidRegistrationInputError(
        'Avatar URL must be an HTTP or HTTPS URL',
      );
    }

    const existingUser = await this.userRepository.findByEmail(emailNormalized);

    if (existingUser) {
      throw new EmailAlreadyExistsError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      fullName,
      emailNormalized,
      passwordHash,
      avatarUrl: input.avatarUrl ?? null,
      status: 'ACTIVE',
      role: 'USER',
      emailVerifiedAt: null,
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const savedUser = await this.userRepository.create(user);

    try {
      await this.verification.requestVerification(savedUser.emailNormalized);
    } catch {
      // Registration has committed. Verification can be requested again.
      // Never include the recipient, token, or provider error in logs.
      this.logger.error('Could not queue the registration verification email');
    }

    return toUserProfileResult(savedUser);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const subject = await this.tokenIssuer.verifyRefreshToken(refreshToken);

    if (!subject) {
      throw new InvalidRefreshTokenError();
    }

    const active = await this.sessionRepository.findActive(
      subject.sessionId,
      subject.userId,
      new Date(),
    );

    if (!active) {
      throw new InvalidRefreshTokenError();
    }

    const tokens = await this.tokenIssuer.issue(
      subject.userId,
      subject.sessionId,
      active.session.expiresAt,
    );
    const rotated = await this.sessionRepository.rotateRefreshToken(
      subject.sessionId,
      subject.userId,
      this.hashToken(refreshToken),
      this.hashToken(tokens.refreshToken),
      new Date(),
    );

    if (!rotated) {
      throw new InvalidRefreshTokenError();
    }

    return tokens;
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.sessionRepository.revoke(sessionId, userId, new Date());
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessionRepository.revokeAll(userId, new Date());
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.sessionRepository.listActive(
      userId,
      new Date(),
    );
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      expiresAt: session.expiresAt,
      current: session.id === currentSessionId,
    }));
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
