import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { PrismaRateLimitStore } from './prisma-rate-limit.store.js';

describe('PrismaRateLimitStore with SQLite', () => {
  let prisma: PrismaService;
  let otherPrisma: PrismaService;
  let store: PrismaRateLimitStore;
  let otherStore: PrismaRateLimitStore;
  let directory: string;
  const now = 1_000_000;
  const input = { key: 'login:client', limit: 5, windowMs: 60_000, now };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-rate-limit-test-'));
    const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    const connection = await new PrismaBetterSqlite3({
      url: databaseUrl,
    }).connect();
    try {
      const migrations = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      const folders = (await readdir(migrations, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const folder of folders) {
        await connection.executeScript(
          await readFile(
            new URL(`${folder.name}/migration.sql`, migrations),
            'utf8',
          ),
        );
      }
    } finally {
      await connection.dispose();
    }
    prisma = new PrismaService();
    otherPrisma = new PrismaService();
    await Promise.all([prisma.$connect(), otherPrisma.$connect()]);
    store = new PrismaRateLimitStore(prisma);
    otherStore = new PrismaRateLimitStore(otherPrisma);
  });

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany();
  });

  afterAll(async () => {
    await Promise.all([prisma?.$disconnect(), otherPrisma?.$disconnect()]);
    vi.unstubAllEnvs();
    if (directory) {
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !target.includes('marketplate-rate-limit-test-')
      ) {
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      }
      await rm(target, { recursive: true, force: true });
    }
  });

  it('atomically counts concurrent requests from separate database connections', async () => {
    const buckets = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 === 0 ? store : otherStore).consume(input),
      ),
    );
    expect(
      buckets.filter((bucket) => bucket.count <= input.limit),
    ).toHaveLength(5);
    expect(Math.max(...buckets.map((bucket) => bucket.count))).toBe(6);
    expect(
      await prisma.rateLimitBucket.findUniqueOrThrow({
        where: { key: input.key },
      }),
    ).toMatchObject({ count: 6, resetAt: BigInt(now + input.windowMs) });
  });

  it('persists counters across adapter instances without extending the fixed window', async () => {
    await store.consume(input);
    const restartedStore = new PrismaRateLimitStore(otherPrisma);
    expect(
      await restartedStore.consume({ ...input, now: now + 10_000 }),
    ).toEqual({
      count: 2,
      resetAt: now + input.windowMs,
    });
    expect(
      await restartedStore.consume({ ...input, now: now + input.windowMs }),
    ).toEqual({
      count: 1,
      resetAt: now + 2 * input.windowMs,
    });
  });

  it('keeps separate endpoint or client keys in independent buckets', async () => {
    await store.consume(input);
    await store.consume(input);
    expect(
      await store.consume({ ...input, key: 'register:client' }),
    ).toMatchObject({ count: 1 });
    expect(
      await store.consume({ ...input, key: 'login:other-client' }),
    ).toMatchObject({ count: 1 });
    expect(await store.consume(input)).toMatchObject({ count: 3 });
  });
});
