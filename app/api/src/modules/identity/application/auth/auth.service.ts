import { randomUUID } from 'node:crypto';
import type { User } from '../../domain/entities/user.interface.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import { EmailAlreadyExistsError } from '../ports/user.repository.js';
import type { UserRepository } from '../ports/user.repository.js';
import type { TokenIssuer } from '../ports/token-issuer.js';
import {
  InvalidCredentialsError,
  InvalidFullNameError,
  InvalidRefreshTokenError,
} from './auth.errors.js';
import type { AuthTokens } from '../models/auth-tokens.js';
import type { UserProfileResult } from '../users/user-profile.result.js';
import type { LoginInput } from './login.input.js';
import type { RegisterInput } from './register.input.js';

export class AuthService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenIssuer: TokenIssuer,
  ) {}

  async login(input: LoginInput): Promise<AuthTokens> {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(email);

    // Chỉ cho phép tài khoản đang hoạt động đăng nhập.
    if (!user || user.status !== 'ACTIVE') {
      throw new InvalidCredentialsError();
    }

    const isValid = await this.passwordHasher.verify(
      input.password,
      user.passwordHash,
    );

    if (!isValid) {
      throw new InvalidCredentialsError();
    }

    return this.tokenIssuer.issue(user.id);
  }

  async register(input: RegisterInput): Promise<UserProfileResult> {
    const fullName = input.fullName.trim();
    const emailNormalized = input.email.trim().toLowerCase();

    // Bảo vệ cả khi service được gọi ngoài HTTP.
    if (!fullName) {
      throw new InvalidFullNameError();
    }

    // Kiểm tra sớm để tránh hash mật khẩu nếu email đã tồn tại.
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
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const savedUser = await this.userRepository.create(user);
    return this.toUserProfileResult(savedUser);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const userId = await this.tokenIssuer.verifyRefreshToken(refreshToken);
    if (!userId) throw new InvalidRefreshTokenError();
    const user = await this.userRepository.findById(userId);
    if (!user || user.status !== 'ACTIVE' || user.deletedAt !== null) {
      throw new InvalidRefreshTokenError();
    }
    const { accessToken, expiresIn } = await this.tokenIssuer.issueAccessToken(user.id);
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn,
    };
  }

  private toUserProfileResult(user: User): UserProfileResult {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.emailNormalized,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
