import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { User } from '../../domain/entities/user.interface.js';
import { isUserActive } from '../../domain/helpers/user.helpers.js';
import { accountActionLifetimeMinutes } from '../../domain/policies/account-action.policy.js';
import {
  isValidEmail,
  isValidPassword,
} from '../../domain/policies/user-input.policy.js';
import { EmailAlreadyExistsError } from '../errors/auth.errors.js';
import { UserUnavailableError } from '../errors/users.errors.js';
import type {
  AccountActionPurpose,
  AccountActionRepository,
} from '../ports/account-action.repository.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { AccountActionMessageBuilder } from '../ports/account-action-message-builder.js';
import type { UserReader } from '../ports/user.repository.js';
import {
  IncorrectAccountPasswordError,
  InvalidAccountActionError,
  InvalidAccountPasswordError,
  InvalidEmailChangeError,
} from '../errors/account-actions.errors.js';

export interface AccountActionsOptions {
  resetOtpSecret: string;
}

export class AccountActionsService {
  constructor(
    private readonly users: UserReader,
    private readonly passwords: PasswordHasher,
    private readonly actions: AccountActionRepository,
    private readonly options: AccountActionsOptions,
    private readonly messages: AccountActionMessageBuilder,
  ) {
    if (Buffer.byteLength(options.resetOtpSecret.trim(), 'utf8') < 32) {
      throw new Error(
        'Password reset OTP secret must contain at least 32 bytes',
      );
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(this.normalizeEmail(email));
    if (!this.isAvailable(user)) return;
    await this.queue(user, 'RESET_PASSWORD', user.emailNormalized);
  }

  async requestVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(this.normalizeEmail(email));
    if (!this.isAvailable(user) || user.emailVerifiedAt !== null) return;
    await this.queue(user, 'VERIFY_EMAIL', user.emailNormalized);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.actions.verifyEmail(this.hashToken(token), new Date());
  }

  async resetPassword(
    email: string,
    otp: string,
    newPassword: string,
  ): Promise<void> {
    if (typeof otp !== 'string' || !/^[0-9]{6}$/.test(otp)) {
      throw new InvalidAccountActionError();
    }
    if (!isValidPassword(newPassword)) {
      throw new InvalidAccountPasswordError();
    }
    const emailNormalized = this.normalizeEmail(email);
    // Reserve an attempt in storage before checking the code, including when
    // several requests arrive concurrently or from different IP addresses.
    const challenge = await this.actions.claimPasswordResetAttempt(
      emailNormalized,
      new Date(),
    );
    if (!challenge) throw new InvalidAccountActionError();
    const expectedHash = Buffer.from(challenge.tokenHash, 'hex');
    const suppliedHash = Buffer.from(
      this.hashResetOtp(challenge.id, emailNormalized, otp),
      'hex',
    );
    if (
      expectedHash.length !== suppliedHash.length ||
      !timingSafeEqual(expectedHash, suppliedHash)
    ) {
      throw new InvalidAccountActionError();
    }
    const passwordHash = await this.passwords.hash(newPassword);
    // Rechecks token expiration and credential version after the expensive hash.
    await this.actions.resetPassword(
      challenge.tokenHash,
      passwordHash,
      new Date(),
    );
  }

  async requestEmailChange(
    userId: string,
    newEmail: string,
    currentPassword: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!this.isAvailable(user)) throw new UserUnavailableError();
    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new IncorrectAccountPasswordError();
    }

    const emailNormalized =
      typeof newEmail === 'string' ? this.normalizeEmail(newEmail) : '';
    if (
      !isValidEmail(emailNormalized) ||
      emailNormalized === user.emailNormalized
    ) {
      throw new InvalidEmailChangeError();
    }
    if (await this.users.findByEmail(emailNormalized)) {
      throw new EmailAlreadyExistsError();
    }
    await this.queue(user, 'CHANGE_EMAIL', emailNormalized);
  }

  async confirmEmailChange(token: string): Promise<void> {
    await this.actions.changeEmail(this.hashToken(token), new Date());
  }

  private async queue(
    user: User,
    purpose: AccountActionPurpose,
    emailNormalized: string,
  ): Promise<void> {
    const id = randomUUID();
    const token =
      purpose === 'RESET_PASSWORD'
        ? randomInt(0, 1_000_000).toString().padStart(6, '0')
        : randomBytes(32).toString('base64url');
    const now = new Date();
    const expiryMinutes = accountActionLifetimeMinutes(purpose);

    await this.actions.queue({
      id,
      userId: user.id,
      purpose,
      tokenHash:
        purpose === 'RESET_PASSWORD'
          ? this.hashResetOtp(id, emailNormalized, token)
          : this.hashToken(token),
      emailNormalized,
      expectedEmailNormalized: user.emailNormalized,
      authVersion: user.authVersion,
      now,
      expiresAt: new Date(now.getTime() + expiryMinutes * 60_000),
      mail: this.messages.build({
        purpose,
        token,
        expiresInMinutes: expiryMinutes,
      }),
    });
  }

  private hashResetOtp(id: string, email: string, otp: string): string {
    // Bind the small code space to a secret, a particular issuance and account.
    return createHmac('sha256', this.options.resetOtpSecret)
      .update(
        JSON.stringify(['marketplate:password-reset:otp:v1', id, email, otp]),
      )
      .digest('hex');
  }

  private hashToken(token: string): string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new InvalidAccountActionError();
    }
    return createHash('sha256').update(token).digest('hex');
  }

  private isAvailable(user: User | null): user is User {
    return user !== null && isUserActive(user);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
