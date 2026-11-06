import {
  lstat,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { MediaStorage } from '../application/media.ports.js';
import {
  MediaNotFoundError,
  MediaValidationError,
} from '../domain/media.errors.js';

const storageKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/;

export class LocalMediaStorage implements MediaStorage {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async write(
    key: string,
    original: Uint8Array,
    thumbnail: Uint8Array,
  ): Promise<void> {
    const paths = await this.paths(key);
    const created: string[] = [];
    try {
      await writeFile(paths.original, original, { flag: 'wx' });
      created.push(paths.original);
      await writeFile(paths.thumbnail, thumbnail, { flag: 'wx' });
      created.push(paths.thumbnail);
    } catch (error) {
      await Promise.allSettled(created.map((path) => unlink(path)));
      throw error;
    }
  }

  async read(key: string, thumbnail: boolean): Promise<Uint8Array> {
    const paths = await this.paths(key);
    const path = thumbnail ? paths.thumbnail : paths.original;
    try {
      const entry = await lstat(path);
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new MediaNotFoundError();
      return await readFile(path);
    } catch (error) {
      if (this.isMissing(error)) throw new MediaNotFoundError();
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    const paths = await this.paths(key);
    for (const path of [paths.original, paths.thumbnail]) {
      try {
        await unlink(path);
      } catch (error) {
        if (!this.isMissing(error)) throw error;
      }
    }
  }

  private async paths(key: string) {
    if (!storageKeyPattern.test(key))
      throw new MediaValidationError('Invalid media storage identifier');
    await mkdir(this.directory, { recursive: true });
    const directory = await realpath(this.directory);
    const original = join(directory, key);
    const thumbnail = join(directory, `${key}.thumbnail.webp`);
    for (const path of [original, thumbnail]) {
      const local = relative(directory, path);
      if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
        throw new MediaValidationError('Invalid media storage path');
    }
    return { original, thumbnail };
  }

  private isMissing(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }
}
