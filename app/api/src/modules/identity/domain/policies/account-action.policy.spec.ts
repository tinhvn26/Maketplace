import { describe, expect, it } from 'vitest';
import {
  accountActionCooldownStart,
  accountActionLifetimeMinutes,
  canQueueAccountAction,
  hasPasswordResetAttempts,
  isAccountActionAvailable,
  type AccountActionState,
  type AccountActionUserState,
} from './account-action.policy.js';

const now = new Date('2026-10-08T10:00:00.000Z');
const user: AccountActionUserState = {
  status: 'ACTIVE',
  deletedAt: null,
  authVersion: 3,
  emailNormalized: 'owner@example.com',
  emailVerifiedAt: null,
};
const expected = {
  authVersion: user.authVersion,
  emailNormalized: user.emailNormalized,
};

function action(
  overrides: Partial<AccountActionState> = {},
): AccountActionState {
  return {
    purpose: 'RESET_PASSWORD',
    consumedAt: null,
    expiresAt: new Date(now.getTime() + 1),
    authVersion: user.authVersion,
    emailNormalized: user.emailNormalized,
    user,
    ...overrides,
  };
}

describe('account action policy', () => {
  it('keeps verification valid for a day and credential changes valid for fifteen minutes', () => {
    expect(accountActionLifetimeMinutes('VERIFY_EMAIL')).toBe(1440);
    expect(accountActionLifetimeMinutes('RESET_PASSWORD')).toBe(15);
    expect(accountActionLifetimeMinutes('CHANGE_EMAIL')).toBe(15);
  });

  it('uses a sixty-second resend window and permits reservation of the fifth attempt only', () => {
    expect(accountActionCooldownStart(now)).toEqual(
      new Date('2026-10-08T09:59:00.000Z'),
    );
    expect(hasPasswordResetAttempts(0)).toBe(true);
    expect(hasPasswordResetAttempts(4)).toBe(true);
    expect(hasPasswordResetAttempts(5)).toBe(false);
    expect(hasPasswordResetAttempts(6)).toBe(false);
  });

  it.each([
    null,
    { ...user, status: 'LOCKED' },
    { ...user, deletedAt: now },
    { ...user, authVersion: 4 },
    { ...user, emailNormalized: 'changed@example.com' },
  ])(
    'rejects issuance after account state or credentials change: %j',
    (current) => {
      expect(canQueueAccountAction(current, 'RESET_PASSWORD', expected)).toBe(
        false,
      );
    },
  );

  it('only queues email verification for an unverified account', () => {
    expect(canQueueAccountAction(user, 'VERIFY_EMAIL', expected)).toBe(true);
    const verified = { ...user, emailVerifiedAt: now };
    expect(canQueueAccountAction(verified, 'VERIFY_EMAIL', expected)).toBe(
      false,
    );
    expect(canQueueAccountAction(verified, 'RESET_PASSWORD', expected)).toBe(
      true,
    );
  });

  it('accepts an unused action until its exact expiration time', () => {
    expect(isAccountActionAvailable(action(), 'RESET_PASSWORD', now)).toBe(
      true,
    );
    expect(
      isAccountActionAvailable(
        action({ expiresAt: now }),
        'RESET_PASSWORD',
        now,
      ),
    ).toBe(false);
  });

  it.each([
    null,
    action({ consumedAt: now }),
    action({ purpose: 'VERIFY_EMAIL' }),
    action({ authVersion: 2 }),
    action({ user: { ...user, status: 'LOCKED' } }),
    action({ user: { ...user, deletedAt: now } }),
    action({ emailNormalized: 'old@example.com' }),
  ])('rejects unusable or superseded reset actions: %j', (current) => {
    expect(isAccountActionAvailable(current, 'RESET_PASSWORD', now)).toBe(
      false,
    );
  });

  it('allows a verified account to reset a password but prevents verification replay', () => {
    const verified = { ...user, emailVerifiedAt: now };
    expect(
      isAccountActionAvailable(
        action({ user: verified }),
        'RESET_PASSWORD',
        now,
      ),
    ).toBe(true);
    expect(
      isAccountActionAvailable(
        action({ purpose: 'VERIFY_EMAIL', user: verified }),
        'VERIFY_EMAIL',
        now,
      ),
    ).toBe(false);
  });

  it('permits a change-email challenge to target a different email address', () => {
    expect(
      isAccountActionAvailable(
        action({ purpose: 'CHANGE_EMAIL', emailNormalized: 'new@example.com' }),
        'CHANGE_EMAIL',
        now,
      ),
    ).toBe(true);
  });
});
