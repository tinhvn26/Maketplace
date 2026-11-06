import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { IdentityModule } from '../src/modules/identity/identity.module.js';
import { PrismaService } from '../src/platform/database/prisma.service.js';

const accessSecret = 'user-http-access-secret-at-least-32-bytes';
const refreshSecret = 'user-http-refresh-secret-at-least-32-bytes';
const password = 'UserHttpTestPassword123!';
const avatarUrl = 'https://example.com/avatar.png';

interface Profile {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

describe('User profile HTTP API', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService;
  let databaseDirectory: string | undefined;
  let profile: Profile;
  let otherProfile: Profile;
  let tokens: AuthTokens;

  function http() {
    return request(app!.getHttpServer());
  }

  function authenticatedPatch(body: Record<string, unknown>) {
    return http()
      .patch('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send(body);
  }

  async function registerUser(
    fullName: string,
    email: string,
  ): Promise<Profile> {
    const response = await http()
      .post('/auth/register')
      .send({ fullName, email, password })
      .expect(201);
    return response.body as Profile;
  }

  beforeAll(async () => {
    // Always create a separate database before constructing the real module.
    // Neither PrismaService's fallback nor the developer's DATABASE_URL is used.
    databaseDirectory = await mkdtemp(join(tmpdir(), 'marketplate-user-e2e-'));
    const databaseUrl = `file:${join(databaseDirectory, 'test.db').replaceAll('\\', '/')}`;
    vi.stubEnv('DATABASE_URL', databaseUrl);
    vi.stubEnv('JWT_ACCESS_SECRET', accessSecret);
    vi.stubEnv('JWT_REFRESH_SECRET', refreshSecret);
    vi.stubEnv('IDENTITY_MAIL_TRANSPORT', 'outbox');
    vi.stubEnv('NODE_ENV', 'test');

    const migrationConnection = await new PrismaBetterSqlite3({
      url: databaseUrl,
    }).connect();
    try {
      const migrationsDirectory = new URL(
        '../prisma/migrations/',
        import.meta.url,
      );
      const migrations = await readdir(migrationsDirectory, {
        withFileTypes: true,
      });
      for (const migration of migrations
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const sql = await readFile(
          new URL(`${migration.name}/migration.sql`, migrationsDirectory),
          'utf8',
        );
        await migrationConnection.executeScript(sql);
      }
    } finally {
      await migrationConnection.dispose();
    }

    const module = await Test.createTestingModule({
      imports: [IdentityModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    profile = await registerUser('First User', 'first@example.com');
    otherProfile = await registerUser('Other User', 'other@example.com');
    const login = await http()
      .post('/auth/login')
      .send({ email: profile.email, password })
      .expect(200);
    tokens = login.body as AuthTokens;
  }, 30_000);

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: profile.id },
      data: {
        fullName: profile.fullName,
        avatarUrl: null,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
    if (databaseDirectory) {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  });

  it('returns only the signed-in user’s public profile', async () => {
    const response = await http()
      .get('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      id: profile.id,
      fullName: profile.fullName,
      email: profile.email,
      avatarUrl: null,
      status: 'ACTIVE',
      role: 'USER',
      emailVerifiedAt: null,
      createdAt: profile.createdAt,
      updatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(response.body.updatedAt))).toBe(false);
  });

  it('trims and persists profile edits without changing another account', async () => {
    const response = await authenticatedPatch({
      fullName: '  Updated Name  ',
      avatarUrl,
    }).expect(200);

    expect(response.body).toEqual({
      id: profile.id,
      fullName: 'Updated Name',
      email: profile.email,
      avatarUrl,
      status: 'ACTIVE',
      role: 'USER',
      emailVerifiedAt: null,
      createdAt: profile.createdAt,
      updatedAt: expect.any(String),
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: profile.id } }),
    ).toMatchObject({ fullName: 'Updated Name', avatarUrl });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: otherProfile.id } }),
    ).toMatchObject({ fullName: otherProfile.fullName, avatarUrl: null });

    const fetched = await http()
      .get('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(fetched.body).toEqual(response.body);
  });

  it('preserves an omitted avatar and clears it only when explicitly null', async () => {
    await authenticatedPatch({ avatarUrl }).expect(200);
    const nameEdit = await authenticatedPatch({ fullName: 'New Name' }).expect(
      200,
    );
    expect(nameEdit.body.avatarUrl).toBe(avatarUrl);

    const avatarEdit = await authenticatedPatch({ avatarUrl: null }).expect(
      200,
    );
    expect(avatarEdit.body).toMatchObject({
      fullName: 'New Name',
      avatarUrl: null,
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: profile.id } }),
    ).toMatchObject({ fullName: 'New Name', avatarUrl: null });
  });

  it('rejects an attempt to select another user or edit protected fields', async () => {
    await authenticatedPatch({
      id: otherProfile.id,
      fullName: 'Hijacked',
      email: 'changed@example.com',
      passwordHash: 'replacement',
      status: 'LOCKED',
    }).expect(400);

    for (const account of [profile, otherProfile]) {
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: account.id } }),
      ).toMatchObject({
        fullName: account.fullName,
        emailNormalized: account.email,
        status: 'ACTIVE',
      });
    }
  });

  it.each([
    ['an empty patch', {}],
    ['a null name', { fullName: null }],
    ['a blank name', { fullName: '   ' }],
    ['a non-string name', { fullName: 42 }],
    ['a name longer than 100 characters', { fullName: 'a'.repeat(101) }],
    ['an empty avatar', { avatarUrl: '' }],
    ['an avatar without a protocol', { avatarUrl: 'example.com/avatar.png' }],
    ['a non-HTTP avatar', { avatarUrl: 'ftp://example.com/avatar.png' }],
    ['a script avatar', { avatarUrl: 'javascript:alert(1)' }],
    ['a non-string avatar', { avatarUrl: false }],
    [
      'an avatar longer than 2048 characters',
      { avatarUrl: `https://example.com/${'a'.repeat(2048)}` },
    ],
    ['an unknown field', { fullName: 'Valid Name', unexpected: true }],
  ])(
    'rejects %s without changing persisted profile data',
    async (_label, body) => {
      await authenticatedPatch(body as Record<string, unknown>).expect(400);
      expect(
        await prisma.user.findUniqueOrThrow({ where: { id: profile.id } }),
      ).toMatchObject({ fullName: profile.fullName, avatarUrl: null });
    },
  );

  it('rejects missing, malformed, expired, and wrong-purpose authorization for reads and edits', async () => {
    const jwt = new JwtService();
    const expiredToken = await jwt.signAsync(
      { sub: profile.id, tokenType: 'access' },
      { secret: accessSecret, expiresIn: -1 },
    );
    const wrongPurposeToken = await jwt.signAsync(
      { sub: profile.id, tokenType: 'refresh' },
      { secret: accessSecret, expiresIn: 900 },
    );
    const authorizations = [
      undefined,
      'Basic credentials',
      'Bearer not-a-token',
      `Bearer ${tokens.accessToken} extra`,
      `Bearer ${tokens.refreshToken}`,
      `Bearer ${expiredToken}`,
      `Bearer ${wrongPurposeToken}`,
    ];

    for (const authorization of authorizations) {
      const get = http().get('/user/me');
      if (authorization) {
        get.set('Authorization', authorization);
      }
      await get.expect(401);

      const patch = http().patch('/user/me').send({ fullName: 'Unauthorized' });
      if (authorization) {
        patch.set('Authorization', authorization);
      }
      await patch.expect(401);
    }
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: profile.id } }),
    ).toMatchObject({ fullName: profile.fullName });
  });

  it.each([
    ['locked', { status: 'LOCKED' }],
    ['deleted', { deletedAt: new Date() }],
  ])('rejects an existing token after its user is %s', async (_label, data) => {
    await prisma.user.update({ where: { id: profile.id }, data });

    await http()
      .get('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);
    await authenticatedPatch({ fullName: 'Unauthorized' }).expect(401);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: profile.id } }),
    ).toMatchObject({ fullName: profile.fullName });
  });

  it('rejects a validly signed access token for a nonexistent user', async () => {
    const accessToken = await new JwtService().signAsync(
      { sub: 'nonexistent-user', tokenType: 'access' },
      { secret: accessSecret, expiresIn: 900 },
    );
    await http()
      .get('/user/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await http()
      .patch('/user/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ fullName: 'Unauthorized' })
      .expect(401);
  });
});
