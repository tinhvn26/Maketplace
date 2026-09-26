import { Injectable } from '@nestjs/common';
import type { User } from '../../domain/entities/user.interface.js';
import type { UserRepository } from '../../application/ports/user.repository.js';
import { EmailAlreadyExistsError } from '../../application/ports/user.repository.js';

@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>(); // Lưu trên Ram

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);

    if (!user || user.deletedAt !== null) {
      return null;
    }

    return user;
  }

  async findByEmail(emailNormalized: string): Promise<User | null> {
    return (
      [...this.users.values()].find(
        (user) =>
          user.emailNormalized === emailNormalized && user.deletedAt === null,
      ) ?? null
    );
  }

  async create(user: User): Promise<User> {
    const emailExists = [...this.users.values()].some(
      (existingUser) =>
        existingUser.emailNormalized === user.emailNormalized &&
        existingUser.deletedAt === null,
    );

    if (emailExists) {
      throw new EmailAlreadyExistsError();
    }

    // Không đặt await giữa bước kiểm tra và bước lưu.
    this.users.set(user.id, user);

    return user;
  }
}