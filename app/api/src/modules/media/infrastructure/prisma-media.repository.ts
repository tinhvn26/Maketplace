import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import type { Prisma } from '../../../platform/database/generated/client.js';
import type { MediaRepository } from '../application/media.ports.js';
import type { MediaActor } from '../contracts/media.api.js';
import type { MediaAsset } from '../domain/media-asset.js';
import {
  MediaForbiddenError,
  MediaInUseError,
  MediaNotFoundError,
} from '../domain/media.errors.js';
import {
  ShopNotFoundError,
  ShopUnavailableError,
} from '../../shops/contracts/shops.api.js';

@Injectable()
export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(asset: MediaAsset, actor: MediaActor): Promise<MediaAsset> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActor(tx, actor);
      await this.requireAccess(tx, asset.shopId, actor);
      if (asset.ownerId !== actor.userId) throw new MediaForbiddenError();
      return this.toAsset(await tx.mediaAsset.create({ data: asset }));
    });
  }

  async findById(id: string): Promise<MediaAsset | null> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    return asset ? this.toAsset(asset) : null;
  }

  async findByIds(ids: readonly string[]): Promise<MediaAsset[]> {
    if (ids.length === 0) return [];
    return (
      await this.prisma.mediaAsset.findMany({ where: { id: { in: [...ids] } } })
    ).map((asset) => this.toAsset(asset));
  }

  async deleteUnused(id: string, actor: MediaActor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockActor(tx, actor);
      const current = await tx.mediaAsset.findUnique({ where: { id } });
      if (!current || current.status !== 'READY')
        throw new MediaNotFoundError();
      await this.requireAccess(tx, current.shopId, actor);
      // The write lock serializes this status change with Catalog's usage binding.
      const deleted = await tx.mediaAsset.updateMany({
        where: { id, status: 'READY', usages: { none: {} } },
        data: { status: 'DELETED' },
      });
      if (deleted.count === 1) return;
      const asset = await tx.mediaAsset.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!asset || asset.status !== 'READY') throw new MediaNotFoundError();
      throw new MediaInUseError();
    });
  }

  private async lockActor(
    tx: Prisma.TransactionClient,
    actor: MediaActor,
  ): Promise<void> {
    await tx.$executeRaw`UPDATE "User" SET "authVersion" = "authVersion" WHERE "id" = ${actor.userId}`;
  }

  private async requireAccess(
    tx: Prisma.TransactionClient,
    shopId: string | null,
    actor: MediaActor,
  ): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, role: true, status: true, deletedAt: true },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.deletedAt !== null ||
      user.role !== actor.role ||
      !['USER', 'ADMIN'].includes(user.role)
    )
      throw new MediaForbiddenError(
        'An active account with current privileges is required',
      );
    if (shopId === null) {
      if (user.role !== 'ADMIN')
        throw new MediaForbiddenError(
          'Platform media requires administrator access',
        );
      return;
    }
    const shop = await tx.shop.findUnique({
      where: { id: shopId },
      include: {
        owner: { select: { role: true, status: true, deletedAt: true } },
      },
    });
    if (!shop) throw new ShopNotFoundError();
    if (user.role !== 'ADMIN' && shop.ownerId !== user.id)
      throw new MediaForbiddenError();
    if (
      shop.status !== 'ACTIVE' ||
      shop.owner.status !== 'ACTIVE' ||
      shop.owner.deletedAt !== null ||
      !['USER', 'ADMIN'].includes(shop.owner.role)
    )
      throw new ShopUnavailableError();
  }

  private toAsset(
    asset: Omit<MediaAsset, 'status'> & { status: string },
  ): MediaAsset {
    if (asset.status !== 'READY' && asset.status !== 'DELETED')
      throw new Error('Unsupported persisted media status');
    return { ...asset, status: asset.status };
  }
}
