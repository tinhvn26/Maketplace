import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { PasswordHasher } from '../../application/ports/password-hasher.js';

const scrypt = promisify(scryptCallback);

@Injectable()
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt:${salt}:${derivedKey.toString('hex')}`;
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const parts = passwordHash.split(':');
    if (parts.length !== 3) return false;

    const [algorithm, salt, keyHex] = parts;
    if (
      algorithm !== 'scrypt' ||
      salt.length !== 32 ||
      keyHex.length !== 128 ||
      /[^a-f0-9]/.test(salt) ||
      /[^a-f0-9]/.test(keyHex)
    ) {
      return false;
    }

    const expectedKey = Buffer.from(keyHex, 'hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

    return timingSafeEqual(derivedKey, expectedKey);
  }
}
