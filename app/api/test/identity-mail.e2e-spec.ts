import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { IdentityMailWorker } from '../src/modules/identity/infrastructure/mail/identity-mail.worker.js';
import { SmtpIdentityMailer } from '../src/modules/identity/infrastructure/mail/smtp-identity.mailer.js';
import {
  ACCOUNT_ACTION_REPOSITORY,
  type AccountActionRepository,
  type AccountActionPurpose,
} from '../src/modules/identity/application/ports/account-action.repository.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from './support/identity-app.js';

describe('Identity mail outbox delivery', () => {
  let context: IdentityTestApp;
  let worker: IdentityMailWorker;
  let mailer: SmtpIdentityMailer;
  let actions: AccountActionRepository;

  async function queue(
    overrides: {
      expiresAt?: Date;
      availableAt?: Date;
      attempts?: number;
      lockedUntil?: Date;
      purpose?: AccountActionPurpose;
      text?: string;
    } = {},
  ) {
    const { purpose = 'VERIFY_EMAIL', ...mailOverrides } = overrides;
    const user = await context.prisma.user.upsert({
      where: { emailNormalized: 'recipient@example.invalid' },
      create: {
        id: randomUUID(),
        fullName: 'Mail recipient',
        emailNormalized: 'recipient@example.invalid',
        passwordHash: 'test-password-hash',
      },
      update: {},
    });
    const action = await context.prisma.accountAction.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        purpose,
        tokenHash: randomUUID(),
        emailNormalized: user.emailNormalized,
        authVersion: user.authVersion,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 900000),
      },
    });
    return context.prisma.identityMail.create({
      data: {
        id: randomUUID(),
        actionId: action.id,
        to: 'recipient@example.invalid',
        subject: 'Verify your account',
        text: 'Private single-use token: test-action-token',
        expiresAt: new Date(Date.now() + 900000),
        ...mailOverrides,
      },
    });
  }

  beforeAll(async () => {
    context = await createIdentityTestApp();
    worker = context.app.get(IdentityMailWorker);
    mailer = context.app.get(SmtpIdentityMailer);
    actions = context.app.get<AccountActionRepository>(
      ACCOUNT_ACTION_REPOSITORY,
    );
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await context.reset();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await context?.close();
  });

  it('delivers a persisted message once, marks success, and erases token-bearing text', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const message = await queue();
    await worker.flush();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({
      sentAt: expect.any(Date),
      text: '',
      attempts: 1,
      lockedUntil: null,
      lastError: null,
    });
    await worker.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('delivers a requested password-reset OTP and scrubs it after successful SMTP delivery', async () => {
    const email = 'otp-delivery@example.com';
    await context.register(email);
    // Isolate the reset email from the registration verification message.
    await context.prisma.identityMail.deleteMany();
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const response = await context
      .http()
      .post('/auth/forgot-password')
      .send({ email })
      .expect(202);
    const queued = await context.prisma.identityMail.findFirstOrThrow({
      where: { to: email, subject: 'Reset your Marketplate password' },
    });
    const otp = /^OTP: (\d{6})$/m.exec(queued.text)?.[1];
    expect(otp).toMatch(/^\d{6}$/);
    expect(JSON.stringify(response.body)).not.toContain(otp!);

    await worker.flush();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      to: email,
      subject: queued.subject,
      text: queued.text,
    });
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: queued.id },
      }),
    ).toMatchObject({ sentAt: expect.any(Date), text: '', attempts: 1 });
    await context
      .http()
      .post('/auth/reset-password')
      .send({ email, otp, newPassword: 'UpdatedIdentityPassword456!' })
      .expect(204);
    await context.login(email, 'UpdatedIdentityPassword456!');
  });

  it('retains failed messages for retry without persisting SMTP errors or secrets', async () => {
    const send = vi
      .spyOn(mailer, 'send')
      .mockRejectedValueOnce(
        new Error(
          'SMTP auth failed: smtp-password-secret recipient@example.invalid test-action-token',
        ),
      );
    const message = await queue();
    const startedAt = Date.now();
    await worker.flush();
    const failed = await context.prisma.identityMail.findUniqueOrThrow({
      where: { id: message.id },
    });
    expect(failed).toMatchObject({
      sentAt: null,
      text: message.text,
      attempts: 1,
      lockedUntil: null,
      lastError: 'SMTP_DELIVERY_FAILED',
    });
    expect(failed.availableAt.getTime()).toBeGreaterThanOrEqual(
      startedAt + 30000,
    );
    await worker.flush();
    expect(send).toHaveBeenCalledTimes(1);

    await context.prisma.identityMail.update({
      where: { id: message.id },
      data: { availableAt: new Date(0) },
    });
    send.mockResolvedValue();
    await worker.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({
      sentAt: expect.any(Date),
      text: '',
      attempts: 2,
      lockedUntil: null,
      lastError: null,
    });
  });

  it('does not retry an obsolete OTP after a newer reset code has been issued', async () => {
    const email = 'reset-resend@example.com';
    await context.register(email);
    await context.prisma.identityMail.deleteMany();
    await context
      .http()
      .post('/auth/forgot-password')
      .send({ email })
      .expect(202);
    const old = await context.prisma.identityMail.findFirstOrThrow({
      where: { to: email, subject: 'Reset your Marketplate password' },
    });
    const send = vi
      .spyOn(mailer, 'send')
      .mockRejectedValueOnce(new Error('SMTP unavailable'));
    await worker.flush();
    expect(send).toHaveBeenCalledOnce();
    await context.prisma.accountAction.update({
      where: { id: old.actionId! },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await context
      .http()
      .post('/auth/forgot-password')
      .send({ email })
      .expect(202);
    const current = await context.prisma.identityMail.findFirstOrThrow({
      where: {
        to: email,
        subject: old.subject,
        actionId: { not: old.actionId },
      },
    });
    await context.prisma.identityMail.update({
      where: { id: old.id },
      data: { availableAt: new Date(0) },
    });
    send.mockReset().mockResolvedValue();
    await worker.flush();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      to: current.to,
      subject: current.subject,
      text: current.text,
    });
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: old.id },
      }),
    ).toMatchObject({
      sentAt: null,
      text: '',
      attempts: 1,
      lockedUntil: null,
      lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
    });
  });

  it.each(['VERIFY_EMAIL', 'RESET_PASSWORD'] as const)(
    'does not deliver a %s message after its action has been consumed',
    async (purpose) => {
      const message = await queue({ purpose });
      const action = await context.prisma.accountAction.findUniqueOrThrow({
        where: { id: message.actionId! },
      });
      if (purpose === 'VERIFY_EMAIL')
        await actions.verifyEmail(action.tokenHash, new Date());
      else
        await actions.resetPassword(
          action.tokenHash,
          'replacement-password-hash',
          new Date(),
        );
      const send = vi.spyOn(mailer, 'send').mockResolvedValue();
      await worker.flush();
      expect(send).not.toHaveBeenCalled();
      expect(
        await context.prisma.identityMail.findUniqueOrThrow({
          where: { id: message.id },
        }),
      ).toMatchObject({
        sentAt: null,
        text: '',
        attempts: 0,
        lockedUntil: null,
      });
    },
  );

  it.each([
    { status: 'LOCKED' },
    { deletedAt: new Date() },
    { authVersion: 1 },
    { emailNormalized: 'changed@example.invalid' },
  ])(
    'does not deliver action mail after account invalidation %j',
    async (change) => {
      const message = await queue();
      const action = await context.prisma.accountAction.findUniqueOrThrow({
        where: { id: message.actionId! },
      });
      await context.prisma.user.update({
        where: { id: action.userId },
        data: change,
      });
      const send = vi.spyOn(mailer, 'send').mockResolvedValue();
      await worker.flush();
      expect(send).not.toHaveBeenCalled();
      expect(
        await context.prisma.identityMail.findUniqueOrThrow({
          where: { id: message.id },
        }),
      ).toMatchObject({
        text: '',
        sentAt: null,
        lockedUntil: null,
        lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
      });
    },
  );

  it('does not send a reset code after all confirmation attempts have been spent', async () => {
    const message = await queue({ purpose: 'RESET_PASSWORD' });
    await context.prisma.accountAction.update({
      where: { id: message.actionId! },
      data: { attempts: 5 },
    });
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    await worker.flush();
    expect(send).not.toHaveBeenCalled();
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ text: '', sentAt: null, lockedUntil: null });
  });

  it('skips a superseded message already present in the batch snapshot', async () => {
    const first = await queue({
      purpose: 'RESET_PASSWORD',
      text: 'First valid message',
    });
    const obsolete = await queue({
      purpose: 'VERIFY_EMAIL',
      text: 'Obsolete verification message',
    });
    await context.prisma.identityMail.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - 1000) },
    });
    let started!: () => void;
    let release!: () => void;
    const sending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi
      .spyOn(mailer, 'send')
      .mockImplementationOnce(async () => {
        started();
        await released;
      })
      .mockResolvedValue();
    const flush = worker.flush();
    try {
      await sending;
      const action = await context.prisma.accountAction.update({
        where: { id: obsolete.actionId! },
        data: { createdAt: new Date(Date.now() - 61_000) },
      });
      await actions.queue({
        id: randomUUID(),
        userId: action.userId,
        purpose: 'VERIFY_EMAIL',
        tokenHash: randomUUID(),
        emailNormalized: action.emailNormalized,
        expectedEmailNormalized: action.emailNormalized,
        authVersion: action.authVersion,
        now: new Date(),
        expiresAt: new Date(Date.now() + 900000),
        mail: {
          subject: 'Replacement verification',
          text: 'Current verification message',
        },
      });
    } finally {
      release();
      await flush;
    }
    expect(send.mock.calls.map(([message]) => message.text)).toEqual([
      'First valid message',
    ]);
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: obsolete.id },
      }),
    ).toMatchObject({ text: '', sentAt: null, attempts: 0 });
    await worker.flush();
    expect(send.mock.calls.map(([message]) => message.text)).toEqual([
      'First valid message',
      'Current verification message',
    ]);
  });

  it('retires a pending message when its linked action has been removed', async () => {
    const message = await queue();
    await context.prisma.accountAction.delete({
      where: { id: message.actionId! },
    });
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ actionId: null });
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    await worker.flush();
    expect(send).not.toHaveBeenCalled();
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ text: '', sentAt: null, attempts: 0 });
  });

  it('releases an expired lease without sending or retiring a still-valid action', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const message = await queue();
      const read = context.prisma.identityMail.findUnique.bind(
        context.prisma.identityMail,
      );
      vi.spyOn(
        context.prisma.identityMail,
        'findUnique',
      ).mockImplementationOnce((args) => {
        vi.setSystemTime(Date.now() + 120_001);
        return read(args);
      });
      const send = vi.spyOn(mailer, 'send').mockResolvedValue();
      await worker.flush();
      expect(send).not.toHaveBeenCalled();
      expect(
        await context.prisma.identityMail.findUniqueOrThrow({
          where: { id: message.id },
        }),
      ).toMatchObject({
        text: message.text,
        sentAt: null,
        attempts: 1,
        lockedUntil: null,
      });
      await worker.flush();
      expect(send).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrubs expired messages without delivering them', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    const message = await queue({ expiresAt: new Date(Date.now() - 1000) });
    await worker.flush();
    expect(send).not.toHaveBeenCalled();
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({
      sentAt: null,
      text: '',
      attempts: 0,
    });
  });

  it('coalesces concurrent flushes while a delivery is in progress', async () => {
    let release!: () => void;
    let deliveryStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const delivered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi.spyOn(mailer, 'send').mockImplementation(async () => {
      deliveryStarted();
      await delivered;
    });
    const message = await queue();
    const first = worker.flush();
    try {
      await started;
      const second = worker.flush();
      const third = worker.flush();
      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await first;
    }
    expect(
      await context.prisma.identityMail.findUniqueOrThrow({
        where: { id: message.id },
      }),
    ).toMatchObject({ sentAt: expect.any(Date), attempts: 1 });
  });

  it('skips messages that are delayed, leased by another worker, or past the retry limit', async () => {
    const send = vi.spyOn(mailer, 'send').mockResolvedValue();
    await queue({ availableAt: new Date(Date.now() + 60000) });
    await queue({ lockedUntil: new Date(Date.now() + 60000) });
    await queue({ attempts: 8 });
    await worker.flush();
    expect(send).not.toHaveBeenCalled();
  });
});
