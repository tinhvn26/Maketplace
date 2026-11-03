import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import type { AuthSession } from '../../application/ports/session.repository.js';
import { PrismaSessionRepository } from './prisma-session.repository.js';

describe('PrismaSessionRepository with SQLite', () => {
  let prisma: PrismaService;
  let repository: PrismaSessionRepository;
  let directory: string;
  const now = new Date();

  function session(
    id = 'session-one',
    overrides: Partial<AuthSession> = {},
  ): AuthSession {
    return {
      id,
      userId: 'user-one',
      authVersion: 3,
      refreshTokenHash: 'original-hash',
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + 604800000),
      revokedAt: null,
      ...overrides,
    };
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-session-test-'));
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
    await prisma.$connect();
    repository = new PrismaSessionRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.user.createMany({
      data: [
        {
          id: 'user-one',
          fullName: 'First User',
          emailNormalized: 'first@example.com',
          passwordHash: 'hash',
          authVersion: 3,
        },
        {
          id: 'user-two',
          fullName: 'Second User',
          emailNormalized: 'second@example.com',
          passwordHash: 'hash',
          authVersion: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('creates a session only for the active credential snapshot', async () => {
    expect(await repository.createIfActive(session())).toBe(true);
    expect(
      await repository.createIfActive(session('stale', { authVersion: 2 })),
    ).toBe(false);
    expect(await prisma.authSession.count()).toBe(1);
    expect(
      (await repository.findActive('session-one', 'user-one', now))?.role,
    ).toBe('USER');
  });

  it('preserves the profile update timestamp when creating a login session', async () => {
    const updatedAt = new Date('2020-01-02T03:04:05.000Z');
    await prisma.user.update({
      where: { id: 'user-one' },
      data: { updatedAt },
    });
    expect(await repository.createIfActive(session())).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: 'user-one' },
    });
    expect(user.updatedAt).toEqual(updatedAt);
    expect(user.authVersion).toBe(3);
  });

  it.each([{ status: 'LOCKED' }, { deletedAt: new Date() }])(
    'rejects new sessions for unavailable users %j',
    async (change) => {
      await prisma.user.update({ where: { id: 'user-one' }, data: change });
      expect(await repository.createIfActive(session())).toBe(false);
      expect(await prisma.authSession.count()).toBe(0);
    },
  );

  it('reads the live role and rejects a credential version changed after login', async () => {
    await repository.createIfActive(session());
    await prisma.user.update({
      where: { id: 'user-one' },
      data: { role: 'ADMIN' },
    });
    expect(
      (await repository.findActive('session-one', 'user-one', now))?.role,
    ).toBe('ADMIN');
    await prisma.user.update({
      where: { id: 'user-one' },
      data: { authVersion: 4 },
    });
    expect(
      await repository.findActive('session-one', 'user-one', now),
    ).toBeNull();
    expect(
      await repository.rotateRefreshToken(
        'session-one',
        'user-one',
        'original-hash',
        'replacement',
        now,
      ),
    ).toBe(false);
  });

  it('rotates once, preserves absolute expiry, and revokes upon old-token replay', async () => {
    const created = session();
    await repository.createIfActive(created);
    expect(
      await repository.rotateRefreshToken(
        created.id,
        created.userId,
        'original-hash',
        'replacement',
        now,
      ),
    ).toBe(true);
    expect(
      await prisma.authSession.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({
      refreshTokenHash: 'replacement',
      expiresAt: created.expiresAt,
      revokedAt: null,
    });
    expect(
      await repository.rotateRefreshToken(
        created.id,
        created.userId,
        'original-hash',
        'stolen-replacement',
        now,
      ),
    ).toBe(false);
    expect(
      await repository.findActive(created.id, created.userId, now),
    ).toBeNull();
    expect(
      await repository.rotateRefreshToken(
        created.id,
        created.userId,
        'replacement',
        'replacement-two',
        now,
      ),
    ).toBe(false);
  });

  it('allows only one concurrent refresh and revokes the replayed session', async () => {
    await repository.createIfActive(session());
    const results = await Promise.all([
      repository.rotateRefreshToken(
        'session-one',
        'user-one',
        'original-hash',
        'first',
        now,
      ),
      repository.rotateRefreshToken(
        'session-one',
        'user-one',
        'original-hash',
        'second',
        now,
      ),
    ]);
    expect(results.filter((result) => result)).toHaveLength(1);
    expect(
      await repository.findActive('session-one', 'user-one', now),
    ).toBeNull();
  });

  it('never reads, rotates, or revokes another owner session', async () => {
    await repository.createIfActive(session());
    expect(
      await repository.findActive('session-one', 'user-two', now),
    ).toBeNull();
    expect(
      await repository.rotateRefreshToken(
        'session-one',
        'user-two',
        'original-hash',
        'foreign',
        now,
      ),
    ).toBe(false);
    await repository.revoke('session-one', 'user-two', now);
    expect(
      await repository.findActive('session-one', 'user-one', now),
    ).not.toBeNull();
  });

  it('revokes all own sessions and invalidates a login verified before logout-all', async () => {
    await repository.createIfActive(session());
    await repository.createIfActive(session('session-two'));
    await repository.createIfActive(
      session('other-user-session', { userId: 'user-two', authVersion: 0 }),
    );
    await repository.revokeAll('user-one', now);
    expect(await repository.listActive('user-one', now)).toEqual([]);
    expect(await repository.createIfActive(session('in-flight-login'))).toBe(
      false,
    );
    expect(
      await repository.createIfActive(
        session('fresh-login', { authVersion: 4 }),
      ),
    ).toBe(true);
    expect(
      await repository.findActive('other-user-session', 'user-two', now),
    ).not.toBeNull();
  });

  it('excludes revoked, expired, and stale-version sessions from active listings', async () => {
    await prisma.authSession.createMany({
      data: [
        session('active'),
        session('revoked', { revokedAt: now }),
        session('expired', { expiresAt: now }),
        session('stale', { authVersion: 2 }),
      ],
    });
    expect(
      (await repository.listActive('user-one', now)).map((entry) => entry.id),
    ).toEqual(['active']);
    expect(await repository.findActive('expired', 'user-one', now)).toBeNull();
    expect(await repository.findActive('revoked', 'user-one', now)).toBeNull();
  });
});
