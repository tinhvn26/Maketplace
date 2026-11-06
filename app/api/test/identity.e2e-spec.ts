import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createIdentityTestApp,
  type IdentityTestApp,
  TEST_PASSWORD,
} from './support/identity-app.js';

describe('Identity authentication and account HTTP flows', () => {
  let test: IdentityTestApp;
  beforeAll(async () => {
    test = await createIdentityTestApp();
  });
  beforeEach(async () => {
    await test.reset();
  });
  afterAll(async () => {
    await test?.close();
  });

  const me = (token: string) =>
    test.http().get('/user/me').auth(token, { type: 'bearer' });
  const refresh = (token: string) =>
    test.http().post('/auth/refresh').send({ refreshToken: token });
  async function createAdmin() {
    const user = await test.register('admin@example.com', 'Admin');
    await test.prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
    });
    return { ...user, ...(await test.login(user.email)) };
  }

  it('normalizes registration, queues verification and never accepts public privilege assignment', async () => {
    const user = await test.register('  New.User@Example.com  ');
    expect(user).toMatchObject({
      email: 'new.user@example.com',
      role: 'USER',
      emailVerifiedAt: null,
    });
    expect(Object.keys(user).sort()).toEqual(
      [
        'id',
        'fullName',
        'email',
        'avatarUrl',
        'status',
        'role',
        'emailVerifiedAt',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(await test.prisma.identityMail.count()).toBe(1);
    await test
      .http()
      .post('/auth/register')
      .send({
        fullName: 'Duplicate',
        email: 'NEW.USER@example.com',
        password: TEST_PASSWORD,
      })
      .expect(409);
    await test
      .http()
      .post('/auth/register')
      .send({
        fullName: 'Attack',
        email: 'attack@example.com',
        password: TEST_PASSWORD,
        role: 'ADMIN',
      })
      .expect(400);
    await test
      .http()
      .post('/auth/register')
      .send({ fullName: '   ', email: 'blank@example.com', password: 'short' })
      .expect(400);
    const tokens = await test.login('  NEW.USER@EXAMPLE.COM  ');
    expect(tokens.expiresIn).toBe(900);
    const response = await me(tokens.accessToken).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each(['"a b"@example.com', '"a@b"@example.com'])(
    'preserves registration and login support for quoted email addresses: %s',
    async (email) => {
      const user = await test.register(email);
      expect(user.email).toBe(email);
      expect(await test.prisma.identityMail.count()).toBe(1);
      const tokens = await test.login(email);
      const profile = await me(tokens.accessToken).expect(200);
      expect(profile.body.email).toBe(email);
    },
  );

  it('preserves Unicode character limits through registration, hashing and login', async () => {
    const fullName = '🙂'.repeat(100);
    const password = '🔐'.repeat(128);
    const registration = {
      fullName,
      email: '用户@example.com',
      password,
    };
    const response = await test
      .http()
      .post('/auth/register')
      .send(registration)
      .expect(201);
    expect(response.body.fullName).toBe(fullName);
    expect(response.body.email).toBe(registration.email);
    const tokens = await test.login(registration.email, password);
    await me(tokens.accessToken).expect(200);
    const replacementPassword = 'replacement-unicode-password';
    await test
      .http()
      .post('/user/me/change-password')
      .auth(tokens.accessToken, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: replacementPassword })
      .expect(204);
    await me(tokens.accessToken).expect(401);
    await test.login(registration.email, replacementPassword);

    for (const changes of [
      { fullName: '🙂'.repeat(101) },
      { password: '🔐'.repeat(7) },
      { password: '🔐'.repeat(129) },
    ]) {
      await test
        .http()
        .post('/auth/register')
        .send({ ...registration, email: 'invalid@example.com', ...changes })
        .expect(400);
    }
    await test
      .http()
      .post('/auth/register')
      .send({
        ...registration,
        email: 'minimum@example.com',
        password: '🔐'.repeat(8),
      })
      .expect(201);
  });

  it('rejects bad credentials and validates bounded login/refresh payloads', async () => {
    const user = await test.register('user@example.com');
    const known = await test
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: 'incorrect' })
      .expect(401);
    const unknown = await test
      .http()
      .post('/auth/login')
      .send({ email: 'absent@example.com', password: 'incorrect' })
      .expect(401);
    expect(known.body).toEqual(unknown.body);
    await test
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: 'x'.repeat(129) })
      .expect(400);
    await refresh('x'.repeat(4097)).expect(400);
    await refresh('not-a-jwt').expect(401);
  });

  it('lists only owned sessions and never leaks refresh hashes', async () => {
    const user = await test.register('user@example.com');
    const first = await test.login(user.email);
    await test.login(user.email);
    const other = await test.register('other@example.com');
    await test.login(other.email);
    const sessions = await test
      .http()
      .get('/auth/sessions')
      .auth(first.accessToken, { type: 'bearer' })
      .expect(200);
    expect(sessions.body).toHaveLength(2);
    expect(
      sessions.body.filter((session: { current: boolean }) => session.current),
    ).toHaveLength(1);
    for (const session of sessions.body) {
      expect(Object.keys(session).sort()).toEqual(
        ['id', 'createdAt', 'lastUsedAt', 'expiresAt', 'current'].sort(),
      );
    }
  });

  it('rotates refresh tokens and revokes the session when an old token is reused', async () => {
    const user = await test.register('user@example.com');
    const initial = await test.login(user.email);
    const independent = await test.login(user.email);
    const rotated = await refresh(initial.refreshToken).expect(200);
    expect(rotated.body.refreshToken).not.toBe(initial.refreshToken);
    await me(rotated.body.accessToken).expect(200);
    await refresh(initial.refreshToken).expect(401);
    await me(initial.accessToken).expect(401);
    await me(rotated.body.accessToken).expect(401);
    await refresh(rotated.body.refreshToken).expect(401);
    await me(independent.accessToken).expect(200);
  });

  it('logs out one session immediately and keeps other devices signed in', async () => {
    const user = await test.register('user@example.com');
    const one = await test.login(user.email);
    const two = await test.login(user.email);
    await test
      .http()
      .post('/auth/logout')
      .auth(one.accessToken, { type: 'bearer' })
      .expect(204);
    await me(one.accessToken).expect(401);
    await refresh(one.refreshToken).expect(401);
    await me(two.accessToken).expect(200);
  });

  it('revokes a chosen owned session and does not revoke another account’s session', async () => {
    const user = await test.register('user@example.com');
    const one = await test.login(user.email);
    const two = await test.login(user.email);
    const other = await test.register('other@example.com');
    const otherTokens = await test.login(other.email);
    const sessions = await test
      .http()
      .get('/auth/sessions')
      .auth(one.accessToken, { type: 'bearer' });
    const second = sessions.body.find(
      (session: { current: boolean }) => !session.current,
    );
    await test
      .http()
      .delete(`/auth/sessions/${second.id}`)
      .auth(one.accessToken, { type: 'bearer' })
      .expect(204);
    await me(two.accessToken).expect(401);
    const foreign = await test.prisma.authSession.findFirstOrThrow({
      where: { userId: other.id },
    });
    await test
      .http()
      .delete(`/auth/sessions/${foreign.id}`)
      .auth(one.accessToken, { type: 'bearer' })
      .expect(204);
    await me(otherTokens.accessToken).expect(200);
    await test
      .http()
      .delete('/auth/sessions/not-an-id')
      .auth(one.accessToken, { type: 'bearer' })
      .expect(400);
  });

  it('logs out every existing session and permits a fresh login', async () => {
    const user = await test.register('user@example.com');
    const one = await test.login(user.email);
    const two = await test.login(user.email);
    await test
      .http()
      .post('/auth/logout-all')
      .auth(one.accessToken, { type: 'bearer' })
      .expect(204);
    for (const tokens of [one, two]) {
      await me(tokens.accessToken).expect(401);
      await refresh(tokens.refreshToken).expect(401);
    }
    await me((await test.login(user.email)).accessToken).expect(200);
  });

  it('changes password only after current-password verification and revokes every session', async () => {
    const user = await test.register('user@example.com');
    const one = await test.login(user.email);
    const two = await test.login(user.email);
    const passwordChange = (currentPassword: string, newPassword: string) =>
      test
        .http()
        .post('/user/me/change-password')
        .auth(one.accessToken, { type: 'bearer' })
        .send({ currentPassword, newPassword });
    await passwordChange('wrong-password', 'NewPassword123!').expect(401);
    await passwordChange(TEST_PASSWORD, 'short').expect(400);
    await me(one.accessToken).expect(200);
    await passwordChange(TEST_PASSWORD, 'NewPassword123!').expect(204);
    for (const tokens of [one, two]) {
      await me(tokens.accessToken).expect(401);
      await refresh(tokens.refreshToken).expect(401);
    }
    await test
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    await me(
      (await test.login(user.email, 'NewPassword123!')).accessToken,
    ).expect(200);
  });

  it('soft-deletes the current account and blocks login and token reuse', async () => {
    const user = await test.register('user@example.com');
    const tokens = await test.login(user.email);
    await test
      .http()
      .delete('/user/me')
      .auth(tokens.accessToken, { type: 'bearer' })
      .send({ currentPassword: 'wrong' })
      .expect(401);
    await test
      .http()
      .delete('/user/me')
      .auth(tokens.accessToken, { type: 'bearer' })
      .send({ currentPassword: TEST_PASSWORD })
      .expect(204);
    const stored = await test.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.deletedAt).not.toBeNull();
    await me(tokens.accessToken).expect(401);
    await refresh(tokens.refreshToken).expect(401);
    await test
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    await test
      .http()
      .post('/auth/register')
      .send({
        fullName: 'Re-register',
        email: user.email,
        password: TEST_PASSWORD,
      })
      .expect(409);
  });

  it('denies admin routes to ordinary users and unauthenticated callers', async () => {
    const user = await test.register('user@example.com');
    const tokens = await test.login(user.email);
    await test.http().get('/admin/users').expect(401);
    await test
      .http()
      .get('/admin/users')
      .auth(tokens.accessToken, { type: 'bearer' })
      .expect(403);
    await test
      .http()
      .patch(`/admin/users/${user.id}/role`)
      .auth(tokens.accessToken, { type: 'bearer' })
      .send({ role: 'ADMIN' })
      .expect(403);
    await test
      .http()
      .delete(`/admin/users/${user.id}`)
      .auth(tokens.accessToken, { type: 'bearer' })
      .expect(403);
  });

  it('provides bounded searchable admin pagination and safe user details', async () => {
    const admin = await createAdmin();
    const target = await test.register('findme@example.com', 'Find Me');
    await test.register('other@example.com', 'Other');
    const result = await test
      .http()
      .get('/admin/users?q=findme&role=USER&page=1&limit=1')
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(200);
    expect(result.body).toMatchObject({
      total: 1,
      page: 1,
      limit: 1,
      pages: 1,
      users: [{ id: target.id }],
    });
    expect(JSON.stringify(result.body)).not.toContain('passwordHash');
    await test
      .http()
      .get(`/admin/users/${target.id}`)
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(200);
    await test
      .http()
      .get(`/admin/users/${randomUUID()}`)
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(404);
    await test
      .http()
      .get('/admin/users/not-an-id')
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(400);
    for (const query of [
      'limit=101',
      'page=0',
      'role=OWNER',
      'page=1e100',
      'unknown=x',
    ]) {
      await test
        .http()
        .get(`/admin/users?${query}`)
        .auth(admin.accessToken, { type: 'bearer' })
        .expect(400);
    }
  });

  it('locks/unlocks users and keeps old sessions revoked after unlocking', async () => {
    const admin = await createAdmin();
    const user = await test.register('user@example.com');
    const tokens = await test.login(user.email);
    const status = (value: string) =>
      test
        .http()
        .patch(`/admin/users/${user.id}/status`)
        .auth(admin.accessToken, { type: 'bearer' })
        .send({ status: value });
    await status('LOCKED').expect(200);
    await me(tokens.accessToken).expect(401);
    await refresh(tokens.refreshToken).expect(401);
    await test
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    await status('ACTIVE').expect(200);
    await me(tokens.accessToken).expect(401);
    await me((await test.login(user.email)).accessToken).expect(200);
  });

  it('changes roles using live authorization and revokes old role sessions', async () => {
    const admin = await createAdmin();
    const user = await test.register('user@example.com');
    const old = await test.login(user.email);
    const role = (value: string) =>
      test
        .http()
        .patch(`/admin/users/${user.id}/role`)
        .auth(admin.accessToken, { type: 'bearer' })
        .send({ role: value });
    await role('ADMIN').expect(200);
    await me(old.accessToken).expect(401);
    const elevated = await test.login(user.email);
    await test
      .http()
      .get('/admin/users')
      .auth(elevated.accessToken, { type: 'bearer' })
      .expect(200);
    await role('USER').expect(200);
    await test
      .http()
      .get('/admin/users')
      .auth(elevated.accessToken, { type: 'bearer' })
      .expect(401);
    const ordinary = await test.login(user.email);
    await test
      .http()
      .get('/admin/users')
      .auth(ordinary.accessToken, { type: 'bearer' })
      .expect(403);
  });

  it('protects the final active administrator from lock, demotion and deletion', async () => {
    const admin = await createAdmin();
    await test
      .http()
      .patch(`/admin/users/${admin.id}/status`)
      .auth(admin.accessToken, { type: 'bearer' })
      .send({ status: 'LOCKED' })
      .expect(409);
    await test
      .http()
      .patch(`/admin/users/${admin.id}/role`)
      .auth(admin.accessToken, { type: 'bearer' })
      .send({ role: 'USER' })
      .expect(409);
    await test
      .http()
      .delete(`/admin/users/${admin.id}`)
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(409);
    await test
      .http()
      .delete('/user/me')
      .auth(admin.accessToken, { type: 'bearer' })
      .send({ currentPassword: TEST_PASSWORD })
      .expect(409);
    await me(admin.accessToken).expect(200);
  });

  it('lets admins soft-delete users and removes them from list/detail responses', async () => {
    const admin = await createAdmin();
    const user = await test.register('user@example.com');
    const tokens = await test.login(user.email);
    await test
      .http()
      .delete(`/admin/users/${user.id}`)
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(204);
    await me(tokens.accessToken).expect(401);
    await test
      .http()
      .get(`/admin/users/${user.id}`)
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(404);
    const list = await test
      .http()
      .get('/admin/users')
      .auth(admin.accessToken, { type: 'bearer' })
      .expect(200);
    expect(list.body.total).toBe(1);
  });

  it('rate-limits repeated login attempts without trusting spoofed forwarding headers', async () => {
    const user = await test.register('user@example.com');
    for (let i = 0; i < 10; i++) {
      await test
        .http()
        .post('/auth/login')
        .set('X-Forwarded-For', `192.0.2.${i}`)
        .send({ email: user.email, password: 'wrong' })
        .expect(401);
    }
    const blocked = await test
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    await test.prisma.rateLimitBucket.updateMany({
      data: { resetAt: BigInt(Date.now() - 1) },
    });
    await test.login(user.email);
  });
});
