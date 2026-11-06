import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MediaNotFoundError,
  MediaValidationError,
} from '../domain/media.errors.js';
import { LocalMediaStorage } from './local-media.storage.js';

describe('LocalMediaStorage', () => {
  let directory: string;
  let storage: LocalMediaStorage;
  const key = '12345678-1234-4234-8234-123456789abc.png';

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), 'marketplate-media-storage-test-'),
    );
    storage = new LocalMediaStorage(directory);
  });
  afterAll(async () => {
    if (!directory) return;
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !target.includes('marketplate-media-storage-test-')
    )
      throw new Error(
        'Refusing to remove a directory outside the test workspace',
      );
    await rm(target, { recursive: true, force: true });
  });

  it('keeps original and thumbnail bytes separate without overwriting existing assets', async () => {
    await storage.write(key, Buffer.from('original'), Buffer.from('thumbnail'));
    expect(Buffer.from(await storage.read(key, false)).toString()).toBe(
      'original',
    );
    expect(Buffer.from(await storage.read(key, true)).toString()).toBe(
      'thumbnail',
    );
    await expect(
      storage.write(
        key,
        Buffer.from('replacement'),
        Buffer.from('replacement'),
      ),
    ).rejects.toThrow();
    expect(Buffer.from(await storage.read(key, false)).toString()).toBe(
      'original',
    );
    await storage.remove(key);
    await expect(storage.read(key, false)).rejects.toBeInstanceOf(
      MediaNotFoundError,
    );
    await expect(storage.read(key, true)).rejects.toBeInstanceOf(
      MediaNotFoundError,
    );
  });

  it.each([
    '../outside.png',
    'folder/image.png',
    '..\\outside.png',
    'C:\\secret.png',
    key + '.backup',
    'image.svg',
  ])(
    'rejects arbitrary storage paths %s for every operation',
    async (unsafe) => {
      await expect(
        storage.write(unsafe, Buffer.from('x'), Buffer.from('x')),
      ).rejects.toBeInstanceOf(MediaValidationError);
      await expect(storage.read(unsafe, false)).rejects.toBeInstanceOf(
        MediaValidationError,
      );
      await expect(storage.remove(unsafe)).rejects.toBeInstanceOf(
        MediaValidationError,
      );
    },
  );
});
