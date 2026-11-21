import 'reflect-metadata';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { randomUUID } from 'node:crypto';
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
  let migratedProfile: {
    users: Array<{ id: string; phoneNumber: string | null }>;
    profiles: Array<{
      userId: string;
      avatarUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    sessionUserId: string;
    shopOwnerId: string;
    userColumns: string[];
    foreignKeyErrors: unknown[];
  };

  async function createUser(
    role: 'ADMIN' | 'CUSTOMER' = 'CUSTOMER',
  ): Promise<User> {
    const id = randomUUID();
    const now = new Date();
    const account: User = {
      id,
      fullName: role === 'ADMIN' ? 'Administrator' : 'Customer',
      emailNormalized: `${id}@example.com`,
      passwordHash: 'original-hash',
      phoneNumber: null,
      role,
      status: 'ACTIVE',
      emailVerifiedAt: null,
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    return (await repository.create(account, { avatarUrl: null })).user;
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
        if (migration.name === '20261106000000_separate_user_profile') {
          await connection.executeScript(`
            INSERT INTO "User"
              ("id", "fullName", "emailNormalized", "passwordHash", "avatarUrl", "createdAt", "updatedAt", "deletedAt")
            VALUES
              ('legacy-owner', 'Legacy Owner', 'legacy-owner@example.com', 'legacy-hash', 'https://example.com/avatar.png', '2021-01-02T03:04:05.000Z', '2022-02-03T04:05:06.000Z', NULL),
              ('legacy-deleted', 'Deleted Owner', 'legacy-deleted@example.com', 'deleted-hash', NULL, '2021-01-02T03:04:05.000Z', '2022-02-03T04:05:06.000Z', '2023-03-04T05:06:07.000Z');
            INSERT INTO "AuthSession"
              ("id", "userId", "authVersion", "refreshTokenHash", "expiresAt")
            VALUES ('legacy-session', 'legacy-owner', 0, 'legacy-refresh-hash', '2100-01-01T00:00:00.000Z');
            INSERT INTO "Shop" ("id", "name", "slug", "ownerId", "updatedAt")
            VALUES ('legacy-shop', 'Legacy Shop', 'legacy-shop', 'legacy-owner', '2022-02-03T04:05:06.000Z');
          `);
        }
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
    migratedProfile = {
      users: await prisma.user.findMany({
        select: { id: true, phoneNumber: true },
        orderBy: { id: 'asc' },
      }),
      profiles: await prisma.userProfile.findMany({
        orderBy: { userId: 'asc' },
      }),
      sessionUserId: (
        await prisma.authSession.findUniqueOrThrow({
          where: { id: 'legacy-session' },
        })
      ).userId,
      shopOwnerId: (
        await prisma.shop.findUniqueOrThrow({
          where: { id: 'legacy-shop' },
        })
      ).ownerId,
      userColumns: (
        await prisma.$queryRawUnsafe<Array<{ name: string }>>(
          'PRAGMA table_info("User")',
        )
      ).map((column) => column.name),
      foreignKeyErrors: await prisma.$queryRawUnsafe(
        'PRAGMA foreign_key_check',
      ),
    };
  });

  beforeEach(async () => {
    await prisma.shop.deleteMany();
    await prisma.identityMail.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.user.deleteMany();
    user = await createUser();
    await createSession(user.id);
    await createSession(user.id);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (databaseDirectory) {
      const target = resolve(databaseDirectory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !target.includes('marketplate-accounts-')
      ) {
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      }
      await rm(target, { recursive: true, force: true });
    }
  });

  it('migrates every legacy avatar and timestamp without losing user, session or shop references', () => {
    const createdAt = new Date('2021-01-02T03:04:05.000Z');
    const updatedAt = new Date('2022-02-03T04:05:06.000Z');
    expect(migratedProfile.users).toEqual([
      { id: 'legacy-deleted', phoneNumber: null },
      { id: 'legacy-owner', phoneNumber: null },
    ]);
    expect(migratedProfile.profiles).toEqual([
      { userId: 'legacy-deleted', avatarUrl: null, createdAt, updatedAt },
      {
        userId: 'legacy-owner',
        avatarUrl: 'https://example.com/avatar.png',
        createdAt,
        updatedAt,
      },
    ]);
    expect(migratedProfile.sessionUserId).toBe('legacy-owner');
    expect(migratedProfile.shopOwnerId).toBe('legacy-owner');
    expect(migratedProfile.userColumns).toContain('phoneNumber');
    expect(migratedProfile.userColumns).not.toContain('avatarUrl');
    expect(migratedProfile.foreignKeyErrors).toEqual([]);
  });

  it('rolls back every profile migration step if a legacy view prevents dropping avatarUrl', async () => {
    const failureUrl = `file:${join(databaseDirectory, 'migration-failure.db').replaceAll('\\', '/')}`;
    const connection = await new PrismaBetterSqlite3({
      url: failureUrl,
    }).connect();
    try {
      const directory = new URL(
        '../../../../../prisma/migrations/',
        import.meta.url,
      );
      const migrations = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const migration of migrations) {
        if (migration.name === '20261106000000_separate_user_profile') break;
        await connection.executeScript(
          await readFile(
            new URL(`${migration.name}/migration.sql`, directory),
            'utf8',
          ),
        );
      }
      await connection.executeScript(`
        INSERT INTO "User" ("id", "fullName", "emailNormalized", "passwordHash", "avatarUrl", "updatedAt")
        VALUES ('legacy-view-user', 'Legacy Owner', 'legacy-view@example.com', 'legacy-hash', 'https://example.com/legacy.png', CURRENT_TIMESTAMP);
        CREATE VIEW "LegacyAvatarView" AS SELECT id, avatarUrl FROM "User";
      `);
      const migration = await readFile(
        new URL(
          '20261106000000_separate_user_profile/migration.sql',
          directory,
        ),
        'utf8',
      );
      await expect(async () => {
        await connection.executeScript(migration);
      }).rejects.toThrow();
      // executeScript leaves SQLite's failed explicit transaction open. The
      // migration engine closes its connection; the manual adapter needs rollback.
      await connection.executeScript('ROLLBACK;');
      const tables = await connection.queryRaw({
        sql: `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = 'UserProfile'`,
        args: [],
        argTypes: [],
      });
      expect(tables.rows).toEqual([]);
      const columns = await connection.queryRaw({
        sql: 'PRAGMA table_info("User")',
        args: [],
        argTypes: [],
      });
      expect(columns.rows.map((row) => row[1])).toContain('avatarUrl');
      expect(columns.rows.map((row) => row[1])).not.toContain('phoneNumber');
      const legacy = await connection.queryRaw({
        sql: 'SELECT "avatarUrl" FROM "LegacyAvatarView" WHERE "id" = ?',
        args: ['legacy-view-user'],
        argTypes: [{ scalarType: 'string', dbType: 'TEXT', arity: 'scalar' }],
      });
      expect(legacy.rows).toEqual([['https://example.com/legacy.png']]);
    } finally {
      await connection.dispose();
    }
  });

  it('maps account fields separately from its profile projection', async () => {
    const result = await repository.updateProfile(user.id, {
      phoneNumber: '+84901234567',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(result?.user.phoneNumber).toBe('+84901234567');
    expect(result?.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result?.profileUpdatedAt).toBeInstanceOf(Date);
    const credentialUser = await repository.findByEmail(user.emailNormalized);
    expect(credentialUser).toMatchObject({
      id: user.id,
      phoneNumber: '+84901234567',
    });
    expect(credentialUser).not.toHaveProperty('avatarUrl');
    expect((await repository.findProfileById(user.id))?.avatarUrl).toBe(
      result?.avatarUrl,
    );
  });

  it('rolls back account creation if nested profile creation fails', async () => {
    const id = randomUUID();
    const now = new Date();
    const account: User = {
      id,
      fullName: 'New Customer',
      emailNormalized: `${id}@example.com`,
      passwordHash: 'hash',
      phoneNumber: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerifiedAt: null,
      authVersion: 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER prevent_profile_creation BEFORE INSERT ON UserProfile BEGIN SELECT RAISE(ABORT, 'test profile failure'); END",
    );
    try {
      await expect(
        repository.create(account, { avatarUrl: null }),
      ).rejects.toThrow();
      expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER prevent_profile_creation');
    }
  });

  it('changes avatar without mutating account credentials, timestamps or sessions', async () => {
    const before = await repository.findById(user.id);
    await repository.updateProfile(user.id, {
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      avatarUrl: 'https://example.com/new-avatar.png',
    });
    expect(await repository.findById(user.id)).toEqual(before);
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(2);
    expect((await repository.findProfileById(user.id))?.avatarUrl).toBe(
      'https://example.com/new-avatar.png',
    );
  });

  it('preserves omitted profile fields and clears explicitly nullable fields without changing authVersion', async () => {
    await repository.updateProfile(user.id, {
      phoneNumber: '+84901234567',
      avatarUrl: 'https://example.com/avatar.png',
    });
    const renamed = await repository.updateProfile(user.id, {
      fullName: 'Renamed Customer',
    });
    expect(renamed?.user).toMatchObject({
      fullName: 'Renamed Customer',
      phoneNumber: '+84901234567',
      authVersion: 0,
    });
    expect(renamed?.avatarUrl).toBe('https://example.com/avatar.png');
    const cleared = await repository.updateProfile(user.id, {
      phoneNumber: null,
      avatarUrl: null,
    });
    expect(cleared?.user).toMatchObject({
      fullName: 'Renamed Customer',
      phoneNumber: null,
      authVersion: 0,
    });
    expect(cleared?.avatarUrl).toBeNull();
  });

  it('rolls back account name and phone when the profile write fails', async () => {
    const before = await repository.findById(user.id);
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER prevent_profile_change BEFORE UPDATE ON UserProfile BEGIN SELECT RAISE(ABORT, 'test profile failure'); END",
    );
    try {
      await expect(
        repository.updateProfile(user.id, {
          fullName: 'Must Roll Back',
          phoneNumber: '+84901234567',
          avatarUrl: 'https://example.com/failed.png',
        }),
      ).rejects.toThrow();
      expect(await repository.findById(user.id)).toEqual(before);
      expect((await repository.findProfileById(user.id))?.avatarUrl).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER prevent_profile_change');
    }
  });

  it('provides null profile defaults for accounts without a profile row and rejects unavailable profile writes', async () => {
    await prisma.userProfile.delete({ where: { userId: user.id } });
    expect(await repository.findProfileById(user.id)).toMatchObject({
      avatarUrl: null,
      profileUpdatedAt: null,
    });
    await repository.updateProfile(user.id, {
      avatarUrl: 'https://example.com/recreated.png',
    });
    expect((await repository.findProfileById(user.id))?.avatarUrl).toBe(
      'https://example.com/recreated.png',
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'LOCKED' },
    });
    expect(
      await repository.updateProfile(user.id, {
        fullName: 'Must Not Change',
        avatarUrl: null,
      }),
    ).toBeNull();
    expect((await repository.findProfileById(user.id))?.avatarUrl).toBe(
      'https://example.com/recreated.png',
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });
    expect(await repository.findProfileById(user.id)).toBeNull();
  });

  it.each([
    'occupied',
    'stale-password',
    'foreign-session',
    'revoked-session',
    'expired-session',
  ])(
    'rolls back the email and session versions when an email change fails: %s',
    async (reason) => {
      const other = await createUser();
      const session = await createSession(
        reason === 'foreign-session' ? other.id : user.id,
      );
      if (reason === 'revoked-session' || reason === 'expired-session') {
        await prisma.authSession.update({
          where: { id: session.id },
          data:
            reason === 'revoked-session'
              ? { revokedAt: new Date() }
              : { expiresAt: new Date(0) },
        });
      }
      const before = await prisma.authSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      await expect(
        repository.changeEmail(user.id, {
          sessionId: session.id,
          emailNormalized:
            reason === 'occupied' ? other.emailNormalized : 'new@example.com',
          expectedPasswordHash:
            reason === 'stale-password' ? 'stale-hash' : user.passwordHash,
          expectedAuthVersion: user.authVersion,
        }),
      ).rejects.toThrow();
      expect(await repository.findById(user.id)).toEqual(user);
      expect(
        await prisma.authSession.findUniqueOrThrow({
          where: { id: session.id },
        }),
      ).toEqual(before);
    },
  );

  it('changes credentials and revokes every session in the same transaction', async () => {
    const action = await prisma.accountAction.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        purpose: 'VERIFY_EMAIL',
        tokenHash: randomUUID(),
        emailNormalized: user.emailNormalized,
        authVersion: user.authVersion,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const message = await prisma.identityMail.create({
      data: {
        id: randomUUID(),
        actionId: action.id,
        to: user.emailNormalized,
        subject: 'Verification',
        text: 'Old verification token',
        expiresAt: action.expiresAt,
      },
    });
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
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: action.id },
      }),
    ).toMatchObject({ consumedAt: expect.any(Date) });
    expect(
      await prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ text: '', lastError: 'ACCOUNT_ACTION_UNAVAILABLE' });
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
    { role: 'CUSTOMER' as const },
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

  it.each([
    { role: 'CUSTOMER' },
    { status: 'LOCKED' },
    { deletedAt: new Date() },
  ])(
    'rechecks administrator privileges in the mutation transaction: %j',
    async (change) => {
      const actor = await createUser('ADMIN');
      await prisma.user.update({ where: { id: actor.id }, data: change });
      await expect(
        repository.adminUpdate(actor.id, user.id, { role: 'ADMIN' }),
      ).rejects.toBeInstanceOf(AdminRequiredError);
      expect(await repository.findById(user.id)).toMatchObject({
        role: 'CUSTOMER',
        authVersion: 0,
      });
    },
  );

  it('permits administrator changes when another active administrator remains and revokes affected sessions', async () => {
    const actor = await createUser('ADMIN');
    const target = await createUser('ADMIN');
    await createSession(target.id);
    const result = await repository.adminUpdate(actor.id, target.id, {
      role: 'CUSTOMER',
    });
    expect(result.user).toMatchObject({ role: 'CUSTOMER', authVersion: 1 });
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

  it('keeps unchanged administrator role and status updates idempotent without revoking sessions', async () => {
    const actor = await createUser('ADMIN');
    const before = await repository.findById(user.id);
    await repository.adminUpdate(actor.id, user.id, { role: 'CUSTOMER' });
    await repository.adminUpdate(actor.id, user.id, { status: 'ACTIVE' });
    expect(await repository.findById(user.id)).toEqual(before);
    expect(
      await prisma.authSession.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(2);
  });

  it('filters and paginates user searches consistently', async () => {
    const admin = await createUser('ADMIN');
    await repository.adminUpdate(admin.id, user.id, { status: 'LOCKED' });
    const result = await repository.list({
      page: 1,
      limit: 1,
      status: 'LOCKED',
      role: 'CUSTOMER',
      q: user.emailNormalized.toUpperCase(),
    });
    expect(result.total).toBe(1);
    expect(result.users.map((item) => item.user.id)).toEqual([user.id]);
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
      role: 'CUSTOMER',
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
      repository.adminUpdate(first.id, first.id, { role: 'CUSTOMER' }),
      repository.adminUpdate(second.id, second.id, { role: 'CUSTOMER' }),
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
