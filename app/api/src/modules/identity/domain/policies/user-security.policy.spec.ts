import { describe, expect, it } from 'vitest';
import {
  canRemoveAdministratorAccess,
  isActiveAdministrator,
  removesAdministratorAccess,
  type UserSecurityState,
} from './user-security.policy.js';

const administrator: UserSecurityState = {
  role: 'ADMIN',
  status: 'ACTIVE',
  deletedAt: null,
};

describe('administrator security policy', () => {
  it.each([
    null,
    { ...administrator, role: 'USER' },
    { ...administrator, status: 'LOCKED' },
    { ...administrator, deletedAt: new Date() },
  ])('rejects unavailable or nonadministrator actors: %j', (actor) => {
    expect(isActiveAdministrator(actor)).toBe(false);
  });

  it('requires another active administrator before removing administrator access', () => {
    expect(isActiveAdministrator(administrator)).toBe(true);
    expect(canRemoveAdministratorAccess(administrator, 0)).toBe(false);
    expect(canRemoveAdministratorAccess(administrator, 1)).toBe(false);
    expect(canRemoveAdministratorAccess(administrator, 2)).toBe(true);
  });

  it.each([
    { ...administrator, role: 'USER' },
    { ...administrator, status: 'LOCKED' },
    { ...administrator, deletedAt: new Date() },
  ])(
    'does not protect accounts outside the active administrator set: %j',
    (user) => {
      expect(canRemoveAdministratorAccess(user, 0)).toBe(true);
    },
  );

  it.each([{ deleted: true }, { status: 'LOCKED' }, { role: 'USER' }])(
    'recognizes changes that remove administrator access: %j',
    (change) => {
      expect(removesAdministratorAccess(change)).toBe(true);
    },
  );

  it.each([{ deleted: false }, { status: 'ACTIVE' }, { role: 'ADMIN' }])(
    'does not treat preserving or granting access as removal: %j',
    (change) => {
      expect(removesAdministratorAccess(change)).toBe(false);
    },
  );
});
