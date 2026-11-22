import { describe, expect, it } from 'vitest';
import {
  canRemoveAdministratorAccess,
  isActiveAdministrator,
  removesAdministratorAccess,
  type UserSecurityState,
} from './user-security.policy.js';
import { isUserRole, USER_ROLES } from '../types/user-role.type.js';

const administrator: UserSecurityState = {
  role: 'ADMIN',
  status: 'ACTIVE',
  deletedAt: null,
};

describe('administrator security policy', () => {
  it.each([
    null,
    { ...administrator, role: 'CUSTOMER' },
    { ...administrator, role: 'EMPLOYER' },
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
    { ...administrator, role: 'CUSTOMER' },
    { ...administrator, role: 'EMPLOYER' },
    { ...administrator, status: 'LOCKED' },
    { ...administrator, deletedAt: new Date() },
  ])(
    'does not protect accounts outside the active administrator set: %j',
    (user) => {
      expect(canRemoveAdministratorAccess(user, 0)).toBe(true);
    },
  );

  it.each([
    { deleted: true },
    { status: 'LOCKED' },
    { role: 'CUSTOMER' },
    { role: 'EMPLOYER' },
  ])('recognizes changes that remove administrator access: %j', (change) => {
    expect(removesAdministratorAccess(change)).toBe(true);
  });

  it('accepts exactly the three current roles and rejects the legacy role', () => {
    expect(USER_ROLES).toEqual(['ADMIN', 'EMPLOYER', 'CUSTOMER']);
    for (const role of USER_ROLES) expect(isUserRole(role)).toBe(true);
    for (const role of [
      'USER',
      'Employee',
      'EMPLOYEE',
      'employer',
      '',
      null,
      undefined,
      {},
      1,
    ]) {
      expect(isUserRole(role)).toBe(false);
    }
  });

  it.each([{ deleted: false }, { status: 'ACTIVE' }, { role: 'ADMIN' }])(
    'does not treat preserving or granting access as removal: %j',
    (change) => {
      expect(removesAdministratorAccess(change)).toBe(false);
    },
  );
});
