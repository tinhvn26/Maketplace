import type { User } from '../../domain/entities/user.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByEmail(emailNormalized: string): Promise<User | null>;
  create(user: User): Promise<User>;
}