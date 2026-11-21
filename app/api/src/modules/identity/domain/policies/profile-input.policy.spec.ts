import { describe, expect, it } from 'vitest';
import {
  isValidAvatarUrl,
  PROFILE_INPUT_LIMITS,
} from './profile-input.policy.js';

describe('profile input policies', () => {
  it('accepts nullable HTTP(S) avatar URLs independently of User state', () => {
    expect(isValidAvatarUrl(null)).toBe(true);
    expect(isValidAvatarUrl('https://example.com/avatar.png')).toBe(true);
    expect(isValidAvatarUrl('http://example.com/avatar.png')).toBe(true);
  });

  it.each([
    'https://localhost/avatar.png',
    'https://example/avatar.png',
    'ftp://example.com/avatar.png',
    'example.com/avatar.png',
    'javascript:alert(1)',
    '',
    undefined,
    123,
    {},
    [],
  ])('rejects invalid avatar URLs: %j', (value) => {
    expect(isValidAvatarUrl(value)).toBe(false);
  });

  it('preserves the 2048-character URL boundary', () => {
    const prefix = 'https://example.com/';
    const maximum = `${prefix}${'x'.repeat(PROFILE_INPUT_LIMITS.avatarUrl - prefix.length)}`;
    expect(isValidAvatarUrl(maximum)).toBe(true);
    expect(isValidAvatarUrl(`${maximum}x`)).toBe(false);
  });
});
