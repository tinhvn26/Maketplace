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
import { PrismaService } from '../../../platform/database/prisma.service.js';
import type { MediaAsset } from '../domain/media-asset.js';
import {
  MediaForbiddenError,
  MediaInUseError,
} from '../domain/media.errors.js';
import { ShopUnavailableError } from '../../shops/contracts/shops.api.js';
import { PrismaMediaRepository } from './prisma-media.repository.js';

describe('PrismaMediaRepository live authorization and usage transactions', () => {
  let directory: string;
  let prisma: PrismaService;
  let repository: PrismaMediaRepository;
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
  const shopId = '33333333-3333-4333-8333-333333333333';
  const id = '44444444-4444-4444-8444-444444444444';
  const actor = { userId: ownerId, role: 'USER' as const };
  const asset = (): MediaAsset => ({
    id,
    shopId,
    ownerId,
    status: 'READY',
    storageKey: `${id}.png`,
    mimeType: 'image/png',
    byteSize: 100,
    width: 2,
    height: 2,
    createdAt: new Date(),
  });

  beforeAll(async () => {
    directory = await mkdtemp(
      join(tmpdir(), 'marketplate-media-repository-test-'),
    );
    const databaseUrl = `file:${join(directory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    const connection = await new PrismaBetterSqlite3({
      url: databaseUrl,
    }).connect();
    try {
      const migrations = new URL(
        '../../../../prisma/migrations/',
        import.meta.url,
      );
      for (const folder of (await readdir(migrations, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))) {
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
    await prisma.$connect();
    repository = new PrismaMediaRepository(prisma);
  });
  beforeEach(async () => {
    await prisma.mediaUsage.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.shop.deleteMany();
    await prisma.user.deleteMany();
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          fullName: 'Owner',
          emailNormalized: 'owner@example.test',
          passwordHash: 'hash',
        },
        {
          id: otherId,
          fullName: 'Other',
          emailNormalized: 'other@example.test',
          passwordHash: 'hash',
        },
      ],
    });
    await prisma.shop.create({
      data: { id: shopId, name: 'Shop', slug: 'shop', ownerId },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (!directory) return;
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !target.includes('marketplate-media-repository-test-')
    )
      throw new Error(
        'Refusing to remove a directory outside the test workspace',
      );
    await rm(target, { recursive: true, force: true });
  });

  it('persists a ready asset for a live owner and deletes only after its final usage is removed', async () => {
    await repository.create(asset(), actor);
    await prisma.mediaUsage.create({
      data: { assetId: id, resourceId: 'product', kind: 'CATALOG_PRODUCT' },
    });
    await expect(repository.deleteUnused(id, actor)).rejects.toBeInstanceOf(
      MediaInUseError,
    );
    expect((await repository.findById(id))?.status).toBe('READY');
    await prisma.mediaUsage.deleteMany({ where: { assetId: id } });
    await repository.deleteUnused(id, actor);
    expect((await repository.findById(id))?.status).toBe('DELETED');
  });

  it('rejects upload persistence if the owner lost the shop during image processing', async () => {
    await prisma.shop.update({
      where: { id: shopId },
      data: { ownerId: otherId },
    });
    await expect(repository.create(asset(), actor)).rejects.toBeInstanceOf(
      MediaForbiddenError,
    );
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it('rejects deletion if ownership changed after the application precheck', async () => {
    await repository.create(asset(), actor);
    await prisma.shop.update({
      where: { id: shopId },
      data: { ownerId: otherId },
    });
    await expect(repository.deleteUnused(id, actor)).rejects.toBeInstanceOf(
      MediaForbiddenError,
    );
    expect((await repository.findById(id))?.status).toBe('READY');
  });

  it('rejects a suspended shop or an actor whose live account was locked', async () => {
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: 'SUSPENDED' },
    });
    await expect(repository.create(asset(), actor)).rejects.toBeInstanceOf(
      ShopUnavailableError,
    );
    await prisma.shop.update({
      where: { id: shopId },
      data: { status: 'ACTIVE' },
    });
    await prisma.user.update({
      where: { id: ownerId },
      data: { status: 'LOCKED' },
    });
    await expect(repository.create(asset(), actor)).rejects.toBeInstanceOf(
      MediaForbiddenError,
    );
  });

  it('does not trust a stale administrator role for platform media', async () => {
    const admin = { userId: ownerId, role: 'ADMIN' as const };
    await prisma.user.update({
      where: { id: ownerId },
      data: { role: 'ADMIN' },
    });
    await prisma.user.update({
      where: { id: ownerId },
      data: { role: 'USER' },
    });
    await expect(
      repository.create({ ...asset(), shopId: null }, admin),
    ).rejects.toBeInstanceOf(MediaForbiddenError);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});
