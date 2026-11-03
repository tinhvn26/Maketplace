import { describe, expect, it } from 'vitest';
import {
  isValidAvatarUrl,
  isValidCurrentPassword,
  isValidEmail,
  isValidFullName,
  isValidPassword,
} from './user-input.policy.js';

describe('user input policies', () => {
  it.each([
    'owner@example.com',
    '"a b"@example.com',
    '"a@b"@example.com',
    'tên@vídụ.vn',
    '用户@example.com',
    `${'a'.repeat(64)}@example.com`,
  ])('accepts valid quoted and international email addresses: %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    'invalid-email',
    'a..b@example.com',
    '.a@example.com',
    'a.@example.com',
    'a@example..com',
    'a@-example.com',
    'a@example-.com',
    'a@localhost',
    `${'a'.repeat(65)}@example.com`,
    `a@${'b'.repeat(64)}.com`,
  ])('rejects malformed email local parts and domains: %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it('limits the full email to 254 characters without rejecting legal domain labels', () => {
    const local = 'a'.repeat(64);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;
    const maximum = `${local}@${domain}`;
    expect(maximum).toHaveLength(254);
    expect(isValidEmail(maximum)).toBe(true);
    expect(isValidEmail(`${maximum}d`)).toBe(false);
  });

  it('validates names after trimming and counts Unicode characters at the limit', () => {
    expect(isValidFullName('  Nguyễn Văn An  ')).toBe(true);
    expect(isValidFullName(' \n\t ')).toBe(false);
    expect(isValidFullName(`  ${'🙂'.repeat(100)}  `)).toBe(true);
    expect(isValidFullName('🙂'.repeat(101))).toBe(false);
  });

  it('counts Unicode characters for password boundaries without trimming the password', () => {
    expect(isValidPassword('🙂'.repeat(7))).toBe(false);
    expect(isValidPassword('🙂'.repeat(8))).toBe(true);
    expect(isValidPassword('🙂'.repeat(128))).toBe(true);
    expect(isValidPassword('🙂'.repeat(129))).toBe(false);
    expect(isValidPassword(' '.repeat(8))).toBe(true);
    expect(isValidPassword('x'.repeat(128))).toBe(true);
    expect(isValidPassword('x'.repeat(129))).toBe(false);
  });

  it('requires HTTP or HTTPS and a valid public domain for avatar URLs', () => {
    expect(isValidAvatarUrl(null)).toBe(true);
    expect(isValidAvatarUrl('https://example.com/avatar.png')).toBe(true);
    expect(isValidAvatarUrl('http://example.com/avatar.png')).toBe(true);
    expect(isValidAvatarUrl('https://localhost/avatar.png')).toBe(false);
    expect(isValidAvatarUrl('https://example/avatar.png')).toBe(false);
    expect(isValidAvatarUrl('ftp://example.com/avatar.png')).toBe(false);
    expect(isValidAvatarUrl('example.com/avatar.png')).toBe(false);
    expect(isValidAvatarUrl('javascript:alert(1)')).toBe(false);
  });

  it('accepts existing passwords from one through 128 Unicode characters', () => {
    expect(isValidCurrentPassword('')).toBe(false);
    expect(isValidCurrentPassword('🔐')).toBe(true);
    expect(isValidCurrentPassword('🔐'.repeat(128))).toBe(true);
    expect(isValidCurrentPassword('🔐'.repeat(129))).toBe(false);
  });

  it('limits avatar URLs to 2048 characters', () => {
    const prefix = 'https://example.com/';
    const maximum = `${prefix}${'x'.repeat(2048 - prefix.length)}`;
    expect(isValidAvatarUrl(maximum)).toBe(true);
    expect(isValidAvatarUrl(`${maximum}x`)).toBe(false);
  });

  it.each([undefined, null, 123, {}, []])(
    'rejects nonstring names, emails and passwords: %j',
    (value) => {
      expect(isValidFullName(value)).toBe(false);
      expect(isValidEmail(value)).toBe(false);
      expect(isValidPassword(value)).toBe(false);
      expect(isValidCurrentPassword(value)).toBe(false);
      if (value !== null) expect(isValidAvatarUrl(value)).toBe(false);
    },
  );
});
