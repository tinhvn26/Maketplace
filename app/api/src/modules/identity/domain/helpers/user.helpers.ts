import type { User } from '../entities/user.interface.js';

export function isUserDeleted(user: User): boolean {
  return user.deletedAt !== null;
}

export function isUserActive(user: User): boolean {
  return user.status === 'ACTIVE' && user.deletedAt === null;
}
