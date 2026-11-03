import type { AccountActionPurpose } from '../types/account-action-purpose.type.js';

export const ACCOUNT_ACTION_COOLDOWN_MS = 60_000;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

export interface AccountActionUserState {
  status: string;
  deletedAt: Date | null;
  authVersion: number;
  emailNormalized: string;
  emailVerifiedAt: Date | null;
}

export interface AccountActionState {
  purpose: string;
  consumedAt: Date | null;
  expiresAt: Date;
  authVersion: number;
  emailNormalized: string;
  user: AccountActionUserState;
}

export function accountActionLifetimeMinutes(
  purpose: AccountActionPurpose,
): number {
  return purpose === 'VERIFY_EMAIL' ? 24 * 60 : 15;
}

export function accountActionCooldownStart(now: Date): Date {
  return new Date(now.getTime() - ACCOUNT_ACTION_COOLDOWN_MS);
}

export function hasPasswordResetAttempts(attempts: number): boolean {
  return attempts < PASSWORD_RESET_MAX_ATTEMPTS;
}

export function canQueueAccountAction(
  user: AccountActionUserState | null,
  purpose: AccountActionPurpose,
  expected: { authVersion: number; emailNormalized: string },
): boolean {
  return (
    user !== null &&
    user.status === 'ACTIVE' &&
    user.deletedAt === null &&
    user.authVersion === expected.authVersion &&
    user.emailNormalized === expected.emailNormalized &&
    (purpose !== 'VERIFY_EMAIL' || user.emailVerifiedAt === null)
  );
}

export function isAccountActionAvailable<T extends AccountActionState>(
  action: T | null,
  purpose: AccountActionPurpose,
  now: Date,
): action is T {
  return (
    action !== null &&
    action.purpose === purpose &&
    action.consumedAt === null &&
    action.expiresAt.getTime() > now.getTime() &&
    action.user.status === 'ACTIVE' &&
    action.user.deletedAt === null &&
    action.user.authVersion === action.authVersion &&
    (purpose === 'CHANGE_EMAIL' ||
      action.user.emailNormalized === action.emailNormalized) &&
    (purpose !== 'VERIFY_EMAIL' || action.user.emailVerifiedAt === null)
  );
}
