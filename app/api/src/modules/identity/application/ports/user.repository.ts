import type { User } from '../../domain/entities/user.interface.js';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export class EmailAlreadyExistsError extends Error {
  constructor() {
    super('Email already exists');
    this.name = 'EmailAlreadyExistsError';
  }
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(emailNormalized: string): Promise<User | null>;
  create(user: User): Promise<User>;
}