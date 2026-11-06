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
import { createShop } from '../../domain/entities/shop.js';
import {
  ShopAccessDeniedError,
  ShopUnavailableError,
  ShopVersionConflictError,
} from '../../domain/errors/shop.errors.js';
import { PrismaShopRepository } from './prisma-shop.repository.js';

describe('PrismaShopRepository security transactions', () => {
  let prisma: PrismaService;
  let repository: PrismaShopRepository;
  let directory: string;
  const actor = { userId: 'owner', role: 'USER' as const };
  const administrator = { userId: 'admin', role: 'ADMIN' as const };
  const now = new Date('2026-11-03T03:00:00Z');

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-shops-test-'));
    const url = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', url);
    const connection = await new PrismaBetterSqlite3({ url }).connect();
    try {
      const migrations = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      for (const entry of (await readdir(migrations, { withFileTypes: true }))
        .filter((item) => item.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        await connection.executeScript(
          await readFile(
            new URL(`${entry.name}/migration.sql`, migrations),
            'utf8',
          ),
        );
      }
    } finally {
      await connection.dispose();
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaShopRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.shop.deleteMany();
    await prisma.user.deleteMany();
    await prisma.user.createMany({
      data: [
        {
          id: 'owner',
          emailNormalized: 'owner@example.com',
          fullName: 'Owner',
          passwordHash: 'hash',
          role: 'USER',
        },
        {
          id: 'other',
          emailNormalized: 'other@example.com',
          fullName: 'Other',
          passwordHash: 'hash',
          role: 'USER',
        },
        {
          id: 'admin',
          emailNormalized: 'admin@example.com',
          fullName: 'Admin',
          passwordHash: 'hash',
          role: 'ADMIN',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (directory) {
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !target.includes('marketplate-shops-test-')
      )
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      await rm(target, { recursive: true, force: true });
    }
  });

  const create = () =>
    repository.create(
      createShop({
        id: 'shop-one',
        ownerId: actor.userId,
        name: 'Shop',
        slug: 'shop-one',
        now,
      }),
      actor,
    );

  it.each(['locked', 'deleted', 'transferred', 'suspended'])(
    'rechecks %s state after an earlier manageable-shop check without changing shop data',
    async (change) => {
      const shop = await create();
      await repository.requireManageable(shop.id, actor);
      if (change === 'locked' || change === 'deleted')
        await prisma.user.update({
          where: { id: actor.userId },
          data: change === 'locked' ? { status: 'LOCKED' } : { deletedAt: now },
        });
      else
        await prisma.shop.update({
          where: { id: shop.id },
          data:
            change === 'transferred'
              ? { ownerId: 'other' }
              : { status: 'SUSPENDED' },
        });
      const before = await repository.findById(shop.id);
      await expect(
        repository.save(
          { ...shop, name: 'Must not persist' },
          shop.version,
          actor,
        ),
      ).rejects.toBeInstanceOf(
        change === 'suspended' ? ShopUnavailableError : ShopAccessDeniedError,
      );
      expect(await repository.findById(shop.id)).toEqual(before);
    },
  );

  it('rechecks live administrator privileges before committing a status change', async () => {
    const shop = await create();
    await repository.requireAdministrator(administrator);
    await prisma.user.update({
      where: { id: administrator.userId },
      data: { role: 'USER' },
    });
    await expect(
      repository.saveStatus({ ...shop, status: 'SUSPENDED' }, 0, administrator),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(await repository.findById(shop.id)).toEqual(shop);
  });

  it('does not allow callers to create a shop owned by another account', async () => {
    await expect(
      repository.create(
        createShop({
          id: 'stolen',
          ownerId: 'other',
          name: 'Stolen',
          slug: 'stolen',
          now,
        }),
        actor,
      ),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(await prisma.shop.count()).toBe(0);
  });

  it('allows exactly one writer for an expected revision across independent database connections', async () => {
    const shop = await create();
    const otherPrisma = new PrismaService();
    await otherPrisma.$connect();
    try {
      const writers = [repository, new PrismaShopRepository(otherPrisma)];
      const results = await Promise.allSettled(
        writers.map((writer, index) =>
          writer.save({ ...shop, name: `Writer ${index}` }, 0, actor),
        ),
      );
      const successes = results.filter(
        (result) => result.status === 'fulfilled',
      );
      const failures = results.filter((result) => result.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toBeInstanceOf(ShopVersionConflictError);
      expect(await repository.findById(shop.id)).toEqual(successes[0].value);
    } finally {
      await otherPrisma.$disconnect();
    }
  }, 15_000);
});
