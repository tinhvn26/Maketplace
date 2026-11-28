import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import request from 'supertest';
import { vi } from 'vitest';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { PrismaService } from '../../src/platform/database/prisma.service.js';

export const TEST_PASSWORD = 'IdentityTestPassword123!';
export const TEST_ACCESS_SECRET =
  'identity-test-access-secret-at-least-32-bytes';

export async function createIdentityTestApp(imports: Type<unknown>[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'marketplate-identity-e2e-'));
  vi.stubEnv(
    'DATABASE_URL',
    `file:${join(directory, 'test.db').replaceAll('\\', '/')}`,
  );
  vi.stubEnv('JWT_ACCESS_SECRET', TEST_ACCESS_SECRET);
  vi.stubEnv(
    'JWT_REFRESH_SECRET',
    'identity-test-refresh-secret-at-least-32-bytes',
  );
  vi.stubEnv('IDENTITY_MAIL_TRANSPORT', 'outbox');
  vi.stubEnv('IDENTITY_PUBLIC_APP_URL', '');
  vi.stubEnv('NODE_ENV', 'test');

  const connection = await new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL!,
  }).connect();
  try {
    const migrations = new URL('../../prisma/migrations/', import.meta.url);
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

  const module = await Test.createTestingModule({
    imports: [IdentityModule, ...imports],
  }).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());

  return {
    app,
    prisma,
    http,
    async register(email: string, fullName = 'Identity User') {
      const response = await http()
        .post('/auth/register')
        .send({ email, fullName, password: TEST_PASSWORD })
        .expect(201);
      return response.body as {
        id: string;
        email: string;
        role: string;
        phoneNumber: string | null;
        avatarUrl: string | null;
        emailVerifiedAt: string | null;
        isEmailVerified: boolean;
      };
    },
    async login(email: string, password = TEST_PASSWORD) {
      const response = await http()
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return response.body as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };
    },
    async reset() {
      await prisma.orderLine.deleteMany();
      await prisma.order.deleteMany();
      await prisma.orderCheckout.deleteMany();
      // Inventory rows reference variants and shops with ON DELETE RESTRICT.
      await prisma.inventoryReservation.deleteMany();
      await prisma.inventoryMovement.deleteMany();
      await prisma.inventoryStock.deleteMany();
      await prisma.inventoryWarehouse.deleteMany();
      await prisma.mediaUsage.deleteMany();
      await prisma.catalogReview.deleteMany();
      await prisma.catalogAudit.deleteMany();
      await prisma.catalogVariant.deleteMany();
      await prisma.catalogProduct.deleteMany();
      await prisma.catalogBrand.deleteMany();
      // Self-referencing categories must be detached before bulk deletion.
      await prisma.catalogCategory.updateMany({ data: { parentId: null } });
      await prisma.catalogCategory.deleteMany();
      await prisma.mediaAsset.deleteMany();
      await prisma.shop.deleteMany();
      await prisma.identityMail.deleteMany();
      await prisma.accountAction.deleteMany();
      await prisma.authSession.deleteMany();
      await prisma.user.deleteMany();
      await prisma.rateLimitBucket.deleteMany();
    },
    async close() {
      await app.close();
      vi.unstubAllEnvs();
      const target = resolve(directory);
      const allowed = resolve(tmpdir()) + sep;
      if (
        !target.startsWith(allowed) ||
        !target.includes('marketplate-identity-e2e-')
      ) {
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      }
      await rm(target, { recursive: true, force: true });
    },
  };
}

export type IdentityTestApp = Awaited<ReturnType<typeof createIdentityTestApp>>;
