import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import identityMailConfig from '../../../../config/identity-mail.config.js';
import type { Prisma } from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { IDENTITY_MAILER } from '../../application/ports/identity-mailer.js';
import type { IdentityMailer } from '../../application/ports/identity-mailer.js';
import {
  hasPasswordResetAttempts,
  isAccountActionAvailable,
} from '../../domain/policies/account-action.policy.js';

@Injectable()
export class IdentityMailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdentityMailWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_MAILER) private readonly mailer: IdentityMailer,
    @Inject(identityMailConfig.KEY)
    private readonly config: ConfigType<typeof identityMailConfig>,
  ) {}

  onModuleInit(): void {
    if (this.config.mode !== 'smtp') return;
    this.timer = setInterval(() => {
      void this.flush().catch(() => {
        // Never log message bodies, reset tokens, SMTP credentials or recipients.
        this.logger.error('Identity email worker could not process its queue');
      });
    }, 5_000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    try {
      await this.running;
    } catch {
      this.logger.error(
        'Identity email queue processing stopped during shutdown',
      );
    }
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.deliverBatch().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async deliverBatch(): Promise<void> {
    const now = new Date();
    await this.prisma.identityMail.updateMany({
      where: { expiresAt: { lte: now }, text: { not: '' } },
      data: { text: '' },
    });
    await this.prisma.identityMail.updateMany({
      where: {
        sentAt: null,
        actionId: null,
        text: { not: '' },
      },
      data: {
        text: '',
        expiresAt: now,
        lockedUntil: null,
        lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
      },
    });
    const messages = await this.prisma.identityMail.findMany({
      where: this.eligible(now),
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true },
    });

    for (const candidate of messages) {
      const claimedAt = new Date();
      const lockedUntil = new Date(claimedAt.getTime() + 120_000);
      const claimed = await this.prisma.identityMail.updateMany({
        where: { id: candidate.id, ...this.eligible(claimedAt) },
        data: { lockedUntil, attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) continue;

      // Never send a body captured in the batch snapshot. Re-read both the lease
      // and its action/account immediately before starting external delivery.
      const message = await this.prisma.identityMail.findUnique({
        where: { id: candidate.id },
        include: { action: { include: { user: true } } },
      });
      if (
        !message ||
        message.lockedUntil?.getTime() !== lockedUntil.getTime()
      ) {
        continue;
      }
      const checkedAt = new Date();
      if (message.lockedUntil.getTime() <= checkedAt.getTime()) {
        // A process pause can outlive its lease. Release only our stale lease;
        // the still-valid action can be retried by a later flush.
        await this.prisma.identityMail.updateMany({
          where: { id: candidate.id, lockedUntil },
          data: { lockedUntil: null },
        });
        continue;
      }
      const purpose = message.action?.purpose;
      if (
        message.sentAt !== null ||
        message.text === '' ||
        message.expiresAt.getTime() <= checkedAt.getTime() ||
        message.availableAt.getTime() > checkedAt.getTime() ||
        (purpose !== 'VERIFY_EMAIL' &&
          purpose !== 'RESET_PASSWORD' &&
          purpose !== 'CHANGE_EMAIL') ||
        !isAccountActionAvailable(message.action, purpose, checkedAt) ||
        message.to !== message.action.emailNormalized ||
        (purpose === 'RESET_PASSWORD' &&
          !hasPasswordResetAttempts(message.action.attempts))
      ) {
        await this.retire(candidate.id, lockedUntil, checkedAt);
        continue;
      }

      try {
        // Invalidation after this final check cannot recall SMTP already in
        // flight. Delivery remains at least once; no DB transaction spans SMTP.
        await this.mailer.send({
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        await this.prisma.identityMail.updateMany({
          where: { id: message.id, lockedUntil },
          data: {
            sentAt: new Date(),
            lockedUntil: null,
            text: '',
            lastError: null,
          },
        });
      } catch {
        await this.prisma.identityMail.updateMany({
          where: { id: message.id, lockedUntil },
          data: {
            lockedUntil: null,
            availableAt: new Date(
              Date.now() +
                Math.min(3600, 30 * 2 ** (message.attempts - 1)) * 1000,
            ),
            lastError: 'SMTP_DELIVERY_FAILED',
          },
        });
      }
    }
  }

  private eligible(now: Date): Prisma.IdentityMailWhereInput {
    return {
      sentAt: null,
      actionId: { not: null },
      text: { not: '' },
      expiresAt: { gt: now },
      availableAt: { lte: now },
      attempts: { lt: 8 },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    };
  }

  private async retire(
    id: string,
    lockedUntil: Date,
    now: Date,
  ): Promise<void> {
    await this.prisma.identityMail.updateMany({
      where: { id, lockedUntil, sentAt: null },
      data: {
        text: '',
        expiresAt: now,
        lockedUntil: null,
        lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
      },
    });
  }
}
