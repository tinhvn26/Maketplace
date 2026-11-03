import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  User as PrismaUser,
} from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { User } from '../../domain/entities/user.interface.js';
import {
  canRemoveAdministratorAccess,
  isActiveAdministrator,
  removesAdministratorAccess,
} from '../../domain/policies/user-security.policy.js';
import { EmailAlreadyExistsError } from '../../application/errors/auth.errors.js';
import {
  AccountChangedError,
  AdminRequiredError,
  LastAdminError,
  UserNotFoundError,
} from '../../application/errors/users.errors.js';
import type {
  AdminUserChange,
  CredentialSnapshot,
  UserListQuery,
  UserRepository,
} from '../../application/ports/user.repository.js';
import type { UpdateProfileInput } from '../../application/users/update-profile.input.js';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });

    return user ? this.toDomainUser(user) : null;
  }

  async findByEmail(emailNormalized: string): Promise<User | null> {
    const user = await this.prisma.user.findFirst({
      where: { emailNormalized, deletedAt: null },
    });

    return user ? this.toDomainUser(user) : null;
  }

  async create(user: User): Promise<User> {
    try {
      const createdUser = await this.prisma.user.create({ data: user });
      return this.toDomainUser(createdUser);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new EmailAlreadyExistsError();
      }

      throw error;
    }
  }

  async updateProfile(
    id: string,
    changes: UpdateProfileInput,
  ): Promise<User | null> {
    try {
      const user = await this.prisma.user.update({
        where: { id, status: 'ACTIVE', deletedAt: null },
        data: {
          fullName: changes.fullName,
          avatarUrl: changes.avatarUrl,
        },
      });

      return this.toDomainUser(user);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2025'
      ) {
        return null;
      }

      throw error;
    }
  }

  async list(query: UserListQuery): Promise<{ users: User[]; total: number }> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      role: query.role,
      status: query.status,
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q } },
              { emailNormalized: { contains: query.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users: users.map((user) => this.toDomainUser(user)), total };
  }

  async changePassword(
    id: string,
    change: CredentialSnapshot & { passwordHash: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id,
          status: 'ACTIVE',
          deletedAt: null,
          passwordHash: change.expectedPasswordHash,
          authVersion: change.expectedAuthVersion,
        },
        data: {
          passwordHash: change.passwordHash,
          authVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new AccountChangedError();
      await this.revokeSessions(tx, id);
    });
  }

  async changeEmail(
    id: string,
    change: CredentialSnapshot & { emailNormalized: string; sessionId: string },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const session = await tx.authSession.updateMany({
          where: {
            id: change.sessionId,
            userId: id,
            authVersion: change.expectedAuthVersion,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { authVersion: { increment: 1 } },
        });
        if (session.count !== 1) throw new AccountChangedError();
        const updated = await tx.user.updateMany({
          where: {
            id,
            status: 'ACTIVE',
            deletedAt: null,
            passwordHash: change.expectedPasswordHash,
            authVersion: change.expectedAuthVersion,
          },
          data: {
            emailNormalized: change.emailNormalized,
            emailVerifiedAt: null,
            authVersion: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new AccountChangedError();
        await tx.authSession.updateMany({
          where: { userId: id, id: { not: change.sessionId }, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.accountAction.updateMany({
          where: { userId: id, consumedAt: null },
          data: { consumedAt: now },
        });
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new EmailAlreadyExistsError();
      }
      throw error;
    }
  }

  async deleteOwnAccount(
    id: string,
    snapshot: CredentialSnapshot,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          id,
          status: 'ACTIVE',
          deletedAt: null,
          passwordHash: snapshot.expectedPasswordHash,
          authVersion: snapshot.expectedAuthVersion,
        },
      });
      if (!user) throw new AccountChangedError();
      await this.preserveActiveAdmin(tx, user);
      const updated = await tx.user.updateMany({
        where: {
          id,
          status: 'ACTIVE',
          deletedAt: null,
          passwordHash: snapshot.expectedPasswordHash,
          authVersion: snapshot.expectedAuthVersion,
        },
        data: { deletedAt: new Date(), authVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new AccountChangedError();
      await this.revokeSessions(tx, id);
    });
  }

  async adminUpdate(
    actorId: string,
    id: string,
    change: AdminUserChange,
  ): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findFirst({
        where: {
          id: actorId,
          role: 'ADMIN',
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      if (!isActiveAdministrator(actor)) throw new AdminRequiredError();
      const user = await tx.user.findFirst({ where: { id, deletedAt: null } });
      if (!user) throw new UserNotFoundError();

      if (removesAdministratorAccess(change)) {
        await this.preserveActiveAdmin(tx, user);
      }
      const changed =
        change.deleted ||
        (change.role !== undefined && change.role !== user.role) ||
        (change.status !== undefined && change.status !== user.status);
      if (!changed) return this.toDomainUser(user);

      const updated = await tx.user.updateMany({
        where: { id, authVersion: user.authVersion, deletedAt: null },
        data: {
          status: change.status,
          role: change.role,
          deletedAt: change.deleted ? new Date() : undefined,
          authVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new AccountChangedError();
      await this.revokeSessions(tx, id);
      return this.toDomainUser(
        await tx.user.findUniqueOrThrow({ where: { id } }),
      );
    });
  }

  private async preserveActiveAdmin(
    tx: Prisma.TransactionClient,
    user: PrismaUser,
  ): Promise<void> {
    if (!isActiveAdministrator(user)) return;
    const count = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    });
    if (!canRemoveAdministratorAccess(user, count)) throw new LastAdminError();
  }

  private async revokeSessions(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private toDomainUser(user: PrismaUser): User {
    if (user.status !== 'ACTIVE' && user.status !== 'LOCKED') {
      throw new Error(`Unsupported persisted user status: ${user.status}`);
    }
    if (user.role !== 'USER' && user.role !== 'ADMIN') {
      throw new Error(`Unsupported persisted user role: ${user.role}`);
    }

    return {
      id: user.id,
      fullName: user.fullName,
      emailNormalized: user.emailNormalized,
      passwordHash: user.passwordHash,
      avatarUrl: user.avatarUrl,
      status: user.status,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      authVersion: user.authVersion,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}
