import 'reflect-metadata';
import { scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ScryptPasswordHasher } from './scrypt-password.hasher.js';

const salt = '0123456789abcdef0123456789abcdef';
const password = 'A long test password!';
const legacyKey = scryptSync(password, salt, 64, {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
}).toString('hex');
const legacyHash = `scrypt:${salt}:${legacyKey}`;
const placeholderKey = 'a'.repeat(128);
const currentPlaceholder = `scrypt:v2:16384:8:5:${salt}:${placeholderKey}`;

describe('ScryptPasswordHasher', () => {
  const hasher = new ScryptPasswordHasher();

  it('writes explicit versioned OWASP-compatible parameters and derives the declared key', async () => {
    const hash = await hasher.hash(password);
    expect(hash).toMatch(/^scrypt:v2:16384:8:5:[a-f0-9]{32}:[a-f0-9]{128}$/);
    const parts = hash.split(':');
    const expected = scryptSync(password, parts[5], 64, {
      N: 16_384,
      r: 8,
      p: 5,
      maxmem: 32 * 1024 * 1024,
    });
    expect(parts[6]).toBe(expected.toString('hex'));
  });

  it('accepts the correct password and rejects a different password for current hashes', async () => {
    const hash = await hasher.hash(password);
    await expect(hasher.verify(password, hash)).resolves.toBe(true);
    await expect(hasher.verify(`${password}wrong`, hash)).resolves.toBe(false);
  });

  it('uses a fresh random salt when hashing the same password twice', async () => {
    const [first, second] = await Promise.all([
      hasher.hash(password),
      hasher.hash(password),
    ]);
    expect(first.split(':')[5]).not.toBe(second.split(':')[5]);
    expect(first.split(':')[6]).not.toBe(second.split(':')[6]);
  });

  it('retains legacy verification using the original text salt and pinned original cost', async () => {
    await expect(hasher.verify(password, legacyHash)).resolves.toBe(true);
    await expect(
      hasher.verify('Wrong legacy password', legacyHash),
    ).resolves.toBe(false);
  });

  it('keeps all bytes of a 128-character Unicode password without truncation', async () => {
    const unicodePassword = '🔐'.repeat(128);
    const hash = await hasher.hash(unicodePassword);
    await expect(hasher.verify(unicodePassword, hash)).resolves.toBe(true);
    await expect(hasher.verify(`${'🔐'.repeat(127)}🔑`, hash)).resolves.toBe(
      false,
    );
  });

  it.each([
    '',
    'not-a-password-hash',
    `bcrypt:${salt}:${placeholderKey}`,
    `scrypt:${salt}:${placeholderKey}:extra`,
    `scrypt:${salt.slice(1)}:${placeholderKey}`,
    `scrypt:${salt}:${placeholderKey.slice(1)}`,
    `scrypt:${salt.toUpperCase()}:${placeholderKey}`,
    `scrypt:${salt}:${'g'.repeat(128)}`,
    `${legacyHash}\n`,
    currentPlaceholder.replace(':v2:', ':v1:'),
    currentPlaceholder.replace(':v2:', ':v3:'),
    currentPlaceholder.replace(':16384:', ':016384:'),
    currentPlaceholder.replace(':16384:', ':131072:'),
    currentPlaceholder.replace(':16384:', ':1099511627776:'),
    currentPlaceholder.replace(':8:', ':16:'),
    currentPlaceholder.replace(':5:', ':1:'),
    currentPlaceholder.replace(':5:', ':999999999:'),
    `${currentPlaceholder}:extra`,
    `${currentPlaceholder}\n`,
    currentPlaceholder.slice(0, -1),
    `scrypt:v2:16384:8:5:${salt}:${'g'.repeat(128)}`,
  ])(
    'rejects malformed or unsupported cost/hash encodings: %s',
    async (hash) => {
      await expect(hasher.verify(password, hash)).resolves.toBe(false);
    },
  );

  it('rejects oversized hash strings', async () => {
    await expect(hasher.verify(password, 'a'.repeat(100_000))).resolves.toBe(
      false,
    );
  });

  it('rejects nonstring verification inputs rather than passing them to crypto', async () => {
    await expect(
      hasher.verify(null as unknown as string, legacyHash),
    ).resolves.toBe(false);
    await expect(
      hasher.verify(password, null as unknown as string),
    ).resolves.toBe(false);
  });
});
