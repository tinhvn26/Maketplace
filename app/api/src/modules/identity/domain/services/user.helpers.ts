import type { User } from '../entities/user.interface.js';

export function isUserDeleted(user: User): boolean {
  return user.deletedAt !== null;
}