import {
  EmailAlreadyExistsError,
  InvalidFullNameError,
} from '../errors/auth.errors.js';
import {
  EmptyProfileUpdateError,
  IncorrectPasswordError,
  InvalidAccountInputError,
  UserUnavailableError,
} from '../errors/users.errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { UserProfileRepository } from '../ports/user.repository.js';
import { isUserActive } from '../../domain/helpers/user.helpers.js';
import {
  isValidAvatarUrl,
  isValidCurrentPassword,
  isValidEmail,
  isValidFullName,
  isValidPassword,
} from '../../domain/policies/user-input.policy.js';
import type { UpdateProfileInput } from './update-profile.input.js';
import {
  toUserProfileResult,
  type UserProfileResult,
} from './user-profile.result.js';

export class UsersService {
  constructor(
    private readonly userRepository: UserProfileRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async getProfile(userId: string): Promise<UserProfileResult> {
    const user = await this.userRepository.findById(userId);

    if (!user || !isUserActive(user)) {
      throw new UserUnavailableError();
    }

    return toUserProfileResult(user);
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<UserProfileResult> {
    if (input.fullName === undefined && input.avatarUrl === undefined) {
      throw new EmptyProfileUpdateError();
    }

    const changes: UpdateProfileInput = {};

    if (input.fullName !== undefined) {
      if (!isValidFullName(input.fullName)) {
        throw new InvalidFullNameError();
      }
      changes.fullName = input.fullName.trim();
    }

    if (input.avatarUrl !== undefined) {
      if (!isValidAvatarUrl(input.avatarUrl)) {
        throw new InvalidAccountInputError(
          'Avatar URL must be an HTTP or HTTPS URL',
        );
      }
      changes.avatarUrl = input.avatarUrl;
    }

    const user = await this.userRepository.updateProfile(userId, changes);

    if (!user) {
      throw new UserUnavailableError();
    }

    return toUserProfileResult(user);
  }

  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    if (!isValidPassword(input.newPassword)) {
      throw new InvalidAccountInputError(
        'New password must contain 8 to 128 characters',
      );
    }
    const user = await this.verifyCurrentPassword(
      userId,
      input.currentPassword,
    );
    if (input.currentPassword === input.newPassword) {
      throw new InvalidAccountInputError(
        'New password must differ from the current password',
      );
    }
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    await this.userRepository.changePassword(userId, {
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
      passwordHash,
    });
  }

  async changeEmail(
    userId: string,
    input: { currentPassword: string; newEmail: string; sessionId: string },
  ): Promise<void> {
    const user = await this.verifyCurrentPassword(
      userId,
      input.currentPassword,
    );
    const emailNormalized =
      typeof input.newEmail === 'string'
        ? input.newEmail.trim().toLowerCase()
        : '';
    if (!isValidEmail(emailNormalized)) {
      throw new InvalidAccountInputError('New email must be a valid email');
    }
    if (emailNormalized === user.emailNormalized) {
      throw new InvalidAccountInputError(
        'New email must differ from the current email',
      );
    }
    if (await this.userRepository.findByEmail(emailNormalized)) {
      throw new EmailAlreadyExistsError();
    }
    await this.userRepository.changeEmail(userId, {
      emailNormalized,
      sessionId: input.sessionId,
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
    });
  }

  async deleteAccount(userId: string, currentPassword: string): Promise<void> {
    const user = await this.verifyCurrentPassword(userId, currentPassword);
    await this.userRepository.deleteOwnAccount(userId, {
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
    });
  }

  private async verifyCurrentPassword(userId: string, currentPassword: string) {
    if (!isValidCurrentPassword(currentPassword)) {
      throw new IncorrectPasswordError();
    }
    const user = await this.userRepository.findById(userId);
    if (!user || !isUserActive(user)) {
      throw new UserUnavailableError();
    }
    if (
      !(await this.passwordHasher.verify(currentPassword, user.passwordHash))
    ) {
      throw new IncorrectPasswordError();
    }
    return user;
  }
}
