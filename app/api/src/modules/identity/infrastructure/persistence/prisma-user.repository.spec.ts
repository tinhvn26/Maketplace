import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'node:crypto';
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
import type { User } from '../../domain/entities/user.interface.js';
import {
  AccountChangedError,
  AdminRequiredError,
  LastAdminError,
} from '../../application/errors/users.errors.js';
import { PrismaUserRepository } from './prisma-user.repository.js';
import { bootstrapAdmin } from '../cli/bootstrap-admin.js';

describe('PrismaUserRepository account security transactions', () => {
  let prisma: PrismaService;
  let repository: PrismaUserRepository;
  let databaseDirectory: string;
  let user: User;

  async function createUser(role: 'ADMIN' | 'USER' = 'USER'): Promise<User> {
    const id = randomUUID();
    const now = new Date();
    return repository.create({
      id,
      fullName: role === 'ADMIN' ? 'Administrator' : 'Customer',
      emailNormalized: `${id}@example.com`,
      passwordHash: 'original-hash',
      avatarUrl: null,
      status: 'ACTIVE',
      role,
      emailVerifiedAt: null,
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  async function createSession(userId: string) {
    return prisma.authSession.create({
      data: {
        id: randomUUID(),
        userId,
        authVersion: 0,
        refreshTokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  }

  beforeAll(async () => {
    databaseDirectory = await mkdtemp(join(tmpdir(), 'marketplate-accounts-'));
    const databaseUrl = `file:${join(databaseDirectory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    const connection = await new PrismaBetterSqlite3({
      url: databaseUrl,
    }).connect();
    try {
      const directory = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      const migrations = await readdir(directory, { withFileTypes: true });
      for (const migration of migrations
        .filter((item) => item.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        await connection.executeScript(
          await readFile(
            new URL(`${migration.name}/migration.sql`, directory),
            'utf8',
          ),
        );
      }
    } finally {
      await connection.dispose();
    }
    prisma = new PrismaService();
    await prisma.$connect();
    repository = new PrismaUserRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    user = await createUser();
    await createSession(user.id);
    await createSession(user.id);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (databaseDirectory)
      await rm(databaseDirectory, { recursive: true, force: true });
  });

  it.each(['occupied', 'stale-password', 'foreign-session', 'revoked-session', 'expired-session'])(
    'rolls back the email and session versions when an email change fails: %s',
    async (reason) => {
      const other = await createUser();
      const session = await createSession(reason === 'foreign-session' ? other.id : user.id);
      if (reason === 'revoked-session' || reason === 'expired-session') {
        await prisma.authSession.update({
          where: { id: session.id },
          data: reason === 'revoked-session'
            ? { revokedAt: new Date() }
            : { expiresAt: new Date(0) },
        });
      }
      const before = await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } });
      await expect(repository.changeEmail(user.id, {
        sessionId: session.id,
        emailNormalized: reason === 'occupied' ? other.emailNormalized : 'new@example.com',
        expectedPasswordHash: reason === 'stale-password' ? 'stale-hash' : user.passwordHash,
        expectedAuthVersion: user.authVersion,
      })).rejects.toThrow();
      expect(await repository.findById(user.id)).toEqual(user);
      expect(await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } })).toEqual(before);
    },
  );

  it('changes credentials and revokes every session in the same transaction', async () => {
    await repository.changePassword(user.id, {
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
      passwordHash: 'replacement-hash',
    });
    expect(await repository.findById(user.id)).toMatchObject({
      passwordHash: 'replacement-hash',
      authVersion: 1,
    });
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it.each(['password', 'version', 'locked', 'deleted'])(
    'rejects stale credential proof after the account is %s without a partial mutation',
    async (change) => {
      await prisma.user.update({
        where: { id: user.id },
        data:
          change === 'password'
            ? { passwordHash: 'already-changed' }
            : change === 'version'
              ? { authVersion: 1 }
              : change === 'locked'
                ? { status: 'LOCKED' }
                : { deletedAt: new Date() },
      });
      await expect(
        repository.changePassword(user.id, {
          expectedPasswordHash: user.passwordHash,
          expectedAuthVersion: user.authVersion,
          passwordHash: 'must-not-be-written',
        }),
      ).rejects.toBeInstanceOf(AccountChangedError);
      const persisted = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(persisted.passwordHash).not.toBe('must-not-be-written');
      expect(
        await prisma.authSession.count({
          where: { userId: user.id, revokedAt: null },
        }),
      ).toBe(2);
    },
  );

  it('rolls back a password change if session revocation fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER prevent_session_revocation BEFORE UPDATE ON AuthSession BEGIN SELECT RAISE(ABORT, 'test revocation failure'); END",
    );
    try {
      await expect(
        repository.changePassword(user.id, {
          expectedPasswordHash: user.passwordHash,
          expectedAuthVersion: user.authVersion,
          passwordHash: 'must-roll-back',
        }),
      ).rejects.toThrow();
      expect(await repository.findById(user.id)).toMatchObject({
        passwordHash: user.passwordHash,
        authVersion: 0,
      });
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER prevent_session_revocation');
    }
  });

  it('soft-deletes an account, revokes its sessions, and excludes it from lookups and lists', async () => {
    await repository.deleteOwnAccount(user.id, {
      expectedPasswordHash: user.passwordHash,
      expectedAuthVersion: user.authVersion,
    });
    expect(await repository.findById(user.id)).toBeNull();
    expect(await repository.findByEmail(user.emailNormalized)).toBeNull();
    expect(await repository.list({ page: 1, limit: 20 })).toEqual({
      users: [],
      total: 0,
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ deletedAt: expect.any(Date), authVersion: 1 });
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('prevents the last administrator from deleting their own account', async () => {
    const admin = await createUser('ADMIN');
    await expect(
      repository.deleteOwnAccount(admin.id, {
        expectedPasswordHash: admin.passwordHash,
        expectedAuthVersion: admin.authVersion,
      }),
    ).rejects.toBeInstanceOf(LastAdminError);
    expect(await repository.findById(admin.id)).toMatchObject({
      role: 'ADMIN',
      status: 'ACTIVE',
      authVersion: 0,
    });
  });

  it.each([
    { role: 'USER' as const },
    { status: 'LOCKED' as const },
    { deleted: true as const },
  ])(
    'rejects removal of the final active administrator: %j',
    async (change) => {
      const admin = await createUser('ADMIN');
      await createSession(admin.id);
      await expect(
        repository.adminUpdate(admin.id, admin.id, change),
      ).rejects.toBeInstanceOf(LastAdminError);
      expect(await repository.findById(admin.id)).toMatchObject({
        role: 'ADMIN',
        status: 'ACTIVE',
        authVersion: 0,
      });
      expect(
        await prisma.authSession.count({
          where: { userId: admin.id, revokedAt: null },
        }),
      ).toBe(1);
    },
  );

  it.each([{ role: 'USER' }, { status: 'LOCKED' }, { deletedAt: new Date() }])(
    'rechecks administrator privileges in the mutation transaction: %j',
    async (change) => {
      const actor = await createUser('ADMIN');
      await prisma.user.update({ where: { id: actor.id }, data: change });
      await expect(
        repository.adminUpdate(actor.id, user.id, { role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(AdminRequiredError);
      expect(await repository.findById(user.id)).toMatchObject({
        role: 'USER',
        authVersion: 0,
      });
    },
  );

  it('permits administrator changes when another active administrator remains and revokes affected sessions', async () => {
    const actor = await createUser('ADMIN');
    const target = await createUser('ADMIN');
    await createSession(target.id);
    const result = await repository.adminUpdate(actor.id, target.id, {
      role: 'USER',
    });
    expect(result).toMatchObject({ role: 'USER', authVersion: 1 });
    expect(
      await prisma.authSession.count({
        where: { userId: target.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(await repository.findById(actor.id)).toMatchObject({
      role: 'ADMIN',
      status: 'ACTIVE',
      authVersion: 0,
    });
  });

  it('filters and paginates user searches consistently', async () => {
    const admin = await createUser('ADMIN');
    await repository.adminUpdate(admin.id, user.id, { status: 'LOCKED' });
    const result = await repository.list({
      page: 1,
      limit: 1,
      status: 'LOCKED',
      role: 'USER',
      q: user.emailNormalized.toUpperCase(),
    });
    expect(result.total).toBe(1);
    expect(result.users.map((item) => item.id)).toEqual([user.id]);
    expect(
      await repository.list({ page: 2, limit: 1, status: 'LOCKED' }),
    ).toEqual({ users: [], total: 1 });
  });

  it('bootstraps the first administrator and revokes previous sessions', async () => {
    expect(
      await bootstrapAdmin(prisma, `  ${user.emailNormalized.toUpperCase()}  `),
    ).toEqual({
      id: user.id,
      email: user.emailNormalized,
      alreadyAdmin: false,
    });
    expect(await repository.findById(user.id)).toMatchObject({
      role: 'ADMIN',
      authVersion: 1,
    });
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('keeps repeated bootstrap idempotent without invalidating subsequent sessions', async () => {
    await bootstrapAdmin(prisma, user.emailNormalized);
    const promoted = await repository.findById(user.id);
    await createSession(user.id);
    expect(await bootstrapAdmin(prisma, user.emailNormalized)).toMatchObject({
      alreadyAdmin: true,
    });
    expect(await repository.findById(user.id)).toEqual(promoted);
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('refuses bootstrap of an additional administrator', async () => {
    await createUser('ADMIN');
    await expect(bootstrapAdmin(prisma, user.emailNormalized)).rejects.toThrow(
      'An active administrator already exists',
    );
    expect(await repository.findById(user.id)).toMatchObject({
      role: 'USER',
      authVersion: 0,
    });
  });

  it.each([{ status: 'LOCKED' }, { deletedAt: new Date() }])(
    'refuses bootstrap for an unavailable account: %j',
    async (change) => {
      await prisma.user.update({ where: { id: user.id }, data: change });
      await expect(
        bootstrapAdmin(prisma, user.emailNormalized),
      ).rejects.toThrow('An active, nondeleted account');
    },
  );

  it('serializes concurrent bootstrap attempts so only one account gains administrator privileges', async () => {
    const other = await createUser();
    const results = await Promise.allSettled([
      bootstrapAdmin(prisma, user.emailNormalized),
      bootstrapAdmin(prisma, other.emailNormalized),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      }),
    ).toBe(1);
  });

  it('preserves an active administrator during concurrent self-demotions', async () => {
    const first = await createUser('ADMIN');
    const second = await createUser('ADMIN');
    const results = await Promise.allSettled([
      repository.adminUpdate(first.id, first.id, { role: 'USER' }),
      repository.adminUpdate(second.id, second.id, { role: 'USER' }),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(
      await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      }),
    ).toBe(1);
  });
});
