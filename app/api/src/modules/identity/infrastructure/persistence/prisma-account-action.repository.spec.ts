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
import { InvalidAccountActionError } from '../../application/errors/account-actions.errors.js';
import type { QueueAccountActionInput } from '../../application/ports/account-action.repository.js';
import { PrismaAccountActionRepository } from './prisma-account-action.repository.js';

describe('PrismaAccountActionRepository reset attempts with SQLite', () => {
  let prisma: PrismaService;
  let repository: PrismaAccountActionRepository;
  let directory: string;
  let migratedLegacyData: {
    resetConsumed: boolean;
    resetAttempts: number;
    verificationConsumed: boolean;
    pendingResetBody: string;
    pendingResetExpired: boolean;
    pendingResetEligible: boolean;
    sentResetBody: string;
    verificationBody: string;
  };
  const now = new Date('2026-10-08T10:00:00.000Z');
  const email = 'owner@example.com';

  function resetAction(
    overrides: Partial<QueueAccountActionInput> = {},
  ): QueueAccountActionInput {
    return {
      id: 'reset-one',
      userId: 'user-one',
      purpose: 'RESET_PASSWORD',
      tokenHash: 'reset-code-hmac',
      emailNormalized: email,
      expectedEmailNormalized: email,
      authVersion: 3,
      expiresAt: new Date(now.getTime() + 15 * 60_000),
      now,
      mail: {
        subject: 'Reset your Marketplate password',
        text: 'Code: 123456',
      },
      ...overrides,
    };
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'marketplate-action-test-'));
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
        if (folder.name === '20261008000000_password_reset_otp') {
          await connection.executeScript(`
            INSERT INTO "User" ("id", "fullName", "emailNormalized", "passwordHash", "updatedAt")
            VALUES ('legacy-user', 'Legacy Owner', 'legacy@example.com', 'hash', CURRENT_TIMESTAMP);
            INSERT INTO "AccountAction"
              ("id", "userId", "purpose", "tokenHash", "emailNormalized", "authVersion", "expiresAt")
            VALUES
              ('legacy-reset', 'legacy-user', 'RESET_PASSWORD', 'old-reset', 'legacy@example.com', 0, '2100-01-01T00:00:00.000Z'),
              ('legacy-verification', 'legacy-user', 'VERIFY_EMAIL', 'old-verify', 'legacy@example.com', 0, '2100-01-01T00:00:00.000Z');
            INSERT INTO "IdentityMail" ("id", "to", "subject", "text", "expiresAt", "sentAt")
            VALUES
              ('pending-reset', 'legacy@example.com', 'Reset your Marketplate password', 'old reset link', '2100-01-01T00:00:00.000Z', NULL),
              ('sent-reset', 'legacy@example.com', 'Reset your Marketplate password', 'sent reset link', '2100-01-01T00:00:00.000Z', CURRENT_TIMESTAMP),
              ('pending-verification', 'legacy@example.com', 'Verify your Marketplate email', 'verification link', '2100-01-01T00:00:00.000Z', NULL);
          `);
        }
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
    repository = new PrismaAccountActionRepository(prisma);
    const [reset, verification, pendingReset, sentReset, pendingVerification] =
      await Promise.all([
        prisma.accountAction.findUniqueOrThrow({
          where: { id: 'legacy-reset' },
        }),
        prisma.accountAction.findUniqueOrThrow({
          where: { id: 'legacy-verification' },
        }),
        prisma.identityMail.findUniqueOrThrow({
          where: { id: 'pending-reset' },
        }),
        prisma.identityMail.findUniqueOrThrow({ where: { id: 'sent-reset' } }),
        prisma.identityMail.findUniqueOrThrow({
          where: { id: 'pending-verification' },
        }),
      ]);
    migratedLegacyData = {
      resetConsumed: reset.consumedAt !== null,
      resetAttempts: reset.attempts,
      verificationConsumed: verification.consumedAt !== null,
      pendingResetBody: pendingReset.text,
      pendingResetExpired: pendingReset.expiresAt.getTime() <= Date.now(),
      pendingResetEligible:
        (await prisma.identityMail.count({
          where: {
            id: 'pending-reset',
            sentAt: null,
            expiresAt: { gt: new Date() },
          },
        })) > 0,
      sentResetBody: sentReset.text,
      verificationBody: pendingVerification.text,
    };
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.identityMail.deleteMany();
    await prisma.user.create({
      data: {
        id: 'user-one',
        fullName: 'Account Owner',
        emailNormalized: email,
        passwordHash: 'original-password-hash',
        authVersion: 3,
      },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
    if (directory) {
      const target = resolve(directory);
      const allowed = resolve(tmpdir()) + sep;
      if (
        !target.startsWith(allowed) ||
        !target.includes('marketplate-action-test-')
      ) {
        throw new Error(
          'Refusing to remove a directory outside the test workspace',
        );
      }
      await rm(target, { recursive: true, force: true });
    }
  });

  it('retires unlinked pending mail while preserving verification actions and sent history', () => {
    expect(migratedLegacyData).toEqual({
      resetConsumed: true,
      resetAttempts: 0,
      verificationConsumed: false,
      pendingResetBody: '',
      pendingResetExpired: true,
      pendingResetEligible: false,
      sentResetBody: 'sent reset link',
      verificationBody: '',
    });
  });

  it('commits the outbox message with its exact account-action issuance', async () => {
    await repository.queue(resetAction());
    const message = await prisma.identityMail.findFirstOrThrow();
    expect(message).toMatchObject({
      actionId: 'reset-one',
      to: email,
      text: resetAction().mail.text,
      expiresAt: resetAction().expiresAt,
    });
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: message.actionId! },
      }),
    ).toMatchObject({ tokenHash: 'reset-code-hmac', userId: 'user-one' });
  });

  it('commits at most five reservations even when requests arrive concurrently', async () => {
    await repository.queue(resetAction());
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        repository.claimPasswordResetAttempt(email, now),
      ),
    );
    expect(results.filter((result) => result !== null)).toHaveLength(5);
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: 'reset-one' },
      }),
    ).toMatchObject({ attempts: 5, consumedAt: null });
    expect(await repository.claimPasswordResetAttempt(email, now)).toBeNull();
  });

  it('allows a correct fifth attempt and consumes it once while revoking sessions', async () => {
    await repository.queue(resetAction());
    await prisma.authSession.create({
      data: {
        id: 'active-session',
        userId: 'user-one',
        authVersion: 3,
        refreshTokenHash: 'refresh-hash',
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    for (let index = 0; index < 5; index++) {
      expect(await repository.claimPasswordResetAttempt(email, now)).toEqual({
        id: 'reset-one',
        tokenHash: 'reset-code-hmac',
      });
    }
    await repository.resetPassword('reset-code-hmac', 'replacement-hash', now);
    expect(
      await prisma.identityMail.findFirstOrThrow({
        where: { actionId: 'reset-one' },
      }),
    ).toMatchObject({
      text: '',
      sentAt: null,
      lockedUntil: null,
      expiresAt: now,
      lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
    });
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: 'user-one' } }),
    ).toMatchObject({ passwordHash: 'replacement-hash', authVersion: 4 });
    expect(
      await prisma.authSession.findUniqueOrThrow({
        where: { id: 'active-session' },
      }),
    ).toMatchObject({ revokedAt: now });
    expect(await repository.claimPasswordResetAttempt(email, now)).toBeNull();
    await expect(
      repository.resetPassword('reset-code-hmac', 'replayed', now),
    ).rejects.toBeInstanceOf(InvalidAccountActionError);
  });

  it('replaces the old code after cooldown and starts a fresh attempt budget', async () => {
    await repository.queue(resetAction());
    const reserved = await repository.claimPasswordResetAttempt(email, now);
    const resentAt = new Date(now.getTime() + 60_000);
    expect(
      await repository.queue(
        resetAction({
          id: 'reset-two',
          tokenHash: 'replacement-code-hmac',
          now: resentAt,
        }),
      ),
    ).toBe(true);
    expect(await repository.claimPasswordResetAttempt(email, resentAt)).toEqual(
      {
        id: 'reset-two',
        tokenHash: 'replacement-code-hmac',
      },
    );
    await expect(
      repository.resetPassword(
        reserved!.tokenHash,
        'old-code-password',
        resentAt,
      ),
    ).rejects.toBeInstanceOf(InvalidAccountActionError);
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: 'reset-two' },
      }),
    ).toMatchObject({ attempts: 1 });
    expect(
      await prisma.identityMail.findFirstOrThrow({
        where: { actionId: 'reset-one' },
      }),
    ).toMatchObject({
      text: '',
      sentAt: null,
      lockedUntil: null,
      expiresAt: resentAt,
    });
    expect(
      await prisma.identityMail.findFirstOrThrow({
        where: { actionId: 'reset-two' },
      }),
    ).toMatchObject({
      text: resetAction().mail.text,
      sentAt: null,
      actionId: 'reset-two',
    });
  });

  it('rolls back old-mail cancellation when a replacement issuance fails to commit', async () => {
    await repository.queue(resetAction());
    const before = await prisma.identityMail.findFirstOrThrow();
    await expect(
      repository.queue(
        resetAction({
          id: 'replacement-collision',
          // A failed unique insert occurs after the old action/mail were retired.
          tokenHash: 'reset-code-hmac',
          now: new Date(now.getTime() + 60_000),
        }),
      ),
    ).rejects.toThrow();
    expect(
      await prisma.identityMail.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before);
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: 'reset-one' },
      }),
    ).toMatchObject({ consumedAt: null });
    expect(await prisma.accountAction.count()).toBe(1);
  });

  it('retires the unsent verification message when its action is consumed', async () => {
    await repository.queue(
      resetAction({
        id: 'verify-one',
        purpose: 'VERIFY_EMAIL',
        tokenHash: 'verify-token-hash',
      }),
    );
    await repository.verifyEmail('verify-token-hash', now);
    expect(
      await prisma.identityMail.findFirstOrThrow({
        where: { actionId: 'verify-one' },
      }),
    ).toMatchObject({
      text: '',
      sentAt: null,
      lockedUntil: null,
      expiresAt: now,
    });
  });

  it('does not cancel another action purpose when issuing a replacement reset code', async () => {
    await repository.queue(
      resetAction({
        id: 'verify-one',
        purpose: 'VERIFY_EMAIL',
        tokenHash: 'verify-token-hash',
        mail: { subject: 'Verification', text: 'Verification token' },
      }),
    );
    await repository.queue(resetAction());
    await repository.queue(
      resetAction({
        id: 'reset-two',
        tokenHash: 'new-reset-hash',
        now: new Date(now.getTime() + 60_000),
      }),
    );
    expect(
      await prisma.identityMail.findFirstOrThrow({
        where: { actionId: 'verify-one' },
      }),
    ).toMatchObject({ text: 'Verification token', sentAt: null });
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: 'verify-one' },
      }),
    ).toMatchObject({ consumedAt: null });
  });

  it('does not replace the current action or its budget inside the cooldown', async () => {
    await repository.queue(resetAction());
    await repository.claimPasswordResetAttempt(email, now);
    expect(
      await repository.queue(
        resetAction({
          id: 'reset-two',
          tokenHash: 'too-soon',
          now: new Date(now.getTime() + 59_999),
        }),
      ),
    ).toBe(false);
    expect(await prisma.accountAction.count()).toBe(1);
    expect(await prisma.identityMail.count()).toBe(1);
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: 'reset-one' },
      }),
    ).toMatchObject({ attempts: 1, consumedAt: null });
  });

  it.each([
    { status: 'LOCKED' },
    { deletedAt: now },
    { authVersion: 4 },
    { emailNormalized: 'changed@example.com' },
  ])(
    'does not reserve attempts for unavailable or changed credentials %j',
    async (change) => {
      await repository.queue(resetAction());
      await prisma.user.update({ where: { id: 'user-one' }, data: change });
      expect(await repository.claimPasswordResetAttempt(email, now)).toBeNull();
      expect(
        await prisma.accountAction.findUniqueOrThrow({
          where: { id: 'reset-one' },
        }),
      ).toMatchObject({ attempts: 0 });
    },
  );

  it.each([
    { expiresAt: now },
    { consumedAt: now },
    { purpose: 'VERIFY_EMAIL' },
  ])(
    'rejects expired, consumed, and other-purpose actions %j',
    async (change) => {
      await repository.queue(resetAction());
      await prisma.accountAction.update({
        where: { id: 'reset-one' },
        data: change,
      });
      expect(await repository.claimPasswordResetAttempt(email, now)).toBeNull();
    },
  );

  it('does not charge another account or change profile metadata during a check', async () => {
    await repository.queue(resetAction());
    const updatedAt = new Date('2020-01-02T03:04:05.000Z');
    await prisma.user.update({
      where: { id: 'user-one' },
      data: { updatedAt },
    });
    expect(
      await repository.claimPasswordResetAttempt('other@example.com', now),
    ).toBeNull();
    expect(
      await prisma.accountAction.findUniqueOrThrow({
        where: { id: 'reset-one' },
      }),
    ).toMatchObject({ attempts: 0 });
    await repository.claimPasswordResetAttempt(email, now);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: 'user-one' } }),
    ).toMatchObject({ updatedAt, authVersion: 3 });
  });
});
