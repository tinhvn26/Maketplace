import type { AccountActionPurpose } from '../../domain/types/account-action-purpose.type.js';

export type { AccountActionPurpose } from '../../domain/types/account-action-purpose.type.js';

export const ACCOUNT_ACTION_REPOSITORY = Symbol('ACCOUNT_ACTION_REPOSITORY');

export interface QueueAccountActionInput {
  id?: string;
  userId: string;
  purpose: AccountActionPurpose;
  tokenHash: string;
  emailNormalized: string;
  expectedEmailNormalized: string;
  authVersion: number;
  expiresAt: Date;
  now: Date;
  mail: { subject: string; text: string };
}

export interface AccountActionRepository {
  /** Atomically replaces previous tokens and queues mail; false for cooldown/unavailable users. */
  queue(input: QueueAccountActionInput): Promise<boolean>;
  /** Reserves one of five reset-code checks, including successful checks. */
  claimPasswordResetAttempt(
    emailNormalized: string,
    now: Date,
  ): Promise<{ id: string; tokenHash: string } | null>;
  isValid(
    tokenHash: string,
    purpose: AccountActionPurpose,
    now: Date,
  ): Promise<boolean>;
  verifyEmail(tokenHash: string, now: Date): Promise<void>;
  resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<void>;
  changeEmail(tokenHash: string, now: Date): Promise<void>;
}
