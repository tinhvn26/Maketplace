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
import { ShopsService } from '../../application/shops.service.js';
import {
  ShopAccessDeniedError,
  ShopUnavailableError,
  ShopVersionConflictError,
} from '../../domain/errors/shop.errors.js';
import { PrismaShopRepository } from './prisma-shop.repository.js';
import { findShopState } from './shop.persistence.js';

describe('ShopsService on PrismaShopRepository security transactions', () => {
  let prisma: PrismaService;
  let repository: PrismaShopRepository;
  let directory: string;
  const actor = { userId: 'owner', role: 'CUSTOMER' as const };
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
          role: 'CUSTOMER',
        },
        {
          id: 'other',
          emailNormalized: 'other@example.com',
          fullName: 'Other',
          passwordHash: 'hash',
          role: 'CUSTOMER',
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

  const service = (repo: PrismaShopRepository = repository) =>
    new ShopsService(repo, { next: () => 'shop-one' }, { now: () => now });
  const create = () =>
    service().create({ name: 'Shop', slug: 'shop-one' }, actor);

  it.each(['locked', 'deleted', 'transferred', 'suspended'])(
    'rechecks %s state after an earlier manageable-shop check without changing shop data',
    async (change) => {
      const shop = await create();
      await service().requireManageable(shop.id, actor);
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
        service().update(
          shop.id,
          { version: shop.version, name: 'Must not persist' },
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
    await prisma.user.update({
      where: { id: administrator.userId },
      data: { role: 'CUSTOMER' },
    });
    await expect(
      service().setStatus(
        shop.id,
        { version: 0, status: 'SUSPENDED' },
        administrator,
      ),
    ).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(await repository.findById(shop.id)).toEqual(shop);
  });

  it('does not create a shop for a locked account', async () => {
    await prisma.user.update({
      where: { id: actor.userId },
      data: { status: 'LOCKED' },
    });
    await expect(create()).rejects.toBeInstanceOf(ShopAccessDeniedError);
    expect(await prisma.shop.count()).toBe(0);
  });

  it('reports owner and sellability to other modules', async () => {
    const shop = await create();
    await expect(findShopState(prisma, shop.id)).resolves.toEqual({
      ownerId: actor.userId,
      sellable: true,
    });
    await prisma.user.update({
      where: { id: actor.userId },
      data: { deletedAt: now },
    });
    await expect(findShopState(prisma, shop.id)).resolves.toEqual({
      ownerId: actor.userId,
      sellable: false,
    });
    await expect(findShopState(prisma, 'missing')).resolves.toBeNull();
  });

  it('allows exactly one writer for an expected revision across independent database connections', async () => {
    const shop = await create();
    const otherPrisma = new PrismaService();
    await otherPrisma.$connect();
    try {
      const writers = [
        service(),
        service(new PrismaShopRepository(otherPrisma)),
      ];
      const results = await Promise.allSettled(
        writers.map((writer, index) =>
          writer.update(
            shop.id,
            { version: 0, name: `Writer ${index}` },
            actor,
          ),
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
