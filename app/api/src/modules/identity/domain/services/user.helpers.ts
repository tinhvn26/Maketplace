import type { User } from '../entities/user.js';

export function isUserDeleted(user: User): boolean {
  return user.deletedAt !== null;
}