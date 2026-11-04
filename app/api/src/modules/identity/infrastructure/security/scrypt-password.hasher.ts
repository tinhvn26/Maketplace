import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

const keyLength = 64;
const currentPrefix = 'scrypt:v2:16384:8:5';
const commonOptions = {
  N: 16_384,
  r: 8,
  maxmem: 32 * 1024 * 1024,
} as const;
const currentOptions = { ...commonOptions, p: 5 };
// Existing hashes used Node's original defaults and the hex salt as text.
const legacyOptions = { ...commonOptions, p: 1 };
const currentPattern = /^scrypt:v2:16384:8:5:([a-f0-9]{32}):([a-f0-9]{128})$/;
const legacyPattern = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/;

function deriveKey(
  password: string,
  salt: string,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await deriveKey(password, salt, currentOptions);
    return `${currentPrefix}:${salt}:${derivedKey.toString('hex')}`;
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    if (
      typeof password !== 'string' ||
      typeof passwordHash !== 'string' ||
      passwordHash.length > currentPrefix.length + 1 + 32 + 1 + 128
    ) {
      return false;
    }

    // Only known, bounded configurations are accepted. Stored parameters never
    // control memory or CPU usage, even if the hash string is malformed.
    const current = currentPattern.exec(passwordHash);
    const legacy = current ? null : legacyPattern.exec(passwordHash);
    const match = current ?? legacy;
    if (!match || match[0] !== passwordHash) return false;
    const [, salt, keyHex] = match;
    const expectedKey = Buffer.from(keyHex, 'hex');
    const derivedKey = await deriveKey(
      password,
      salt,
      current ? currentOptions : legacyOptions,
    );

    return timingSafeEqual(derivedKey, expectedKey);
  }
}
