import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  User as PrismaUser,
} from '../../../../platform/database/generated/client.js';
import { PrismaService } from '../../../../platform/database/prisma.service.js';
import type { User } from '../../domain/entities/user.js';
import { isUserRole } from '../../domain/types/user-role.type.js';
import {
  canRemoveAdministratorAccess,
  isActiveAdministrator,
  removesAdministratorAccess,
} from '../../domain/policies/user-security.policy.js';
import { EmailAlreadyExistsError } from '../../domain/errors/auth.errors.js';
import {
  AccountChangedError,
  AdminRequiredError,
  LastAdminError,
  UserNotFoundError,
} from '../../domain/errors/users.errors.js';
import type {
  AdminUserChange,
  CredentialSnapshot,
  UserListQuery,
  UserRepository,
} from '../../application/ports/user.repository.js';
import type {
  UserProfileDetails,
  UserProfileRecord,
} from '../../application/users/user-profile.record.js';
import type { UpdateProfileInput } from '../../application/users/update-profile.input.js';

type UserWithProfile = Prisma.UserGetPayload<{ include: { profile: true } }>;

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

  async findProfileById(id: string): Promise<UserProfileRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { profile: true },
    });
    return user ? this.toProfileRecord(user) : null;
  }

  async create(
    user: User,
    profile: UserProfileDetails,
  ): Promise<UserProfileRecord> {
    try {
      const created = await this.prisma.user.create({
        data: {
          id: user.id,
          fullName: user.fullName,
          emailNormalized: user.emailNormalized,
          passwordHash: user.passwordHash,
          phoneNumber: user.phoneNumber,
          status: user.status,
          role: user.role,
          emailVerifiedAt: user.emailVerifiedAt,
          authVersion: user.authVersion,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          deletedAt: user.deletedAt,
          profile: { create: { avatarUrl: profile.avatarUrl } },
        },
        include: { profile: true },
      });
      return this.toProfileRecord(created);
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
  ): Promise<UserProfileRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, id);
      const persisted = await tx.user.findFirst({
        where: { id, status: 'ACTIVE', deletedAt: null },
      });
      if (!persisted) return null;
      const fullName =
        changes.fullName === undefined ? persisted.fullName : changes.fullName;
      const phoneNumber =
        changes.phoneNumber === undefined
          ? persisted.phoneNumber
          : changes.phoneNumber;
      if (
        fullName !== persisted.fullName ||
        phoneNumber !== persisted.phoneNumber
      ) {
        await tx.user.update({
          where: { id },
          data: {
            fullName,
            phoneNumber,
          },
        });
      }
      if (changes.avatarUrl !== undefined) {
        await tx.userProfile.upsert({
          where: { userId: id },
          create: { userId: id, avatarUrl: changes.avatarUrl },
          update: { avatarUrl: changes.avatarUrl },
        });
      }
      return this.toProfileRecord(
        await tx.user.findUniqueOrThrow({
          where: { id },
          include: { profile: true },
        }),
      );
    });
  }

  async list(
    query: UserListQuery,
  ): Promise<{ users: UserProfileRecord[]; total: number }> {
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
        include: { profile: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { users: users.map((user) => this.toProfileRecord(user)), total };
  }

  async changePassword(
    id: string,
    change: CredentialSnapshot & { passwordHash: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.credentialUser(tx, id, change);
      const now = new Date();
      const updated = await tx.user.updateMany({
        where: this.credentialCondition(id, change),
        data: {
          passwordHash: change.passwordHash,
          authVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw new AccountChangedError();
      await this.revokeCredentials(tx, id, now);
    });
  }

  async changeEmail(
    id: string,
    change: CredentialSnapshot & { emailNormalized: string; sessionId: string },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await this.credentialUser(tx, id, change);
        const now = new Date();
        const session = await tx.authSession.updateMany({
          where: {
            id: change.sessionId,
            userId: id,
            authVersion: change.expectedAuthVersion,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { authVersion: user.authVersion + 1 },
        });
        if (session.count !== 1) throw new AccountChangedError();
        const updated = await tx.user.updateMany({
          where: this.credentialCondition(id, change),
          data: {
            emailNormalized: change.emailNormalized,
            emailVerifiedAt: null,
            authVersion: { increment: 1 },
            updatedAt: now,
          },
        });
        if (updated.count !== 1) throw new AccountChangedError();
        await this.revokeCredentials(tx, id, now, change.sessionId);
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
      const user = await this.credentialUser(tx, id, snapshot);
      await this.preserveActiveAdmin(tx, user);
      const now = new Date();
      const updated = await tx.user.updateMany({
        where: this.credentialCondition(id, snapshot),
        data: {
          deletedAt: now,
          authVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw new AccountChangedError();
      await this.revokeCredentials(tx, id, now);
    });
  }

  async adminUpdate(
    actorId: string,
    id: string,
    change: AdminUserChange,
  ): Promise<UserProfileRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, id);
      const actor = await tx.user.findFirst({
        where: {
          id: actorId,
          role: 'ADMIN',
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      if (!isActiveAdministrator(actor)) throw new AdminRequiredError();
      const persisted = await tx.user.findFirst({
        where: { id, deletedAt: null },
        include: { profile: true },
      });
      if (!persisted) throw new UserNotFoundError();
      if (removesAdministratorAccess(change)) {
        await this.preserveActiveAdmin(tx, persisted);
      }
      const changed =
        change.deleted ||
        (change.role !== undefined && change.role !== persisted.role) ||
        (change.status !== undefined && change.status !== persisted.status);
      if (!changed) {
        return this.toProfileRecord(persisted);
      }
      const now = new Date();
      const updated = await tx.user.updateMany({
        where: { id, authVersion: persisted.authVersion, deletedAt: null },
        data: {
          status: change.status,
          role: change.role,
          deletedAt: change.deleted ? now : undefined,
          authVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (updated.count !== 1) throw new AccountChangedError();
      await this.revokeCredentials(tx, id, now);
      return this.toProfileRecord(
        await tx.user.findUniqueOrThrow({
          where: { id },
          include: { profile: true },
        }),
      );
    });
  }

  private async lockUser(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE "User" SET "authVersion" = "authVersion" WHERE "id" = ${id}
    `;
  }

  private credentialCondition(id: string, snapshot: CredentialSnapshot) {
    return {
      id,
      status: 'ACTIVE',
      deletedAt: null,
      passwordHash: snapshot.expectedPasswordHash,
      authVersion: snapshot.expectedAuthVersion,
    };
  }

  private async credentialUser(
    tx: Prisma.TransactionClient,
    id: string,
    snapshot: CredentialSnapshot,
  ): Promise<PrismaUser> {
    await this.lockUser(tx, id);
    const persisted = await tx.user.findFirst({
      where: this.credentialCondition(id, snapshot),
    });
    if (!persisted) throw new AccountChangedError();
    return persisted;
  }

  private async preserveActiveAdmin(
    tx: Prisma.TransactionClient,
    user: Pick<PrismaUser, 'status' | 'role' | 'deletedAt'>,
  ): Promise<void> {
    if (!isActiveAdministrator(user)) return;
    const count = await tx.user.count({
      where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
    });
    if (!canRemoveAdministratorAccess(user, count)) throw new LastAdminError();
  }

  private async revokeCredentials(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
    preserveSessionId?: string,
  ): Promise<void> {
    await tx.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(preserveSessionId ? { id: { not: preserveSessionId } } : {}),
      },
      data: { revokedAt: now },
    });
    await tx.identityMail.updateMany({
      where: { sentAt: null, action: { is: { userId } } },
      data: {
        text: '',
        expiresAt: now,
        lockedUntil: null,
        lastError: 'ACCOUNT_ACTION_UNAVAILABLE',
      },
    });
    await tx.accountAction.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
  }

  private toProfileRecord(user: UserWithProfile): UserProfileRecord {
    return {
      user: this.toDomainUser(user),
      avatarUrl: user.profile?.avatarUrl ?? null,
      profileUpdatedAt: user.profile?.updatedAt ?? null,
    };
  }

  private toDomainUser(user: PrismaUser): User {
    if (user.status !== 'ACTIVE' && user.status !== 'LOCKED') {
      throw new Error(`Unsupported persisted user status: ${user.status}`);
    }
    if (!isUserRole(user.role)) {
      throw new Error(`Unsupported persisted user role: ${user.role}`);
    }
    return {
      id: user.id,
      fullName: user.fullName,
      emailNormalized: user.emailNormalized,
      passwordHash: user.passwordHash,
      phoneNumber: user.phoneNumber,
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
