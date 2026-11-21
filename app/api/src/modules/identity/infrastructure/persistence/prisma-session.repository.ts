import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import { isUserRole, USER_ROLES } from '../../domain/types/user-role.types.js';
import type {
  ActiveSession,
  AuthSession,
  SessionRepository,
} from '../../application/ports/session.repository.js';

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIfActive(session: AuthSession): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Acquire the write before inserting, and reject credentials verified
      // against an earlier password or account status. Raw SQL preserves the
      // profile's updatedAt instead of invoking Prisma's @updatedAt behavior.
      const matched = await tx.$executeRaw`
        UPDATE "User" SET "authVersion" = "authVersion"
        WHERE "id" = ${session.userId}
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
          AND "authVersion" = ${session.authVersion}
          AND "role" IN ('ADMIN', 'EMPLOYER', 'CUSTOMER')
      `;
      if (matched !== 1) return false;
      await tx.authSession.create({ data: session });
      return true;
    });
  }

  async findActive(
    sessionId: string,
    userId: string,
    now: Date,
  ): Promise<ActiveSession | null> {
    const result = await this.prisma.authSession.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE', deletedAt: null },
      },
      include: { user: { select: { authVersion: true, role: true } } },
    });
    if (!result || result.authVersion !== result.user.authVersion) {
      return null;
    }
    const { user, ...session } = result;
    if (!isUserRole(user.role)) return null;
    return { session, role: user.role };
  }

  async rotateRefreshToken(
    sessionId: string,
    userId: string,
    expectedHash: string,
    newHash: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { id: sessionId, userId },
        select: { authVersion: true },
      });
      if (!session) return false;

      const rotated = await tx.authSession.updateMany({
        where: {
          id: sessionId,
          userId,
          refreshTokenHash: expectedHash,
          revokedAt: null,
          expiresAt: { gt: now },
          user: {
            status: 'ACTIVE',
            deletedAt: null,
            authVersion: session.authVersion,
            role: { in: [...USER_ROLES] },
          },
        },
        data: { refreshTokenHash: newHash, lastUsedAt: now },
      });
      if (rotated.count === 1) return true;

      // Only callers with a verified signed refresh token reach this method.
      // A losing concurrent refresh is a replay too; revoke the entire session.
      await tx.authSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return false;
    });
  }

  async revoke(sessionId: string, userId: string, now: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAll(userId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: { authVersion: { increment: 1 } },
      });
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  async listActive(userId: string, now: Date): Promise<AuthSession[]> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        deletedAt: null,
        role: { in: [...USER_ROLES] },
      },
      select: { authVersion: true },
    });
    if (!user) return [];
    return this.prisma.authSession.findMany({
      where: {
        userId,
        authVersion: user.authVersion,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'asc' }],
    });
  }
}
