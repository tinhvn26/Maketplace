import { Injectable } from '@nestjs/common';
import type { User } from '../interfaces/user.interface.js';
import type { UserRepository } from '../ports/user.repository.js';

@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async findByEmail(emailNormalized: string): Promise<User | null> {
    return (
      [...this.users.values()].find(
        (user) =>
          user.emailNormalized === emailNormalized && user.deletedAt === null,
      ) ?? null
    );
  }

  async create(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }
}
