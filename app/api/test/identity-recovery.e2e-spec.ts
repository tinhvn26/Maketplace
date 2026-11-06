import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvalidAccountActionError } from '../src/modules/identity/application/errors/account-actions.errors.js';
import { AccountActionsService } from '../src/modules/identity/application/recovery/account-actions.service.js';
import {
  createIdentityTestApp,
  TEST_PASSWORD,
  type IdentityTestApp,
} from './support/identity-app.js';

const NEXT_PASSWORD = 'UpdatedIdentityPassword456!';
const email = 'recovery@example.com';

describe('Identity recovery HTTP API', () => {
  let context: IdentityTestApp;

  beforeAll(async () => {
    context = await createIdentityTestApp();
  }, 30_000);
  beforeEach(async () => {
    await context.reset();
  });
  afterAll(async () => {
    await context?.close();
  });

  async function mailedToken(subject: string, to = email) {
    const mail = await context.prisma.identityMail.findFirstOrThrow({
      where: { subject, to },
      orderBy: { createdAt: 'desc' },
    });
    const token = /Confirmation token: ([A-Za-z0-9_-]{43})/.exec(
      mail.text,
    )?.[1];
    expect(token).toHaveLength(43);
    return token!;
  }

  async function mailedOtp(to = email) {
    const mail = await context.prisma.identityMail.findFirstOrThrow({
      where: { subject: 'Reset your Marketplate password', to },
      orderBy: { createdAt: 'desc' },
    });
    const otp = /^OTP: (\d{6})$/m.exec(mail.text)?.[1];
    expect(otp).toMatch(/^\d{6}$/);
    return otp!;
  }

  function incorrectOtp(otp: string) {
    return ((Number(otp) + 1) % 1_000_000).toString().padStart(6, '0');
  }

  async function requestReset(to = email) {
    await context
      .http()
      .post('/auth/forgot-password')
      .send({ email: to })
      .expect(202);
    return mailedOtp(to);
  }

  async function requestVerification() {
    await context
      .http()
      .post('/auth/verification/request')
      .send({ email })
      .expect(202);
    return mailedToken('Verify your Marketplate email');
  }

  async function expectSessionRevoked(tokens: {
    accessToken: string;
    refreshToken: string;
  }) {
    await context
      .http()
      .get('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);
    await context
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);
  }

  it.each(['/auth/forgot-password', '/auth/verification/request'])(
    '%s returns an identical response for eligible, missing, locked and deleted accounts',
    async (route) => {
      await context.register(email);
      const locked = await context.register('locked@example.com');
      const deleted = await context.register('deleted@example.com');
      await context.prisma.user.update({
        where: { id: locked.id },
        data: { status: 'LOCKED' },
      });
      await context.prisma.user.update({
        where: { id: deleted.id },
        data: { deletedAt: new Date() },
      });
      // Registration may already have enqueued verification; isolate the requested operation.
      await context.prisma.identityMail.deleteMany();
      await context.prisma.accountAction.deleteMany();
      const eligible = await context
        .http()
        .post(route)
        .send({ email })
        .expect(202);
      for (const unavailableEmail of [
        'missing@example.com',
        'locked@example.com',
        'deleted@example.com',
      ]) {
        const response = await context
          .http()
          .post(route)
          .send({ email: unavailableEmail })
          .expect(202);
        expect(response.body).toEqual(eligible.body);
      }
      expect(await context.prisma.identityMail.count()).toBe(1);
      expect(await context.prisma.accountAction.count()).toBe(1);
      expect(eligible.body).not.toHaveProperty('token');
      expect(eligible.body).not.toHaveProperty('otp');
      expect(eligible.body).not.toHaveProperty('user');
    },
  );

  it('stores an action- and email-bound OTP digest, emails the code, and suppresses immediate duplicate requests', async () => {
    await context.register(email);
    const response = await context
      .http()
      .post('/auth/forgot-password')
      .send({ email: ' RECOVERY@EXAMPLE.COM ' })
      .expect(202);
    const otp = await mailedOtp();
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    expect(action.tokenHash).toBe(
      createHmac('sha256', process.env.JWT_REFRESH_SECRET!)
        .update(
          JSON.stringify([
            'marketplate:password-reset:otp:v1',
            action.id,
            email,
            otp,
          ]),
        )
        .digest('hex'),
    );
    expect(action.tokenHash).not.toBe(otp);
    expect(action.attempts).toBe(0);
    expect(action.expiresAt.getTime() - action.createdAt.getTime()).toBe(
      15 * 60_000,
    );
    expect(JSON.stringify(response.body)).not.toContain(otp);
    const repeated = await context
      .http()
      .post('/auth/forgot-password')
      .send({ email })
      .expect(202);
    expect(repeated.body).toEqual(response.body);
    expect(
      await context.prisma.accountAction.count({
        where: { purpose: 'RESET_PASSWORD' },
      }),
    ).toBe(1);
    expect(
      await context.prisma.identityMail.count({
        where: { subject: 'Reset your Marketplate password' },
      }),
    ).toBe(1);
  });

  it('resets the password exactly once and revokes all access and refresh sessions', async () => {
    const user = await context.register(email);
    const first = await context.login(email);
    const second = await context.login(email);
    const otp = await requestReset();
    await context
      .http()
      .post('/auth/reset-password')
      .send({
        email: ' RECOVERY@EXAMPLE.COM ',
        otp,
        newPassword: NEXT_PASSWORD,
      })
      .expect(204);
    await expectSessionRevoked(first);
    await expectSessionRevoked(second);
    await context
      .http()
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(401);
    await context.login(email, NEXT_PASSWORD);
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: 'AnotherPassword123!' })
      .expect(400);
    const persisted = await context.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(persisted.authVersion).toBe(1);
    expect(persisted.passwordHash).not.toBe(NEXT_PASSWORD);
  });

  it('rejects expired OTPs without updating the password or consuming the action', async () => {
    await context.register(email);
    const otp = await requestReset();
    await context.prisma.accountAction.updateMany({
      where: { purpose: 'RESET_PASSWORD' },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: NEXT_PASSWORD })
      .expect(400);
    await context.login(email);
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    expect(action.consumedAt).toBeNull();
  });

  it('rejects malformed OTPs and tokens from other account actions', async () => {
    await context.register(email);
    const verificationToken = await requestVerification();
    const otp = await requestReset();
    for (const invalidOtp of [
      'bad-token',
      '12345',
      '1234567',
      123456,
      verificationToken,
    ]) {
      await context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp: invalidOtp, newPassword: NEXT_PASSWORD })
        .expect(400);
    }
    await context
      .http()
      .post('/auth/verification/confirm')
      .send({ token: otp })
      .expect(400);
    await context
      .http()
      .post('/auth/email-change/confirm')
      .send({ token: otp })
      .expect(400);
    await context.login(email);
  });

  it('requires the email that received the OTP and does not leak the code in failures', async () => {
    await context.register(email);
    await context.register('other@example.com');
    const otp = await requestReset();
    for (const suppliedEmail of ['other@example.com', 'missing@example.com']) {
      const response = await context
        .http()
        .post('/auth/reset-password')
        .send({ email: suppliedEmail, otp, newPassword: NEXT_PASSWORD })
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain(otp);
    }
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    expect(action.attempts).toBe(0);
    await context.login('other@example.com');
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: NEXT_PASSWORD })
      .expect(204);
    await context.login(email, NEXT_PASSWORD);
  });

  it('persists a five-attempt OTP limit independently of HTTP rate-limit buckets', async () => {
    await context.register(email);
    const otp = await requestReset();
    for (let attempt = 0; attempt < 5; attempt++) {
      await context.prisma.rateLimitBucket.deleteMany();
      const response = await context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp: incorrectOtp(otp), newPassword: NEXT_PASSWORD })
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain(otp);
    }
    await context.prisma.rateLimitBucket.deleteMany();
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: NEXT_PASSWORD })
      .expect(400);
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    expect(action.attempts).toBe(5);
    expect(action.consumedAt).toBeNull();
    await context.login(email);
  });

  it('accepts a correct OTP on the fifth attempt', async () => {
    await context.register(email);
    const otp = await requestReset();
    for (let attempt = 0; attempt < 4; attempt++) {
      await context.prisma.rateLimitBucket.deleteMany();
      await context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp: incorrectOtp(otp), newPassword: NEXT_PASSWORD })
        .expect(400);
    }
    await context.prisma.rateLimitBucket.deleteMany();
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: NEXT_PASSWORD })
      .expect(204);
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    expect(action.attempts).toBe(5);
    expect(action.consumedAt).toBeInstanceOf(Date);
    await context.login(email, NEXT_PASSWORD);
  });

  it('caps concurrent OTP guesses at five persisted attempts', async () => {
    await context.register(email);
    const otp = await requestReset();
    const service = context.app.get(AccountActionsService);
    // Bypass HTTP throttling to exercise the database-backed limit directly.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.resetPassword(email, incorrectOtp(otp), NEXT_PASSWORD),
      ),
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(InvalidAccountActionError);
      }
    }
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    expect(action.attempts).toBe(5);
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: NEXT_PASSWORD })
      .expect(400);
    await context.login(email);
  });

  it('verifies the email once and suppresses subsequent verification requests', async () => {
    const user = await context.register(email);
    const tokens = await context.login(email);
    const token = await requestVerification();
    await context
      .http()
      .post('/auth/verification/confirm')
      .send({ token })
      .expect(204);
    await context
      .http()
      .post('/auth/verification/confirm')
      .send({ token })
      .expect(400);
    const saved = await context.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(saved.emailVerifiedAt).toBeInstanceOf(Date);
    const response = await context
      .http()
      .get('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(response.body.emailVerifiedAt).toBe(
      saved.emailVerifiedAt!.toISOString(),
    );
    const beforeCount = await context.prisma.identityMail.count();
    await context
      .http()
      .post('/auth/verification/request')
      .send({ email })
      .expect(202);
    expect(await context.prisma.identityMail.count()).toBe(beforeCount);
  });

  it('requires authentication and the current password before accepting a new email', async () => {
    await context.register(email);
    await context.register('taken@example.com');
    const tokens = await context.login(email);
    await context
      .http()
      .post('/user/me/change-email')
      .send({ newEmail: 'next@example.com', currentPassword: TEST_PASSWORD })
      .expect(401);
    await context
      .http()
      .post('/user/me/change-email')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        newEmail: 'taken@example.com',
        currentPassword: 'wrong-password',
      })
      .expect(401);
    await context
      .http()
      .post('/user/me/change-email')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ newEmail: 'taken@example.com', currentPassword: TEST_PASSWORD })
      .expect(409);
    await context
      .http()
      .post('/user/me/change-email')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({
        newEmail: 'RECOVERY@example.com',
        currentPassword: TEST_PASSWORD,
      })
      .expect(400);
    expect(
      await context.prisma.accountAction.count({
        where: { purpose: 'CHANGE_EMAIL' },
      }),
    ).toBe(0);
  });

  it('rate-limits email changes to five attempts per fifteen minutes', async () => {
    await context.register(email);
    const tokens = await context.login(email);
    const changeEmail = () =>
      context
        .http()
        .post('/user/me/change-email')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({
          newEmail: 'next@example.com',
          currentPassword: 'wrong-password',
        });

    for (let attempt = 0; attempt < 5; attempt++) {
      await changeEmail().expect(401);
    }
    const blocked = await changeEmail().expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(60);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(
      await context.prisma.accountAction.count({
        where: { purpose: 'CHANGE_EMAIL' },
      }),
    ).toBe(0);
  });

  it('persists an email change immediately and GET me returns it using the same session', async () => {
    const user = await context.register(email);
    await context.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const first = await context.login(email);
    const other = await context.login(email);
    const resetOtp = await requestReset();
    await context
      .http()
      .post('/user/me/change-email')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ newEmail: ' NEXT@EXAMPLE.COM ', currentPassword: TEST_PASSWORD })
      .expect(204);
    const profile = await context
      .http()
      .get('/user/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
    expect(profile.body).toMatchObject({
      id: user.id,
      email: 'next@example.com',
      emailVerifiedAt: null,
    });
    expect(
      await context.prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
    ).toMatchObject({ emailNormalized: 'next@example.com', authVersion: 1 });
    await expectSessionRevoked(other);
    await context
      .http()
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp: resetOtp, newPassword: NEXT_PASSWORD })
      .expect(400);
    await context
      .http()
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(401);
    await context.login('next@example.com');
  });

  it('still confirms previously queued email changes and revokes every session', async () => {
    const user = await context.register(email);
    const first = await context.login(email);
    const second = await context.login(email);
    await context.app
      .get(AccountActionsService)
      .requestEmailChange(user.id, ' NEXT@EXAMPLE.COM ', TEST_PASSWORD);
    const token = await mailedToken(
      'Confirm your new Marketplate email',
      'next@example.com',
    );
    const pendingProfile = await context
      .http()
      .get('/user/me')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
    expect(pendingProfile.body.email).toBe(email);
    expect(
      (await context.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailNormalized,
    ).toBe(email);
    expect(
      await context.prisma.identityMail.count({
        where: { to: email, subject: 'Confirm your new Marketplate email' },
      }),
    ).toBe(0);
    await context
      .http()
      .post('/auth/email-change/confirm')
      .send({ token, newEmail: 'attacker@example.com' })
      .expect(400);
    await context
      .http()
      .post('/auth/email-change/confirm')
      .send({ token })
      .expect(204);
    const changed = await context.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(changed.emailNormalized).toBe('next@example.com');
    expect(changed.emailVerifiedAt).toBeInstanceOf(Date);
    expect(changed.authVersion).toBe(1);
    await expectSessionRevoked(first);
    await expectSessionRevoked(second);
    await context
      .http()
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(401);
    const current = await context.login('next@example.com');
    const updatedProfile = await context
      .http()
      .get('/user/me')
      .set('Authorization', `Bearer ${current.accessToken}`)
      .expect(200);
    expect(updatedProfile.body.email).toBe('next@example.com');
    expect(updatedProfile.body.emailVerifiedAt).toBe(
      changed.emailVerifiedAt!.toISOString(),
    );
    await context
      .http()
      .post('/auth/email-change/confirm')
      .send({ token })
      .expect(400);
  });

  it('rolls back token consumption when the new email becomes occupied before confirmation', async () => {
    const user = await context.register(email);
    const tokens = await context.login(email);
    await context.app
      .get(AccountActionsService)
      .requestEmailChange(user.id, 'later-taken@example.com', TEST_PASSWORD);
    const token = await mailedToken(
      'Confirm your new Marketplate email',
      'later-taken@example.com',
    );
    await context.register('later-taken@example.com');
    await context
      .http()
      .post('/auth/email-change/confirm')
      .send({ token })
      .expect(409);
    const action = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'CHANGE_EMAIL' },
    });
    expect(action.consumedAt).toBeNull();
    expect(
      (await context.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .emailNormalized,
    ).toBe(email);
    await context
      .http()
      .get('/user/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
  });

  it('invalidates older reset actions when a fresh OTP is requested after cooldown', async () => {
    await context.register(email);
    const first = await requestReset();
    const original = await context.prisma.accountAction.findFirstOrThrow({
      where: { purpose: 'RESET_PASSWORD' },
    });
    await context.prisma.accountAction.updateMany({
      where: { purpose: 'RESET_PASSWORD' },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    const second = await requestReset();
    expect(
      (
        await context.prisma.accountAction.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).consumedAt,
    ).toBeInstanceOf(Date);
    // Independent six-digit draws may coincide; the prior action must still be retired.
    if (first !== second) {
      await context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp: first, newPassword: NEXT_PASSWORD })
        .expect(400);
    }
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp: second, newPassword: NEXT_PASSWORD })
      .expect(204);
  });

  it('rejects actions captured before a credential version change', async () => {
    const user = await context.register(email);
    const resetOtp = await requestReset();
    const verifyToken = await requestVerification();
    await context.prisma.user.update({
      where: { id: user.id },
      data: { authVersion: { increment: 1 } },
    });
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp: resetOtp, newPassword: NEXT_PASSWORD })
      .expect(400);
    await context
      .http()
      .post('/auth/verification/confirm')
      .send({ token: verifyToken })
      .expect(400);
    await context.login(email);
  });

  it.each(['locked', 'deleted'] as const)(
    'rejects an OTP when its account has been %s',
    async (state) => {
      const user = await context.register(email);
      const otp = await requestReset();
      await context.prisma.user.update({
        where: { id: user.id },
        data:
          state === 'locked' ? { status: 'LOCKED' } : { deletedAt: new Date() },
      });
      await context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp, newPassword: NEXT_PASSWORD })
        .expect(400);
    },
  );

  it('allows exactly one winner for concurrent password-reset confirmations', async () => {
    const user = await context.register(email);
    const otp = await requestReset();
    const responses = await Promise.all([
      context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp, newPassword: NEXT_PASSWORD }),
      context
        .http()
        .post('/auth/reset-password')
        .send({ email, otp, newPassword: NEXT_PASSWORD }),
    ]);
    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([204, 400]);
    expect(
      (await context.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .authVersion,
    ).toBe(1);
    await context.login(email, NEXT_PASSWORD);
  });
});
