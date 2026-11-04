import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  AccountAction,
  Prisma,
  User,
} from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { EmailAlreadyExistsError } from '../../application/errors/auth.errors.js';
import type {
  AccountActionPurpose,
  AccountActionRepository,
  QueueAccountActionInput,
} from '../../application/ports/account-action.repository.js';
import { InvalidAccountActionError } from '../../application/errors/account-actions.errors.js';
import {
  accountActionCooldownStart,
  canQueueAccountAction,
  hasPasswordResetAttempts,
  isAccountActionAvailable,
  PASSWORD_RESET_MAX_ATTEMPTS,
} from '../../domain/policies/account-action.policy.js';

type ActionWithUser = AccountAction & { user: User };

@Injectable()
export class PrismaAccountActionRepository implements AccountActionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async queue(input: QueueAccountActionInput): Promise<boolean> {
    const actionId = input.id ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      // Take SQLite's write lock before reading so concurrent resends cannot
      // both pass the cooldown or race an attempt reservation.
      await tx.$executeRaw`
        UPDATE "User" SET "authVersion" = "authVersion"
        WHERE "id" = ${input.userId}
      `;
      const user = await tx.user.findFirst({
        where: {
          id: input.userId,
          status: 'ACTIVE',
          deletedAt: null,
          authVersion: input.authVersion,
          emailNormalized: input.expectedEmailNormalized,
        },
      });
      if (
        !canQueueAccountAction(user, input.purpose, {
          authVersion: input.authVersion,
          emailNormalized: input.expectedEmailNormalized,
        })
      ) {
        return false;
      }
      if (input.purpose === 'CHANGE_EMAIL') {
        const existing = await tx.user.findUnique({
          where: { emailNormalized: input.emailNormalized },
          select: { id: true },
        });
        if (existing) throw new EmailAlreadyExistsError();
      }

      const recentRequest = await tx.accountAction.findFirst({
        where: {
          userId: input.userId,
          purpose: input.purpose,
          createdAt: { gt: accountActionCooldownStart(input.now) },
        },
        select: { id: true },
      });
      if (recentRequest) return false;

      await this.retirePendingMail(
        tx,
        {
          userId: input.userId,
          purpose: input.purpose,
        },
        input.now,
      );
      await tx.accountAction.updateMany({
        where: {
          userId: input.userId,
          purpose: input.purpose,
          consumedAt: null,
        },
        data: { consumedAt: input.now },
      });
      await tx.accountAction.create({
        data: {
          id: actionId,
          userId: input.userId,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          emailNormalized: input.emailNormalized,
          authVersion: input.authVersion,
          createdAt: input.now,
          expiresAt: input.expiresAt,
        },
      });
      await tx.identityMail.create({
        data: {
          id: randomUUID(),
          actionId,
          to: input.emailNormalized,
          subject: input.mail.subject,
          text: input.mail.text,
          createdAt: input.now,
          availableAt: input.now,
          expiresAt: input.expiresAt,
        },
      });
      return true;
    });
  }

  async claimPasswordResetAttempt(
    emailNormalized: string,
    now: Date,
  ): Promise<{ id: string; tokenHash: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // A SQL no-op obtains the write lock without changing the profile's
      // updatedAt. Commit the attempt before the service checks the code.
      const matched = await tx.$executeRaw`
        UPDATE "User" SET "authVersion" = "authVersion"
        WHERE "emailNormalized" = ${emailNormalized}
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
      `;
      if (matched !== 1) return null;

      const action = await tx.accountAction.findFirst({
        where: {
          purpose: 'RESET_PASSWORD',
          emailNormalized,
          consumedAt: null,
          expiresAt: { gt: now },
          user: { emailNormalized, status: 'ACTIVE', deletedAt: null },
        },
        orderBy: { createdAt: 'desc' },
        include: { user: true },
      });
      if (
        !isAccountActionAvailable(action, 'RESET_PASSWORD', now) ||
        !hasPasswordResetAttempts(action.attempts)
      ) {
        return null;
      }

      const claimed = await tx.accountAction.updateMany({
        where: {
          id: action.id,
          purpose: 'RESET_PASSWORD',
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: PASSWORD_RESET_MAX_ATTEMPTS },
          user: {
            ...this.userCondition(action),
            emailNormalized,
          },
        },
        data: { attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return null;
      return { id: action.id, tokenHash: action.tokenHash };
    });
  }

  async isValid(
    tokenHash: string,
    purpose: AccountActionPurpose,
    now: Date,
  ): Promise<boolean> {
    const action = await this.prisma.accountAction.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    return isAccountActionAvailable(action, purpose, now);
  }

  async verifyEmail(tokenHash: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const action = await this.consume(tx, tokenHash, 'VERIFY_EMAIL', now);
      const updated = await tx.user.updateMany({
        where: {
          ...this.userCondition(action),
          emailNormalized: action.emailNormalized,
          emailVerifiedAt: null,
        },
        data: { emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw new InvalidAccountActionError();
    });
  }

  async resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const action = await this.consume(tx, tokenHash, 'RESET_PASSWORD', now);
      const updated = await tx.user.updateMany({
        where: {
          ...this.userCondition(action),
          emailNormalized: action.emailNormalized,
        },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new InvalidAccountActionError();
      await this.revokeCredentials(tx, action.userId, now);
    });
  }

  async changeEmail(tokenHash: string, now: Date): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const action = await this.consume(tx, tokenHash, 'CHANGE_EMAIL', now);
        const existing = await tx.user.findUnique({
          where: { emailNormalized: action.emailNormalized },
          select: { id: true },
        });
        if (existing) throw new EmailAlreadyExistsError();

        const updated = await tx.user.updateMany({
          where: {
            ...this.userCondition(action),
            emailNormalized: action.user.emailNormalized,
          },
          data: {
            emailNormalized: action.emailNormalized,
            emailVerifiedAt: now,
            authVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new InvalidAccountActionError();
        await this.revokeCredentials(tx, action.userId, now);
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new EmailAlreadyExistsError();
      }
      throw error;
    }
  }

  private async consume(
    tx: Prisma.TransactionClient,
    tokenHash: string,
    purpose: AccountActionPurpose,
    now: Date,
  ): Promise<ActionWithUser> {
    await tx.$executeRaw`
      UPDATE "AccountAction" SET "attempts" = "attempts"
      WHERE "tokenHash" = ${tokenHash}
    `;
    const action = await tx.accountAction.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!isAccountActionAvailable(action, purpose, now)) {
      throw new InvalidAccountActionError();
    }
    const claimed = await tx.accountAction.updateMany({
      where: { id: action.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new InvalidAccountActionError();
    await this.retirePendingMail(tx, { id: action.id }, now);
    return action;
  }

  private userCondition(action: ActionWithUser) {
    return {
      id: action.userId,
      status: 'ACTIVE',
      deletedAt: null,
      authVersion: action.authVersion,
    };
  }

  private async revokeCredentials(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    await this.retirePendingMail(tx, { userId }, now);
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.accountAction.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
  }

  private async retirePendingMail(
    tx: Prisma.TransactionClient,
    action: Prisma.AccountActionWhereInput,
    now: Date,
  ): Promise<void> {
    await tx.identityMail.updateMany({
      where: { sentAt: null, action: { is: action } },
      data: {
        text: '',
        expiresAt: now,
        lockedUntil: null,
        lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
      },
    });
  }
}
