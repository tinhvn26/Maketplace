import type { User } from '../interfaces/user.interface.ts';

export function isUserDeleted(user: User): boolean {
  return user.deletedAt !== null;
}