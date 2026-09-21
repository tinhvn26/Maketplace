import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { User } from '../../domain/entities/user.js';
import { PASSWORD_HASHER } from '../ports/password-hasher.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import { USER_REPOSITORY } from '../ports/user.repository.js';
import type { UserRepository } from '../ports/user.repository.js';
import type { LoginRequest } from '../../presentation/http/dto/auth/login.request.js';
import type { RegisterRequest } from '../../presentation/http/dto/auth/register.request.js';
import { UserProfileResponse } from '../../presentation/http/dto/users/user-profile.response.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  login(_dto: LoginRequest) {
    return {
      message: 'Login flow chưa được triển khai',
      accessToken: 'access-token-placeholder',
      refreshToken: 'refresh-token-placeholder',
      expiresIn: 600,
    };
  }

  async register(request: RegisterRequest): Promise<UserProfileResponse> {
    const emailNormalized = request.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findByEmail(emailNormalized);

    if (existingUser) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const now = new Date();
    const user: User = {
      id: randomUUID(),
      fullName: request.fullName.trim(),
      emailNormalized,
      passwordHash: await this.passwordHasher.hash(request.password),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const savedUser = await this.userRepository.create(user);
    return this.toUserProfileResponse(savedUser);
  }

  async logout() {
    return { message: 'Logout flow chưa được triển khai' };
  }

  private toUserProfileResponse(user: User): UserProfileResponse {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.emailNormalized,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}